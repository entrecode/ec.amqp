# ec.amqp

Syntactic sugar for RabbitMQ in Node.js. Wraps [amqp-connection-manager](https://github.com/jwalton/node-amqp-connection-manager) (which uses [amqplib](https://github.com/amqp-node/amqplib)) and adds opinionated helpers for common consume and publish patterns.

Supports connecting to **multiple clusters** simultaneously (since 0.17.0). Handles automatic reconnection, host shuffling, and graceful shutdown.

[AsyncAPI Events Documentation](https://entrecode.github.io/ec.amqp/)

## Quick Start

```js
const amqp = require('ec.amqp');

await amqp.isReachable();

amqp.workerQueue(
  'myService',
  'publicAPI',
  ['235af82b.mymodel.#'],
  async (event, properties, { ack, nack }) => {
    // process event...
    ack();
  }
);
```

The default connection reads credentials from [node-config](#configuration) and connects **lazily** on first use.

## Consuming

### Worker Queue

Durable [quorum queue](https://www.rabbitmq.com/docs/quorum-queues), shared across all workers. Each message is processed exactly once. If a worker goes offline, messages wait in the queue for another worker.

Use cases: sending emails, database updates -- anything that should happen exactly once.

```js
amqp.workerQueue(
  'myService',       // queue name
  'publicAPI',       // exchange (topic, durable)
  ['235af82b.mymodel.#'], // routing key bindings
  async (event, properties, { ack, nack }) => {
    // event: parsed JSON payload
    // properties: AMQP message properties + { redelivered: boolean }
    try {
      await processEvent(event);
      ack();
    } catch (err) {
      nack();             // nack after 10s (default), don't requeue
      nack(5000);         // nack after 5s, don't requeue
      nack(5000, true);   // nack after 5s, requeue
      nack(5000, false, 'myService-dead-letter'); // nack + redirect to dead-letter queue
    }
  },
  1, // prefetch (default: 1)
);
```

If the handler throws, the message is automatically nacked with requeue after 10s.

### Publish/Subscribe

Exclusive, non-durable queue per process. The queue only lives as long as the process lives. Useful for updating in-memory caches.

```js
amqp.subscribe(
  'myService',       // queue name prefix (suffixed with a UUID)
  'publicAPI',       // exchange
  ['235af82b.mymodel.#'], // routing key bindings
  async (event, properties, { ack, nack }) => {
    await updateCache(event);
    ack();
  },
  {
    // all options are optional:
    noAck: false,          // true: auto-ack, no need to call ack()/nack() (default: false)
    exchangeType: 'topic', // 'topic' | 'fanout' | 'direct' | 'headers' (default: 'topic')
    durableExchange: true, // default: true
    durableQueue: false,   // default: false
    exclusiveQueue: true,  // default: true
  },
);
```

## Publishing

### Publish Channel

Returns an async `publish` function that serializes JSON, generates a `messageId` and `timestamp`, and sets `persistent: true`.

```js
const publish = await amqp.publishChannel('myExchange');

await publish(
  'my.routing.key',  // routing key
  { foo: 'bar' },    // content (JSON, auto-stringified)
  'didStuff',        // type (optional)
  'myAppID',         // appId (optional)
  { timestamp },     // additional AMQP options to merge/override (optional)
);
```

Exchange type and durability can be configured: `amqp.publishChannel(exchange, 'fanout', false)` (defaults: `'topic'`, `true`).

### Plain Channel

Returns a raw `ChannelWrapper` from amqp-connection-manager for full control.

```js
const channel = amqp.plainChannel('myExchange');
const channel = amqp.plainChannel('myExchange', 'fanout', false);
```

## Multi-Cluster

Use `createConnection(name, options)` to connect to additional RabbitMQ clusters. Each connection is an independent `AmqpConnection` instance with the same methods as the default connection.

Pass an optional `name` as the first argument to register the connection. Retrieve it anywhere with `getConnection(name)`.

```js
// init.js -- create the connection once at startup
const amqp = require('ec.amqp');

amqp.createConnection('analytics', {
  hosts: ['analytics-rabbit.example.com'],
  user: 'analytics',
  password: 'secret',
  tls: true,
  vhost: 'analytics',
});
```

```js
// anywhere-else.js -- retrieve by name, no new connection created
const amqp = require('ec.amqp');
const analytics = amqp.getConnection('analytics');

analytics.workerQueue('analyticsQueue', 'events', ['#'], async (event, properties, { ack }) => {
  await storeAnalytics(event);
  ack();
});

const publish = await analytics.publishChannel('analyticsExchange');
await publish('my.routing.key', payload, 'didStuff', 'myAppID');
```

The name is optional -- `createConnection(options)` without a name works the same as before but the connection can only be used via the returned reference.

You can mix both: use the default connection from config and additional explicit connections. If you only use `createConnection()`, no default connection is opened.

### Connection Options


| Option                       | Type       | Default   | Description                                                          |
| ---------------------------- | ---------- | --------- | -------------------------------------------------------------------- |
| `hosts`                      | `string[]` | `[]`      | RabbitMQ hostnames (automatically shuffled for load balancing)       |
| `user`                       | `string`   | `'guest'` | RabbitMQ user                                                        |
| `password`                   | `string`   | `'guest'` | RabbitMQ password (special characters are URL-encoded automatically) |
| `tls`                        | `boolean`  | `false`   | Use `amqps://` instead of `amqp://`                                  |
| `vhost`                      | `string`   | `''`      | RabbitMQ vhost                                                       |
| `heartbeatIntervalInSeconds` | `number`   | `60`      | Heartbeat interval                                                   |
| `reconnectTimeInSeconds`     | `number`   | `10`      | Delay before reconnect attempt after disconnect                      |


## Configuration

The **default connection** uses [node-config](https://github.com/lorenwest/node-config). The module ships with configs for `default`, `stage`, `staging`, and `production` environments.

Override in your app's node-config:

```yaml
amqp:
  active: true
  user: search
  password: secret
  hosts:
    - host-1
    - host-2
  tls: true
  vhost: entrecode
  heartbeatIntervalInSeconds: 10
  reconnectTimeInSeconds: 5
```

### Environment Variables

All values can be set via environment variables:


| Variable                             | Format                                   |
| ------------------------------------ | ---------------------------------------- |
| `AMQP_ACTIVE`                        | `true` / `false`                         |
| `AMQP_USER`                          | string                                   |
| `AMQP_PASSWORD`                      | string                                   |
| `AMQP_HOSTS`                         | JSON array, e.g. `'["host-1","host-2"]'` |
| `AMQP_TLS`                           | `true` / `false`                         |
| `AMQP_VHOST`                         | string                                   |
| `AMQP_HEARTBEAT_INTERVAL_IN_SECONDS` | number                                   |
| `AMQP_RECONNECT_TIME_IN_SECONDS`     | number                                   |


### Testing / Local Development

Set `NODE_ENV=testing` or `amqp.active: false` in config. The default connection returns a no-op mock instead of connecting. Connections created via `createConnection()` are not affected.

Config only applies to the default connection. Connections created via `createConnection(options)` use options directly and ignore node-config.

## API Reference

### Module-level (default connection)

All functions use the default connection from config, opened lazily on first call.


| Function                                                             | Returns                   | Description                                                                           |
| -------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `isReachable()`                                                      | `Promise<boolean>`        | `true` if connected, throws otherwise. Waits up to 2s on first connect.               |
| `workerQueue(queueName, exchange, bindings, handler[, prefetch])`    | `Promise<ChannelWrapper>` | Consume from a durable quorum queue (worker pattern).                                 |
| `subscribe(queueNamePrefix, exchange, bindings, handler[, options])` | `Promise<ChannelWrapper>` | Consume from an exclusive queue (pub/sub pattern).                                    |
| `publishChannel(exchange[, exchangeType, durable])`                  | `Promise<function>`       | Get a `publish(routingKey, content, type, appID, options)` function.                  |
| `plainChannel(exchange[, exchangeType, durable])`                    | `ChannelWrapper`          | Get a raw channel wrapper.                                                            |
| `connectionManager`                                                  | `AmqpConnectionManager`   | The underlying amqp-connection-manager instance (lazy, triggers connect).             |
| `gracefulShutdown()`                                                 | `Promise<void>`           | Close **all** connections (default + all created via `createConnection`).             |
| `createConnection([name,] options)`                                  | `AmqpConnection`          | Create a new connection, optionally registered under `name`.                         |
| `getConnection(name)`                                                | `AmqpConnection`          | Retrieve a named connection created with `createConnection(name, options)`.          |


### AmqpConnection

Returned by `createConnection()`. Has the same consume/publish methods:


| Method / Property                                                    | Returns                   | Description                                      |
| -------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| `isReachable()`                                                      | `Promise<boolean>`        | `true` if connected, throws otherwise.           |
| `workerQueue(queueName, exchange, bindings, handler[, prefetch])`    | `Promise<ChannelWrapper>` | Consume from a durable quorum queue.             |
| `subscribe(queueNamePrefix, exchange, bindings, handler[, options])` | `Promise<ChannelWrapper>` | Consume from an exclusive queue.                 |
| `publishChannel(exchange[, exchangeType, durable])`                  | `Promise<function>`       | Get a publish function.                          |
| `plainChannel(exchange[, exchangeType, durable])`                    | `ChannelWrapper`          | Get a raw channel wrapper.                       |
| `connectionManager`                                                  | `AmqpConnectionManager`   | The underlying amqp-connection-manager instance. |
| `close()`                                                            | `Promise<void>`           | Close this individual connection.                |


### Handler Signature

Both `workerQueue` and `subscribe` call the handler with:

```js
async (event, properties, { ack, nack }) => { ... }
```

- `**event**` -- parsed JSON message body
- `**properties**` -- AMQP message properties (`type`, `appId`, `messageId`, `timestamp`, ...). In `workerQueue`, also includes `redelivered: boolean`.
- `**ack()**` -- acknowledge the message
- `**nack(timeout?, requeue?, redirectQueue?)**` -- negative-acknowledge after `timeout` ms (default: 10000). `requeue` (default: `false` for workerQueue, N/A for subscribe). `redirectQueue`: optional queue name to redirect the message to before nacking.

## Graceful Shutdown

All connections are automatically closed on `SIGTERM`, `SIGINT`, `SIGHUP`, `uncaughtException`, `unhandledRejection`, and `beforeExit`. Individual connections can also be closed via `connection.close()`.

## Changelog

### 0.17.0

- Multi-cluster support: `createConnection(options)` to connect to additional RabbitMQ clusters
- Lazy default connection: no longer opens at `require()` time, connects on first use
- `gracefulShutdown()` now closes all connections
- Backward-compatible: existing code works without changes

### 0.16.x

- BREAKING CHANGE: Support for CloudAMQP clusters with virtual hosts
- Error handling for connection errors

### 0.15.x

- Graceful shutdown on process signals (SIGTERM, SIGINT, SIGHUP)
- Exported `gracefulShutdown()` function

### 0.14.0

- `amqps://` support via `AMQP_TLS` config
- URL-encoding for special characters in passwords

### 0.13.0

- Added staging environment config

### 0.12.0

- BREAKING: Removed `amqp.getLegacyAMQP()`

### 0.11.0

- BREAKING: Support for new k8s RabbitMQ clusters

### 0.10.x

- Config settable via env variables
- Shutting-down flag for `isReachable()`

### 0.9.x

- Configurable `heartbeatIntervalInSeconds` and `reconnectTimeInSeconds`
- Connection metadata (hostname, pid, product, version) in RabbitMQ
- BREAKING: Dropped Node 6/8 support

### 0.8.x

- Exchange type and durable options for `plainChannel` / `publishChannel`
- BREAKING: Removed callback from `plainChannel(exchange)`

### 0.7.x

- Respect `active: false` in config
- BREAKING: Default config for enderby environment

