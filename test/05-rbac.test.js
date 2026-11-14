const request = require('supertest');
const { expect } = require('chai');
const app = require('../services/vehicle/app');
const Vehicle = require('../shared/models/Vehicle');
const { createUserWithToken, createVehicle, bearer } = require('./helpers');

// Every vehicle action, with a request that would succeed for an allowed role
const actions = {
  create: (id, auth) =>
    request(app)
      .post('/')
      .set(auth)
      .send({ registrationNumber: 'KA09XY4321', model: 'Eicher Pro', type: 'truck' }),
  list: (id, auth) => request(app).get('/').set(auth),
  get: (id, auth) => request(app).get(`/${id}`).set(auth),
  update: (id, auth) => request(app).patch(`/${id}`).set(auth).send({ model: 'Eicher Pro 2' }),
  status: (id, auth) => request(app).patch(`/${id}/status`).set(auth).send({ status: 'active' }),
  delete: (id, auth) => request(app).delete(`/${id}`).set(auth),
};

// Expected status per role and action
const matrix = {
  none: { create: 401, list: 401, get: 401, update: 401, status: 401, delete: 401 },
  driver: { create: 403, list: 200, get: 200, update: 403, status: 403, delete: 403 },
  fleet_manager: { create: 201, list: 200, get: 200, update: 200, status: 200, delete: 403 },
  admin: { create: 201, list: 200, get: 200, update: 200, status: 200, delete: 204 },
};

describe('Role-based access control on vehicles (flow 5)', () => {
  for (const [role, expected] of Object.entries(matrix)) {
    describe(`as ${role === 'none' ? 'an anonymous caller' : role}`, () => {
      for (const [action, status] of Object.entries(expected)) {
        it(`${action} → ${status}`, async () => {
          const vehicle = await createVehicle();
          const auth = role === 'none' ? {} : bearer((await createUserWithToken(role)).token);

          const res = await actions[action](vehicle.id, auth);

          expect(res.status).to.equal(status);
          if (status === 403) expect(res.body.error.code).to.equal('FORBIDDEN');
          if (status === 401) expect(res.body.error.code).to.equal('TOKEN_MISSING');
        });
      }
    });
  }

  describe('DELETE /:id', () => {
    it('a forbidden delete leaves the vehicle in place', async () => {
      const vehicle = await createVehicle();
      for (const role of ['driver', 'fleet_manager']) {
        const { token } = await createUserWithToken(role);
        await request(app).delete(`/${vehicle.id}`).set(bearer(token));
      }

      expect(await Vehicle.exists({ _id: vehicle.id })).to.not.equal(null);
    });

    it('an admin delete really removes the vehicle', async () => {
      const vehicle = await createVehicle();
      const { token } = await createUserWithToken('admin');

      const del = await request(app).delete(`/${vehicle.id}`).set(bearer(token));
      expect(del.status).to.equal(204);
      expect(del.text).to.equal('');

      const get = await request(app).get(`/${vehicle.id}`).set(bearer(token));
      expect(get.status).to.equal(404);
      expect(get.body.error.code).to.equal('VEHICLE_NOT_FOUND');
    });

    it('deleting an unknown vehicle returns 404', async () => {
      const { token } = await createUserWithToken('admin');
      const res = await request(app).delete('/64b000000000000000000000').set(bearer(token));
      expect(res.status).to.equal(404);
    });
  });

  describe('privilege escalation', () => {
    it('rejects a driver token edited to claim the admin role', async () => {
      const vehicle = await createVehicle();
      const { token } = await createUserWithToken('driver');

      // Swap the payload for one saying role: admin, keeping the original signature
      const [header, payload, signature] = token.split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const forged = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString(
        'base64url',
      );

      const res = await request(app)
        .delete(`/${vehicle.id}`)
        .set(bearer(`${header}.${forged}.${signature}`));

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('TOKEN_INVALID');
      expect(await Vehicle.exists({ _id: vehicle.id })).to.not.equal(null);
    });
  });
});
