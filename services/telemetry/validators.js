const Joi = require('joi');
const { TELEMETRY_EVENTS, CRITICAL_EVENTS } = require('../../shared/models/Telemetry');
const { objectId, location, pagination } = require('../../shared/validation/common');

// Device clocks drift a little; anything further in the future is a broken clock
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const recordedAt = Joi.date()
  .iso()
  .custom((value, helpers) =>
    value.getTime() > Date.now() + MAX_CLOCK_SKEW_MS ? helpers.error('date.tooFarAhead') : value,
  )
  .messages({ 'date.tooFarAhead': '{{#label}} cannot be more than 5 minutes in the future' });

const percent = Joi.number().min(0).max(100);

const createTelemetryBody = Joi.object({
  vehicleId: objectId.required(),
  location: location.required(),
  speed: Joi.number().min(0).max(300),
  heading: Joi.number().min(0).less(360),
  batteryLevel: percent,
  fuelLevel: percent,
  engineTemp: Joi.number().min(-40).max(200),
  event: Joi.string()
    .valid(...TELEMETRY_EVENTS)
    .default('none'),
  recordedAt,
});

// `to` must not be before `from`
const dateRange = {
  from: Joi.date().iso(),
  to: Joi.date()
    .iso()
    .when('from', { is: Joi.exist(), then: Joi.date().min(Joi.ref('from')) }),
};

const historyQuery = Joi.object({
  event: Joi.string().valid(...TELEMETRY_EVENTS),
  ...dateRange,
  ...pagination,
});

const eventsQuery = Joi.object({
  event: Joi.string().valid(...CRITICAL_EVENTS),
  vehicleId: objectId,
  ...dateRange,
  ...pagination,
});

const vehicleIdParams = Joi.object({ vehicleId: objectId.required() });

module.exports = { createTelemetryBody, historyQuery, eventsQuery, vehicleIdParams };
