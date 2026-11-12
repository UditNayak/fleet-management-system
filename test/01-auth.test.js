const request = require('supertest');
const { expect } = require('chai');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../services/user/app');
const User = require('../shared/models/User');
const config = require('../shared/config');
const { ISSUER } = require('../shared/auth/jwt');
const ensureBootstrapAdmin = require('../services/user/bootstrapAdmin');
const { createUserWithToken, bearer } = require('./helpers');

const silentLogger = { info() {}, warn() {}, error() {} };

const validDriver = {
  name: 'Ravi Kumar',
  email: 'ravi@fleet.dev',
  password: 'Driver@123',
  phone: '+919876543210',
};

describe('User service (flow 1: user login & JWT verification)', () => {
  describe('POST /register', () => {
    it('creates a driver and never returns the password hash', async () => {
      const res = await request(app).post('/register').send(validDriver);

      expect(res.status).to.equal(201);
      expect(res.body.user).to.include({
        name: 'Ravi Kumar',
        email: 'ravi@fleet.dev',
        role: 'driver',
        isActive: true,
      });
      expect(res.body.user).to.have.property('id');
      expect(res.body.user).to.not.have.any.keys('passwordHash', 'password', '_id', '__v');
    });

    it('stores a bcrypt hash, not the plain password', async () => {
      await request(app).post('/register').send(validDriver);

      const stored = await User.findOne({ email: 'ravi@fleet.dev' }).select('+passwordHash');
      expect(stored.passwordHash).to.not.equal(validDriver.password);
      expect(stored.passwordHash).to.match(/^\$2[aby]\$/);
      expect(await bcrypt.compare(validDriver.password, stored.passwordHash)).to.equal(true);
    });

    it('stores the email in lowercase', async () => {
      const res = await request(app)
        .post('/register')
        .send({ ...validDriver, email: 'Ravi@Fleet.DEV' });

      expect(res.body.user.email).to.equal('ravi@fleet.dev');
    });

    it('does not let anyone self-register with a role (400)', async () => {
      const res = await request(app)
        .post('/register')
        .send({ ...validDriver, role: 'admin' });

      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal('VALIDATION_ERROR');
      expect(res.body.error.details[0]).to.include({ field: 'role' });
      expect(await User.countDocuments()).to.equal(0);
    });

    it('rejects a duplicate email (409 EMAIL_TAKEN)', async () => {
      await request(app).post('/register').send(validDriver);
      const res = await request(app)
        .post('/register')
        .send({ ...validDriver, email: 'RAVI@fleet.dev' });

      expect(res.status).to.equal(409);
      expect(res.body.error.code).to.equal('EMAIL_TAKEN');
    });

    it('reports every invalid field at once (400 with details)', async () => {
      const res = await request(app)
        .post('/register')
        .send({ name: 'R', email: 'not-an-email', password: 'short', phone: '98765' });

      expect(res.status).to.equal(400);
      const fields = res.body.error.details.map((d) => d.field);
      expect(fields).to.include.members(['name', 'email', 'password', 'phone']);
    });

    it('requires the password to contain a letter and a number', async () => {
      const res = await request(app)
        .post('/register')
        .send({ ...validDriver, password: 'onlyletters' });

      expect(res.status).to.equal(400);
      expect(res.body.error.details[0].message).to.include('at least one number');
    });
  });

  describe('POST /login', () => {
    beforeEach(() => request(app).post('/register').send(validDriver));

    it('returns a signed JWT with the user id, role and email', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: validDriver.email, password: validDriver.password });

      expect(res.status).to.equal(200);
      expect(res.body).to.include({ tokenType: 'Bearer', expiresIn: 3600 });
      expect(res.body.user.email).to.equal(validDriver.email);

      const payload = jwt.verify(res.body.token, config.jwt.secret);
      expect(payload).to.include({
        sub: res.body.user.id,
        role: 'driver',
        email: 'ravi@fleet.dev',
        iss: ISSUER,
      });
      expect(payload.exp - payload.iat).to.equal(3600);
    });

    it('accepts the email in any letter case and records lastLoginAt', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'RAVI@FLEET.DEV', password: validDriver.password });

      expect(res.status).to.equal(200);
      expect(res.body.user.lastLoginAt).to.be.a('string');
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const wrongPassword = await request(app)
        .post('/login')
        .send({ email: validDriver.email, password: 'Wrong@123' });
      const unknownEmail = await request(app)
        .post('/login')
        .send({ email: 'nobody@fleet.dev', password: 'Wrong@123' });

      expect(wrongPassword.status).to.equal(401);
      expect(unknownEmail.status).to.equal(401);
      expect(wrongPassword.body).to.deep.equal(unknownEmail.body);
      expect(wrongPassword.body.error.code).to.equal('INVALID_CREDENTIALS');
    });

    it('blocks a disabled account (403 ACCOUNT_DISABLED)', async () => {
      await User.updateOne({ email: validDriver.email }, { isActive: false });

      const res = await request(app)
        .post('/login')
        .send({ email: validDriver.email, password: validDriver.password });

      expect(res.status).to.equal(403);
      expect(res.body.error.code).to.equal('ACCOUNT_DISABLED');
    });

    it('requires email and password (400)', async () => {
      const res = await request(app).post('/login').send({});

      expect(res.status).to.equal(400);
      expect(res.body.error.details.map((d) => d.field)).to.have.members(['email', 'password']);
    });
  });

  describe('JWT verification on GET /me', () => {
    let driver;

    beforeEach(async () => {
      driver = await createUserWithToken('driver');
    });

    const signWith = (secret, claims = {}) =>
      jwt.sign({ role: 'driver', email: driver.user.email, ...claims }, secret, {
        subject: driver.user.id,
        issuer: ISSUER,
      });

    it('returns the profile for a valid token', async () => {
      const res = await request(app).get('/me').set(bearer(driver.token));

      expect(res.status).to.equal(200);
      expect(res.body.user).to.include({ id: driver.user.id, role: 'driver' });
    });

    it('works end-to-end with a token obtained from /login', async () => {
      const login = await request(app)
        .post('/login')
        .send({ email: driver.user.email, password: driver.password });
      const res = await request(app).get('/me').set(bearer(login.body.token));

      expect(res.status).to.equal(200);
      expect(res.body.user.email).to.equal(driver.user.email);
    });

    it('rejects a request without a token (401 TOKEN_MISSING)', async () => {
      const res = await request(app).get('/me');

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('TOKEN_MISSING');
    });

    it('rejects a non-Bearer Authorization header (401 TOKEN_MISSING)', async () => {
      const res = await request(app).get('/me').set('Authorization', 'Basic dXNlcjpwYXNz');

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('TOKEN_MISSING');
    });

    it('rejects a malformed token (401 TOKEN_INVALID)', async () => {
      const res = await request(app).get('/me').set(bearer('not.a.jwt'));

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('TOKEN_INVALID');
    });

    it('rejects a token whose payload was tampered with (401 TOKEN_INVALID)', async () => {
      const [header, , signature] = driver.token.split('.');
      const forgedPayload = Buffer.from(
        JSON.stringify({ sub: driver.user.id, role: 'admin', iss: ISSUER }),
      ).toString('base64url');

      const res = await request(app)
        .get('/me')
        .set(bearer(`${header}.${forgedPayload}.${signature}`));

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('TOKEN_INVALID');
    });

    it('rejects a token signed with a different secret (401 TOKEN_INVALID)', async () => {
      const res = await request(app)
        .get('/me')
        .set(bearer(signWith('some-other-secret-that-is-also-32-chars-long')));

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('TOKEN_INVALID');
    });

    it('rejects an expired token (401 TOKEN_EXPIRED)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expired = signWith(config.jwt.secret, { iat: now - 7200, exp: now - 3600 });

      const res = await request(app).get('/me').set(bearer(expired));

      expect(res.status).to.equal(401);
      expect(res.body.error.code).to.equal('TOKEN_EXPIRED');
    });
  });

  describe('Admin user management (role-based access)', () => {
    let admin;
    let driver;

    beforeEach(async () => {
      admin = await createUserWithToken('admin');
      driver = await createUserWithToken('driver');
    });

    it('lets an admin list users with pagination and a role filter', async () => {
      await createUserWithToken('fleet_manager');

      const all = await request(app).get('/?limit=2').set(bearer(admin.token));
      const managers = await request(app).get('/?role=fleet_manager').set(bearer(admin.token));

      expect(all.status).to.equal(200);
      expect(all.body).to.include({ page: 1, limit: 2, total: 3 });
      expect(all.body.data).to.have.lengthOf(2);
      expect(managers.body.data.map((u) => u.role)).to.deep.equal(['fleet_manager']);
    });

    it('lets an admin create a fleet manager', async () => {
      const res = await request(app).post('/').set(bearer(admin.token)).send({
        name: 'Priya Sharma',
        email: 'priya@fleet.dev',
        password: 'Manager@123',
        phone: '+919812345678',
        role: 'fleet_manager',
      });

      expect(res.status).to.equal(201);
      expect(res.body.user.role).to.equal('fleet_manager');
    });

    it('lets an admin get and update a user', async () => {
      const got = await request(app).get(`/${driver.user.id}`).set(bearer(admin.token));
      const updated = await request(app)
        .patch(`/${driver.user.id}`)
        .set(bearer(admin.token))
        .send({ role: 'fleet_manager', phone: '+919811111111', isActive: false });

      expect(got.status).to.equal(200);
      expect(got.body.user.id).to.equal(driver.user.id);
      expect(updated.status).to.equal(200);
      expect(updated.body.user).to.include({
        role: 'fleet_manager',
        phone: '+919811111111',
        isActive: false,
      });
    });

    it('forbids drivers from admin endpoints (403 FORBIDDEN)', async () => {
      const list = await request(app).get('/').set(bearer(driver.token));
      const create = await request(app)
        .post('/')
        .set(bearer(driver.token))
        .send({ ...validDriver, role: 'admin' });

      expect(list.status).to.equal(403);
      expect(list.body.error.code).to.equal('FORBIDDEN');
      expect(create.status).to.equal(403);
    });

    it('forbids fleet managers from admin endpoints (403 FORBIDDEN)', async () => {
      const manager = await createUserWithToken('fleet_manager');
      const res = await request(app).get('/').set(bearer(manager.token));

      expect(res.status).to.equal(403);
    });

    it('stops an admin from changing their own role or status', async () => {
      const res = await request(app)
        .patch(`/${admin.user.id}`)
        .set(bearer(admin.token))
        .send({ role: 'driver' });

      expect(res.status).to.equal(403);
      expect(res.body.error.code).to.equal('CANNOT_MODIFY_SELF');
    });

    it('returns 400 for an invalid id and 404 for an unknown one', async () => {
      const invalid = await request(app).get('/not-an-id').set(bearer(admin.token));
      const unknown = await request(app).get('/64b7f0c2a1b2c3d4e5f60718').set(bearer(admin.token));

      expect(invalid.status).to.equal(400);
      expect(invalid.body.error.code).to.equal('VALIDATION_ERROR');
      expect(unknown.status).to.equal(404);
      expect(unknown.body.error.code).to.equal('USER_NOT_FOUND');
    });
  });

  describe('Bootstrap admin', () => {
    const bootstrap = {
      name: 'Udit Nayak',
      email: 'owner@fleet.dev',
      password: 'Owner@1234',
      phone: '+919000000009',
    };

    it('creates the admin when none exists', async () => {
      const created = await ensureBootstrapAdmin(silentLogger, bootstrap);

      expect(created).to.equal(true);
      const admin = await User.findOne({ email: 'owner@fleet.dev' });
      expect(admin).to.include({ name: 'Udit Nayak', role: 'admin' });
    });

    it('does nothing when an admin already exists', async () => {
      await ensureBootstrapAdmin(silentLogger, bootstrap);
      const createdAgain = await ensureBootstrapAdmin(silentLogger, bootstrap);

      expect(createdAgain).to.equal(false);
      expect(await User.countDocuments({ role: 'admin' })).to.equal(1);
    });

    it('lets the bootstrap admin log in', async () => {
      await ensureBootstrapAdmin(silentLogger, bootstrap);
      const res = await request(app)
        .post('/login')
        .send({ email: bootstrap.email, password: bootstrap.password });

      expect(res.status).to.equal(200);
      expect(res.body.user.role).to.equal('admin');
    });
  });
});
