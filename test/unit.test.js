const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateOrder, notionalCents } = require('../domain/riskEngine');
const { runPaperScenario } = require('../domain/paperSimulator');
const { canonicalize, requestHash, signWebhook, validateOperationalSecret, verifyWebhook } = require('../lib/security');

test('integer micro-unit math produces deterministic cent notionals', () => {
  assert.equal(notionalCents(2500000, 12345678), 3086);
  assert.throws(() => notionalCents(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), /safe integer range/);
});

test('risk engine applies approval and all fail-closed limits without an LLM', () => {
  const now = Date.now();
  const base = {
    account: { cash_cents: 100000, quote_stale_after_seconds: 60, kill_switch: 0, max_daily_loss_cents: 1000,
      max_gross_exposure_cents: 10000, min_liquidity_bps: 1000, approval_threshold_cents: 500 },
    order: { symbol: 'ACME', side: 'BUY', quantity_micros: 1000000, limit_price_micros: 10000000 },
    quote: { source_occurred_at: new Date(now).toISOString(), bid_price_micros: 9900000, ask_price_micros: 10000000 },
    positions: [], realizedPnlCents: 0, nowMs: now,
  };
  const allowed = evaluateOrder(base);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.approvalRequired, true);
  const denied = evaluateOrder({ ...base, account: { ...base.account, kill_switch: 1, max_gross_exposure_cents: 500, min_liquidity_bps: 9999 }, realizedPnlCents: -1000 });
  assert.deepEqual(denied.failures, ['KILL_SWITCH_ACTIVE', 'DAILY_LOSS_LIMIT', 'GROSS_EXPOSURE_LIMIT', 'LIQUIDITY_LIMIT']);
});

test('signed webhook verification rejects tampering and replay', () => {
  const secret = 'unit-test-webhook-secret-at-least-32-characters';
  const nowMs = Date.now();
  const timestamp = String(Math.floor(nowMs / 1000));
  const rawBody = '{"eventId":"one"}';
  const signature = signWebhook(secret, timestamp, rawBody);
  assert.equal(verifyWebhook({ secret, timestamp, signature, rawBody, nowMs }), true);
  assert.throws(() => verifyWebhook({ secret, timestamp, signature, rawBody: `${rawBody} `, nowMs }), (error) => error.code === 'WEBHOOK_SIGNATURE_INVALID');
  assert.throws(() => verifyWebhook({ secret, timestamp: String(Number(timestamp) - 301), signature, rawBody, nowMs }), (error) => error.code === 'WEBHOOK_REPLAY_WINDOW');
});

test('runtime secrets reject example placeholders even when they are long', () => {
  assert.throws(
    () => validateOperationalSecret('replace-with-at-least-32-random-characters', 'JWT_SECRET'),
    (error) => error.code === 'CONFIG_SECRET_PLACEHOLDER',
  );
  assert.equal(validateOperationalSecret('locally-generated-unique-secret-8f31d420', 'JWT_SECRET'), 'locally-generated-unique-secret-8f31d420');
});

test('canonical hashes are independent of object key order', () => {
  assert.equal(canonicalize({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(requestHash({ a: 1, b: 2 }), requestHash({ b: 2, a: 1 }));
});

test('paper simulator covers outage, stale data, duplicate orders, and partial fills', () => {
  const now = new Date();
  const result = runPaperScenario({ startingCashCents: 100000, quoteStaleAfterSeconds: 30,
    expectedOutcomes: ['FAIL_CLOSED', 'REJECTED', 'DUPLICATE_REPLAY', 'PARTIALLY_FILLED', 'FILLED'], steps: [
      { type: 'PROVIDER_FAILURE' },
      { type: 'QUOTE', symbol: 'ACME', sourceOccurredAt: new Date(now.getTime() - 60000).toISOString() },
      { type: 'ORDER', orderRef: 'stale', idempotencyKey: 'stale', symbol: 'ACME', side: 'BUY', quantityMicros: 1000000, limitPriceMicros: 1000000, at: now.toISOString() },
      { type: 'QUOTE', symbol: 'ACME', sourceOccurredAt: now.toISOString() },
      { type: 'ORDER', orderRef: 'ok', idempotencyKey: 'same', symbol: 'ACME', side: 'BUY', quantityMicros: 2000000, limitPriceMicros: 1000000, at: now.toISOString() },
      { type: 'ORDER', orderRef: 'ok', idempotencyKey: 'same', symbol: 'ACME', side: 'BUY', quantityMicros: 2000000, limitPriceMicros: 1000000, at: now.toISOString() },
      { type: 'FILL', orderRef: 'ok', quantityMicros: 1000000, priceMicros: 1000000 },
      { type: 'FILL', orderRef: 'ok', quantityMicros: 1000000, priceMicros: 1000000 },
    ] });
  assert.equal(result.status, 'PASSED');
  assert.equal(result.cashCents, 99800);
});
