const EventEmitter = require('events');

// In-memory stand-in for amqp-connection-manager: routes publishes through declared exchanges and bindings,
// so tests can check where a message ends up without depending on how it was sent.
function createBroker() {
  const broker = {
    exchanges: new Map([['', { type: 'direct', bindings: [] }]]),
    queues: new Map(),
    consumers: new Map(),
    acks: [],
    nacks: [],
    channels: [],
    refuseWrite: () => false,
    failingSetups: 0,
  };

  const route = (exchange, routingKey, content) => {
    if (exchange === '') {
      broker.queues.get(routingKey).push(content);
      return;
    }
    broker.exchanges
      .get(exchange)
      .bindings.filter(({ key }) => key === routingKey)
      .forEach(({ queue }) => broker.queues.get(queue).push(content));
  };

  const fakeChannel = {
    assertExchange: async (name, type) => {
      if (!broker.exchanges.has(name)) {
        broker.exchanges.set(name, { type, bindings: [] });
      }
    },
    assertQueue: async (name) => {
      if (!broker.queues.has(name)) {
        broker.queues.set(name, []);
      }
    },
    bindQueue: async (queue, exchange, key) => {
      const { bindings } = broker.exchanges.get(exchange);
      if (!bindings.some((binding) => binding.queue === queue && binding.key === key)) {
        bindings.push({ queue, key });
      }
    },
    prefetch: async () => {},
    consume: async (queue, callback) => {
      broker.consumers.set(queue, callback);
    },
  };

  class FakeChannelWrapper extends EventEmitter {
    constructor({ setup } = {}) {
      super();
      // like amqp-connection-manager: setup functions run with the channel wrapper as `this`
      this.ready = setup ? Promise.resolve(setup.call(this, fakeChannel)) : Promise.resolve();
      broker.channels.push(this);
    }

    addSetup(setup) {
      if (broker.failingSetups > 0) {
        broker.failingSetups -= 1;
        return Promise.reject(new Error('ACCESS_REFUSED'));
      }
      return Promise.resolve(setup.call(this, fakeChannel));
    }

    ack(message) {
      broker.acks.push(message);
    }

    nack(message, allUpTo, requeue) {
      broker.nacks.push({ message, requeue });
    }

    async sendToQueue(queue, content) {
      if (broker.refuseWrite('')) {
        throw new Error('Channel closed');
      }
      route('', queue, content);
      return true;
    }

    async publish(exchange, routingKey, content) {
      if (broker.refuseWrite(exchange)) {
        throw new Error('Channel closed');
      }
      route(exchange, routingKey, content);
      return true;
    }
  }

  const connectionManager = {
    on: () => {},
    isConnected: () => true,
    createChannel: (options) => new FakeChannelWrapper(options),
    close: async () => {},
  };

  return { broker, connectionManager };
}

module.exports = { createBroker };
