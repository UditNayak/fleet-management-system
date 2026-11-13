const mongoose = require('mongoose');

const NOTIFICATION_TYPES = ['status_change', 'critical_event'];
const NOTIFICATION_STATUSES = ['sent', 'failed'];
// Telemetry events that trigger an SMS alert (sent by telemetry-service from Phase 6)
const CRITICAL_EVENTS = ['engine_fault', 'low_battery', 'emergency_stop'];

const { ObjectId } = mongoose.Schema.Types;

// One document per SMS (one event → one SMS per recipient)
const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true, index: true },
    vehicle: { type: ObjectId, ref: 'Vehicle', required: true, index: true },
    // Copied in, so the log stays readable even after the vehicle is deleted
    vehicleRegistration: { type: String, required: true },
    recipientUser: { type: ObjectId, ref: 'User', required: true },
    recipientRole: { type: String, required: true },
    recipientPhone: { type: String, required: true },
    message: { type: String, required: true },
    provider: { type: String, required: true },
    providerMessageId: { type: String },
    status: { type: String, enum: NOTIFICATION_STATUSES, required: true, index: true },
    error: { type: String },
    details: { type: mongoose.Schema.Types.Mixed }, // e.g. { from, to, reason } or { event, location }
    sentAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, { _id, __v, ...rest }) => ({ id: _id.toString(), ...rest }),
    },
  },
);

notificationSchema.index({ createdAt: -1 });

const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.NOTIFICATION_STATUSES = NOTIFICATION_STATUSES;
module.exports.CRITICAL_EVENTS = CRITICAL_EVENTS;
