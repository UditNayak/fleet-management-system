const { randomUUID } = require('node:crypto');

// Only accept simple, reasonably short IDs from clients (they end up in logs)
const VALID_ID = /^[\w-]{1,100}$/;

// Gives every request an ID so one request can be traced through the gateway and services.
// The gateway generates it; services reuse the one the gateway forwards.
function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
