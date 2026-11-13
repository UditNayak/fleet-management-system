const { createUser } = require('../services/user/service');
const { signToken } = require('../shared/auth/jwt');
const Vehicle = require('../shared/models/Vehicle');

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

let vehicleCounter = 0;

// Inserts a vehicle directly (bypassing the API) with a unique registration number
async function createVehicle(overrides = {}) {
  vehicleCounter += 1;
  return Vehicle.create({
    registrationNumber: `KA01AB${String(1000 + vehicleCounter).padStart(4, '0')}`,
    model: 'Tata Ace Gold',
    type: 'truck',
    ...overrides,
  });
}

module.exports = { createUserWithToken, bearer, createVehicle };
