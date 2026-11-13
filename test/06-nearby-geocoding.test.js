const request = require('supertest');
const sinon = require('sinon');
const { expect } = require('chai');
const config = require('../shared/config');
const mapsApp = require('../services/maps/app');
const vehicleApp = require('../services/vehicle/app');
const geocoder = require('../services/maps/geocoder');
const Vehicle = require('../shared/models/Vehicle');
const AppError = require('../shared/errors/AppError');
const { createUserWithToken, createVehicle, bearer } = require('./helpers');

const { createGeocoder } = geocoder;
const { toPoint } = Vehicle;

// Real Bangalore places; distances below are measured from MG Road
const MG_ROAD = { lat: 12.9756, lng: 77.605 };
const PLACES = {
  mgRoad: { lat: 12.9756, lng: 77.6066 }, // ~0.2 km
  cubbonPark: { lat: 12.9763, lng: 77.5929 }, // ~1.3 km
  indiranagar: { lat: 12.9784, lng: 77.6408 }, // ~3.9 km
  koramangala: { lat: 12.94, lng: 77.62 }, // ~4.3 km
  jayanagar: { lat: 12.925, lng: 77.5938 }, // ~5.7 km
  whitefield: { lat: 12.9698, lng: 77.75 }, // ~15.7 km
  electronicCity: { lat: 12.8452, lng: 77.6602 }, // ~15.7 km
};

