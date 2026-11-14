const config = require('./config');
const { createLogger } = require('./logger');
const { connectDB, disconnectDB } = require('./db');

const SHUTDOWN_TIMEOUT_MS = 10000;

// onReady runs after the DB connects, before listening (e.g. bootstrap admin)
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

  // Graceful shutdown: finish in-flight requests, then close the DB
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
