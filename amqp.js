process.env.SUPPRESS_NO_CONFIG_WARNING = 'y';

const path = require('path');
const { promisify } = require('util');
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
connectionManager.on('disconnect', () => console.warn(`amqp disconnected (${config.amqp.url})`));

async function isReachable() {
  if (connectionManager.isConnected()) {
    return true;
  }
  throw new Error('amqp is not connected');
}

async function workerQueue(queueName, exchange, bindings, handler) {
  return connectionManager.createChannel({
    async setup(channel) {
      await channel.assertExchange(exchange, 'topic', { durable: true });
      const { queue } = await channel.assertQueue(queueName, { durable: true });
      bindings.forEach(binding => channel.bindQueue(queue, exchange, binding));
      channel.consume(queue, (message) => {
        const event = JSON.parse(message.content.toString());
        handler(event, message.properties, {
          ack: () => channel.ack(message),
          nack: (timeout = 10000) => setTimeout(() => {
            channel.nack(message);
          }, timeout),
        });
      }, { exclusive: false });
    }
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
      channel.consume(queue, (message) => {
        const event = JSON.parse(message.content.toString());
        handler(event, message.properties, {
          ack: () => channel.ack(message),
          nack: (timeout = 10000) => setTimeout(() => {
            channel.nack(message);
          }, timeout),
        });
      }, Object.assign({}, { exclusive: true }, consumeOptions));
    }
  });
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
};
