const { timingSafeEqual } = require('node:crypto');

// Constant-time compare (avoids timing attacks)
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

module.exports = safeEqual;
