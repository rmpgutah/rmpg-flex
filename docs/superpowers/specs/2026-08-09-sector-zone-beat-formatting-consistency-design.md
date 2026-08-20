# Sector/Zone/Beat formatting consistency

**Date**: 2026-08-09
**Status**: Approved for implementation

## Problem

The user asked to "rebuild the Area/Sec/Zone/Beat coding structure" so the formal
layout — Area shown separately as regional context, then the Sector/Zone/Beat
chart code in the `SL1/MID/B1` slash-combined form — is used consistently
everywhere. Clarifying questions established the actual problem is **inconsistent
formatting**, not a data model or format change: the canonical composite format
already exists and is already correct in most places.

Investigation (grounded in the current codebase) found:

1. **The canonical formatter already exists and is mostly followed.**
   `client/src/utils/dispatchCodeParts.ts` exports `zsbComposite()` (the
   "SEC/ZONE/BEAT" combined string, e.g. `SL1/SSL/A1`), plus `zoneLeaf()`,
   `beatLeaf()`, `sectionPrefix()`, and `sectionZoneBeatCombined()` for
   leaf-stripped per-column rendering. `ZsbBadge.tsx` wraps `zsbComposite()` as
   the shared "gold badge" component. This is already used correctly in:
   - The Dispatch call-detail panel (`DispatchPage.tsx`), which also resolves
     and passes an explicit `sectionCode`.
   - Queue list rows (`CallCard.tsx:373`), via `zsbComposite`.
   - The MDT call view (`MdtPage.tsx:1462`), via `ZsbBadge`.
   - Most PDF forms in `pdfGenerator.ts` (e.g. ~line 3467-3472) and
     `recordPdfGenerator.ts` (e.g. line 470, 2402, 6964), via
     `sectionZoneBeatCombined()` / `zsbComposite()`.

2. **Two PDF forms in `client/src/utils/pdfGenerator.ts` bypass the canonical
   helpers entirely.**
   - The Daily Activity Report form (~line 4278-4283) renders raw
     `data.sector_id` / `data.zone_id` / `data.beat_id` directly under the
     labels `'Section'` / `'Zone'` / `'Beat'` — no leaf-stripping, so a zone
     prints as its full parent-prefixed code (e.g. `SL1-SSL`) instead of the
     leaf (`SSL`), and a beat prints as `SL1-SSL/A1` instead of `A1`.
   - The Officer/Location block on a Process-Server/serve report (~line
     4580-4588) has the same bug under the labels `'Section ID'` / `'Zone ID'`
     / `'Beat ID'`.
   - Both are visibly different from every other form in the same file that
     already renders this data correctly a few thousand lines away.

3. **Stale "Section" labeling lingers in PDFs.** A prior spec
   (`2026-07-07-geography-naming-and-beat-descriptor-fix-design.md`) renamed
   "Section" → "Sector" across the Map UI (hooks, popups, dropdowns) to match
   the DB/API canon (`Area → Sector → Zone → Beat`, confirmed in
   `client/src/types/geography.ts` and the migration schema — there is no
   separate "District" tier). That spec was explicitly scoped to the map only
   and never touched PDFs. The two forms above (and a few explanatory code
   comments elsewhere in `pdfGenerator.ts` / `recordPdfGenerator.ts`) still say
   "Section," which is the same naming drift the 2026-07-07 spec fixed
   elsewhere, just not yet here.

4. **Two canonical-formatter callers omit `sectionCode`.** `CallCard.tsx:373`
   and `MdtPage.tsx:1462` call `zsbComposite({ zoneId, beatId, dispatchCode })`
   without the optional `sectionCode` parameter that `DispatchPage.tsx` passes.
   `zsbComposite()` already falls back to deriving the sector from the zone
   code's embedded prefix (`sectionPrefix(zoneCode)`) when `sectionCode` is
   absent, so this is harmless for the common case (zone codes normally embed
   their sector, e.g. `SL1-SSL`). It's a latent gap for the edge case where a
   stored zone code is leaf-only (no embedded sector) — those two surfaces
   would silently drop the sector segment while the detail panel would still
   show it correctly.

5. **Area is already correctly excluded from PDFs.** Confirmed via existing
   comments in `recordPdfGenerator.ts` (lines 467, 2730, 6959) — the print
   convention is "chart code only, no Area name." This matches what the user
   wants and needs no change.

## Non-goals

- No change to the `zsbComposite` / `zoneLeaf` / `beatLeaf` /
  `sectionZoneBeatCombined` format itself, or to the underlying
  `dispatch_areas` / `dispatch_sectors` / `dispatch_zones` / `dispatch_beats`
  data model. The format is already correct; this is a consistency-of-use fix.
- No change to how Area is displayed on-screen (detail panel, list rows) — only
  its confirmed absence from PDFs is preserved, not altered.
- No rename of `/dispatch/districts` API response fields, or of
  `useDistrictLookup.ts`'s internal `sections` / `sectionLabels` /
  `sectionCode` naming — both are explicit non-goals carried over from the
  2026-07-07 spec (wide consumer surface, no user-visible benefit).
