const config = require('../config');

// Sends an event to notification-service, returns { sent, failed }. Throws on failure.
async function notify(event, options = {}) {
  const {
    baseUrl = config.services.notifications,
    token = config.internal.token,
    timeoutMs = config.internal.notifyTimeoutMs,
  } = options;

  const res = await fetch(`${baseUrl}/internal/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(timeoutMs), // give up instead of hanging the caller
  });

  if (!res.ok) {
    throw new Error(`notification-service answered ${res.status}`);
  }
  const { summary } = await res.json();
  return summary;
}

module.exports = { notify };
