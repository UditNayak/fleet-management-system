const createApp = require('../../shared/createApp');
const routes = require('./routes');

module.exports = createApp({
  name: 'notification-service',
  configure: (app) => app.use('/', routes),
});
