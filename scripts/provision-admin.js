#!/usr/bin/env node
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { validatePasswordStrength } = require('../middleware/validator');
const { close, get, migrate, openDatabase, run, withTransaction } = require('../lib/database');

async function main() {
  const email = process.env.PROVISION_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
  const password = process.env.PROVISION_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  const username = process.env.ADMIN_USERNAME || String(email || '').split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
  if (!username || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('ADMIN_USERNAME must be 3-40 safe characters');
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('ADMIN_EMAIL is invalid');
  const passwordErrors = validatePasswordStrength(password || '');
  if (passwordErrors.length) throw new Error(passwordErrors.join('; '));
  const db = openDatabase();
  try {
    const migration = await migrate(db, { checkOnly: true });
    if (migration.pending.length) throw new Error(`Apply migrations first: ${migration.pending.join(', ')}`);
    const hash = await bcrypt.hash(password, 12);
    let userId;
    await withTransaction(db, async () => {
      const existing = await get(db, 'SELECT id FROM users WHERE username = ? OR email = ?', [username, email.toLowerCase()]);
      if (existing) {
        userId = existing.id;
        await run(db, `UPDATE users SET username=?,email=?,password_hash=?,role='admin',active=1,email_verified=1,
          auth_version=auth_version+1,updated_at=? WHERE id=?`, [username, email.toLowerCase(), hash, new Date().toISOString(), userId]);
        await run(db, 'DELETE FROM sessions WHERE user_id = ?', [userId]);
      } else {
        const result = await run(db, `INSERT INTO users (username, email, password_hash, role, active, email_verified)
          VALUES (?, ?, ?, 'admin', 1, 1)`, [username, email.toLowerCase(), hash]);
        userId = result.lastID;
      }
    });
    console.log(`Configured administrator id ${userId}`);
  } finally { await close(db); }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
