const request = require('supertest');
const { expect } = require('chai');
const app = require('../services/vehicle/app');
const hooks = require('../services/vehicle/hooks');
const Vehicle = require('../shared/models/Vehicle');
const { createUserWithToken, createVehicle, bearer } = require('./helpers');

const newVehicle = {
  registrationNumber: 'ka-01 ab 1234',
  model: 'Tata Ace Gold',
  type: 'truck',
  year: 2023,
  address: 'MG Road, Bengaluru',
  location: { lat: 12.9756, lng: 77.605 },
};

describe('Vehicle service (flow 2: vehicle registration & retrieval)', () => {
  let admin;

  beforeEach(async () => {
    admin = await createUserWithToken('admin');
  });

  describe('POST /', () => {
    it('registers a vehicle with a normalised registration number and default status', async () => {
      const res = await request(app).post('/').set(bearer(admin.token)).send(newVehicle);

      expect(res.status).to.equal(201);
      expect(res.body.vehicle).to.include({
        registrationNumber: 'KA01AB1234',
        model: 'Tata Ace Gold',
        type: 'truck',
        status: 'idle',
        createdBy: admin.user.id,
        lastSeenAt: null,
        assignedDriver: null,
      });
      expect(res.body.vehicle.location).to.deep.equal({ lat: 12.9756, lng: 77.605 });
      expect(res.body.vehicle).to.have.property('id');
      expect(res.body.vehicle).to.not.have.any.keys('_id', '__v');
    });

    it('stores the location as a GeoJSON point in [lng, lat] order', async () => {
      await request(app).post('/').set(bearer(admin.token)).send(newVehicle);

      const stored = await Vehicle.findOne({ registrationNumber: 'KA01AB1234' }).lean();
      expect(stored.location).to.deep.equal({ type: 'Point', coordinates: [77.605, 12.9756] });
    });

    it('lets a fleet manager register a vehicle', async () => {
      const manager = await createUserWithToken('fleet_manager');
      const res = await request(app).post('/').set(bearer(manager.token)).send(newVehicle);

      expect(res.status).to.equal(201);
      expect(res.body.vehicle.createdBy).to.equal(manager.user.id);
    });

    it('rejects a duplicate registration number written differently', async () => {
      await request(app).post('/').set(bearer(admin.token)).send(newVehicle);
      const res = await request(app)
        .post('/')
        .set(bearer(admin.token))
        .send({ ...newVehicle, registrationNumber: 'KA01AB1234' });

      expect(res.status).to.equal(409);
      expect(res.body.error.code).to.equal('VEHICLE_EXISTS');
    });

    it('reports every invalid field at once', async () => {
      const res = await request(app)
        .post('/')
        .set(bearer(admin.token))
        .send({
          registrationNumber: 'NOT-A-PLATE',
          model: 'Tata Ace Gold',
          type: 'rocket',
          year: 1950,
          location: { lat: 95, lng: 200 },
        });

      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal('VALIDATION_ERROR');
      const fields = res.body.error.details.map((d) => d.field);
      expect(fields).to.include.members([
        'registrationNumber',
        'type',
        'year',
        'location.lat',
        'location.lng',
      ]);
    });

    it('requires registrationNumber, model and type', async () => {
      const res = await request(app).post('/').set(bearer(admin.token)).send({ year: 2023 });

      expect(res.status).to.equal(400);
      const fields = res.body.error.details.map((d) => d.field);
      expect(fields).to.include.members(['registrationNumber', 'model', 'type']);
    });

    it('does not accept a status on create', async () => {
      const res = await request(app)
        .post('/')
        .set(bearer(admin.token))
        .send({ ...newVehicle, status: 'active' });

      expect(res.status).to.equal(400);
      expect(res.body.error.details[0].field).to.equal('status');
    });

    it('assigns an active driver', async () => {
      const driver = await createUserWithToken('driver');
      const res = await request(app)
        .post('/')
        .set(bearer(admin.token))
        .send({ ...newVehicle, assignedDriver: driver.user.id });

      expect(res.status).to.equal(201);
      expect(res.body.vehicle.assignedDriver).to.equal(driver.user.id);
    });

    it('rejects an assigned "driver" who is not a driver, unknown or inactive', async () => {
      const inactive = await createUserWithToken('driver', { isActive: false });
      const candidates = [admin.user.id, '64b000000000000000000000', inactive.user.id];

      for (const assignedDriver of candidates) {
        const res = await request(app)
          .post('/')
          .set(bearer(admin.token))
          .send({ ...newVehicle, assignedDriver });
        expect(res.status, assignedDriver).to.equal(400);
        expect(res.body.error.code).to.equal('INVALID_DRIVER');
      }
    });
  });

  describe('GET /:id', () => {
    it('returns the vehicle including its status history', async () => {
      const vehicle = await createVehicle({
        location: Vehicle.toPoint({ lat: 12.97, lng: 77.59 }),
      });
      const res = await request(app).get(`/${vehicle.id}`).set(bearer(admin.token));

      expect(res.status).to.equal(200);
      expect(res.body.vehicle).to.include({
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
      });
      expect(res.body.vehicle.location).to.deep.equal({ lat: 12.97, lng: 77.59 });
      expect(res.body.vehicle.statusHistory).to.be.an('array').that.is.empty;
    });

    it('returns 404 for an unknown vehicle', async () => {
      const res = await request(app).get('/64b000000000000000000000').set(bearer(admin.token));

      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal('VEHICLE_NOT_FOUND');
    });

    it('returns 400 for a malformed id', async () => {
      const res = await request(app).get('/not-an-id').set(bearer(admin.token));

      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal('VALIDATION_ERROR');
    });
  });

  describe('GET /', () => {
    let driver;

    beforeEach(async () => {
      driver = await createUserWithToken('driver');
      await createVehicle({ registrationNumber: 'KA01AA0001', type: 'truck', status: 'active' });
      await createVehicle({ registrationNumber: 'KA02BB0002', type: 'van', status: 'idle' });
      await createVehicle({
        registrationNumber: 'KA01CC0003',
        type: 'truck',
        status: 'maintenance',
        assignedDriver: driver.user.id,
      });
      await createVehicle({ registrationNumber: 'MH12DD0004', type: 'car', status: 'idle' });
    });

    const list = (query) => request(app).get('/').query(query).set(bearer(admin.token));
    const regNumbers = (res) => res.body.data.map((v) => v.registrationNumber);

    it('paginates and reports the total', async () => {
      const res = await list({ page: 2, limit: 3 });

      expect(res.status).to.equal(200);
      expect(res.body).to.include({ page: 2, limit: 3, total: 4 });
      expect(res.body.data).to.have.length(1);
    });

    it('leaves statusHistory out of list items', async () => {
      const res = await list({});
      expect(res.body.data[0]).to.not.have.property('statusHistory');
    });

    it('filters by status and type', async () => {
      const res = await list({ status: 'idle', type: 'van' });
      expect(regNumbers(res)).to.deep.equal(['KA02BB0002']);
    });

    it('filters by assigned driver', async () => {
      const res = await list({ assignedDriver: driver.user.id });
      expect(regNumbers(res)).to.deep.equal(['KA01CC0003']);
    });

    it('searches by registration number prefix, case-insensitively', async () => {
      const res = await list({ search: 'ka01', sort: 'registrationNumber' });
      expect(regNumbers(res)).to.deep.equal(['KA01AA0001', 'KA01CC0003']);
    });

    it('treats regex characters in search as plain text', async () => {
      const res = await list({ search: '.*' });
      expect(res.body.total).to.equal(0);
    });

    it('sorts by registration number descending', async () => {
      const res = await list({ sort: '-registrationNumber' });
      expect(regNumbers(res)).to.deep.equal([
        'MH12DD0004',
        'KA02BB0002',
        'KA01CC0003',
        'KA01AA0001',
      ]);
    });

    it('rejects unknown filters and sort fields', async () => {
      const res = await list({ sort: 'model', color: 'red' });

      expect(res.status).to.equal(400);
      const fields = res.body.error.details.map((d) => d.field);
      expect(fields).to.include.members(['sort', 'color']);
    });
  });

  describe('PATCH /:id', () => {
    it('updates details', async () => {
      const vehicle = await createVehicle();
      const res = await request(app)
        .patch(`/${vehicle.id}`)
        .set(bearer(admin.token))
        .send({ model: 'Ashok Leyland Dost', year: 2024, location: { lat: 12.93, lng: 77.62 } });

      expect(res.status).to.equal(200);
      expect(res.body.vehicle).to.include({ model: 'Ashok Leyland Dost', year: 2024 });
      expect(res.body.vehicle.location).to.deep.equal({ lat: 12.93, lng: 77.62 });
    });

    it('unassigns the driver and clears the location with null', async () => {
      const driver = await createUserWithToken('driver');
      const vehicle = await createVehicle({
        assignedDriver: driver.user.id,
        location: Vehicle.toPoint({ lat: 12.97, lng: 77.59 }),
      });
      const res = await request(app)
        .patch(`/${vehicle.id}`)
        .set(bearer(admin.token))
        .send({ assignedDriver: null, location: null });

      expect(res.status).to.equal(200);
      expect(res.body.vehicle.assignedDriver).to.equal(null);
      expect(res.body.vehicle.location).to.equal(null);
    });

    it('does not allow changing the registration number or status', async () => {
      const vehicle = await createVehicle();
      const res = await request(app)
        .patch(`/${vehicle.id}`)
        .set(bearer(admin.token))
        .send({ registrationNumber: 'KA05ZZ9999', status: 'active' });

      expect(res.status).to.equal(400);
      const fields = res.body.error.details.map((d) => d.field);
      expect(fields).to.include.members(['registrationNumber', 'status']);
    });

    it('rejects an empty body', async () => {
      const vehicle = await createVehicle();
      const res = await request(app).patch(`/${vehicle.id}`).set(bearer(admin.token)).send({});
      expect(res.status).to.equal(400);
    });

    it('rejects assigning a non-driver', async () => {
      const vehicle = await createVehicle();
      const res = await request(app)
        .patch(`/${vehicle.id}`)
        .set(bearer(admin.token))
        .send({ assignedDriver: admin.user.id });

      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal('INVALID_DRIVER');
    });

    it('returns 404 for an unknown vehicle', async () => {
      const res = await request(app)
        .patch('/64b000000000000000000000')
        .set(bearer(admin.token))
        .send({ model: 'X Model' });
      expect(res.status).to.equal(404);
    });
  });

  describe('PATCH /:id/status', () => {
    const original = hooks.onStatusChanged;
    let calls;

    // Replace the hook with a recorder so we can see if/how it was called
    beforeEach(() => {
      calls = [];
      hooks.onStatusChanged = async (vehicle, change) => {
        calls.push({ vehicle, change });
      };
    });
    afterEach(() => {
      hooks.onStatusChanged = original;
    });

    it('changes the status, records history and calls the hook once', async () => {
      const vehicle = await createVehicle();
      const res = await request(app)
        .patch(`/${vehicle.id}/status`)
        .set(bearer(admin.token))
        .send({ status: 'maintenance', reason: 'Scheduled brake service' });

      expect(res.status).to.equal(200);
      expect(res.body.changed).to.equal(true);
      expect(res.body.vehicle.status).to.equal('maintenance');
      expect(res.body.change).to.include({
        from: 'idle',
        to: 'maintenance',
        reason: 'Scheduled brake service',
        changedBy: admin.user.id,
      });

      const stored = await Vehicle.findById(vehicle.id);
      expect(stored.statusHistory).to.have.length(1);
      expect(stored.statusHistory[0]).to.include({ from: 'idle', to: 'maintenance' });
      expect(stored.statusHistory[0].changedBy.toString()).to.equal(admin.user.id);

      expect(calls).to.have.length(1);
      expect(calls[0].vehicle.registrationNumber).to.equal(vehicle.registrationNumber);
      expect(calls[0].change).to.include({ from: 'idle', to: 'maintenance' });
    });

    it('keeps the history in order across several changes', async () => {
      const vehicle = await createVehicle();
      for (const status of ['active', 'maintenance', 'idle']) {
        await request(app).patch(`/${vehicle.id}/status`).set(bearer(admin.token)).send({ status });
      }

      const res = await request(app).get(`/${vehicle.id}`).set(bearer(admin.token));
      const history = res.body.vehicle.statusHistory.map((h) => `${h.from}->${h.to}`);
      expect(history).to.deep.equal(['idle->active', 'active->maintenance', 'maintenance->idle']);
      expect(calls).to.have.length(3);
    });

    it('does nothing when the status is unchanged', async () => {
      const vehicle = await createVehicle();
      const res = await request(app)
        .patch(`/${vehicle.id}/status`)
        .set(bearer(admin.token))
        .send({ status: 'idle' });

      expect(res.status).to.equal(200);
      expect(res.body.changed).to.equal(false);
      expect(res.body).to.not.have.property('change');
      expect(calls).to.have.length(0);
      expect((await Vehicle.findById(vehicle.id)).statusHistory).to.be.empty;
    });

    it('still succeeds when the hook fails', async () => {
      hooks.onStatusChanged = async () => {
        throw new Error('SMS provider down');
      };
      const vehicle = await createVehicle();
      const res = await request(app)
        .patch(`/${vehicle.id}/status`)
        .set(bearer(admin.token))
        .send({ status: 'active' });

      expect(res.status).to.equal(200);
      expect(res.body.vehicle.status).to.equal('active');
    });

    it('rejects an unknown status', async () => {
      const vehicle = await createVehicle();
      const res = await request(app)
        .patch(`/${vehicle.id}/status`)
        .set(bearer(admin.token))
        .send({ status: 'flying' });

      expect(res.status).to.equal(400);
      expect(calls).to.have.length(0);
    });
  });
});
