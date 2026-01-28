const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Setup database
const dataDir = './data';
const dbPath = './data/cashflow.db';

// Ensure directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Create database and table
const db = new sqlite3.Database(dbPath);

db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    category TEXT,
    reference TEXT,
    type TEXT CHECK(type IN ('income', 'expense')),
    absoluteAmount REAL,
    originalRowIndex INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('❌ Database setup failed:', err);
  } else {
    console.log('✅ Database setup complete');
  }
  db.close();
});

