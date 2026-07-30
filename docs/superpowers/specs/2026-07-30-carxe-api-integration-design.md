# CarsXE API Integration — Design

**Date**: 2026-07-30
**Status**: Approved (design phase)

## Purpose

Add vehicle/plate data enrichment via the CarsXE API (carsxe.com), as a
manual, officer-triggered lookup for patrol/investigation use cases —
registration decode from a plate, full VIN specs, active lien/theft
screening, and vehicle history reports. This is a **data lookup** service,
distinct from and independent of the existing Roboflow ALPR pipeline
(`src/routes/alpr.ts`), which does image-based plate *recognition* from
field photos and stays untouched. CarXE consumes a plate or VIN string that
is already known (typed in, or already OCR'd by Roboflow/Cloudflare) and
returns structured vehicle data.

## Scope (Phase 1)

Four CarsXE endpoints, chosen from the full 14-endpoint catalogue by
relevance to patrol/investigation workflows. Image-based CarsXE endpoints
(VIN OCR, Plate Image Recognition) are explicitly **out of scope** — they
would compete with the existing Roboflow ALPR capture flow, which stays as
the sole image-based path.

| CarsXE endpoint | Route | Input | Purpose |
|---|---|---|---|
| Plate Decoder (v2) | `POST /api/carxe/plate-lookup` | `{ plate, state }` | Registration/vehicle info from a plate |
| Specifications | `POST /api/carxe/vin-specs` | `{ vin }` | Full vehicle specs from a VIN |
| Lien & Theft | `POST /api/carxe/lien-theft` | `{ vin }` | Active lien/theft flags |
| History | `POST /api/carxe/history` | `{ vin }` | Vehicle history report |
| — | `GET /api/carxe/lookups?plate=` or `?vin=` | — | Cached lookup history |

Not in Phase 1 (candidates for a later phase if there's demand): Market
Value (v1/v2), Recalls (+ batch), International VIN Decoder, Year Make
Model, OBD Codes Decoder.

## Architecture

Mirrors the existing Fleet.io / Roboflow integration pattern in this repo.

### Client — `src/utils/carxe/client.ts`

Worker-safe (no `node:*`) `fetch` wrapper. Never touches D1. Routes are the
only caller.

- Auth: `CARXE_API_KEY` sent per CarsXE's documented auth scheme (confirm
  exact header/query-param convention against the live API before
  implementation — the docs page fetched during design did not expose this
  detail).
- Typed errors: `CarxeConfigError | CarxeTimeoutError | CarxeHttpError | CarxeRateLimitError`.
- `AbortController` timeout + bounded retry/backoff on retryable methods only
  (GET-style lookups are naturally idempotent here since CarsXE lookups are
  read-only).
- Unit-tested in `tests/carxeClient.test.ts` with a stubbed `fetch`, same
  shape as `tests/fleetioClient.test.ts`.

### Route — `src/routes/carxe.ts`

Mounted at `/api/carxe`, `auth: 'required'`. Role gate: same operational set
as ALPR — `requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher')`
(excludes `client_viewer`, `contract_manager`, `human_resources`).

- `POST /plate-lookup`, `POST /vin-specs`, `POST /lien-theft`, `POST /history`:
  1. Check `carxe_lookups` cache for a fresh (< 24h) row matching the
     lookup key (plate+state, or vin+lookup_type). Return cached result if
     found — no live call, no credit spend.
  2. Otherwise call the CarsXE client, persist the response into
     `carxe_lookups`, and return it.
  3. For `lien-theft` specifically: if the response indicates an active
     theft flag, call the existing `screenVehicle()` (`src/utils/intelScreen.ts`)
     against the matched `vehicles_records` row (create/update by VIN if
     needed) to trigger the same critical-hit notification path Roboflow
     ALPR uses. Active (non-theft) liens are stored as informational data
     only — no alert.
  4. Unset `CARXE_API_KEY` → `200 { ok:false, code:'not_configured' }`,
     matching the Fleetio/Legal-Data-Hunter convention (never a hard 503
     crash for an unconfigured optional integration).
- `GET /lookups`: returns cached lookup rows filtered by `plate` or `vin`
  query param, for the UI's lookup-history view.

### Error handling

- `CarxeHttpError` (4xx/5xx from CarsXE), `CarxeTimeoutError`,
  `CarxeRateLimitError` (429) all surface as typed JSON:
  `{ ok:false, code, message }` — never a raw 500.
- A legitimate no-match (plate/VIN not found in CarsXE's data) is a normal
  `200 { ok:true, found:false }`, not an error path.
- Self-imposed rate-limit budget via a KV counter, same shape as
  `src/utils/legalDataHunter/rateLimit.ts`. CarsXE's actual plan limits
  weren't available from the docs page fetched during design — set a
  conservative default (e.g. 30/min) and adjust once the live limits are
  confirmed from the CarsXE dashboard.

### Schema — new migration

Next free prefix: `0213` (current high-water `0212_user_graph_tokens.sql`).

```sql
CREATE TABLE IF NOT EXISTS carxe_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lookup_type TEXT NOT NULL,        -- 'plate' | 'vin_specs' | 'lien_theft' | 'history'
  plate TEXT,
  state TEXT,
  vin TEXT,
  response_json TEXT NOT NULL,
  requested_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_carxe_lookups_plate ON carxe_lookups(plate, state);
CREATE INDEX IF NOT EXISTS idx_carxe_lookups_vin ON carxe_lookups(vin, lookup_type);
```

No changes to `vehicles_records`' own column set beyond what `screenVehicle()`
already writes to `flags` (existing column, no ALTER needed — respects the
100-column cap discipline even though `vehicles_records` is nowhere near it).

### Config

- Secrets: `CARXE_API_KEY` (production) via `wrangler secret put`; for local
  dev, the sandbox key goes in `.dev.vars` (gitignored) as `CARXE_API_KEY`
  too (CarsXE issues separate sandbox/production keys — sandbox is fine for
  local dev since it hits a non-billing test environment).
- **Both keys shared in this integration's setup conversation must be
  rotated in the CarsXE dashboard before this ships** — they were pasted in
  plain chat text, which this codebase's own convention (see the Legal Data
  Hunter incident note in CLAUDE.md) treats as compromised on exposure,
  regardless of intent.
- Optional `CARXE_API_BASE` var in `wrangler.toml` if CarsXE's base URL
  needs overriding (mirrors `FLEETIO_API_BASE`).

### UI

- `PlateLogPage.tsx`: add a "Run CarsXE Lookup" action next to the existing
  plate scanner, calling `POST /plate-lookup`, rendering the decoded
  registration info inline.
- Vehicle record detail view: add VIN-based lookup actions (Specifications,
  Lien & Theft, History), each rendering results in a panel, with a small
  "previous lookups" list sourced from `GET /lookups`.
- Uses the existing `apiFetch` helper (`client/src/hooks/useApi.ts`) — all
  CarXE routes are plain JSON, no multipart upload involved.

## Testing

- `tests/carxeClient.test.ts` — unit tests for the client against a stubbed
  `fetch`: auth header construction, timeout, retry/backoff, typed error
  mapping.
- Route smoke test for `/api/carxe/*` — cache hit/miss, `not_configured`
  branch, lien/theft screening trigger.
- Worker typecheck + existing full suite as the standard gate (per CLAUDE.md
  — full suite, not targeted runs).

## Open questions to resolve during implementation

- Exact CarsXE auth header/query-param convention and per-endpoint request/
  response shapes — the docs fetch during design only returned the endpoint
  index, not per-endpoint schemas. Confirm against the live API (sandbox
  key) before writing the client's request builder.
- CarsXE's actual rate-limit tier for this account, to calibrate the
  self-imposed KV budget.
