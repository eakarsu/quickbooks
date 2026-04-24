const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'quickbooks-secret-key-change-in-production';
const JWT_EXPIRES = '24h';

function getDb() {
  return new sqlite3.Database(path.join(__dirname, '..', 'data', 'cashflow.db'));
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const db = getDb();
  // Check if token is in active sessions
  db.get('SELECT * FROM sessions WHERE token = ? AND expires_at > datetime("now")', [token], (err, session) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }
    if (!session) {
      db.close();
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      db.close();
      if (err) return res.status(403).json({ error: 'Invalid token' });
      req.user = user;
      next();
    });
  });
}

// Lighter auth - just verify JWT without session check (for less critical routes)
function authenticateTokenLight(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

module.exports = { authenticateToken, authenticateTokenLight, generateToken, getDb, JWT_SECRET };
