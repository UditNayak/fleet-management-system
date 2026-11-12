const config = require('./config');
const { createLogger } = require('./logger');
const { connectDB, disconnectDB } = require('./db');

const SHUTDOWN_TIMEOUT_MS = 10000;

/**
 * @param {object}   options
 * @param {string}   options.name
 * @param {boolean}  [options.useDb]
 * @param {Function} [options.onReady] async () => void, runs after the DB connects and before listening
 *                                     (e.g. creating the bootstrap admin)
 */
async function startServer(app, { name, useDb = true, onReady }) {
  const logger = createLogger(name);

  try {
    if (useDb) await connectDB(config.mongoUri, logger);
    if (onReady) await onReady();
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }

  const server = app.listen(config.port, () => logger.info(`Listening on port ${config.port}`));

  // Stop accepting new requests, let in-flight ones finish, then close the DB connection
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      if (useDb) await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

module.exports = startServer;
