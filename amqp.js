/* eslint-disable prefer-object-spread */
process.env.SUPPRESS_NO_CONFIG_WARNING = 'y';
process.env.ALLOW_CONFIG_MUTATIONS = 'y';

const path = require('path');
const config = require('config');
const amqpManager = require('amqp-connection-manager');
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

const connectionRegistry = new Set();
const namedConnections = new Map();

class AmqpConnection {
  constructor(options = {}) {
    this._shuttingDown = false;
    this._neverConnected = true;
    this._logLabel = options.connectionName ? `[ec.amqp:${options.connectionName}]` : '[ec.amqp]';

    const {
      hosts = [],
      user = 'guest',
      password = 'guest',
      tls = false,
      vhost = '',
      heartbeatIntervalInSeconds = 60,
      reconnectTimeInSeconds = 10,
    } = options;

    const encodedUser = encodeURIComponent(user);
    const encodedPassword = encodeURIComponent(password);
    const vhostPath = vhost ? `/${encodeURIComponent(vhost)}` : '';
    const connectionURLs = shuffleArray(
      hosts.map((host) => `amqp${tls ? 's' : ''}://${encodedUser}:${encodedPassword}@${host}${vhostPath}`),
    );

    const redactedURLs = connectionURLs.map((url) => url.replace(/\/\/[^@]+@/, '//***:***@'));
    console.log(this._logLabel, 'trying to connect...', JSON.stringify({ connectionURLs: redactedURLs }));

    let clientProperties;
    if (process.env.HOSTNAME) {
      clientProperties = {
        connection_name: `${process.env.HOSTNAME}-${process.pid}`,
        product,
        version,
      };
    }

    this._connectionManager = amqpManager.connect(connectionURLs, {
      json: true,
      heartbeatIntervalInSeconds,
      reconnectTimeInSeconds,
      connectionOptions: {
        clientProperties,
      },
    });

    this._connectionManager.on('connect', (c) => {
      console.log(
        this._logLabel,
        `connected to ${c.url.replace(/\/\/[^@]+@/, '//***:***@')} (${clientProperties ? clientProperties.connection_name : 'no hostname'})`,
      );
      this._neverConnected = false;
    });
    this._connectionManager.on('connectFailed', (err) => {
      console.error(this._logLabel, 'connect failed:', err);
    });
    this._connectionManager.on('disconnect', ({ err }) => {
      console.warn(
        this._logLabel,
        `disconnected (${hosts.join('|')}) (${clientProperties ? clientProperties.connection_name : 'no hostname'})`,
      );
      if (err) {
        console.warn(this._logLabel, 'disconnect reason:', err.message, err.stack, JSON.stringify(err));
      }
    });

    connectionRegistry.add(this);
  }

  get connectionManager() {
    return this._connectionManager;
  }

