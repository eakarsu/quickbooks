# Audit Note — quickbooks

**Date:** 2026-05-06
**Bucket:** E — HAS_CODE_NO_AI

## Summary

Real Express/SQLite QuickBooks-style accounting app (52 source files, 8 existing route modules). LLM scan returned 0 hits — there was no AI integration. Added `routes/ai.js` with 10 domain-specific AI endpoints (plus `/history` and `/health`) matching the existing route style and registered it in `server.js`.

## Files added

- `routes/ai.js` — OpenRouter-backed AI router using `process.env.OPENROUTER_API_KEY` and model `anthropic/claude-haiku-4.5` (override via `OPENROUTER_MODEL`). All endpoints guarded by `authenticateToken` (the project's existing JWT middleware). Persists results to a new `ai_results` table that is auto-created on first import.

## Files modified

- `server.js` — added `const aiRoutes = require('./routes/ai');` and `app.use('/api/ai', aiRoutes);` alongside existing `/api/...` registrations.

## Endpoints (12 total)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/ai/categorize-transaction` | Suggest GL category + tax-deductibility for a transaction |
| POST | `/api/ai/detect-anomalies` | Surface duplicates, unusual amounts, possible fraud across recent transactions |
| POST | `/api/ai/cashflow-forecast` | Forecast cash flow over a horizon, grounded on 180-day history |
| POST | `/api/ai/invoice-narrative` | Draft polished invoice text (headline, summary, line descriptions, terms) |
| POST | `/api/ai/expense-explain` | Audit-ready expense memo + GL coding + risk grade |
| POST | `/api/ai/vendor-risk-score` | Vendor risk tier + spend concentration + recommendations |
| POST | `/api/ai/reconcile-suggest` | Match a bank-statement line against ledger candidates |
| POST | `/api/ai/tax-summary` | Period-based taxable income / Schedule-C-style summary |
| POST | `/api/ai/customer-insight` | Payment-behavior profile + collection strategy for a customer |
| POST | `/api/ai/financial-qa` | Free-form Q&A grounded on the user's transactions |
| GET | `/api/ai/history` | Paginated retrieval of past AI calls for the user |
| GET | `/api/ai/health` | Configuration sanity check |

## Syntax check

- `node --check routes/ai.js` -> OK
- `node --check server.js` -> OK

## Notes

- `axios` is already a dependency, so no `npm install` is required.
- `.env` already declares `OPENROUTER_API_KEY` and `OPENROUTER_MODEL=anthropic/claude-haiku-4.5`.
- Persistence table `ai_results` is created idempotently in the existing `data/cashflow.db` SQLite database on first call.
- No frontend changes, no external integrations beyond OpenRouter.

## Apply pass 3 (frontend)

CREATED-FE. The React/Vite client had no UI for any of the 12 AI endpoints
introduced in apply pass 2. Added `client/src/pages/AITools.jsx` — a sidebar
of 10 POST tools (categorize, anomalies, cashflow forecast, invoice narrative,
expense explain, vendor risk, reconcile suggest, tax summary, customer
insight, financial Q&A) plus an on-mount `/api/ai/health` probe that warns
when `OPENROUTER_API_KEY` is missing. Errors mentioning 503 / not configured
surface a friendly "AI service unavailable" message; auth/JWT errors clear
the stored token and bounce to `/login`. JWT Bearer auth uses the existing
`client/src/api.js` helper (which reads `localStorage.token`). Wired into
routing in `client/src/App.jsx` (`/ai-tools`) and the sidebar nav in
`client/src/components/Layout.jsx`. No new dependencies, no `npm install`
performed. Syntax-checked with the project's bundled `esbuild` (jsx loader).

## Apply pass 4 (mechanical backlog)

LEFT-AS-IS. This project's audit note does not enumerate any mechanical
backlog items: apply pass 2 already shipped the full set of 12 AI endpoints
(10 tools + history + health) and apply pass 3 wired all of them in the FE.
No remaining MECHANICAL backlog to apply. Idempotent — no changes made.

