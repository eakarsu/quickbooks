/*
 * routes/ai.js — AI-assisted accounting endpoints for the QuickBooks-style app.
 *
 * Uses OpenRouter (anthropic/claude-haiku-4.5 by default) to provide AI helpers
 * specific to the QuickBooks domain: transaction categorization, anomaly
 * detection, cash-flow forecasting, invoice/expense narrative generation,
 * vendor risk scoring, etc. All endpoints are guarded by authenticateToken.
 */

const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// DB helpers (mirroring the patterns used in routes/transactions.js)
// ---------------------------------------------------------------------------
function getDb() {
  return new sqlite3.Database(path.join(__dirname, '..', 'data', 'cashflow.db'));
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
  });
}

// ---------------------------------------------------------------------------
// OpenRouter helper
// ---------------------------------------------------------------------------
async function callOpenRouter(systemPrompt, userPrompt, opts = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENROUTER_API_KEY is not configured');
    err.status = 500;
    throw err;
  }
  const model = opts.model || process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';
  const maxTokens = opts.maxTokens || 1500;

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: opts.temperature !== undefined ? opts.temperature : 0.4,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5010',
        'X-Title': 'QuickBooks AI Assistant',
      },
      timeout: 60000,
    }
  );

  const data = response.data;
  if (!data || !data.choices || !data.choices[0]) {
    throw new Error('Invalid OpenRouter response');
  }
  return {
    content: data.choices[0].message.content,
    model,
    tokens: data.usage ? data.usage.total_tokens : null,
  };
}

function tryParseJson(text) {
  if (!text) return null;
  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {
    // Try to extract first {...} or [...] block
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (__) { return null; }
    }
    return null;
  }
}

