# Governed Ledger

An authenticated accounting application with one bounded market workflow: licensed broker/market events feed a reconciled **paper-only** custody ledger. The workflow provides deterministic exposure, liquidity, daily-loss, approval and kill-switch controls; idempotent signed ingestion; partial fills; immutable double-entry posting; corporate actions and reversing corrections; reconciliation; resilience scenarios; and verified audit export. It cannot submit live orders.

## Local verification

```sh
npm ci
npm --prefix client ci
DATABASE_PATH=/tmp/quickbooks-test.db npm run migrate
npm run check
npm test
npm run build
npm audit --audit-level=low
npm --prefix client audit --audit-level=low
```

See [operations](docs/OPERATIONS.md), [provider contract](docs/PROVIDER_CONTRACT.md), and `.env.example`. Migrations contain no demo users or sample financial records; use `npm run provision:admin` with strong one-time environment values.
