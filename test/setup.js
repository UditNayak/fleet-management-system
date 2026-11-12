const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../shared/db');

// Mocha root hooks: run around the whole test suite
exports.mochaHooks = {
  async beforeAll() {
    const uri = process.env.MONGO_URI;
    // Safety net: tests wipe the database, so never let them run against Atlas
    if (!uri || uri.includes('mongodb.net')) {
      throw new Error('Tests must run against the local mongo-test container, not Atlas');
    }
    await connectDB(uri);
  },

  async afterEach() {
    await mongoose.connection.db.dropDatabase();
  },

  async afterAll() {
    await disconnectDB();
  },
};
