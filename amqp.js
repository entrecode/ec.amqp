process.env.SUPPRESS_NO_CONFIG_WARNING = 'y';

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
const connectionURLs = shuffleArray(config.get('amqp.hosts')
  .map(host => `amqp://${connectionUser}:${connectionPassword}@${host}`));

const connectionManager = amqp.connect(connectionURLs, { json: true });
connectionManager.on('connect', c => console.log(`amqp connected to ${c.url}`));
connectionManager.on('disconnect', (err) => {
  console.warn(`amqp disconnected (${config.get('amqp.hosts').join('|')})`);

  if (err) {
    console.warn(`amqp disconnect reason: ${err.message} ${err.stack} ${err}`);
  }
});

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
      bindings.forEach(binding => channel.bindQueue(queue, exchange, binding));
      channel.consume(queue, async (message) => {
        const event = JSON.parse(message.content.toString());
        const properties = Object.assign(
          {},
          message.properties,
          { redelivered: message.fields.redelivered },
        );
        const ack = () => channel.ack(message);
        const nack = (timeout = 10000, requeue = false, redirectQueue) => setTimeout(async () => {
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
      }, { exclusive: false });
    },
  });
}

async function subscribe(queueNamePrefix, exchange, bindings, handler, options = {}) {
  return connectionManager.createChannel({
    async setup(channel) {
      await channel.assertExchange(exchange, 'topic', { durable: true });
      const { queue } = await channel.assertQueue(`${queueNamePrefix}-${uuid()}}`, { durable: false, exclusive: true });
      bindings.forEach(binding => channel.bindQueue(queue, exchange, binding));
      let consumeOptions;
      if (options.noAck) {
        consumeOptions = { noAck: true };
      }
      channel.consume(queue, async (message) => {
        const event = JSON.parse(message.content.toString());
        const ack = () => channel.ack(message);
        const nack = (timeout = 10000) => setTimeout(() => {
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
      }, Object.assign({}, { exclusive: true }, consumeOptions));
    },
  });
}

async function plainChannel(exchange) {
  const channel = await new Promise((resolve, reject) => {
    connectionManager.createChannel({
      setup(createdChannel) {
        createdChannel.assertExchange(exchange, 'topic', { durable: true })
          .then(() => resolve(createdChannel))
          .catch(reject);
      },
    });
  });
  return channel;
}

async function publishChannel(exchange) {
  const channel = await plainChannel(exchange);
  return async function publish(routingKey, content, type, appID, options) {
    return Promise.resolve(channel.publish(
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
        }, {
          type,
          appId: appID,
        },
        options,
      ),
    ))
      .then((ok) => {
        if (ok) {
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          channel.once('drain', resolve);
        });
      });
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
};
