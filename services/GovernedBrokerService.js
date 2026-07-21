const crypto = require('crypto');
const { all, exec, get, run, withTransaction } = require('../lib/database');
const { appendAudit, verifyAudit } = require('../lib/audit');
const { requestHash, validateProviderHost, verifyWebhook } = require('../lib/security');
const { evaluateOrder, notionalCents, positionValueCents } = require('../domain/riskEngine');
const { runPaperScenario } = require('../domain/paperSimulator');

function domainError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requireSafeInteger(value, name, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw domainError('VALIDATION_ERROR', `${name} must be an integer from ${min} through ${max}`);
  return value;
}

function requireText(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw domainError('VALIDATION_ERROR', `${name} is required and must be at most ${max} characters`);
  return value.trim();
}

function requireIsoDate(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw domainError('VALIDATION_ERROR', `${name} must be an ISO-8601 timestamp`);
  return new Date(value).toISOString();
}

function databaseTimestampMs(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return Date.parse(`${value.replace(' ', 'T')}Z`);
  return Date.parse(value);
}

class GovernedBrokerService {
  constructor(db, { now = () => new Date(), env = process.env } = {}) {
    this.db = db;
    this.now = now;
    this.env = env;
  }

  async createProvider(input, actor) {
    const providerCode = requireText(input.providerCode, 'providerCode', 40).toUpperCase();
    const displayName = requireText(input.displayName, 'displayName');
    const dataScope = requireText(input.dataScope, 'dataScope', 10).toUpperCase();
    if (!['MARKET', 'BROKER'].includes(dataScope)) throw domainError('VALIDATION_ERROR', 'dataScope must be MARKET or BROKER');
    const allowedHost = validateProviderHost(input.allowedHost);
    const licenseReference = requireText(input.licenseReference, 'licenseReference');
    const licenseExpiresAt = requireIsoDate(input.licenseExpiresAt, 'licenseExpiresAt');
    if (Date.parse(licenseExpiresAt) <= this.now().getTime()) throw domainError('LICENSE_EXPIRED', 'Provider license must be current');
    const signingSecretEnv = requireText(input.signingSecretEnv, 'signingSecretEnv', 100);
    if (!/^BROKER_[A-Z0-9_]+_WEBHOOK_SECRET$/.test(signingSecretEnv)) throw domainError('VALIDATION_ERROR', 'signingSecretEnv must match BROKER_*_WEBHOOK_SECRET');

    return withTransaction(this.db, async () => {
      const result = await run(this.db, `INSERT INTO provider_connections
        (provider_code, display_name, data_scope, allowed_host, license_reference, license_expires_at, signing_secret_env, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [providerCode, displayName, dataScope, allowedHost, licenseReference, licenseExpiresAt, signingSecretEnv, actor.id]);
      await appendAudit(this.db, { actorType: 'USER', actorId: actor.id, action: 'PROVIDER_CONFIGURED', entityType: 'PROVIDER_CONNECTION', entityId: result.lastID,
        details: { providerCode, dataScope, allowedHost, licenseReference, licenseExpiresAt, signingSecretEnv } });
      return get(this.db, 'SELECT * FROM provider_connections WHERE id = ?', [result.lastID]);
    });
  }

  async createCustodyAccount(input, actor) {
    const values = {
      externalAccountRef: requireText(input.externalAccountRef, 'externalAccountRef'),
      displayName: requireText(input.displayName, 'displayName'),
      openingCashCents: requireSafeInteger(input.openingCashCents, 'openingCashCents', { min: 0 }),
      maxGrossExposureCents: requireSafeInteger(input.maxGrossExposureCents, 'maxGrossExposureCents', { min: 1 }),
      minLiquidityBps: requireSafeInteger(input.minLiquidityBps, 'minLiquidityBps', { min: 0, max: 10000 }),
      maxDailyLossCents: requireSafeInteger(input.maxDailyLossCents, 'maxDailyLossCents', { min: 1 }),
      approvalThresholdCents: requireSafeInteger(input.approvalThresholdCents, 'approvalThresholdCents', { min: 0 }),
      quoteStaleAfterSeconds: requireSafeInteger(input.quoteStaleAfterSeconds ?? 60, 'quoteStaleAfterSeconds', { min: 1, max: 3600 }),
    };
    return withTransaction(this.db, async () => {
      const result = await run(this.db, `INSERT INTO custody_accounts
        (external_account_ref, display_name, opening_cash_cents, cash_cents, max_gross_exposure_cents, min_liquidity_bps,
         max_daily_loss_cents, approval_threshold_cents, quote_stale_after_seconds, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [values.externalAccountRef, values.displayName, values.openingCashCents,
        values.openingCashCents, values.maxGrossExposureCents, values.minLiquidityBps, values.maxDailyLossCents,
        values.approvalThresholdCents, values.quoteStaleAfterSeconds, actor.id]);
      await appendAudit(this.db, { actorType: 'USER', actorId: actor.id, action: 'PAPER_CUSTODY_ACCOUNT_CREATED', entityType: 'CUSTODY_ACCOUNT', entityId: result.lastID,
        details: { ...values, mode: 'PAPER', currency: 'USD' } });
      return get(this.db, 'SELECT * FROM custody_accounts WHERE id = ?', [result.lastID]);
    });
  }

  async createInstrument(input, actor) {
    const symbol = requireText(input.symbol, 'symbol', 16).toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,15}$/.test(symbol)) throw domainError('VALIDATION_ERROR', 'symbol is invalid');
    const assetClass = requireText(input.assetClass, 'assetClass', 10).toUpperCase();
    if (!['EQUITY', 'ETF', 'BOND', 'CASH'].includes(assetClass)) throw domainError('VALIDATION_ERROR', 'assetClass is invalid');
    return withTransaction(this.db, async () => {
      await run(this.db, 'INSERT INTO instruments (symbol, asset_class) VALUES (?, ?)', [symbol, assetClass]);
      await appendAudit(this.db, { actorType: 'USER', actorId: actor.id, action: 'INSTRUMENT_ALLOWLISTED', entityType: 'INSTRUMENT', entityId: symbol, details: { assetClass } });
      return get(this.db, 'SELECT * FROM instruments WHERE symbol = ?', [symbol]);
    });
  }

  async setKillSwitch(accountId, { enabled, reason, expectedVersion }, actor) {
    requireSafeInteger(Number(accountId), 'accountId', { min: 1 });
    requireSafeInteger(expectedVersion, 'expectedVersion', { min: 1 });
    if (typeof enabled !== 'boolean') throw domainError('VALIDATION_ERROR', 'enabled must be boolean');
    if (enabled) requireText(reason, 'reason', 500);
    return withTransaction(this.db, async () => {
      const result = await run(this.db, `UPDATE custody_accounts SET kill_switch = ?, kill_reason = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`, [enabled ? 1 : 0, enabled ? reason.trim() : null, this.now().toISOString(), Number(accountId), expectedVersion]);
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', 'Custody account version is stale or account does not exist', 409);
      const account = await get(this.db, 'SELECT * FROM custody_accounts WHERE id = ?', [Number(accountId)]);
      await appendAudit(this.db, { actorType: 'USER', actorId: actor.id, action: enabled ? 'KILL_SWITCH_ENABLED' : 'KILL_SWITCH_DISABLED', entityType: 'CUSTODY_ACCOUNT', entityId: accountId,
        details: { reason: enabled ? reason.trim() : null, version: account.version } });
      return account;
    });
  }

  async _riskContext(accountId, symbol) {
    const account = await get(this.db, 'SELECT * FROM custody_accounts WHERE id = ?', [accountId]);
    if (!account) throw domainError('ACCOUNT_NOT_FOUND', 'Custody account not found', 404);
    if (account.mode !== 'PAPER') throw domainError('LIVE_EXECUTION_FORBIDDEN', 'Only PAPER custody accounts are supported', 403);
    const instrument = await get(this.db, 'SELECT * FROM instruments WHERE symbol = ? AND active = 1', [symbol]);
    if (!instrument) throw domainError('INSTRUMENT_NOT_ALLOWED', 'Instrument is not allowlisted', 403);
    const quote = await get(this.db, 'SELECT * FROM market_quotes WHERE symbol = ? ORDER BY source_occurred_at DESC, id DESC LIMIT 1', [symbol]);
    if (!quote) throw domainError('QUOTE_MISSING', 'No licensed quote is available', 409);
    const rawPositions = await all(this.db, `SELECT p.symbol, p.quantity_micros,
      (SELECT CASE WHEN p.symbol = ? THEN ? ELSE ((q.bid_price_micros + q.ask_price_micros) / 2) END
       FROM market_quotes q WHERE q.symbol = p.symbol ORDER BY q.source_occurred_at DESC, q.id DESC LIMIT 1) AS mark_price_micros
      FROM positions p WHERE p.custody_account_id = ?`, [symbol, Math.floor((quote.bid_price_micros + quote.ask_price_micros) / 2), accountId]);
    if (rawPositions.some((position) => !position.mark_price_micros)) throw domainError('POSITION_QUOTE_MISSING', 'A held position has no licensed quote', 409);
    const riskDate = this.now().toISOString().slice(0, 10);
    const riskState = await get(this.db, 'SELECT realized_pnl_cents FROM daily_risk_state WHERE custody_account_id = ? AND risk_date = ?', [accountId, riskDate]);
    return { account, quote, positions: rawPositions, realizedPnlCents: riskState ? riskState.realized_pnl_cents : 0 };
  }

  async submitOrder(input, actor) {
    const request = {
      idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey', 100),
      accountId: requireSafeInteger(input.accountId, 'accountId', { min: 1 }),
      symbol: requireText(input.symbol, 'symbol', 16).toUpperCase(),
      side: requireText(input.side, 'side', 4).toUpperCase(),
      quantityMicros: requireSafeInteger(input.quantityMicros, 'quantityMicros', { min: 1 }),
      limitPriceMicros: requireSafeInteger(input.limitPriceMicros, 'limitPriceMicros', { min: 1 }),
    };
    if (!['BUY', 'SELL'].includes(request.side)) throw domainError('VALIDATION_ERROR', 'side must be BUY or SELL');
    const fingerprint = requestHash(request);
    return withTransaction(this.db, async () => {
      const duplicate = await get(this.db, 'SELECT * FROM paper_orders WHERE idempotency_key = ?', [request.idempotencyKey]);
      if (duplicate) {
        if (duplicate.request_hash !== fingerprint) throw domainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with another request', 409);
        return { order: duplicate, duplicate: true };
      }
      const context = await this._riskContext(request.accountId, request.symbol);
      const risk = evaluateOrder({
        account: context.account,
        order: { symbol: request.symbol, side: request.side, quantity_micros: request.quantityMicros, limit_price_micros: request.limitPriceMicros },
        quote: context.quote,
        positions: context.positions,
        realizedPnlCents: context.realizedPnlCents,
        nowMs: this.now().getTime(),
      });
      const status = risk.allowed ? (risk.approvalRequired ? 'PENDING_APPROVAL' : 'APPROVED') : 'REJECTED';
      const result = await run(this.db, `INSERT INTO paper_orders
        (idempotency_key, request_hash, custody_account_id, symbol, side, quantity_micros, limit_price_micros, quote_id,
         quote_source_at, computed_notional_cents, status, requested_by, rejection_code, risk_snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [request.idempotencyKey, fingerprint, request.accountId, request.symbol,
        request.side, request.quantityMicros, request.limitPriceMicros, context.quote.id, context.quote.source_occurred_at,
        risk.notionalCents, status, actor.id, risk.failures[0] || null, JSON.stringify(risk)]);
      const order = await get(this.db, 'SELECT * FROM paper_orders WHERE id = ?', [result.lastID]);
      await appendAudit(this.db, { actorType: 'USER', actorId: actor.id, action: `PAPER_ORDER_${status}`, entityType: 'PAPER_ORDER', entityId: order.id,
        sourceOccurredAt: context.quote.source_occurred_at, details: { symbol: request.symbol, side: request.side, quantityMicros: request.quantityMicros, risk } });
      return { order, duplicate: false };
    });
  }

  async approveOrder(orderId, { expectedVersion }, actor) {
    requireSafeInteger(Number(orderId), 'orderId', { min: 1 });
    requireSafeInteger(expectedVersion, 'expectedVersion', { min: 1 });
    return withTransaction(this.db, async () => {
      const order = await get(this.db, 'SELECT * FROM paper_orders WHERE id = ?', [Number(orderId)]);
      if (!order) throw domainError('ORDER_NOT_FOUND', 'Paper order not found', 404);
      if (order.requested_by === actor.id) throw domainError('SEPARATE_APPROVER_REQUIRED', 'Requester cannot approve this order', 403);
      if (order.status !== 'PENDING_APPROVAL' || order.version !== expectedVersion) throw domainError('VERSION_CONFLICT', 'Order is not pending at the expected version', 409);
      const context = await this._riskContext(order.custody_account_id, order.symbol);
      const risk = evaluateOrder({ account: context.account,
        order: { symbol: order.symbol, side: order.side, quantity_micros: order.quantity_micros, limit_price_micros: order.limit_price_micros },
        quote: context.quote, positions: context.positions, realizedPnlCents: context.realizedPnlCents, nowMs: this.now().getTime() });
      const status = risk.allowed ? 'APPROVED' : 'REJECTED';
      await run(this.db, `UPDATE paper_orders SET status = ?, approved_by = ?, rejection_code = ?, risk_snapshot_json = ?, quote_id = ?,
        quote_source_at = ?, version = version + 1, updated_at = ? WHERE id = ?`, [status, actor.id, risk.failures[0] || null,
        JSON.stringify(risk), context.quote.id, context.quote.source_occurred_at, this.now().toISOString(), order.id]);
      const updated = await get(this.db, 'SELECT * FROM paper_orders WHERE id = ?', [order.id]);
      await appendAudit(this.db, { actorType: 'USER', actorId: actor.id, action: `PAPER_ORDER_${status}_BY_APPROVER`, entityType: 'PAPER_ORDER', entityId: order.id,
        sourceOccurredAt: context.quote.source_occurred_at, details: { requesterId: order.requested_by, risk, version: updated.version } });
      return updated;
    });
  }

  async _createPostedBatch({ batchType, sourceType, sourceId, sourceOccurredAt, reversalOfBatchId = null, accountId, entries }) {
    const result = await run(this.db, `INSERT INTO ledger_batches
      (batch_type, source_type, source_id, reversal_of_batch_id, source_occurred_at) VALUES (?, ?, ?, ?, ?)`,
    [batchType, sourceType, String(sourceId), reversalOfBatchId, sourceOccurredAt]);
    for (const entry of entries) {
      await run(this.db, `INSERT INTO ledger_entries (batch_id, custody_account_id, account_code, debit_cents, credit_cents, description)
        VALUES (?, ?, ?, ?, ?, ?)`, [result.lastID, accountId, entry.accountCode, entry.debitCents || 0, entry.creditCents || 0, entry.description]);
    }
    await run(this.db, "UPDATE ledger_batches SET status = 'POSTED' WHERE id = ?", [result.lastID]);
    return result.lastID;
  }

  async _applyFill(eventId, data, sourceOccurredAt) {
    const orderId = requireSafeInteger(data.orderId, 'data.orderId', { min: 1 });
    const quantityMicros = requireSafeInteger(data.quantityMicros, 'data.quantityMicros', { min: 1 });
    const priceMicros = requireSafeInteger(data.priceMicros, 'data.priceMicros', { min: 1 });
    const providerFillId = requireText(data.providerFillId, 'data.providerFillId', 100);
    const order = await get(this.db, 'SELECT * FROM paper_orders WHERE id = ?', [orderId]);
    if (!order || !['APPROVED', 'PARTIALLY_FILLED'].includes(order.status)) throw domainError('ORDER_NOT_FILLABLE', 'Paper order is not approved for fills');
    if (order.filled_quantity_micros + quantityMicros > order.quantity_micros) throw domainError('OVERFILL', 'Fill exceeds remaining paper-order quantity');
    if (order.side === 'BUY' && priceMicros > order.limit_price_micros) throw domainError('LIMIT_PRICE_BREACH', 'Buy fill exceeds limit price');
    if (order.side === 'SELL' && priceMicros < order.limit_price_micros) throw domainError('LIMIT_PRICE_BREACH', 'Sell fill is below limit price');
    if (Date.parse(sourceOccurredAt) < databaseTimestampMs(order.created_at) - 1000) throw domainError('FILL_PREDATES_ORDER', 'Fill source timestamp predates the order');
    const notional = notionalCents(quantityMicros, priceMicros);
    const account = await get(this.db, 'SELECT * FROM custody_accounts WHERE id = ?', [order.custody_account_id]);
    const position = await get(this.db, 'SELECT * FROM positions WHERE custody_account_id = ? AND symbol = ?', [account.id, order.symbol]);
    const existingQuantity = position ? position.quantity_micros : 0;
    const existingCostBasis = position ? position.cost_basis_cents : 0;
    if (order.side === 'BUY' && account.cash_cents < notional) throw domainError('INSUFFICIENT_CUSTODY_CASH', 'Paper custody cash cannot settle fill');
    if (order.side === 'SELL' && existingQuantity < quantityMicros) throw domainError('CUSTODY_SHORT_SALE_FORBIDDEN', 'Paper custody cannot settle a short sale');

    const costBasisDelta = order.side === 'BUY' ? notional : Number((BigInt(existingCostBasis) * BigInt(quantityMicros) + BigInt(Math.max(existingQuantity, 1)) / 2n) / BigInt(Math.max(existingQuantity, 1)));
    const realizedPnl = order.side === 'SELL' ? notional - costBasisDelta : 0;
    const sellEntries = [
      { accountCode: '1000-CASH', debitCents: notional, description: `${order.symbol} paper sell settlement` },
      { accountCode: '1100-SECURITIES', creditCents: costBasisDelta, description: `${order.symbol} paper sell cost basis` },
    ];
    if (realizedPnl > 0) sellEntries.push({ accountCode: '4200-REALIZED-GAIN', creditCents: realizedPnl, description: `${order.symbol} realized paper gain` });
    if (realizedPnl < 0) sellEntries.push({ accountCode: '5100-REALIZED-LOSS', debitCents: -realizedPnl, description: `${order.symbol} realized paper loss` });
    const batchId = await this._createPostedBatch({ batchType: 'TRADE_FILL', sourceType: 'BROKER_EVENT', sourceId: eventId,
      sourceOccurredAt, accountId: account.id, entries: order.side === 'BUY' ? [
        { accountCode: '1100-SECURITIES', debitCents: notional, description: `${order.symbol} paper buy` },
        { accountCode: '1000-CASH', creditCents: notional, description: `${order.symbol} paper buy settlement` },
      ] : sellEntries });
    await run(this.db, `INSERT INTO fills
      (event_id, provider_fill_id, paper_order_id, quantity_micros, price_micros, notional_cents, cost_basis_delta_cents, realized_pnl_cents, source_occurred_at, ledger_batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [eventId, providerFillId, order.id, quantityMicros, priceMicros, notional, costBasisDelta, realizedPnl, sourceOccurredAt, batchId]);
    const nextQuantity = order.side === 'BUY' ? existingQuantity + quantityMicros : existingQuantity - quantityMicros;
    const nextCostBasis = order.side === 'BUY' ? existingCostBasis + costBasisDelta : existingCostBasis - costBasisDelta;
    await run(this.db, `INSERT INTO positions (custody_account_id, symbol, quantity_micros, cost_basis_cents, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(custody_account_id, symbol) DO UPDATE SET quantity_micros = excluded.quantity_micros, cost_basis_cents = excluded.cost_basis_cents, updated_at = excluded.updated_at`,
    [account.id, order.symbol, nextQuantity, nextCostBasis, this.now().toISOString()]);
    await run(this.db, 'UPDATE custody_accounts SET cash_cents = cash_cents + ?, version = version + 1, updated_at = ? WHERE id = ?',
      [order.side === 'BUY' ? -notional : notional, this.now().toISOString(), account.id]);
    const filled = order.filled_quantity_micros + quantityMicros;
    await run(this.db, 'UPDATE paper_orders SET filled_quantity_micros = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ?',
      [filled, filled === order.quantity_micros ? 'FILLED' : 'PARTIALLY_FILLED', this.now().toISOString(), order.id]);
    if (order.side === 'SELL') {
      await run(this.db, `INSERT INTO daily_risk_state (custody_account_id, risk_date, realized_pnl_cents) VALUES (?, ?, ?)
        ON CONFLICT(custody_account_id, risk_date) DO UPDATE SET realized_pnl_cents = realized_pnl_cents + excluded.realized_pnl_cents`,
      [account.id, sourceOccurredAt.slice(0, 10), realizedPnl]);
    }
    return { orderId: order.id, providerFillId, notionalCents: notional, costBasisDeltaCents: costBasisDelta, realizedPnlCents: realizedPnl,
      filledQuantityMicros: filled, orderStatus: filled === order.quantity_micros ? 'FILLED' : 'PARTIALLY_FILLED' };
  }

  async _applyQuote(eventId, data, sourceOccurredAt) {
    const symbol = requireText(data.symbol, 'data.symbol', 16).toUpperCase();
    const instrument = await get(this.db, 'SELECT symbol FROM instruments WHERE symbol = ? AND active = 1', [symbol]);
    if (!instrument) throw domainError('INSTRUMENT_NOT_ALLOWED', 'Quote instrument is not allowlisted');
    const bid = requireSafeInteger(data.bidPriceMicros, 'data.bidPriceMicros', { min: 1 });
    const ask = requireSafeInteger(data.askPriceMicros, 'data.askPriceMicros', { min: bid });
    await run(this.db, `INSERT INTO market_quotes (event_id, symbol, bid_price_micros, ask_price_micros, source_occurred_at)
      VALUES (?, ?, ?, ?, ?)`, [eventId, symbol, bid, ask, sourceOccurredAt]);
    return { symbol, bidPriceMicros: bid, askPriceMicros: ask };
  }

  async _applySnapshot(eventId, data, sourceOccurredAt) {
    const accountId = requireSafeInteger(data.accountId, 'data.accountId', { min: 1 });
    const providerCash = requireSafeInteger(data.cashCents, 'data.cashCents', { min: 0 });
    if (!Array.isArray(data.positions)) throw domainError('VALIDATION_ERROR', 'data.positions must be an array');
    const account = await get(this.db, 'SELECT * FROM custody_accounts WHERE id = ?', [accountId]);
    if (!account) throw domainError('ACCOUNT_NOT_FOUND', 'Snapshot custody account does not exist');
    const internal = await all(this.db, 'SELECT symbol, quantity_micros FROM positions WHERE custody_account_id = ?', [accountId]);
    const internalMap = new Map(internal.map((row) => [row.symbol, row.quantity_micros]));
    const providerMap = new Map();
    for (const item of data.positions) providerMap.set(requireText(item.symbol, 'position.symbol', 16).toUpperCase(), requireSafeInteger(item.quantityMicros, 'position.quantityMicros', { min: 0 }));
    const symbols = [...new Set([...internalMap.keys(), ...providerMap.keys()])].sort();
    const differences = symbols.map((symbol) => ({ symbol, internalQuantityMicros: internalMap.get(symbol) || 0,
      providerQuantityMicros: providerMap.get(symbol) || 0, differenceMicros: (providerMap.get(symbol) || 0) - (internalMap.get(symbol) || 0) })).filter((row) => row.differenceMicros !== 0);
    const cashDifference = providerCash - account.cash_cents;
    const status = differences.length === 0 && cashDifference === 0 ? 'MATCHED' : 'VARIANCE';
    const result = await run(this.db, `INSERT INTO reconciliation_runs
      (event_id, custody_account_id, source_occurred_at, status, cash_difference_cents, position_differences_json)
      VALUES (?, ?, ?, ?, ?, ?)`, [eventId, accountId, sourceOccurredAt, status, cashDifference, JSON.stringify(differences)]);
    return { reconciliationRunId: result.lastID, status, cashDifferenceCents: cashDifference, positionDifferences: differences };
  }

  async _applyCorporateAction(eventId, data, sourceOccurredAt) {
    const symbol = requireText(data.symbol, 'data.symbol', 16).toUpperCase();
    const actionType = requireText(data.actionType, 'data.actionType', 20).toUpperCase();
    if (!['SPLIT', 'CASH_DIVIDEND'].includes(actionType)) throw domainError('VALIDATION_ERROR', 'Corporate action type is invalid');
    const effectiveDate = requireText(data.effectiveDate, 'data.effectiveDate', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw domainError('VALIDATION_ERROR', 'effectiveDate must be YYYY-MM-DD');
    const correctionOfEventId = data.correctionOfEventId == null ? null : requireSafeInteger(data.correctionOfEventId, 'data.correctionOfEventId', { min: 1 });
    let original = null;
    if (correctionOfEventId) {
      original = await get(this.db, 'SELECT * FROM corporate_actions WHERE event_id = ?', [correctionOfEventId]);
      if (!original || original.symbol !== symbol || original.action_type !== actionType) throw domainError('CORRECTION_REFERENCE_INVALID', 'Corporate-action correction must reference the same symbol and action type');
    }
    let numerator = null;
    let denominator = null;
    let cashPerUnitMicros = null;
    if (actionType === 'SPLIT') {
      numerator = original ? original.denominator : requireSafeInteger(data.numerator, 'data.numerator', { min: 1, max: 1000 });
      denominator = original ? original.numerator : requireSafeInteger(data.denominator, 'data.denominator', { min: 1, max: 1000 });
      const positions = await all(this.db, 'SELECT * FROM positions WHERE symbol = ?', [symbol]);
      for (const position of positions) {
        const nextNumerator = BigInt(position.quantity_micros) * BigInt(numerator);
        if (nextNumerator % BigInt(denominator) !== 0n) throw domainError('FRACTIONAL_SPLIT_QUARANTINED', 'Split would produce unsupported fractional micro-units');
        const next = Number(nextNumerator / BigInt(denominator));
        if (!Number.isSafeInteger(next)) throw domainError('INTEGER_OVERFLOW', 'Split position exceeds supported range');
        await run(this.db, 'UPDATE positions SET quantity_micros = ?, updated_at = ? WHERE custody_account_id = ? AND symbol = ?',
          [next, this.now().toISOString(), position.custody_account_id, symbol]);
      }
    } else {
      cashPerUnitMicros = original ? original.cash_per_unit_micros : requireSafeInteger(data.cashPerUnitMicros, 'data.cashPerUnitMicros', { min: 1 });
      const positions = await all(this.db, 'SELECT * FROM positions WHERE symbol = ? AND quantity_micros > 0', [symbol]);
      for (const position of positions) {
        const dividendCents = notionalCents(position.quantity_micros, cashPerUnitMicros);
        const originalBatch = original ? await get(this.db, 'SELECT id FROM ledger_batches WHERE source_type = ? AND source_id = ?',
          ['CORPORATE_ACTION', `${correctionOfEventId}:${position.custody_account_id}`]) : null;
        if (original && !originalBatch) throw domainError('CORRECTION_REFERENCE_INVALID', 'Original dividend ledger batch is missing');
        const account = await get(this.db, 'SELECT cash_cents FROM custody_accounts WHERE id = ?', [position.custody_account_id]);
        if (original && account.cash_cents < dividendCents) throw domainError('CORRECTION_CUSTODY_CONFLICT', 'Dividend correction would make custody cash negative');
        await this._createPostedBatch({ batchType: original ? 'ERROR_CORRECTION' : 'CASH_DIVIDEND', sourceType: 'CORPORATE_ACTION', sourceId: `${eventId}:${position.custody_account_id}`,
          sourceOccurredAt, reversalOfBatchId: originalBatch ? originalBatch.id : null, accountId: position.custody_account_id,
          entries: original ? [
            { accountCode: '4100-DIVIDEND-INCOME', debitCents: dividendCents, description: `${symbol} dividend correction` },
            { accountCode: '1000-CASH', creditCents: dividendCents, description: `${symbol} dividend correction` },
          ] : [
            { accountCode: '1000-CASH', debitCents: dividendCents, description: `${symbol} cash dividend` },
            { accountCode: '4100-DIVIDEND-INCOME', creditCents: dividendCents, description: `${symbol} dividend income` },
          ] });
        await run(this.db, 'UPDATE custody_accounts SET cash_cents = cash_cents + ?, version = version + 1, updated_at = ? WHERE id = ?',
          [original ? -dividendCents : dividendCents, this.now().toISOString(), position.custody_account_id]);
      }
    }
    const result = await run(this.db, `INSERT INTO corporate_actions
      (event_id, symbol, action_type, numerator, denominator, cash_per_unit_micros, correction_of_event_id, effective_date, source_occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [eventId, symbol, actionType, numerator, denominator, cashPerUnitMicros, correctionOfEventId, effectiveDate, sourceOccurredAt]);
    return { corporateActionId: result.lastID, symbol, actionType, correctionOfEventId };
  }

  async ingestSignedEvent(providerCodeInput, { rawBody, timestamp, signature, providerHost }) {
    const providerCode = requireText(providerCodeInput, 'providerCode', 40).toUpperCase();
    const provider = await get(this.db, 'SELECT * FROM provider_connections WHERE provider_code = ? AND active = 1', [providerCode]);
    if (!provider) throw domainError('PROVIDER_NOT_FOUND', 'Active provider is not configured', 404);
    if (Date.parse(provider.license_expires_at) <= this.now().getTime()) throw domainError('LICENSE_EXPIRED', 'Provider license has expired', 403);
    if (String(providerHost || '').toLowerCase() !== provider.allowed_host) throw domainError('PROVIDER_HOST_MISMATCH', 'Provider identity host does not match configuration', 403);
    verifyWebhook({ secret: this.env[provider.signing_secret_env], timestamp, signature, rawBody, nowMs: this.now().getTime() });
    let payload;
    try { payload = JSON.parse(rawBody); } catch { throw domainError('INVALID_JSON', 'Webhook body must be valid JSON'); }
    const externalEventId = requireText(payload.eventId, 'eventId', 100);
    const eventType = requireText(payload.type, 'type', 30).toUpperCase();
    if (!['QUOTE', 'FILL', 'POSITION_SNAPSHOT', 'CORPORATE_ACTION'].includes(eventType)) throw domainError('EVENT_TYPE_INVALID', 'Provider event type is unsupported');
    if (eventType === 'QUOTE' && !['MARKET', 'BROKER'].includes(provider.data_scope)) throw domainError('PROVIDER_SCOPE_VIOLATION', 'Provider is not licensed for market quotes', 403);
    if (['FILL', 'POSITION_SNAPSHOT', 'CORPORATE_ACTION'].includes(eventType) && provider.data_scope !== 'BROKER') throw domainError('PROVIDER_SCOPE_VIOLATION', 'Provider is not licensed for broker/custody events', 403);
    const sourceOccurredAt = requireIsoDate(payload.sourceOccurredAt, 'sourceOccurredAt');
    if (Date.parse(sourceOccurredAt) > this.now().getTime() + 30000) throw domainError('SOURCE_TIMESTAMP_FUTURE', 'Source timestamp is too far in the future');
    const payloadHash = requestHash(payload);

    return withTransaction(this.db, async () => {
      const duplicate = await get(this.db, `SELECT * FROM broker_events WHERE provider_connection_id = ? AND external_event_id = ?`, [provider.id, externalEventId]);
      if (duplicate) {
        if (duplicate.payload_hash !== payloadHash) throw domainError('IDEMPOTENCY_CONFLICT', 'Provider reused an event ID with different content', 409);
        return { duplicate: true, event: duplicate };
      }
      const inserted = await run(this.db, `INSERT INTO broker_events
        (provider_connection_id, external_event_id, event_type, payload_hash, source_occurred_at, status, payload_json)
        VALUES (?, ?, ?, ?, ?, 'PROCESSING', ?)`, [provider.id, externalEventId, eventType, payloadHash, sourceOccurredAt, JSON.stringify(payload)]);
      await exec(this.db, 'SAVEPOINT provider_event_processing');
      try {
        let result;
        if (eventType === 'QUOTE') result = await this._applyQuote(inserted.lastID, payload.data || {}, sourceOccurredAt);
        if (eventType === 'FILL') result = await this._applyFill(inserted.lastID, payload.data || {}, sourceOccurredAt);
        if (eventType === 'POSITION_SNAPSHOT') result = await this._applySnapshot(inserted.lastID, payload.data || {}, sourceOccurredAt);
        if (eventType === 'CORPORATE_ACTION') result = await this._applyCorporateAction(inserted.lastID, payload.data || {}, sourceOccurredAt);
        await exec(this.db, 'RELEASE provider_event_processing');
        await run(this.db, "UPDATE broker_events SET status = 'APPLIED' WHERE id = ?", [inserted.lastID]);
        await appendAudit(this.db, { actorType: 'PROVIDER', actorId: provider.provider_code, action: `${eventType}_APPLIED`, entityType: 'BROKER_EVENT', entityId: inserted.lastID,
          sourceOccurredAt, details: { externalEventId, payloadHash, result } });
        return { duplicate: false, quarantined: false, eventId: inserted.lastID, result };
      } catch (error) {
        await exec(this.db, 'ROLLBACK TO provider_event_processing');
        await exec(this.db, 'RELEASE provider_event_processing');
        const reason = `${error.code || 'PROCESSING_ERROR'}: ${error.message}`.slice(0, 500);
        await run(this.db, "UPDATE broker_events SET status = 'QUARANTINED', reason = ? WHERE id = ?", [reason, inserted.lastID]);
        await appendAudit(this.db, { actorType: 'PROVIDER', actorId: provider.provider_code, action: `${eventType}_QUARANTINED`, entityType: 'BROKER_EVENT', entityId: inserted.lastID,
          sourceOccurredAt, details: { externalEventId, payloadHash, reason } });
        return { duplicate: false, quarantined: true, eventId: inserted.lastID, reason };
      }
    });
  }

  async correctFill(fillId, { reason }, actor) {
    const id = requireSafeInteger(Number(fillId), 'fillId', { min: 1 });
    const correctionReason = requireText(reason, 'reason', 500);
    return withTransaction(this.db, async () => {
      const fill = await get(this.db, `SELECT f.*, o.side, o.symbol, o.custody_account_id FROM fills f
        JOIN paper_orders o ON o.id = f.paper_order_id WHERE f.id = ?`, [id]);
      if (!fill || fill.kind !== 'FILL') throw domainError('FILL_NOT_FOUND', 'Original fill not found', 404);
      const existing = await get(this.db, 'SELECT id FROM fills WHERE correction_of_fill_id = ?', [id]);
      if (existing) throw domainError('ALREADY_CORRECTED', 'Fill already has an immutable correction', 409);
      const position = await get(this.db, 'SELECT * FROM positions WHERE custody_account_id = ? AND symbol = ?', [fill.custody_account_id, fill.symbol]);
      const account = await get(this.db, 'SELECT * FROM custody_accounts WHERE id = ?', [fill.custody_account_id]);
      if (fill.side === 'BUY' && (!position || position.quantity_micros < fill.quantity_micros || position.cost_basis_cents < fill.cost_basis_delta_cents)) throw domainError('CORRECTION_CUSTODY_CONFLICT', 'Correction would make custody position or cost basis negative', 409);
      if (fill.side === 'SELL' && account.cash_cents < fill.notional_cents) throw domainError('CORRECTION_CUSTODY_CONFLICT', 'Correction would make custody cash negative', 409);
      const originalEntries = await all(this.db, 'SELECT account_code, debit_cents, credit_cents, description FROM ledger_entries WHERE batch_id = ? ORDER BY id', [fill.ledger_batch_id]);
      const batchId = await this._createPostedBatch({ batchType: 'ERROR_CORRECTION', sourceType: 'FILL_CORRECTION', sourceId: crypto.randomUUID(),
        sourceOccurredAt: this.now().toISOString(), reversalOfBatchId: fill.ledger_batch_id, accountId: fill.custody_account_id,
        entries: originalEntries.map((entry) => ({ accountCode: entry.account_code, debitCents: entry.credit_cents, creditCents: entry.debit_cents,
          description: `Correction: ${correctionReason}; reverses ${entry.description}` })) });
      const correctionId = `CORRECTION-${crypto.randomUUID()}`;
      const inserted = await run(this.db, `INSERT INTO fills
        (provider_fill_id, paper_order_id, quantity_micros, price_micros, notional_cents, cost_basis_delta_cents, realized_pnl_cents,
         kind, correction_of_fill_id, source_occurred_at, ledger_batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'REVERSAL', ?, ?, ?)`, [correctionId, fill.paper_order_id, fill.quantity_micros, fill.price_micros,
        fill.notional_cents, fill.cost_basis_delta_cents, -fill.realized_pnl_cents, fill.id, this.now().toISOString(), batchId]);
      const deltaQuantity = fill.side === 'BUY' ? -fill.quantity_micros : fill.quantity_micros;
      const deltaCash = fill.side === 'BUY' ? fill.notional_cents : -fill.notional_cents;
      const deltaCostBasis = fill.side === 'BUY' ? -fill.cost_basis_delta_cents : fill.cost_basis_delta_cents;
      await run(this.db, 'UPDATE positions SET quantity_micros = quantity_micros + ?, cost_basis_cents = cost_basis_cents + ?, updated_at = ? WHERE custody_account_id = ? AND symbol = ?',
        [deltaQuantity, deltaCostBasis, this.now().toISOString(), fill.custody_account_id, fill.symbol]);
      await run(this.db, 'UPDATE custody_accounts SET cash_cents = cash_cents + ?, version = version + 1, updated_at = ? WHERE id = ?',
        [deltaCash, this.now().toISOString(), fill.custody_account_id]);
      if (fill.side === 'SELL') {
        await run(this.db, `INSERT INTO daily_risk_state (custody_account_id, risk_date, realized_pnl_cents) VALUES (?, ?, ?)
          ON CONFLICT(custody_account_id, risk_date) DO UPDATE SET realized_pnl_cents = realized_pnl_cents + excluded.realized_pnl_cents`,
        [fill.custody_account_id, fill.source_occurred_at.slice(0, 10), -fill.realized_pnl_cents]);
      }
      await appendAudit(this.db, { actorType: 'USER', actorId: actor.id, action: 'FILL_CORRECTED_BY_REVERSAL', entityType: 'FILL', entityId: fill.id,
        sourceOccurredAt: this.now().toISOString(), details: { correctionFillId: inserted.lastID, correctionReason, reversalBatchId: batchId } });
      return get(this.db, 'SELECT * FROM fills WHERE id = ?', [inserted.lastID]);
    });
  }

  async runScenario(input, actor) {
    const scenarioName = requireText(input.scenarioName, 'scenarioName');
    const result = runPaperScenario(input);
    return withTransaction(this.db, async () => {
      const inserted = await run(this.db, `INSERT INTO paper_scenario_runs (scenario_name, input_hash, status, result_json, created_by)
        VALUES (?, ?, ?, ?, ?)`, [scenarioName, requestHash(input), result.status, JSON.stringify(result), actor.id]);
      await appendAudit(this.db, { actorType: 'USER', actorId: actor.id, action: 'PAPER_SCENARIO_EXECUTED', entityType: 'PAPER_SCENARIO_RUN', entityId: inserted.lastID,
        details: { scenarioName, status: result.status, missingExpectedOutcomes: result.missingExpectedOutcomes } });
      return { id: inserted.lastID, ...result };
    });
  }

  async getOperationsSnapshot() {
    const [providers, accounts, orders, reconciliations, quarantined, audit] = await Promise.all([
      all(this.db, `SELECT id, provider_code, display_name, data_scope, allowed_host, license_reference, license_expires_at, signing_secret_env, active, created_at
        FROM provider_connections ORDER BY provider_code`),
      all(this.db, 'SELECT * FROM custody_accounts ORDER BY id'),
      all(this.db, 'SELECT * FROM paper_orders ORDER BY id DESC LIMIT 100'),
      all(this.db, 'SELECT * FROM reconciliation_runs ORDER BY id DESC LIMIT 100'),
      all(this.db, "SELECT id, external_event_id, event_type, source_occurred_at, received_at, reason FROM broker_events WHERE status = 'QUARANTINED' ORDER BY id DESC LIMIT 100"),
      verifyAudit(this.db),
    ]);
    return { boundary: 'PAPER_ONLY_NO_LIVE_EXECUTION', providers, accounts, orders, reconciliations, quarantined, audit };
  }

  async exportAudit() {
    const [events, batches, entries, fills, actions, reconciliations] = await Promise.all([
      all(this.db, 'SELECT * FROM audit_events ORDER BY sequence'),
      all(this.db, "SELECT * FROM ledger_batches WHERE status = 'POSTED' ORDER BY id"),
      all(this.db, 'SELECT * FROM ledger_entries ORDER BY batch_id, id'),
      all(this.db, 'SELECT * FROM fills ORDER BY id'),
      all(this.db, 'SELECT * FROM corporate_actions ORDER BY id'),
      all(this.db, 'SELECT * FROM reconciliation_runs ORDER BY id'),
    ]);
    const verification = await verifyAudit(this.db);
    if (!verification.valid) throw domainError('AUDIT_CHAIN_INVALID', 'Audit chain verification failed', 500);
    return { exportedAt: this.now().toISOString(), boundary: 'PAPER_ONLY_NO_LIVE_EXECUTION', verification, events, ledger: { batches, entries }, fills, corporateActions: actions, reconciliations };
  }
}

module.exports = { GovernedBrokerService, domainError };
