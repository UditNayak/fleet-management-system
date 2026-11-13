const service = require('./service');

const SOURCE = 'OpenStreetMap Nominatim';

async function geocode(req, res) {
  const { address } = req.query;
  res.json({ query: address, ...(await service.geocode(address)), source: SOURCE });
}

async function reverse(req, res) {
  const { lat, lng } = req.query;
  res.json({ lat, lng, ...(await service.reverseGeocode(lat, lng)), source: SOURCE });
}

async function nearby(req, res) {
  res.json(await service.findNearby(req.query));
}

async function vehicles(req, res) {
  res.json(await service.listMapVehicles(req.query));
}

module.exports = { geocode, reverse, nearby, vehicles };
