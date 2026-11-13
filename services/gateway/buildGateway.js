const path = require('node:path');
const express = require('express');
const createApp = require('../../shared/createApp');
const apiKeyAuth = require('./middleware/apiKey');
const createRateLimiter = require('./middleware/rateLimit');
const createServiceProxy = require('./proxy');
const servicesHealth = require('./servicesHealth');
const docsRouter = require('./docs');
const notFound = require('../../shared/middleware/notFound');

const PUBLIC_DIR = path.join(__dirname, '../../public');
const LEAFLET_DIR = path.dirname(require.resolve('leaflet/dist/leaflet.js'));

// Content-Security-Policy: only our own scripts (no inline ones), map tiles from OpenStreetMap.
// helmet's other defaults (no plugins, no framing by other sites, …) stay as they are.
const cspDirectives = {
  upgradeInsecureRequests: null, // served over plain http://localhost — don't force https for assets
  imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org'],
};

/**
 * Builds the API Gateway app. Everything is passed in (instead of read from config)
 * so tests can point it at fake services and use tiny rate limits.
 *
 * @param {object}   options
 * @param {string[]} options.apiKeys    accepted values of the x-api-key header
 * @param {object}   options.rateLimit  { windowMs, max } per API key
 * @param {number}   options.timeoutMs  how long to wait for a service before answering 504
 * @param {Array<{path: string, name: string, target: string}>} options.services routing table
 */
function buildGateway({
  apiKeys,
  rateLimit = { windowMs: 900000, max: 100 },
  timeoutMs = 10000,
  services,
}) {
  if (!apiKeys?.length) {
    throw new Error('Gateway needs at least one API key (set API_KEYS)');
  }

  return createApp({
    name: 'gateway',
    useDb: false,
    parseJson: false, // bodies are streamed to the services untouched
    helmetOptions: {
      contentSecurityPolicy: { directives: cspDirectives },
      // OpenStreetMap blocks tile requests without a Referer (tile usage policy). Send only our
      // origin (e.g. http://localhost:3000/) to other sites, never full URLs — the browser default.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    },
    configure: (app) => {
      // Public endpoints (no API key)
      app.get('/health/services', servicesHealth(services));
      app.use('/api-docs', docsRouter());

      // Dashboard: static files (index.html at /). They are public, but every /api call the
      // page makes still needs the API key and a JWT. Unknown files fall through to the 404 JSON.
      app.use('/vendor/leaflet', express.static(LEAFLET_DIR));
      app.use(express.static(PUBLIC_DIR));

      // Protected API: key check → rate limit → proxy to the matching service
      const api = express.Router();
      // Service-to-service endpoints are never exposed: answer 404 before even checking the key
      api.use('/:service/internal', notFound);
      api.use(apiKeyAuth(apiKeys));
      api.use(createRateLimiter(rateLimit));
      services.forEach((service) => api.use(service.path, createServiceProxy(service, timeoutMs)));
      app.use('/api', api);
    },
  });
}

module.exports = buildGateway;
