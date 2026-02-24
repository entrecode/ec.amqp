/* eslint-disable prefer-object-spread */
process.env.SUPPRESS_NO_CONFIG_WARNING = 'y';
process.env.ALLOW_CONFIG_MUTATIONS = 'y';

const path = require('path');
const config = require('config');
const amqp = require('amqp-connection-manager');
const { v4: uuid } = require('uuid');
const { name: product, version } = require('./package.json');

// init default config
const ourConfigDir = path.join(__dirname, 'config');
const baseConfig = config.util.loadFileConfigs(ourConfigDir);
config.util.setModuleDefaults('amqp', baseConfig);

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]]; // eslint-disable-line no-param-reassign
  }
  return array;
}

const connectionUser = encodeURIComponent(config.get('amqp.user'));
const connectionPassword = encodeURIComponent(config.get('amqp.password'));
const useTLS = config.get('amqp.tls');
const connectionVhost =
  config.has('amqp.vhost') && config.get('amqp.vhost') ? `/${encodeURIComponent(config.get('amqp.vhost'))}` : '';
const connectionURLs = shuffleArray(
  config
    .get('amqp.hosts')
    .map(
      (host) => `amqp${!!useTLS ? 's' : ''}://${connectionUser}:${connectionPassword}@${host}${connectionVhost}`,
    ),
);

let neverConnected = true;
let shuttingDown = false;
let connectionManager;
if (
  process.env.NODE_ENV === 'testing' ||
  (config.has('amqp.active') && config.get('amqp.active') === false) ||
  (config.has('amqp.disableNewCluster') && config.get('amqp.disableNewCluster') === true)
) {
  connectionManager = {
    isConnected: () => true,
    createChannel: () => ({ publish: () => {} }),
    close: () => Promise.resolve(),
  };
  console.warn('ec.amqp is in testing mode and not attempting to connect to RabbitMQ.');
} else {
  const redactedURLs = connectionURLs.map((url) => url.replace(/\/\/[^@]+@/, '//***:***@'));
  console.log('ec.amqp is trying to connect...', JSON.stringify({ connectionURLs: redactedURLs }));

  let clientProperties;
  if (process.env.HOSTNAME) {
    clientProperties = {
      connection_name: `${process.env.HOSTNAME}-${process.pid}`,
      product,
      version,
    };
  }
  connectionManager = amqp.connect(connectionURLs, {
    json: true,
    heartbeatIntervalInSeconds: config.get('amqp.heartbeatIntervalInSeconds'),
    reconnectTimeInSeconds: config.get('amqp.reconnectTimeInSeconds'),
    connectionOptions: {
      clientProperties,
    },
  });
  connectionManager.on('connect', (c) => {
    console.log(
      `amqp connected to ${c.url.replace(/\/\/[^@]+@/, '//***:***@')} (${clientProperties ? clientProperties.connection_name : 'no hostname'})`
    );
    neverConnected = false;
  });
  connectionManager.on('disconnect', ({ err }) => {
    console.warn(
      `amqp disconnected (${config.get('amqp.hosts').join('|')}) (${
        clientProperties ? clientProperties.connection_name : 'no hostname'
      })`,
    );

    if (err) {
      console.warn(`amqp disconnect reason: ${err.message} ${err.stack} ${JSON.stringify(err)}`);
    }
  });
}

async function isReachable() {
  if (shuttingDown) {
    console.info('amqp is shutting down');
    return false;
  }
  if (connectionManager.isConnected()) {
    return true;
  }
  if (neverConnected) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (connectionManager.isConnected()) {
      return true;
    }
    throw new Error('amqp did not connect yet');
  }
  throw new Error('amqp is not connected');
}

async function workerQueue(queueName, exchange, bindings, handler, prefetch = 1) {
  const channelWrapper = connectionManager.createChannel({
    setup(channel) {
      return Promise.all([
        channel.assertExchange(exchange, 'topic', { durable: true }),
        channel.assertQueue(queueName, {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
          },
        }),
        channel.prefetch(prefetch),
        ...bindings.map((binding) => channel.bindQueue(queueName, exchange, binding)),
        channel.consume(
          queueName,
          async (message) => {
            if (!message) {
              throw new Error('consumer was canceled!');
            }
            const event = JSON.parse(message.content.toString());
            const properties = Object.assign({}, message.properties, { redelivered: message.fields.redelivered });
            const ack = () => channelWrapper.ack(message);
            const nack = (timeout = 10000, requeue = false, redirectQueue) =>
              setTimeout(async () => {
                if (redirectQueue) {
                  await channel.assertQueue(redirectQueue, {
                    durable: true,
                    arguments: {
                      'x-queue-type': 'quorum',
                    },
                  });
                  await channelWrapper.sendToQueue(redirectQueue, message.content, message.properties);
                }
                return channelWrapper.nack(message, false, requeue);
              }, timeout);
            try {
              await handler(event, properties, {
                ack,
                nack,
              });
            } catch (err) {
              console.error(err);
              nack(10000, true);
            }
          },
          { exclusive: false },
        ),
      ]);
    },
  });
  return channelWrapper;
}

