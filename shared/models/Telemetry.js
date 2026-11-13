const mongoose = require('mongoose');
const { toLatLng } = require('./Vehicle');

// Events a vehicle can report; everything except 'none' triggers an SMS alert
const CRITICAL_EVENTS = ['engine_fault', 'low_battery', 'emergency_stop'];
const TELEMETRY_EVENTS = ['none', ...CRITICAL_EVENTS];

const { ObjectId } = mongoose.Schema.Types;

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false },
);

// One document per reading sent by a vehicle
const telemetrySchema = new mongoose.Schema(
  {
    vehicle: { type: ObjectId, ref: 'Vehicle', required: true },
    location: { type: pointSchema, required: true },
    speed: { type: Number }, // km/h
    heading: { type: Number }, // degrees, 0 = north
    batteryLevel: { type: Number }, // %
    fuelLevel: { type: Number }, // %
    engineTemp: { type: Number }, // °C
    event: { type: String, enum: TELEMETRY_EVENTS, default: 'none' },
    recordedAt: { type: Date, required: true }, // device time
    reportedBy: { type: ObjectId, ref: 'User' },
    alertSentAt: { type: Date }, // set when this reading triggered an SMS alert
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // readings are never edited
    toJSON: {
      transform: (_doc, { _id, __v, location, ...rest }) => ({
        id: _id.toString(),
        ...rest,
        location: toLatLng(location),
      }),
    },
  },
);

// Each index matches one query the service runs
telemetrySchema.index({ vehicle: 1, recordedAt: -1 }); // history of one vehicle, newest first
telemetrySchema.index({ vehicle: 1, event: 1, alertSentAt: -1 }); // alert cooldown lookup
telemetrySchema.index({ event: 1, recordedAt: -1 }); // critical events across the fleet

const Telemetry = mongoose.models.Telemetry || mongoose.model('Telemetry', telemetrySchema);

module.exports = Telemetry;
module.exports.TELEMETRY_EVENTS = TELEMETRY_EVENTS;
module.exports.CRITICAL_EVENTS = CRITICAL_EVENTS;
