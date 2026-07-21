const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { all, close, exec, get, migrate, openDatabase, run } = require('../lib/database');
const { fixture } = require('./helpers');

async function freshQuote(ctx, eventId = `quote-${Date.now()}`) {
  return ctx.ingest({ eventId, type: 'QUOTE', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { symbol: 'ACME', bidPriceMicros: 9900000, askPriceMicros: 10000000 } });
}

test('migrations replay cleanly and database rejects an unbalanced posted batch', async (t) => {
  const ctx = await fixture();
  t.after(ctx.cleanup);
  assert.deepEqual((await migrate(ctx.db)).applied, []);
  const pending = await migrate(ctx.db, { checkOnly: true });
  assert.deepEqual(pending.pending, []);
  const batch = await run(ctx.db, `INSERT INTO ledger_batches (batch_type, source_type, source_id, source_occurred_at)
    VALUES ('TRADE_FILL', 'TEST', 'unbalanced', ?)`, [ctx.clock.value.toISOString()]);
  await run(ctx.db, `INSERT INTO ledger_entries (batch_id, custody_account_id, account_code, debit_cents, description)
    VALUES (?, ?, '1000-CASH', 100, 'test')`, [batch.lastID, ctx.account.id]);
  await assert.rejects(run(ctx.db, "UPDATE ledger_batches SET status='POSTED' WHERE id=?", [batch.lastID]), /not balanced|requires at least/);
});

