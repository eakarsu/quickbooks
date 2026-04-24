const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
require('dotenv').config();
const axios = require('axios');
const { Parser } = require('json2csv');

// Import middleware
const { sanitizeInputs } = require('./middleware/validator');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Import route modules
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const customerRoutes = require('./routes/customers');
const invoiceRoutes = require('./routes/invoices');
const vendorRoutes = require('./routes/vendors');
const expenseRoutes = require('./routes/expenses');
const productRoutes = require('./routes/products');
const accountRoutes = require('./routes/accounts');

// Import services and processors
const GenericExcelUploadService = require('./services/GenericExcelUploadService');
const FileProcessor = require('./processors/FileProcessor');
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

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(sanitizeInputs);
app.use('/api', apiLimiter);

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'client', 'dist')));

// ==========================================
// API ROUTES
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/products', productRoutes);
app.use('/api/accounts', accountRoutes);

// ==========================================
// DASHBOARD SUMMARY ENDPOINT
// ==========================================
app.get('/api/dashboard', async (req, res) => {
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database(path.join(__dirname, 'data', 'cashflow.db'));

  const dbAll = (sql, p = []) => new Promise((resolve, reject) => {
    db.all(sql, p, (err, rows) => err ? reject(err) : resolve(rows));
  });
  const dbGet = (sql, p = []) => new Promise((resolve, reject) => {
    db.get(sql, p, (err, row) => err ? reject(err) : resolve(row));
  });

  try {
    const [txnCount, custCount, invCount, vendCount, expCount, prodCount, acctCount] = await Promise.all([
      dbGet('SELECT COUNT(*) as count FROM transactions'),
      dbGet('SELECT COUNT(*) as count FROM customers'),
      dbGet('SELECT COUNT(*) as count FROM invoices'),
      dbGet('SELECT COUNT(*) as count FROM vendors'),
      dbGet('SELECT COUNT(*) as count FROM expenses'),
      dbGet('SELECT COUNT(*) as count FROM products'),
      dbGet('SELECT COUNT(*) as count FROM accounts'),
    ]);

    const [totalIncome, totalExpenses, unpaidInvoices, pendingExpenses] = await Promise.all([
      dbGet("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='income'"),
      dbGet("SELECT COALESCE(SUM(absoluteAmount),0) as total FROM transactions WHERE type='expense'"),
      dbGet("SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM invoices WHERE status IN ('sent','overdue')"),
      dbGet("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM expenses WHERE status='pending'"),
    ]);

    const recentTransactions = await dbAll('SELECT * FROM transactions ORDER BY date DESC LIMIT 5');

    db.close();
    res.json({
      success: true,
      data: {
        counts: {
          transactions: txnCount.count,
          customers: custCount.count,
          invoices: invCount.count,
          vendors: vendCount.count,
          expenses: expCount.count,
          products: prodCount.count,
          accounts: acctCount.count,
        },
        financials: {
          totalIncome: totalIncome.total,
          totalExpenses: totalExpenses.total,
          netIncome: totalIncome.total - totalExpenses.total,
          unpaidInvoices: { total: unpaidInvoices.total, count: unpaidInvoices.count },
          pendingExpenses: { total: pendingExpenses.total, count: pendingExpenses.count },
        },
        recentTransactions,
      },
    });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// LEGACY ENDPOINTS (kept for compatibility)
// ==========================================

app.get('/api/export-transactions', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:3000/api/quickbooks/transactions');
    if (!response.data || !response.data.data || !response.data.data.transactions) {
      return res.status(500).json({ error: 'Invalid transactions data' });
    }
    const rawTransactions = response.data.data.transactions;
    if (!Array.isArray(rawTransactions)) {
      return res.status(500).json({ error: 'Transactions data is not an array' });
    }
    const transformed = rawTransactions.map(t => ({
      id: t.id || '', date: t.date || '',
      amount: typeof t.amount === 'number' ? t.amount : parseFloat(t.amount) || 0,
      description: t.description || '', category: t.account || '',
      type: (t.type === 'income' || t.type === 'inflow') ? 'inflow' : 'outflow',
      merchant: t.merchant || '', paymentRef: t.paymentRef || '',
      balance: typeof t.balance === 'number' ? t.balance : (t.balance ? parseFloat(t.balance) : '')
    }));
    const fields = [
      { label: 'id', value: 'id' }, { label: 'date', value: 'date' },
      { label: 'amount', value: 'amount' }, { label: 'description', value: 'description' },
      { label: 'category', value: 'category' }, { label: 'type', value: 'type' },
      { label: 'merchant', value: 'merchant' }, { label: 'paymentRef', value: 'paymentRef' },
      { label: 'balance', value: 'balance' }
    ];
    const parser = new Parser({ fields });
    const csv = parser.parse(transformed);
    res.header('Content-Type', 'text/csv');
    res.attachment('exported_transactions.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/upload-generic', upload.single('transactionFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded', message: 'Please select an Excel (.xlsx, .xls) or CSV file' });
    }
    const uploadService = new GenericExcelUploadService({
      validation: { requireDate: true, requireDescription: true, requireAmount: true, allowNegativeAmounts: true }
    });
    const { processors } = req.body;
    const processorList = processors ? processors.split(',') : ['database'];
    if (processorList.includes('file')) {
      uploadService.addProcessor(new FileProcessor({ dataDir: './data', filename: 'transactions.json' }));
    }
    if (processorList.includes('database')) {
      uploadService.addProcessor(new DatabaseProcessor({ tableName: 'transactions', dbPath: './data/cashflow.db' }));
    }
    if (processorList.includes('quickbooks') && userTokens.accessToken) {
      uploadService.addProcessor(new QuickBooksProcessor(userTokens.accessToken, userTokens.refreshToken, userTokens.realmId));
    }
    const results = await uploadService.processUpload(req.file.path);
    fs.unlinkSync(req.file.path);
    res.json({
      success: true, message: 'File processed successfully!',
      data: {
        fileName: req.file.originalname, fileSize: req.file.size,
        totalProcessed: results.totalProcessed, successfulProcessors: results.successfulProcessors,
        processorResults: results.processorResults, errors: results.errors.length,
        errorDetails: results.errors.slice(0, 5)
      }
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message, details: 'Failed to process uploaded file' });
  }
});

