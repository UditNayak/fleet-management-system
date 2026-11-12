const mongoose = require('mongoose');
const { createLogger } = require('./logger');

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

async function connectDB(uri, logger = createLogger('db')) {
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  // Log host and db name only, never the full URI (it contains credentials)
  logger.info(`MongoDB connected (${mongoose.connection.host}/${mongoose.connection.name})`);
}

function disconnectDB() {
  return mongoose.disconnect();
}

function dbStatus() {
  return STATES[mongoose.connection.readyState] ?? 'unknown';
}

module.exports = { connectDB, disconnectDB, dbStatus };
