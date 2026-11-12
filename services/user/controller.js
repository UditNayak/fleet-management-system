const service = require('./service');

// Controllers only translate HTTP ↔ service calls; validation already happened in middleware

async function register(req, res) {
  const user = await service.register(req.body);
  res.status(201).json({ user });
}

async function login(req, res) {
  res.json(await service.login(req.body));
}

async function me(req, res) {
  res.json({ user: await service.getUser(req.user.id) });
}

async function list(req, res) {
  res.json(await service.listUsers(req.query));
}

async function create(req, res) {
  const user = await service.createUser(req.body);
  res.status(201).json({ user });
}

async function getById(req, res) {
  res.json({ user: await service.getUser(req.params.id) });
}

async function update(req, res) {
  res.json({ user: await service.updateUser(req.params.id, req.body, req.user) });
}

module.exports = { register, login, me, list, create, getById, update };