app.post('/api/configure-processors', (req, res) => {
  const { columnMappings, processors } = req.body;
  res.json({ success: true, message: 'Processors configured successfully', configuration: { columnMappings, processors, timestamp: new Date().toISOString() } });
});

app.get('/api/upload-formats', (req, res) => {
  res.json({
    success: true,
    data: {
      supportedFormats: ['.xlsx', '.xls', '.csv'], maxFileSize: '10MB',
      availableProcessors: [
        { name: 'database', description: 'Save to database', required: false },
        { name: 'quickbooks', description: 'Sync to QuickBooks', required: !userTokens.accessToken, requiresAuth: true }
      ],
      columnMappings: { required: ['date', 'amount'], optional: ['description', 'category', 'reference'], supportedDateFormats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'] },
    }
  });
});

// QuickBooks OAuth endpoints
app.get('/auth/quickbooks', (req, res) => {
  try {
    const authUri = qbService.getAuthUri();
    res.json({ success: true, authUri, message: 'Visit this URL to authorize QuickBooks access' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const tokenData = await qbService.handleCallback(req.url);
    userTokens = { accessToken: tokenData.accessToken, refreshToken: tokenData.refreshToken, realmId: tokenData.realmId };
    res.json({ success: true, message: 'QuickBooks connected successfully!', realmId: tokenData.realmId });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', service: 'QuickBooks Application API', timestamp: new Date().toISOString(), quickbooksConnected: !!userTokens.accessToken, uploadEnabled: true });
});

// ==========================================
// QUICKBOOKS TRANSACTION ENDPOINTS
// ==========================================

function getQbo() {
  const QuickBooks = require('node-quickbooks');
  return new QuickBooks(process.env.QB_CLIENT_ID, process.env.QB_CLIENT_SECRET, userTokens.accessToken, false, userTokens.realmId, process.env.NODE_ENV !== 'production', true, null, '2.0', userTokens.refreshToken);
}

async function getPurchases(qbo) { return new Promise((resolve, reject) => { qbo.findPurchases({}, (err, p) => { if (err) reject(err); else resolve(p.QueryResponse?.Purchase || []); }); }); }
async function getJournalEntries(qbo) { return new Promise((resolve, reject) => { qbo.findJournalEntries({}, (err, j) => { if (err) reject(err); else resolve(j.QueryResponse?.JournalEntry || []); }); }); }
async function getSalesReceipts(qbo) { return new Promise((resolve, reject) => { qbo.findSalesReceipts({}, (err, r) => { if (err) reject(err); else resolve(r.QueryResponse?.SalesReceipt || []); }); }); }

app.get('/api/quickbooks/transactions', async (req, res) => {
  try {
    if (!userTokens.accessToken) return res.status(401).json({ error: 'QuickBooks not connected' });
    const qbo = getQbo();
    const [purchases, journalEntries] = await Promise.all([getPurchases(qbo), getJournalEntries(qbo)]);
    const expenseTransactions = purchases.map(p => {
      const line = p.Line?.[0] || {};
      const desc = line.Description || 'No description';
      const subMatch = desc.match(/\[(.*?)\]$/);
      return { id: p.Id, date: p.TxnDate, type: 'expense', subType: 'purchase', amount: -(p.TotalAmt || 0),
        description: desc.replace(/\s*\[.*?\]$/, ''), subcategory: subMatch ? subMatch[1] : null,
        category: line.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Unknown', quickbooksId: p.Id,
        metadata: { syncToken: p.SyncToken, lastUpdated: p.MetaData?.LastUpdatedTime } };
    });
    const incomeTransactions = journalEntries.map(e => {
      const line = e.Line?.[0] || {};
      const desc = line.Description || 'No description';
      const subMatch = desc.match(/\[(.*?)\]$/);
      return { id: e.Id, date: e.TxnDate, type: 'income', subType: 'journal_entry',
        amount: e.Line?.find(l => l.JournalEntryLineDetail?.PostingType === 'Credit')?.Amount || 0,
        description: desc.replace(/\s*\[.*?\]$/, ''), subcategory: subMatch ? subMatch[1] : null,
        category: 'Sales', quickbooksId: e.Id,
        metadata: { syncToken: e.SyncToken, lastUpdated: e.MetaData?.LastUpdatedTime } };
    });
    const all = [...expenseTransactions, ...incomeTransactions].sort((a, b) => new Date(b.date) - new Date(a.date));
    const expenses = all.filter(t => t.type === 'expense');
    const income = all.filter(t => t.type === 'income');
    res.json({ success: true, data: { transactions: all, summary: { total: all.length, expenses: expenses.length, income: income.length,
      totalIncome: income.reduce((s, t) => s + t.amount, 0), totalExpenses: expenses.reduce((s, t) => s + Math.abs(t.amount), 0),
      netCashFlow: income.reduce((s, t) => s + t.amount, 0) - expenses.reduce((s, t) => s + Math.abs(t.amount), 0) } } });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// SPA fallback - serve index.html for all non-API routes
app.get('{*path}', (req, res) => {
  const indexPath = path.join(__dirname, 'client', 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not built. Run: cd client && npm run build' });
  }
});

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Frontend: http://localhost:${PORT}`);
});
