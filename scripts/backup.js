#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { close, databasePath, get, migrate, openDatabase, run } = require('../lib/database');

async function main() {
  const source = path.resolve(databasePath());
  const destinationArg = process.env.BACKUP_PATH || process.argv[2];
  if (!destinationArg) throw new Error('Set BACKUP_PATH or pass an explicit backup path');
  const destination = path.resolve(destinationArg);
  if (source === destination) throw new Error('Backup destination must differ from DATABASE_PATH');
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists; refusing to overwrite it');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const db = openDatabase(source);
  try {
    const migration = await migrate(db, { checkOnly: true });
    if (migration.pending.length) throw new Error(`Pending migrations: ${migration.pending.join(', ')}`);
    await run(db, 'PRAGMA wal_checkpoint(FULL)');
    await run(db, 'VACUUM INTO ?', [destination]);
    const integrity = await get(db, 'PRAGMA integrity_check');
    if (integrity.integrity_check !== 'ok') throw new Error('Source integrity check failed');
  } finally { await close(db); }
  fs.chmodSync(destination, 0o600);
  console.log(destination);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
