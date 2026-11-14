const config = require('../../../shared/config');
const mockSms = require('./mockSms');

// Each provider: { name, send({ to, body }) → { id } }
const providers = { mock: mockSms };

function getProvider(name = config.sms.provider) {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown SMS provider: ${name}`);
  return provider;
}

module.exports = { getProvider };
