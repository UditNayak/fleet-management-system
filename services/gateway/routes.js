const config = require('../../shared/config');

// Gateway routing table: /api<path>/* → target service
module.exports = [
  { path: '/users', name: 'user-service', target: config.services.users },
  { path: '/vehicles', name: 'vehicle-service', target: config.services.vehicles },
  { path: '/telemetry', name: 'telemetry-service', target: config.services.telemetry },
  { path: '/maps', name: 'maps-service', target: config.services.maps },
  { path: '/notifications', name: 'notification-service', target: config.services.notifications },
];
