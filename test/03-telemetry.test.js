const request = require('supertest');
const sinon = require('sinon');
const { expect } = require('chai');
const config = require('../shared/config');
const telemetryApp = require('../services/telemetry/app');
const notificationApp = require('../services/notification/app');
const hooks = require('../services/telemetry/hooks');
const Telemetry = require('../shared/models/Telemetry');
const Vehicle = require('../shared/models/Vehicle');
const Notification = require('../shared/models/Notification');
const { createUserWithToken, createVehicle, createTelemetry, bearer } = require('./helpers');

const MINUTE = 60 * 1000;
const minutesAgo = (n) => new Date(Date.now() - n * MINUTE);

describe('Telemetry (flow 3: vehicle location update & telemetry storage)', () => {
  let server;
  let admin;
  let manager;
  let driver;
  let vehicle; // assigned to `driver`
  let otherVehicle; // not assigned

  // Critical events call notification-service over HTTP, so start the real app on the test port
  const startNotifications = () =>
    new Promise((resolve) => {
      server = notificationApp.listen(
        new URL(config.services.notifications).port,
        '127.0.0.1',
        resolve,
      );
    });
  before(startNotifications);
  after((done) => {
    server.close(done);
  });

  beforeEach(async () => {
    admin = await createUserWithToken('admin');
    manager = await createUserWithToken('fleet_manager');
    driver = await createUserWithToken('driver');
    vehicle = await createVehicle({ assignedDriver: driver.user.id });
    otherVehicle = await createVehicle();
  });

  afterEach(() => sinon.restore());

  const report = (body, token = driver.token) =>
    request(telemetryApp).post('/').set(bearer(token)).send(body);

  const reading = (overrides = {}) => ({
    vehicleId: vehicle.id,
    location: { lat: 12.9352, lng: 77.6245 },
    speed: 42.5,
    heading: 90,
    batteryLevel: 78,
    fuelLevel: 55,
    engineTemp: 92,
    ...overrides,
  });

  describe('POST / (report a reading)', () => {
    it('stores the reading and moves the vehicle', async () => {
      const res = await report(reading());

      expect(res.status).to.equal(201);
      expect(res.body.vehicleUpdated).to.equal(true);
      expect(res.body.alert).to.equal(null);
      expect(res.body.telemetry).to.include({
        vehicle: vehicle.id,
        speed: 42.5,
        event: 'none',
        reportedBy: driver.user.id,
      });
      expect(res.body.telemetry.location).to.deep.equal({ lat: 12.9352, lng: 77.6245 });

      const stored = await Telemetry.findById(res.body.telemetry.id).lean();
      expect(stored.location).to.deep.equal({ type: 'Point', coordinates: [77.6245, 12.9352] });

      const moved = await Vehicle.findById(vehicle.id);
      expect(moved.toJSON().location).to.deep.equal({ lat: 12.9352, lng: 77.6245 });
      expect(moved.lastSeenAt.toISOString()).to.equal(res.body.telemetry.recordedAt);
    });

    it('moves the vehicle again with a newer reading', async () => {
      await report(reading({ recordedAt: minutesAgo(2) }));
      const res = await report(reading({ location: { lat: 12.95, lng: 77.64 } }));

      expect(res.body.vehicleUpdated).to.equal(true);
      const moved = await Vehicle.findById(vehicle.id);
      expect(moved.toJSON().location).to.deep.equal({ lat: 12.95, lng: 77.64 });
    });

    it('stores a late (older) reading without moving the vehicle back', async () => {
      await report(reading({ location: { lat: 12.95, lng: 77.64 } }));
      const late = await report(
        reading({ location: { lat: 12.9, lng: 77.5 }, recordedAt: minutesAgo(10) }),
      );

      expect(late.status).to.equal(201);
      expect(late.body.vehicleUpdated).to.equal(false);
      expect(await Telemetry.countDocuments()).to.equal(2);
      const current = await Vehicle.findById(vehicle.id);
      expect(current.toJSON().location).to.deep.equal({ lat: 12.95, lng: 77.64 });
    });

    it('lets fleet managers and admins report for any vehicle', async () => {
      for (const user of [manager, admin]) {
        const res = await report(reading({ vehicleId: otherVehicle.id }), user.token);
        expect(res.status).to.equal(201);
        expect(res.body.telemetry.reportedBy).to.equal(user.user.id);
      }
    });

    it("refuses a driver reporting for a vehicle that isn't theirs", async () => {
      const res = await report(reading({ vehicleId: otherVehicle.id }));

      expect(res.status).to.equal(403);
      expect(res.body.error.code).to.equal('NOT_ASSIGNED_DRIVER');
      expect(await Telemetry.countDocuments()).to.equal(0);
    });

    it('returns 404 for an unknown vehicle', async () => {
      const res = await report(reading({ vehicleId: '64b000000000000000000000' }), admin.token);

      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal('VEHICLE_NOT_FOUND');
    });

    it('rejects impossible values', async () => {
      const res = await report({
        vehicleId: vehicle.id,
        location: { lat: 95, lng: 77.6 },
        speed: -5,
        batteryLevel: 120,
        event: 'flat_tyre',
        recordedAt: new Date(Date.now() + 60 * MINUTE).toISOString(),
      });

      expect(res.status).to.equal(400);
      const fields = res.body.error.details.map((d) => d.field);
      expect(fields).to.include.members([
        'location.lat',
        'speed',
        'batteryLevel',
        'event',
        'recordedAt',
      ]);
    });

    it('requires a vehicle and a location', async () => {
      const res = await report({ speed: 10 });

      expect(res.status).to.equal(400);
      const fields = res.body.error.details.map((d) => d.field);
      expect(fields).to.include.members(['vehicleId', 'location']);
    });

    it('requires a token', async () => {
      const res = await request(telemetryApp).post('/').send(reading());
      expect(res.status).to.equal(401);
    });
  });

  describe('GET /vehicle/:vehicleId (history)', () => {
    beforeEach(async () => {
      await createTelemetry(vehicle, { recordedAt: minutesAgo(30), speed: 10 });
      await createTelemetry(vehicle, {
        recordedAt: minutesAgo(20),
        speed: 20,
        event: 'low_battery',
      });
      await createTelemetry(vehicle, { recordedAt: minutesAgo(10), speed: 30 });
      await createTelemetry(otherVehicle, { recordedAt: minutesAgo(5) });
    });

    const history = (query = {}, token = manager.token, id = vehicle.id) =>
      request(telemetryApp).get(`/vehicle/${id}`).query(query).set(bearer(token));

    it('returns the readings of one vehicle, newest first', async () => {
      const res = await history();

      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(3);
      expect(res.body.data.map((t) => t.speed)).to.deep.equal([30, 20, 10]);
    });

    it('paginates', async () => {
      const res = await history({ page: 2, limit: 2 });
      expect(res.body).to.include({ page: 2, limit: 2, total: 3 });
      expect(res.body.data.map((t) => t.speed)).to.deep.equal([10]);
    });

    it('filters by date range and event', async () => {
      const range = await history({
        from: minutesAgo(25).toISOString(),
        to: minutesAgo(15).toISOString(),
      });
      expect(range.body.data.map((t) => t.speed)).to.deep.equal([20]);

      const events = await history({ event: 'low_battery' });
      expect(events.body.total).to.equal(1);
    });

    it('rejects a range that ends before it starts', async () => {
      const res = await history({
        from: minutesAgo(5).toISOString(),
        to: minutesAgo(50).toISOString(),
      });
      expect(res.status).to.equal(400);
    });

    it('lets a driver read only their own vehicle', async () => {
      expect((await history({}, driver.token)).status).to.equal(200);

      const other = await history({}, driver.token, otherVehicle.id);
      expect(other.status).to.equal(403);
      expect(other.body.error.code).to.equal('NOT_ASSIGNED_DRIVER');
    });
  });

  describe('critical events → SMS alert', () => {
    it('alerts admins and fleet managers (not the driver) by SMS', async () => {
      const res = await report(reading({ event: 'engine_fault' }));

      expect(res.status).to.equal(201);
      expect(res.body.alert).to.deep.equal({
        notified: true,
        notifications: { sent: 2, failed: 0 },
      });

      const sms = await Notification.find({ type: 'critical_event' }).lean();
      expect(sms.map((n) => n.recipientRole)).to.have.members(['admin', 'fleet_manager']);
      expect(sms[0].message).to.equal(
        `[Fleet ALERT] ${vehicle.registrationNumber} reported ENGINE FAULT at 12.9352,77.6245`,
      );

      const stored = await Telemetry.findById(res.body.telemetry.id);
      expect(stored.alertSentAt).to.be.an.instanceOf(Date);
    });

    it('does not alert for a normal reading', async () => {
      const spy = sinon.spy(hooks, 'onCriticalEvent');
      const res = await report(reading({ event: 'none' }));

      expect(res.body.alert).to.equal(null);
      expect(spy.called).to.equal(false);
    });

    it('sends only one SMS while the same event repeats within the cooldown', async () => {
      await report(reading({ event: 'emergency_stop' }));
      const spy = sinon.spy(hooks, 'onCriticalEvent');

      const again = await report(reading({ event: 'emergency_stop' }));

      expect(again.status).to.equal(201);
      expect(again.body.alert).to.deep.equal({ notified: false, reason: 'cooldown' });
      expect(spy.called).to.equal(false);
      expect(await Telemetry.countDocuments({ event: 'emergency_stop' })).to.equal(2);
      expect(await Notification.countDocuments()).to.equal(2); // from the first reading only
    });

    it('alerts again once the cooldown has passed', async () => {
      await report(reading({ event: 'emergency_stop' }));
      // Pretend the first alert was sent long ago
      const cooldownMinutes = config.telemetry.alertCooldownMs / MINUTE;
      await Telemetry.updateMany({}, { alertSentAt: minutesAgo(cooldownMinutes + 1) });

      const res = await report(reading({ event: 'emergency_stop' }));
      expect(res.body.alert.notified).to.equal(true);
    });

    it('alerts immediately for a different event during the cooldown', async () => {
      await report(reading({ event: 'emergency_stop' }));
      const res = await report(reading({ event: 'low_battery', batteryLevel: 8 }));

      expect(res.body.alert.notified).to.equal(true);
    });

    it('is not limited by the cooldown of another vehicle', async () => {
      await report(reading({ event: 'engine_fault' }));
      const res = await report(
        reading({ vehicleId: otherVehicle.id, event: 'engine_fault' }),
        manager.token,
      );

      expect(res.body.alert.notified).to.equal(true);
    });

    it('stores the reading even when notification-service is down, and retries next time', async () => {
      await new Promise((resolve) => server.close(resolve));
      try {
        const res = await report(reading({ event: 'engine_fault' }));

        expect(res.status).to.equal(201);
        expect(res.body.alert).to.deep.equal({ notified: false, notifications: null });
        const stored = await Telemetry.findById(res.body.telemetry.id);
        expect(stored.alertSentAt).to.equal(undefined); // no cooldown started
      } finally {
        await startNotifications();
      }

      const retry = await report(reading({ event: 'engine_fault' }));
      expect(retry.body.alert.notified).to.equal(true);
    });
  });

  describe('GET /events (critical events across the fleet)', () => {
    beforeEach(async () => {
      await createTelemetry(vehicle, { recordedAt: minutesAgo(30), event: 'engine_fault' });
      await createTelemetry(vehicle, { recordedAt: minutesAgo(20) }); // event: none
      await createTelemetry(otherVehicle, { recordedAt: minutesAgo(10), event: 'low_battery' });
    });

    const events = (query = {}, token = admin.token) =>
      request(telemetryApp).get('/events').query(query).set(bearer(token));

    it('lists only critical readings, newest first, with registration numbers', async () => {
      const res = await events();

      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(2);
      expect(res.body.data.map((t) => t.event)).to.deep.equal(['low_battery', 'engine_fault']);
      expect(res.body.data[0]).to.include({
        vehicle: otherVehicle.id,
        vehicleRegistration: otherVehicle.registrationNumber,
      });
    });

    it('filters by event and vehicle', async () => {
      expect((await events({ event: 'engine_fault' })).body.total).to.equal(1);
      expect((await events({ vehicleId: otherVehicle.id })).body.total).to.equal(1);
      expect((await events({ event: 'none' })).status).to.equal(400);
    });

    it('is for admins and fleet managers only', async () => {
      expect((await events({}, manager.token)).status).to.equal(200);

      const asDriver = await events({}, driver.token);
      expect(asDriver.status).to.equal(403);
      expect(asDriver.body.error.code).to.equal('FORBIDDEN');
    });
  });
});
