const AppError = require('../errors/AppError');

// Runs only if no route above it matched the request
function notFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

module.exports = notFound;
