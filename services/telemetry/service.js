const config = require('../../shared/config');
const Telemetry = require('../../shared/models/Telemetry');
const Vehicle = require('../../shared/models/Vehicle');
const AppError = require('../../shared/errors/AppError');
const { createLogger } = require('../../shared/logger');
const hooks = require('./hooks');

const { CRITICAL_EVENTS } = Telemetry;
const { toPoint } = Vehicle;
const logger = createLogger('telemetry-service');

// Loads the vehicle; drivers may only use their assigned one
async function loadVehicleFor(actor, vehicleId) {
  const vehicle = await Vehicle.findById(vehicleId).select('registrationNumber assignedDriver');
  if (!vehicle) throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found');

  if (actor.role === 'driver' && vehicle.assignedDriver?.toString() !== actor.id) {
    throw new AppError(
      403,
      'NOT_ASSIGNED_DRIVER',
      'Drivers can only access their assigned vehicle',
    );
  }
  return vehicle;
}

// Adds { recordedAt: { $gte: from, $lte: to } } when a range was given
function addDateRange(filter, from, to) {
  if (!from && !to) return;
  filter.recordedAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
}

async function raiseAlert(vehicle, telemetry) {
  // Cooldown: one SMS per vehicle + event per window
  const since = new Date(Date.now() - config.telemetry.alertCooldownMs);
  const alertedRecently = await Telemetry.exists({
    vehicle: vehicle._id,
    event: telemetry.event,
    alertSentAt: { $gte: since },
  });
  if (alertedRecently) {
    return { notified: false, reason: 'cooldown' };
  }

  // An SMS failure must not fail the reading
  let notifications = null;
  try {
    notifications = (await hooks.onCriticalEvent(vehicle, telemetry)) ?? null;
  } catch (err) {
    logger.warn(`Alert for ${vehicle.registrationNumber} not sent: ${err.message}`);
  }

  // Cooldown only starts after a delivered alert
  if (notifications) {
    telemetry.alertSentAt = new Date();
    await telemetry.save();
  }
  return { notified: notifications !== null, notifications };
}

async function recordTelemetry(
  { vehicleId, location, recordedAt = new Date(), ...readings },
  actor,
) {
  const vehicle = await loadVehicleFor(actor, vehicleId);
  const point = toPoint(location);

  const telemetry = await Telemetry.create({
    ...readings,
    vehicle: vehicle._id,
    location: point,
    recordedAt,
    reportedBy: actor.id,
  });

  // Only move the vehicle if this reading is newer (condition is part of the update, so atomic)
  const { modifiedCount } = await Vehicle.updateOne(
    { _id: vehicle._id, lastSeenAt: { $not: { $gte: recordedAt } } },
    { $set: { location: point, locationSource: 'telemetry', lastSeenAt: recordedAt } },
  );

  const alert = CRITICAL_EVENTS.includes(telemetry.event)
    ? await raiseAlert(vehicle, telemetry)
    : null;

  return { telemetry, vehicleUpdated: modifiedCount === 1, alert };
}

async function getHistory(vehicleId, { event, from, to, page, limit }, actor) {
  await loadVehicleFor(actor, vehicleId);

  const filter = { vehicle: vehicleId };
  if (event) filter.event = event;
  addDateRange(filter, from, to);

  const [data, total] = await Promise.all([
    Telemetry.find(filter)
      .sort({ recordedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Telemetry.countDocuments(filter),
  ]);
  return { data, page, limit, total };
}

async function listCriticalEvents({ event, vehicleId, from, to, page, limit }) {
  const filter = { event: event ?? { $in: CRITICAL_EVENTS } };
  if (vehicleId) filter.vehicle = vehicleId;
  addDateRange(filter, from, to);

  const [docs, total] = await Promise.all([
    Telemetry.find(filter)
      .sort({ recordedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('vehicle', 'registrationNumber'),
    Telemetry.countDocuments(filter),
  ]);

  // Keep `vehicle` as a plain id and add the registration number next to it
  const data = docs.map((doc) => ({
    ...doc.toJSON(),
    vehicle: (doc.populated('vehicle') ?? doc.vehicle).toString(),
    vehicleRegistration: doc.vehicle?.registrationNumber ?? null, // vehicle deleted
  }));
  return { data, page, limit, total };
}

module.exports = { recordTelemetry, getHistory, listCriticalEvents };
