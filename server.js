const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();
const axios = require('axios');
const { Parser } = require('json2csv');

// Import services and processors
const GenericExcelUploadService = require('./services/GenericExcelUploadService');
const FileProcessor = require('./processors/FileProcessor'); // ← ADD THIS LINE
const DatabaseProcessor = require('./processors/DatabaseProcessor');
const QuickBooksProcessor = require('./processors/QuickBooksProcessor');
const QuickBooksService = require('./services/QuickBooksService');

const app = express();
const PORT = process.env.PORT || 5010;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Initialize services
const qbService = new QuickBooksService();
let userTokens = {};

// Middleware
app.use(cors());
app.use(express.json());

// Add this endpoint near your other API endpoints

// ... your other endpoints ...


app.get('/api/export-transactions', async (req, res) => {
  try {
    // Fetch real data from your API
    const response = await axios.get('http://localhost:3000/api/quickbooks/transactions');
    if (!response.data || !response.data.data || !response.data.data.transactions) {
      return res.status(500).json({ error: 'Invalid transactions data' });
    }

    const rawTransactions = response.data.data.transactions;
    // Ensure rawTransactions is an array
    if (!Array.isArray(rawTransactions)) {
      return res.status(500).json({ error: 'Transactions data is not an array' });
    }

    // Transform to Transaction interface
    const transformed = rawTransactions.map(t => ({
      id: t.id || '',
      date: t.date || '',
      amount: typeof t.amount === 'number' ? t.amount : parseFloat(t.amount) || 0,
      description: t.description || '',
      category: t.account|| '',
      type: (t.type === 'income' || t.type === 'inflow') ? 'inflow' : 'outflow',
      merchant: t.merchant || '',
      paymentRef: t.paymentRef || '',
      balance: typeof t.balance === 'number' ? t.balance : (t.balance ? parseFloat(t.balance) : '')
    }));

    // Define CSV fields
    const fields = [
      { label: 'id', value: 'id' },
      { label: 'date', value: 'date' },
      { label: 'amount', value: 'amount' },
      { label: 'description', value: 'description' },
      { label: 'category', value: 'category' },
      { label: 'type', value: 'type' },
      { label: 'merchant', value: 'merchant' },
      { label: 'paymentRef', value: 'paymentRef' },
      { label: 'balance', value: 'balance' }
    ];

    // Create CSV parser
    const parser = new Parser({ fields });
    const csv = parser.parse(transformed);

    // Set headers for CSV download
    res.header('Content-Type', 'text/csv');
    res.attachment('exported_transactions.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting transactions:', error);
    res.status(500).json({ error: error.message });
  }
});


// ==========================================
// GENERIC EXCEL UPLOAD ENDPOINT
// ==========================================

app.post('/api/upload-generic', upload.single('transactionFile'), async (req, res) => {
  try {
     console.log(req.body);
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        message: 'Please select an Excel (.xlsx, .xls) or CSV file'
      });
    }

    console.log(`processors: ${req}`);

    console.log(`Processing generic upload: ${req.file.originalname}`);

    // Configure the generic service
    const uploadService = new GenericExcelUploadService({
     
      validation: {
        requireDate: true,
        requireDescription: true,
        requireAmount: true,
        allowNegativeAmounts: true
      }
    });

    // ✅ FIXED: Add processors based on request parameters
    const { processors} = req.body; // Default to file storage
    const processorList = processors.split(',');

    if (processorList.includes('file')) {
      console.log (`fileprocessor receved.....:${processorList}`)
      // ✅ File-based storage (works immediately)
      const fileProcessor = new FileProcessor({ 
        dataDir: './data',
        filename: 'transactions.json'
      });
      uploadService.addProcessor(fileProcessor);
    }

    if (processorList.includes('database')) {
      console.log (`qdatabase processor receved.....${processorList}`)
      // ✅ SQLite database (properly initialized)
      const dbProcessor = new DatabaseProcessor({
        tableName: 'transactions',
        dbPath: './data/cashflow.db'
      });
      uploadService.addProcessor(dbProcessor);
    }

    if (processorList.includes('quickbooks') && userTokens.accessToken) {
      console.log (`quickbooks processor receved.....:${processorList}`)
      // QuickBooks processor
      const QuickBooksService = require('./services/QuickBooksService');
      const qbProcessor = new QuickBooksProcessor(
        userTokens.accessToken,
        userTokens.refreshToken,
        userTokens.realmId
      );
      uploadService.addProcessor(qbProcessor);
    }

    // Process the file
    const results = await uploadService.processUpload(req.file.path);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: 'File processed successfully!',
      data: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        totalProcessed: results.totalProcessed,
        successfulProcessors: results.successfulProcessors,
        processorResults: results.processorResults,
        errors: results.errors.length,
        errorDetails: results.errors.slice(0, 5)
      }
    });

  } catch (error) {
    console.error('Generic upload processing error:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ 
      error: error.message,
      details: 'Failed to process uploaded file'
    });
  }
});


