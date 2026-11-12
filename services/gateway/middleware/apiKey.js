const { timingSafeEqual } = require('node:crypto');
const AppError = require('../../../shared/errors/AppError');

// Constant-time comparison: a normal === leaks how many leading characters matched
function safeEqual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

function apiKeyAuth(validKeys) {
  const keys = validKeys.map((key) => Buffer.from(key));

  return (req, _res, next) => {
    const provided = req.get('x-api-key');
    if (!provided) {
      return next(
        new AppError(401, 'MISSING_API_KEY', 'An API key is required in the x-api-key header'),
      );
    }

    const providedBuf = Buffer.from(provided);
    if (!keys.some((key) => safeEqual(key, providedBuf))) {
      return next(new AppError(401, 'INVALID_API_KEY', 'The API key is not valid'));
    }

    req.apiKey = provided;
    next();
  };
}

module.exports = apiKeyAuth;
