/**
 * Demo data for the dashboard, Postman and the screencast:
 *   docker compose --profile tools run --rm seed
 *
 * - demo users (fleet manager, driver, a manager whose SMS always fails) — created only if missing
 * - KA01DM2026 (assigned to the demo driver) and KA01DM2027 — created only if missing
 * - 9 vehicles at real Bangalore places — upserted, so re-running resets their position and status
 *
 * Idempotent, and it never touches the admin or any other user / vehicle.
 */
const config = require('../shared/config');
const { connectDB, disconnectDB } = require('../shared/db');
const User = require('../shared/models/User');
const Vehicle = require('../shared/models/Vehicle');
const { createUser } = require('../services/user/service');

const { toPoint } = Vehicle;

// Same accounts the Postman auto-setup creates (passwords are demo-only and documented in the README)
const DEMO_USERS = [
  {
    name: 'Demo Manager',
    email: 'demo.manager@fleet.dev',
    password: 'Manager@123',
    phone: '+919812345678',
    role: 'fleet_manager',
  },
  {
    name: 'Demo Driver',
    email: 'demo.driver@fleet.dev',
    password: 'Driver@123',
    phone: '+919876543210',
    role: 'driver',
  },
  // phone ending in 0000 → the mock SMS provider fails on purpose (shows "failed" in the SMS log)
  {
    name: 'Unreachable Manager',
    email: 'demo.unreachable@fleet.dev',
    password: 'Manager@123',
    phone: '+919800000000',
    role: 'fleet_manager',
  },
];

const MG_ROAD = { address: 'MG Road, Bengaluru', location: toPoint({ lat: 12.9756, lng: 77.605 }) };

// [registration, model, type, status, place, lat, lng] — distance from MG Road (12.9756, 77.6050)
const DEMO_VEHICLES = [
  ['KA01DM2028', 'Tata Ace Gold', 'truck', 'active', 'MG Road', 12.9756, 77.6066], // 0.2 km
  ['KA01DM2029', 'Maruti Suzuki Eeco', 'van', 'idle', 'Cubbon Park', 12.9763, 77.5929], // 1.3 km
  ['KA01DM2030', 'Honda Activa 6G', 'bike', 'active', 'Indiranagar', 12.9784, 77.6408], // 3.9 km
  ['KA01DM2031', 'Mahindra Supro', 'van', 'active', 'Koramangala', 12.94, 77.62], // 4.3 km
  ['KA01DM2032', 'Ashok Leyland Dost', 'truck', 'idle', 'Jayanagar', 12.925, 77.5938], // 5.7 km
  ['KA01DM2033', 'Eicher Skyline Pro', 'bus', 'active', 'Hebbal', 13.0358, 77.597], // 6.7 km
  ['KA01DM2034', 'Tata Nexon EV', 'car', 'maintenance', 'HSR Layout', 12.9116, 77.6389], // 8 km
  ['KA01DM2035', 'BharatBenz 1015R', 'truck', 'active', 'Whitefield', 12.9698, 77.75], // 15.7 km
  ['KA01DM2036', 'Tata Ultra T.7', 'truck', 'idle', 'Electronic City', 12.8452, 77.6602], // 15.7 km
].map(([reg, model, type, status, place, lat, lng]) => ({
  reg,
  model,
  type,
  status,
  address: `${place}, Bengaluru`,
  lat,
  lng,
}));

// Creates missing demo users; existing ones (and their passwords) are left alone
async function seedUsers() {
  const rows = [];
  for (const user of DEMO_USERS) {
    const exists = await User.exists({ email: user.email });
    if (!exists) await createUser(user);
    rows.push({
      email: user.email,
      role: user.role,
      phone: user.phone,
      result: exists ? 'exists' : 'created',
    });
  }
  console.table(rows);
}

// The Postman demo vehicles: only created when missing, so their status / position history is kept
async function seedPostmanVehicles() {
  const driver = await User.findOne({ email: 'demo.driver@fleet.dev' }).select('_id');
  const vehicles = [
    {
      registrationNumber: 'KA01DM2026',
      model: 'Tata Ace Gold',
      type: 'truck',
      assignedDriver: driver._id,
    },
    { registrationNumber: 'KA01DM2027', model: 'Ashok Leyland Dost', type: 'van' },
  ];
  for (const { registrationNumber, ...fields } of vehicles) {
    await Vehicle.updateOne(
      { registrationNumber },
      { $setOnInsert: { ...fields, ...MG_ROAD, locationSource: 'manual' } },
      { upsert: true },
    );
  }
}

async function seed() {
  await connectDB(config.mongoUri);
  try {
    await seedUsers();
    await seedPostmanVehicles();

    const rows = [];
    for (const v of DEMO_VEHICLES) {
      const { upsertedCount } = await Vehicle.updateOne(
        { registrationNumber: v.reg },
        {
          $set: {
            model: v.model,
            type: v.type,
            status: v.status,
            address: v.address,
            location: toPoint({ lat: v.lat, lng: v.lng }),
            locationSource: 'manual',
          },
          $unset: { lastSeenAt: '' }, // forget simulator / telemetry positions
        },
        { upsert: true, runValidators: true },
      );
      rows.push({
        registration: v.reg,
        type: v.type,
        status: v.status,
        place: v.address,
        lat: v.lat,
        lng: v.lng,
        result: upsertedCount ? 'created' : 'reset',
      });
    }
    console.table(rows);
    console.log(
      `Seeded ${DEMO_USERS.length} demo users, KA01DM2026/2027 and ${rows.length} Bangalore vehicles.`,
    );
  } finally {
    await disconnectDB();
  }
}

seed().catch((err) => {
  console.error(`Seeding failed: ${err.message}`);
  process.exit(1);
});
