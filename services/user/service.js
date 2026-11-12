const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../shared/config');
const User = require('../../shared/models/User');
const AppError = require('../../shared/errors/AppError');
const { signToken } = require('../../shared/auth/jwt');

// Compared against when the email doesn't exist, so a login takes the same time either way
// and response timing can't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
const userNotFound = () => new AppError(404, 'USER_NOT_FOUND', 'User not found');

async function createUser({ password, ...fields }) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  try {
    return await User.create({ ...fields, passwordHash });
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

// Public sign-up always creates a driver; other roles are assigned by an admin
function register(data) {
  return createUser({ ...data, role: 'driver' });
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordOk) throw invalidCredentials();
  if (!user.isActive) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken(user);
  const { iat, exp } = jwt.decode(token);
  return { token, tokenType: 'Bearer', expiresIn: exp - iat, user };
}

async function getUser(id) {
  const user = await User.findById(id);
  if (!user) throw userNotFound();
  return user;
}

async function listUsers({ role, page, limit }) {
  const filter = role ? { role } : {};
  const [data, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  return { data, page, limit, total };
}

async function updateUser(id, changes, actor) {
  // Stop admins from locking themselves out by demoting or disabling their own account
  if (id === actor.id && ('role' in changes || 'isActive' in changes)) {
    throw new AppError(403, 'CANNOT_MODIFY_SELF', 'You cannot change your own role or status');
  }
  const user = await User.findByIdAndUpdate(id, changes, { new: true, runValidators: true });
  if (!user) throw userNotFound();
  return user;
}

module.exports = { createUser, register, login, getUser, listUsers, updateUser };
