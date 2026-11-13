const request = require('supertest');
const { expect } = require('chai');
const buildGateway = require('../services/gateway/buildGateway');
const { advance, drainBattery, distanceKm, bearing } = require('../scripts/simulator');

describe('Dashboard UI served by the gateway', () => {
  // No backend services needed: these requests never reach the proxy
  const gateway = buildGateway({
    apiKeys: ['test-key'],
    services: [{ path: '/maps', name: 'maps-service', target: 'http://127.0.0.1:9' }],
  });

  it('serves the dashboard at / without an API key', async () => {
    const res = await request(gateway).get('/');

    expect(res.status).to.equal(200);
    expect(res.headers['content-type']).to.match(/text\/html/);
    expect(res.text).to.include('<title>Fleet Dashboard</title>');
    expect(res.text).to.include('/vendor/leaflet/leaflet.js');
    expect(res.text).to.include('src="/js/app.js"');
  });

  it('serves the scripts and styles with the right content types', async () => {
    const js = await request(gateway).get('/js/app.js');
    const css = await request(gateway).get('/css/app.css');

    expect(js.status).to.equal(200);
    expect(js.headers['content-type']).to.match(/javascript/);
    expect(css.status).to.equal(200);
    expect(css.headers['content-type']).to.match(/text\/css/);
  });

  it('serves Leaflet from our own server (no CDN)', async () => {
    const js = await request(gateway).get('/vendor/leaflet/leaflet.js');
    const css = await request(gateway).get('/vendor/leaflet/leaflet.css');

    expect(js.status).to.equal(200);
    expect(js.text).to.include('Leaflet');
    expect(css.status).to.equal(200);
  });

  it('sends a Content-Security-Policy: own scripts only, OpenStreetMap tiles allowed', async () => {
    const res = await request(gateway).get('/');
    const csp = Object.fromEntries(
      res.headers['content-security-policy'].split(';').map((directive) => {
        const [name, ...values] = directive.trim().split(/\s+/);
        return [name, values];
      }),
    );

    expect(csp['script-src']).to.deep.equal(["'self'"]); // no inline scripts, no CDN
    expect(csp['img-src']).to.include('https://tile.openstreetmap.org');
    expect(csp).to.not.have.property('upgrade-insecure-requests');
  });

  it('sends a Referer to OpenStreetMap (its tile policy blocks requests without one)', async () => {
    const res = await request(gateway).get('/');
    expect(res.headers['referrer-policy']).to.equal('strict-origin-when-cross-origin');
  });

  it('does not open the API: /api still requires the key', async () => {
    const res = await request(gateway).get('/api/maps/vehicles');

    expect(res.status).to.equal(401);
    expect(res.body.error.code).to.equal('MISSING_API_KEY');
  });

  it('answers unknown files with the JSON 404, not the page', async () => {
    const res = await request(gateway).get('/js/nope.js');

    expect(res.status).to.equal(404);
    expect(res.body.error.code).to.equal('NOT_FOUND');
  });

  it('keeps Swagger UI working', async () => {
    const res = await request(gateway).get('/api-docs/');
    expect(res.status).to.equal(200);
    expect(res.text).to.include('swagger-ui');
  });
});

describe('Telemetry simulator helpers', () => {
  const route = [
    { lat: 12.9756, lng: 77.6066 },
    { lat: 12.9756, lng: 77.6166 }, // ~1.08 km east
    { lat: 12.9856, lng: 77.6166 }, // ~1.11 km north
  ];

  it('measures distance and compass heading', () => {
    expect(distanceKm(route[0], route[1])).to.be.closeTo(1.08, 0.02);
    expect(bearing(route[0], route[1])).to.be.closeTo(90, 0.5); // east
    expect(bearing(route[1], route[2])).to.be.closeTo(0, 0.5); // north
  });

  it('moves along the current leg', () => {
    const next = advance(route, { leg: 0, progress: 0 }, 0.54);

    expect(next.leg).to.equal(0);
    expect(next.progress).to.be.closeTo(0.5, 0.02);
    expect(next.position.lat).to.equal(12.9756);
    expect(next.position.lng).to.be.closeTo(77.6116, 0.0002);
    expect(next.heading).to.be.closeTo(90, 0.5);
  });

  it('continues onto the next leg, and loops back to the start', () => {
    const onSecondLeg = advance(route, { leg: 0, progress: 0.9 }, 0.5);
    expect(onSecondLeg.leg).to.equal(1);
    expect(onSecondLeg.heading).to.be.closeTo(0, 0.5);

    const looped = advance(route, { leg: 2, progress: 0.99 }, 0.1);
    expect(looped.leg).to.equal(0); // last waypoint → back to the first
  });

  it('reports low_battery once when crossing 15 %, then recharges when nearly empty', () => {
    expect(drainBattery(16, 0.8)).to.deep.equal({ level: 15.2, event: 'none' });
    expect(drainBattery(15.2, 0.8)).to.deep.equal({ level: 14.4, event: 'low_battery' });
    expect(drainBattery(14.4, 0.8)).to.deep.equal({ level: 13.6, event: 'none' });
    expect(drainBattery(5.5, 0.8)).to.deep.equal({ level: 95, event: 'none' }); // "charged"
  });
});
