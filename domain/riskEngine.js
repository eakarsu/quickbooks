function asBigInt(value, name) {
  if (!Number.isSafeInteger(value)) throw Object.assign(new Error(`${name} must be a safe integer`), { code: 'INVALID_INTEGER' });
  return BigInt(value);
}

function toSafeNumber(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw Object.assign(new Error(`${name} exceeds safe integer range`), { code: 'INTEGER_OVERFLOW' });
  return number;
}

function notionalCents(quantityMicros, priceMicros) {
  const numerator = asBigInt(quantityMicros, 'quantityMicros') * asBigInt(priceMicros, 'priceMicros');
  const cents = (numerator + 5_000_000_000n) / 10_000_000_000n;
  if (cents <= 0n) throw Object.assign(new Error('Order notional rounds below one cent'), { code: 'NOTIONAL_TOO_SMALL' });
  return toSafeNumber(cents, 'notionalCents');
}

function positionValueCents(quantityMicros, priceMicros) {
  if (quantityMicros === 0) return 0;
  return notionalCents(quantityMicros, priceMicros);
}

function evaluateOrder({ account, order, quote, positions, realizedPnlCents, nowMs }) {
  const failures = [];
  const quoteMs = Date.parse(quote.source_occurred_at);
  const ageSeconds = Math.floor((nowMs - quoteMs) / 1000);
  if (!Number.isFinite(quoteMs) || ageSeconds > account.quote_stale_after_seconds || ageSeconds < -30) failures.push('STALE_OR_FUTURE_QUOTE');
  if (account.kill_switch) failures.push('KILL_SWITCH_ACTIVE');
  if (realizedPnlCents <= -account.max_daily_loss_cents) failures.push('DAILY_LOSS_LIMIT');

  const executionReference = order.side === 'BUY' ? quote.ask_price_micros : quote.bid_price_micros;
  if (order.side === 'BUY' && order.limit_price_micros < executionReference) failures.push('LIMIT_NOT_MARKETABLE');
  if (order.side === 'SELL' && order.limit_price_micros > executionReference) failures.push('LIMIT_NOT_MARKETABLE');

  const orderNotional = notionalCents(order.quantity_micros, order.limit_price_micros);
  let currentGross = 0;
  let currentTargetQuantity = 0;
  let currentTargetValue = 0;
  for (const position of positions) {
    const value = positionValueCents(position.quantity_micros, position.mark_price_micros);
    currentGross += value;
    if (position.symbol === order.symbol) {
      currentTargetQuantity = position.quantity_micros;
      currentTargetValue = value;
    }
  }
  const signedQuantity = order.side === 'BUY' ? order.quantity_micros : -order.quantity_micros;
  const projectedQuantity = currentTargetQuantity + signedQuantity;
  if (projectedQuantity < 0) failures.push('CUSTODY_SHORT_SALE_FORBIDDEN');
  const projectedTargetValue = projectedQuantity <= 0 ? 0 : positionValueCents(projectedQuantity, executionReference);
  const projectedGross = currentGross - currentTargetValue + projectedTargetValue;
  if (projectedGross > account.max_gross_exposure_cents) failures.push('GROSS_EXPOSURE_LIMIT');

  const projectedCash = account.cash_cents + (order.side === 'BUY' ? -orderNotional : orderNotional);
  if (projectedCash < 0) failures.push('INSUFFICIENT_CUSTODY_CASH');
  const totalLiquidationValue = Math.max(1, projectedCash + projectedGross);
  const projectedLiquidityBps = Math.floor((projectedCash * 10000) / totalLiquidationValue);
  if (projectedLiquidityBps < account.min_liquidity_bps) failures.push('LIQUIDITY_LIMIT');

  return {
    allowed: failures.length === 0,
    failures,
    notionalCents: orderNotional,
    quoteAgeSeconds: ageSeconds,
    currentGrossExposureCents: currentGross,
    projectedGrossExposureCents: projectedGross,
    projectedCashCents: projectedCash,
    projectedLiquidityBps,
    realizedPnlCents,
    approvalRequired: orderNotional >= account.approval_threshold_cents,
  };
}

module.exports = { evaluateOrder, notionalCents, positionValueCents };
