const Joi = require('joi');
const { VEHICLE_STATUSES } = require('../../shared/models/Vehicle');
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUSES,
  CRITICAL_EVENTS,
} = require('../../shared/models/Notification');
const { objectId, location, pagination } = require('../../shared/validation/common');

const vehicleRef = Joi.object({
  id: objectId.required(),
  registrationNumber: Joi.string().trim().max(20).required(),
  assignedDriver: objectId.allow(null),
});

const isStatusChange = { is: 'status_change', otherwise: Joi.forbidden() };
const isCriticalEvent = { is: 'critical_event', otherwise: Joi.forbidden() };

// Body of POST /internal/events. Which extra fields are required depends on `type`.
const eventBody = Joi.object({
  type: Joi.string()
    .valid(...NOTIFICATION_TYPES)
    .required(),
  vehicle: vehicleRef.required(),
  change: Joi.when('type', {
    ...isStatusChange,
    then: Joi.object({
      from: Joi.string()
        .valid(...VEHICLE_STATUSES)
        .required(),
      to: Joi.string()
        .valid(...VEHICLE_STATUSES)
        .required(),
      reason: Joi.string().trim().max(200),
    }).required(),
  }),
  event: Joi.when('type', {
    ...isCriticalEvent,
    then: Joi.string()
      .valid(...CRITICAL_EVENTS)
      .required(),
  }),
  location: Joi.when('type', { ...isCriticalEvent, then: location }),
});

const listNotificationsQuery = Joi.object({
  status: Joi.string().valid(...NOTIFICATION_STATUSES),
  type: Joi.string().valid(...NOTIFICATION_TYPES),
  vehicleId: objectId,
  ...pagination,
});

const notificationIdParams = Joi.object({ id: objectId.required() });

module.exports = { eventBody, listNotificationsQuery, notificationIdParams };
