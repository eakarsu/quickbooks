const TransactionProcessor = require('../interfaces/TransactionProcessor');
const QuickBooks = require('node-quickbooks');
const AccountMappingService = require('../services/AccountMappingService');
const moment = require('moment');

class QuickBooksProcessor extends TransactionProcessor {
  constructor(accessToken, refreshToken, realmId, config = {}) {
    super('QuickBooks', config);
    
    this.qbo = new QuickBooks(
      process.env.QB_CLIENT_ID,
      process.env.QB_CLIENT_SECRET,
      accessToken,
      false,
      realmId,
      process.env.NODE_ENV !== 'production',
      true,
      null,
      '2.0',
      refreshToken
    );
    
    // Initialize account mapping service
    this.accountMapper = new AccountMappingService(accessToken, refreshToken, realmId);
    this.accountsInitialized = false;
  }

  
  // In QuickBooksProcessor.js:
async createExpenseTransaction(transaction, formattedDate) {
  // ✅ Pass both category and subcategory
  const categoryAccount = await this.accountMapper.getCategoryAccount(
    transaction.category, 
    transaction.subcategory,
    'expense'
  );
  
  // ✅ Include subcategory in description for retrieval
  const enhancedDescription = transaction.subcategory 
    ? `${transaction.description} [${transaction.subcategory}]`
    : transaction.description;

  const expenseData = {
    TxnDate: formattedDate,
    PaymentType: "Cash",
    AccountRef: { value: "92", name: "Undeposited Funds" },
    Line: [{
      Amount: transaction.absoluteAmount,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: {
        AccountRef: categoryAccount
      },
      Description: enhancedDescription // ✅ Include subcategory info
    }]
  };

  return new Promise((resolve, reject) => {
    this.qbo.createPurchase(expenseData, (err, result) => {
      if (err) {
        reject(new Error(`Expense failed: ${err.Fault?.Error?.[0]?.Detail || err.message}`));
      } else {
        this.log(`✅ Created expense: $${transaction.absoluteAmount} - ${transaction.description} - Account: ${categoryAccount.name}`);
        resolve(result);
      }
    });
  });
}


// ✅ Add logging for created accounts summary
async process(transactions) {
  // Initialize account mapping first
  if (!this.accountsInitialized) {
    await this.accountMapper.initializeAccountMapping();
    this.accountsInitialized = true;
  }

  const results = {
    processed: 0,
    salesCreated: 0,
    expensesCreated: 0,
    errors: []
  };

  for (const transaction of transactions) {
    try {
      const formattedDate = this.formatDate(transaction.date);
      
      if (transaction.type === 'income') {
        await this.createIncomeTransaction(transaction, formattedDate);
        results.salesCreated++;
      } else {
        await this.createExpenseTransaction(transaction, formattedDate);
        results.expensesCreated++;
      }
      
      results.processed++;
      this.log(`📊 QB: ${transaction.type} - $${transaction.absoluteAmount} - ${transaction.description} - Category: ${transaction.category}`);
      
    } catch (error) {
      results.errors.push({
        transaction: transaction.originalRowIndex,
        error: error.message
      });
      this.log(`❌ QB Error: ${error.message}`);
    }
  }

  // ✅ Log summary of created accounts
  const createdSummary = this.accountMapper.getCreatedAccountsSummary();
  if (createdSummary.totalCreated > 0) {
    this.log(`🆕 Created ${createdSummary.totalCreated} new QuickBooks accounts: ${createdSummary.accountNames.join(', ')}`);
    results.newAccountsCreated = createdSummary;
  }

  return results;
}


  // processors/QuickBooksProcessor.js
async createIncomeTransaction(transaction, formattedDate) {
  /* -----------------------------------------------------------
     Build description
     – If the CSV row contained a sub-category we preserve it by
       appending  “ [Subcategory]” to the description text.
     ----------------------------------------------------------- */
  const desc = transaction.subcategory
      ? `${transaction.description} [${transaction.subcategory}]`
      : transaction.description || 'Income';

  /* -----------------------------------------------------------
     Journal Entry template
     – Debit Undeposited Funds, Credit Sales
     – You can swap the credit-side account if you want
       a more granular income account mapping later.
     ----------------------------------------------------------- */
  const journalEntryData = {
    TxnDate: formattedDate,
    Line: [
      {
        Amount: transaction.absoluteAmount,
        DetailType: 'JournalEntryLineDetail',
        JournalEntryLineDetail: {
          PostingType: 'Debit',
          AccountRef: { value: '92', name: 'Undeposited Funds' }
        },
        Description: desc
      },
      {
        Amount: transaction.absoluteAmount,
        DetailType: 'JournalEntryLineDetail',
        JournalEntryLineDetail: {
          PostingType: 'Credit',
          AccountRef: { value: '96', name: 'Sales' }   // parent or sub-account is fine
        },
        Description: desc
      }
    ]
  };

  /* -----------------------------------------------------------
     Save the journal entry – wrapped in a Promise so that
     the caller can await it and handle errors uniformly.
     ----------------------------------------------------------- */
  return new Promise((resolve, reject) => {
    this.qbo.createJournalEntry(journalEntryData, (err, result) => {
      if (err) {
        reject(
          new Error(
            `Journal entry failed: ${
              err.Fault?.Error?.[0]?.Detail || err.message
            }`
          )
        );
      } else {
        this.log(
          `✅ Created income JE $${transaction.absoluteAmount} – ${desc}`
        );
        resolve(result);
      }
    });
  });
}
 

  formatDate(dateString) {
    if (!dateString || dateString === '1969-12-31') {
      return moment().format('YYYY-MM-DD');
    }
    
    const parsed = moment(dateString, 'YYYY-MM-DD', true);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');
  }
}

module.exports = QuickBooksProcessor;
