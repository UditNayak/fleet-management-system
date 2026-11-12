const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { createLogger } = require('./logger');
const { dbStatus } = require('./db');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

/**
 * Builds an Express app with the middleware every service shares.
 *
 * Order matters — Express runs middleware top to bottom:
 *   security headers → request logging → JSON body parsing → /health
 *   → service routes (via `configure`) → 404 → error handler
 *
 * @param {object}   options
 * @param {string}   options.name       service name shown in logs and /health
 * @param {boolean}  [options.useDb]    whether /health should report DB status
 * @param {boolean}  [options.parseJson] parse JSON bodies (the gateway turns this off to proxy raw bodies)
 * @param {Function} [options.configure] (app) => void, mounts the service's own routes
 */
function createApp({ name, useDb = true, parseJson = true, configure }) {
  const app = express();
  const logger = createLogger(name);

  app.use(helmet());
  app.use(
    morgan(':method :url :status :response-time ms', {
      stream: { write: (line) => logger.info(line.trim()) },
    }),
  );
  if (parseJson) app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    const db = useDb ? dbStatus() : 'not_used';
    const healthy = !useDb || db === 'connected';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: name,
      db,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  if (configure) configure(app);

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}

module.exports = createApp;
