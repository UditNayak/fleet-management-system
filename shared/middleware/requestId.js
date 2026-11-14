const { randomUUID } = require('node:crypto');

// Only accept simple, reasonably short IDs from clients (they end up in logs)
const VALID_ID = /^[\w-]{1,100}$/;

// Request id for tracing; services reuse the one from the gateway
function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
