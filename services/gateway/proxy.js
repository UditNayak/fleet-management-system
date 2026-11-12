const { createProxyMiddleware } = require('http-proxy-middleware');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('gateway');

// Network errors meaning "nothing is listening / host not reachable"
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH']);

function sendError(res, status, code, message, details) {
  if (res.headersSent) return res.end();
  res.status(status).json({ error: { code, message, ...(details && { details }) } });
}

/**
 * Forwards requests to one backend service.
 * Mounted at e.g. /api/vehicles, so Express has already stripped that prefix from req.url:
 *   GET /api/vehicles/42?x=1  →  GET {target}/42?x=1
 */
function createServiceProxy({ name, target }, timeoutMs) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    xfwd: true, // add X-Forwarded-For / -Host / -Proto
    proxyTimeout: timeoutMs,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader('x-api-key'); // services never need the client's API key
        proxyReq.setHeader('x-request-id', req.id);
        proxyReq.on('timeout', () => {
          req.proxyTimedOut = true;
        });
      },
      error: (err, req, res) => {
        if (req.proxyTimedOut) {
          logger.warn(`${name} timed out after ${timeoutMs}ms (reqId=${req.id})`);
          return sendError(res, 504, 'GATEWAY_TIMEOUT', `${name} did not respond in time`, {
            service: name,
          });
        }
        if (UNREACHABLE.has(err.code)) {
          logger.warn(`${name} unavailable: ${err.code} (reqId=${req.id})`);
          return sendError(res, 503, 'SERVICE_UNAVAILABLE', `${name} is currently unavailable`, {
            service: name,
          });
        }
        logger.error(`${name} proxy error: ${err.message} (reqId=${req.id})`);
        return sendError(res, 502, 'BAD_GATEWAY', `Invalid response from ${name}`, {
          service: name,
        });
      },
    },
  });
}

module.exports = createServiceProxy;
