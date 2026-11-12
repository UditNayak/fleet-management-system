const AppError = require('../errors/AppError');

// Role-based access control. Use after authenticate: authorize('admin', 'fleet_manager')
function authorize(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, 'TOKEN_MISSING', 'Authentication is required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          403,
          'FORBIDDEN',
          `This action requires one of these roles: ${allowedRoles.join(', ')}`,
        ),
      );
    }
    return next();
  };
}

module.exports = { authorize };
