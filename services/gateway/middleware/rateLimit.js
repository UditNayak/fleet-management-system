const { rateLimit } = require('express-rate-limit');
const AppError = require('../../../shared/errors/AppError');

// Per API key, in memory (fine for one gateway instance)
function createRateLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8', // RateLimit + RateLimit-Policy response headers
    legacyHeaders: false,
    keyGenerator: (req) => req.apiKey,
    handler: (req, res, next) => {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          `Too many requests. Limit is ${max} per ${Math.round(windowMs / 1000)}s; retry in ${retryAfter}s`,
        ),
      );
    },
  });
}

module.exports = createRateLimiter;
