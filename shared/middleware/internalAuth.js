const config = require('../config');
const AppError = require('../errors/AppError');
const safeEqual = require('../auth/safeEqual');

// /internal/* only: checks the x-internal-token header
function internalAuth(token = config.internal.token) {
  return (req, _res, next) => {
    const provided = req.get('x-internal-token');
    if (!provided || !safeEqual(provided, token)) {
      return next(
        new AppError(401, 'INVALID_INTERNAL_TOKEN', 'This endpoint is for internal services only'),
      );
    }
    next();
  };
}

module.exports = internalAuth;
