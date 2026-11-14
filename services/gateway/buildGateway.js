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

// CSP: our own scripts only, map tiles from OpenStreetMap
const cspDirectives = {
  upgradeInsecureRequests: null, // plain http on localhost
  imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org'],
};

// Options are passed in (not read from config) so tests can use fake services and small limits
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
      // OSM tile servers reject requests without a Referer
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    },
    configure: (app) => {
      // Public endpoints (no API key)
      app.get('/health/services', servicesHealth(services));
      app.use('/api-docs', docsRouter());

      // Dashboard (public). Its /api calls still need the API key + JWT
      app.use('/vendor/leaflet', express.static(LEAFLET_DIR));
      app.use(express.static(PUBLIC_DIR));

      // API key → rate limit → proxy
      const api = express.Router();
      // /internal/* is service-to-service only
      api.use('/:service/internal', notFound);
      api.use(apiKeyAuth(apiKeys));
      api.use(createRateLimiter(rateLimit));
      services.forEach((service) => api.use(service.path, createServiceProxy(service, timeoutMs)));
      app.use('/api', api);
    },
  });
}

module.exports = buildGateway;
