# Intel Search + Entity Resolution — Design Spec

**Date:** 2026-06-11
**Status:** Approved (Phase 1 of the "Palantir-grade records" initiative)
**Owner:** Christopher Zamora / Claude

## Goal

Give RMPG Flex a Palantir-style intelligence spine: one federated, ranked search
across every record type, plus non-destructive person entity resolution
("possible same person" clustering). Later phases (dossier workspace, graph
upgrades, geo/pattern analytics) build on this layer.

## Context

- `src/routes/connections.ts` already has a BFS link graph over 14 node types
  (`record_links`), a basic cross-entity LIKE `/search` (8 types, 8 rows each,
  no ranking), and saved Investigations.
- `src/routes/records.ts` has per-type searches and `persons/:id/system-history`.
- `client/src/components/GlobalSearch.tsx` exists and will be rewired.
- Live D1 is `rmpg-flex` (785de7ae…); migrations must ALSO be applied directly
  to live (deploy step is continue-on-error). `calls_for_service` and `persons`
  are at/near the 100-column cap — no ALTERs on them.

## Components

### 1. FTS index — migration `00XX_intel_index.sql` (next free prefix)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS intel_index USING fts5(
  entity_type UNINDEXED, entity_id UNINDEXED,
  label, body, identifiers,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS intel_index_state (
  entity_type TEXT PRIMARY KEY,
  last_synced_at TEXT,
  row_count INTEGER
);
CREATE TABLE IF NOT EXISTS entity_resolution_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_a INTEGER NOT NULL,
  person_b INTEGER NOT NULL,
  score REAL NOT NULL,
  reasons TEXT NOT NULL,            -- JSON array of {rule, detail}
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|confirmed|rejected
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (person_a, person_b)
);
CREATE TABLE IF NOT EXISTS person_canonical (
  person_id INTEGER PRIMARY KEY,    -- the alias row
  canonical_person_id INTEGER NOT NULL,
  confirmed_by INTEGER,
  confirmed_at TEXT DEFAULT (datetime('now'))
);
```

No physical row merges ever — `person_canonical` is a reversible pointer.
Apply directly to live D1 after merge (project rule #5).

### 2. Indexer — `src/utils/intelIndexer.ts`

- Per-entity-type sync functions: read rows (delta by `updated_at`/`created_at`
  where available, else full re-sync — dataset is ~6 MB so full sync is cheap),
  DELETE+INSERT into `intel_index`.
- Covered types: person, vehicle, property, business, case, incident, call,
  warrant, citation, arrest, field_interview, trespass_order, evidence,
  serve_job.
- `identifiers` column gets normalized tokens: plate, VIN, phone digits, DOB,
  case/call/warrant/citation numbers, address.
- Triggered from the existing Worker `scheduled()` cron handler (every run,
  cheap when no deltas) + `POST /api/intel/reindex` (admin-only) for full rebuild.
- Resolution pass runs in the same cron: candidate pairs from exact-DOB,
  shared phone digits, shared address (normalized), shared vehicle ownership;
  name similarity via normalized token overlap (no external libs). Upsert into
  `entity_resolution_suggestions` (never downgrade confirmed/rejected).

### 3. API — `src/routes/intel.ts`, mounted at `/api/intel` (auth-gated)

Roles: operational only (admin/manager/supervisor/officer/dispatcher), same
gate as connections. All reads audited best-effort.

- `GET /search?q=&types=&limit=` —
  1. Identifier sniffing: regexes for plate, phone, DOB, record numbers → exact
     identifier hits ranked first.
  2. FTS5 `MATCH` with bm25 ranking; prefix queries (`term*`) for live typing.
  3. Per-type LIKE fallback wrapped in try/catch if FTS errors (missing table
     on live = degraded, not broken).
  4. Response items: `{type, id, label, snippet, meta, flags[], score}`.
     Flags computed for person hits: ACTIVE_WARRANT, OFFICER_SAFETY, GANG,
     TRESPASS — with sentinel-string guards ("None"/"N/A" ≠ truthy).
  5. Person hits include `cluster` info: confirmed canonical grouping and count
     of pending suggestions.
- `GET /resolution/suggestions?status=` — list (supervisor+).
- `POST /resolution/suggestions/:id/confirm` | `/reject` — supervisor+; confirm
  writes `person_canonical` (lower id wins as canonical by default, override via
  body `canonical_person_id`); audited.
- `DELETE /resolution/canonical/:personId` — unlink (supervisor+, audited).
- `POST /reindex` — admin-only full rebuild.

### 4. Client

- New `client/src/pages/IntelSearchPage.tsx` at `/intel`:
  - Search box with debounce, identifier-type hint chips, type filter toggles.
  - Grouped ranked results, flag badges (gold/red text, no pills), keyboard nav.
  - Per-result actions: open record page, seed Connections graph
    (`/connections?type=X&id=Y`), person system-history drawer.
  - Pending-match strip on person results; confirm/reject inline (supervisor+).
- `GlobalSearch.tsx` rewired to `GET /api/intel/search` (keeps its UI).
- Spillman tokens: #0a0a0a base, #d4a017 gold, 2px radius, dense tables.
- SW `CACHE_NAME` bump.

## Error handling

- Every per-type indexer and search sub-query is try/catch isolated — one bad
  table never empties the whole result set (connections.ts pattern).
- Missing FTS table on live (migration drift) → LIKE fallback path keeps search
  functional; `/api/intel/health` reports index state for diagnosis.
- Resolution confirm validates both persons exist; no dangling canonicals.

## Testing

- Client vitest: IntelSearchPage rendering/grouping/flag badges, GlobalSearch
  wiring.
- Worker: typecheck (no Worker test harness exists); pure helpers
  (identifier sniffing, name normalization, scoring) written as standalone
  functions in `src/utils/intelMatch.ts` so a future Miniflare suite can cover
  them.

## Out of scope (later phases)

Dossier workspace, graph auto-derived edges/path-finding upgrades, geo/pattern
analytics, watchlist alerting, cross-agency federation.
