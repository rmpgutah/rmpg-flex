# Advanced vehicle visual scanner — plate + make/model/year + damage, with an 85% acceptance gate

- **Date:** 2026-06-14
- **Status:** Draft (awaiting user review)
- **Author:** Claude (brainstormed with Christopher Zamora)
- **Branch:** `claude/alpr-advanced-scanner`
- **Program context:** Sub-project **#1** of the dashcam-ALPR program. Ships on the
  already-live on-scene scanner and becomes the **analysis engine** the ClearPath
  dashcam pipeline (Phases A→B→C) reuses in Phase C. Builds directly on the
  fast-scan split ([2026-06-14-alpr-fast-scan-design.md](2026-06-14-alpr-fast-scan-design.md))
  — whose own goal already names *"make/model/color/**damage** fill in automatically."*

---

## Problem

The live ALPR scan reads a **plate** and (in the background enrich pass)
make/model/color/year. It does **not** produce a structured **damage / condition**
assessment, and it accepts whatever the model returns regardless of confidence. For a
police RMS we want (a) a richer "vehicle visual scanner" that records visible damage and
overall condition, and (b) an **accuracy gate** so only high-confidence reads enter the
records as fact.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Build order | **Scanner engine first** (this), then ClearPath A→B→C |
| Damage detection method | **Vision LLM** (extend the existing GPT-5.1 block) — not a trained CV model (YAGNI) |
| Which workflow carries damage | The **current heavy enrich workflow** now; keep parser/schema/UI workflow-agnostic so the planned lean-workflow swap carries damage later |
| Where damage is stored | **Per-observation** (`vehicle_sightings` + `alpr_captures`), **not** on the permanent `vehicles_records` |
| Acceptance gate | **Accept a field only when its confidence ≥ 0.85** (the [85%,100%] band), per-field |
| Sub-85% reads | **Hold for review** — saved, not auto-confirmed; officer confirms/corrects; nothing discarded |
| Screening on sub-85% plates | **Still screen** stolen/watchlist, but **flag any hit "UNCONFIRMED — verify plate"** (officer safety first) |

## Goal

Every scanned vehicle yields: plate + state, make/model/year/color/type, and a
**structured damage/condition assessment** — each field **accepted only at ≥85%
confidence**. Sub-85% reads are held in a review queue rather than written as fact;
stolen/watchlist screening still runs on low-confidence plates with hits flagged
unconfirmed. Works on the live on-scene path today; reusable by the dashcam pipeline.

### Non-goals

- Repair-cost dollar estimates / insurance valuation.
- A trained damage-detection CV model (vision-LLM assessment is v1; a CV model is a
  possible later upgrade).
- The lean-workflow enrichment swap (tracked fast-follow in the fast-scan spec).
- The ClearPath dashcam feed (Phases A→B→C — separate sub-projects).
- Continuous/live-video scanning (single-shot; the dashcam program covers near-real-time).

---

## Architecture

The fast/enrich split from #1243 is unchanged. Damage + the acceptance gate live in the
**enrich** pass, where per-field confidence exists.

```
Fast path (~1s, unchanged):
  plate-only workflow → plate (+ box confidence) → screen → record/sighting
  → return { plate, hits, enrich_status:'pending' }   [plate shown PROVISIONALLY]

Enrich path (background, c.executionCtx.waitUntil → enrichCapture):
  heavy workflow → per-vehicle { plate, make, model, year, color, type,
                                 condition, damage_observed, damage_areas[],
                                 damage_summary, field_confidence{...} }
  ── ACCEPTANCE GATE (per field, ≥0.85) ──
    plate ≥0.85  → accept: confirm/enrich the record + sighting; capture accepted=1
    plate <0.85  → HOLD: capture accepted=0, review_status='needs_review';
                   do NOT write authoritative attributes; still SCREEN (flag unconfirmed)
    each attribute (make/model/year/color/condition/damage) written ONLY if its
      own confidence ≥0.85; below → left null/unconfirmed
  update alpr_captures (accepted, review_status, condition, damage_*, plate_confidence,
                        enrich_status='done')
Client: re-fetches the capture once (existing bounded ≤2 poll) → fills accepted
        attributes + damage; shows a "needs review" state for held reads.
```

The **plate** is the primary gate: if the plate read is <0.85 the whole capture is held
(an uncertain plate makes its attributes meaningless). Attributes are gated individually
on top of an accepted plate.

---

## Server design

### 1. Heavy workflow — add structured damage (vision LLM)

Extend the `alpr_record` OpenAI step's per-vehicle `output_structure` (and the
`field_confidence` map) with:

