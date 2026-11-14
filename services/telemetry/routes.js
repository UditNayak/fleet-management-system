const express = require('express');
const controller = require('./controller');
const v = require('./validators');
const validate = require('../../shared/middleware/validate');
const { authenticate } = require('../../shared/middleware/auth');
const { authorize } = require('../../shared/middleware/rbac');

const router = express.Router();

// All roles; the service limits drivers to their own vehicle
router.post('/', authenticate, validate({ body: v.createTelemetryBody }), controller.record);
router.get(
  '/vehicle/:vehicleId',
  authenticate,
  validate({ params: v.vehicleIdParams, query: v.historyQuery }),
  controller.history,
);
router.get(
  '/events',
  authenticate,
  authorize('admin', 'fleet_manager'),
  validate({ query: v.eventsQuery }),
  controller.events,
);

module.exports = router;
