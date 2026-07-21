const fs = require('fs');
const os = require('os');
const path = require('path');
const { close, migrate, openDatabase, run } = require('../lib/database');
const { signWebhook } = require('../lib/security');
const { GovernedBrokerService } = require('../services/GovernedBrokerService');

const SECRET = 'fixture-provider-secret-is-at-least-32-characters';

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quickbooks-test-'));
  const database = path.join(directory, 'ledger.db');
  const db = openDatabase(database);
  await migrate(db);
  const actors = {};
  for (const [name, role] of [['admin', 'admin'], ['manager', 'manager'], ['trader', 'user'], ['viewer', 'viewer']]) {
    const result = await run(db, `INSERT INTO users (username, email, password_hash, role, active, email_verified)
      VALUES (?, ?, 'unused-in-service-tests', ?, 1, 1)`, [name, `${name}@example.test`, role]);
    actors[name] = { id: result.lastID, role, username: name };
  }
  const clock = { value: new Date() };
  const env = { BROKER_TEST_WEBHOOK_SECRET: SECRET };
  const service = new GovernedBrokerService(db, { now: () => new Date(clock.value), env });
  const provider = await service.createProvider({ providerCode: 'TEST', displayName: 'Test Licensed Broker', dataScope: 'BROKER',
    allowedHost: 'broker.example.test', licenseReference: 'LICENSE-TEST-1', licenseExpiresAt: new Date(clock.value.getTime() + 86400000).toISOString(),
    signingSecretEnv: 'BROKER_TEST_WEBHOOK_SECRET' }, actors.admin);
  const account = await service.createCustodyAccount({ externalAccountRef: 'PAPER-001', displayName: 'Paper Custody', openingCashCents: 1000000,
    maxGrossExposureCents: 500000, minLiquidityBps: 2000, maxDailyLossCents: 50000, approvalThresholdCents: 50000,
    quoteStaleAfterSeconds: 60 }, actors.admin);
  await service.createInstrument({ symbol: 'ACME', assetClass: 'EQUITY' }, actors.admin);

  async function ingest(payload, overrides = {}) {
    const rawBody = overrides.rawBody || JSON.stringify(payload);
    const timestamp = overrides.timestamp || String(Math.floor(clock.value.getTime() / 1000));
    const signature = overrides.signature || signWebhook(SECRET, timestamp, rawBody);
    return service.ingestSignedEvent('TEST', { rawBody, timestamp, signature, providerHost: overrides.providerHost || 'broker.example.test' });
  }

  async function cleanup() {
    await close(db);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return { account, actors, clock, database, db, directory, env, ingest, provider, service, cleanup };
}

module.exports = { SECRET, fixture };
