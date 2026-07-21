const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticateToken, generateToken, getDb, hashToken } = require('../middleware/auth');
const { validatePasswordStrength, loginValidation, validate } = require('../middleware/validator');
const { authLimiter } = require('../middleware/rateLimiter');
const { get, run, withTransaction } = require('../lib/database');

const router = express.Router();

router.post('/login', authLimiter, loginValidation, validate, async (req, res, next) => {
  const db = getDb();
  try {
    const user = await get(db, 'SELECT * FROM users WHERE (username = ? OR email = ?) AND active = 1', [req.body.username, req.body.username]);
    const valid = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
    if (!valid || !user.email_verified) {
      db.close();
      return res.status(401).json({ error: 'Invalid credentials', code: 'AUTH_INVALID' });
    }
    const token = generateToken(user);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    await run(db, 'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [user.id, hashToken(token), expiresAt]);
    db.close();
    return res.json({ success: true, token, expiresAt, user: { id: user.id, username: user.username, email: user.email, role: user.role,
      first_name: user.first_name, last_name: user.last_name } });
  } catch (error) {
    db.close();
    return next(error);
  }
});

router.post('/logout', authenticateToken, async (req, res, next) => {
  const db = getDb();
  try {
    await run(db, 'DELETE FROM sessions WHERE token_hash = ?', [req.authTokenHash]);
    db.close();
    return res.json({ success: true });
  } catch (error) {
    db.close();
    return next(error);
  }
});

router.get('/profile', authenticateToken, async (req, res, next) => {
  const db = getDb();
  try {
    const user = await get(db, `SELECT id, username, email, role, first_name, last_name, phone, created_at, updated_at
      FROM users WHERE id = ? AND active = 1`, [req.user.id]);
    db.close();
    return res.json({ success: true, data: user });
  } catch (error) {
    db.close();
    return next(error);
  }
});

router.put('/profile', authenticateToken, async (req, res, next) => {
  const firstName = typeof req.body.first_name === 'string' ? req.body.first_name.trim().slice(0, 80) : null;
  const lastName = typeof req.body.last_name === 'string' ? req.body.last_name.trim().slice(0, 80) : null;
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 40) : null;
  const db = getDb();
  try {
    await run(db, 'UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = ? WHERE id = ?', [firstName, lastName, phone, new Date().toISOString(), req.user.id]);
    db.close();
    return res.json({ success: true });
  } catch (error) {
    db.close();
    return next(error);
  }
});

router.post('/change-password', authenticateToken, async (req, res, next) => {
  const { current_password: currentPassword, new_password: newPassword } = req.body;
  const errors = validatePasswordStrength(newPassword || '');
  if (!currentPassword || errors.length) return res.status(400).json({ error: 'Password requirements not met', details: errors, code: 'PASSWORD_WEAK' });
  const db = getDb();
  try {
    await withTransaction(db, async () => {
      const user = await get(db, 'SELECT password_hash FROM users WHERE id = ? AND active = 1', [req.user.id]);
      if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) throw Object.assign(new Error('Current password is incorrect'), { status: 401, code: 'AUTH_INVALID' });
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await run(db, 'UPDATE users SET password_hash = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?', [passwordHash, new Date().toISOString(), req.user.id]);
      await run(db, 'DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
    });
    db.close();
    return res.json({ success: true, reauthenticationRequired: true });
  } catch (error) {
    db.close();
    return next(error);
  }
});

module.exports = router;
