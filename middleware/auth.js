const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { get, openDatabase } = require('../lib/database');
const { validateOperationalSecret } = require('../lib/security');

const JWT_EXPIRES = '8h';

function getJwtSecret() {
  try {
    return validateOperationalSecret(process.env.JWT_SECRET, 'JWT_SECRET');
  } catch (error) {
    error.code = 'CONFIG_INVALID';
    throw error;
  }
}

function getDb() {
  return openDatabase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken(user) {
  return jwt.sign({ id: user.id, role: user.role, authVersion: user.auth_version }, getJwtSecret(), { expiresIn: JWT_EXPIRES, audience: 'quickbooks-api', issuer: 'quickbooks-governed-ledger' });
}

async function authenticateToken(req, res, next) {
  const authorization = req.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Access token required', code: 'AUTH_REQUIRED' });
  const token = authorization.slice(7);
  let claims;
  try {
    claims = jwt.verify(token, getJwtSecret(), { audience: 'quickbooks-api', issuer: 'quickbooks-governed-ledger' });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'AUTH_INVALID' });
  }

  const db = getDb();
  try {
    const session = await get(db, `SELECT s.expires_at, u.id, u.username, u.email, u.role, u.active, u.auth_version
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, [hashToken(token)]);
    if (!session || !session.active || Date.parse(session.expires_at) <= Date.now() || session.id !== claims.id || session.auth_version !== claims.authVersion) {
      db.close();
      return res.status(401).json({ error: 'Session is no longer active', code: 'SESSION_REVOKED' });
    }
    db.close();
    req.user = { id: session.id, username: session.username, email: session.email, role: session.role, authVersion: session.auth_version };
    req.authTokenHash = hashToken(token);
    next();
  } catch (error) {
    db.close();
    next(error);
  }
}

module.exports = { authenticateToken, generateToken, getDb, getJwtSecret, hashToken };
