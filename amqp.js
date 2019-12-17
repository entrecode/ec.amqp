/* eslint-disable prefer-object-spread */
process.env.SUPPRESS_NO_CONFIG_WARNING = 'y';
process.env.ALLOW_CONFIG_MUTATIONS = 'y';

const path = require('path');
const config = require('config');
const amqp = require('amqp-connection-manager');
const uuid = require('uuid/v4');

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

const connectionUser = config.get('amqp.user');
const connectionPassword = config.get('amqp.password');
const connectionURLs = shuffleArray(
  config.get('amqp.hosts').map((host) => `amqp://${connectionUser}:${connectionPassword}@${host}`)
);

let connectionManager;
if (process.env.NODE_ENV === 'testing') {
  connectionManager = {
    isConnected: () => true,
    createChannel: () => ({ publish: () => {} }),
    close: () => {},
  };
  console.warn('ec.amqp is in testing mode and not attempting to connect to RabbitMQ.');
} else {
  connectionManager = amqp.connect(connectionURLs, { json: true });
  connectionManager.on('connect', (c) => console.log(`amqp connected to ${c.url}`));
  connectionManager.on('disconnect', ({ err }) => {
    console.warn(`amqp disconnected (${config.get('amqp.hosts').join('|')})`);

    if (err) {
      console.warn(`amqp disconnect reason: ${err.message} ${err.stack} ${JSON.stringify(err)}`);
    }
  });
}

async function isReachable() {
  if (connectionManager.isConnected()) {
    return true;
  }
  throw new Error('amqp is not connected');
}

async function workerQueue(queueName, exchange, bindings, handler, prefetch = 1) {
  return connectionManager.createChannel({
    async setup(channel) {
      await channel.assertExchange(exchange, 'topic', { durable: true });
      const { queue } = await channel.assertQueue(queueName, { durable: true });
      channel.prefetch(prefetch);
      await Promise.all(bindings.map((binding) => channel.bindQueue(queue, exchange, binding)));
      channel.consume(
        queue,
        async (message) => {
          if (!message) {
            throw new Error('consumer was canceled!');
          }
          const event = JSON.parse(message.content.toString());
          const properties = Object.assign({}, message.properties, { redelivered: message.fields.redelivered });
          const ack = () => channel.ack(message);
          const nack = (timeout = 10000, requeue = false, redirectQueue) =>
            setTimeout(async () => {
              if (redirectQueue) {
                await channel.assertQueue(redirectQueue, { durable: true });
                await channel.sendToQueue(redirectQueue, message.content, message.properties);
              }
              return channel.nack(message, false, requeue);
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
        { exclusive: false }
      );
    },
  });
}

async function subscribe(queueNamePrefix, exchange, bindings, handler, options = {}) {
  return connectionManager.createChannel({
    async setup(channel) {
      await channel.assertExchange(exchange, 'topic', { durable: true });
      const { queue } = await channel.assertQueue(`${queueNamePrefix}-${uuid()}}`, { durable: false, exclusive: true });
      await Promise.all(bindings.map((binding) => channel.bindQueue(queue, exchange, binding)));
      let consumeOptions;
      if (options.noAck) {
        consumeOptions = { noAck: true };
      }
      channel.consume(
        queue,
        async (message) => {
          if (!message) {
            throw new Error('consumer was canceled!');
          }
          const event = JSON.parse(message.content.toString());
          const ack = () => channel.ack(message);
          const nack = (timeout = 10000) =>
            setTimeout(() => {
              channel.nack(message);
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
        Object.assign({}, { exclusive: true }, consumeOptions)
      );
    },
  });
}

async function plainChannel(exchange, channelCallback) {
  const channelWrapper = connectionManager.createChannel({
    async setup(channel) {
      await channel.assertExchange(exchange, 'topic', { durable: true });
      if (channelCallback) {
        await channelCallback(channel);
      }
    },
  });
  return channelWrapper;
}

async function publishChannel(exchange) {
  const channelWrapper = await plainChannel(exchange);
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
        options
      )
    );
  };
}

process.on('SIGHUP', () => {
  connectionManager.close();
});

process.on('SIGINT', () => {
  connectionManager.close();
});

process.on('SIGTERM', () => {
  connectionManager.close();
});

module.exports = {
  isReachable,
  workerQueue,
  subscribe,
  publishChannel,
  plainChannel,
  connectionManager,
};