// Great-circle distance in km (MongoDB uses the same spherical model)
function haversineKm(a, b) {
  const R = 6378.1; // MongoDB's earth radius for 2dsphere distances
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Minimal stand-in for a fetch Response
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const NOMINATIM_MG_ROAD = [
  { lat: '12.9755264', lon: '77.6067669', display_name: 'MG Road, Bengaluru, Karnataka, India' },
];

describe('Nearby vehicle search & geocoding (flow 6)', () => {
  afterEach(() => sinon.restore());

  describe('geocoder (Nominatim client)', () => {
    const build = (fetchFn, options = {}) =>
      createGeocoder({
        baseUrl: 'https://nominatim.example',
        userAgent: 'fleet-test/1.0',
        timeoutMs: 200,
        countryCodes: 'in',
        minIntervalMs: 0,
        fetchFn,
        ...options,
      });

    it('calls /search with the right parameters and User-Agent', async () => {
      const fetchFn = sinon.stub().resolves(jsonResponse(NOMINATIM_MG_ROAD));
      await build(fetchFn).search('MG Road, Bengaluru');

      const [url, init] = fetchFn.firstCall.args;
      expect(url.origin + url.pathname).to.equal('https://nominatim.example/search');
      expect(Object.fromEntries(url.searchParams)).to.include({
        q: 'MG Road, Bengaluru',
        format: 'jsonv2',
        limit: '1',
        countrycodes: 'in',
      });
      expect(init.headers['User-Agent']).to.equal('fleet-test/1.0');
    });

    it('turns the first result into numeric { lat, lng, displayName }', async () => {
      const fetchFn = sinon.stub().resolves(jsonResponse(NOMINATIM_MG_ROAD));
      const result = await build(fetchFn).search('MG Road, Bengaluru');

      expect(result).to.deep.equal({
        lat: 12.9755264,
        lng: 77.6067669,
        displayName: 'MG Road, Bengaluru, Karnataka, India',
        cached: false,
      });
    });

    it('throws ADDRESS_NOT_FOUND (404) when Nominatim finds nothing', async () => {
      const fetchFn = sinon.stub().resolves(jsonResponse([]));
      const err = await build(fetchFn)
        .search('qwertyuiop nowhere')
        .catch((e) => e);

      expect(err).to.be.instanceOf(AppError);
      expect(err).to.include({ status: 404, code: 'ADDRESS_NOT_FOUND' });
    });

    it('throws GEOCODER_UNAVAILABLE (503) on HTTP errors, network errors and timeouts', async () => {
      const failures = [
        sinon.stub().resolves(jsonResponse({}, 500)),
        sinon.stub().resolves(jsonResponse({}, 429)), // Nominatim rate limit
        sinon.stub().rejects(new TypeError('fetch failed')),
        // never answers → our AbortSignal.timeout(200) aborts it
        (_url, { signal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason)),
          ),
      ];

      for (const fetchFn of failures) {
        const err = await build(fetchFn)
          .search('MG Road')
          .catch((e) => e);
        expect(err).to.include({ status: 503, code: 'GEOCODER_UNAVAILABLE' });
      }
    });

    it('retries once after a network error or timeout, but not after an HTTP error', async () => {
      const flaky = sinon.stub();
      flaky.onFirstCall().rejects(new TypeError('fetch failed'));
      flaky.onSecondCall().resolves(jsonResponse(NOMINATIM_MG_ROAD));
      const result = await build(flaky).search('MG Road');

      expect(result.lat).to.equal(12.9755264);
      expect(flaky.callCount).to.equal(2);

      const down = sinon.stub().rejects(new TypeError('fetch failed'));
      await build(down)
        .search('MG Road')
        .catch(() => {});
      expect(down.callCount).to.equal(2); // gives up after the retry

      const rateLimited = sinon.stub().resolves(jsonResponse({}, 429));
      await build(rateLimited)
        .search('MG Road')
        .catch(() => {});
      expect(rateLimited.callCount).to.equal(1);
    });

    it('answers the same address from its cache (case and spaces ignored)', async () => {
      const fetchFn = sinon.stub().resolves(jsonResponse(NOMINATIM_MG_ROAD));
      const g = build(fetchFn);

      await g.search('MG Road, Bengaluru');
      const second = await g.search('  mg road,   BENGALURU ');

      expect(fetchFn.callCount).to.equal(1);
      expect(second.cached).to.equal(true);
      expect(second.lat).to.equal(12.9755264);
    });

    it('does not cache failures', async () => {
      const fetchFn = sinon.stub();
      fetchFn.onFirstCall().resolves(jsonResponse({}, 503));
      fetchFn.onSecondCall().resolves(jsonResponse(NOMINATIM_MG_ROAD));
      const g = build(fetchFn);

      await g.search('MG Road').catch(() => {});
      const result = await g.search('MG Road');

      expect(result.lat).to.equal(12.9755264);
      expect(fetchFn.callCount).to.equal(2);
    });

    it('spaces requests out (usage policy: max 1 request per second)', async () => {
      const fetchFn = sinon.stub().resolves(jsonResponse(NOMINATIM_MG_ROAD));
      const g = build(fetchFn, { minIntervalMs: 150 });

      const start = Date.now();
      await Promise.all([g.search('Address one'), g.search('Address two'), g.search('Address 3')]);

      expect(fetchFn.callCount).to.equal(3);
      expect(Date.now() - start).to.be.at.least(290); // 2 waits of 150 ms
    });

    it('reverse-geocodes coordinates into an address', async () => {
      const fetchFn = sinon.stub().resolves(
        jsonResponse({
          display_name: 'Mahatma Gandhi Road, Shivajinagar, Bengaluru, Karnataka, 560001, India',
          address: { road: 'Mahatma Gandhi Road', city: 'Bengaluru', postcode: '560001' },
        }),
      );
      const result = await build(fetchFn).reverse(12.9756, 77.605);

      const [url] = fetchFn.firstCall.args;
      expect(url.pathname).to.equal('/reverse');
      expect(Object.fromEntries(url.searchParams)).to.include({ lat: '12.9756', lon: '77.605' });
      expect(result.address).to.include({ road: 'Mahatma Gandhi Road', postcode: '560001' });
    });

    it('reverse: 404 when there is no address at that point (e.g. the ocean)', async () => {
      const fetchFn = sinon.stub().resolves(jsonResponse({ error: 'Unable to geocode' }));
      const err = await build(fetchFn)
        .reverse(0, 0)
        .catch((e) => e);
      expect(err).to.include({ status: 404, code: 'ADDRESS_NOT_FOUND' });
    });
  });

  describe('GET /geocode and /reverse', () => {
    let user;
    beforeEach(async () => {
      user = await createUserWithToken('driver'); // every role may use the maps endpoints
    });

    it('returns the coordinates of an address', async () => {
      sinon.stub(geocoder, 'search').resolves({
        lat: 12.9755264,
        lng: 77.6067669,
        displayName: 'MG Road, Bengaluru, Karnataka, India',
        cached: false,
      });

      const res = await request(mapsApp)
        .get('/geocode')
        .query({ address: 'MG Road, Bengaluru' })
        .set(bearer(user.token));

      expect(res.status).to.equal(200);
      expect(res.body).to.include({
        query: 'MG Road, Bengaluru',
        lat: 12.9755264,
        lng: 77.6067669,
        source: 'OpenStreetMap Nominatim',
      });
    });

    it('passes on 404 / 503 from the geocoder', async () => {
      const stub = sinon.stub(geocoder, 'search');
      stub.onFirstCall().rejects(new AppError(404, 'ADDRESS_NOT_FOUND', 'No location found'));
      stub.onSecondCall().rejects(new AppError(503, 'GEOCODER_UNAVAILABLE', 'Unavailable'));

      const notFound = await request(mapsApp)
        .get('/geocode?address=asdfghjkl')
        .set(bearer(user.token));
      const down = await request(mapsApp).get('/geocode?address=MG Road').set(bearer(user.token));

      expect(notFound.status).to.equal(404);
      expect(notFound.body.error.code).to.equal('ADDRESS_NOT_FOUND');
      expect(down.status).to.equal(503);
      expect(down.body.error.code).to.equal('GEOCODER_UNAVAILABLE');
    });

    it('validates the query and requires a token', async () => {
      const missing = await request(mapsApp).get('/geocode').set(bearer(user.token));
      const badLat = await request(mapsApp).get('/reverse?lat=95&lng=77').set(bearer(user.token));
      const anonymous = await request(mapsApp).get('/geocode?address=MG Road');

      expect(missing.status).to.equal(400);
      expect(badLat.status).to.equal(400);
      expect(anonymous.status).to.equal(401);
    });

    it('reverse-geocodes coordinates', async () => {
      sinon.stub(geocoder, 'reverse').resolves({
        displayName: 'Mahatma Gandhi Road, Bengaluru',
        address: { road: 'Mahatma Gandhi Road' },
        cached: false,
      });

      const res = await request(mapsApp)
        .get('/reverse?lat=12.9756&lng=77.605')
        .set(bearer(user.token));

      expect(res.status).to.equal(200);
      expect(res.body).to.include({
        lat: 12.9756,
        lng: 77.605,
        displayName: 'Mahatma Gandhi Road, Bengaluru',
      });
    });
  });

  describe('GET /nearby', () => {
    let user;
    const vehicles = {};

    beforeEach(async () => {
      user = await createUserWithToken('driver');
      const types = { mgRoad: 'van', cubbonPark: 'car', jayanagar: 'van' };
      const statuses = { cubbonPark: 'maintenance' };
      for (const [name, point] of Object.entries(PLACES)) {
        vehicles[name] = await createVehicle({
          location: toPoint(point),
          type: types[name] ?? 'truck',
          status: statuses[name] ?? 'active',
        });
      }
      await createVehicle(); // no location → never part of a geo search
    });

    const nearby = (query) => request(mapsApp).get('/nearby').query(query).set(bearer(user.token));
    const regs = (res) => res.body.vehicles.map((v) => v.registrationNumber);
    const regsOf = (...names) => names.map((name) => vehicles[name].registrationNumber);

    it('finds only the vehicles within the radius, nearest first', async () => {
      const res = await nearby({ ...MG_ROAD, radiusKm: 5 });

      expect(res.status).to.equal(200);
      expect(res.body.center).to.deep.equal(MG_ROAD);
      expect(res.body.radiusKm).to.equal(5);
      expect(res.body.count).to.equal(4);
      expect(regs(res)).to.deep.equal(regsOf('mgRoad', 'cubbonPark', 'indiranagar', 'koramangala'));
    });

    it('returns each distance in km', async () => {
      const res = await nearby({ ...MG_ROAD, radiusKm: 5 });

      for (const v of res.body.vehicles) {
        const name = Object.keys(vehicles).find((n) => vehicles[n].id === v.id);
        expect(v.distanceKm, name).to.be.closeTo(haversineKm(MG_ROAD, PLACES[name]), 0.05);
        expect(v.distanceKm).to.be.at.most(5);
      }
      expect(res.body.vehicles[0]).to.include({ type: 'van', status: 'active' });
      expect(res.body.vehicles[0].location).to.deep.equal(PLACES.mgRoad);
      expect(res.body.vehicles[0]).to.not.have.property('statusHistory');
    });

    it('a bigger radius includes more vehicles, a smaller one fewer', async () => {
      const small = await nearby({ ...MG_ROAD, radiusKm: 1 });
      const big = await nearby({ ...MG_ROAD, radiusKm: 20 });

      expect(regs(small)).to.deep.equal(regsOf('mgRoad'));
      expect(big.body.count).to.equal(7); // every vehicle with a location
    });

    it('defaults to a 5 km radius', async () => {
      const res = await nearby(MG_ROAD);
      expect(res.body.radiusKm).to.equal(5);
      expect(res.body.count).to.equal(4);
    });

    it('filters by status and type, and limits the result', async () => {
      const active = await nearby({ ...MG_ROAD, radiusKm: 5, status: 'active' });
      const vans = await nearby({ ...MG_ROAD, radiusKm: 10, type: 'van' });
      const limited = await nearby({ ...MG_ROAD, radiusKm: 20, limit: 2 });

      expect(regs(active)).to.deep.equal(regsOf('mgRoad', 'indiranagar', 'koramangala'));
      expect(regs(vans)).to.deep.equal(regsOf('mgRoad', 'jayanagar'));
      expect(regs(limited)).to.deep.equal(regsOf('mgRoad', 'cubbonPark'));
    });

    it('searches around an address (geocoded first)', async () => {
      const search = sinon.stub(geocoder, 'search').resolves({
        ...MG_ROAD,
        displayName: 'MG Road, Bengaluru, Karnataka, India',
        cached: false,
      });

      const res = await nearby({ address: 'MG Road, Bengaluru', radiusKm: 5 });

      expect(res.status).to.equal(200);
      expect(search.calledOnceWith('MG Road, Bengaluru')).to.equal(true);
      expect(res.body.center).to.deep.equal({
        ...MG_ROAD,
        displayName: 'MG Road, Bengaluru, Karnataka, India',
      });
      expect(regs(res)).to.deep.equal(regsOf('mgRoad', 'cubbonPark', 'indiranagar', 'koramangala'));
    });

    it('404 when the address cannot be found', async () => {
      sinon
        .stub(geocoder, 'search')
        .rejects(new AppError(404, 'ADDRESS_NOT_FOUND', 'No location found'));
      const res = await nearby({ address: 'asdfghjkl' });

      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal('ADDRESS_NOT_FOUND');
    });

    it('returns an empty list when nothing is in range', async () => {
      const res = await nearby({ lat: 28.6139, lng: 77.209, radiusKm: 10 }); // New Delhi
      expect(res.body).to.include({ count: 0 });
      expect(res.body.vehicles).to.deep.equal([]);
    });

    it('rejects invalid queries', async () => {
      const invalid = [
        { ...MG_ROAD, radiusKm: 0 },
        { ...MG_ROAD, radiusKm: 500 },
        { lat: 95, lng: 77.6 },
        { lat: 12.97 }, // lng missing
        { ...MG_ROAD, address: 'MG Road' }, // both centres
        { radiusKm: 5 }, // no centre
        { ...MG_ROAD, status: 'flying' },
      ];
      for (const query of invalid) {
        const res = await nearby(query);
        expect(res.status, JSON.stringify(query)).to.equal(400);
        expect(res.body.error.code).to.equal('VALIDATION_ERROR');
      }
    });

    it('requires a token', async () => {
      const res = await request(mapsApp).get('/nearby').query(MG_ROAD);
      expect(res.status).to.equal(401);
    });
  });

  describe('GET /vehicles (positions for the map)', () => {
    it('lists only vehicles that have a location, optionally by status', async () => {
      const user = await createUserWithToken('fleet_manager');
      const located = await createVehicle({ location: toPoint(PLACES.mgRoad), status: 'active' });
      await createVehicle({ location: toPoint(PLACES.whitefield), status: 'idle' });
      await createVehicle({ status: 'active' }); // no location

      const all = await request(mapsApp).get('/vehicles').set(bearer(user.token));
      const active = await request(mapsApp).get('/vehicles?status=active').set(bearer(user.token));

      expect(all.status).to.equal(200);
      expect(all.body.count).to.equal(2);
      expect(active.body.count).to.equal(1);
      expect(active.body.vehicles[0]).to.include({ id: located.id, status: 'active' });
      expect(active.body.vehicles[0].location).to.deep.equal(PLACES.mgRoad);
    });
  });

  describe('vehicle addresses are geocoded (vehicle-service → maps-service)', () => {
    let server;
    let admin;

    // vehicle-service calls maps-service over HTTP; in tests MAPS_SERVICE_URL=http://127.0.0.1:3904
    const startMaps = () =>
      new Promise((resolve) => {
        const { port } = new URL(config.services.maps);
        server = mapsApp.listen(port, '127.0.0.1', resolve);
      });
    before(startMaps);
    after((done) => {
      server.close(done);
    });

    beforeEach(async () => {
      admin = await createUserWithToken('admin');
    });

    const koramangala = {
      lat: 12.9352,
      lng: 77.6245,
      displayName: 'Koramangala, Bengaluru, Karnataka, India',
      cached: false,
    };
    const body = {
      registrationNumber: 'KA01MP7001',
      model: 'Tata Ace Gold',
      type: 'truck',
      address: 'Koramangala, Bengaluru',
    };
    const create = (data) => request(vehicleApp).post('/').set(bearer(admin.token)).send(data);

    it('stores the coordinates of an address-only vehicle', async () => {
      const search = sinon.stub(geocoder, 'search').resolves(koramangala);

      const res = await create(body);

      expect(res.status).to.equal(201);
      expect(search.calledOnceWith('Koramangala, Bengaluru')).to.equal(true);
      expect(res.body.vehicle.location).to.deep.equal({ lat: 12.9352, lng: 77.6245 });
      expect(res.body.vehicle.locationSource).to.equal('geocoded');
      expect(res.body.geocoding).to.deep.equal({
        status: 'ok',
        displayName: 'Koramangala, Bengaluru, Karnataka, India',
      });
      const stored = await Vehicle.findById(res.body.vehicle.id).lean();
      expect(stored.location.coordinates).to.deep.equal([77.6245, 12.9352]);
    });

    it('uses sent coordinates as they are (no geocoding)', async () => {
      const search = sinon.stub(geocoder, 'search');

      const res = await create({ ...body, location: { lat: 12.94, lng: 77.62 } });

      expect(res.status).to.equal(201);
      expect(search.called).to.equal(false);
      expect(res.body.vehicle.locationSource).to.equal('manual');
      expect(res.body).to.not.have.property('geocoding');
    });

    it('still creates the vehicle when the address is not found', async () => {
      sinon.stub(geocoder, 'search').rejects(new AppError(404, 'ADDRESS_NOT_FOUND', 'nope'));

      const res = await create({ ...body, address: 'Nowhere Street 99' });

      expect(res.status).to.equal(201);
      expect(res.body.vehicle.location).to.equal(null);
      expect(res.body.vehicle.locationSource).to.equal(null);
      expect(res.body.geocoding).to.deep.equal({ status: 'not_found' });
    });

    it('still creates the vehicle when the geocoder or maps-service is down', async () => {
      sinon.stub(geocoder, 'search').rejects(new AppError(503, 'GEOCODER_UNAVAILABLE', 'down'));
      const geocoderDown = await create(body);

      await new Promise((resolve) => server.close(resolve));
      let mapsDown;
      try {
        mapsDown = await create({ ...body, registrationNumber: 'KA01MP7002' });
      } finally {
        await startMaps();
      }

      for (const res of [geocoderDown, mapsDown]) {
        expect(res.status).to.equal(201);
        expect(res.body.vehicle.location).to.equal(null);
        expect(res.body.geocoding).to.deep.equal({ status: 'unavailable' });
      }
    });

    it('re-geocodes when PATCH changes only the address', async () => {
      const vehicle = await createVehicle({
        address: 'MG Road, Bengaluru',
        location: toPoint(PLACES.mgRoad),
        locationSource: 'manual',
      });
      sinon.stub(geocoder, 'search').resolves(koramangala);

      const res = await request(vehicleApp)
        .patch(`/${vehicle.id}`)
        .set(bearer(admin.token))
        .send({ address: 'Koramangala, Bengaluru' });

      expect(res.status).to.equal(200);
      expect(res.body.vehicle).to.include({
        address: 'Koramangala, Bengaluru',
        locationSource: 'geocoded',
      });
      expect(res.body.vehicle.location).to.deep.equal({ lat: 12.9352, lng: 77.6245 });
      expect(res.body.geocoding.status).to.equal('ok');
    });

    it('PATCH with coordinates marks them manual; clearing the location clears the source', async () => {
      const vehicle = await createVehicle({
        location: toPoint(PLACES.mgRoad),
        locationSource: 'geocoded',
      });
      const patch = (data) =>
        request(vehicleApp).patch(`/${vehicle.id}`).set(bearer(admin.token)).send(data);

      const manual = await patch({ location: PLACES.cubbonPark });
      expect(manual.body.vehicle.locationSource).to.equal('manual');

      const cleared = await patch({ location: null });
      expect(cleared.body.vehicle.location).to.equal(null);
      expect(cleared.body.vehicle.locationSource).to.equal(null);
    });

    it('rejects the internal geocode endpoint without the internal token', async () => {
      const res = await request(mapsApp).get('/internal/geocode?address=MG Road');
      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('INVALID_INTERNAL_TOKEN');
    });
  });
});