  async isReachable() {
    if (this._shuttingDown) {
      console.info(this._logLabel, 'is shutting down');
      return false;
    }
    if (this._connectionManager.isConnected()) {
      return true;
    }
    if (this._neverConnected) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (this._connectionManager.isConnected()) {
        return true;
      }
      throw new Error('amqp did not connect yet');
    }
    throw new Error('amqp is not connected');
  }

  async workerQueue(queueName, exchange, bindings, handler, prefetch = 1) {
    const channelWrapper = this._connectionManager.createChannel({
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
              const nack = (timeout = 10000, requeue = false, redirectQueue) => {
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
              };
              const logLabel = this._logLabel;
              try {
                await handler(event, properties, {
                  ack,
                  nack,
                });
              } catch (err) {
                console.error(logLabel, 'workerQueue handler error:', err);
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
    const channelWrapper = this._connectionManager.createChannel({
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
            arguments: {
              'x-queue-type': 'classic',
            },
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
              const nack = (timeout = 10000) => {
                setTimeout(() => {
                  channelWrapper.nack(message);
                }, timeout);
              };
              const logLabel = this._logLabel;
              try {
                await handler(event, message.properties, {
                  ack,
                  nack,
                });
              } catch (err) {
                console.error(logLabel, 'subscribe handler error:', err);
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
      console.error(this._logLabel, 'plainChannel `channelCallback` has been removed in v0.8.0');
      exchangeType = 'topic'; // eslint-disable-line no-param-reassign
    }
    return this._connectionManager.createChannel({
      setup(channel) {
        return channel.assertExchange(exchange, exchangeType, { durable });
      },
    });
  }

  async publishChannel(exchange, exchangeType, durable) {
    const channelWrapper = this.plainChannel(exchange, exchangeType, durable);
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

  async close() {
    if (this._shuttingDown) {
      return Promise.resolve();
    }
    this._shuttingDown = true;
    return this._connectionManager.close().catch((err) => {
      console.error(this._logLabel, 'Error during graceful shutdown:', err);
    });
  }
}

function createConnection(name, options) {
  const opts = typeof name === 'object' ? name : options;
  const useMock =
    process.env.NODE_ENV === 'testing' || (opts && opts.active === false);

  if (useMock) {
    const mock = createMockConnection(typeof name === 'object' ? undefined : name);
    if (typeof name === 'object') {
      return mock;
    }
    if (namedConnections.has(name)) {
      throw new Error(`ec.amqp: connection "${name}" already exists`);
    }
    namedConnections.set(name, mock);
    return mock;
  }
  if (typeof name === 'object') {
    return new AmqpConnection(name);
  }
  if (namedConnections.has(name)) {
    throw new Error(`ec.amqp: connection "${name}" already exists`);
  }
  const connection = new AmqpConnection({ ...options, connectionName: name });
  namedConnections.set(name, connection);
  return connection;
}

function getConnection(name) {
  const connection = namedConnections.get(name);
  if (!connection) {
    throw new Error(
      `ec.amqp: connection "${name}" not found. Create it first with createConnection("${name}", options).`,
    );
  }
  return connection;
}

function createMockConnection(connectionName) {
  const logLabel = connectionName ? `[ec.amqp:${connectionName}]` : '[ec.amqp]';
  console.warn(logLabel, 'ec.amqp is in testing mode and not attempting to connect to RabbitMQ.');
  const mockConnectionManager = {
    isConnected: () => true,
    createChannel: () => ({ publish: () => {}, addSetup: () => Promise.resolve() }),
    close: () => Promise.resolve(),
  };
  return {
    _shuttingDown: false,
    connectionManager: mockConnectionManager,
    isReachable: () => Promise.resolve(true),
    workerQueue: () => Promise.resolve(mockConnectionManager.createChannel()),
    subscribe: () => Promise.resolve(mockConnectionManager.createChannel()),
    plainChannel: () => mockConnectionManager.createChannel(),
    publishChannel: () => Promise.resolve(() => {}),
    close() {
      if (this._shuttingDown) return Promise.resolve();
      this._shuttingDown = true;
      return this.connectionManager.close().catch((err) => {
        console.error(logLabel, 'Error during graceful shutdown:', err);
      });
    },
  };
}

const isTesting =
  process.env.NODE_ENV === 'testing' || (config.has('amqp.active') && config.get('amqp.active') === false);

let defaultConnection;

function getDefaultConnection() {
  if (!defaultConnection) {
    if (isTesting) {
      defaultConnection = createMockConnection('default');
    } else {
      defaultConnection = createConnection({
        connectionName: 'default',
        hosts: config.get('amqp.hosts'),
        user: config.get('amqp.user'),
        password: config.get('amqp.password'),
        tls: config.get('amqp.tls'),
        vhost: config.has('amqp.vhost') ? config.get('amqp.vhost') : '',
        heartbeatIntervalInSeconds: config.get('amqp.heartbeatIntervalInSeconds'),
        reconnectTimeInSeconds: config.get('amqp.reconnectTimeInSeconds'),
      });
    }
  }
  return defaultConnection;
}

async function gracefulShutdown() {
  const promises = [...connectionRegistry].map((conn) => conn.close());
  if (defaultConnection && !connectionRegistry.has(defaultConnection)) {
    promises.push(defaultConnection.close());
  }
  await Promise.all(promises);
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
  console.log('[ec.amqp] uncaughtException received.', err);
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

const moduleExports = {
  isReachable: (...args) => getDefaultConnection().isReachable(...args),
  workerQueue: (...args) => getDefaultConnection().workerQueue(...args),
  subscribe: (...args) => getDefaultConnection().subscribe(...args),
  plainChannel: (...args) => getDefaultConnection().plainChannel(...args),
  publishChannel: (...args) => getDefaultConnection().publishChannel(...args),
  gracefulShutdown,
  createConnection,
  getConnection,
  AmqpConnection,
};

Object.defineProperty(moduleExports, 'connectionManager', {
  get: () => getDefaultConnection().connectionManager,
  enumerable: true,
});

module.exports = moduleExports;
