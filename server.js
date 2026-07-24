const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { authenticateToken, getDb, getJwtSecret } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { all, get, migrate, run } = require('./lib/database');
const { validateOperationalSecret } = require('./lib/security');

function allowedOrigins() {
  return new Set((process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean));
}

function assertRuntimeConfig() {
  getJwtSecret();
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CORS_ORIGINS) throw new Error('CORS_ORIGINS is required in production');
    if (!process.env.DATABASE_PATH) throw new Error('DATABASE_PATH is required in production');
  }
}

function createApp() {
  const app = express();
  const origins = allowedOrigins();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use(cors({
    credentials: false,
    origin(origin, callback) {
      if (!origin || origins.has(origin)) return callback(null, true);
      return callback(Object.assign(new Error('Origin is not allowed'), { status: 403, code: 'CORS_DENIED' }));
    },
  }));
  app.use(express.json({
    limit: '256kb',
    verify(req, _res, buffer) { req.rawBody = buffer.toString('utf8'); },
  }));
  app.use('/api', apiLimiter);

  app.get('/api/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health/ready', async (_req, res) => {
    const db = getDb();
    try {
      const migration = await migrate(db, { checkOnly: true });
      const providers = migration.pending.length ? [] : await all(db, 'SELECT provider_code, signing_secret_env FROM provider_connections WHERE active = 1');
      const missingProviderSecrets = providers.filter((provider) => {
        try { validateOperationalSecret(process.env[provider.signing_secret_env], `Provider ${provider.provider_code} signing secret`); return false; }
        catch { return true; }
      })
        .map((provider) => provider.provider_code);
      db.close();
      if (migration.pending.length || missingProviderSecrets.length) {
        return res.status(503).json({ status: 'not-ready', pendingMigrations: migration.pending, providersMissingSecrets: missingProviderSecrets });
      }
      return res.json({ status: 'ready', appliedMigrations: migration.applied });
    } catch (error) {
      db.close();
      return res.status(503).json({ status: 'not-ready', error: error.message });
    }
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/broker', require('./routes/broker'));
  app.use('/api/transactions', require('./routes/transactions'));
  app.use('/api/customers', require('./routes/customers'));
  app.use('/api/invoices', require('./routes/invoices'));
  app.use('/api/vendors', require('./routes/vendors'));
  app.use('/api/expenses', require('./routes/expenses'));
  app.use('/api/products', require('./routes/products'));
  app.use('/api/accounts', require('./routes/accounts'));

  app.post('/api/runtime-ai/ledger-readiness', authenticateToken, async (req, res, next) => {
    const prompt = String(req.body?.prompt || req.body?.query || '').trim();
    if (!prompt || prompt.length > 8000) return res.status(400).json({ error: 'Prompt must contain 1-8000 characters' });
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL;
    const baseUrl = process.env.OPENROUTER_BASE_URL;
    if (!apiKey || !model || baseUrl !== 'https://openrouter.ai/api/v1') return res.status(503).json({ error: 'Canonical OpenRouter configuration is required' });
    try {
      const provider = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.2, messages: [
          { role: 'system', content: 'Review a governed accounting ledger workflow. Return concise financial-control risks, evidence gaps, next actions, uncertainty, and decisions requiring qualified human accounting approval.' },
          { role: 'user', content: prompt },
        ] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!provider.ok) return res.status(502).json({ error: `OpenRouter returned ${provider.status}` });
      const payload = await provider.json();
      const content = String(payload?.choices?.[0]?.message?.content || '').trim();
      const receipt = String(payload?.id || provider.headers.get('x-request-id') || '').trim();
      if (!content || !receipt) return res.status(502).json({ error: 'OpenRouter returned an incomplete response' });
      const id = crypto.randomUUID();
      const db = getDb();
      try {
        await run(db, `INSERT INTO runtime_ai_results
          (id,user_id,feature,prompt,content,provider,model,provider_response_id)
          VALUES(?,?,'ledger-readiness',?,?,'openrouter',?,?)`, [id, req.user.id, prompt, content, model, receipt]);
      } finally { db.close(); }
      return res.json({ id, content, provider: 'openrouter', model, providerReceipt: { id: receipt } });
    } catch (error) { return next(error); }
  });

  app.get('/api/dashboard', authenticateToken, async (_req, res, next) => {
    const db = getDb();
    try {
      const names = ['transactions', 'customers', 'invoices', 'vendors', 'expenses', 'products', 'accounts'];
      const counts = {};
      for (const name of names) counts[name] = (await get(db, `SELECT COUNT(*) AS count FROM ${name}`)).count;
      const totalIncome = (await get(db, "SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE type='income'")).total;
      const totalExpenses = (await get(db, "SELECT COALESCE(SUM(absoluteAmount),0) AS total FROM transactions WHERE type='expense'")).total;
      const recentTransactions = await all(db, 'SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT 5');
      const broker = {
        paperOrders: (await get(db, 'SELECT COUNT(*) AS count FROM paper_orders')).count,
        quarantinedEvents: (await get(db, "SELECT COUNT(*) AS count FROM broker_events WHERE status='QUARANTINED'")).count,
        reconciliationVariances: (await get(db, "SELECT COUNT(*) AS count FROM reconciliation_runs WHERE status='VARIANCE'")).count,
      };
      db.close();
      return res.json({ success: true, data: { counts, financials: { totalIncome, totalExpenses, netIncome: totalIncome - totalExpenses }, recentTransactions, broker } });
    } catch (error) {
      db.close();
      return next(error);
    }
  });

  app.use('/api', notFoundHandler);
  const dist = path.join(__dirname, 'client', 'dist');
  app.use(express.static(dist, { fallthrough: true, index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
  app.get('{*path}', (_req, res) => {
    const index = path.join(dist, 'index.html');
    if (!fs.existsSync(index)) return res.status(404).json({ error: 'Frontend has not been built' });
    return res.sendFile(index);
  });
  app.use(errorHandler);
  return app;
}

async function start() {
  assertRuntimeConfig();
  const db = getDb();
  const status = await migrate(db, { checkOnly: true });
  db.close();
  if (status.pending.length) throw new Error(`Pending migrations: ${status.pending.join(', ')}`);
  const port = Number(process.env.PORT || 5010);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
  const server = createApp().listen(port, '127.0.0.1', () => console.log(`Governed ledger listening on ${port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start().catch((error) => { console.error(error.message); process.exit(1); });

module.exports = { assertRuntimeConfig, createApp, start };
