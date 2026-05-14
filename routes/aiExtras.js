/*
 * AI Extras — Custom Feature Suggestions (batch 11)
 * Bank Sync & Reconciliation Agent, Expense Categorizer, Tax Prep Assistant,
 * Financial Forecasting, Multi-Currency, Integrated Payroll stubs.
 */

const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function getDb() {
  return new sqlite3.Database(path.join(__dirname, '..', 'data', 'cashflow.db'));
}
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function callOpenRouter(systemPrompt, userPrompt, opts = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const e = new Error('OPENROUTER_API_KEY is not configured');
    e.status = 503;
    throw e;
  }
  const r = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: opts.maxTokens || 1500,
      temperature: opts.temperature ?? 0.4,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5010',
        'X-Title': 'QB AI Extras',
      },
      timeout: 60000,
    }
  );
  return r.data?.choices?.[0]?.message?.content || '';
}

function fail(res, e) {
  return res.status(e?.status || 500).json({ error: e?.message || 'AI failed' });
}

// 1) Bank Sync & Reconciliation Agent
router.post('/bank-reconcile', authenticateToken, async (req, res) => {
  try {
    const { bankRows = [], lookbackDays = 90 } = req.body || {};
    if (!bankRows.length) return res.status(400).json({ error: 'bankRows[] required' });
    let tx = [];
    try {
      const db = getDb();
      tx = await dbAll(db, 'SELECT id, date, amount, description, account FROM transactions WHERE date >= date("now", ?) LIMIT 500', [`-${lookbackDays} days`]);
    } catch {}
    const sys = 'You are a bank reconciliation agent. Match bankRows to ledger transactions; flag mismatches with reasons. Output JSON: { matches: [{ bankRowIdx, txId, confidence }], unmatched: [...], discrepancies: [...] }.';
    const out = await callOpenRouter(sys, `BankRows: ${JSON.stringify(bankRows).slice(0, 4000)}\nLedger: ${JSON.stringify(tx).slice(0, 6000)}`, { maxTokens: 1800 });
    res.json({ raw: out });
  } catch (e) { fail(res, e); }
});

// 2) Expense Categorizer — ML/LLM auto-categorize transactions to GL accounts.
router.post('/categorize-expenses', authenticateToken, async (req, res) => {
  try {
    const { transactions = [], chartOfAccounts = [] } = req.body || {};
    if (!transactions.length) return res.status(400).json({ error: 'transactions[] required' });
    const sys = 'You categorize expense transactions into the provided chart of accounts. Output JSON: { results: [{ transactionId, suggestedAccountCode, confidence, reason }] }.';
    const out = await callOpenRouter(sys, `Chart: ${JSON.stringify(chartOfAccounts).slice(0, 2000)}\nTransactions: ${JSON.stringify(transactions).slice(0, 6000)}`, { maxTokens: 1800 });
    res.json({ raw: out });
  } catch (e) { fail(res, e); }
});

// 3) Tax Prep Assistant — collect deductions, generate tax-ready report.
router.post('/tax-prep', authenticateToken, async (req, res) => {
  try {
    const { taxYear, jurisdiction = 'US-IRS', expenses = [], income = [] } = req.body || {};
    if (!taxYear) return res.status(400).json({ error: 'taxYear required' });
    const sys = 'You are a tax preparation assistant. Identify deductible expenses, applicable credits, and produce a structured pre-filing summary. Output JSON: { deductibles: [...], credits: [...], estimatedTax, openQuestions: [...] }.';
    const out = await callOpenRouter(sys, `Year: ${taxYear}\nJurisdiction: ${jurisdiction}\nExpenses: ${JSON.stringify(expenses).slice(0, 4000)}\nIncome: ${JSON.stringify(income).slice(0, 3000)}`, { maxTokens: 1800 });
    res.json({ raw: out });
  } catch (e) { fail(res, e); }
});

// 4) Financial Forecasting — monthly cash flow prediction.
router.post('/forecast', authenticateToken, async (req, res) => {
  try {
    const { arAging = [], apAging = [], monthsAhead = 6, runRate } = req.body || {};
    const sys = 'You are a financial forecaster. Produce a monthly cash flow projection. Output JSON: { months: [{ month, inflow, outflow, ending }], assumptions: [...], risks: [...] }.';
    const out = await callOpenRouter(sys, `MonthsAhead: ${monthsAhead}\nRunRate: ${runRate}\nAR: ${JSON.stringify(arAging).slice(0, 3000)}\nAP: ${JSON.stringify(apAging).slice(0, 3000)}`, { maxTokens: 1800 });
    res.json({ raw: out });
  } catch (e) { fail(res, e); }
});

// 5) Multi-Currency & International — apply FX, track gains/losses.
// TODO: configure credentials — EXCHANGE_RATE_API_KEY for live rates.
router.post('/fx-convert', authenticateToken, async (req, res) => {
  const { lines = [], baseCurrency = 'USD', rates = {} } = req.body || {};
  if (!lines.length) return res.status(400).json({ error: 'lines[] required' });
  const haveLiveRates = !!process.env.EXCHANGE_RATE_API_KEY;
  const converted = lines.map((l) => {
    const fx = rates[l.currency] ?? (l.currency === baseCurrency ? 1 : null);
    const amountBase = fx == null ? null : Number(l.amount || 0) * fx;
    return { ...l, fxRate: fx, amountBase };
  });
  res.json({
    baseCurrency,
    lines: converted,
    fxSource: haveLiveRates ? 'EXCHANGE_RATE_API_KEY' : 'caller-supplied rates only',
    note: haveLiveRates ? null : 'EXCHANGE_RATE_API_KEY not set — TODO: configure credentials for live rates.',
  });
});

// 6) Integrated Payroll — payslip generation stub.
// TODO: configure credentials — GUSTO_API_KEY or ADP_API_KEY for real payroll.
router.post('/payroll/run', authenticateToken, async (req, res) => {
  const { period, employees = [] } = req.body || {};
  if (!period || !employees.length) return res.status(400).json({ error: 'period and employees[] required' });
  const slips = employees.map((e) => {
    const gross = Number(e.grossSalary || 0);
    const fedTax = gross * 0.18;
    const stateTax = gross * 0.05;
    const socsec = gross * 0.062;
    const medicare = gross * 0.0145;
    const net = gross - fedTax - stateTax - socsec - medicare;
    return {
      employeeId: e.id || e.employeeId,
      gross,
      taxes: { fedTax, stateTax, socsec, medicare },
      net,
      period,
    };
  });
  const totalNet = slips.reduce((s, x) => s + x.net, 0);
  res.json({
    period,
    payslips: slips,
    totalNet,
    payrollProviderConfigured: !!(process.env.GUSTO_API_KEY || process.env.ADP_API_KEY),
  });
});

module.exports = router;
