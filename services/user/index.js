const app = require('./app');
const startServer = require('../../shared/startServer');
const { createLogger } = require('../../shared/logger');
const ensureBootstrapAdmin = require('./bootstrapAdmin');

const logger = createLogger('user-service');

startServer(app, { name: 'user-service', onReady: () => ensureBootstrapAdmin(logger) });
