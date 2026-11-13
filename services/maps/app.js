const createApp = require('../../shared/createApp');
const routes = require('./routes');

module.exports = createApp({
  name: 'maps-service',
  configure: (app) => app.use('/', routes),
});
