# Vehicle capture dossier + OCR trust layer — 3-photo evidence packages, honest confidence

- **Date:** 2026-06-14
- **Status:** Draft (awaiting user review)
- **Author:** Claude (brainstormed with Christopher Zamora)
- **Branch:** `claude/lucid-haslett-e97ab6`
- **Program context:** Sub-project of the footage-plate-repair program, **companion to**
  the manual multi-frame enhancement spec
  ([2026-06-14-plate-multiframe-enhancement-design.md]). Reuses the live Roboflow ALPR
  pipeline ([2026-06-14-alpr-fast-scan-design.md]) and the 85% acceptance gate from the
  advanced vehicle scanner ([2026-06-14-advanced-vehicle-scanner-design.md]). Lands on
  the capture gallery shipped in #1251.

---

## Problem

Two linked gaps, visible in the live capture gallery:

1. **No structured evidence package.** A capture stores a frame, but not the three views
   an officer/court wants: the **whole frame** (context), the **vehicle** (the car), and
   the **plate** (the read). And captures aren't organized **per vehicle** — the same
   plate's sightings scatter across a flat stream.
2. **OCR confidence is bullshit.** The gallery shows the *same vehicle* read three ways —
   `KJH345` (80%), `KJH345` (100%), `5KJH345` (100%) — with two claiming **100%**. A
   vision model emitting "100%" on a plate another frame reads differently is, by
   definition, **miscalibrated**. The displayed number is a token the model emits, not a
   probability. We are asserting and displaying reads we have no real basis to trust.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Thresholds | **Two-tier: ≥0.80 package + file, ≥0.85 assert as fact** (compatible — package kept at 80%, attributes asserted only at 85%) |
| What the gates run on | **A derived trust score — NOT the model's self-reported %** |
| Trust signals | **Cross-frame/cross-sighting consensus (dominant) + plate-format validity + cross-model corroboration**; model % is at most a tiebreaker |
| Scope | **All sources** — footage auto-capture, on-scene scans, manual enhancement — organized into one per-vehicle dossier |
| Three photos | **Full frame + vehicle crop + plate crop**, stored as **3 discrete images** (court export) **plus** the bboxes (reproducibility) |
| Crop generation | **Client-side canvas, $0**, from `AlprDetection.bbox`; vehicle vs plate by `class`; plate-box-expansion fallback when no car box |
| Inconsistent reads | **Merge to consensus, flag variants** — cluster within edit-distance+format into one canonical plate; file all sightings under it; visibly flag disagreeing reads "variant — verify" |
| Confidence display | **Honest trust badge** (`trustScore` + basis) replaces the bare "100%"; explicit "single read — unverified" state |
| Trust authority | **Server-authoritative** (capture route + cross-sighting merge over D1); client supplies multi-frame evidence |
| `<0.80` reads | **Not filed as a package**; stolen/watchlist screening still runs, hits flagged "UNCONFIRMED — verify plate" |

## Goal

Every vehicle read at a **derived** trust ≥0.80 yields a three-photo evidence package
(full / vehicle / plate), filed under one **canonical** plate in a per-vehicle dossier,
across all capture sources — with a confidence the system can actually defend, the
model's self-reported number demoted to a hint, and inconsistent reads merged to consensus
with variants flagged.

### Non-goals

