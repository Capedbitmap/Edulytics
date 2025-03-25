// server/utils/auth.js
const crypto = require('crypto');

function generatePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function checkPasswordHash(storedHash, password) {
  if (!storedHash || !password) return false;
  
  const [salt, hash] = storedHash.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

module.exports = {
  generatePasswordHash,
  checkPasswordHash
};