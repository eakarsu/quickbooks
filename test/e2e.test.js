const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const { close, migrate, openDatabase, run } = require('../lib/database');
const { signWebhook } = require('../lib/security');

test('HTTP workflow authenticates roles, ingests signed data, and blocks unsafe surfaces', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quickbooks-e2e-'));
  const database = path.join(directory, 'ledger.db');
  process.env.DATABASE_PATH = database;
  process.env.JWT_SECRET = 'e2e-jwt-secret-that-is-at-least-32-characters';
  process.env.CORS_ORIGINS = 'https://ledger.example.test';
  process.env.BROKER_E2E_WEBHOOK_SECRET = 'e2e-provider-secret-that-is-at-least-32-characters';
  const db = openDatabase(database);
  await migrate(db);
  const password = 'Long-E2E-Password-123!';
  const passwordHash = await bcrypt.hash(password, 12);
  for (const [username, role] of [['admin-e2e', 'admin'], ['trader-e2e', 'user'], ['manager-e2e', 'manager']]) {
    await run(db, `INSERT INTO users (username,email,password_hash,role,active,email_verified) VALUES (?,?,?, ?,1,1)`,
      [username, `${username}@example.test`, passwordHash, role]);
  }
  await close(db);
  const { createApp } = require('../server');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function request(method, route, { token, body, origin, headers = {} } = {}) {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { response, data };
  }

  async function login(username) {
    const result = await request('POST', '/api/auth/login', { body: { username, password } });
    assert.equal(result.response.status, 200);
    return result.data.token;
  }

  const admin = await login('admin-e2e');
  const trader = await login('trader-e2e');
  const manager = await login('manager-e2e');
  assert.equal((await request('GET', '/api/broker/operations')).response.status, 401);
  assert.equal((await request('POST', '/api/auth/register', { body: {} })).response.status, 404);
  assert.equal((await request('GET', '/api/dashboard', { token: admin, origin: 'https://evil.example' })).response.status, 403);

  const expires = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await request('POST', '/api/broker/providers', { token: admin, body: { providerCode: 'E2E', displayName: 'E2E Broker', dataScope: 'BROKER',
    allowedHost: 'broker.e2e.example', licenseReference: 'E2E-LICENSE', licenseExpiresAt: expires, signingSecretEnv: 'BROKER_E2E_WEBHOOK_SECRET' } })).response.status, 201);
  const accountResult = await request('POST', '/api/broker/accounts', { token: admin, body: { externalAccountRef: 'E2E-PAPER', displayName: 'E2E Paper',
    openingCashCents: 1000000, maxGrossExposureCents: 500000, minLiquidityBps: 1000, maxDailyLossCents: 50000,
    approvalThresholdCents: 50000, quoteStaleAfterSeconds: 60 } });
  assert.equal(accountResult.response.status, 201);
  const accountId = accountResult.data.data.id;
  assert.equal((await request('POST', '/api/broker/instruments', { token: admin, body: { symbol: 'ACME', assetClass: 'EQUITY' } })).response.status, 201);

  async function webhook(payload, signatureOverride) {
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signatureOverride || signWebhook(process.env.BROKER_E2E_WEBHOOK_SECRET, timestamp, raw);
    return request('POST', '/api/broker/webhooks/E2E', { body: raw, headers: { 'x-provider-host': 'broker.e2e.example', 'x-provider-timestamp': timestamp, 'x-provider-signature': signature } });
  }
  const quote = { eventId: 'e2e-quote', type: 'QUOTE', sourceOccurredAt: new Date().toISOString(), data: { symbol: 'ACME', bidPriceMicros: 9900000, askPriceMicros: 10000000 } };
  assert.equal((await webhook(quote)).response.status, 200);
  assert.equal((await webhook(quote)).data.duplicate, true);
  assert.equal((await webhook({ ...quote, eventId: 'bad-signature' }, '0'.repeat(64))).response.status, 401);
  const submitted = await request('POST', '/api/broker/orders', { token: trader, body: { idempotencyKey: 'e2e-order', accountId, symbol: 'ACME', side: 'BUY', quantityMicros: 100000000, limitPriceMicros: 10000000 } });
  assert.equal(submitted.data.data.order.status, 'PENDING_APPROVAL');
  const order = submitted.data.data.order;
  assert.equal((await request('POST', `/api/broker/orders/${order.id}/approve`, { token: trader, body: { expectedVersion: order.version } })).response.status, 403);
  assert.equal((await request('POST', `/api/broker/orders/${order.id}/approve`, { token: manager, body: { expectedVersion: order.version } })).response.status, 200);
  assert.equal((await webhook({ eventId: 'e2e-fill-1', type: 'FILL', sourceOccurredAt: new Date().toISOString(),
    data: { providerFillId: 'E2E-FILL-1', orderId: order.id, quantityMicros: 40000000, priceMicros: 10000000 } })).data.result.orderStatus, 'PARTIALLY_FILLED');
  assert.equal((await webhook({ eventId: 'e2e-fill-2', type: 'FILL', sourceOccurredAt: new Date().toISOString(),
    data: { providerFillId: 'E2E-FILL-2', orderId: order.id, quantityMicros: 60000000, priceMicros: 10000000 } })).data.result.orderStatus, 'FILLED');
  assert.equal((await request('POST', '/api/broker/live-orders', { token: admin, body: {} })).response.status, 403);
  assert.equal((await request('GET', '/api/health/ready')).response.status, 200);
  const audit = await request('GET', '/api/broker/audit-export', { token: admin });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.data.verification.valid, true);
  assert.equal(audit.data.boundary, 'PAPER_ONLY_NO_LIVE_EXECUTION');
});
