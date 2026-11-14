const User = require('../../shared/models/User');

// status_change: admins, fleet managers, assigned driver
// critical_event: admins, fleet managers
// Active users with a phone only, one SMS per number
async function findRecipients({ type, vehicle }) {
  const who = [{ role: { $in: ['admin', 'fleet_manager'] } }];
  if (type === 'status_change' && vehicle.assignedDriver) {
    who.push({ _id: vehicle.assignedDriver, role: 'driver' });
  }

  const users = await User.find({
    $or: who,
    isActive: true,
    phone: { $exists: true, $nin: [null, ''] },
  })
    .select('name role phone')
    .sort({ createdAt: 1 });

  const seenPhones = new Set();
  return users.filter((user) => {
    if (seenPhones.has(user.phone)) return false;
    seenPhones.add(user.phone);
    return true;
  });
}

module.exports = { findRecipients };