- No new network fetch added to `CallCard.tsx` or `MdtPage.tsx` to resolve a
  sector code that isn't already available at that call site — the
  `sectionCode` hardening (item 4) only threads through data already in hand;
  if no sector code is available locally, today's derived-fallback behavior in
  `zsbComposite()` is left as-is.
- Does not cover X-Street/Building/Floor autofill or call-detail-panel
  load/retention behavior on open/close — separate specs per prior agreement,
  to be brainstormed after this one lands.

## Design

### 1. Daily Activity Report form (`pdfGenerator.ts`, ~line 4272-4292)

Replace the raw 3-field row:

```ts
const fy2 = addFieldPair(doc, 'Section', data.sector_id || '', lx + w5 * 2, y, w5);
const fy3 = addFieldPair(doc, 'Zone', data.zone_id || '', lx + w5 * 3, y, w5);
const fy4 = addFieldPair(doc, 'Beat', data.beat_id || '', lx + w5 * 4, y, w5);
```

with leaf-stripped values using the same helpers already imported in this file
(`zoneLeaf`, `beatLeaf`; add `sectionPrefix` to the existing import from
`./dispatchCodeParts`), keeping the existing 3-column layout (this row has
room for three separate cells, unlike the combined-cell pattern used
elsewhere):

```ts
const fy2 = addFieldPair(doc, 'Sector', sectionPrefix(data.zone_id) || data.sector_id || '', lx + w5 * 2, y, w5);
const fy3 = addFieldPair(doc, 'Zone', zoneLeaf(data.zone_id), lx + w5 * 3, y, w5);
const fy4 = addFieldPair(doc, 'Beat', beatLeaf(data.beat_id), lx + w5 * 4, y, w5);
```

`data.sector_id` is kept as the fallback for the Sector cell so a call whose
`zone_id` has no embedded prefix still shows something rather than a blank.

### 2. Officer/Location block on the Process-Server report (`pdfGenerator.ts`, ~line 4580-4588)

Same fix, same rationale — replace the 3 raw ID fields:

```ts
{ label: 'Section ID', value: data.sector_id || '' },
{ label: 'Zone ID', value: data.zone_id || '' },
{ label: 'Beat ID', value: data.beat_id || '' },
```

with:

```ts
{ label: 'Sector', value: sectionPrefix(data.zone_id) || data.sector_id || '' },
{ label: 'Zone', value: zoneLeaf(data.zone_id) },
{ label: 'Beat', value: beatLeaf(data.beat_id) },
```

Dropping the "ID" suffix in the label matches every other PDF form in the
codebase, which labels this data as the printed chart-code cell (`'Sector'` /
`'Zone'` / `'Beat'`), not as a raw database key.

### 3. `sectionCode` hardening — `CallCard.tsx` and `MdtPage.tsx`

- **`CallCard.tsx:373`**: check whether the call object passed to `CallCard`
  already carries a resolved sector code or `sector_id` alongside `zone_id`/
  `beat_id`. If so, pass it through as `sectionCode` to `zsbComposite()`. If
  the only sector-related data available is the raw `sector_id` (a DB row
  id / numeric PK per the geography spec, not a code string), do not pass it
  as `sectionCode` — that would be a type/semantic mismatch — and instead
  leave the existing `sectionPrefix(zoneCode)` fallback in place with a code
  comment explaining why (no code-string sector is available at this call
  site without a lookup this component doesn't otherwise need).
- **`MdtPage.tsx:1462`**: same check — `selectedCall` is already in scope
  here; if it (or a sibling piece of state on the page) carries a resolved
  sector code, thread it into the existing `ZsbBadge` call as `sectionCode`.
  Otherwise, same as above: leave the fallback and document why.

This item is a hardening pass for a currently-latent edge case, not a
guaranteed code change — the implementation should verify what data is
actually available before deciding whether a real fix applies here, and should
not add a network fetch to either component to manufacture a sector code that
isn't already in hand.

## Testing

- Regenerate the Daily Activity Report PDF and a Process-Server job report PDF
  for a call with a known chart code (e.g. `zone_id = 'SL1-SSL'`,
  `beat_id = 'SL1-SSL/A1'`) and visually confirm both now print
  `Sector: SL1`, `Zone: SSL`, `Beat: A1` — not the raw composite strings, and
  not labeled "Section."
- Extend `client/src/utils/__tests__/dispatchCodeParts.test.ts` or
  `client/src/components/__tests__/ZsbBadge.test.ts` if the `sectionCode`
  hardening in item 3 results in an actual code change, covering the case
  where a leaf-only zone code (no embedded sector) is passed with and without
  an explicit `sectionCode`.
- `cd client && npx tsc --noEmit` — confirms the new `sectionPrefix` import
  and any changed call signatures compile cleanly.
- `cd client && npx vitest run` (full suite, not a targeted run — this
  codebase has a documented history of targeted runs hiding real
  regressions) before considering the change complete.
