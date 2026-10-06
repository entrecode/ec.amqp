const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createBroker } = require('./fake-connection-manager');

let current;
require.cache[require.resolve('amqp-connection-manager')] = {
  exports: { connect: () => current.connectionManager },
};
const { AmqpConnection } = require('../amqp');

const message = (content = { type: 'mail' }) => ({
  content: Buffer.from(JSON.stringify(content)),
  properties: { type: 'cmd', messageId: 'message-1' },
  fields: { redelivered: false },
});

const flush = () => new Promise(setImmediate);

async function startWorker(handler) {
  current = createBroker();
  const connection = new AmqpConnection({ hosts: ['localhost'] });
  const channelWrapper = await connection.workerQueue('sendMail-test', 'mail', ['cmd.sendMail.#'], handler);
  await channelWrapper.ready;
  return { broker: current.broker, deliver: current.broker.consumers.get('sendMail-test') };
}

describe('workerQueue', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  it('passes the parsed event and acks once', async () => {
    let received;
    const { broker, deliver } = await startWorker((event, properties, { ack }) => {
      received = { event, redelivered: properties.redelivered };
      ack();
      ack();
    });
    const msg = message();

    await deliver(msg);

    assert.deepEqual(received, { event: { type: 'mail' }, redelivered: false });
    assert.deepEqual(broker.acks, [msg]);
  });

  it('nacks after the timeout with the given requeue flag', async () => {
    const { broker, deliver } = await startWorker((event, properties, { nack }) => nack(5000, true));
    const msg = message();

    await deliver(msg);
    mock.timers.tick(4999);
    await flush();
    assert.deepEqual(broker.nacks, []);
    mock.timers.tick(1);
    await flush();

    assert.deepEqual(broker.nacks, [{ message: msg, requeue: true }]);
  });

  it('requeues after 10 s when the handler throws', async () => {
    const { broker, deliver } = await startWorker(() => {
      throw new Error('handler failed');
    });
    const msg = message();
    mock.method(console, 'error', () => {});

    await deliver(msg);
    mock.timers.tick(10000);
    await flush();

    assert.deepEqual(broker.nacks, [{ message: msg, requeue: true }]);
  });

  it('copies a redirected message into the redirect queue and does not requeue it', async () => {
    const { broker, deliver } = await startWorker((event, properties, { nack }) =>
      nack(10000, false, 'unfinished-mail'),
    );
    const msg = message();

    await deliver(msg);
    mock.timers.tick(10000);
    for (let i = 0; i < 5; i += 1) {
      await flush(); // eslint-disable-line no-await-in-loop
    }

    assert.deepEqual(broker.queues.get('unfinished-mail'), [msg.content]);
    assert.equal(
      broker.nacks.some(({ requeue }) => requeue),
      false,
    );
  });

  it('requeues the original when the broker refuses the redirect, without an unhandled rejection', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.prependListener('unhandledRejection', onUnhandled);
    const { broker, deliver } = await startWorker((event, properties, { nack }) =>
      nack(10000, false, 'unfinished-mail'),
    );
    broker.refuseWrite = () => true;
    mock.method(console, 'error', () => {});
    const msg = message();

    await deliver(msg);
    mock.timers.tick(10000);
    for (let i = 0; i < 5; i += 1) {
      await flush(); // eslint-disable-line no-await-in-loop
    }
    process.removeListener('unhandledRejection', onUnhandled);

    assert.deepEqual(broker.nacks, [{ message: msg, requeue: true }]);
    assert.deepEqual(broker.acks, []);
    assert.deepEqual(broker.queues.get('unfinished-mail'), []);
    assert.deepEqual(unhandled, []);
  });

  it('redirects on a separate channel with an error listener, never on the consumer channel', async () => {
    const { broker, deliver } = await startWorker((event, properties, { nack }) =>
      nack(10000, false, 'unfinished-mail'),
    );
    const [consumerChannel] = broker.channels;
    const consumerSend = mock.method(consumerChannel, 'sendToQueue');
    const consumerPublish = mock.method(consumerChannel, 'publish');

    await deliver(message());
    mock.timers.tick(10000);
    for (let i = 0; i < 5; i += 1) {
      await flush(); // eslint-disable-line no-await-in-loop
    }

    assert.equal(broker.channels.length, 2);
    assert.equal(broker.channels[1].listenerCount('error'), 1);
    assert.equal(consumerSend.mock.callCount() + consumerPublish.mock.callCount(), 0);
    assert.equal(broker.exchanges.get('unfinished-mail').type, 'direct');
  });

  it('acks the original after a confirmed redirect', async () => {
    const { broker, deliver } = await startWorker((event, properties, { nack }) =>
      nack(10000, false, 'unfinished-mail'),
    );
    const msg = message();

    await deliver(msg);
    mock.timers.tick(10000);
    for (let i = 0; i < 5; i += 1) {
      await flush(); // eslint-disable-line no-await-in-loop
    }

    assert.deepEqual(broker.acks, [msg]);
    assert.deepEqual(broker.nacks, []);
  });
});

describe('AmqpConnection.redirect', () => {
  it('retries a failed setup on the next redirect', async () => {
    current = createBroker();
    const connection = new AmqpConnection({ hosts: ['localhost'] });
    current.broker.failingSetups = 1;
    const msg = message();

    await assert.rejects(connection.redirect('unfinished-mail', msg), /ACCESS_REFUSED/);
    await connection.redirect('unfinished-mail', msg);

    assert.deepEqual(current.broker.queues.get('unfinished-mail'), [msg.content]);
  });
});
