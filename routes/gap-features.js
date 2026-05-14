// === Batch 11 Gaps & Frontend Mounts ===
// Gap features (AI counterparts + Non-AI features) for quickbooks.
// Lazy gap_features table (in-memory), OpenRouter via native fetch.

const express = require('express');
const router = express.Router();

const gapFeatures = new Map();

async function llm(systemPrompt, userMsg, maxTokens = 1400) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) { const e = new Error('OPENROUTER_API_KEY not configured'); e.status = 503; throw e; }
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'quickbooks Gap Features' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }], max_tokens: maxTokens }),
  });
  const data = await r.json();
  if (data && data.error) throw new Error(data.error.message || 'LLM error');
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

function track(slug, payload) {
  const list = gapFeatures.get(slug) || [];
  list.push({ at: new Date().toISOString(), payload });
  gapFeatures.set(slug, list);
}

function safe(res, e) { return res.status((e && e.status) || 500).json({ error: (e && e.message) || 'request failed' }); }

// ---- AI Gap Counterparts ----

router.post('/gap-reconciliation', async (req, res) => {
  try {
    const body = req.body || {};
    const sys = "You match bank transactions to invoices and expenses. Flag discrepancies and propose journal entries.";
    const user = `Body: ${JSON.stringify(body).slice(0, 4000)}`;
    const out = await llm(sys, user);
    track('reconciliation', { keys: Object.keys(body) });
    res.json({ matches: out });
  } catch (e) { safe(res, e); }
});

router.post('/gap-tax-categorizer', async (req, res) => {
  try {
    const body = req.body || {};
    const sys = "You categorize expenses to the correct GL/tax account based on description and amount.";
    const user = `Body: ${JSON.stringify(body).slice(0, 4000)}`;
    const out = await llm(sys, user);
    track('tax-categorizer', { keys: Object.keys(body) });
    res.json({ category: out });
  } catch (e) { safe(res, e); }
});

router.post('/gap-forecasting', async (req, res) => {
  try {
    const body = req.body || {};
    const sys = "You forecast monthly cash flow based on AR/AP aging and historical patterns.";
    const user = `Body: ${JSON.stringify(body).slice(0, 4000)}`;
    const out = await llm(sys, user);
    track('forecasting', { keys: Object.keys(body) });
    res.json({ forecast: out });
  } catch (e) { safe(res, e); }
});

router.post('/gap-duplicate-detector', async (req, res) => {
  try {
    const body = req.body || {};
    const sys = "You detect duplicate transactions and vendor entries.";
    const user = `Body: ${JSON.stringify(body).slice(0, 4000)}`;
    const out = await llm(sys, user);
    track('duplicate-detector', { keys: Object.keys(body) });
    res.json({ duplicates: out });
  } catch (e) { safe(res, e); }
});

router.post('/gap-vendor-bill-ocr', async (req, res) => {
  try {
    const body = req.body || {};
    const sys = "You extract structured fields from vendor bills.";
    const user = `Body: ${JSON.stringify(body).slice(0, 4000)}`;
    const out = await llm(sys, user);
    track('vendor-bill-ocr', { keys: Object.keys(body) });
    res.json({ extraction: out });
  } catch (e) { safe(res, e); }
});

router.post('/gap-anomaly-explainer', async (req, res) => {
  try {
    const body = req.body || {};
    const sys = "You explain why a transaction is anomalous given peer set.";
    const user = `Body: ${JSON.stringify(body).slice(0, 4000)}`;
    const out = await llm(sys, user);
    track('anomaly-explainer', { keys: Object.keys(body) });
    res.json({ explanation: out });
  } catch (e) { safe(res, e); }
});

// ---- Non-AI Gap Features ----

router.post('/gap-bank-sync-plaid', (req, res) => {
  const body = req.body || {};
  const record = { id: 'bank-sync-plaid_' + Date.now(), ...body, createdAt: new Date().toISOString() };
  track('bank-sync-plaid', record);
  res.json({ syncJob: record, status: 'recorded' });
});

router.post('/gap-multi-currency', (req, res) => {
  const body = req.body || {};
  const record = { id: 'multi-currency_' + Date.now(), ...body, createdAt: new Date().toISOString() };
  track('multi-currency', record);
  res.json({ rate: record, status: 'recorded' });
});

router.post('/gap-audit-trail', (req, res) => {
  const body = req.body || {};
  const record = { id: 'audit-trail_' + Date.now(), ...body, createdAt: new Date().toISOString() };
  track('audit-trail', record);
  res.json({ entry: record, status: 'recorded' });
});

router.post('/gap-financial-statements', (req, res) => {
  const body = req.body || {};
  const record = { id: 'financial-statements_' + Date.now(), ...body, createdAt: new Date().toISOString() };
  track('financial-statements', record);
  res.json({ report: record, status: 'recorded' });
});

router.post('/gap-public-api', (req, res) => {
  const body = req.body || {};
  const record = { id: 'public-api_' + Date.now(), ...body, createdAt: new Date().toISOString() };
  track('public-api', record);
  res.json({ endpoint: record, status: 'recorded' });
});

router.post('/gap-mobile-app', (req, res) => {
  const body = req.body || {};
  const record = { id: 'mobile-app_' + Date.now(), ...body, createdAt: new Date().toISOString() };
  track('mobile-app', record);
  res.json({ feature: record, status: 'recorded' });
});

router.get('/gap-features/_audit', (req, res) => {
  const rows = [];
  for (const [k, v] of gapFeatures.entries()) rows.push({ feature: k, events: v.length });
  res.json({ rows });
});

module.exports = router;