- The automatic footage→ALPR pipeline pre-pass itself (separate sub-project #2); this spec
  defines the packaging/trust **contract** it (and every source) feeds.
- A trained OCR/plate-recognition model; we corroborate the existing workflow's reads.
- Per-character segmentation OCR; consensus + format validation is v1.
- Repair-cost / damage assessment (advanced-scanner spec).

---

## Architecture

```
Capture (any source) returns vehicles with: raw plate reads (+ model %),
                                            vehicle bbox, plate bbox, full frame
  │
  ├─ CLIENT: vehicleCrops.ts → {full, vehicleCrop, plateCrop} blobs (canvas)
  │          (multi-frame source also submits per-frame reads as consensus evidence)
  │
  └─ POST /api/alpr/capture (+ raw_reads[], bboxes, crops)
       │
       ├─ SERVER plateTrust.ts (pure, authoritative):
       │     1. consensus()  — cluster raw_reads (ambiguity-normalized edit dist),
       │                       canonical = weighted vote, consensus_ratio
       │     2. formatScore() — jurisdiction grammars (UT/CA/AZ/NV/ID/WY/MX-Sonora)
       │     3. corroborate() — agreement of GLM-OCR vs vehicle_details vs
       │                        enhanced_alpr_record plate
       │     4. trustScore = weighted blend (consensus dominant); model % = tiebreaker
       │     → { canonical, trustScore, trustBasis, variants[] }
       │
       ├─ GATE on trustScore:  ≥0.85 assert attributes · ≥0.80 package+file · else screen-only
       │
       ├─ MERGE: canonical within edit-distance+format of an existing vehicles_records
       │         plate → file under it (record variant); else new/own record
       │
       └─ WRITE vehicle_capture_photos row (3 R2 keys + bboxes + trust fields)
              R2: alpr/vehicles/<canonical>/<capture_id>/{full,vehicle,plate}.jpg
  │
  └─ UI: honest trust badge + per-vehicle dossier (grouped by canonical plate)
```

### Why server-authoritative trust

Gating (assert/keep) and cross-sighting merge both need D1 and must be tamper-resistant, so
the **authoritative** scoring runs in the Worker (`src/utils/plateTrust.ts`). The client
computes only *multi-frame* consensus during enhancement and submits candidate reads as
evidence; it never decides the gate. Display reads the server's `trustScore`/`trustBasis`.

---

## Components

### Pure core (the heart — fully unit-tested)

- **`src/utils/plateTrust.ts`** (Worker, authoritative): `consensus(reads)`,
  `normalizePlate(s)` (ambiguity map 0↔O, 1↔I, 5↔S, 8↔B, 2↔Z), `formatScore(plate)`
  (config-driven jurisdiction grammars), `corroborate(reads)`, `trustScore(...)` →
  `{ canonical, trustScore, trustBasis, variants }`. No I/O. vitest-covered (this is where
  "is the OCR bullshitting" is actually answered, so it gets the most tests).
- **`client/src/utils/plateTrust.ts`** (thin mirror): multi-frame `consensus()` for the
  enhancement tool + the badge formatter. Shares the normalize/format logic (kept in sync;
  the two builds don't share a module — documented constraint).

### Crops

- **`client/src/utils/vehicleCrops.ts`** (pure-ish, canvas): `(image, vehicleBbox,
  plateBbox) → {full, vehicleCrop, plateCrop}`; `expandPlateBoxToVehicle()` fallback;
  box-math unit-tested.

### Worker / data

- Extend **`POST /api/alpr/capture`**: accept `raw_reads[]` (string + model% + source),
  `vehicle_bbox`, `plate_bbox`, and the three crop blobs; run `plateTrust`; merge; persist.
- Migration **`0118_vehicle_capture_photos.sql`** (next free prefix): `id, capture_id,
  vehicle_record_id, canonical_plate, raw_reads_json, variants_json, read_count,
  consensus_ratio, trust_score, trust_basis, full_r2_key, vehicle_r2_key, plate_r2_key,
  vehicle_bbox_json, plate_bbox_json, source_type, asserted, created_at, created_by`.
- Add `trust_score`/`trust_basis`/`canonical_plate` to `vehicle_sightings` (or `_ext`) so
  the cross-sighting merge has somewhere to read/write consensus.
- Runtime `columnExists`/`ensureTable`, **and apply DDL directly to live D1 `785de7ae`**
  after merge (deploy apply is `continue-on-error`). Watch the D1 100-column cap — these
  go to the new table, not onto `calls_for_service`/`persons`.

### UI

- **`VehicleDossier.tsx`**: per-vehicle file — three-thumbnail packages in a timeline,
  source + **trust badge** + asserted/held, variant reads flagged "verify," court export
  (PDF/zip). Reached from the #1251 capture gallery (grouped by canonical plate),
  `vehicles_records` detail, `PlateLogPage`.
- **Trust badge component**: replaces the bare "%". Shows `trustScore` + `trustBasis`
  ("8/9 frames agree · CA valid · 2 models concur") and a distinct "single read —
  unverified" treatment. **Never renders a model self-reported 100%.**
- Capture gallery: group/merge tiles by canonical plate; show variant indicator.

---

## Plate-format config

A `PLATE_FORMATS` table/const, one entry per jurisdiction: `{ code, regex, label }`.
Seed: UT (`A12 3BC`/`123 ABC` styles), CA (`1ABC234`), AZ, NV, ID, WY, and
Mexico-Sonora (the sample data). Config-driven so adding a jurisdiction is a row, not code
(mirrors the national-warrant-sources pattern). `formatScore` returns the best match +
which jurisdiction, feeding `trustBasis`.

## Error handling

- **No bbox from workflow** → plate-box-expansion fallback for the vehicle crop; if even
  the plate box is missing, package the full frame only and mark `read_count`/trust low.
- **Single read (one still)** → consensus contributes nothing; trust capped so a lone
  model "100%" cannot reach the assert gate on its own — it can package (if format-valid)
  but shows "single read — unverified."
- **All reads disagree / no format match** → `<0.80`: screen-only, hit flagged
  UNCONFIRMED, not filed. Surface "low-confidence plate — manual entry?" (Correct path).
- **Crop upload fails** → still write the trust row + full frame; degrade, never block the
  screening result (existing best-effort pattern).

## Testing

- **vitest** heavily on `plateTrust.ts`: consensus winner + ratio from a read set;
  ambiguity-normalized clustering (`KJH345`/`5KJH345` cluster, `KJH123` does not);
  `formatScore` per jurisdiction incl. Sonora; `trustScore` ordering (consensus beats a
  lone 100%); "single read capped below assert" invariant.
- **vitest** on `vehicleCrops.ts`: crop rects, plate-box-expansion fallback, scaling.
- Worker typecheck; capture-route fields smoked locally; canvas/R2 verified manually.

## Build sequence

1. `plateTrust.ts` pure core (Worker) + vitest — define the trust contract first (TDD).
2. `vehicleCrops.ts` + vitest.
3. Migration `0118_vehicle_capture_photos` + capture-route trust/merge/persist.
4. `client/src/utils/plateTrust.ts` mirror + trust badge component.
5. `VehicleDossier.tsx` + gallery grouping by canonical plate + court export.
6. Bump `client/public/sw.js` `CACHE_NAME`; apply migration to live D1 after merge.

## Open questions / fast-follows

- **Cross-sighting merge window:** start with edit-distance ≤1 *and* format-compatible;
  tune against real data (avoid over-merging distinct plates like `KJH123` vs `KJH345`).
- **Footage auto-capture (#2)** reuses this contract headlessly: per-plate frame tracker
  feeds `raw_reads[]` straight into the same `plateTrust` + packaging path.
