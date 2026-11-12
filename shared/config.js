const Joi = require('joi');

const serviceUrl = (defaultUrl) =>
  Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default(defaultUrl);

// Validate environment variables once at startup so misconfiguration fails fast and loudly.
const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error', 'silent').default('info'),
  PORT: Joi.number().port().default(3000),
  MONGO_URI: Joi.string().pattern(/^mongodb(\+srv)?:\/\//, 'MongoDB connection string'),

  // API Gateway
  API_KEYS: Joi.string().allow(''),
  RATE_LIMIT_WINDOW_MS: Joi.number()
    .integer()
    .min(1000)
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(100),
  PROXY_TIMEOUT_MS: Joi.number().integer().min(100).default(10000),

  // Service locations (Docker Compose service names resolve as hostnames)
  USER_SERVICE_URL: serviceUrl('http://user-service:3001'),
  VEHICLE_SERVICE_URL: serviceUrl('http://vehicle-service:3002'),
  TELEMETRY_SERVICE_URL: serviceUrl('http://telemetry-service:3003'),
  MAPS_SERVICE_URL: serviceUrl('http://maps-service:3004'),
  NOTIFICATION_SERVICE_URL: serviceUrl('http://notification-service:3005'),
}).unknown(true);

const { value: env, error } = schema.validate(process.env, { abortEarly: false });

if (error) {
  throw new Error(`Invalid environment configuration: ${error.message}`);
}

module.exports = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  logLevel: env.LOG_LEVEL,
  port: env.PORT,
  mongoUri: env.MONGO_URI,

  gateway: {
    apiKeys: (env.API_KEYS ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean),
    rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
    proxyTimeoutMs: env.PROXY_TIMEOUT_MS,
  },

  services: {
    users: env.USER_SERVICE_URL,
    vehicles: env.VEHICLE_SERVICE_URL,
    telemetry: env.TELEMETRY_SERVICE_URL,
    maps: env.MAPS_SERVICE_URL,
    notifications: env.NOTIFICATION_SERVICE_URL,
  },
};
