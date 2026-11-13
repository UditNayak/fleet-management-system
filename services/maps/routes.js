const express = require('express');
const controller = require('./controller');
const v = require('./validators');
const validate = require('../../shared/middleware/validate');
const internalAuth = require('../../shared/middleware/internalAuth');
const { authenticate } = require('../../shared/middleware/auth');

const router = express.Router();

// Internal: vehicle-service geocodes vehicle addresses here (never reachable through the gateway)
router.get(
  '/internal/geocode',
  internalAuth(),
  validate({ query: v.geocodeQuery }),
  controller.geocode,
);

// Public (via gateway): any logged-in user, every role
router.get('/geocode', authenticate, validate({ query: v.geocodeQuery }), controller.geocode);
router.get('/reverse', authenticate, validate({ query: v.reverseQuery }), controller.reverse);
router.get('/nearby', authenticate, validate({ query: v.nearbyQuery }), controller.nearby);
router.get('/vehicles', authenticate, validate({ query: v.mapVehiclesQuery }), controller.vehicles);

module.exports = router;
