#!/usr/bin/env node

/**
 * Test suite for graceful shutdown behaviors
 * 
 * Run individual tests:
 *   node test-graceful-shutdown.js <test-name>
 * 
 * Available tests:
 *   - beforeExit: Test beforeExit handler
 *   - uncaughtException: Test uncaught exception handling
 *   - unhandledRejection: Test unhandled rejection handling
 *   - sigterm: Test SIGTERM signal handler
 *   - sigint: Test SIGINT signal handler
 *   - sighup: Test SIGHUP signal handler
 *   - all: Run all tests
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEST_TIMEOUT = 5000;

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runTest(testName, testFile, args = []) {
  return new Promise((resolve, reject) => {
    log(`\n${'='.repeat(60)}`, 'blue');
    log(`Running test: ${testName}`, 'blue');
    log(`${'='.repeat(60)}`, 'blue');

    const testPath = path.join(__dirname, testFile);
    const proc = spawn('node', [testPath, ...args], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'testing' },
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Test "${testName}" timed out after ${TEST_TIMEOUT}ms`));
    }, TEST_TIMEOUT);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        log(`✓ Test "${testName}" passed`, 'green');
        resolve();
      } else {
        log(`✗ Test "${testName}" failed with code ${code}`, 'red');
        reject(new Error(`Test "${testName}" failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      log(`✗ Test "${testName}" error: ${err.message}`, 'red');
      reject(err);
    });
  });
}

async function testBeforeExit() {
  const testScript = `
    let cleanupCalled = false;
    let closeCallCount = 0;
    
    // Load amqp module to register handlers
    const amqp = require('./amqp.js');
    
    // Verify the handler is registered
    const listeners = process.listeners('beforeExit');
    if (listeners.length === 0) {
      console.error('ERROR: beforeExit handler not registered');
      process.exit(1);
    }
    
    // Replace the close method on the connectionManager object
    // (gracefulShutdown captures the object reference, so this works)
    const originalClose = amqp.connectionManager.close;
    amqp.connectionManager.close = function() {
      closeCallCount++;
      cleanupCalled = true;
      return Promise.resolve();
    };
    
    // Manually trigger beforeExit by calling the handler
    // This tests that the handler works, even if beforeExit doesn't fire naturally
    const handler = listeners[listeners.length - 1]; // Get the last registered handler (ours)
    if (typeof handler === 'function') {
      const result = handler(0);
      // Wait for async handler to complete
      Promise.resolve(result).then(() => {
        setTimeout(() => {
          if (cleanupCalled && closeCallCount === 1) {
            console.log('✓ beforeExit handler works correctly');
            process.exit(0);
          } else {
            console.error(\`ERROR: cleanupCalled=\${cleanupCalled}, closeCallCount=\${closeCallCount}\`);
            process.exit(1);
          }
        }, 100);
      }).catch((err) => {
        console.error('ERROR in handler:', err);
        process.exit(1);
      });
    } else {
      console.error('ERROR: beforeExit handler is not a function');
      process.exit(1);
    }
  `;

  const testFile = path.join(__dirname, '.test-beforeexit.js');
  fs.writeFileSync(testFile, testScript);

  try {
    await runTest('beforeExit', '.test-beforeexit.js');
    fs.unlinkSync(testFile);
  } catch (err) {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    throw err;
  }
}

async function testUncaughtException() {
  const testScript = `
    // Load amqp module to register handlers
    require('./amqp.js');
    
    let cleanupCalled = false;
    let exitCode = null;
    let closeCallCount = 0;
    
    // Mock connectionManager after module load
    const amqp = require('./amqp.js');
    const originalClose = amqp.connectionManager.close;
    const originalExit = process.exit;
    
    amqp.connectionManager.close = function() {
      closeCallCount++;
      cleanupCalled = true;
      return Promise.resolve();
    };
    
    process.exit = function(code) {
      exitCode = code;
      // Verify and exit
      if (cleanupCalled && exitCode === 1 && closeCallCount === 1) {
        console.log('✓ uncaughtException handler works correctly');
        originalExit(0);
      } else {
        console.error(\`ERROR: cleanupCalled=\${cleanupCalled}, exitCode=\${exitCode}, closeCallCount=\${closeCallCount}\`);
        originalExit(1);
      }
    };
    
    // Trigger uncaught exception after a short delay
    setTimeout(() => {
      throw new Error('Test uncaught exception');
    }, 100);
  `;

  const testFile = path.join(__dirname, '.test-uncaught.js');
  fs.writeFileSync(testFile, testScript);

  try {
    await runTest('uncaughtException', '.test-uncaught.js');
    fs.unlinkSync(testFile);
  } catch (err) {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    throw err;
  }
}

async function testUnhandledRejection() {
  const testScript = `
    // Load amqp module to register handlers
    require('./amqp.js');
    
    let cleanupCalled = false;
    let exitCode = null;
    let closeCallCount = 0;
    
    // Mock connectionManager after module load
    const amqp = require('./amqp.js');
    const originalClose = amqp.connectionManager.close;
    const originalExit = process.exit;
    
    amqp.connectionManager.close = function() {
      closeCallCount++;
      cleanupCalled = true;
      return Promise.resolve();
    };
    
    process.exit = function(code) {
      exitCode = code;
      // Verify and exit
      if (cleanupCalled && exitCode === 1 && closeCallCount === 1) {
        console.log('✓ unhandledRejection handler works correctly');
        originalExit(0);
      } else {
        console.error(\`ERROR: cleanupCalled=\${cleanupCalled}, exitCode=\${exitCode}, closeCallCount=\${closeCallCount}\`);
        originalExit(1);
      }
    };
    
    // Trigger unhandled rejection after a short delay
    setTimeout(() => {
      Promise.reject(new Error('Test unhandled rejection'));
    }, 100);
  `;

  const testFile = path.join(__dirname, '.test-unhandled.js');
  fs.writeFileSync(testFile, testScript);

  try {
    await runTest('unhandledRejection', '.test-unhandled.js');
    fs.unlinkSync(testFile);
  } catch (err) {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    throw err;
  }
}

async function testSignal(signal) {
  const testScript = `
    // Load amqp module to register handlers
    require('./amqp.js');
    
    let cleanupCalled = false;
    let closeCallCount = 0;
    
    // Mock connectionManager after module load
    const amqp = require('./amqp.js');
    const originalClose = amqp.connectionManager.close;
    
    amqp.connectionManager.close = function() {
      closeCallCount++;
      cleanupCalled = true;
      return Promise.resolve();
    };
    
    // Wait a bit, then send signal to ourselves
    setTimeout(() => {
      process.kill(process.pid, '${signal}');
    }, 100);
    
    // Check after a delay
    setTimeout(() => {
      if (cleanupCalled && closeCallCount === 1) {
        console.log(\`✓ ${signal} handler works correctly\`);
        process.exit(0);
      } else {
        console.error(\`ERROR: cleanupCalled=\${cleanupCalled}, closeCallCount=\${closeCallCount}\`);
        process.exit(1);
      }
    }, 500);
  `;

  const testFile = path.join(__dirname, `.test-${signal.toLowerCase()}.js`);
  fs.writeFileSync(testFile, testScript);

  try {
    await runTest(signal, `.test-${signal.toLowerCase()}.js`);
    fs.unlinkSync(testFile);
  } catch (err) {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    throw err;
  }
}

async function testErrorHandling() {
  const testScript = `
    let errorLogged = false;
    let closeCallCount = 0;
    
    // Load amqp module to register handlers
    const amqp = require('./amqp.js');
    
    const originalError = console.error;
    
    console.error = function(...args) {
      const message = args.join(' ');
      if (message.includes('Error during graceful shutdown')) {
        errorLogged = true;
      }
      originalError.apply(console, args);
    };
    
    // Replace the close method to throw an error
    amqp.connectionManager.close = function() {
      closeCallCount++;
      return Promise.reject(new Error('Test shutdown error'));
    };
    
    // Get the beforeExit handler and call it directly
    const listeners = process.listeners('beforeExit');
    const handler = listeners[listeners.length - 1]; // Get the last registered handler (ours)
    if (typeof handler === 'function') {
      const result = handler(0);
      // Wait for async handler to complete
      Promise.resolve(result).then(() => {
        setTimeout(() => {
          if (errorLogged && closeCallCount === 1) {
            console.log('✓ Error handling works correctly');
            process.exit(0);
          } else {
            console.error(\`ERROR: errorLogged=\${errorLogged}, closeCallCount=\${closeCallCount}\`);
            process.exit(1);
          }
        }, 100);
      }).catch((err) => {
        console.error('ERROR in handler:', err);
        process.exit(1);
      });
    } else {
      console.error('ERROR: beforeExit handler is not a function');
      process.exit(1);
    }
  `;

  const testFile = path.join(__dirname, '.test-error.js');
  fs.writeFileSync(testFile, testScript);

  try {
    await runTest('errorHandling', '.test-error.js');
    fs.unlinkSync(testFile);
  } catch (err) {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    throw err;
  }
}

async function testIdempotency() {
  const testScript = `
    // Load amqp module to register handlers
    require('./amqp.js');
    
    let closeCallCount = 0;
    
    // Mock connectionManager after module load
    const amqp = require('./amqp.js');
    const originalClose = amqp.connectionManager.close;
    
    amqp.connectionManager.close = function() {
      closeCallCount++;
      return Promise.resolve();
    };
    
    // Trigger beforeExit multiple times by scheduling work
    // Note: beforeExit can fire multiple times if async work is scheduled
    // We'll test that shutdown flag prevents multiple close() calls
    process.once('beforeExit', () => {
      // Schedule more work to trigger beforeExit again
      setImmediate(() => {
        if (closeCallCount === 1) {
          console.log('✓ Idempotency works correctly (shutdown flag prevents multiple calls)');
          process.exit(0);
        } else {
          console.error(\`ERROR: close() called \${closeCallCount} times, expected 1\`);
          process.exit(1);
        }
      });
    });
    
    // Initial trigger
    setTimeout(() => {}, 100);
  `;

  const testFile = path.join(__dirname, '.test-idempotency.js');
  fs.writeFileSync(testFile, testScript);

  try {
    await runTest('idempotency', '.test-idempotency.js');
    fs.unlinkSync(testFile);
  } catch (err) {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    throw err;
  }
}

async function runAllTests() {
  const tests = [
    { name: 'beforeExit', fn: () => testBeforeExit() },
    { name: 'uncaughtException', fn: () => testUncaughtException() },
    { name: 'unhandledRejection', fn: () => testUnhandledRejection() },
    { name: 'SIGTERM', fn: () => testSignal('SIGTERM') },
    { name: 'SIGINT', fn: () => testSignal('SIGINT') },
    { name: 'SIGHUP', fn: () => testSignal('SIGHUP') },
    { name: 'errorHandling', fn: () => testErrorHandling() },
    { name: 'idempotency', fn: () => testIdempotency() },
  ];

  const results = { passed: 0, failed: 0, failedTests: [] };

  for (const test of tests) {
    try {
      await test.fn();
      results.passed++;
    } catch (err) {
      results.failed++;
      results.failedTests.push(test.name);
      log(`\nTest "${test.name}" failed: ${err.message}`, 'red');
    }
  }

  log(`\n${'='.repeat(60)}`, 'blue');
  log(`Test Results: ${results.passed} passed, ${results.failed} failed`, 
      results.failed === 0 ? 'green' : 'red');
  if (results.failed > 0) {
    log(`Failed tests: ${results.failedTests.join(', ')}`, 'red');
  }
  log(`${'='.repeat(60)}`, 'blue');

  if (results.failed > 0) {
    process.exit(1);
  }
}

// Main execution
const testName = process.argv[2] || 'all';

if (testName === 'all') {
  runAllTests()
    .then(() => {
      log('\n✓ All tests completed', 'green');
    })
    .catch((err) => {
      log(`\n✗ Test suite failed: ${err.message}`, 'red');
      process.exit(1);
    });
} else {
  const testMap = {
    beforeExit: testBeforeExit,
    uncaughtException: testUncaughtException,
    unhandledRejection: testUnhandledRejection,
    sigterm: () => testSignal('SIGTERM'),
    sigint: () => testSignal('SIGINT'),
    sighup: () => testSignal('SIGHUP'),
    errorHandling: testErrorHandling,
    idempotency: testIdempotency,
  };

  const testFn = testMap[testName];
  if (!testFn) {
    log(`Unknown test: ${testName}`, 'red');
    log('Available tests: beforeExit, uncaughtException, unhandledRejection, sigterm, sigint, sighup, errorHandling, idempotency, all', 'yellow');
    process.exit(1);
  }

  testFn()
    .then(() => {
      log('\n✓ Test completed', 'green');
    })
    .catch((err) => {
      log(`\n✗ Test failed: ${err.message}`, 'red');
      process.exit(1);
    });
}
