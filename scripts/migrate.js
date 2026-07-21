#!/usr/bin/env node
require('dotenv').config();
const { close, migrate, openDatabase } = require('../lib/database');

async function main() {
  const checkOnly = process.argv.includes('--check');
  const db = openDatabase();
  try {
    const result = await migrate(db, { checkOnly });
    if (checkOnly && result.pending.length) {
      console.error(`Pending migrations: ${result.pending.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result));
    }
  } finally {
    await close(db);
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
