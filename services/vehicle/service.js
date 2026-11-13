const Vehicle = require('../../shared/models/Vehicle');
const User = require('../../shared/models/User');
const AppError = require('../../shared/errors/AppError');
const { createLogger } = require('../../shared/logger');
const hooks = require('./hooks');

const { toPoint } = Vehicle;
const logger = createLogger('vehicle-service');

const vehicleNotFound = () => new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found');

// Vehicle and User live in the same database (see PLAN: shared DB, owned collections)
async function ensureDriver(driverId) {
  if (driverId === undefined || driverId === null) return;
  const isDriver = await User.exists({ _id: driverId, role: 'driver', isActive: true });
  if (!isDriver) {
    throw new AppError(
      400,
      'INVALID_DRIVER',
      'assignedDriver must be an existing, active user with the driver role',
    );
  }
}

async function createVehicle({ location, ...fields }, actor) {
  await ensureDriver(fields.assignedDriver);
  try {
    return await Vehicle.create({
      ...fields,
      ...(location && { location: toPoint(location) }),
      createdBy: actor.id,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(
        409,
        'VEHICLE_EXISTS',
        `A vehicle with registration number ${fields.registrationNumber} already exists`,
      );
    }
    throw err;
  }
}

async function getVehicle(id) {
  const vehicle = await Vehicle.findById(id);
  if (!vehicle) throw vehicleNotFound();
  return vehicle;
}

// Escape user input before putting it in a regex (otherwise "KA.*" would match everything)
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listVehicles({ status, type, assignedDriver, search, sort, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (assignedDriver) filter.assignedDriver = assignedDriver;
  if (search) {
    // Stored numbers are uppercase without spaces, so normalise the search the same way.
    // An anchored prefix regex can use the unique index on registrationNumber.
    const prefix = search.toUpperCase().replace(/[\s-]/g, '');
    filter.registrationNumber = { $regex: `^${escapeRegex(prefix)}` };
  }

  const sortField = sort.replace(/^-/, '');
  const sortOrder = sort.startsWith('-') ? -1 : 1;

  const [data, total] = await Promise.all([
    Vehicle.find(filter)
      .select('-statusHistory')
      .sort({ [sortField]: sortOrder, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Vehicle.countDocuments(filter),
  ]);
  return { data, page, limit, total };
}

async function updateVehicle(id, changes) {
  if ('assignedDriver' in changes) await ensureDriver(changes.assignedDriver);

  // Split into $set and $unset: sending null for an optional field removes it
  const $set = {};
  const $unset = {};
  for (const [field, value] of Object.entries(changes)) {
    if (value === null) $unset[field] = '';
    else $set[field] = field === 'location' ? toPoint(value) : value;
  }

  const vehicle = await Vehicle.findByIdAndUpdate(
    id,
    { $set, $unset },
    { new: true, runValidators: true },
  );
  if (!vehicle) throw vehicleNotFound();
  return vehicle;
}

async function changeStatus(id, { status, reason }, actor) {
  const current = await getVehicle(id);
  if (current.status === status) {
    return { vehicle: current, changed: false };
  }

  const change = {
    from: current.status,
    to: status,
    ...(reason && { reason }),
    changedBy: actor.id,
    changedAt: new Date(),
  };

  // Only apply if nobody changed the status in the meantime
  const vehicle = await Vehicle.findOneAndUpdate(
    { _id: id, status: current.status },
    { $set: { status }, $push: { statusHistory: change } },
    { new: true },
  );
  if (!vehicle) {
    throw new AppError(409, 'STATUS_CONFLICT', 'The status was changed by someone else; retry');
  }

  // A failing side effect (e.g. SMS) must not undo or fail the status change itself
  try {
    await hooks.onStatusChanged(vehicle, change);
  } catch (err) {
    logger.error(`onStatusChanged failed for ${vehicle.registrationNumber}: ${err.message}`);
  }

  return { vehicle, changed: true, change };
}

async function deleteVehicle(id) {
  const vehicle = await Vehicle.findByIdAndDelete(id);
  if (!vehicle) throw vehicleNotFound();
}

module.exports = {
  createVehicle,
  getVehicle,
  listVehicles,
  updateVehicle,
  changeStatus,
  deleteVehicle,
};
