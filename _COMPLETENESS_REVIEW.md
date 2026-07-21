# Completeness Review: quickbooks

**Review date:** 2026-07-18

## Assessment basis

Static inspection of project-owned source and configuration only; no dependency installation, build, database migration, external-service call, or runtime launch was performed. The scan considered 89 project files (75 source files), 2 manifest(s), 0 test-like file(s), and 0 CI workflow(s), excluding dependency/generated directories.

## Classification

**Prototype-demo**

This is a prototype/demo for finance/trading. Generated gap/demo patterns are present: it contains 75 source files and visible routes/pages in `client/`, `routes/`, `middleware/`, `processors/`, but those surfaces are not evidence of durable domain execution, verified integrations, or operational completion.

## Why it is not complete

- Generated gap/visualization routes describe missing capabilities or simulate recommendations; they do not implement the underlying domain operation.
- Generic LLM calls are used as product behavior without enough typed tools, grounded evidence, deterministic rules, or output evaluation.
- Mock, demo, sample, fixture, or placeholder behavior remains in executable/product paths.
- No recognizable project-owned automated tests were found for the main workflow.
- No checked-in CI workflow proves builds, tests, migrations, and security checks on every change.

## Needed features

1. Integrate licensed market/bank/broker data with idempotent ingestion, reconciliation, and explicit source timestamps.
2. Add deterministic exposure, liquidity, loss, approval, and kill-switch limits outside any LLM decision path.
3. Implement ledger-grade transaction history, corporate-action/error correction, custody boundaries, and audit exports.
4. Backtest and paper-trade realistic failure, stale-data, duplicate-order, and partial-fill scenarios before live use.
5. Add risk-based unit, integration, and end-to-end tests in CI, including migration and failure-path coverage.

## Risks or launch blockers

- Weak/fallback secret patterns can permit forged sessions or accidental insecure deployments.
- AI-provider availability, cost, privacy, prompt injection, and unvalidated output are launch risks until bounded and evaluated.
- Regression risk is high because no recognizable project-owned automated tests cover the main path.
- No CI evidence prevents broken or insecure changes from reaching a release.

## Evidence inspected

- `middleware/auth.js:5`
- `routes/gap-features.js:8`
- `auth_setup.js`
- `server.js`
- `package.json`

## Recommended next action

Stop adding generated pages; prove one finance/trading workflow against real services and persistent state, with tests and measurable acceptance criteria.

## Implementation progress (2026-07-20)

Implemented one bounded production workflow: licensed market/broker events enter a governed, reconciled **paper-only** custody ledger. Live-order execution is intentionally unavailable and is rejected by both the database boundary (`custody_accounts.mode = 'PAPER'`) and the API. Generated AI, gap, Codex, fixture, sample-data, public-registration, password-reset-without-delivery, in-memory OAuth, and simulated unapplied-payment surfaces were removed rather than presented as working finance features.

