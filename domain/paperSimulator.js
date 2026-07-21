const { notionalCents } = require('./riskEngine');

function runPaperScenario(input) {
  if (!input || !Array.isArray(input.steps) || input.steps.length === 0) throw new Error('Scenario requires non-empty steps');
  let cashCents = input.startingCashCents;
  const quotes = new Map();
  const orders = new Map();
  const idempotency = new Map();
  const observations = [];

  for (const step of input.steps) {
    if (step.type === 'PROVIDER_FAILURE') {
      observations.push({ type: step.type, outcome: 'FAIL_CLOSED', code: step.code || 'PROVIDER_UNAVAILABLE' });
      continue;
    }
    if (step.type === 'QUOTE') {
      quotes.set(step.symbol, step);
      observations.push({ type: step.type, symbol: step.symbol, outcome: 'ACCEPTED' });
      continue;
    }
    if (step.type === 'ORDER') {
      const fingerprint = JSON.stringify([step.symbol, step.side, step.quantityMicros, step.limitPriceMicros]);
      if (idempotency.has(step.idempotencyKey)) {
        observations.push({ type: step.type, outcome: idempotency.get(step.idempotencyKey) === fingerprint ? 'DUPLICATE_REPLAY' : 'IDEMPOTENCY_CONFLICT' });
        continue;
      }
      idempotency.set(step.idempotencyKey, fingerprint);
      const quote = quotes.get(step.symbol);
      const ageSeconds = quote ? Math.floor((Date.parse(step.at) - Date.parse(quote.sourceOccurredAt)) / 1000) : Infinity;
      if (!quote || ageSeconds > input.quoteStaleAfterSeconds) {
        observations.push({ type: step.type, outcome: 'REJECTED', code: 'STALE_OR_MISSING_QUOTE' });
        continue;
      }
      orders.set(step.orderRef, { ...step, filledQuantityMicros: 0 });
      observations.push({ type: step.type, outcome: 'APPROVED', orderRef: step.orderRef });
      continue;
    }
    if (step.type === 'FILL') {
      const order = orders.get(step.orderRef);
      if (!order) {
        observations.push({ type: step.type, outcome: 'REJECTED', code: 'ORDER_NOT_APPROVED' });
        continue;
      }
      if (step.quantityMicros <= 0 || order.filledQuantityMicros + step.quantityMicros > order.quantityMicros) {
        observations.push({ type: step.type, outcome: 'REJECTED', code: 'OVERFILL' });
        continue;
      }
      const cents = notionalCents(step.quantityMicros, step.priceMicros);
      cashCents += order.side === 'BUY' ? -cents : cents;
      order.filledQuantityMicros += step.quantityMicros;
      observations.push({ type: step.type, outcome: order.filledQuantityMicros === order.quantityMicros ? 'FILLED' : 'PARTIALLY_FILLED', notionalCents: cents });
    }
  }

  const required = input.expectedOutcomes || [];
  const seen = new Set(observations.map((item) => item.outcome));
  const missing = required.filter((value) => !seen.has(value));
  return { status: missing.length === 0 ? 'PASSED' : 'FAILED', cashCents, observations, missingExpectedOutcomes: missing };
}

module.exports = { runPaperScenario };
