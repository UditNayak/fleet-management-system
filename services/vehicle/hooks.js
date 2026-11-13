const { createLogger } = require('../../shared/logger');

const logger = createLogger('vehicle-service');

// Side effects triggered by vehicle events. Kept in one object so they can be swapped
// (Phase 5 sends SMS here) and replaced with fakes in tests.
const hooks = {
  async onStatusChanged(vehicle, change) {
    logger.info(
      `Status of ${vehicle.registrationNumber} changed ${change.from} → ${change.to}` +
        (change.reason ? ` (${change.reason})` : ''),
    );
  },
};

module.exports = hooks;
