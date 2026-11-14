const Vehicle = require('../../shared/models/Vehicle');
const geocoder = require('./geocoder');

const { toPoint, toLatLng } = Vehicle;

// Small, map-friendly vehicle shape (no status history, location as { lat, lng })
const toMapVehicle = (doc) => ({
  id: doc._id.toString(),
  registrationNumber: doc.registrationNumber,
  model: doc.model,
  type: doc.type,
  status: doc.status,
  address: doc.address ?? null,
  location: toLatLng(doc.location),
  locationSource: doc.locationSource ?? null,
  lastSeenAt: doc.lastSeenAt ?? null,
  assignedDriver: doc.assignedDriver?.toString() ?? null,
});

const round = (value, decimals) => Number(value.toFixed(decimals));

// Not destructured, so tests can stub it
const geocode = (address) => geocoder.search(address);
const reverseGeocode = (lat, lng) => geocoder.reverse(lat, lng);

async function findNearby({ lat, lng, address, radiusKm, status, type, limit }) {
  const center = address ? await geocoder.search(address) : { lat, lng };

  const query = {};
  if (status) query.status = status;
  if (type) query.type = type;

  // $geoNear must be the first stage; uses the 2dsphere index, nearest first
  const docs = await Vehicle.aggregate([
    {
      $geoNear: {
        near: toPoint(center),
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query,
      },
    },
    { $limit: limit },
  ]);

  return {
    center: {
      lat: center.lat,
      lng: center.lng,
      ...(address && { displayName: center.displayName }),
    },
    radiusKm,
    count: docs.length,
    vehicles: docs.map((doc) => ({
      ...toMapVehicle(doc),
      distanceKm: round(doc.distanceMeters / 1000, 2),
    })),
  };
}

async function listMapVehicles({ status, type }) {
  const filter = { location: { $exists: true } };
  if (status) filter.status = status;
  if (type) filter.type = type;

  const docs = await Vehicle.find(filter)
    .select('-statusHistory')
    .sort({ registrationNumber: 1 })
    .lean();
  return { count: docs.length, vehicles: docs.map(toMapVehicle) };
}

module.exports = { geocode, reverseGeocode, findNearby, listMapVehicles };