async function ensureAiTables() {
  const db = getDb();
  try {
    await dbRun(db, `
      CREATE TABLE IF NOT EXISTS ai_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        endpoint TEXT NOT NULL,
        request_params TEXT,
        result_text TEXT NOT NULL,
        model_used TEXT,
        tokens_used INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    db.close();
  }
}
ensureAiTables().catch((e) => console.error('ensureAiTables failed:', e.message));

async function persistResult(userId, endpoint, params, result) {
  const db = getDb();
  try {
    await dbRun(
      db,
      `INSERT INTO ai_results (user_id, endpoint, request_params, result_text, model_used, tokens_used)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId || null, endpoint, JSON.stringify(params || {}), result.content, result.model, result.tokens]
    );
  } catch (e) {
    console.error('persistResult failed:', e.message);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// 1. POST /api/ai/categorize-transaction
// Suggest category + confidence for an uncategorized transaction.
// ---------------------------------------------------------------------------
router.post('/categorize-transaction', authenticateToken, async (req, res) => {
  const { description, amount, merchant, type, existingCategories } = req.body || {};
  if (!description || amount === undefined) {
    return res.status(400).json({ error: 'description and amount are required' });
  }

  const system = 'You are an expert bookkeeper for a QuickBooks-style accounting application. ' +
    'Given a transaction, return a JSON object with: category (string, single best chart-of-accounts category), ' +
    'subcategory (string), confidence (0-1 float), tax_deductible (boolean), notes (string). ' +
    'Respond with ONLY the JSON object, no prose.';
  const user = JSON.stringify({
    description,
    amount,
    merchant: merchant || null,
    type: type || (Number(amount) < 0 ? 'expense' : 'income'),
    existing_categories: Array.isArray(existingCategories) ? existingCategories.slice(0, 50) : [],
  });

  try {
    const result = await callOpenRouter(system, user, { maxTokens: 400, temperature: 0.2 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'categorize-transaction', req.body, result);
    res.json({ success: true, data: parsed || { raw: result.content }, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 2. POST /api/ai/detect-anomalies
// Scan recent transactions for anomalies (duplicates, unusual amounts, fraud).
// ---------------------------------------------------------------------------
router.post('/detect-anomalies', authenticateToken, async (req, res) => {
  const { lookbackDays = 90, limit = 200 } = req.body || {};
  const db = getDb();
  try {
    const rows = await dbAll(
      db,
      `SELECT id, date, amount, description, category, type
       FROM transactions
       WHERE date >= date('now', ?)
       ORDER BY date DESC LIMIT ?`,
      [`-${parseInt(lookbackDays, 10) || 90} days`, parseInt(limit, 10) || 200]
    );

    const system = 'You are a forensic accountant. Inspect the transactions and identify anomalies: ' +
      'duplicates, unusual amounts vs the merchant\'s history, suspected fraud, miscategorized items, ' +
      'or vendor billing errors. Return a JSON object: { anomalies: [{ transaction_id, severity, type, reason, suggested_action }], summary: string }. JSON only.';
    const user = `Recent transactions (most recent first):\n${JSON.stringify(rows, null, 2)}`;

    const result = await callOpenRouter(system, user, { maxTokens: 2000, temperature: 0.2 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'detect-anomalies', { lookbackDays, limit, count: rows.length }, result);
    res.json({ success: true, data: parsed || { raw: result.content }, scanned: rows.length, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 3. POST /api/ai/cashflow-forecast
// Given historical transactions, forecast next-N-days cash flow.
// ---------------------------------------------------------------------------
router.post('/cashflow-forecast', authenticateToken, async (req, res) => {
  const { horizonDays = 30 } = req.body || {};
  const db = getDb();
  try {
    const history = await dbAll(
      db,
      `SELECT date, type, amount, category
       FROM transactions
       WHERE date >= date('now', '-180 days')
       ORDER BY date ASC`
    );
    const totals = await dbGet(
      db,
      `SELECT
         COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN ABS(amount) ELSE 0 END), 0) AS expenses
       FROM transactions WHERE date >= date('now', '-180 days')`
    );

    const system = 'You are a CFO assistant. Forecast cash flow for the requested horizon. ' +
      'Return JSON: { forecast: [{ week_start, projected_income, projected_expenses, projected_net }], ' +
      'risks: [string], opportunities: [string], confidence: 0-1 }. JSON only.';
    const user = `Horizon: ${horizonDays} days.\n180-day totals: ${JSON.stringify(totals)}\n` +
      `History (${history.length} rows):\n${JSON.stringify(history.slice(-300))}`;

    const result = await callOpenRouter(system, user, { maxTokens: 2000, temperature: 0.3 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'cashflow-forecast', { horizonDays }, result);
    res.json({ success: true, data: parsed || { raw: result.content }, basis: { rows: history.length, totals }, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4. POST /api/ai/invoice-narrative
// Generate a professional invoice description / line-item write-up.
// ---------------------------------------------------------------------------
router.post('/invoice-narrative', authenticateToken, async (req, res) => {
  const { customer, lineItems, notes, tone = 'professional' } = req.body || {};
  if (!customer || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ error: 'customer and non-empty lineItems are required' });
  }

  const system = 'You write polished invoice narratives for an accounting product. ' +
    'Return JSON: { headline: string, summary: string, line_descriptions: [{ index, description }], payment_terms: string }. JSON only.';
  const user = JSON.stringify({ customer, line_items: lineItems, internal_notes: notes || null, tone });

  try {
    const result = await callOpenRouter(system, user, { maxTokens: 1200, temperature: 0.6 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'invoice-narrative', req.body, result);
    res.json({ success: true, data: parsed || { raw: result.content }, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 5. POST /api/ai/expense-explain
// Given an expense, draft a memo + GL coding suggestion suitable for audit.
// ---------------------------------------------------------------------------
router.post('/expense-explain', authenticateToken, async (req, res) => {
  const { expense } = req.body || {};
  if (!expense) return res.status(400).json({ error: 'expense object is required' });

  const system = 'You are an audit-ready bookkeeper. Produce JSON: ' +
    '{ memo: string, gl_account: string, gl_account_subtype: string, sales_tax_treatment: string, ' +
    'supporting_document_checklist: [string], audit_risk: "low"|"medium"|"high" }. JSON only.';
  const user = `Expense: ${JSON.stringify(expense)}`;

  try {
    const result = await callOpenRouter(system, user, { maxTokens: 700, temperature: 0.3 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'expense-explain', req.body, result);
    res.json({ success: true, data: parsed || { raw: result.content }, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 6. POST /api/ai/vendor-risk-score
// Score a vendor on payment risk / sanctions / spend concentration.
// ---------------------------------------------------------------------------
router.post('/vendor-risk-score', authenticateToken, async (req, res) => {
  const { vendorId, vendor } = req.body || {};
  const db = getDb();
  try {
    let v = vendor;
    let history = [];
    if (vendorId) {
      v = v || await dbGet(db, `SELECT * FROM vendors WHERE id = ?`, [vendorId]);
      history = await dbAll(
        db,
        `SELECT date, amount, description, category
         FROM transactions
         WHERE LOWER(merchant) = LOWER(?) OR LOWER(description) LIKE ?
         ORDER BY date DESC LIMIT 100`,
        [(v && v.name) || '', `%${(v && v.name) || ''}%`]
      );
    }
    if (!v) return res.status(400).json({ error: 'Provide vendorId (existing) or vendor object' });

    const system = 'You are a vendor risk analyst. Return JSON: ' +
      '{ risk_score: 0-100, tier: "low"|"medium"|"high"|"critical", factors: [{ name, weight, evidence }], ' +
      'spend_concentration_pct: number, recommendations: [string] }. JSON only.';
    const user = `Vendor: ${JSON.stringify(v)}\nRecent activity (max 100): ${JSON.stringify(history)}`;

    const result = await callOpenRouter(system, user, { maxTokens: 1200, temperature: 0.3 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'vendor-risk-score', { vendorId }, result);
    res.json({ success: true, data: parsed || { raw: result.content }, history_count: history.length, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 7. POST /api/ai/reconcile-suggest
// Suggest matches between a bank-statement line and ledger transactions.
// ---------------------------------------------------------------------------
router.post('/reconcile-suggest', authenticateToken, async (req, res) => {
  const { bankLine, candidates } = req.body || {};
  if (!bankLine) return res.status(400).json({ error: 'bankLine is required' });

  let pool = candidates;
  const db = getDb();
  try {
    if (!Array.isArray(pool)) {
      const dateRef = bankLine.date || null;
      pool = await dbAll(
        db,
        `SELECT id, date, amount, description, category, type
         FROM transactions
         WHERE ABS(amount) BETWEEN ? AND ?
         ${dateRef ? "AND date BETWEEN date(?, '-7 days') AND date(?, '+7 days')" : ''}
         ORDER BY date DESC LIMIT 100`,
        dateRef
          ? [Math.abs((bankLine.amount || 0)) * 0.95, Math.abs((bankLine.amount || 0)) * 1.05, dateRef, dateRef]
          : [Math.abs((bankLine.amount || 0)) * 0.95, Math.abs((bankLine.amount || 0)) * 1.05]
      );
    }

    const system = 'You match bank statement lines to ledger transactions. Return JSON: ' +
      '{ matches: [{ transaction_id, confidence, reasoning }], unmatched_reason?: string }. JSON only. Order matches by descending confidence.';
    const user = `Bank line: ${JSON.stringify(bankLine)}\nLedger candidates: ${JSON.stringify(pool)}`;

    const result = await callOpenRouter(system, user, { maxTokens: 1200, temperature: 0.2 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'reconcile-suggest', { bankLine, candidate_count: pool.length }, result);
    res.json({ success: true, data: parsed || { raw: result.content }, candidate_count: pool.length, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 8. POST /api/ai/tax-summary
// Summarize tax-relevant figures over a period (quarterly/annual estimate).
// ---------------------------------------------------------------------------
router.post('/tax-summary', authenticateToken, async (req, res) => {
  const { periodStart, periodEnd, jurisdiction = 'US-Federal' } = req.body || {};
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'periodStart and periodEnd (YYYY-MM-DD) are required' });
  const db = getDb();
  try {
    const lines = await dbAll(
      db,
      `SELECT type, category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM transactions
       WHERE date BETWEEN ? AND ?
       GROUP BY type, category
       ORDER BY ABS(total) DESC`,
      [periodStart, periodEnd]
    );

    const system = 'You are a tax preparer\'s assistant. Produce JSON: ' +
      '{ taxable_income_estimate: number, deductible_expenses: number, schedule_c_lines: [{ line, description, amount }], ' +
      'estimated_tax_liability: number, caveats: [string] }. JSON only. Use the supplied jurisdiction.';
    const user = `Jurisdiction: ${jurisdiction}\nPeriod: ${periodStart} to ${periodEnd}\nLines: ${JSON.stringify(lines)}`;

    const result = await callOpenRouter(system, user, { maxTokens: 1500, temperature: 0.2 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'tax-summary', { periodStart, periodEnd, jurisdiction }, result);
    res.json({ success: true, data: parsed || { raw: result.content }, lines_aggregated: lines.length, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 9. POST /api/ai/customer-insight
// Profile a customer's payment behavior and suggest collection strategy.
// ---------------------------------------------------------------------------
router.post('/customer-insight', authenticateToken, async (req, res) => {
  const { customerId } = req.body || {};
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  const db = getDb();
  try {
    const customer = await dbGet(db, `SELECT * FROM customers WHERE id = ?`, [customerId]);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const invoices = await dbAll(
      db,
      `SELECT id, date, due_date, total, status FROM invoices WHERE customer_id = ? ORDER BY date DESC LIMIT 50`,
      [customerId]
    );

    const system = 'You analyze customer accounts. Return JSON: ' +
      '{ payment_behavior: string, average_days_to_pay: number|null, churn_risk: "low"|"medium"|"high", ' +
      'lifetime_value_estimate: number, collection_strategy: [string], next_best_action: string }. JSON only.';
    const user = `Customer: ${JSON.stringify(customer)}\nInvoices: ${JSON.stringify(invoices)}`;

    const result = await callOpenRouter(system, user, { maxTokens: 1200, temperature: 0.3 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'customer-insight', { customerId }, result);
    res.json({ success: true, data: parsed || { raw: result.content }, invoice_count: invoices.length, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 10. POST /api/ai/financial-qa
// Free-form natural-language Q&A grounded on the user's accounting data.
// ---------------------------------------------------------------------------
router.post('/financial-qa', authenticateToken, async (req, res) => {
  const { question, includeRecent = 50 } = req.body || {};
  if (!question || typeof question !== 'string') return res.status(400).json({ error: 'question (string) is required' });

  const db = getDb();
  try {
    const recent = await dbAll(
      db,
      `SELECT date, type, amount, description, category FROM transactions ORDER BY date DESC LIMIT ?`,
      [Math.min(parseInt(includeRecent, 10) || 50, 200)]
    );
    const totals = await dbGet(
      db,
      `SELECT
         COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN type='expense' THEN ABS(amount) ELSE 0 END), 0) AS total_expenses,
         COUNT(*) AS row_count
       FROM transactions`
    );

    const system = 'You are a finance assistant for a small-business owner. Answer using ONLY the supplied data. ' +
      'If the data is insufficient, say so. Be concise. Return JSON: { answer: string, supporting_facts: [string], confidence: 0-1 }. JSON only.';
    const user = `Question: ${question}\nTotals: ${JSON.stringify(totals)}\nRecent transactions: ${JSON.stringify(recent)}`;

    const result = await callOpenRouter(system, user, { maxTokens: 1500, temperature: 0.4 });
    const parsed = tryParseJson(result.content);
    await persistResult(req.user && req.user.id, 'financial-qa', { question, includeRecent }, result);
    res.json({ success: true, data: parsed || { raw: result.content }, model: result.model, tokens: result.tokens });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 11. GET /api/ai/history
// Paginated retrieval of a user's prior AI interactions.
// ---------------------------------------------------------------------------
router.get('/history', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = parseInt(req.query.offset, 10) || 0;
  const endpoint = req.query.endpoint || null;

  const db = getDb();
  try {
    const params = [req.user && req.user.id];
    let where = `WHERE user_id = ?`;
    if (endpoint) { where += ` AND endpoint = ?`; params.push(endpoint); }
    params.push(limit, offset);

    const rows = await dbAll(
      db,
      `SELECT id, endpoint, request_params, result_text, model_used, tokens_used, created_at
       FROM ai_results ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    res.json({ success: true, data: rows, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 12. GET /api/ai/health
// Sanity check: confirms key + model are configured.
// ---------------------------------------------------------------------------
router.get('/health', (req, res) => {
  res.json({
    success: true,
    configured: !!process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5',
  });
});

module.exports = router;