1. **Licensed data, idempotency, reconciliation, and source time — implemented.** Administrators configure an exact provider identity host, MARKET or BROKER license scope and reference, license expiry, and environment-only HMAC secret reference. The implemented broker feed accepts signed QUOTE, FILL, POSITION_SNAPSHOT, and CORPORATE_ACTION events; rejects expired licenses, wrong provider identity/scope, invalid signatures, and five-minute replays; stores source and receipt timestamps; treats `(provider,event ID)` as an idempotency key; conflicts on changed reuse; and commits invalid domain events to quarantine without partial effects. Position/cash snapshots create durable MATCHED or VARIANCE reconciliation runs. `docs/PROVIDER_CONTRACT.md` defines the certification contract.
2. **Deterministic controls outside LLM paths — implemented.** `domain/riskEngine.js` uses integer cents and micro-units to enforce fresh quotes, gross exposure, post-trade liquidity, realized daily-loss, sufficient custody cash/positions, no short sales, marketable limits, separate approval above a configured threshold, version checks, and an auditable kill switch. Sell fills derive cost basis and realized P&L; the next order fails closed when the loss limit is reached. There is no LLM dependency in the runtime.
3. **Ledger history, corporate actions/corrections, custody, and audit export — implemented.** Partial fills settle into balanced, posted double-entry batches. Database triggers reject unbalanced posting and make provider events, fills, corporate actions, posted batches/entries, and hash-chained audit events immutable. Fill corrections append an exact reversing batch and reverse custody/P&L; split and cash-dividend corrections append linked compensating corporate actions. Cash and positions cannot become negative, only paper custody exists, snapshot variances remain visible, and the authenticated export verifies the audit chain before returning ledger/fill/action/reconciliation evidence with source timestamps.
4. **Backtest and paper failure scenarios — implemented.** The deterministic scenario runner persists input hashes and results for provider outages, stale/missing quotes, changed and identical duplicate orders, rejected fills, overfills, partial fills, and completed fills. The production UI exposes the resilience scenario, and service/HTTP tests exercise stale data, idempotent replay/conflict, separate approval, partial fills, reconciliation, quarantine, corrections, and the explicit live-execution denial.
5. **Risk-based tests, migrations, CI, and operations — implemented.** Fifteen project-owned unit, integration, and HTTP end-to-end tests cover the main path and failure paths. Tests include fresh migration/replay, failed-migration rollback, database balance/immutability enforcement, exact integer math, signature/replay validation, placeholder-secret rejection, exposure/liquidity/loss/approval/kill-switch limits, partial settlement, cost-basis loss, fill and corporate-action corrections, reconciliation, audit export, authentication/RBAC/CORS, retired public endpoints, and live-order denial. `.github/workflows/ci.yml` runs clean installs, fresh and replayed migrations, source policy checks, all tests, the client production build, low-threshold full dependency audits, full-history secret scanning, and a container build. Startup refuses missing or placeholder secrets, migrations, or build artifacts; administrator provisioning is one-time and non-destructive; health/readiness, encrypted-storage guidance, backup/integrity/audit verification, recovery rehearsal, and incident steps are documented.

Verification completed in isolated temporary databases: 15 tests passed with 0 failures; source checks and the Vite production build passed; a fresh two-migration apply, no-op replay, status check, and intentionally broken migration rollback passed; full and production-only root/client audits reported 0 vulnerabilities; six-commit secret history and current source scans found no leaks; runtime checks returned live/ready `200`, unauthenticated operations `401`, retired registration `404`, disallowed origin `403`, live execution `403`, and authenticated operations `200`; backup/restore verification returned SQLite integrity `ok`, a valid four-event audit chain, and identical source/backup counts (1 user, 1 provider, 1 broker event, 4 audit events, 2 migrations). Independent handoff verification also made both dependency gates low-threshold and proved that long example JWT/provider secrets fail closed rather than being accepted as production configuration.

External-only gates remain: contract and license approval for the selected real provider, production credentials, provider webhook registration, provider retry/ordering/partial-fill certification, an initial reconciled custody snapshot, and operator/security sign-off. Those gates do not enable live trading; adding live execution would be a separate regulated product, threat model, broker certification, and implementation review.

### Runtime acceptance refresh (2026-07-20)

- `start.sh` now requires an explicit unused `PORT`, accepts the validator's disposable `DB_PATH` as `DATABASE_PATH`, and resolves release artifacts through `RUNTIME_PROJECT_SOURCE` without adding migration or seed behavior to normal startup.
- On application port `6166`, the shared validator applied migrations to its disposable SQLite database, provisioned a one-time administrator, created a stored session through real credential login, and completed an authenticated API request: `API_VERIFIED|quickbooks|startup_login_session_api`.
- Source policy checks, 15/15 tests, and the Vite production build passed. Ports `55681`, `6166`, and reserved `6167` were free after cleanup.
