const config = require('../../shared/config');
const AppError = require('../../shared/errors/AppError');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('maps-service');

const MIN_INTERVAL_MS = 1000; // Nominatim usage policy: at most 1 request per second
const MAX_ATTEMPTS = 2; // first try + one retry after a network error / timeout
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unavailable = () =>
  new AppError(
    503,
    'GEOCODER_UNAVAILABLE',
    'The geocoding service is unavailable, try again later',
  );

/**
 * Builds a polite Nominatim client: it identifies itself (User-Agent), waits ≥ 1 s between
 * calls, caches answers and maps every failure to a clean AppError.
 * Options are injectable so tests can pass a fake fetch and a shorter interval.
 */
function createGeocoder({
  baseUrl = config.geocoder.baseUrl,
  userAgent = config.geocoder.userAgent,
  timeoutMs = config.geocoder.timeoutMs,
  countryCodes = config.geocoder.countryCodes,
  minIntervalMs = MIN_INTERVAL_MS,
  fetchFn = (...args) => fetch(...args),
} = {}) {
  const cache = new Map(); // key → { value, expiresAt }; a Map keeps insertion order (oldest first)
  let nextSlot = 0; // earliest time the next request may start

  // Reserve the next free slot synchronously, so concurrent callers queue up instead of racing
  async function throttle() {
    const now = Date.now();
    const startAt = Math.max(now, nextSlot);
    nextSlot = startAt + minIntervalMs;
    if (startAt > now) await sleep(startAt - now);
  }

  function fromCache(key) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    cache.delete(key);
    return undefined;
  }

  function remember(key, value) {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value); // drop the oldest
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  // The public Nominatim server sometimes stalls for a few seconds, so a network error or
  // timeout is retried once (still throttled). HTTP errors like 429 are never retried.
  async function fetchWithRetry(url) {
    for (let attempt = 1; ; attempt += 1) {
      await throttle();
      try {
        return await fetchFn(url, {
          headers: { 'User-Agent': userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const reason = err.name === 'TimeoutError' ? 'timeout' : err.message;
        logger.warn(`Nominatim unreachable (attempt ${attempt}/${MAX_ATTEMPTS}): ${reason}`);
        if (attempt >= MAX_ATTEMPTS) throw unavailable();
      }
    }
  }

  async function callNominatim(path, params) {
    const url = new URL(path, baseUrl);
    url.search = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'en', ...params });

    const res = await fetchWithRetry(url);
    if (!res.ok) {
      logger.warn(`Nominatim answered ${res.status}`); // 429 (rate limited), 5xx, …
      throw unavailable();
    }
    try {
      return await res.json();
    } catch {
      throw unavailable();
    }
  }

  // Address → { lat, lng, displayName }
  async function search(address) {
    const key = `search:${address.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const cached = fromCache(key);
    if (cached) return { ...cached, cached: true };

    const results = await callNominatim('/search', {
      q: address,
      limit: '1',
      ...(countryCodes && { countrycodes: countryCodes }),
    });
    if (!Array.isArray(results) || results.length === 0) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', `No location found for "${address}"`);
    }

    const [first] = results;
    const value = {
      lat: Number(first.lat), // Nominatim returns coordinates as strings
      lng: Number(first.lon),
      displayName: first.display_name,
    };
    remember(key, value);
    return { ...value, cached: false };
  }

  // Coordinates → { displayName, address: { road, suburb, city, … } }
  async function reverse(lat, lng) {
    const key = `reverse:${lat.toFixed(5)},${lng.toFixed(5)}`; // ~1 m precision
    const cached = fromCache(key);
    if (cached) return { ...cached, cached: true };

    const result = await callNominatim('/reverse', { lat: String(lat), lon: String(lng) });
    if (!result || result.error || !result.display_name) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', 'No address found for these coordinates');
    }

    const value = { displayName: result.display_name, address: result.address ?? {} };
    remember(key, value);
    return { ...value, cached: false };
  }

  return { search, reverse };
}

// The service uses one shared instance (one cache, one queue); tests stub its methods
const geocoder = createGeocoder();

module.exports = geocoder;
module.exports.createGeocoder = createGeocoder;