// Configuration endpoint to set up processors
app.post('/api/configure-processors', (req, res) => {
  const { columnMappings, processors } = req.body;
  
  // Store configuration (in production, use database/session)
  // This is just a demonstration
  
  res.json({
    success: true,
    message: 'Processors configured successfully',
    configuration: {
      columnMappings,
      processors,
      timestamp: new Date().toISOString()
    }
  });
});

// Get supported file formats and configurations
app.get('/api/upload-formats', (req, res) => {
  res.json({
    success: true,
    data: {
      supportedFormats: ['.xlsx', '.xls', '.csv'],
      maxFileSize: '10MB',
      availableProcessors: [
        {
          name: 'database',
          description: 'Save to database',
          required: false
        },
        {
          name: 'quickbooks',
          description: 'Sync to QuickBooks',
          required: userTokens.accessToken ? false : true,
          requiresAuth: true
        }
      ],
      columnMappings: {
        required: ['date', 'amount'],
        optional: ['description', 'category', 'reference'],
        supportedDateFormats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY']
      },
      sampleData: {
        'Date': '2024-06-01',
        'Description': 'Monthly Rent',
        'Amount': '-2500'
      }
    }
  });
});

// ==========================================
// EXISTING ENDPOINTS (Keep your auth and QB)
// ==========================================

