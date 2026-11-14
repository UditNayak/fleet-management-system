const Joi = require('joi');
const { VEHICLE_TYPES, VEHICLE_STATUSES } = require('../../shared/models/Vehicle');
const { objectId, location, pagination } = require('../../shared/validation/common');

// Indian format, e.g. KA01AB1234. Input like "ka-01 ab 1234" is normalised first.
const registrationNumber = Joi.string()
  .trim()
  .uppercase()
  .replace(/[\s-]/g, '')
  .pattern(/^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$/)
  .messages({
    'string.pattern.base': '{{#label}} must be a valid registration number, e.g. KA01AB1234',
  });

const model = Joi.string().trim().min(2).max(100);
const type = Joi.string().valid(...VEHICLE_TYPES);
const year = Joi.number()
  .integer()
  .min(1990)
  .max(new Date().getFullYear() + 1);
const address = Joi.string().trim().max(200);
const status = Joi.string().valid(...VEHICLE_STATUSES);

// No `status` here: it only changes via PATCH /:id/status (history + SMS)
const createVehicleBody = Joi.object({
  registrationNumber: registrationNumber.required(),
  model: model.required(),
  type: type.required(),
  year,
  address,
  location,
  assignedDriver: objectId,
});

// null clears an optional field
const updateVehicleBody = Joi.object({
  model,
  type,
  year,
  address: address.allow(null),
  location: location.allow(null),
  assignedDriver: objectId.allow(null),
}).min(1);

const changeStatusBody = Joi.object({
  status: status.required(),
  reason: Joi.string().trim().max(200),
});

const SORT_FIELDS = ['createdAt', 'updatedAt', 'registrationNumber'];

const listVehiclesQuery = Joi.object({
  status,
  type,
  assignedDriver: objectId,
  search: Joi.string().trim().max(20),
  sort: Joi.string()
    .valid(...SORT_FIELDS.flatMap((field) => [field, `-${field}`]))
    .default('-createdAt'),
  ...pagination,
});

const vehicleIdParams = Joi.object({ id: objectId.required() });

module.exports = {
  createVehicleBody,
  updateVehicleBody,
  changeStatusBody,
  listVehiclesQuery,
  vehicleIdParams,
};
