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

  // Authentication
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]?$/, 'duration like 3600, 15m, 1h or 7d')
    .default('1h'),
  BCRYPT_ROUNDS: Joi.number().integer().min(4).max(15).default(10),

  // Bootstrap admin, created by user-service on first start if no admin exists
  ADMIN_NAME: Joi.string().default('Fleet Admin'),
  ADMIN_EMAIL: Joi.string().email(),
  ADMIN_PASSWORD: Joi.string().min(8),
  ADMIN_PHONE: Joi.string().pattern(/^\+[1-9]\d{7,14}$/, 'E.164 phone number'),

  // Service locations (Docker Compose service names resolve as hostnames)
  USER_SERVICE_URL: serviceUrl('http://user-service:3001'),
  VEHICLE_SERVICE_URL: serviceUrl('http://vehicle-service:3002'),
  TELEMETRY_SERVICE_URL: serviceUrl('http://telemetry-service:3003'),
  MAPS_SERVICE_URL: serviceUrl('http://maps-service:3004'),
  NOTIFICATION_SERVICE_URL: serviceUrl('http://notification-service:3005'),

  // Service-to-service calls (e.g. vehicle-service → notification-service)
  INTERNAL_SERVICE_TOKEN: Joi.string().min(32).required(),
  NOTIFY_TIMEOUT_MS: Joi.number().integer().min(100).default(3000),

  // SMS notifications (only the mock provider for now; Twilio is optional later)
  SMS_PROVIDER: Joi.string().valid('mock').default('mock'),

  // Telemetry: minimum time between two SMS alerts for the same vehicle + event
  ALERT_COOLDOWN_MS: Joi.number()
    .integer()
    .min(0)
    .default(5 * 60 * 1000),
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

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },
  bcryptRounds: env.BCRYPT_ROUNDS,

  admin: {
    name: env.ADMIN_NAME,
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    phone: env.ADMIN_PHONE,
  },

  services: {
    users: env.USER_SERVICE_URL,
    vehicles: env.VEHICLE_SERVICE_URL,
    telemetry: env.TELEMETRY_SERVICE_URL,
    maps: env.MAPS_SERVICE_URL,
    notifications: env.NOTIFICATION_SERVICE_URL,
  },

  internal: {
    token: env.INTERNAL_SERVICE_TOKEN,
    notifyTimeoutMs: env.NOTIFY_TIMEOUT_MS,
  },

  sms: {
    provider: env.SMS_PROVIDER,
  },

  telemetry: {
    alertCooldownMs: env.ALERT_COOLDOWN_MS,
  },
};
