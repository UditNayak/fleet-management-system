const request = require('supertest');
const { expect } = require('chai');

const services = [
  { name: 'gateway', app: require('../services/gateway/app'), db: 'not_used' },
  { name: 'user-service', app: require('../services/user/app'), db: 'connected' },
  { name: 'vehicle-service', app: require('../services/vehicle/app'), db: 'connected' },
  { name: 'telemetry-service', app: require('../services/telemetry/app'), db: 'connected' },
  { name: 'maps-service', app: require('../services/maps/app'), db: 'connected' },
  { name: 'notification-service', app: require('../services/notification/app'), db: 'connected' },
];

describe('Health checks', () => {
  services.forEach(({ name, app, db }) => {
    it(`${name}: GET /health returns 200 with service info`, async () => {
      const res = await request(app).get('/health');

      expect(res.status).to.equal(200);
      expect(res.body).to.include({ status: 'ok', service: name, db });
      expect(res.body).to.have.property('uptime').that.is.a('number');
      expect(res.body).to.have.property('timestamp').that.is.a('string');
    });
  });
});

describe('Common error handling', () => {
  const app = require('../services/user/app');

  it('returns 404 with the standard error shape for an unknown route', async () => {
    const res = await request(app).get('/does/not-exist');

    expect(res.status).to.equal(404);
    expect(res.body.error).to.deep.equal({
      code: 'NOT_FOUND',
      message: 'Route GET /does/not-exist not found',
    });
  });

  it('returns 400 INVALID_JSON for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');

    expect(res.status).to.equal(400);
    expect(res.body.error.code).to.equal('INVALID_JSON');
  });

  it('sets security headers via helmet', async () => {
    const res = await request(app).get('/health');

    expect(res.headers).to.not.have.property('x-powered-by');
    expect(res.headers).to.have.property('x-content-type-options', 'nosniff');
  });
});
