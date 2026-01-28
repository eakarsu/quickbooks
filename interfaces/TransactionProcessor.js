// Base class for transaction processors
class TransactionProcessor {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
  }

  // Override this method in implementations
  async process(transactions) {
    throw new Error('process() method must be implemented');
  }

  // Helper method for logging
  log(message) {
    console.log(`[${this.name}] ${message}`);
  }
}

module.exports = TransactionProcessor;
