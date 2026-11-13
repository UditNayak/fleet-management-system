const Joi = require('joi');
const { VEHICLE_TYPES, VEHICLE_STATUSES } = require('../../shared/models/Vehicle');

const lat = Joi.number().min(-90).max(90);
const lng = Joi.number().min(-180).max(180);
const address = Joi.string().trim().min(3).max(200);
const status = Joi.string().valid(...VEHICLE_STATUSES);
const type = Joi.string().valid(...VEHICLE_TYPES);

const geocodeQuery = Joi.object({ address: address.required() });

const reverseQuery = Joi.object({ lat: lat.required(), lng: lng.required() });

// The centre is either a point (lat + lng) or an address — exactly one of the two
const nearbyQuery = Joi.object({
  lat,
  lng,
  address,
  radiusKm: Joi.number().min(0.1).max(100).default(5),
  status,
  type,
  limit: Joi.number().integer().min(1).max(100).default(50),
})
  .and('lat', 'lng') // lat and lng only together
  .xor('lat', 'address') // one centre, not both, not neither
  .messages({
    'object.xor': 'Give either lat and lng, or address (not both)',
    'object.missing': 'Give either lat and lng, or address',
  });

const mapVehiclesQuery = Joi.object({ status, type });

module.exports = { geocodeQuery, reverseQuery, nearbyQuery, mapVehiclesQuery };
