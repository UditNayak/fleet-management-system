const { randomUUID } = require('node:crypto');
const { createLogger } = require('../../../shared/logger');

const logger = createLogger('mock-sms');

// Fake SMS gateway: just logs the message. Numbers ending in 0000 fail (for testing).
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
