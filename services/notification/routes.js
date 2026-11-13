const express = require('express');
const controller = require('./controller');
const v = require('./validators');
const validate = require('../../shared/middleware/validate');
const internalAuth = require('../../shared/middleware/internalAuth');
const { authenticate } = require('../../shared/middleware/auth');
const { authorize } = require('../../shared/middleware/rbac');

const router = express.Router();

// Internal: called by other services (never reachable through the gateway)
router.post(
  '/internal/events',
  internalAuth(),
  validate({ body: v.eventBody }),
  controller.dispatch,
);

// Public (via gateway): the SMS log, for admins and fleet managers
const readers = [authenticate, authorize('admin', 'fleet_manager')];

router.get('/', ...readers, validate({ query: v.listNotificationsQuery }), controller.list);
router.get('/stats', ...readers, controller.stats); // before /:id, or "stats" would be taken as an id
router.get('/:id', ...readers, validate({ params: v.notificationIdParams }), controller.getById);

module.exports = router;
