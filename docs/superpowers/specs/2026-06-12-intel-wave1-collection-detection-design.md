# Intel Wave 1 — Collection & Detection (cross-hit screening, narrative extraction, plate log)

**Date:** 2026-06-12 · **Status:** Approved · **Builds on:** Intel platform Phases 1–4 (PR #1164)

## Goal

Three force-multipliers: (1) every new person/vehicle is instantly screened
against warrants/watchlist/trespass/stolen/SOR, (2) call/incident narratives
are mined for entities and turned into one-click link suggestions, (3) officers
can log plate sightings in seconds with instant cross-hits.

## Migration 0100 (`migrations/0100_intel_wave1.sql`, also applied directly to live D1)

```sql
intel_link_suggestions (
  id PK, source_type TEXT ('call'|'incident'), source_id INT,
  entity_type TEXT ('person'|'vehicle'), entity_id INT,
  extracted_text TEXT, match_basis TEXT,
  status TEXT default 'pending' ('pending'|'confirmed'|'rejected'),
  decided_by INT, decided_at TEXT, created_at TEXT,
  UNIQUE (source_type, source_id, entity_type, entity_id)
)
vehicle_sightings (
  id PK, plate TEXT NOT NULL, state TEXT, vehicle_id INT,
  location_text TEXT, lat REAL, lng REAL, notes TEXT,
  sighted_by INT NOT NULL, created_at TEXT
)  -- index on (plate), (vehicle_id)
```

## 1. Cross-hit screening engine — `src/utils/intelScreen.ts`

- `screenPerson(db, personId)` → hits: active warrant (warrants by
  subject_person_id|person_id, status active/outstanding), watchlist
  (intel_watchlist active), active trespass order, persons.caution_flags /
  gang_affiliation / is_sex_offender / watchlist_match (sentinel-guarded).
- `screenVehicle(db, { vehicleId?, plate? })` → hits: stolen (is_stolen=1 or
  stolen_status real), watchlist, owner's person-hits (one level).
- Surfaces:
  - `POST /api/intel/screen` `{entity_type, entity_id?|plate?}` (operational)
    → `{hits:[{kind,severity,detail}]}` — called by client flows for instant
    feedback; also inserts a HIGH notification for the calling user when hits
    exist, and an `anomaly_alerts` row (existing dispatch banner) for
    severity='critical' hits (stolen, active warrant).
  - **Coverage sweep** in the per-minute cron: screens persons/vehicles
    created in the last 2 minutes (by created_at) regardless of entry path —
    no write-hooks across 80 route files; alerts via anomaly_alerts. Dedupe:
    skip if an open anomaly alert already exists for that entity.

## 2. Narrative entity extraction — `src/utils/intelExtract.ts`

- Sources: calls_for_service.description + .notes + .subject_description +
  .vehicle_description; incidents.narrative. Delta by updated_at where
  available, else created_at, per 4-hourly cron run (plus admin
  `POST /api/intel/extract/run`).
- Extractors (pure, unit-tested):
  - plates: regex tokens 5–8 alnum w/ digit, validated against
    vehicles_records.plate_number (exact, case-insensitive) → vehicle match
  - phones: 10/11-digit groups → persons.phone match (normalized)
  - names: match EXISTING persons by "first last" (and "last, first")
    appearing in the text (case-insensitive). No NER/AI — known-entity
    matching only, so suggestions are always resolvable links.
- Writes `intel_link_suggestions` rows for matches not already linked
  (call_persons/call_vehicles/incident_persons/incident_vehicles checked);
  UNIQUE key prevents re-suggesting; never downgrades a human decision.
- API: `GET /api/intel/suggestions?status=pending` (operational),
  `POST /api/intel/suggestions/:id/confirm` (creates the real link row with
  added_by, role 'mentioned'), `POST /:id/reject`. Confirm/reject audited.
- UI: "SUGGESTED LINKS" panel on `/intel` (below resolution panel): one row
  per suggestion — source record, matched entity, snippet, CONFIRM/REJECT.

## 3. Patrol plate/sighting log

- `POST /api/intel/sightings` `{plate, state?, location_text?, lat?, lng?, notes?}`
  (operational): uppercases plate, resolves vehicle_id by exact plate match,
  stores sighting, runs screenVehicle, returns `{sighting, vehicle, hits}`.
- `GET /api/intel/sightings?plate=&limit=` — history (also matches partial).
- UI: `/intel/plate-log` page (mobile-first: large plate input, GPS autofill
  via navigator.geolocation best-effort, recent-sightings list). Hit results
  render as full-width red banners (STOLEN / ACTIVE WARRANT OWNER / WATCHLIST).
  Nav entry next to Intel Search.

## Error handling

Engine/extractor sections try/catch-isolated per rule (Phase 1–4 pattern);
cron sweeps never throw; missing tables (migration drift) log once and no-op.

## Testing

- Worker vitest: extractor unit tests (plates/phones/name matching against
  fixture rows), screening severity mapping (pure parts).
- Client vitest: PlateLogPage render + hit-banner test; suggestions panel test.
- SW bump.

## Out of scope (Wave 2/3)

Near-repeat location patterns, subject escalation scoring, quick-capture form,
scraper expansion, in-app interaction recording, native background recording.
