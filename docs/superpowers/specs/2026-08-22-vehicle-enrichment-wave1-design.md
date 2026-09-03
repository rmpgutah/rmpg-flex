# Vehicle Enrichment Wave 1 — Design Spec
**Date:** 2026-08-22
**Branch:** feature/vehicle-enrichment-wave1
**Status:** Approved for implementation

---

## Overview

Integrate three free/freemium RapidAPI vehicle data APIs into RMPG Flex as a sequential enrichment chain that runs automatically on new plate captures and on-demand from the Vehicle Dossier. Results write through the existing `upsertVehicleFromCarxe` seam in `vehicleRecords.ts` — the single authoritative write path for `vehicles_records`.

### APIs Integrated

| Step | API | RapidAPI URL | Free Tier | Purpose |
|------|-----|-------------|-----------|---------|
| 1 | US License Plate to VIN | https://rapidapi.com/vincheckinfo/api/us-license-plate-to-vin | Freemium | Plate + state → VIN |
| 2 | VIN Decoder (vinfreecheck) | https://rapidapi.com/vinfreecheck/api/vin-decoder | 100/month free | VIN → make/model/year/trim/color/salvage |
| 3 | License Plate Decoder | https://rapidapi.com/tymanog/api/license-plate-decoder | Freemium | Plate format/state/region metadata fallback |

---

## Architecture

### New Files

```
src/utils/vehicleEnrichment/
  client.ts          — Three Worker-safe fetch wrappers (one per API)
  enrichChain.ts     — enrichVehicleRecord() chain orchestrator
  types.ts           — EnrichmentResult, typed errors
  rateLimit.ts       — KV-backed rate limiters (one per API key)

src/routes/vehicleEnrichment.ts   — Hono route at /api/vehicle-enrichment

migrations/0263_vehicle_enrichment_cache.sql
tests/vehicleEnrichmentClient.test.ts
tests/vehicleEnrichment.test.ts
```

### Modified Files

```
src/routesConfig.ts                      — mount /api/vehicle-enrichment
src/routes/alpr.ts                       — auto-trigger on new plate row
client/src/components/VehicleDossier.tsx — "Enrich ↻" IconButton
```

---

## Enrichment Chain

`enrichVehicleRecord(plate, state, db, env, ctx, opts?)` executes in order:

1. **Cache check** — query `vehicle_enrichment_cache` by `plate_key = UPPER(TRIM(plate)) || '|' || UPPER(TRIM(state))`. On hit, skip all API calls and return cached result (unless `opts.force === true`).
2. **Step 1: plateToVin** — `GET` plate + state to RapidAPI Plate→VIN. If VIN returned, proceed to step 2. If API key unset or rate limit exhausted, skip step and log warn.
3. **Step 2: decodeVin** — `GET` VIN to RapidAPI VIN Decoder. Returns make, model, year, trim, color, vehicle_type, salvage status. If step 1 returned no VIN, skip.
4. **Step 3: decodePlate** (fallback) — fires only when steps 1–2 returned insufficient data. Returns plate format validation and state/region metadata.
5. **Merge** — combine results into a `VehicleEnrichData` object shaped to match `upsertVehicleFromCarxe`'s `CarsXeVehicleData` input type.
6. **Write** — call `upsertVehicleFromCarxe(db, identity, mergedData)`. Fill-only COALESCE — never overwrites officer-entered fields.
7. **Cache write** — upsert into `vehicle_enrichment_cache`.

Chain is **best-effort**: each step is wrapped in `try/catch`. A failed step is logged via `log.warn` and skipped; remaining steps continue. If all steps fail, the `vehicles_records` row is unchanged and the error is persisted via `logErrorToDb`.

---

## Route

**`src/routes/vehicleEnrichment.ts`** mounted at `/api/vehicle-enrichment`

```
POST /enrich/:vehicleId   — manual trigger; auth required; client_viewer excluded
GET  /cache/:plate        — check cache without a live API call
GET  /health              — lists which of the three API keys are configured
```

### POST /enrich/:vehicleId

1. Fetch `plate_number` and `state` from `vehicles_records WHERE id = ?`
2. Call `enrichVehicleRecord(plate, state, db, env, ctx, { force: req.query.force === 'true' })`
3. Return `{ ok: true, enriched: EnrichmentResult, fromCache: boolean }`

### GET /health

Returns `{ ok: boolean, apis: { plateToVin: boolean, vinDecoder: boolean, plateDecoder: boolean } }` — HTTP 200 always (degraded state, not an error). Unset keys show `false`.

