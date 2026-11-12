const express = require('express');
const controller = require('./controller');
const v = require('./validators');
const validate = require('../../shared/middleware/validate');
const { authenticate } = require('../../shared/middleware/auth');
const { authorize } = require('../../shared/middleware/rbac');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];

// Public
router.post('/register', validate({ body: v.registerBody }), controller.register);
router.post('/login', validate({ body: v.loginBody }), controller.login);

// Any logged-in user (declared before /:id so "me" isn't treated as an id)
router.get('/me', authenticate, controller.me);

// Admin only
router.get('/', ...adminOnly, validate({ query: v.listUsersQuery }), controller.list);
router.post('/', ...adminOnly, validate({ body: v.createUserBody }), controller.create);
router.get('/:id', ...adminOnly, validate({ params: v.userIdParams }), controller.getById);
router.patch(
  '/:id',
  ...adminOnly,
  validate({ params: v.userIdParams, body: v.updateUserBody }),
  controller.update,
);

module.exports = router;
