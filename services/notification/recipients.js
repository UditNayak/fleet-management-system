const User = require('../../shared/models/User');

/**
 * Who gets an SMS for this event:
 *  - status_change:  admins + fleet managers + the vehicle's assigned driver
 *  - critical_event: admins + fleet managers ("fleet administrators")
 * Only active users with a phone. One SMS per phone number, even if two accounts share it.
 */
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
