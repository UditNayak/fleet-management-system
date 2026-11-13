const { createUser } = require('../services/user/service');
const { signToken } = require('../shared/auth/jwt');
const Vehicle = require('../shared/models/Vehicle');
const Telemetry = require('../shared/models/Telemetry');

let counter = 0;

// Creates a user directly in the DB and returns it with a valid JWT
async function createUserWithToken(role = 'driver', overrides = {}) {
  counter += 1;
  const password = overrides.password ?? 'Passw0rd!';
  const user = await createUser({
    name: `Test ${role} ${counter}`,
    email: `${role}${counter}@test.dev`,
    phone: `+9190000${String(counter).padStart(5, '0')}`, // unique per user
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

// Inserts a telemetry reading directly (default: Bangalore, recorded now, no event)
function createTelemetry(vehicle, { lat = 12.9716, lng = 77.5946, ...overrides } = {}) {
  return Telemetry.create({
    vehicle: vehicle.id,
    location: Vehicle.toPoint({ lat, lng }),
    recordedAt: new Date(),
    ...overrides,
  });
}

module.exports = { createUserWithToken, bearer, createVehicle, createTelemetry };
