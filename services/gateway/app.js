const config = require('../../shared/config');
const buildGateway = require('./buildGateway');
const services = require('./routes');

module.exports = buildGateway({
  apiKeys: config.gateway.apiKeys,
  rateLimit: config.gateway.rateLimit,
  timeoutMs: config.gateway.proxyTimeoutMs,
  services,
});
