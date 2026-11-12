const express = require('express');
const request = require('supertest');
const { expect } = require('chai');
const buildGateway = require('../services/gateway/buildGateway');

const API_KEY = 'test-key-1';
const OTHER_API_KEY = 'test-key-2';
const SERVICE_PATHS = ['users', 'vehicles', 'telemetry', 'maps', 'notifications'];

// A tiny stand-in for a backend service: it echoes back what it received
function startFakeService(name) {
  const app = express();
  app.use(express.json());
  app.use(async (req, res) => {
    if (req.path === '/slow') await new Promise((resolve) => setTimeout(resolve, 500));
    if (req.path.startsWith('/status/')) {
      const status = Number(req.path.split('/')[2]);
      return res.status(status).json({ error: { code: 'FROM_SERVICE', message: name } });
    }
    res.json({
      service: name,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body ?? null,
    });
  });
  return listen(app);
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const urlOf = (server) => `http://127.0.0.1:${server.address().port}`;

// A port with nothing listening on it → connection refused, like a stopped container
async function deadServiceUrl() {
  const server = await listen(express());
  const url = urlOf(server);
  await new Promise((resolve) => server.close(resolve));
  return url;
}

describe('API Gateway (flow 7: API key verification & rate limiting)', () => {
  const fakeServers = [];
  let services;
  let gateway;

  before(async () => {
    services = [];
    for (const path of SERVICE_PATHS) {
      const server = await startFakeService(`${path}-service`);
      fakeServers.push(server);
      services.push({ path: `/${path}`, name: `${path}-service`, target: urlOf(server) });
    }
    gateway = buildGateway({
      apiKeys: [API_KEY, OTHER_API_KEY],
      rateLimit: { windowMs: 60000, max: 1000 },
      timeoutMs: 200,
      services,
    });
  });

  after(() => fakeServers.forEach((server) => server.close()));

  describe('API key verification', () => {
    it('serves the public /health without an API key', async () => {
      const res = await request(gateway).get('/health');

      expect(res.status).to.equal(200);
      expect(res.body.service).to.equal('gateway');
    });

    it('rejects /api requests without an API key (401 MISSING_API_KEY)', async () => {
      const res = await request(gateway).get('/api/users/health');

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('MISSING_API_KEY');
    });

    it('rejects /api requests with a wrong API key (401 INVALID_API_KEY)', async () => {
      const res = await request(gateway).get('/api/users/health').set('x-api-key', 'wrong-key');

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('INVALID_API_KEY');
    });

    it('forwards the request when the API key is valid', async () => {
      const res = await request(gateway).get('/api/users/health').set('x-api-key', API_KEY);

      expect(res.status).to.equal(200);
      expect(res.body.service).to.equal('users-service');
    });

    it('accepts every configured API key', async () => {
      const res = await request(gateway).get('/api/users/health').set('x-api-key', OTHER_API_KEY);

      expect(res.status).to.equal(200);
    });

    it('refuses to start without any API keys configured', () => {
      expect(() => buildGateway({ apiKeys: [], services: [] })).to.throw(/API key/);
    });
  });

  describe('Routing & forwarding', () => {
    SERVICE_PATHS.forEach((path) => {
      it(`routes /api/${path}/* to ${path}-service`, async () => {
        const res = await request(gateway).get(`/api/${path}/health`).set('x-api-key', API_KEY);

        expect(res.status).to.equal(200);
        expect(res.body.service).to.equal(`${path}-service`);
      });
    });

    it('strips the /api/<service> prefix and keeps the query string', async () => {
      const res = await request(gateway)
        .get('/api/vehicles/abc123?status=active')
        .set('x-api-key', API_KEY);

      expect(res.body.url).to.equal('/abc123?status=active');
    });

    it('forwards the HTTP method and JSON body unchanged', async () => {
      const body = { registrationNumber: 'KA01AB1234', model: 'Tata Ace' };
      const res = await request(gateway).post('/api/vehicles').set('x-api-key', API_KEY).send(body);

      expect(res.body.method).to.equal('POST');
      expect(res.body.body).to.deep.equal(body);
    });

    it('forwards the Authorization header but not the API key', async () => {
      const res = await request(gateway)
        .get('/api/users/me')
        .set('x-api-key', API_KEY)
        .set('Authorization', 'Bearer some.jwt.token');

      expect(res.body.headers.authorization).to.equal('Bearer some.jwt.token');
      expect(res.body.headers).to.not.have.property('x-api-key');
    });

    it('passes error status codes from the service through unchanged', async () => {
      const res = await request(gateway).get('/api/vehicles/status/409').set('x-api-key', API_KEY);

      expect(res.status).to.equal(409);
      expect(res.body.error.code).to.equal('FROM_SERVICE');
    });

    it('generates an X-Request-Id and forwards it to the service', async () => {
      const res = await request(gateway).get('/api/users/health').set('x-api-key', API_KEY);

      expect(res.headers['x-request-id']).to.be.a('string').and.not.be.empty;
      expect(res.body.headers['x-request-id']).to.equal(res.headers['x-request-id']);
    });

    it('reuses an X-Request-Id sent by the client', async () => {
      const res = await request(gateway)
        .get('/api/users/health')
        .set('x-api-key', API_KEY)
        .set('X-Request-Id', 'my-trace-id-1');

      expect(res.headers['x-request-id']).to.equal('my-trace-id-1');
      expect(res.body.headers['x-request-id']).to.equal('my-trace-id-1');
    });

    it('returns 404 for an unknown /api prefix', async () => {
      const res = await request(gateway).get('/api/unknown/thing').set('x-api-key', API_KEY);

      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal('NOT_FOUND');
    });
  });

  describe('Rate limiting', () => {
    let limitedGateway;

    beforeEach(() => {
      limitedGateway = buildGateway({
        apiKeys: [API_KEY, OTHER_API_KEY],
        rateLimit: { windowMs: 60000, max: 3 },
        timeoutMs: 200,
        services,
      });
    });

    it('allows requests up to the limit, then returns 429 RATE_LIMITED', async () => {
      for (let i = 0; i < 3; i += 1) {
        const ok = await request(limitedGateway).get('/api/users/health').set('x-api-key', API_KEY);
        expect(ok.status).to.equal(200);
      }

      const res = await request(limitedGateway).get('/api/users/health').set('x-api-key', API_KEY);

      expect(res.status).to.equal(429);
      expect(res.body.error.code).to.equal('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).to.be.greaterThan(0);
    });

    it('sends RateLimit headers so clients can see their remaining quota', async () => {
      const res = await request(limitedGateway).get('/api/users/health').set('x-api-key', API_KEY);

      expect(res.headers).to.have.property('ratelimit');
      expect(res.headers).to.have.property('ratelimit-policy');
    });

    it('counts each API key separately', async () => {
      for (let i = 0; i < 4; i += 1) {
        await request(limitedGateway).get('/api/users/health').set('x-api-key', API_KEY);
      }

      const res = await request(limitedGateway)
        .get('/api/users/health')
        .set('x-api-key', OTHER_API_KEY);

      expect(res.status).to.equal(200);
    });

    it('does not rate-limit the public /health endpoint', async () => {
      for (let i = 0; i < 5; i += 1) {
        const res = await request(limitedGateway).get('/health');
        expect(res.status).to.equal(200);
      }
    });
  });

  describe('Service failures', () => {
    let failingGateway;

    before(async () => {
      failingGateway = buildGateway({
        apiKeys: [API_KEY],
        rateLimit: { windowMs: 60000, max: 1000 },
        timeoutMs: 200,
        services: [
          { path: '/vehicles', name: 'vehicle-service', target: await deadServiceUrl() },
          { path: '/users', name: 'user-service', target: services[0].target },
        ],
      });
    });

    it('returns 503 SERVICE_UNAVAILABLE when the service is down', async () => {
      const res = await request(failingGateway)
        .get('/api/vehicles/health')
        .set('x-api-key', API_KEY);

      expect(res.status).to.equal(503);
      expect(res.body.error.code).to.equal('SERVICE_UNAVAILABLE');
      expect(res.body.error.details).to.deep.equal({ service: 'vehicle-service' });
    });

    it('returns 504 GATEWAY_TIMEOUT when the service is too slow', async () => {
      const res = await request(failingGateway).get('/api/users/slow').set('x-api-key', API_KEY);

      expect(res.status).to.equal(504);
      expect(res.body.error.code).to.equal('GATEWAY_TIMEOUT');
    });

    it('/health/services reports which services are up and down', async () => {
      const res = await request(failingGateway).get('/health/services');

      expect(res.status).to.equal(503);
      expect(res.body.status).to.equal('degraded');
      const byName = Object.fromEntries(res.body.services.map((s) => [s.name, s.status]));
      expect(byName).to.deep.equal({ 'vehicle-service': 'down', 'user-service': 'up' });
    });

    it('/health/services returns 200 when every service is up', async () => {
      const res = await request(gateway).get('/health/services');

      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('ok');
      expect(res.body.services).to.have.lengthOf(5);
    });
  });

  describe('API documentation', () => {
    it('serves Swagger UI at /api-docs/ without an API key', async () => {
      const res = await request(gateway).get('/api-docs/');

      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.include('text/html');
      expect(res.text).to.include('swagger-ui');
    });

    it('serves the raw OpenAPI spec at /api-docs/openapi.json', async () => {
      const res = await request(gateway).get('/api-docs/openapi.json');

      expect(res.status).to.equal(200);
      expect(res.body.openapi).to.match(/^3\./);
      expect(res.body.paths).to.have.property('/api/{service}/health');
    });
  });
});
