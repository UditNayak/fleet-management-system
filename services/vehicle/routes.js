const express = require('express');
const controller = require('./controller');
const v = require('./validators');
const validate = require('../../shared/middleware/validate');
const { authenticate } = require('../../shared/middleware/auth');
const { authorize } = require('../../shared/middleware/rbac');

const router = express.Router();

// Who may do what (see the role matrix in the API docs)
const anyRole = [authenticate];
const managers = [authenticate, authorize('admin', 'fleet_manager')];
const adminOnly = [authenticate, authorize('admin')];

const byId = validate({ params: v.vehicleIdParams });

router.post('/', ...managers, validate({ body: v.createVehicleBody }), controller.create);
router.get('/', ...anyRole, validate({ query: v.listVehiclesQuery }), controller.list);
router.get('/:id', ...anyRole, byId, controller.getById);
router.patch(
  '/:id',
  ...managers,
  validate({ params: v.vehicleIdParams, body: v.updateVehicleBody }),
  controller.update,
);
router.patch(
  '/:id/status',
  ...managers,
  validate({ params: v.vehicleIdParams, body: v.changeStatusBody }),
  controller.changeStatus,
);
router.delete('/:id', ...adminOnly, byId, controller.remove);

module.exports = router;
