const service = require('./service');

async function dispatch(req, res) {
  res.status(201).json(await service.dispatchEvent(req.body));
}

async function list(req, res) {
  res.json(await service.listNotifications(req.query));
}

async function stats(_req, res) {
  res.json(await service.getStats());
}

async function getById(req, res) {
  res.json({ notification: await service.getNotification(req.params.id) });
}

module.exports = { dispatch, list, stats, getById };
