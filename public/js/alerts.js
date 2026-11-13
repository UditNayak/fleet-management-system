import { api } from './api.js';
import { $, h, formatTime, humanize, formatLatLng, updatedLabel } from './ui.js';

// The Alerts tab: critical telemetry events across the fleet (each one triggered an SMS alert)
export function createAlertsPage({ showOnMap }) {
  const readings = (t) =>
    [
      typeof t.speed === 'number' && `${t.speed} km/h`,
      typeof t.batteryLevel === 'number' && `battery ${t.batteryLevel}%`,
      typeof t.engineTemp === 'number' && `${t.engineTemp} °C`,
    ]
      .filter(Boolean)
      .join(' · ') || '—';

  const row = (t) =>
    h(
      'tr',
      {},
      h('td', {}, formatTime(t.recordedAt)),
      h('td', {}, t.vehicleRegistration ?? '(deleted vehicle)'),
      h('td', {}, h('span', { className: 'badge alert' }, humanize(t.event))),
      h(
        'td',
        {},
        h(
          'button',
          { className: 'link', onclick: () => showOnMap(t.location) },
          formatLatLng(t.location),
        ),
      ),
      h('td', { className: 'muted' }, readings(t)),
    );

  async function refresh() {
    const { data } = await api('/api/telemetry/events', { query: { limit: 50 } });
    $('#alert-rows').replaceChildren(
      ...(data.length
        ? data.map(row)
        : [h('tr', {}, h('td', { colspan: 5, className: 'empty' }, 'No critical events yet'))]),
    );
    updatedLabel('#alerts-updated');
  }

  $('#alerts-refresh').addEventListener('click', () => refresh().catch(() => {}));

  return { refresh, activate: () => {} };
}
