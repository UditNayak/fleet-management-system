const config = require('../../../shared/config');
const mockSms = require('./mockSms');

// Every provider has the same shape: { name, send({ to, body }) → { id } }.
// Adding Twilio later = one more file + one more entry here.
const providers = { mock: mockSms };

function getProvider(name = config.sms.provider) {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown SMS provider: ${name}`);
  return provider;
}

module.exports = { getProvider };
