CREATE TABLE provider_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_code TEXT UNIQUE NOT NULL CHECK(length(provider_code) BETWEEN 2 AND 40),
  display_name TEXT NOT NULL,
  data_scope TEXT NOT NULL CHECK(data_scope IN ('MARKET','BROKER')),
  allowed_host TEXT NOT NULL,
  license_reference TEXT NOT NULL,
  license_expires_at TEXT NOT NULL,
  signing_secret_env TEXT NOT NULL CHECK(signing_secret_env GLOB 'BROKER_*_WEBHOOK_SECRET'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE custody_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_account_ref TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency = 'USD'),
  mode TEXT NOT NULL DEFAULT 'PAPER' CHECK(mode = 'PAPER'),
  opening_cash_cents INTEGER NOT NULL CHECK(opening_cash_cents >= 0),
  cash_cents INTEGER NOT NULL CHECK(cash_cents >= 0),
  max_gross_exposure_cents INTEGER NOT NULL CHECK(max_gross_exposure_cents > 0),
  min_liquidity_bps INTEGER NOT NULL CHECK(min_liquidity_bps BETWEEN 0 AND 10000),
  max_daily_loss_cents INTEGER NOT NULL CHECK(max_daily_loss_cents > 0),
  approval_threshold_cents INTEGER NOT NULL CHECK(approval_threshold_cents >= 0),
  quote_stale_after_seconds INTEGER NOT NULL DEFAULT 60 CHECK(quote_stale_after_seconds BETWEEN 1 AND 3600),
  kill_switch INTEGER NOT NULL DEFAULT 0 CHECK(kill_switch IN (0,1)),
  kill_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instruments (
  symbol TEXT PRIMARY KEY CHECK(symbol = upper(symbol) AND length(symbol) BETWEEN 1 AND 16),
  asset_class TEXT NOT NULL CHECK(asset_class IN ('EQUITY','ETF','BOND','CASH')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency = 'USD'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE broker_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_connection_id INTEGER NOT NULL REFERENCES provider_connections(id),
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('QUOTE','FILL','POSITION_SNAPSHOT','CORPORATE_ACTION')),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
  source_occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK(status IN ('PROCESSING','APPLIED','QUARANTINED')),
  reason TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE(provider_connection_id, external_event_id)
);

CREATE TABLE market_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER UNIQUE NOT NULL REFERENCES broker_events(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  bid_price_micros INTEGER NOT NULL CHECK(bid_price_micros > 0),
  ask_price_micros INTEGER NOT NULL CHECK(ask_price_micros >= bid_price_micros),
  source_occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE positions (
  custody_account_id INTEGER NOT NULL REFERENCES custody_accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  quantity_micros INTEGER NOT NULL CHECK(quantity_micros >= 0),
  cost_basis_cents INTEGER NOT NULL DEFAULT 0 CHECK(cost_basis_cents >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(custody_account_id, symbol)
);

CREATE TABLE daily_risk_state (
  custody_account_id INTEGER NOT NULL REFERENCES custody_accounts(id),
  risk_date TEXT NOT NULL,
  realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(custody_account_id, risk_date)
);

CREATE TABLE paper_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT UNIQUE NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  custody_account_id INTEGER NOT NULL REFERENCES custody_accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
  quantity_micros INTEGER NOT NULL CHECK(quantity_micros > 0),
  limit_price_micros INTEGER NOT NULL CHECK(limit_price_micros > 0),
  quote_id INTEGER NOT NULL REFERENCES market_quotes(id),
  quote_source_at TEXT NOT NULL,
  computed_notional_cents INTEGER NOT NULL CHECK(computed_notional_cents > 0),
  status TEXT NOT NULL CHECK(status IN ('PENDING_APPROVAL','APPROVED','PARTIALLY_FILLED','FILLED','REJECTED','CANCELLED')),
  filled_quantity_micros INTEGER NOT NULL DEFAULT 0 CHECK(filled_quantity_micros >= 0 AND filled_quantity_micros <= quantity_micros),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  rejection_code TEXT,
  risk_snapshot_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TABLE ledger_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_type TEXT NOT NULL CHECK(batch_type IN ('TRADE_FILL','ERROR_CORRECTION','CASH_DIVIDEND')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reversal_of_batch_id INTEGER REFERENCES ledger_batches(id),
  source_occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type, source_id)
);

CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES ledger_batches(id),
  custody_account_id INTEGER NOT NULL REFERENCES custody_accounts(id),
  account_code TEXT NOT NULL CHECK(account_code IN ('1000-CASH','1100-SECURITIES','4100-DIVIDEND-INCOME','4200-REALIZED-GAIN','5100-REALIZED-LOSS','4900-ROUNDING')),
  debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(debit_cents >= 0),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_cents >= 0),
  description TEXT NOT NULL,
  CHECK((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0))
);

