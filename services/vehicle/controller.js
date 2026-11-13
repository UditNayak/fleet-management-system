const service = require('./service');

async function create(req, res) {
  // { vehicle, geocoding? } — geocoding is only present when an address was looked up
  res.status(201).json(await service.createVehicle(req.body, req.user));
}

async function list(req, res) {
  res.json(await service.listVehicles(req.query));
}

async function getById(req, res) {
  res.json({ vehicle: await service.getVehicle(req.params.id) });
}

async function update(req, res) {
  res.json(await service.updateVehicle(req.params.id, req.body));
}

async function changeStatus(req, res) {
  res.json(await service.changeStatus(req.params.id, req.body, req.user));
}

async function remove(req, res) {
  await service.deleteVehicle(req.params.id);
  res.status(204).end(); // success, no body
}

module.exports = { create, list, getById, update, changeStatus, remove };
