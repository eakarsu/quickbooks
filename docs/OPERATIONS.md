# Operations runbook

## Release and startup

1. Build one immutable artifact with `npm ci`, `npm --prefix client ci`, `npm test`, and `npm run build`.
2. Set the variables documented in `.env.example` using a secret manager. Generate unique secrets; never copy example values.
3. Apply `npm run migrate` once as a controlled release task. A second run must report no applied migrations.
4. Provision the first administrator once with `npm run provision:admin`, then remove the provisioning password from the environment.
5. Start with `./start.sh`. Startup fails if migrations or built assets are missing. `/api/health/live` is process liveness; `/api/health/ready` checks migrations and configured provider secrets.

The database and backup directory must be on encrypted persistent storage and writable only by the service account. Run one application replica per SQLite database; horizontal deployment requires migration to a transactional server database.

## Provider and custody controls

Create provider, instrument, and paper-custody records through administrator APIs. Provider license expiry and signing-secret presence fail closed. Keep the kill switch enabled while onboarding a provider. This product has no live-order transport; attempts under `/api/broker/live-orders` are denied.

Investigate quarantined events and reconciliation variances from Paper Broker Controls. Never edit broker events, fills, posted ledger entries, corporate actions, or audit events directly. Correct a fill with the governed correction endpoint, which creates a linked reversing batch.

## Backup and recovery

Create a consistent, permission-restricted SQLite backup:

```sh
BACKUP_PATH=/secure/backups/ledger-$(date +%Y%m%dT%H%M%S).db npm run backup
BACKUP_PATH=/secure/backups/ledger-20260720T120000.db npm run restore:verify
```

Test recovery quarterly on an isolated host: verify the backup, stop the application, copy the verified file to a new explicit `DATABASE_PATH`, start one replica, verify readiness, the audit-chain head, account cash/positions, and the latest reconciliation. Never overwrite the active database during a rehearsal.

## Incidents

- Suspected key leak: disable the provider, rotate the referenced secret, enable the custody kill switch, and reconcile from the provider snapshot.
- Audit verification failure: stop writes, preserve database/WAL files, and escalate; do not repair rows manually.
- Provider outage or stale quotes: orders fail closed. Do not extend staleness limits without a documented risk approval.
- Migration failure: retain the pre-migration backup and logs; do not modify an applied migration checksum.
