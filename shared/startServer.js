const config = require('./config');
const { createLogger } = require('./logger');
const { connectDB, disconnectDB } = require('./db');

const SHUTDOWN_TIMEOUT_MS = 10000;

async function startServer(app, { name, useDb = true }) {
  const logger = createLogger(name);

  if (useDb) {
    try {
      await connectDB(config.mongoUri, logger);
    } catch (err) {
      logger.error(`Startup failed: ${err.message}`);
      process.exit(1);
    }
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
