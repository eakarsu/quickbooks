const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const PROJECT_ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'migrations');

function databasePath() {
  return process.env.DATABASE_PATH || process.env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'cashflow.db');
}

function openDatabase(filename = databasePath()) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new sqlite3.Database(filename);
  db.configure('busyTimeout', 5000);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function callback(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => (error ? reject(error) : resolve()));
  });
}

function close(db) {
  return new Promise((resolve, reject) => db.close((error) => (error ? reject(error) : resolve())));
}

async function migrate(db, { checkOnly = false, migrationsDir = MIGRATIONS_DIR } = {}) {
  await exec(db, 'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  await run(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const crypto = require('crypto');
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  const applied = new Map((await all(db, 'SELECT version, checksum FROM schema_migrations')).map((row) => [row.version, row.checksum]));
  const pending = [];

  for (const file of files) {
    const body = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(body).digest('hex');
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) throw new Error(`Applied migration checksum changed: ${file}`);
      continue;
    }
    pending.push({ file, body, checksum });
  }

  if (checkOnly) return { pending: pending.map(({ file }) => file), applied: applied.size };
  for (const migration of pending) {
    await exec(db, 'BEGIN IMMEDIATE');
    try {
      await exec(db, migration.body);
      await run(db, 'INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [migration.file, migration.checksum]);
      await exec(db, 'COMMIT');
    } catch (error) {
      await exec(db, 'ROLLBACK').catch(() => {});
      throw new Error(`Migration ${migration.file} failed: ${error.message}`);
    }
  }
  return { applied: pending.map(({ file }) => file), current: files.length };
}

async function withTransaction(db, operation) {
  await exec(db, 'BEGIN IMMEDIATE');
  try {
    const result = await operation();
    await exec(db, 'COMMIT');
    return result;
  } catch (error) {
    await exec(db, 'ROLLBACK').catch(() => {});
    throw error;
  }
}

module.exports = { all, close, databasePath, exec, get, migrate, openDatabase, run, withTransaction };