// QuickBooks OAuth endpoints
app.get('/auth/quickbooks', (req, res) => {
  try {
    const authUri = qbService.getAuthUri();
    res.json({ 
      success: true,
      authUri: authUri,
      message: 'Visit this URL to authorize QuickBooks access'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const tokenData = await qbService.handleCallback(req.url);
    userTokens = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      realmId: tokenData.realmId
    };
    
    res.json({ 
      success: true, 
      message: 'QuickBooks connected successfully! You can now upload transaction files.',
      realmId: tokenData.realmId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    service: 'Generic Excel Upload API',
    timestamp: new Date().toISOString(),
    quickbooksConnected: !!userTokens.accessToken,
    uploadEnabled: true
  });
});

// Option A: Add the missing endpoint to server.js
app.get('/api/transactions', async (req, res) => {
  try {
    // Get transactions from file storage
    const fileProcessor = new FileProcessor({
      dataDir: './data',
      filename: 'transactions.json'
    });
    
    const transactions = await fileProcessor.getTransactions();
    
    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// QUICKBOOKS TRANSACTION RETRIEVAL ENDPOINTS
// ==========================================

// Get all transactions (combined view)
// ✅ ENHANCED: Extract subcategory from description
app.get('/api/quickbooks/transactions', async (req, res) => {
  try {
    if (!userTokens.accessToken) {
      return res.status(401).json({
        error: 'QuickBooks not connected',
        message: 'Please authenticate with QuickBooks first'
      });
    }

    const QuickBooks = require('node-quickbooks');
    const qbo = new QuickBooks(
      process.env.QB_CLIENT_ID,
      process.env.QB_CLIENT_SECRET,
      userTokens.accessToken,
      false,
      userTokens.realmId,
      process.env.NODE_ENV !== 'production',
      true,
      null,
      '2.0',
      userTokens.refreshToken
    );

    console.log('🔍 Fetching transactions from QuickBooks...');

    // Get all transaction types
    const [purchases, journalEntries] = await Promise.all([
      getPurchases(qbo),
      getJournalEntries(qbo)
    ]);

    console.log(`📊 Retrieved: ${purchases.length} purchases, ${journalEntries.length} journal entries`);

    // Transform purchases (expenses) with subcategory extraction
    const expenseTransactions = purchases.map(purchase => {
      const line = purchase.Line?.[0] || {};
      const description = line.Description || 'No description';
      
      // ✅ Extract subcategory from brackets like "Banking fee [Bank Fees]"
      const subcategoryMatch = description.match(/\[(.*?)\]$/);
      const subcategory = subcategoryMatch ? subcategoryMatch[1] : null;
      const cleanDescription = description.replace(/\s*\[.*?\]$/, '');

      return {
        id: purchase.Id,
        date: purchase.TxnDate,
        type: 'expense',
        subType: 'purchase',
        amount: -(purchase.TotalAmt || 0),
        description: cleanDescription, // ✅ Clean description without brackets
        subcategory: subcategory, // ✅ Extracted subcategory like "Bank Fees"
        category: line.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Unknown',
        account: line.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Unknown',
        quickbooksId: purchase.Id,
        metadata: {
          syncToken: purchase.SyncToken,
          lastUpdated: purchase.MetaData?.LastUpdatedTime
        }
      };
    });

    // Transform journal entries (income) with subcategory extraction
    const incomeTransactions = journalEntries.map(entry => {
      const line = entry.Line?.[0] || {};
      const description = line.Description || 'No description';
      
      // ✅ Extract subcategory from brackets
      const subcategoryMatch = description.match(/\[(.*?)\]$/);
      const subcategory = subcategoryMatch ? subcategoryMatch[1] : null;
      const cleanDescription = description.replace(/\s*\[.*?\]$/, '');

      return {
        id: entry.Id,
        date: entry.TxnDate,
        type: 'income',
        subType: 'journal_entry',
        amount: entry.Line?.find(l => l.JournalEntryLineDetail?.PostingType === 'Credit')?.Amount || 0,
        description: cleanDescription,
        subcategory: subcategory, // ✅ Extracted subcategory
        category: 'Sales',
        account: entry.Line?.find(l => l.JournalEntryLineDetail?.PostingType === 'Credit')?.JournalEntryLineDetail?.AccountRef?.name || 'Sales',
        quickbooksId: entry.Id,
        metadata: {
          syncToken: entry.SyncToken,
          lastUpdated: entry.MetaData?.LastUpdatedTime
        }
      };
    });



    const allTransactions = [...expenseTransactions, ...incomeTransactions];
    
    // Sort by date (newest first)
    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Calculate summary
    const expenses = allTransactions.filter(t => t.type === 'expense');
    const income = allTransactions.filter(t => t.type === 'income');
    const totalExpenses = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);

    console.log(`✅ Returning ${allTransactions.length} transactions with subcategories`);

    res.json({
      success: true,
      data: {
        transactions: allTransactions,
        summary: {
          total: allTransactions.length,
          expenses: expenses.length,
          income: income.length,
          totalIncome,
          totalExpenses,
          netCashFlow: totalIncome - totalExpenses
        }
      }
    });

  } catch (error) {
    console.error('Error fetching QuickBooks transactions:', error);
    res.status(500).json({
      error: error.message,
      details: 'Failed to fetch transactions from QuickBooks'
    });
  }
});


// Get expenses only
app.get('/api/quickbooks/expenses', async (req, res) => {
  try {
    if (!userTokens.accessToken) {
      return res.status(401).json({ 
        error: 'QuickBooks not connected'
      });
    }

    const QuickBooks = require('node-quickbooks');
    const qbo = new QuickBooks(
      process.env.QB_CLIENT_ID,
      process.env.QB_CLIENT_SECRET,
      userTokens.accessToken,
      false,
      userTokens.realmId,
      process.env.NODE_ENV !== 'production',
      true,
      null,
      '2.0',
      userTokens.refreshToken
    );

    const purchases = await getPurchases(qbo);

    res.json({
      success: true,
      data: {
        expenses: purchases.map(p => ({
          id: p.Id,
          date: p.TxnDate,
          amount: parseFloat(p.TotalAmt),
          description: p.Line?.[0]?.Description || 'Expense',
          account: p.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Unknown',
          paymentType: p.PaymentType,
          quickbooksId: p.Id
        })),
        total: purchases.length,
        totalAmount: purchases.reduce((sum, p) => sum + parseFloat(p.TotalAmt), 0)
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get income only  
app.get('/api/quickbooks/income', async (req, res) => {
  try {
    if (!userTokens.accessToken) {
      return res.status(401).json({ 
        error: 'QuickBooks not connected'
      });
    }

    const QuickBooks = require('node-quickbooks');
    const qbo = new QuickBooks(
      process.env.QB_CLIENT_ID,
      process.env.QB_CLIENT_SECRET,
      userTokens.accessToken,
      false,
      userTokens.realmId,
      process.env.NODE_ENV !== 'production',
      true,
      null,
      '2.0',
      userTokens.refreshToken
    );

    const [journalEntries, salesReceipts] = await Promise.all([
      getJournalEntries(qbo),
      getSalesReceipts(qbo)
    ]);

    const incomeTransactions = [
      ...journalEntries.map(j => {
        const debitLine = j.Line?.find(line => 
          line.JournalEntryLineDetail?.PostingType === 'Debit' &&
          line.JournalEntryLineDetail?.AccountRef?.name === 'Undeposited Funds'
        );
        return debitLine ? {
          id: j.Id,
          date: j.TxnDate,
          amount: parseFloat(debitLine.Amount),
          description: debitLine.Description || 'Income',
          type: 'journal_entry',
          quickbooksId: j.Id
        } : null;
      }).filter(Boolean),
      ...salesReceipts.map(s => ({
        id: s.Id,
        date: s.TxnDate,
        amount: parseFloat(s.TotalAmt),
        description: s.Line?.[0]?.Description || 'Sale',
        type: 'sales_receipt',
        quickbooksId: s.Id
      }))
    ];

    res.json({
      success: true,
      data: {
        income: incomeTransactions,
        total: incomeTransactions.length,
        totalAmount: incomeTransactions.reduce((sum, i) => sum + i.amount, 0)
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// DELETE ALL QUICKBOOKS TRANSACTIONS
// ==========================================

app.delete('/api/quickbooks/transactions/all', async (req, res) => {
  try {
    if (!userTokens.accessToken) {
      return res.status(401).json({
        error: 'QuickBooks not connected',
        message: 'Please authenticate with QuickBooks first'
      });
    }

    const QuickBooks = require('node-quickbooks');
    const qbo = new QuickBooks(
      process.env.QB_CLIENT_ID,
      process.env.QB_CLIENT_SECRET,
      userTokens.accessToken,
      false,
      userTokens.realmId,
      process.env.NODE_ENV !== 'production',
      true,
      null,
      '2.0',
      userTokens.refreshToken
    );

    console.log('🗑️ Starting bulk deletion of all QuickBooks transactions...');

    // Get all transaction types
    const [purchases, journalEntries, salesReceipts] = await Promise.all([
      getPurchases(qbo),
      getJournalEntries(qbo),
      getSalesReceipts(qbo)
    ]);

    const deleteResults = {
      totalFound: 0,
      totalDeleted: 0,
      failed: 0,
      errors: [],
      details: {
        purchases: { found: 0, deleted: 0, failed: 0 },
        journalEntries: { found: 0, deleted: 0, failed: 0 },
        salesReceipts: { found: 0, deleted: 0, failed: 0 }
      }
    };

    deleteResults.totalFound = purchases.length + journalEntries.length + salesReceipts.length;

    console.log(`📊 Found ${deleteResults.totalFound} transactions to delete`);
    console.log(`   - Purchases: ${purchases.length}`);
    console.log(`   - Journal Entries: ${journalEntries.length}`);
    console.log(`   - Sales Receipts: ${salesReceipts.length}`);

    // Delete Purchases (Expenses)
    deleteResults.details.purchases.found = purchases.length;
    for (const purchase of purchases) {
      try {
        await deletePurchase(qbo, purchase.Id, purchase.SyncToken);
        deleteResults.details.purchases.deleted++;
        deleteResults.totalDeleted++;
        console.log(`✅ Deleted Purchase: ${purchase.Id} - $${purchase.TotalAmt}`);
      } catch (error) {
        deleteResults.details.purchases.failed++;
        deleteResults.failed++;
        deleteResults.errors.push({
          type: 'Purchase',
          id: purchase.Id,
          error: error.message
        });
        console.error(`❌ Failed to delete Purchase ${purchase.Id}:`, error.message);
      }
    }

    // Delete Journal Entries (Income)
    deleteResults.details.journalEntries.found = journalEntries.length;
    for (const journalEntry of journalEntries) {
      try {
        await deleteJournalEntry(qbo, journalEntry.Id, journalEntry.SyncToken);
        deleteResults.details.journalEntries.deleted++;
        deleteResults.totalDeleted++;
        console.log(`✅ Deleted Journal Entry: ${journalEntry.Id}`);
      } catch (error) {
        deleteResults.details.journalEntries.failed++;
        deleteResults.failed++;
        deleteResults.errors.push({
          type: 'JournalEntry',
          id: journalEntry.Id,
          error: error.message
        });
        console.error(`❌ Failed to delete Journal Entry ${journalEntry.Id}:`, error.message);
      }
    }

    // Delete Sales Receipts
    deleteResults.details.salesReceipts.found = salesReceipts.length;
    for (const salesReceipt of salesReceipts) {
      try {
        await deleteSalesReceipt(qbo, salesReceipt.Id, salesReceipt.SyncToken);
        deleteResults.details.salesReceipts.deleted++;
        deleteResults.totalDeleted++;
        console.log(`✅ Deleted Sales Receipt: ${salesReceipt.Id} - $${salesReceipt.TotalAmt}`);
      } catch (error) {
        deleteResults.details.salesReceipts.failed++;
        deleteResults.failed++;
        deleteResults.errors.push({
          type: 'SalesReceipt',
          id: salesReceipt.Id,
          error: error.message
        });
        console.error(`❌ Failed to delete Sales Receipt ${salesReceipt.Id}:`, error.message);
      }
    }

    console.log(`🎯 Deletion complete: ${deleteResults.totalDeleted}/${deleteResults.totalFound} transactions deleted`);

    res.json({
      success: true,
      message: `Successfully deleted ${deleteResults.totalDeleted} out of ${deleteResults.totalFound} transactions`,
      data: deleteResults
    });

  } catch (error) {
    console.error('Error deleting all transactions:', error);
    res.status(500).json({
      error: error.message,
      details: 'Failed to delete all transactions'
    });
  }
});

// Delete with confirmation endpoint (safer)
app.post('/api/quickbooks/transactions/delete-all-confirm', async (req, res) => {
  try {
    const { confirmPhrase } = req.body;
    
    // Require confirmation phrase for safety
    if (confirmPhrase !== 'DELETE ALL TRANSACTIONS') {
      return res.status(400).json({
        error: 'Invalid confirmation phrase',
        message: 'Please provide the exact confirmation phrase: "DELETE ALL TRANSACTIONS"'
      });
    }

    // Call the delete endpoint internally
    const deleteRequest = await axios.delete('http://localhost:5010/api/quickbooks/transactions/all');
    res.json(deleteRequest.data);

  } catch (error) {
    console.error('Error in confirmed deletion:', error);
    res.status(500).json({
      error: error.message,
      details: 'Failed to delete all transactions'
    });
  }
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// ==========================================
// DELETION HELPER FUNCTIONS (CORRECTED)
// ==========================================
// ✅ Helper method to extract subcategory from account name
function extractSubcategoryFromAccount(accountName) {
  // If account name contains parent info, extract subcategory
  // Example: "Miscellaneous:Bank Fees" → "Bank Fees"
  if (accountName && accountName.includes(':')) {
    return accountName.split(':').pop().trim();
  }
  return null;
}

async function deletePurchase(qbo, id, syncToken) {
  return new Promise((resolve, reject) => {
    // Create the purchase object with Id and SyncToken
    const purchaseToDelete = {
      Id: id,
      SyncToken: syncToken
    };
    
    qbo.deletePurchase(purchaseToDelete, (err, result) => {
      if (err) {
        reject(new Error(`Delete Purchase failed: ${err.Fault?.Error?.[0]?.Detail || err.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

async function deleteJournalEntry(qbo, id, syncToken) {
  return new Promise((resolve, reject) => {
    // Create the journal entry object with Id and SyncToken
    const journalEntryToDelete = {
      Id: id,
      SyncToken: syncToken
    };
    
    qbo.deleteJournalEntry(journalEntryToDelete, (err, result) => {
      if (err) {
        reject(new Error(`Delete Journal Entry failed: ${err.Fault?.Error?.[0]?.Detail || err.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

async function deleteSalesReceipt(qbo, id, syncToken) {
  return new Promise((resolve, reject) => {
    // Create the sales receipt object with Id and SyncToken
    const salesReceiptToDelete = {
      Id: id,
      SyncToken: syncToken
    };
    
    qbo.deleteSalesReceipt(salesReceiptToDelete, (err, result) => {
      if (err) {
        reject(new Error(`Delete Sales Receipt failed: ${err.Fault?.Error?.[0]?.Detail || err.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

// ✅ FIXED: Enhanced transaction retrieval
async function getPurchases(qbo) {
  return new Promise((resolve, reject) => {
    qbo.findPurchases({}, (err, purchases) => {
      if (err) {
        console.error('Error fetching purchases:', err);
        reject(err);
      } else {
        const purchaseList = purchases.QueryResponse?.Purchase || [];
        console.log(`📊 Found ${purchaseList.length} purchase transactions`);
        resolve(purchaseList);
      }
    });
  });
}

async function getJournalEntries(qbo) {
  return new Promise((resolve, reject) => {
    qbo.findJournalEntries({}, (err, journalEntries) => {
      if (err) {
        console.error('Error fetching journal entries:', err);
        reject(err);
      } else {
        const journalList = journalEntries.QueryResponse?.JournalEntry || [];
        console.log(`📊 Found ${journalList.length} journal entry transactions`);
        resolve(journalList);
      }
    });
  });
}


async function getSalesReceipts(qbo) {
  return new Promise((resolve, reject) => {
    qbo.findSalesReceipts({}, (err, receipts) => {
      if (err) reject(err);
      else resolve(receipts.QueryResponse?.SalesReceipt || []);
    });
  });
}

async function getPayments(qbo) {
  return new Promise((resolve, reject) => {
    qbo.findPayments({}, (err, payments) => {
      if (err) reject(err);
      else resolve(payments.QueryResponse?.Payment || []);
    });
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Generic Excel Upload API running on port ${PORT}`);
  console.log(`📁 Generic Upload: http://localhost:${PORT}/api/upload-generic`);
  console.log(`⚙️  Configuration: http://localhost:${PORT}/api/configure-processors`);
  console.log(`📋 Formats Info: http://localhost:${PORT}/api/upload-formats`);
});
