const { createUser } = require('../services/user/service');
const { signToken } = require('../shared/auth/jwt');

let counter = 0;

// Creates a user directly in the DB and returns it with a valid JWT
async function createUserWithToken(role = 'driver', overrides = {}) {
  counter += 1;
  const password = overrides.password ?? 'Passw0rd!';
  const user = await createUser({
    name: `Test ${role} ${counter}`,
    email: `${role}${counter}@test.dev`,
    phone: '+919000000001',
    role,
    ...overrides,
    password,
  });
  return { user, password, token: signToken(user) };
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { createUserWithToken, bearer };
