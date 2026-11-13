const { notify } = require('../../shared/clients/notificationClient');
const { toLatLng } = require('../../shared/models/Vehicle');

// Side effects of telemetry, kept in one object so tests can replace them
const hooks = {
  // Asks notification-service to SMS the fleet administrators; returns its { sent, failed } summary
  async onCriticalEvent(vehicle, telemetry) {
    return notify({
      type: 'critical_event',
      vehicle: {
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        assignedDriver: vehicle.assignedDriver?.toString() ?? null,
      },
      event: telemetry.event,
      location: toLatLng(telemetry.location),
    });
  },
};

module.exports = hooks;
