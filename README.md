# ec.amqp
simple access to entrecode RabbitMQ via node.js

## Consume Patterns

Basically, there are two patterns we generally use for consuming RabbitMQ Events: Worker Queue and Publish/Subscribe.

### Worker Queue

Mostly used: events are in a non-exclusive, persisted queue. Every event is processed exactly once from any worker process.
If worker processes go offline, the events wait in the queue and are processed from another process.

Use cases are: sending emails, updating a database. Generally spoken: stuff that is stored globally and therefore events should only processed once.

### Publish/Subscribe

Events are in an exclusive queue per process. The queue is non-persisting and only lives as long as the process lives. Useful for updating in-memory data in processes. 

## Publish
Sending messages via this lib is not yet implemented.


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
    nack(10000) // call nack after timeout of 10 seconds. This is also the default. Second parameter requeue, third parameter redirect queue (for dead-letter queues)
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
  user: search
  password: search
  hosts:
    - host-1
    - host-2
```
User and password are required, uses "guest" otherwise.
Hosts are permuted automatically.

## API

### async #.isReachable() 
returns `true` if amqp is connected, throws an Error otherwise.

### async #.workerQueue(queueName, exchange, bindings, handler)

### async #.subscribe(queueNamePrefix, exchange, bindings, handler[, options])

