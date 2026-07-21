const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { authenticateToken, getDb, getJwtSecret } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { all, get, migrate } = require('./lib/database');
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
  const server = createApp().listen(port, '0.0.0.0', () => console.log(`Governed ledger listening on ${port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start().catch((error) => { console.error(error.message); process.exit(1); });

module.exports = { assertRuntimeConfig, createApp, start };
