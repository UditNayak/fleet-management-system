const config = require('../config');

/**
 * Asks notification-service to send SMS for an event and returns its summary ({ sent, failed }).
 * Throws if the service is unreachable, too slow or answers with an error;
 * callers decide what to do (vehicle-service just logs it).
 */
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
