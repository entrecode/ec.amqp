const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

function runScenario(name, env = {}) {
  const output = execFileSync(process.execPath, [path.resolve(__dirname, 'fixtures/drain-scenario.js'), name], {
    env: { ...process.env, NODE_ENV: 'development', ...env },
  });
  const events = JSON.parse(output.toString().trim().split('\n').pop());
  const at = (what) => {
    const event = events.find((e) => e.what === what);
    assert.ok(event, `expected "${what}" in ${JSON.stringify(events)}`);
    return event.at;
  };
  return { events, at };
}

test('drain: waits for the running handler, requeues new messages, then closes', () => {
  const { events, at } = runScenario('drain');

  assert.ok(at('done a') <= at('closed'), 'connection closed before the handler finished');
  assert.ok(at('closed') <= at('shutdown resolved'));
  assert.ok(!events.some((e) => e.what === 'start b'), 'handler ran for a message that arrived while draining');
  at('nack b requeue=true');
  at('ack a');
});

test('drain: closes after the timeout even if a handler never finishes', () => {
  const { at } = runScenario('timeout');

  assert.ok(at('closed') >= 150, 'closed before the drain timeout');
  assert.ok(at('closed') < 1500);
});

test('without drain timeout the connection is closed right away (previous behaviour)', () => {
  const { events, at } = runScenario('immediate');

  at('start a');
  const done = events.find((e) => e.what === 'done a');
  assert.ok(!done || at('closed') < done.at, 'waited for the handler although no drain timeout was set');
});

test('SIGTERM drains when AMQP_SHUTDOWN_DRAIN_TIMEOUT_MS is set', () => {
  const { at } = runScenario('signal', { AMQP_SHUTDOWN_DRAIN_TIMEOUT_MS: '2000' });

  assert.ok(at('done a') <= at('closed'), 'connection closed before the handler finished');
});
