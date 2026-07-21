# Licensed provider contract

This application accepts inbound data only from an administrator-configured provider whose license has not expired. It never sends live orders. A provider connection records its scope, exact identity host, license reference, expiry, and the name of an environment variable containing its signing secret. Credentials are never persisted in SQLite.

`POST /api/broker/webhooks/:providerCode` requires:

- `Content-Type: application/json`
- `X-Provider-Host`: the exact configured provider host
- `X-Provider-Timestamp`: current Unix seconds, within five minutes
- `X-Provider-Signature`: lowercase hex HMAC-SHA256 of `<timestamp>.<raw request body>`

The secret must be at least 32 characters. Event IDs are unique per provider. Replaying byte-equivalent content returns the original result; reusing an ID with different content returns `409`. Invalid domain events are committed to quarantine with a reason, without partially applying their effects.

Supported event bodies all include `eventId`, `type`, `sourceOccurredAt`, and `data`:

- `QUOTE`: allowlisted symbol plus positive integer `bidPriceMicros` and `askPriceMicros`.
- `FILL`: provider fill ID, approved paper order ID, quantity micro-units, and price micro-dollars.
- `POSITION_SNAPSHOT`: paper custody account ID, cash cents, and positions for deterministic reconciliation.
- `CORPORATE_ACTION`: split or cash dividend data. Corrections reference the original event and append a compensating event.

Provider certification must prove signature handling, retries with the same event ID, source timestamps, partial fills, ordering guarantees, and reconciliation snapshots before production activation.
