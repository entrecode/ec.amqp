# Graceful Shutdown Test Suite

This test suite verifies all graceful shutdown behaviors of the AMQP module.

## Running Tests

### Run all tests:
```bash
node test-graceful-shutdown.js
# or
node test-graceful-shutdown.js all
```

### Run individual tests:
```bash
node test-graceful-shutdown.js beforeExit
node test-graceful-shutdown.js uncaughtException
node test-graceful-shutdown.js unhandledRejection
node test-graceful-shutdown.js sigterm
node test-graceful-shutdown.js sigint
node test-graceful-shutdown.js sighup
node test-graceful-shutdown.js errorHandling
node test-graceful-shutdown.js idempotency
```

## Test Coverage

### 1. **beforeExit Handler**
Tests that the `beforeExit` event handler properly closes AMQP connections when the event loop empties naturally.

### 2. **Uncaught Exception Handler**
Tests that uncaught exceptions trigger graceful shutdown and the process exits with code 1.

### 3. **Unhandled Rejection Handler**
Tests that unhandled promise rejections trigger graceful shutdown and the process exits with code 1.

### 4. **Signal Handlers (SIGTERM, SIGINT, SIGHUP)**
Tests that signal handlers properly close AMQP connections when the process receives termination signals.

### 5. **Error Handling**
Tests that errors during `connectionManager.close()` are properly caught and logged without crashing the shutdown process.

### 6. **Idempotency**
Tests that multiple shutdown attempts (e.g., `beforeExit` firing multiple times) only call `close()` once due to the `shuttingDown` flag.

## Test Environment

All tests run with `NODE_ENV=testing` to use the mock connection manager, ensuring tests don't require a real RabbitMQ connection.

## Expected Behavior

- **Signal handlers**: Should call `gracefulShutdown()` but NOT call `process.exit()` (process exits naturally)
- **Exception handlers**: Should call `gracefulShutdown()` AND call `process.exit(1)`
- **beforeExit**: Should call `gracefulShutdown()` when event loop empties
- **Idempotency**: Multiple shutdown attempts should only close once
- **Error handling**: Errors during shutdown should be logged but not crash the process

