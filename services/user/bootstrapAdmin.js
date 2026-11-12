const config = require('../../shared/config');
const User = require('../../shared/models/User');
const { createUser } = require('./service');

/**
 * Makes sure the system has an admin. On a fresh database, creates one from the ADMIN_* env vars.
 * Never creates a second admin and never changes an existing account.
 * @returns {Promise<boolean>} true if an admin was created
 */
async function ensureBootstrapAdmin(logger, admin = config.admin) {
  if (await User.exists({ role: 'admin' })) return false;

  if (!admin.email || !admin.password) {
    logger.warn('No admin exists and ADMIN_EMAIL / ADMIN_PASSWORD are not set; skipping bootstrap');
    return false;
  }

  await createUser({ ...admin, role: 'admin' });
  logger.info(`Bootstrap admin created (${admin.email})`);
  return true;
}

module.exports = ensureBootstrapAdmin;
