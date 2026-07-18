# Legal Data Hunter Integration — Design

**Date:** 2026-07-17
**Status:** Approved for planning

## Purpose

Let an officer manually validate a warrant's charge text against Legal Data Hunter (LDH) — a
230+ jurisdiction legal document API (`https://legaldatahunter.com`) — as a read-only research
aid. This is a manual, on-demand check, not an automated pipeline: the officer clicks "Validate
Charge" on a warrant and sees whether LDH can resolve the charge to a real statute/citation, with
a link to the source. Nothing about warrant creation, serving, or status is gated on the result.

## Why manual, not auto-ingest

LDH's public rate limits are 10 req/min, 20 req/day, 600/period (free/low tier —
`https://legaldatahunter.com/docs/rate-limits`). That's too low to validate every warrant on
ingest across all the existing warrant sources (`src/utils/warrantSources/`, Utah poller,
national scrapers). A manual, officer-initiated check keeps volume naturally bounded to what a
human actually wants to look up, and the design still needs to defend the low daily cap
explicitly (see Rate limiting below) rather than assume manual usage stays low on its own.

## Non-goals

- No automatic screening on warrant create/update (unlike the NSOPW/SL County Assessor pattern).
- No blocking of warrant workflows on validation result — flag/inform only.
- Not a replacement for the existing `utah_statutes` Law Book — LDH is for charges the local
  Utah statute table can't resolve (out-of-state/national warrants, non-Utah citations).

## Architecture

### Client — `src/utils/legalDataHunter/client.ts`

Worker-safe REST client, same shape as `src/utils/fleetio/client.ts` / `src/utils/roboflowAlpr.ts`:

- `fetch` + `AbortController` timeout, bounded retries/backoff.
- Typed errors: `LdhConfigError | LdhTimeoutError | LdhHttpError | LdhRateLimitError`.
- Two calls exposed:
  - `resolveCitation(reference, hintCountry?)` → `POST /v1/resolve`
  - `searchLegislation(query, country?)` → `POST /v1/search` (`namespace: "legislation"`, `top_k: 3`)
- Auth: `Authorization: Bearer <c.env.LEGAL_DATA_HUNTER_API_KEY>`.
- Pure request/response mapping is unit-tested with mocked `fetch`
  (`tests/legalDataHunterClient.test.ts`, mirrors `tests/fleetioClient.test.ts`).

### Route — `src/routes/legalDataHunter.ts`, mounted at `/api/legal-data-hunter`

- Auth required (existing `authMiddleware`); `client_viewer` excluded, matching `warrants.ts`'s
  role gate — this surfaces sworn-side charge/warrant data.
- `POST /validate` — body `{ charge: string, state?: string, warrant_id?: number }`.
  1. If `state` is Utah (or omitted) and the charge matches a local `utah_statutes` row
     (reuse the existing `/api/statutes/search` matching logic), return that match directly —
     zero LDH calls.
  2. Otherwise, check `legal_charge_validations` cache by normalized charge text + state. Return
     the cached row if present.
  3. Otherwise, check the daily counter (see Rate limiting). If under budget: try
     `resolveCitation` first if the charge text looks like a citation (contains a section-like
     pattern), else `searchLegislation`. Store the result in `legal_charge_validations` and
     return it.
  4. If over daily budget, return `{ ok: false, code: 'rate_limited', retry_after: ... }` — the
     client shows "Daily lookup limit reached, try again tomorrow" rather than failing silently.
- Unset `LEGAL_DATA_HUNTER_API_KEY` → `200 { ok: false, code: 'not_configured' }` (per
  `feedback-503-not-configured-anti-pattern`), not 503.
- `GET /usage` (admin/manager) — today's call count / remaining budget, for visibility.

### Rate limiting

- A `legal_data_hunter_usage` table (or reuse a KV counter keyed by UTC date) tracks calls made
  today. Route enforces a soft cap of 18/day (buffer under LDH's 20/day) and 8/min (buffer under
  10/min) using a rolling timestamp check before calling out. Cache hits and local
  `utah_statutes` matches never count against the budget.
- Budgets reset at UTC midnight (LDH's window semantics aren't documented precisely enough to
  match exactly — the buffer absorbs the uncertainty).

### Storage — migration `01XX_legal_data_hunter.sql`

```sql
CREATE TABLE IF NOT EXISTS legal_charge_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_text TEXT NOT NULL,
  charge_text_normalized TEXT NOT NULL,
  state TEXT,
  warrant_id INTEGER,
  source TEXT NOT NULL,           -- 'local_statute' | 'ldh_resolve' | 'ldh_search'
  match_found INTEGER NOT NULL,   -- 0/1
  matched_title TEXT,
  matched_citation TEXT,
  matched_source_url TEXT,
  raw_response TEXT,              -- JSON, for debugging/audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(charge_text_normalized, state)
);
CREATE INDEX IF NOT EXISTS idx_lcv_warrant ON legal_charge_validations(warrant_id);
```

No new columns on `warrants` (100-col-cap safe) — link is via `warrant_id` on the validation row.

### Client UI

- `LegalDataHunterValidateButton` on the warrant detail view (WarrantsPage / warrant detail tab),
  next to the charge display — same visual slot pattern as `WarrantNsopwStatus`.
- Click → `POST /api/legal-data-hunter/validate` → inline result: matched statute title + link
  (green), "no match found" (amber), "daily limit reached" (informational), or "not configured"
  (admin-only visibility, hidden for regular users — mirrors other optional-integration UX).
- No polling, no background state — purely request/response on click.

## Config

- Secret: `LEGAL_DATA_HUNTER_API_KEY` via `wrangler secret put` (prod) / `.dev.vars` (local,
  gitignored). **The key already shared in chat during this session must be rotated before use**
  — treat it as compromised since it was pasted into a non-secret channel.
- No other vars needed; base URL (`https://legaldatahunter.com`) is a constant in the client.

## Testing

- `tests/legalDataHunterClient.test.ts` — mocked-fetch unit tests for `resolveCitation` /
  `searchLegislation`, error typing, retry/backoff.
- Route smoke test in the same PR (per CLAUDE.md's "no Worker test suite yet, add a smoke test
  when adding a route" guidance) covering: not-configured path, local-statute short-circuit,
  cache hit, rate-limit-exceeded response.
- No live LDH calls in CI — all mocked.
