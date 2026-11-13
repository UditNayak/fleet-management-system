const Joi = require('joi');

// Reusable Joi building blocks shared by all services
const objectId = Joi.string().hex().length(24).messages({
  'string.hex': '{{#label}} must be a valid id',
  'string.length': '{{#label}} must be a valid id',
});

const phone = Joi.string()
  .trim()
  .pattern(/^\+[1-9]\d{7,14}$/)
  .messages({
    'string.pattern.base': '{{#label}} must be in international format, e.g. +919876543210',
  });

// Clients send coordinates as { lat, lng }; models convert to GeoJSON internally
const location = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
});

const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};

module.exports = { objectId, phone, location, pagination };
