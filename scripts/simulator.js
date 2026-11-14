// Movement and battery maths for the simulator (no I/O, unit-tested)

const EARTH_RADIUS_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (radians) => (radians * 180) / Math.PI;
const round = (value, decimals) => Number(value.toFixed(decimals));

function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Compass bearing from a to b (0 = north, 90 = east)
function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Straight-line interpolation is accurate enough over a few km
const interpolate = (a, b, t) => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});

// Moves `km` along the route. state = { leg, progress 0..1 }
function advance(route, { leg, progress }, km) {
  let remaining = km;
  let currentLeg = leg;
  let currentProgress = progress;

  for (;;) {
    const from = route[currentLeg];
    const to = route[(currentLeg + 1) % route.length];
    const legKm = distanceKm(from, to);
    const leftOnLeg = legKm * (1 - currentProgress);

    if (remaining < leftOnLeg || legKm === 0) {
      currentProgress = legKm === 0 ? 1 : currentProgress + remaining / legKm;
      const position = interpolate(from, to, currentProgress);
      return {
        leg: currentLeg,
        progress: currentProgress,
        position: { lat: round(position.lat, 6), lng: round(position.lng, 6) },
        heading: round(bearing(from, to), 1) % 360,
      };
    }
    remaining -= leftOnLeg;
    currentLeg = (currentLeg + 1) % route.length; // loop back to the start
    currentProgress = 0;
  }
}

// Drains the battery; reports low_battery once when it drops below `low`
function drainBattery(level, drain, { low = 15, recharge = 5, full = 95 } = {}) {
  const next = level - drain;
  const event = level >= low && next < low ? 'low_battery' : 'none';
  return { level: round(next <= recharge ? full : next, 1), event };
}

module.exports = { distanceKm, bearing, advance, drainBattery };
