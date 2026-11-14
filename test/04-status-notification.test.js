const request = require('supertest');
const sinon = require('sinon');
const { expect } = require('chai');
const config = require('../shared/config');
const vehicleApp = require('../services/vehicle/app');
const notificationApp = require('../services/notification/app');
const mockSms = require('../services/notification/providers/mockSms');
const Notification = require('../shared/models/Notification');
const Vehicle = require('../shared/models/Vehicle');
const User = require('../shared/models/User');
const { createUserWithToken, createVehicle, bearer } = require('./helpers');

const INTERNAL = { 'x-internal-token': config.internal.token };

describe('Status change → SMS notification (flow 4)', () => {
  let server;
  let admin;
  let manager;
  let driver;
  let vehicle;

  // Status changes call notification-service over HTTP, so run it on its test port
  before((done) => {
    const { port } = new URL(config.services.notifications);
    server = notificationApp.listen(port, '127.0.0.1', done);
  });
  after((done) => {
    server.close(done);
  });

  beforeEach(async () => {
    admin = await createUserWithToken('admin');
    manager = await createUserWithToken('fleet_manager');
    driver = await createUserWithToken('driver');
    vehicle = await createVehicle({ assignedDriver: driver.user.id });
  });

  afterEach(() => sinon.restore()); // undo every spy/stub

  const changeStatus = (body, token = manager.token) =>
    request(vehicleApp).patch(`/${vehicle.id}/status`).set(bearer(token)).send(body);

  describe('triggered by PATCH /:id/status', () => {
    it('sends an SMS to admins, fleet managers and the assigned driver', async () => {
      const res = await changeStatus({ status: 'maintenance', reason: 'Brake service' });

      expect(res.status).to.equal(200);
      expect(res.body.notifications).to.deep.equal({ sent: 3, failed: 0 });

      const records = await Notification.find().lean();
      expect(records).to.have.length(3);
      expect(records.map((n) => n.recipientRole)).to.have.members([
        'admin',
        'fleet_manager',
        'driver',
      ]);
      records.forEach((n) => {
        expect(n).to.include({
          type: 'status_change',
          status: 'sent',
          provider: 'mock',
          vehicleRegistration: vehicle.registrationNumber,
        });
        expect(n.providerMessageId).to.match(/^MOCK-/);
        expect(n.sentAt).to.be.an.instanceOf(Date);
        expect(n.details).to.include({ from: 'idle', to: 'maintenance', reason: 'Brake service' });
      });
    });

    it('writes a short SMS with the registration number, change and reason', async () => {
      const spy = sinon.spy(mockSms, 'send');
      await changeStatus({ status: 'maintenance', reason: 'Brake service' });

      expect(spy.callCount).to.equal(3);
      const { to, body } = spy.firstCall.args[0];
      expect(to).to.match(/^\+91/);
      expect(body).to.equal(
        `[Fleet] ${vehicle.registrationNumber} status: idle -> maintenance (Brake service)`,
      );
      expect(body.length).to.be.at.most(160);
    });

    it('records a failed SMS (phone ending in 0000) without stopping the others', async () => {
      await createUserWithToken('fleet_manager', { phone: '+919800000000' });

      const res = await changeStatus({ status: 'active' });

      expect(res.status).to.equal(200);
      expect(res.body.notifications).to.deep.equal({ sent: 3, failed: 1 });
      const failed = await Notification.findOne({ status: 'failed' }).lean();
      expect(failed).to.include({
        recipientPhone: '+919800000000',
        error: 'Mock SMS: number unreachable',
      });
      expect(failed).to.not.have.property('providerMessageId');
    });

    it('sends nothing when the status does not change', async () => {
      const spy = sinon.spy(mockSms, 'send');
      const res = await changeStatus({ status: 'idle' });

      expect(res.body.changed).to.equal(false);
      expect(spy.called).to.equal(false);
      expect(await Notification.countDocuments()).to.equal(0);
    });

    it('skips inactive users, users without a phone and drivers of other vehicles', async () => {
      await createUserWithToken('fleet_manager', { isActive: false });
      await createUserWithToken('admin', { phone: undefined });
      await createUserWithToken('driver'); // not assigned to this vehicle

      const res = await changeStatus({ status: 'active' });

      expect(res.body.notifications).to.deep.equal({ sent: 3, failed: 0 });
    });

    it('sends one SMS per phone number even if two users share it', async () => {
      await createUserWithToken('fleet_manager', { phone: manager.user.phone });

      const res = await changeStatus({ status: 'active' });

      expect(res.body.notifications.sent).to.equal(3);
    });

    it('still changes the status when notification-service is down', async () => {
      await new Promise((resolve) => server.close(resolve));
      try {
        const res = await changeStatus({ status: 'inactive', reason: 'Sold' });

        expect(res.status).to.equal(200);
        expect(res.body.changed).to.equal(true);
        expect(res.body.notifications).to.equal(null);
        const stored = await Vehicle.findById(vehicle.id);
        expect(stored.status).to.equal('inactive');
        expect(stored.statusHistory).to.have.length(1);
      } finally {
        const { port } = new URL(config.services.notifications);
        await new Promise((resolve) => {
          server = notificationApp.listen(port, '127.0.0.1', resolve);
        });
      }
    });
  });

  describe('POST /internal/events (service-to-service)', () => {
    const statusEvent = () => ({
      type: 'status_change',
      vehicle: {
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        assignedDriver: null,
      },
      change: { from: 'idle', to: 'active' },
    });

    it('rejects a missing or wrong internal token', async () => {
      const missing = await request(notificationApp).post('/internal/events').send(statusEvent());
      const wrong = await request(notificationApp)
        .post('/internal/events')
        .set('x-internal-token', 'not-the-token')
        .send(statusEvent());

      for (const res of [missing, wrong]) {
        expect(res.status).to.equal(401);
        expect(res.body.error.code).to.equal('INVALID_INTERNAL_TOKEN');
      }
      expect(await Notification.countDocuments()).to.equal(0);
    });

    it('validates the event', async () => {
      const res = await request(notificationApp)
        .post('/internal/events')
        .set(INTERNAL)
        .send({ type: 'party', vehicle: { id: 'x' } });

      expect(res.status).to.equal(400);
      const fields = res.body.error.details.map((d) => d.field);
      expect(fields).to.include.members(['type', 'vehicle.id', 'vehicle.registrationNumber']);
    });

    it('requires the change for a status_change event', async () => {
      const { change: _omit, ...event } = statusEvent();
      const res = await request(notificationApp).post('/internal/events').set(INTERNAL).send(event);

      expect(res.status).to.equal(400);
      expect(res.body.error.details[0].field).to.equal('change');
    });

    it('alerts admins and fleet managers (not the driver) about a critical event', async () => {
      const res = await request(notificationApp)
        .post('/internal/events')
        .set(INTERNAL)
        .send({
          type: 'critical_event',
          vehicle: {
            id: vehicle.id,
            registrationNumber: vehicle.registrationNumber,
            assignedDriver: driver.user.id,
          },
          event: 'engine_fault',
          location: { lat: 12.9756, lng: 77.605 },
        });

      expect(res.status).to.equal(201);
      expect(res.body.summary).to.deep.equal({ sent: 2, failed: 0 });
      expect(res.body.notifications.map((n) => n.recipientRole)).to.have.members([
        'admin',
        'fleet_manager',
      ]);
      expect(res.body.notifications[0].message).to.equal(
        `[Fleet ALERT] ${vehicle.registrationNumber} reported ENGINE FAULT at 12.9756,77.6050`,
      );
      expect(res.body.notifications[0].details).to.deep.equal({
        event: 'engine_fault',
        location: { lat: 12.9756, lng: 77.605 },
      });
    });

    it('records the SMS as failed when the provider throws unexpectedly', async () => {
      sinon.stub(mockSms, 'send').rejects(new Error('Provider timeout'));

      const res = await request(notificationApp)
        .post('/internal/events')
        .set(INTERNAL)
        .send(statusEvent());

      expect(res.status).to.equal(201);
      expect(res.body.summary).to.deep.equal({ sent: 0, failed: 2 });
      res.body.notifications.forEach((n) => expect(n.error).to.equal('Provider timeout'));
    });

    it('returns an empty result when nobody should be notified', async () => {
      await User.updateMany({ role: { $in: ['admin', 'fleet_manager'] } }, { isActive: false });
      const res = await request(notificationApp)
        .post('/internal/events')
        .set(INTERNAL)
        .send(statusEvent());

      expect(res.status).to.equal(201);
      expect(res.body).to.deep.equal({ notifications: [], summary: { sent: 0, failed: 0 } });
    });
  });

  describe('reading the SMS log (GET /, /stats, /:id)', () => {
    beforeEach(async () => {
      await createUserWithToken('fleet_manager', { phone: '+919800000000' }); // will fail
      await changeStatus({ status: 'active' }); // 3 sent + 1 failed
      await changeStatus({ status: 'maintenance' }); // 3 sent + 1 failed
    });

    const get = (path, token = admin.token) =>
      request(notificationApp).get(path).set(bearer(token));

    it('lists notifications newest first with pagination', async () => {
      const res = await get('/?limit=5');

      expect(res.status).to.equal(200);
      expect(res.body).to.include({ page: 1, limit: 5, total: 8 });
      expect(res.body.data).to.have.length(5);
      expect(res.body.data[0].details.to).to.equal('maintenance');
      expect(res.body.data[0]).to.have.property('id');
    });

    it('filters by status, type and vehicle', async () => {
      const failed = await get('/?status=failed', manager.token);
      expect(failed.body.total).to.equal(2);
      failed.body.data.forEach((n) => expect(n.status).to.equal('failed'));

      const critical = await get('/?type=critical_event');
      expect(critical.body.total).to.equal(0);

      const other = await createVehicle();
      const byVehicle = await get(`/?vehicleId=${other.id}`);
      expect(byVehicle.body.total).to.equal(0);
    });

    it('rejects invalid filters', async () => {
      const res = await get('/?status=lost');
      expect(res.status).to.equal(400);
    });

    it('returns counts per status and type', async () => {
      const res = await get('/stats');

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({
        total: 8,
        byStatus: { sent: 6, failed: 2 },
        byType: { status_change: 8, critical_event: 0 },
      });
    });

    it('gets one notification by id, 404 when unknown', async () => {
      const { body } = await get('/?limit=1');
      const one = await get(`/${body.data[0].id}`);
      expect(one.status).to.equal(200);
      expect(one.body.notification.id).to.equal(body.data[0].id);

      const missing = await get('/64b000000000000000000000');
      expect(missing.status).to.equal(404);
      expect(missing.body.error.code).to.equal('NOTIFICATION_NOT_FOUND');
    });

    it('is not available to drivers (403) or anonymous callers (401)', async () => {
      for (const path of ['/', '/stats', '/64b000000000000000000000']) {
        const asDriver = await get(path, driver.token);
        expect(asDriver.status, path).to.equal(403);
        expect(asDriver.body.error.code).to.equal('FORBIDDEN');

        const anonymous = await request(notificationApp).get(path);
        expect(anonymous.status, path).to.equal(401);
      }
    });
  });
});
