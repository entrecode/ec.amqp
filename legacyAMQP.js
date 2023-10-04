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

class LegacyAMQP {
  constructor() {
    const connectionUser = config.get('amqp.user');
    const connectionPassword = config.get('amqp.password');
    const connectionURLs = shuffleArray(
      config.get('amqp.legacyHosts').map((host) => `amqp://${connectionUser}:${connectionPassword}@${host}`),
    );

    this.this.neverConnected = true;
    this.shuttingDown = false;
    this.connectionManager;
    if (process.env.NODE_ENV === 'testing' || (config.has('amqp.active') && config.get('amqp.active') === false)) {
      this.connectionManager = {
        isConnected: () => true,
        createChannel: () => ({ publish: () => {} }),
        close: () => {},
      };
      console.warn('ec.amqp is in testing mode and not attempting to connect to RabbitMQ.');
    } else {
      console.log('ec.amqp is trying to connect...', JSON.stringify({ connectionURLs }));

      let clientProperties;
      if (process.env.HOSTNAME) {
        clientProperties = {
          connection_name: `${process.env.HOSTNAME}-${process.pid}`,
          product,
          version,
        };
      }
      this.connectionManager = amqp.connect(connectionURLs, {
        json: true,
        heartbeatIntervalInSeconds: config.get('amqp.heartbeatIntervalInSeconds'),
        reconnectTimeInSeconds: config.get('amqp.reconnectTimeInSeconds'),
        connectionOptions: {
          clientProperties,
        },
      });
      this.connectionManager.on('connect', (c) => {
        console.log(
          `amqp connected to ${c.url} (${clientProperties ? clientProperties.connection_name : 'no hostname'})`,
        );
        this.this.neverConnected = false;
      });
      this.connectionManager.on('disconnect', ({ err }) => {
        console.warn(
          `amqp disconnected (${config.get('amqp.legacyHosts').join('|')}) (${
            clientProperties ? clientProperties.connection_name : 'no hostname'
          })`,
        );

        if (err) {
          console.warn(`amqp disconnect reason: ${err.message} ${err.stack} ${JSON.stringify(err)}`);
        }
      });
    }

    process.on('SIGHUP', () => {
      this.shuttingDown = true;
      this.connectionManager.close();
    });

    process.on('SIGINT', () => {
      this.shuttingDown = true;
      this.connectionManager.close();
    });

    process.on('SIGTERM', () => {
      this.shuttingDown = true;
      this.connectionManager.close();
    });
  }

  async isReachable() {
    if (this.shuttingDown) {
      console.info('amqp is shutting down');
      return false;
    }
    if (this.connectionManager.isConnected()) {
      return true;
    }
    if (this.this.neverConnected) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (this.connectionManager.isConnected()) {
        return true;
      }
      throw new Error('amqp did not connect yet');
    }
    throw new Error('amqp is not connected');
  }

  async workerQueue(queueName, exchange, bindings, handler, prefetch = 1) {
    const channelWrapper = this.connectionManager.createChannel({
      setup(channel) {
        return Promise.all([
          channel.assertExchange(exchange, 'topic', { durable: true }),
          channel.assertQueue(queueName, { durable: true }),
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
                    await channel.assertQueue(redirectQueue, { durable: true });
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

  async subscribe(queueNamePrefix, exchange, bindings, handler, options = {}) {
    const channelWrapper = this.connectionManager.createChannel({
      setup(channel) {
        const queueName = `${queueNamePrefix}-${uuid()}}`;
        let consumeOptions;
        if (options.noAck) {
          consumeOptions = { noAck: true };
        }
        return Promise.all([
          channel.assertExchange(exchange, 'topic', { durable: true }),
          channel.assertQueue(queueName, { durable: false, exclusive: true }),
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

  plainChannel(exchange, exchangeType = 'topic', durable = true) {
    if (typeof exchangeType === 'function') {
      console.error('plainChannel `channelCallback` has been removed in v0.8.0');
      exchangeType = 'topic';
    }
    return this.connectionManager.createChannel({
      setup(channel) {
        return channel.assertExchange(exchange, exchangeType, { durable });
      },
    });
  }

  async publishChannel(exchange, exchangeType, durable) {
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
}

let instance;
module.exports = () => {
  if (!instance) {
    instance = new LegacyAMQP();
  }
  return instance;
};