- `overall_condition` — enum: `clean | minor | moderate | heavy | salvage`
- `damage_observed` — boolean
- `damage_areas[]` — list of `{ panel, type, severity }` (panel e.g. front-bumper /
  driver-door / hood; type e.g. dent / scratch / crack / missing-part / paint; severity
  `minor | moderate | severe`)
- `damage_summary` — one-line human summary
- `aftermarket_or_markings` — visible aftermarket parts, commercial markings, decals
- `field_confidence` gains `condition` and `damage` (0–1)

Also set the workflow's existing `plate_confidence_threshold` parameter default
`0.75 → 0.85` so detection and acceptance agree.

**Process (avoids the known slug-churn landmine):**
1. Prototype the new `output_structure` via `workflow_specs_run` (inline, non-destructive)
   on a **real damaged-vehicle** image; confirm GPT-5.1 returns usable, structured damage
   + per-field confidence.
2. Publish via `workflows_update` **keeping the exact name**
   `ALPR Vehicle Details Capture 1781360579827` so the URL slug
   `alpr-vehicle-details-capture-1781360579827` is preserved.
3. Re-verify the serverless endpoint resolves before relying on it.

### 2. Parser (`src/utils/roboflowAlpr.ts`)

- `AlprVehicle` gains: `condition`, `damageObserved`, `damageSummary`,
  `damageAreas: { panel; type; severity }[]`, `aftermarket`, and a per-field
  `confidences: { plate?; make?; model?; year?; color?; condition?; damage? }` map
  (read from the vehicle's `field_confidence`).
- `vehicleFromRecord` reads the new fields via the existing `unfenceJson` path; damage
  values tolerate string/array shapes (same defensive parsing as the rest).
- `normalizeCapture` surfaces capture-level `condition` + `damageObserved` +
  `damageSummary` from the first vehicle (existing `firstVeh` fallback).
- New pure helper `acceptByConfidence(value, conf, threshold=0.85)` → returns the value
  if `conf >= threshold`, else `null`. Used to build the **accepted** view without
  mutating the raw parse (raw stays in `raw_json` for audit).

### 3. Acceptance gate + hold-for-review (`src/routes/alpr.ts`)

**The gate runs in `enrichCapture` only** — the fast path has no per-field confidence
(just a detector box score), so it keeps today's behavior: create the provisional record +
sighting, screen the plate, return `enrich_status='pending'` with `accepted=NULL`
(undetermined). The enrich pass then decides acceptance:

- Compute `ACCEPT = 0.85` (constant `ALPR_ACCEPT_CONFIDENCE`, optional env override).
- **Plate gate:** if `plateConfidence >= ACCEPT` → accept; upsert/confirm the
  `vehicles_records` row and write only the attribute fields whose own confidence
  ≥ ACCEPT (`acceptByConfidence`). Set `alpr_captures.accepted=1`,
  `review_status='accepted'`, `plate_confidence=<conf>`.
- **Plate below gate:** **hold.** Set the capture `accepted=0`,
  `review_status='needs_review'`, `plate_confidence=<conf>`; do **not** write
  authoritative attributes (make/model/year/…) to `vehicles_records`. The provisional
  record/sighting the fast path created stay, but are **flagged `accepted=0`
  (unverified)** — "confirmed" views/queries filter on `accepted=1`, so a held read never
  appears as fact; it surfaces only in the review queue until an officer confirms it. The
  image + raw read are retained for audit.
- **Screening always runs** on the plate text (`screenVehicle`). On a sub-85% plate, any
  hit notification is prefixed **`UNCONFIRMED — verify plate:`** and the capture is
  flagged so the UI renders it as unconfirmed.
- Damage/condition fields persist on `alpr_captures` (capture-level summary) and on the
  `vehicle_sightings` rows (per observation); structured `damage_areas[]` rides in the
  existing `raw_json` (no new table).
- `shapeCapture` ([alpr.ts:490](../../../src/routes/alpr.ts)) returns the new fields:
  `condition`, `damage_observed`, `damage_summary`, `damage_areas`, `accepted`,
  `review_status`, `plate_confidence`, and per-field `confidences`.

### 4. Review queue (lean)

- `GET /api/alpr/captures?review=1` → captures with `accepted=0` / `review_status='needs_review'`.
- `POST /api/alpr/capture/:id/accept` (role-gated) → officer confirms (optionally
  corrects the plate); promotes the held read: upsert/confirm the vehicle record + link +
  sighting, set `accepted=1`, `review_status='confirmed'`. Audited.
- `POST /api/alpr/capture/:id/reject` → mark `review_status='rejected'` (kept for audit,
  not promoted).

### 5. Schema — migration `0114_alpr_damage_and_acceptance.sql`

`0113` is the high-water; this is `0114`. Add (idempotent; also appended to
`ALPR_EXTRA_COLUMNS` self-heal at [alpr.ts:74](../../../src/routes/alpr.ts)):

- `alpr_captures`: `condition TEXT`, `damage_observed INTEGER`, `damage_summary TEXT`,
  `plate_confidence REAL`, `accepted INTEGER`.  (`review_status` already exists.)
- `vehicle_sightings`: `condition TEXT`, `damage_observed INTEGER`, `damage_summary TEXT`,
  `confidence REAL`, `accepted INTEGER`.

Apply directly to live `785de7ae` after merge (deploy apply is `continue-on-error`);
verify with `pragma_table_info`.

---

## Client design

The two-stage UX (instant plate, "Identifying…" chip, bounded ≤2 re-fetch) already
exists; damage + confidence are additive.

- `AlprScanResult` (and the capture type) gain `condition`, `damage_observed`,
  `damage_summary`, `damage_areas[]`, `accepted`, `review_status`, `plate_confidence`,
  `confidences`.
- **Scan result (FieldCameraPage, PlateLogPage):** after enrich, render a **condition
  badge** (color-coded clean→salvage), a **damage summary** line, and an expandable
  **damage-areas** list. Show a small **confidence indicator** per accepted field; render
  unaccepted fields as a muted **"unverified <85%"**. If the capture is held
  (`accepted=0`), show a **"Needs review"** banner; a sub-85% hit shows the
  **"UNCONFIRMED — verify plate"** label on the alert.
- **Review affordance:** captures list gains a "Needs review" filter + per-row
  **Confirm / Reject** actions calling the new endpoints. Officer can correct the plate
  on confirm.
- Spillman tokens throughout (no blue; 2px radius; existing badge patterns).
- **Bump `CACHE_NAME`** in `client/public/sw.js` (client changes ship — required).

---

## Testing

- Parser: damage extraction from a fenced `enhanced_alpr_record` (object + array shapes);
  `acceptByConfidence` (≥0.85 keep, <0.85 → null, missing conf → null/treated below gate);
  `normalizeCapture` surfaces condition/damage.
- Route logic (pure helpers where the harness allows): plate ≥0.85 → accepted; <0.85 →
  held + screened-flagged; per-field attribute gating.
- `shapeCapture` exposes the new fields + `accepted`/`review_status`.
- Schema reconcile (self-heal adds the new columns).
- `workflow_specs_run` smoke on a real damaged-vehicle image → confirms structured damage
  + per-field confidence come back usable.
- All existing `tests/roboflowAlpr.test.ts` stay green.

## Security & correctness

- Screening (`screenVehicle`) still runs in the fast path — a stolen plate alerts within
  ~1s; sub-85% hits are clearly labelled unconfirmed, never suppressed.
- Held (sub-85%) reads never enter `vehicles_records` as fact; the image + raw read are
  retained for audit and officer review.
- Background enrich stays best-effort + isolated (try/catch → `enrich_status='failed'`).
- No base64 images logged; R2 prefixes + role gates unchanged; review endpoints role-gated
  + audited.

## Rollout & verification

1. Prototype + publish the heavy-workflow damage fields (slug preserved); record nothing
   new (same slug/id).
2. Merge → deploy. Apply `0114` directly to live `785de7ae`; confirm via
   `pragma_table_info('alpr_captures')` + `pragma_table_info('vehicle_sightings')`.
3. Bump `CACHE_NAME` (done in PR).
4. Verify in a real browser (WAF blocks curl): scan a clean plate → accepted, attributes +
   condition fill in; scan a deliberately blurry plate → held "Needs review" + (if a
   watchlist match) an "UNCONFIRMED" alert; confirm from the review queue promotes it.

## Open items

- Exact `damage_areas` panel vocabulary — start with a small open enum (front/rear bumper,
  hood, roof, each door/fender/quarter, windshield, lights, wheels) and let `panel` be
  free text the LLM fills; refine after seeing real output.
- Confirm GPT-5.1 returns calibrated per-field confidence for `condition`/`damage` (verify
  in the `workflow_specs_run` prototype; if weak, derive a coarse confidence from
  agreement between the per-crop `vehicle_details` and full-image `alpr_record`).
- Whether the lean-workflow enrichment swap (separate fast-follow) should be sequenced
  right after this to cut the 2× cost while damage is fresh.
