// Short and ASCII-only: one non-ASCII character cuts the SMS limit from 160 to 70
const MAX_LENGTH = 160;

const EVENT_LABELS = {
  engine_fault: 'ENGINE FAULT',
  low_battery: 'LOW BATTERY',
  emergency_stop: 'EMERGENCY STOP',
};

const truncate = (text) =>
  text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 3)}...` : text;

function buildMessage(event) {
  const reg = event.vehicle.registrationNumber;

  if (event.type === 'status_change') {
    const { from, to, reason } = event.change;
    return truncate(`[Fleet] ${reg} status: ${from} -> ${to}${reason ? ` (${reason})` : ''}`);
  }

  // critical_event
  const where = event.location
    ? ` at ${event.location.lat.toFixed(4)},${event.location.lng.toFixed(4)}`
    : '';
  return truncate(`[Fleet ALERT] ${reg} reported ${EVENT_LABELS[event.event]}${where}`);
}

module.exports = { buildMessage, MAX_LENGTH };
