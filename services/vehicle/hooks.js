const { createLogger } = require('../../shared/logger');
const { notify } = require('../../shared/clients/notificationClient');

const logger = createLogger('vehicle-service');

// Side effects triggered by vehicle events. Kept in one object so tests can replace them.
const hooks = {
  // Asks notification-service to SMS the relevant users; returns its { sent, failed } summary
  async onStatusChanged(vehicle, change) {
    logger.info(`Status of ${vehicle.registrationNumber} changed ${change.from} -> ${change.to}`);
    return notify({
      type: 'status_change',
      vehicle: {
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        assignedDriver: vehicle.assignedDriver?.toString() ?? null,
      },
      change: { from: change.from, to: change.to, ...(change.reason && { reason: change.reason }) },
    });
  },
};

module.exports = hooks;
