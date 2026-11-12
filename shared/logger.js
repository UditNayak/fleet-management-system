const config = require('./config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger(name) {
  const threshold = LEVELS[config.logLevel];

  const log = (level, method) => (message) => {
    if (LEVELS[level] < threshold) return;
    console[method](`${new Date().toISOString()} [${name}] ${level.toUpperCase()} ${message}`);
  };

  return {
    debug: log('debug', 'log'),
    info: log('info', 'log'),
    warn: log('warn', 'warn'),
    error: log('error', 'error'),
  };
}

module.exports = { createLogger };
