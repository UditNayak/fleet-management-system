const Joi = require('joi');
const { ROLES } = require('../../shared/models/User');
const { objectId, phone, pagination } = require('../../shared/validation/common');

const name = Joi.string().trim().min(2).max(100);
const email = Joi.string().trim().lowercase().email();
const password = Joi.string()
  .min(8)
  .max(72) // bcrypt only uses the first 72 bytes
  .pattern(/[A-Za-z]/, 'letter')
  .pattern(/\d/, 'number')
  .messages({ 'string.pattern.name': '{{#label}} must contain at least one {{#name}}' });
const role = Joi.string().valid(...ROLES);

// Public self-registration: no `role` allowed (Joi rejects unknown keys by default)
const registerBody = Joi.object({
  name: name.required(),
  email: email.required(),
  password: password.required(),
  phone,
});

// Login only checks presence; password rules apply when a password is created
const loginBody = Joi.object({
  email: email.required(),
  password: Joi.string().required(),
});

const createUserBody = registerBody.keys({ role: role.required() });

const updateUserBody = Joi.object({
  name,
  phone,
  role,
  isActive: Joi.boolean(),
}).min(1);

const listUsersQuery = Joi.object({ role, ...pagination });

const userIdParams = Joi.object({ id: objectId.required() });

module.exports = {
  registerBody,
  loginBody,
  createUserBody,
  updateUserBody,
  listUsersQuery,
  userIdParams,
};
