const AppError = require('../errors/AppError');
const { verifyToken } = require('../auth/jwt');

// Verifies "Authorization: Bearer <jwt>" and puts the caller on req.user
function authenticate(req, _res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');

  if (!/^Bearer$/i.test(scheme) || !token) {
    return next(
      new AppError(401, 'TOKEN_MISSING', 'A Bearer token is required in the Authorization header'),
    );
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError(401, 'TOKEN_EXPIRED', 'The token has expired, please log in again'));
    }
    return next(new AppError(401, 'TOKEN_INVALID', 'The token is invalid'));
  }
}

module.exports = { authenticate };
