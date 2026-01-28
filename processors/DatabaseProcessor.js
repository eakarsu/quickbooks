const TransactionProcessor = require('../interfaces/TransactionProcessor');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseProcessor extends TransactionProcessor {
  constructor(config = {}) {
    super('Database', config);
    this.tableName = config.tableName || 'transactions';
    this.dbPath = config.dbPath || './data/cashflow.db';
    this.initialized = false;
    
    // ✅ FIXED: Initialize database synchronously in constructor
    this.initializeDatabase();
  }

  // ✅ FIXED: Make initialization synchronous and ensure it completes
  initializeDatabase() {
    try {
      // Ensure data directory exists
      const dbDir = path.dirname(this.dbPath);
      const fs = require('fs');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // ✅ FIXED: Create database connection synchronously
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          this.log(`❌ Database connection error: ${err.message}`);
          throw err;
        }
      });
      
      // ✅ FIXED: Create table synchronously before any transactions
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
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
      `;

      // ✅ FIXED: Use run() synchronously to ensure table exists before proceeding
      this.db.run(createTableQuery, (err) => {
        if (err) {
          this.log(`❌ Table creation error: ${err.message}`);
          throw err;
        }
        this.initialized = true;
        this.log(`✅ Database initialized: ${this.dbPath}`);
      });

    } catch (error) {
      this.log(`❌ Database initialization error: ${error.message}`);
      throw error;
    }
  }

  // ✅ FIXED: Ensure database is ready before processing
  async process(transactions) {
    // Wait for initialization if not complete
    if (!this.initialized) {
      await new Promise((resolve) => {
        const checkInit = () => {
          if (this.initialized) {
            resolve();
          } else {
            setTimeout(checkInit, 10); // Check every 10ms
          }
        };
        checkInit();
      });
    }

    const results = {
      processed: 0,
      created: 0,
      errors: []
    };

    for (const transaction of transactions) {
      try {
        await this.saveTransaction(transaction);
        results.created++;
        results.processed++;
        this.log(`💾 Saved: ${transaction.description} - $${transaction.amount}`);
      } catch (error) {
        results.errors.push({
          transaction: transaction.originalRowIndex,
          error: error.message
        });
        this.log(`❌ Error saving transaction: ${error.message}`);
      }
    }

    return results;
  }

  async saveTransaction(transaction) {
    const query = `
      INSERT INTO ${this.tableName} 
      (date, description, amount, category, reference, type, absoluteAmount, originalRowIndex)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const values = [
      transaction.date,
      transaction.description,
      transaction.amount,
      transaction.category,
      transaction.reference,
      transaction.type,
      transaction.absoluteAmount,
      transaction.originalRowIndex
    ];

    return new Promise((resolve, reject) => {
      this.db.run(query, values, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  }
}

module.exports = DatabaseProcessor;
