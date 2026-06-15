# ALPR Advanced Review, Edit & Verify — Design

**Date:** 2026-06-14
**Status:** Approved
**Surfaces:** `client/src/pages/PlateLogPage.tsx` (SCAN/LOG review queue), `client/src/components/AlprCaptureGallery.tsx` (CAPTURES), `src/routes/alpr.ts` (API).

## Problem

The ALPR review flow only offers blind **CONFIRM / REJECT** on sub-85% held reads.
Officers cannot fix an obvious OCR misread (`63`, `UT15`, `KJH345` at 80% in the
live queue) before confirming, cannot edit state / make / model / color / year /
condition, cannot verify or re-edit a capture from the CAPTURES gallery, and
cannot re-verify a capture once confirmed. Additionally, many dashcam/field
captures land with plate + state only ("no attributes") — the AI enrich path is
not reliably persisting the vehicle attributes the model returns.

## Goals

1. **Edit-before-confirm** on the NEEDS REVIEW queue.
2. **Verify/edit any capture** from the CAPTURES gallery, with a human-verified
   indicator distinct from the OCR-trust badge.
3. **Re-edit / re-verify** already-confirmed or rejected captures ("change
   function"), audited.
4. **AI-capture audit**: ensure the enrich/parse path actually persists
   state/make/model/color/year/condition/damage where the model returns them.

## Non-goals

- No new DB migration for edit fields — `alpr_captures` already has every column
  (`plate, state, make, model, color, year, vehicle_type, condition,
  damage_observed, damage_summary, confidence, plate_confidence, review_status,
  accepted, reviewed_by, reviewed_at`).
- No change to the OCR-trust (`trust_score`/`read_count`) consensus model — the
  human "VERIFIED" chip is a separate axis from the `TrustBadge`.

## Backend — `POST /alpr/capture/:id/verify`

New route alongside the existing `/accept` + `/reject` (kept for back-compat).
Body:

```ts
{ action: 'confirm' | 'reject' | 'save',
  plate?, state?, make?, model?, color?, year?,
  vehicle_type?, condition?, damage_summary?, reason? }
```

Behaviour:
- Validate: plate `^[A-Z0-9]{2,10}$` (reuse existing rule); state uppercased,
  2–3 alpha; year an int in a sane window (1900..currentYear+2) or null;
  free-text fields trimmed + length-bounded.
- Persist all **supplied** edits to the row (omitted fields untouched).
- A human-supplied attribute is **trusted and kept** — unlike `/accept`, which
  drops OCR attributes on a plate correction. (Rule: drop the stale OCR value
  only when the officer corrected the plate *and* left that attribute blank.)
- `action='confirm'` → set `review_status='confirmed'`, `accepted=1`, then upsert
  the authoritative `vehicles_records` + `call_vehicles` link (when `call_id`) +
  `vehicle_sightings` row and run `screenVehicle` (mirrors `/accept`), using the
  edited values. Return `{ success, hits, ...shapeCapture }`.
- `action='reject'` → `review_status='rejected'`, `accepted=0`.
- `action='save'` → persist edits only; leave `review_status` unchanged.
- Operates on **any** status. Every call stamps `reviewed_by` + `reviewed_at`.
  When the target row was already `confirmed`/`rejected`, `reason` is required
  and an `audit_log` row is written
  (`action='ALPR_REVERIFY'`, `entity_type='alpr_capture'`, `entity_id=id`,
  `details=<reason + field diff>`). Best-effort; never blocks the edit.

## Frontend — shared `CaptureReviewEditor`

New component `client/src/components/CaptureReviewEditor.tsx`: image preview +
editable fields (plate big-input, state, make, model, color, year, condition
select, damage note) + **Confirm / Save / Reject** buttons. Mobile = full-width
sheet, desktop = modal. Pure field-normalization helpers
(`client/src/utils/captureEdit.ts`) unit-tested in
`client/src/utils/captureEdit.test.ts` (plate/state/year normalization, the
attribute-keep-vs-drop rule mirrored client-side for optimistic display).

Wired into:
- **PlateLogPage NEEDS REVIEW queue** — add an "EDIT" button per row that opens
  the editor pre-filled; keep one-tap CONFIRM/REJECT for the no-correction path.
- **AlprCaptureGallery** — each tile gains a small VERIFY/EDIT affordance opening
  the same editor. A green **✓ VERIFIED** chip renders when
  `review_status==='confirmed'` (separate from `TrustBadge`); rejected shows a
  muted REJECTED chip.

Both surfaces call `POST /alpr/capture/:id/verify` and refresh on success. A
confirm that re-screens a STOLEN/watchlist hit surfaces the critical hit (same
pattern as today's `reviewAction`).

## AI-capture audit

Trace and fix the enrich/parse path so attributes are persisted, not dropped:
- `src/utils/roboflowAlpr.ts` `parseAlprResponse` / `parseVehicles` — confirm
  state/make/model/color/year/vehicle_type/condition/damage are mapped.
- `src/routes/alpr.ts` enrich writer (`UPDATE alpr_captures SET make=?, model=?,
  …`) — confirm every parsed field is written.
- ClearPath dashcam ingest path — confirm dashcam reads run enrich (the
  "no attributes" tiles suggest they may not).

Findings documented in this spec's addendum; any parsed-but-not-persisted or
never-parsed field fixed. If a field genuinely isn't returned by the model on a
given source, that's recorded (not silently dropped).

## Testing & delivery

- Worker `npm run typecheck`; client `tsc --noEmit` + `vitest run` (new
  `captureEdit.test.ts`).
- One feature branch → PR (per repo flow); bump `client/public/sw.js`
  `CACHE_NAME` (currently `v957` → `v958`).
- No migration. After merge, no live D1 DDL needed (columns already exist).
