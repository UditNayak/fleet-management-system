const app = require('./app');
const startServer = require('../../shared/startServer');

startServer(app, { name: 'maps-service' });