async function subscribe(queueNamePrefix, exchange, bindings, handler, options = {}) {
  const channelWrapper = connectionManager.createChannel({
    setup(channel) {
      const queueName = `${queueNamePrefix}-${uuid()}`;
      let consumeOptions;
      if (options.noAck) {
        consumeOptions = { noAck: true };
      }
      let exchangeType = 'topic';
      if (options.exchangeType) {
        exchangeType = options.exchangeType;
      }
      return Promise.all([
        channel.assertExchange(exchange, exchangeType, {
          durable: 'durableExchange' in options ? options.durableExchange : true,
        }),
        channel.assertQueue(queueName, {
          durable: 'durableQueue' in options ? options.durableQueue : false,
          exclusive: 'exclusiveQueue' in options ? options.exclusiveQueue : true,
        }),
        ...bindings.map((binding) => channel.bindQueue(queueName, exchange, binding)),
        channel.consume(
          queueName,
          async (message) => {
            if (!message) {
              throw new Error('consumer was canceled!');
            }
            const event = JSON.parse(message.content.toString());
            const ack = () => channelWrapper.ack(message);
            const nack = (timeout = 10000) =>
              setTimeout(() => {
                channelWrapper.nack(message);
              }, timeout);
            try {
              await handler(event, message.properties, {
                ack,
                nack,
              });
            } catch (err) {
              console.error(err);
              nack(10000);
            }
          },
          Object.assign({}, { exclusive: true }, consumeOptions),
        ),
      ]);
    },
  });
  return channelWrapper;
}

function plainChannel(exchange, exchangeType = 'topic', durable = true) {
  if (typeof exchangeType === 'function') {
    console.error('plainChannel `channelCallback` has been removed in v0.8.0');
    exchangeType = 'topic';
  }
  return connectionManager.createChannel({
    setup(channel) {
      return channel.assertExchange(exchange, exchangeType, { durable });
    },
  });
}

async function publishChannel(exchange, exchangeType, durable) {
  const channelWrapper = plainChannel(exchange, exchangeType, durable);
  return async function publish(routingKey, content, type, appID, options) {
    return channelWrapper.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(content)),
      Object.assign(
        {
          persistent: true,
          contentType: 'application/json',
          messageId: uuid(),
          type: 'event',
          appId: 'unknown',
          timestamp: new Date().getTime(),
        },
        { type, appId: appID },
        options,
      ),
    );
  };
}

async function gracefulShutdown() {
  if (shuttingDown) {
    return Promise.resolve();
  }
  shuttingDown = true;
  return connectionManager.close().catch((err) => {
    console.error('Error during graceful shutdown:', err);
  });
}

process.on('SIGHUP', async () => {
  console.log('[ec.amqp] SIGHUP received.');
  await gracefulShutdown();
});

process.on('SIGINT', async () => {
  console.log('[ec.amqp] SIGINT received.');
  await gracefulShutdown();
});

process.on('SIGTERM', async () => {
  console.log('[ec.amqp] SIGTERM received.');
  await gracefulShutdown();
});

// Unhandled exception handlers
process.on('uncaughtException', async (err) => {
  console.log('[ec.amqp] uncaughtException received.');
  await gracefulShutdown();
  process.exit(1);
});

process.on('unhandledRejection', async () => {
  console.log('[ec.amqp] unhandledRejection received.');
  await gracefulShutdown();
  process.exit(1);
});

process.on('beforeExit', async (code) => {
  console.log('[ec.amqp] beforeExit received. code:', code);
  await gracefulShutdown();
});

module.exports = {
  isReachable,
  workerQueue,
  subscribe,
  publishChannel,
  plainChannel,
  connectionManager,
  gracefulShutdown,
};
