# ec.amqp
simple access to entrecode RabbitMQ via node.js

# AsyncAPI Events Documentation

is found here: https://entrecode.github.io/ec.amqp/ 

## Consume Patterns

Basically, there are two patterns we generally use for consuming RabbitMQ Events: Worker Queue and Publish/Subscribe.

### Worker Queue

Mostly used: events are in a non-exclusive, persisted queue. Every event is processed exactly once from any worker process.
If worker processes go offline, the events wait in the queue and are processed from another process.

Use cases are: sending emails, updating a database. Generally spoken: stuff that is stored globally and therefore events should only processed once.

### Publish/Subscribe

Events are in an exclusive queue per process. The queue is non-persisting and only lives as long as the process lives. Useful for updating in-memory data in processes. 

## Other Usages

### Publish Channel

To publish messages, call `amqp.publishChannel(exchange)`. You'll get back an async function `publish(routingKey, content, type, appID, options)`. This is a helper function for publishing messages. `content` is expected to be JSON which
will be stringified and put in a Buffer in the function. A `messageId` and `timestamp` will be generated automatically. `type`, `appID` and `options` are optional. 
The exchange type and durability can be set optionally: `amqp.publishChannel(exchange, 'fanout', false)` (default is `'topic'` and `true`).

### Plain Channel

If you just want a `ChannelWrapper` to do anything you want with, you can call `amqp.plainChannel(exchange)`. This returns immediately. The exchange type and durability can be set optionally: `amqp.plainChannel(exchange, 'fanout', false)` (default is `'topic'` and `true`).

## Usage Example

```js
const amqp = require('ec.amqp');

// for health checks:
await amqp.isReachable(); // true if connected, throws if error

// consume worker queue pattern:
amqp.workerQueue(
  'myService',
  'publicAPI',
  ['235af82b.mymodel.#'],
  async (event, properties, {ack, nack}) => {
    const eventType = properties.type;
    // event is parsed payload
    ack(); // always call ack() or nack()
    nack(10000) // call nack after timeout of 10 seconds. This is also the default. Second parameter requeue (default is `false` in contrast to amqplib native behavior), third parameter redirect queue (for dead-letter queues)
  },
  1 // prefetch (default 1)
);

// consume pub/sub pattern:
amqp.subscribe(
  'myService',
  'publicAPI',
  ['235af82b.mymodel.#'],
  async (event, properties, {ack, nack}) => {
    const eventType = properties.type;
    // event is parsed payload
    ack(); // always call ack() or nack(), if you don't have noAck property set
    nack(10000) // call nack after timeout of 10 seconds. This is also the default
  },
  {
    noAck: true // options object is optional
    exchangeType: 'fanout', // default is 'topic'
  }
)

// publish:
const publish = await amqp.publishChannel('myExchange');

publish('my.routing.key', contentJSON, 'didStuff', 'myAppID', { timestamp });
// options object is optional and can be used to overwrite defaults.
```

### Example Event

```js
{
  "entryID": "NJfFl_59j",
  "modelID": "5dd6bf21-a104-4942-94f4-8da9ca8c8b51",
  "private": false,
  "locale": "",
  "data": {
    "food": "VJlWJDMQo",
    "quantity": 2,
    "amount": null,
    "_creator": null,
    "creator": null
  },
  "syncID": null,
  "entryAndAssetRelations": [
    {
      "sourceEntry": "NJfFl_59j",
      "sourceLocale": "",
      "sourceField": "food",
      "targetEntry": "VJlWJDMQo",
      "validation": "food"
    }
  ],
  "roleRelations": [],
  "uniqueFields": [],
  "readOnlyChecked": true,
  "modelTitle": "ingredient",
  "dataManagerID": "fc8aff95-fd00-4f98-ac06-61659b48657b",
  "shortID": "36c4b413",
  "user": {
    "accountID": "61afae15-8685-4d06-83bc-87e827ebb3d1",
    "userType": "ecUser"
  },
  "oldEntryData": {
    "quantity": 1
  },
  "modified": "2018-07-16T06:54:26.756Z",
  "hash": null
}
```

## Custom Config
The module uses [node-config](https://github.com/lorenwest/node-config) internally. It brings default amqp configuration for `default`, `stage` and `production` NODE_ENVs. 
You can overwrite the config by providing a node-config in your app:

```yaml
amqp:
  active: true
  user: search
  password: secret
  hosts:
    - host-1
    - host-2
  heartbeatIntervalInSeconds: 10
  reconnectTimeInSeconds: 5
```

All values can also be set as environment variables, like `AMQP_HEARTBEAT_INTERVAL_IN_SECONDS` and `AMQP_RECONNECT_TIME_IN_SECONDS`.
See [./config/custom-environment-variables.yml](./config/custom-environment-variables.yml) for details.

User and password are required, uses "guest" otherwise.
Hosts are permuted automatically.

For local usage, set `NODE_ENV` = `testing` or `active: false` in the config. A missing `active` configuration is equivalent to `active: true`.

## API

### async #.isReachable() 
returns `true` if amqp is connected, throws an Error otherwise.

### async #.workerQueue(queueName, exchange, bindings, handler)

### async #.subscribe(queueNamePrefix, exchange, bindings, handler[, options])

### async #.connectionManager
reference to the underlying amqp-connection-manager object. Only for legacy adaptors. 

# Changelog

## 0.12.0
- BREAKING: Removed `amqp.getLegacyAMQP()`. You must use new cluster now.

## 0.11.0
- BREAKING: Support for new k8s RabbitMQ Clusters
- For legacy cluster use `amqp.getLegacyAMQP()` to get the instance for the old cluster (Use `config.amqp.disableNewCluster` to disable new cluster when using legacy cluster)

## 0.10.2
- adds flag to indicate if server is shutting down

## 0.10.1
- make all config settable als env variables, for easy usage with Next.js projects

## 0.10.0
- dependency update

## 0.9.1
- make `heartbeatIntervalInSeconds` and `reconnectTimeInSeconds` settable, using config or env variables
- write hostname and pid in `connection_name` field in RabbitMQ for better recognition of connections
- set product and version in RabbitMQ connection metadata to ec.amqp values
- update amqplib
## 0.9.0
- BREAKING: drop support for node 6 and node 8 (because of [amqp-connection-manager@3](https://github.com/jwalton/node-amqp-connection-manager/blob/master/CHANGELOG.md#300-2019-07-04) - it probably still works)
## 0.8.2
- added exchange type and durable options for plain channels and publish channels
## 0.8.1
- dependency update
## 0.8.0
- channel setup with recommended parallel promises
- BREAKING: removed callback from `#plainChannel(exchange)`

## 0.7.1
- respect `active: false` in config

## 0.7.0
- BREAKING: default config is now for enderby environment
