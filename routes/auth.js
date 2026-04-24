const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { authenticateToken, generateToken, getDb } = require('../middleware/auth');
const { validatePasswordStrength, registerValidation, loginValidation, validate, sanitizeInputs } = require('../middleware/validator');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// POST /api/auth/register
router.post('/register', authLimiter, sanitizeInputs, registerValidation, validate, async (req, res) => {
  const { username, email, password, first_name, last_name, phone } = req.body;

  // Password strength check
  const pwdErrors = validatePasswordStrength(password);
  if (pwdErrors.length > 0) {
    return res.status(400).json({ error: 'Weak password', details: pwdErrors });
  }

  const db = getDb();
  try {
    // Check existing
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    if (existing) {
      db.close();
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const verification_token = crypto.randomBytes(32).toString('hex');

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO users (username,email,password_hash,role,email_verified,verification_token,first_name,last_name,phone) VALUES (?,?,?,'user',0,?,?,?,?)`,
        [username, email, password_hash, verification_token, first_name || null, last_name || null, phone || null],
        function (err) { if (err) reject(err); else resolve(this); }
      );
    });

    db.close();
    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email.',
      verification_token,
    });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, sanitizeInputs, loginValidation, validate, async (req, res) => {
  const { username, password } = req.body;
  const db = getDb();

  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    if (!user) {
      db.close();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      db.close();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await new Promise((resolve, reject) => {
      db.run('INSERT INTO sessions (user_id, token, expires_at) VALUES (?,?,?)',
        [user.id, token, expires_at], (err) => { if (err) reject(err); else resolve(); });
    });

    db.close();
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        email_verified: user.email_verified,
      },
    });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const db = getDb();

  try {
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM sessions WHERE token = ?', [token], (err) => {
        if (err) reject(err); else resolve();
      });
    });
    db.close();
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, sanitizeInputs, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const db = getDb();
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    if (user) {
      const reset_token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

      await new Promise((resolve, reject) => {
        db.run('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
          [reset_token, expires, user.id], (err) => { if (err) reject(err); else resolve(); });
      });
    }

    db.close();
    // Always return success (don't reveal if email exists)
    res.json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, sanitizeInputs, async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) return res.status(400).json({ error: 'Token and new password required' });

  const pwdErrors = validatePasswordStrength(new_password);
  if (pwdErrors.length > 0) {
    return res.status(400).json({ error: 'Weak password', details: pwdErrors });
  }

  const db = getDb();
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > datetime("now")',
        [token], (err, row) => { if (err) reject(err); else resolve(row); });
    });

    if (!user) {
      db.close();
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
        [password_hash, user.id], (err) => { if (err) reject(err); else resolve(); });
    });

    // Invalidate all sessions
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM sessions WHERE user_id = ?', [user.id], (err) => {
        if (err) reject(err); else resolve();
      });
    });

    db.close();
    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticateToken, sanitizeInputs, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password required' });
  }

  const pwdErrors = validatePasswordStrength(new_password);
  if (pwdErrors.length > 0) {
    return res.status(400).json({ error: 'Weak password', details: pwdErrors });
  }

  const db = getDb();
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      db.close();
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?',
        [password_hash, req.user.id], (err) => { if (err) reject(err); else resolve(); });
    });

    db.close();
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', sanitizeInputs, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Verification token required' });

  const db = getDb();
  try {
    const result = await new Promise((resolve, reject) => {
      db.run('UPDATE users SET email_verified = 1, verification_token = NULL WHERE verification_token = ?',
        [token], function (err) { if (err) reject(err); else resolve(this); });
    });

    db.close();
    if (result.changes === 0) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }
    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/profile
router.get('/profile', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id,username,email,role,email_verified,first_name,last_name,phone,created_at,updated_at FROM users WHERE id = ?',
        [req.user.id], (err, row) => { if (err) reject(err); else resolve(row); });
    });
    db.close();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/profile
router.put('/profile', authenticateToken, sanitizeInputs, async (req, res) => {
  const { first_name, last_name, phone, email } = req.body;
  const db = getDb();

  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET first_name=?,last_name=?,phone=?,email=?,updated_at=datetime("now") WHERE id=?',
        [first_name, last_name, phone, email, req.user.id], (err) => { if (err) reject(err); else resolve(); });
    });
    db.close();
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
