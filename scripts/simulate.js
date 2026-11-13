/**
 * Live telemetry simulator: drives 3 seeded Bangalore vehicles around short loops.
 *   docker compose --profile tools run --rm simulate      (Ctrl+C to stop)
 *
 * Like real tracking devices, it posts readings straight to telemetry-service on the Docker network
 * (not through the gateway, so the dashboard's API-key rate limit isn't used up).
 * One vehicle's battery runs low after about a minute → low_battery → SMS alert (5-min cooldown).
 *
 * Env: SIM_INTERVAL_MS (5000), SIM_TICKS (0 = until stopped), SIM_ALERT (true), SIM_SPEEDUP (10)
 */
const config = require('../shared/config');
const { advance, drainBattery } = require('./simulator');

const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS ?? 5000);
const MAX_TICKS = Number(process.env.SIM_TICKS ?? 0);
const ALERTS = process.env.SIM_ALERT !== 'false';
// Moves vehicles faster than real time so they visibly move on the map every refresh
const SPEEDUP = Number(process.env.SIM_SPEEDUP ?? 10);

const p = (lat, lng) => ({ lat, lng });
const FLEET = [
  {
    reg: 'KA01DM2028', // MG Road → Indiranagar → Domlur loop
    route: [
      p(12.9756, 77.6066),
      p(12.973, 77.617),
      p(12.9719, 77.6412),
      p(12.9606, 77.6386),
      p(12.965, 77.605),
    ],
    speedKmh: 38,
    battery: 24, // runs low first → low_battery alert
    drain: 0.8,
  },
  {
    reg: 'KA01DM2030', // Indiranagar → Koramangala loop
    route: [p(12.9784, 77.6408), p(12.958, 77.648), p(12.9352, 77.6245), p(12.956, 77.62)],
    speedKmh: 32,
    battery: 80,
    drain: 0.3,
  },
  {
    reg: 'KA01DM2035', // Whitefield loop
    route: [p(12.9698, 77.75), p(12.985, 77.727), p(12.993, 77.701), p(12.976, 77.719)],
    speedKmh: 45,
    battery: 65,
    drain: 0.3,
  },
];

let token = null;
let stopping = false;
const stats = { readings: 0, alerts: 0, errors: 0 };

async function call(baseUrl, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(data?.error?.message ?? `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

async function login() {
  if (!config.admin.email || !config.admin.password) {
    throw new Error('ADMIN_EMAIL / ADMIN_PASSWORD must be set in .env');
  }
  token = null;
  ({ token } = await call(config.services.users, '/login', {
    method: 'POST',
    body: { email: config.admin.email, password: config.admin.password },
  }));
}

async function findVehicles() {
  for (const vehicle of FLEET) {
    const { data } = await call(config.services.vehicles, `/?search=${vehicle.reg}`);
    if (!data[0]) {
      throw new Error(
        `${vehicle.reg} not found — run: docker compose --profile tools run --rm seed`,
      );
    }
    Object.assign(vehicle, { id: data[0].id, leg: 0, progress: 0, fuel: 70 });
  }
}

async function report(vehicle, tick) {
  const speed = Math.max(5, vehicle.speedKmh + (Math.random() - 0.5) * 10);
  const km = ((speed * INTERVAL_MS) / 3600000) * SPEEDUP;
  const moved = advance(vehicle.route, vehicle, km);
  const battery = drainBattery(vehicle.battery, vehicle.drain);
  Object.assign(vehicle, moved, { battery: battery.level });
  vehicle.fuel = Math.max(5, vehicle.fuel - 0.2);

  const reading = {
    vehicleId: vehicle.id,
    location: moved.position,
    speed: Number(speed.toFixed(1)),
    heading: moved.heading,
    batteryLevel: battery.level,
    fuelLevel: Number(vehicle.fuel.toFixed(1)),
    engineTemp: Number((85 + Math.random() * 10).toFixed(1)),
    event: ALERTS ? battery.event : 'none',
  };

  const res = await call(config.services.telemetry, '/', { method: 'POST', body: reading });
  stats.readings += 1;

  let note = '';
  if (reading.event !== 'none') {
    const { notified, reason, notifications } = res.alert ?? {};
    if (notified) stats.alerts += 1;
    note = notified
      ? `  ⚠ LOW BATTERY → SMS sent: ${notifications.sent}, failed: ${notifications.failed}`
      : `  ⚠ LOW BATTERY (no SMS: ${reason ?? 'notification service unavailable'})`;
  }
  const { lat, lng } = moved.position;
  console.log(
    `#${String(tick).padStart(3)} ${vehicle.reg}  ${lat.toFixed(5)},${lng.toFixed(5)}  ` +
      `${String(reading.speed).padStart(5)} km/h  battery ${String(battery.level).padStart(4)}%${note}`,
  );
}

async function tickOnce(tick) {
  for (const vehicle of FLEET) {
    try {
      await report(vehicle, tick);
    } catch (err) {
      if (err.status === 401) await login(); // token expired → log in again, next tick continues
      stats.errors += 1;
      console.error(`#${tick} ${vehicle.reg} failed: ${err.message}`);
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await login();
  await findVehicles();
  console.log(
    `Simulating ${FLEET.map((v) => v.reg).join(', ')} every ${INTERVAL_MS / 1000}s ` +
      `(×${SPEEDUP} speed, alerts ${ALERTS ? 'on' : 'off'}). Ctrl+C to stop.`,
  );

  for (let tick = 1; !stopping && (MAX_TICKS === 0 || tick <= MAX_TICKS); tick += 1) {
    await tickOnce(tick);
    if (!stopping && tick !== MAX_TICKS) await sleep(INTERVAL_MS);
  }
  console.log(
    `Stopped. ${stats.readings} readings, ${stats.alerts} SMS alerts, ${stats.errors} errors.`,
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) process.exit(130); // second Ctrl+C: quit immediately
    stopping = true;
    console.log('\nStopping after this tick…');
  });
}

main().catch((err) => {
  console.error(`Simulator failed: ${err.message}`);
  process.exit(1);
});
