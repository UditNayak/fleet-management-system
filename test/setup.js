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
    // Build indexes (e.g. unique email) before any test relies on them
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  },

  // Empty every collection but keep the indexes, so each test starts clean
  async afterEach() {
    await Promise.all(
      Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
    );
  },

  async afterAll() {
    await disconnectDB();
  },
};
