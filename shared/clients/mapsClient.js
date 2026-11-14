const config = require('../config');

// Address → { lat, lng, displayName }, or null if not found. Throws if maps-service fails.
async function geocode(address, options = {}) {
  const {
    baseUrl = config.services.maps,
    token = config.internal.token,
    // 2 Nominatim attempts + queueing, still under the gateway's 10 s timeout
    timeoutMs = config.geocoder.timeoutMs * 2 + 1000,
  } = options;

  const url = new URL('/internal/geocode', baseUrl);
  url.searchParams.set('address', address);

  const res = await fetch(url, {
    headers: { 'x-internal-token': token },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`maps-service answered ${res.status}`);
  const { lat, lng, displayName } = await res.json();
  return { lat, lng, displayName };
}

module.exports = { geocode };
