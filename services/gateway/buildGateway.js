const express = require('express');
const createApp = require('../../shared/createApp');
const apiKeyAuth = require('./middleware/apiKey');
const createRateLimiter = require('./middleware/rateLimit');
const createServiceProxy = require('./proxy');
const servicesHealth = require('./servicesHealth');
const docsRouter = require('./docs');
const notFound = require('../../shared/middleware/notFound');

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
    // Swagger UI is served over plain http://localhost — don't force https for its assets
    helmetOptions: { contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } },
    configure: (app) => {
      // Public endpoints (no API key)
      app.get('/health/services', servicesHealth(services));
      app.use('/api-docs', docsRouter());

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
