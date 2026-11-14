const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { createLogger } = require('./logger');
const { dbStatus } = require('./db');
const requestId = require('./middleware/requestId');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

morgan.token('id', (req) => req.id);

// Express app with the middleware every service shares.
// Order: helmet → request id → logging → json → /health → routes → 404 → error handler
function createApp({ name, useDb = true, parseJson = true, helmetOptions, configure }) {
  const app = express();
  const logger = createLogger(name);

  app.use(helmet(helmetOptions));
  app.use(requestId);
  app.use(
    morgan(':method :url :status :response-time ms reqId=:id', {
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
