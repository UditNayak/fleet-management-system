/**
 * Adds demo vehicles at real Bangalore places to the app database.
 *   docker compose --profile tools run --rm seed
 *
 * Idempotent: vehicles are upserted by registration number, so re-running just resets them.
 * It never touches users or any other vehicle.
 */
const config = require('../shared/config');
const { connectDB, disconnectDB } = require('../shared/db');
const Vehicle = require('../shared/models/Vehicle');

const { toPoint } = Vehicle;

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

async function seed() {
  await connectDB(config.mongoUri);
  try {
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
    console.log(`Seeded ${rows.length} demo vehicles in Bangalore.`);
  } finally {
    await disconnectDB();
  }
}

seed().catch((err) => {
  console.error(`Seeding failed: ${err.message}`);
  process.exit(1);
});
