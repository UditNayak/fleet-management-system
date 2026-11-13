const Notification = require('../../shared/models/Notification');
const AppError = require('../../shared/errors/AppError');
const { createLogger } = require('../../shared/logger');
const { getProvider } = require('./providers');
const { findRecipients } = require('./recipients');
const { buildMessage } = require('./messages');

const logger = createLogger('notification-service');

const eventDetails = (event) =>
  event.type === 'status_change'
    ? event.change
    : { event: event.event, ...(event.location && { location: event.location }) };

// Sends one SMS and records the outcome. A failed SMS is recorded, never thrown.
async function sendOne(provider, recipient, event, message) {
  let outcome;
  try {
    const { id } = await provider.send({ to: recipient.phone, body: message });
    outcome = { status: 'sent', providerMessageId: id, sentAt: new Date() };
  } catch (err) {
    logger.warn(`SMS to ${recipient.phone} failed: ${err.message}`);
    outcome = { status: 'failed', error: err.message };
  }

  return Notification.create({
    type: event.type,
    vehicle: event.vehicle.id,
    vehicleRegistration: event.vehicle.registrationNumber,
    recipientUser: recipient._id,
    recipientRole: recipient.role,
    recipientPhone: recipient.phone,
    message,
    provider: provider.name,
    details: eventDetails(event),
    ...outcome,
  });
}

async function dispatchEvent(event) {
  const provider = getProvider();
  const recipients = await findRecipients(event);
  const message = buildMessage(event);

  // Send to everyone in parallel; each SMS succeeds or fails on its own
  const notifications = await Promise.all(
    recipients.map((recipient) => sendOne(provider, recipient, event, message)),
  );

  const summary = {
    sent: notifications.filter((n) => n.status === 'sent').length,
    failed: notifications.filter((n) => n.status === 'failed').length,
  };
  logger.info(
    `${event.type} for ${event.vehicle.registrationNumber}: ${summary.sent} sent, ${summary.failed} failed`,
  );
  return { notifications, summary };
}

async function listNotifications({ status, type, vehicleId, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (vehicleId) filter.vehicle = vehicleId;

  const [data, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
  ]);
  return { data, page, limit, total };
}

async function getNotification(id) {
  const notification = await Notification.findById(id);
  if (!notification) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  return notification;
}

// Counts per status and per type in one database round trip
async function getStats() {
  const [result] = await Notification.aggregate([
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byType: [{ $group: { _id: '$type', count: { $sum: 1 } } }],
      },
    },
  ]);

  const toObject = (groups, keys) =>
    Object.fromEntries(keys.map((key) => [key, groups.find((g) => g._id === key)?.count ?? 0]));

  const byStatus = toObject(result.byStatus, Notification.NOTIFICATION_STATUSES);
  return {
    total: byStatus.sent + byStatus.failed,
    byStatus,
    byType: toObject(result.byType, Notification.NOTIFICATION_TYPES),
  };
}

module.exports = { dispatchEvent, listNotifications, getNotification, getStats };
