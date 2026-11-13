const mongoose = require('mongoose');

const VEHICLE_TYPES = ['truck', 'van', 'car', 'bike', 'bus'];
const VEHICLE_STATUSES = ['active', 'idle', 'maintenance', 'inactive'];
// Where the current location came from: sent by a user, looked up from the address, or reported by GPS
const LOCATION_SOURCES = ['manual', 'geocoded', 'telemetry'];

const { ObjectId } = mongoose.Schema.Types;

// GeoJSON Point — MongoDB geo queries require this shape, with coordinates in [lng, lat] order
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

const statusChangeSchema = new mongoose.Schema(
  {
    from: { type: String, enum: VEHICLE_STATUSES, required: true },
    to: { type: String, enum: VEHICLE_STATUSES, required: true },
    reason: { type: String },
    changedBy: { type: ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, required: true },
  },
  { _id: false },
);

const vehicleSchema = new mongoose.Schema(
  {
    registrationNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    model: { type: String, required: true, trim: true },
    type: { type: String, enum: VEHICLE_TYPES, required: true },
    year: { type: Number },
    status: { type: String, enum: VEHICLE_STATUSES, default: 'idle', index: true },
    address: { type: String, trim: true },
    location: { type: pointSchema },
    locationSource: { type: String, enum: LOCATION_SOURCES },
    lastSeenAt: { type: Date },
    assignedDriver: { type: ObjectId, ref: 'User', index: true },
    statusHistory: { type: [statusChangeSchema] }, // excluded from list queries to keep them small
    createdBy: { type: ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      // API shape: `id`, location as { lat, lng }, missing optional fields as null
      transform: (_doc, { _id, __v, location, statusHistory, ...rest }) => ({
        id: _id.toString(),
        ...rest,
        location: toLatLng(location),
        locationSource: rest.locationSource ?? null,
        lastSeenAt: rest.lastSeenAt ?? null,
        assignedDriver: rest.assignedDriver ?? null,
        ...(statusHistory && { statusHistory }),
      }),
    },
  },
);

// Enables $geoNear / $near queries (maps-service); documents without a location are simply not indexed
vehicleSchema.index({ location: '2dsphere' });

function toPoint({ lat, lng }) {
  return { type: 'Point', coordinates: [lng, lat] };
}

function toLatLng(point) {
  if (!point?.coordinates) return null;
  const [lng, lat] = point.coordinates;
  return { lat, lng };
}

const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', vehicleSchema);

module.exports = Vehicle;
module.exports.VEHICLE_TYPES = VEHICLE_TYPES;
module.exports.VEHICLE_STATUSES = VEHICLE_STATUSES;
module.exports.LOCATION_SOURCES = LOCATION_SOURCES;
module.exports.toPoint = toPoint;
module.exports.toLatLng = toLatLng;
