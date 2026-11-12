const AppError = require('../errors/AppError');
const config = require('../config');

// Convert known library errors into AppErrors so clients always get the same JSON shape
function normalize(err) {
  if (err instanceof AppError) return err;

  // Thrown by express.json() when the body is not valid JSON
  if (err.type === 'entity.parse.failed') {
    return new AppError(400, 'INVALID_JSON', 'Request body contains invalid JSON');
  }
  if (err.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return new AppError(400, 'VALIDATION_ERROR', 'Validation failed', details);
  }
  if (err.name === 'CastError') {
    return new AppError(400, 'INVALID_ID', `Invalid value for ${err.path}`);
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
    return new AppError(409, 'DUPLICATE', `A record with this ${field} already exists`);
  }
  return null;
}

// Express recognises error-handling middleware by its 4 arguments
function errorHandler(logger) {
  return (err, req, res, _next) => {
    const appError = normalize(err);

    if (!appError) {
      logger.error(`${req.method} ${req.originalUrl} failed: ${err.stack}`);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong',
          ...(config.isProduction ? {} : { details: err.message }),
        },
      });
    }

    const body = { code: appError.code, message: appError.message };
    if (appError.details) body.details = appError.details;
    return res.status(appError.status).json({ error: body });
  };
}

module.exports = errorHandler;
