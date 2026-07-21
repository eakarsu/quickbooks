#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { verifyAudit } = require('../lib/audit');
const { close, get, migrate, openDatabase } = require('../lib/database');

async function main() {
  const sourceArg = process.env.BACKUP_PATH || process.argv[2];
  if (!sourceArg) throw new Error('Set BACKUP_PATH or pass an explicit backup path');
  const source = path.resolve(sourceArg);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Backup file does not exist');
  const db = openDatabase(source);
  try {
    const integrity = await get(db, 'PRAGMA integrity_check');
    if (integrity.integrity_check !== 'ok') throw new Error(`Integrity check failed: ${integrity.integrity_check}`);
    const migration = await migrate(db, { checkOnly: true });
    if (migration.pending.length) throw new Error(`Backup has pending migrations: ${migration.pending.join(', ')}`);
    const audit = await verifyAudit(db);
    if (!audit.valid) throw new Error(`Audit chain is invalid at sequence ${audit.sequence}`);
    console.log(JSON.stringify({ integrity: 'ok', migrations: migration.applied, audit }));
  } finally { await close(db); }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
