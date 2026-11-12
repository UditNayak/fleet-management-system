const CHECK_TIMEOUT_MS = 2000;

async function checkService({ name, target }) {
  const started = Date.now();
  try {
    const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    const body = await res.json().catch(() => ({}));
    return {
      name,
      status: res.ok ? 'up' : 'degraded',
      db: body.db,
      responseTimeMs: Date.now() - started,
    };
  } catch {
    return { name, status: 'down', responseTimeMs: Date.now() - started };
  }
}

// GET /health/services — pings every backend service in parallel
function servicesHealth(services) {
  return async (_req, res) => {
    const results = await Promise.all(services.map(checkService));
    const allUp = results.every((s) => s.status === 'up');
    res.status(allUp ? 200 : 503).json({
      status: allUp ? 'ok' : 'degraded',
      services: results,
      timestamp: new Date().toISOString(),
    });
  };
}

module.exports = servicesHealth;
