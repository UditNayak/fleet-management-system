const { randomUUID } = require('node:crypto');
const { createLogger } = require('../../../shared/logger');

const logger = createLogger('mock-sms');

// Pretends to be an SMS gateway: nothing leaves the machine, the "SMS" is written to the log.
// Numbers ending in 0000 fail on purpose, so failed deliveries can be demonstrated and tested.
const mockSms = {
  name: 'mock',

  async send({ to, body }) {
    if (to.endsWith('0000')) {
      throw new Error('Mock SMS: number unreachable');
    }
    const id = `MOCK-${randomUUID()}`;
    logger.info(`📱 SMS → ${to}: ${body} (${id})`);
    return { id };
  },
};

module.exports = mockSms;
