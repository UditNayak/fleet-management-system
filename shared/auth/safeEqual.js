const { timingSafeEqual } = require('node:crypto');

// Constant-time string comparison: a normal === returns as soon as one character differs,
// which leaks (through response time) how much of a secret was guessed correctly.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

module.exports = safeEqual;
