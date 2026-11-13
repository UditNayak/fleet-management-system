const config = require('../config');

/**
 * Asks maps-service for the coordinates of an address.
 * Returns { lat, lng, displayName }, or null when the address can't be found.
 * Throws if maps-service (or Nominatim behind it) is unreachable, too slow or failing.
 */
async function geocode(address, options = {}) {
  const {
    baseUrl = config.services.maps,
    token = config.internal.token,
    // maps-service may try Nominatim twice and queue the call (1 request/s); stays below the
    // gateway's 10 s proxy timeout with the default 4 s per attempt
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
