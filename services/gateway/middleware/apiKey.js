const AppError = require('../../../shared/errors/AppError');
const safeEqual = require('../../../shared/auth/safeEqual');

function apiKeyAuth(validKeys) {
  return (req, _res, next) => {
    const provided = req.get('x-api-key');
    if (!provided) {
      return next(
        new AppError(401, 'MISSING_API_KEY', 'An API key is required in the x-api-key header'),
      );
    }

    if (!validKeys.some((key) => safeEqual(key, provided))) {
      return next(new AppError(401, 'INVALID_API_KEY', 'The API key is not valid'));
    }

    req.apiKey = provided;
    next();
  };
}

module.exports = apiKeyAuth;
