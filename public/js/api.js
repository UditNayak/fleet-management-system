// fetch wrapper: sends x-api-key + Bearer token. Session lives in sessionStorage.

const STORAGE_KEY = 'fleet-session';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  },
  save(value) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // storage blocked (private mode)
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },
};

// set by app.js
export const events = { onUnauthorized: () => {}, onRateLimit: () => {} };

// draft-8 header, e.g.  RateLimit: "100-in-15min"; r=87; t=600
function readRateLimit(res) {
  const header = res.headers.get('RateLimit');
  const policy = res.headers.get('RateLimit-Policy');
  if (!header) return;
  const remaining = Number(/;\s*r=(\d+)/.exec(header)?.[1]);
  const resetSeconds = Number(/;\s*t=(\d+)/.exec(header)?.[1]);
  const limit = Number(/;\s*q=(\d+)/.exec(policy ?? '')?.[1]);
  if (!Number.isNaN(remaining)) events.onRateLimit({ remaining, limit, resetSeconds });
}

// api(path, { method, query, body }) → parsed JSON, or throws ApiError
export async function api(path, { method = 'GET', query, body, auth = true, apiKey } = {}) {
  const current = session.get();
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const headers = { 'x-api-key': apiKey ?? current?.apiKey ?? '' };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && current?.token) headers.Authorization = `Bearer ${current.token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the gateway. Is Docker running?');
  }
  readRateLimit(res);

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (res.ok) return data;

  const error = new ApiError(
    res.status,
    data?.error?.code ?? 'HTTP_ERROR',
    data?.error?.message ?? `Request failed (${res.status})`,
    data?.error?.details,
  );
  if (res.status === 401 && auth && error.code.startsWith('TOKEN')) events.onUnauthorized(error);
  if (res.status === 429) {
    error.retryAfter = Number(res.headers.get('Retry-After')) || null;
  }
  throw error;
}
