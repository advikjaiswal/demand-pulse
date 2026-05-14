const crypto = require('crypto');

const ITERATIONS = 120000;
const KEYLEN = 32;
const DIGEST = 'sha256';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  const value = String(password || '');
  if (value.length < 8) throw new Error('Password must be at least 8 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(value, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const expected = Buffer.from(parts[3], 'hex');
  const actual = crypto.pbkdf2Sync(String(password || ''), parts[2], parseInt(parts[1], 10), expected.length, DIGEST);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

module.exports = { normalizeEmail, hashPassword, verifyPassword, createSessionToken, hashToken };