test('failed migration rolls back its schema and is never recorded as applied', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quickbooks-broken-migration-'));
  const migrations = path.join(directory, 'migrations');
  fs.mkdirSync(migrations);
  fs.writeFileSync(path.join(migrations, '001_broken.sql'), 'CREATE TABLE should_rollback (id INTEGER); THIS IS NOT SQL;');
  const db = openDatabase(path.join(directory, 'broken.db'));
  try {
    await assert.rejects(migrate(db, { migrationsDir: migrations }), /Migration 001_broken.sql failed/);
    assert.equal((await get(db, 'SELECT COUNT(*) AS count FROM schema_migrations')).count, 0);
    assert.equal((await get(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='should_rollback'")).count, 0);
  } finally {
    await close(db);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('licensed ingestion is idempotent, timestamped, and conflicts on changed replay', async (t) => {
  const ctx = await fixture();
  t.after(ctx.cleanup);
  const payload = { eventId: 'quote-idempotent', type: 'QUOTE', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { symbol: 'ACME', bidPriceMicros: 9900000, askPriceMicros: 10000000 } };
  const first = await ctx.ingest(payload);
  const duplicate = await ctx.ingest(payload);
  assert.equal(first.result.symbol, 'ACME');
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(ctx.ingest({ ...payload, data: { ...payload.data, askPriceMicros: 10000001 } }), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
  const event = await get(ctx.db, 'SELECT * FROM broker_events WHERE id = ?', [first.eventId]);
  assert.equal(event.source_occurred_at, ctx.clock.value.toISOString());
  assert.equal(event.status, 'APPLIED');
});

test('orders enforce stale data, kill switch, daily loss, exposure, liquidity, and idempotency', async (t) => {
  const ctx = await fixture();
  t.after(ctx.cleanup);
  await freshQuote(ctx, 'quote-risk-1');
  ctx.clock.value = new Date(ctx.clock.value.getTime() + 61000);
  const stale = await ctx.service.submitOrder({ idempotencyKey: 'stale', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY', quantityMicros: 1000000, limitPriceMicros: 10000000 }, ctx.actors.trader);
  assert.equal(stale.order.rejection_code, 'STALE_OR_FUTURE_QUOTE');
  await freshQuote(ctx, 'quote-risk-2');
  let account = await get(ctx.db, 'SELECT * FROM custody_accounts WHERE id=?', [ctx.account.id]);
  await ctx.service.setKillSwitch(ctx.account.id, { enabled: true, reason: 'risk incident', expectedVersion: account.version }, ctx.actors.manager);
  const killed = await ctx.service.submitOrder({ idempotencyKey: 'killed', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY', quantityMicros: 1000000, limitPriceMicros: 10000000 }, ctx.actors.trader);
  assert.equal(killed.order.rejection_code, 'KILL_SWITCH_ACTIVE');
  account = await get(ctx.db, 'SELECT * FROM custody_accounts WHERE id=?', [ctx.account.id]);
  await ctx.service.setKillSwitch(ctx.account.id, { enabled: false, expectedVersion: account.version }, ctx.actors.manager);
  await run(ctx.db, 'INSERT INTO daily_risk_state VALUES (?, ?, ?)', [ctx.account.id, ctx.clock.value.toISOString().slice(0, 10), -50000]);
  const loss = await ctx.service.submitOrder({ idempotencyKey: 'loss', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY', quantityMicros: 1000000, limitPriceMicros: 10000000 }, ctx.actors.trader);
  assert.equal(loss.order.rejection_code, 'DAILY_LOSS_LIMIT');
  await run(ctx.db, 'UPDATE daily_risk_state SET realized_pnl_cents=0 WHERE custody_account_id=?', [ctx.account.id]);
  const exposure = await ctx.service.submitOrder({ idempotencyKey: 'exposure', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY', quantityMicros: 600000000, limitPriceMicros: 10000000 }, ctx.actors.trader);
  assert.equal(exposure.order.rejection_code, 'GROSS_EXPOSURE_LIMIT');
  await run(ctx.db, 'UPDATE custody_accounts SET max_gross_exposure_cents=2000000 WHERE id=?', [ctx.account.id]);
  const liquidity = await ctx.service.submitOrder({ idempotencyKey: 'liquidity', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY', quantityMicros: 900000000, limitPriceMicros: 10000000 }, ctx.actors.trader);
  assert.equal(liquidity.order.rejection_code, 'LIQUIDITY_LIMIT');
  const replay = await ctx.service.submitOrder({ idempotencyKey: 'liquidity', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY', quantityMicros: 900000000, limitPriceMicros: 10000000 }, ctx.actors.trader);
  assert.equal(replay.duplicate, true);
  await assert.rejects(ctx.service.submitOrder({ idempotencyKey: 'liquidity', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY', quantityMicros: 1, limitPriceMicros: 10000000 }, ctx.actors.trader), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
});

test('separate approval, partial fills, settlement, and reversing corrections are durable', async (t) => {
  const ctx = await fixture();
  t.after(ctx.cleanup);
  await freshQuote(ctx, 'quote-trade');
  const submitted = await ctx.service.submitOrder({ idempotencyKey: 'paper-buy', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY', quantityMicros: 100000000, limitPriceMicros: 10000000 }, ctx.actors.trader);
  assert.equal(submitted.order.status, 'PENDING_APPROVAL');
  await assert.rejects(ctx.service.approveOrder(submitted.order.id, { expectedVersion: 1 }, ctx.actors.trader), (error) => error.code === 'SEPARATE_APPROVER_REQUIRED');
  const approved = await ctx.service.approveOrder(submitted.order.id, { expectedVersion: 1 }, ctx.actors.manager);
  assert.equal(approved.status, 'APPROVED');
  const fillOne = await ctx.ingest({ eventId: 'fill-one', type: 'FILL', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { providerFillId: 'PF-1', orderId: approved.id, quantityMicros: 40000000, priceMicros: 10000000 } });
  assert.equal(fillOne.result.orderStatus, 'PARTIALLY_FILLED');
  const fillTwo = await ctx.ingest({ eventId: 'fill-two', type: 'FILL', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { providerFillId: 'PF-2', orderId: approved.id, quantityMicros: 60000000, priceMicros: 10000000 } });
  assert.equal(fillTwo.result.orderStatus, 'FILLED');
  assert.equal((await get(ctx.db, 'SELECT quantity_micros FROM positions WHERE custody_account_id=? AND symbol=?', [ctx.account.id, 'ACME'])).quantity_micros, 100000000);
  const originalFill = await get(ctx.db, "SELECT * FROM fills WHERE provider_fill_id='PF-1'");
  const correction = await ctx.service.correctFill(originalFill.id, { reason: 'provider confirmed erroneous partial' }, ctx.actors.manager);
  assert.equal(correction.kind, 'REVERSAL');
  assert.equal((await get(ctx.db, 'SELECT quantity_micros FROM positions WHERE custody_account_id=? AND symbol=?', [ctx.account.id, 'ACME'])).quantity_micros, 60000000);
  const batchTotals = await all(ctx.db, `SELECT batch_id, SUM(debit_cents) AS debits, SUM(credit_cents) AS credits FROM ledger_entries GROUP BY batch_id`);
  assert.equal(batchTotals.every((row) => row.debits === row.credits), true);
  await assert.rejects(run(ctx.db, 'UPDATE ledger_entries SET description=? WHERE id=1', ['tampered']), /immutable/);
});

test('sell fills derive realized loss from cost basis and trip the next deterministic loss check', async (t) => {
  const ctx = await fixture();
  t.after(ctx.cleanup);
  await freshQuote(ctx, 'quote-cost-buy');
  const buy = (await ctx.service.submitOrder({ idempotencyKey: 'cost-buy', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY',
    quantityMicros: 100000000, limitPriceMicros: 10000000 }, ctx.actors.trader)).order;
  await ctx.service.approveOrder(buy.id, { expectedVersion: buy.version }, ctx.actors.manager);
  await ctx.ingest({ eventId: 'cost-buy-fill', type: 'FILL', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { providerFillId: 'COST-BUY', orderId: buy.id, quantityMicros: 100000000, priceMicros: 10000000 } });
  await ctx.ingest({ eventId: 'quote-cost-sell', type: 'QUOTE', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { symbol: 'ACME', bidPriceMicros: 5000000, askPriceMicros: 5100000 } });
  const sell = (await ctx.service.submitOrder({ idempotencyKey: 'cost-sell', accountId: ctx.account.id, symbol: 'ACME', side: 'SELL',
    quantityMicros: 100000000, limitPriceMicros: 5000000 }, ctx.actors.trader)).order;
  await ctx.service.approveOrder(sell.id, { expectedVersion: sell.version }, ctx.actors.manager);
  const fill = await ctx.ingest({ eventId: 'cost-sell-fill', type: 'FILL', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { providerFillId: 'COST-SELL', orderId: sell.id, quantityMicros: 100000000, priceMicros: 5000000 } });
  assert.equal(fill.result.costBasisDeltaCents, 100000);
  assert.equal(fill.result.realizedPnlCents, -50000);
  assert.equal((await get(ctx.db, 'SELECT realized_pnl_cents FROM daily_risk_state WHERE custody_account_id=?', [ctx.account.id])).realized_pnl_cents, -50000);
  const blocked = await ctx.service.submitOrder({ idempotencyKey: 'after-loss', accountId: ctx.account.id, symbol: 'ACME', side: 'BUY',
    quantityMicros: 1000000, limitPriceMicros: 5100000 }, ctx.actors.trader);
  assert.equal(blocked.order.rejection_code, 'DAILY_LOSS_LIMIT');
  const lossEntry = await get(ctx.db, "SELECT debit_cents FROM ledger_entries WHERE account_code='5100-REALIZED-LOSS'");
  assert.equal(lossEntry.debit_cents, 50000);
});

test('corporate actions and their compensating corrections preserve immutable history', async (t) => {
  const ctx = await fixture();
  t.after(ctx.cleanup);
  await run(ctx.db, 'INSERT INTO positions (custody_account_id,symbol,quantity_micros) VALUES (?,?,?)', [ctx.account.id, 'ACME', 10000000]);
  const split = await ctx.ingest({ eventId: 'split-1', type: 'CORPORATE_ACTION', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { symbol: 'ACME', actionType: 'SPLIT', numerator: 2, denominator: 1, effectiveDate: ctx.clock.value.toISOString().slice(0, 10) } });
  assert.equal((await get(ctx.db, 'SELECT quantity_micros FROM positions WHERE custody_account_id=? AND symbol=?', [ctx.account.id, 'ACME'])).quantity_micros, 20000000);
  await ctx.ingest({ eventId: 'split-correction', type: 'CORPORATE_ACTION', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { symbol: 'ACME', actionType: 'SPLIT', correctionOfEventId: split.eventId, effectiveDate: ctx.clock.value.toISOString().slice(0, 10) } });
  assert.equal((await get(ctx.db, 'SELECT quantity_micros FROM positions WHERE custody_account_id=? AND symbol=?', [ctx.account.id, 'ACME'])).quantity_micros, 10000000);
  const before = (await get(ctx.db, 'SELECT cash_cents FROM custody_accounts WHERE id=?', [ctx.account.id])).cash_cents;
  const dividend = await ctx.ingest({ eventId: 'dividend-1', type: 'CORPORATE_ACTION', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { symbol: 'ACME', actionType: 'CASH_DIVIDEND', cashPerUnitMicros: 500000, effectiveDate: ctx.clock.value.toISOString().slice(0, 10) } });
  assert.equal((await get(ctx.db, 'SELECT cash_cents FROM custody_accounts WHERE id=?', [ctx.account.id])).cash_cents, before + 500);
  await ctx.ingest({ eventId: 'dividend-correction', type: 'CORPORATE_ACTION', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { symbol: 'ACME', actionType: 'CASH_DIVIDEND', correctionOfEventId: dividend.eventId, effectiveDate: ctx.clock.value.toISOString().slice(0, 10) } });
  assert.equal((await get(ctx.db, 'SELECT cash_cents FROM custody_accounts WHERE id=?', [ctx.account.id])).cash_cents, before);
  assert.equal((await get(ctx.db, 'SELECT COUNT(*) AS count FROM corporate_actions')).count, 4);
});

test('reconciliation, resilience evidence, audit export, and immutability are verifiable', async (t) => {
  const ctx = await fixture();
  t.after(ctx.cleanup);
  const matched = await ctx.ingest({ eventId: 'snapshot-match', type: 'POSITION_SNAPSHOT', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { accountId: ctx.account.id, cashCents: 1000000, positions: [] } });
  assert.equal(matched.result.status, 'MATCHED');
  const variance = await ctx.ingest({ eventId: 'snapshot-variance', type: 'POSITION_SNAPSHOT', sourceOccurredAt: ctx.clock.value.toISOString(),
    data: { accountId: ctx.account.id, cashCents: 999900, positions: [{ symbol: 'ACME', quantityMicros: 1 }] } });
  assert.equal(variance.result.status, 'VARIANCE');
  const scenario = await ctx.service.runScenario({ scenarioName: 'provider-failure', startingCashCents: 1000, quoteStaleAfterSeconds: 30,
    expectedOutcomes: ['FAIL_CLOSED'], steps: [{ type: 'PROVIDER_FAILURE', code: 'TIMEOUT' }] }, ctx.actors.manager);
  assert.equal(scenario.status, 'PASSED');
  const exported = await ctx.service.exportAudit();
  assert.equal(exported.verification.valid, true);
  assert.equal(exported.boundary, 'PAPER_ONLY_NO_LIVE_EXECUTION');
  await assert.rejects(run(ctx.db, 'UPDATE audit_events SET action=? WHERE sequence=1', ['tampered']), /immutable/);
});
