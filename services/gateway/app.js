const createApp = require('../../shared/createApp');

// The gateway has no database; proxy routes, API keys and rate limiting arrive in Phase 2
module.exports = createApp({ name: 'gateway', useDb: false });
