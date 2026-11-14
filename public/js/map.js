import { api } from './api.js';
import { $, h, toast, timeAgo, humanize, formatLatLng, updatedLabel } from './ui.js';

const BANGALORE = [12.9716, 77.5946];
const STATUSES = ['active', 'idle', 'maintenance', 'inactive'];
const COLORS = {
  active: '#16a34a',
  idle: '#2563eb',
  maintenance: '#ea580c',
  inactive: '#6b7280',
};

// Map tab: vehicle pins, nearby search, status changes
export function createMapPage({ canManage }) {
  const map = L.map('map').setView(BANGALORE, 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    referrerPolicy: 'strict-origin-when-cross-origin', // OSM needs a Referer
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const vehicles = new Map(); // id → latest vehicle data
  const markers = new Map(); // id → Leaflet circleMarker
  let highlighted = new Set(); // ids found by the last nearby search
  let search = null; // { lat, lng, radiusKm } of the last nearby search
  const searchLayer = L.layerGroup().addTo(map);

  const form = $('#nearby-form');
  const radiusOutput = $('#radius-value');
  const radiusKm = () => Number(form.radiusKm.value);

  // ---------- pins ----------
  function styleFor(vehicle) {
    const found = highlighted.has(vehicle.id);
    return {
      radius: found ? 11 : 8,
      color: found ? '#111827' : '#ffffff',
      weight: found ? 3 : 2,
      fillColor: COLORS[vehicle.status] ?? COLORS.inactive,
      fillOpacity: 0.9,
    };
  }

  function popupFor(id) {
    const v = vehicles.get(id);
    if (!v) return 'Vehicle no longer on the map';
    const reason = h('input', { placeholder: 'Reason (optional)', maxlength: 200 });

    const actions = canManage
      ? h(
          'div',
          {},
          reason,
          h(
            'div',
            { className: 'actions' },
            STATUSES.filter((s) => s !== v.status).map((status) =>
              h('button', { onclick: () => changeStatus(v, status, reason.value) }, `→ ${status}`),
            ),
          ),
        )
      : null;

    return h(
      'div',
      { className: 'popup' },
      h('h3', {}, v.registrationNumber),
      h('span', { className: `badge ${v.status}` }, v.status),
      h(
        'dl',
        {},
        h('dt', {}, 'Model'),
        h('dd', {}, `${v.model} (${v.type})`),
        h('dt', {}, 'Address'),
        h('dd', {}, v.address ?? '—'),
        h('dt', {}, 'Position'),
        h('dd', {}, formatLatLng(v.location)),
        h('dt', {}, 'Source'),
        h('dd', {}, v.locationSource ?? '—'),
        h('dt', {}, 'Last seen'),
        h('dd', {}, timeAgo(v.lastSeenAt)),
      ),
      actions,
    );
  }

  function upsertMarker(v) {
    const latLng = [v.location.lat, v.location.lng];
    let marker = markers.get(v.id);
    if (!marker) {
      marker = L.circleMarker(latLng).addTo(map);
      marker.bindPopup(() => popupFor(v.id));
      marker.bindTooltip(v.registrationNumber);
      markers.set(v.id, marker);
    }
    marker.setLatLng(latLng); // moves the pin when telemetry updated the position
    marker.setStyle(styleFor(v));
  }

  function renderLegend() {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    vehicles.forEach((v) => (counts[v.status] += 1));
    $('#legend').replaceChildren(
      ...STATUSES.map((s) =>
        h('li', {}, h('span', { className: `dot ${s}` }), `${s} `, h('strong', {}, counts[s])),
      ),
      h('li', { className: 'muted' }, `${vehicles.size} vehicles with a location`),
    );
  }

  async function loadVehicles() {
    const { vehicles: list } = await api('/api/maps/vehicles');
    const seen = new Set();
    for (const v of list) {
      seen.add(v.id);
      vehicles.set(v.id, v);
      upsertMarker(v);
    }
    for (const id of [...markers.keys()]) {
      if (!seen.has(id)) {
        markers.get(id).remove();
        markers.delete(id);
        vehicles.delete(id);
      }
    }
    renderLegend();
  }

  // ---------- status change (admin / fleet manager) ----------
  async function changeStatus(vehicle, status, reason) {
    try {
      const res = await api(`/api/vehicles/${vehicle.id}/status`, {
        method: 'PATCH',
        body: { status, ...(reason.trim() && { reason: reason.trim() }) },
      });
      const sms = res.notifications
        ? `SMS: ${res.notifications.sent} sent, ${res.notifications.failed} failed`
        : 'SMS could not be sent (notification service unavailable)';
      toast(
        `${vehicle.registrationNumber}: ${res.change.from} → ${res.change.to}. ${sms}`,
        'ok',
        8000,
      );
      map.closePopup();
      await refresh();
    } catch (err) {
      toast(`Status change failed: ${err.message}`, 'error');
    }
  }

  // ---------- nearby search ----------
  function renderNearby(result) {
    const { center, vehicles: found } = result;
    highlighted = new Set(found.map((v) => v.id));
    vehicles.forEach((v) => markers.get(v.id)?.setStyle(styleFor(v)));

    searchLayer.clearLayers();
    const circle = L.circle([center.lat, center.lng], {
      radius: result.radiusKm * 1000,
      color: '#2563eb',
      weight: 2,
      fillOpacity: 0.08,
    }).addTo(searchLayer);
    L.marker([center.lat, center.lng])
      .bindTooltip(center.displayName ?? 'Search centre')
      .addTo(searchLayer);

    const where = center.displayName
      ? center.displayName.split(',').slice(0, 2).join(',')
      : formatLatLng(center);
    $('#nearby-summary').textContent =
      `${found.length} vehicle(s) within ${result.radiusKm} km of ${where}`;
    $('#nearby-list').replaceChildren(
      ...found.map((v) =>
        h(
          'li',
          {
            onclick: () => {
              map.setView([v.location.lat, v.location.lng], 15);
              markers.get(v.id)?.openPopup();
            },
          },
          h('strong', {}, v.registrationNumber),
          ` · ${v.distanceKm} km · `,
          h('span', { className: `dot ${v.status}` }),
          humanize(v.status),
        ),
      ),
    );
    return circle;
  }

  async function runNearby(query, { fit = true } = {}) {
    try {
      const result = await api('/api/maps/nearby', { query: { ...query, radiusKm: radiusKm() } });
      // Keep the centre as coordinates so refreshes don't geocode again
      search = {
        lat: result.center.lat,
        lng: result.center.lng,
        displayName: result.center.displayName,
      };
      const circle = renderNearby(result);
      if (fit) map.fitBounds(circle.getBounds(), { padding: [20, 20] });
    } catch (err) {
      const message =
        err.code === 'ADDRESS_NOT_FOUND'
          ? 'Address not found on OpenStreetMap'
          : err.code === 'GEOCODER_UNAVAILABLE'
            ? 'Geocoder (OpenStreetMap) unavailable, try again'
            : err.message;
      toast(message, 'error');
    }
  }

  function clearNearby() {
    search = null;
    highlighted = new Set();
    searchLayer.clearLayers();
    vehicles.forEach((v) => markers.get(v.id)?.setStyle(styleFor(v)));
    $('#nearby-summary').textContent = '';
    $('#nearby-list').replaceChildren();
    form.address.value = '';
  }

  map.on('click', (e) => runNearby({ lat: e.latlng.lat.toFixed(5), lng: e.latlng.lng.toFixed(5) }));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const address = form.address.value.trim();
    if (address.length < 3) return toast('Type an address (or click the map)', 'error');
    runNearby({ address });
  });

  form.radiusKm.addEventListener('input', () => {
    radiusOutput.textContent = `${radiusKm()} km`;
  });
  // Re-run the current search when the slider is released
  form.radiusKm.addEventListener('change', () => {
    if (search) runNearby({ lat: search.lat, lng: search.lng }, { fit: true });
  });

  $('#nearby-clear').addEventListener('click', clearNearby);
  $('#map-refresh').addEventListener('click', () => refresh().catch(() => {}));

  async function refresh() {
    await loadVehicles();
    if (search) {
      const result = await api('/api/maps/nearby', {
        query: { lat: search.lat, lng: search.lng, radiusKm: radiusKm() },
      });
      renderNearby({ ...result, center: { ...result.center, displayName: search.displayName } });
    }
    updatedLabel('#map-updated');
  }

  return {
    refresh,
    // Leaflet needs this after the tab is shown again
    activate: () => map.invalidateSize(),
    focus(location) {
      map.setView([location.lat, location.lng], 15);
    },
    destroy: () => map.remove(),
  };
}
