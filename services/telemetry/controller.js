const service = require('./service');

async function record(req, res) {
  res.status(201).json(await service.recordTelemetry(req.body, req.user));
}

async function history(req, res) {
  res.json(await service.getHistory(req.params.vehicleId, req.query, req.user));
}

async function events(req, res) {
  res.json(await service.listCriticalEvents(req.query));
}

module.exports = { record, history, events };
