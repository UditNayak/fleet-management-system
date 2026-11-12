const jwt = require('jsonwebtoken');
const config = require('../config');

const ISSUER = 'fleet-management-system';
const ALGORITHM = 'HS256';

// Payload kept small: who (sub), what they may do (role), and email for logs/UI
function signToken(user) {
  return jwt.sign({ role: user.role, email: user.email }, config.jwt.secret, {
    subject: user.id,
    expiresIn: config.jwt.expiresIn,
    issuer: ISSUER,
    algorithm: ALGORITHM,
  });
}

// Throws TokenExpiredError / JsonWebTokenError if the token is not acceptable
function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, { issuer: ISSUER, algorithms: [ALGORITHM] });
}

module.exports = { signToken, verifyToken, ISSUER };