CREATE TABLE fills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER UNIQUE REFERENCES broker_events(id),
  provider_fill_id TEXT UNIQUE NOT NULL,
  paper_order_id INTEGER NOT NULL REFERENCES paper_orders(id),
  quantity_micros INTEGER NOT NULL CHECK(quantity_micros > 0),
  price_micros INTEGER NOT NULL CHECK(price_micros > 0),
  notional_cents INTEGER NOT NULL CHECK(notional_cents > 0),
  cost_basis_delta_cents INTEGER NOT NULL CHECK(cost_basis_delta_cents >= 0),
  realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'FILL' CHECK(kind IN ('FILL','REVERSAL')),
  correction_of_fill_id INTEGER UNIQUE REFERENCES fills(id),
  source_occurred_at TEXT NOT NULL,
  ledger_batch_id INTEGER UNIQUE NOT NULL REFERENCES ledger_batches(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE corporate_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER UNIQUE NOT NULL REFERENCES broker_events(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  action_type TEXT NOT NULL CHECK(action_type IN ('SPLIT','CASH_DIVIDEND')),
  numerator INTEGER CHECK(numerator > 0),
  denominator INTEGER CHECK(denominator > 0),
  cash_per_unit_micros INTEGER CHECK(cash_per_unit_micros > 0),
  correction_of_event_id INTEGER UNIQUE REFERENCES broker_events(id),
  effective_date TEXT NOT NULL,
  source_occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((action_type = 'SPLIT' AND numerator IS NOT NULL AND denominator IS NOT NULL AND cash_per_unit_micros IS NULL)
     OR (action_type = 'CASH_DIVIDEND' AND cash_per_unit_micros IS NOT NULL AND numerator IS NULL AND denominator IS NULL))
);

CREATE TABLE reconciliation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER UNIQUE NOT NULL REFERENCES broker_events(id),
  custody_account_id INTEGER NOT NULL REFERENCES custody_accounts(id),
  source_occurred_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('MATCHED','VARIANCE')),
  cash_difference_cents INTEGER NOT NULL,
  position_differences_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE paper_scenario_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_name TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 64),
  status TEXT NOT NULL CHECK(status IN ('PASSED','FAILED')),
  result_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('USER','PROVIDER','SYSTEM')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_occurred_at TEXT,
  details_json TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT UNIQUE NOT NULL CHECK(length(event_hash) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER ledger_batch_must_balance BEFORE UPDATE OF status ON ledger_batches
WHEN NEW.status = 'POSTED' AND OLD.status = 'DRAFT'
BEGIN
  SELECT CASE WHEN (SELECT COALESCE(SUM(debit_cents),0) FROM ledger_entries WHERE batch_id = NEW.id)
                      <> (SELECT COALESCE(SUM(credit_cents),0) FROM ledger_entries WHERE batch_id = NEW.id)
    THEN RAISE(ABORT, 'ledger batch is not balanced') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_entries WHERE batch_id = NEW.id) < 2
    THEN RAISE(ABORT, 'ledger batch requires at least two entries') END;
END;

CREATE TRIGGER immutable_posted_ledger_batch BEFORE UPDATE ON ledger_batches
WHEN OLD.status = 'POSTED' BEGIN SELECT RAISE(ABORT, 'posted ledger batch is immutable'); END;
CREATE TRIGGER no_delete_ledger_batch BEFORE DELETE ON ledger_batches BEGIN SELECT RAISE(ABORT, 'ledger batch is immutable'); END;
CREATE TRIGGER immutable_ledger_entry_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger entry is immutable'); END;
CREATE TRIGGER immutable_ledger_entry_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger entry is immutable'); END;
CREATE TRIGGER immutable_broker_event_update BEFORE UPDATE ON broker_events
WHEN OLD.status <> 'PROCESSING' BEGIN SELECT RAISE(ABORT, 'broker event is immutable'); END;
CREATE TRIGGER immutable_broker_event_delete BEFORE DELETE ON broker_events BEGIN SELECT RAISE(ABORT, 'broker event is immutable'); END;
CREATE TRIGGER immutable_fill_update BEFORE UPDATE ON fills BEGIN SELECT RAISE(ABORT, 'fill is immutable'); END;
CREATE TRIGGER immutable_fill_delete BEFORE DELETE ON fills BEGIN SELECT RAISE(ABORT, 'fill is immutable'); END;
CREATE TRIGGER immutable_corporate_action_update BEFORE UPDATE ON corporate_actions BEGIN SELECT RAISE(ABORT, 'corporate action is immutable'); END;
CREATE TRIGGER immutable_corporate_action_delete BEFORE DELETE ON corporate_actions BEGIN SELECT RAISE(ABORT, 'corporate action is immutable'); END;
CREATE TRIGGER immutable_audit_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit event is immutable'); END;
CREATE TRIGGER immutable_audit_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit event is immutable'); END;

CREATE INDEX idx_broker_events_source ON broker_events(source_occurred_at);
CREATE INDEX idx_quotes_symbol_source ON market_quotes(symbol, source_occurred_at DESC);
CREATE INDEX idx_orders_account_status ON paper_orders(custody_account_id, status);
CREATE INDEX idx_ledger_entries_batch ON ledger_entries(batch_id);
