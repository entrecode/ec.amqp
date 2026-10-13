// Runs one drain scenario against amqp.js with a fake amqp-connection-manager and prints a JSON report.
const path = require('path');

const events = [];
const t0 = Date.now();
const record = (what) => events.push({ what, at: Date.now() - t0 });

const consumers = [];
const fakeChannel = {
  assertExchange: async () => undefined,
  assertQueue: async () => ({}),
  prefetch: async () => undefined,
  bindQueue: async () => undefined,
  consume: async (queue, onMessage) => {
    consumers.push(onMessage);
  },
};
const fakeManager = {
  on: () => undefined,
  isConnected: () => true,
  createChannel({ setup }) {
    const wrapper = {
      ack: (message) => record(`ack ${JSON.parse(message.content)}`),
      nack: (message, allUpTo, requeue) => record(`nack ${JSON.parse(message.content)} requeue=${requeue}`),
    };
    setup.call({}, fakeChannel);
    return wrapper;
  },
  close: async () => record('closed'),
};
const managerPath = require.resolve('amqp-connection-manager');
require.cache[managerPath] = { id: managerPath, filename: managerPath, loaded: true, exports: { connect: () => fakeManager } };

const amqp = require(path.resolve(__dirname, '../../amqp.js'));

const deliver = (content) =>
  consumers[0]({ content: Buffer.from(JSON.stringify(content)), properties: {}, fields: { redelivered: false } });

async function main() {
  const scenario = process.argv[2];
  const connection = amqp.createConnection({ hosts: ['fake'] });
  await connection.workerQueue('queue', 'exchange', ['#'], async (event, properties, { ack }) => {
    record(`start ${event}`);
    if (event === 'forever') {
      await new Promise(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    record(`done ${event}`);
    ack();
  });
  await new Promise((resolve) => setImmediate(resolve));

  if (scenario === 'drain') {
    deliver('a');
    const shutdown = amqp.gracefulShutdown({ drainTimeoutMs: 2000 }).then(() => record('shutdown resolved'));
    deliver('b');
    await shutdown;
    await new Promise((resolve) => setTimeout(resolve, 1200)); // requeue of b is delayed
  } else if (scenario === 'timeout') {
    deliver('forever');
    await amqp.gracefulShutdown({ drainTimeoutMs: 200 }).then(() => record('shutdown resolved'));
  } else if (scenario === 'signal') {
    deliver('a');
    process.kill(process.pid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 600));
  } else if (scenario === 'immediate') {
    deliver('a');
    await amqp.gracefulShutdown().then(() => record('shutdown resolved'));
  }
  process.stdout.write(`${JSON.stringify(events)}\n`);
  process.exit(0);
}

main();