---

## Auto-Trigger

In `src/routes/alpr.ts`, after `upsertVehicleFromCarxe` creates a **new** row (determined by `INSERT` vs `UPDATE` path) and the returned row has `vin IS NULL`:

```ts
c.executionCtx.waitUntil(
  enrichVehicleRecord(plate, state, c.env.DB, c.env, c.executionCtx)
    .catch(err => log.warn('auto-enrich failed', { plate }, err))
);
```

Fire-and-forget — never delays the ALPR capture response.

---

## Schema

**Migration `0263_vehicle_enrichment_cache.sql`:**

```sql
CREATE TABLE IF NOT EXISTS vehicle_enrichment_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_key TEXT NOT NULL,
  plate_number TEXT NOT NULL,
  state TEXT,
  vin TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  trim TEXT,
  color TEXT,
  vehicle_type TEXT,
  raw_plate_to_vin TEXT,
  raw_vin_decoder TEXT,
  raw_plate_decoder TEXT,
  enriched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_enrichment_cache_plate_key
  ON vehicle_enrichment_cache(plate_key);
```

Cache is permanent. `?force=true` overwrites the row.

**`persons` / `vehicles_records`:** No new columns. All enrichment data lands in existing `vehicles_records` columns via `upsertVehicleFromCarxe`.

---

## Config

Three secrets, all independently optional:

```bash
wrangler secret put PLATE_TO_VIN_API_KEY
wrangler secret put VIN_DECODER_API_KEY
wrangler secret put PLATE_DECODER_API_KEY
```

Local dev: add all three to `.dev.vars` (gitignored). Unset key → that chain step is skipped; route returns `200 { ok: false, code: 'not_configured', missing: ['PLATE_TO_VIN_API_KEY'] }` only when ALL three are unset.

---

## Rate Limiting

KV counters per API, reusing the `legalDataHunter/rateLimit.ts` pattern. Conservative limits set below each free tier ceiling:

| API | Free Tier | KV Limit |
|-----|-----------|----------|
| Plate→VIN | Freemium (varies) | 80/day |
| VIN Decoder | 100/month | 80/month |
| Plate Decoder | Freemium (varies) | 80/day |

On limit exhaustion: step is skipped silently, `log.warn` emitted. No error surface to the officer.

---

## UI

**`VehicleDossier.tsx`**: add an `<IconButton aria-label="Re-enrich vehicle data">` (↻ icon) next to the existing plate field. On click: `POST /api/vehicle-enrichment/enrich/:vehicleId` → on success, refetch the vehicle record to refresh displayed fields. Button shows a loading spinner during the request. No new page or modal.

---

## Error Handling

- `VehicleEnrichConfigError` — API key unset; step skipped
- `VehicleEnrichTimeoutError` — fetch exceeded 10s `AbortController` timeout; step skipped
- `VehicleEnrichHttpError` — non-2xx from API; 4xx not retried, 5xx retried once with 1s backoff
- All errors: `log.warn` + `logErrorToDb` (severity `'warn'`, category `'enrichment'`); never propagated to the officer

---

## Testing

**`tests/vehicleEnrichmentClient.test.ts`** (Node unit):
- `plateToVin` returns typed error on 401/429/timeout
- `decodeVin` returns typed error on 400/timeout
- `decodePlate` returns typed error on 500

**`tests/vehicleEnrichment.test.ts`** (Node unit):
- Cache hit: no API calls made, returns cached result
- `force=true`: bypasses cache, calls API chain
- Step 1 failure: chain continues with steps 3, skips step 2
- All steps fail: `vehicles_records` row unchanged, no throw
- Successful chain: `upsertVehicleFromCarxe` called with merged data

---

## Post-Deploy Checklist

1. Apply `0263_vehicle_enrichment_cache.sql` directly to live D1 `785de7ae` via `scripts/apply-migration.sh`
2. Verify: `SELECT name FROM sqlite_master WHERE name='vehicle_enrichment_cache'`
3. Set the three API secrets via `wrangler secret put`
4. Hit `GET /api/vehicle-enrichment/health` — confirm at least one API shows `true`
5. Trigger a manual enrich on an existing vehicle record via the Dossier button

---

## Out of Scope (this wave)

- Waves 2–5 (person search, criminal records, weather, speech, face recognition)
- Bulk enrichment of all existing `vehicles_records` rows with missing VINs (can be a follow-up cron)
- Paid-tier upgrades for the three APIs
