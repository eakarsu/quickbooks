const TransactionProcessor = require('../interfaces/TransactionProcessor');
const fs = require('fs');
const path = require('path');

class FileProcessor extends TransactionProcessor {
  constructor(config = {}) {
    super('File Storage', config);
    this.dataDir = config.dataDir || './data';
    this.filename = config.filename || 'transactions.json';
    this.filePath = path.join(this.dataDir, this.filename);
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async process(transactions) {
    const results = {
      processed: 0,
      created: 0,
      errors: []
    };

    try {
      // Load existing transactions
      let existingTransactions = [];
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf8');
        existingTransactions = JSON.parse(fileContent);
      }

      // Add new transactions
      for (const transaction of transactions) {
        try {
          const savedTransaction = {
            id: Date.now() + Math.random(), // Simple ID generation
            ...transaction,
            createdAt: new Date().toISOString()
          };

          existingTransactions.push(savedTransaction);
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

      // Save back to file
      fs.writeFileSync(this.filePath, JSON.stringify(existingTransactions, null, 2));
      
      this.log(`✅ Saved ${results.created} transactions to ${this.filePath}`);
      
    } catch (error) {
      this.log(`❌ File processing error: ${error.message}`);
      throw error;
    }

    return results;
  }

  // Method to read transactions
  async getTransactions() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(fileContent);
      }
      return [];
    } catch (error) {
      this.log(`❌ Error reading transactions: ${error.message}`);
      return [];
    }
  }
}

module.exports = FileProcessor;
