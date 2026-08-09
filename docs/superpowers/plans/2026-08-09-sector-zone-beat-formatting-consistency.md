# Sector/Zone/Beat Formatting Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every PDF/list/MDT render of a call's Sector/Zone/Beat chart
code go through the existing canonical helpers (`zsbComposite`, `zoneLeaf`,
`beatLeaf`, `sectionPrefix`, `sectionZoneBeatCombined` in
`client/src/utils/dispatchCodeParts.ts`), and rename the remaining "Section"
PDF labels to "Sector."

**Architecture:** No new code paths. Three PDF call sites in
`client/src/utils/pdfGenerator.ts` render raw, un-stripped
`sector_id`/`zone_id`/`beat_id` under stale "Section" labels instead of using
the helpers already imported in that file. Two component call sites
(`CallCard.tsx`, `MdtPage.tsx`) call `zsbComposite()` without the optional
`sectionCode` parameter that the Dispatch detail panel already passes. Fix is
mechanical: swap raw values for helper calls, rename labels, add one prop.

**Tech Stack:** React + TypeScript (client), jsPDF (`pdfGenerator.ts`),
Vitest.

## Global Constraints

- Do not change the output format of `zsbComposite`/`zoneLeaf`/`beatLeaf`/
  `sectionZoneBeatCombined` themselves — spec is explicit this is a
  consistency-of-use fix, not a format change.
- Do not touch Area rendering on PDFs (confirmed already absent, matches
  desired behavior) or on-screen Area display.
- Do not rename `/dispatch/districts` API fields or `useDistrictLookup.ts`
  internals (binding non-goal carried over from the 2026-07-07 geography
  naming spec).
- Do not add a new network fetch to `CallCard.tsx` or `MdtPage.tsx` to obtain
  a sector code — `calls_for_service.sector_id` is already a `TEXT` code
  string (confirmed via `migrations/0009_calls_for_service_columns.sql:41` and
  `migrations/0013_spillman_codes.sql`, e.g. `'SL1'`, `'BV1'` — not a numeric
  foreign key), and both components already receive it on the call object in
  hand.
- Full client vitest suite (`cd client && npx vitest run`), not a targeted
  run, must pass before any task is considered complete — this codebase has a
  documented history of targeted runs hiding real regressions.

**Planning note (found during plan-writing, not in the original spec's
inventory):** a third PDF call site at `pdfGenerator.ts:3467-3472` — cited in
the spec as an example of an *already-correct* form — turns out to have the
same bug on one of its three fields (line 3470: label `'Section'`, raw
`data.sector_id`). Same bug class, same fix pattern already approved in the
spec's Design section (labels 1 and 2); Task 1 below fixes all three call
sites together since they're the same file, same helper family, same
verification step.

---

### Task 1: Canonicalize the three PDF call sites in `pdfGenerator.ts`

**Files:**
- Modify: `client/src/utils/pdfGenerator.ts:17` (import)
- Modify: `client/src/utils/pdfGenerator.ts:3467-3472` (Incident Location block)
- Modify: `client/src/utils/pdfGenerator.ts:4278-4283` (Daily Activity Report)
- Modify: `client/src/utils/pdfGenerator.ts:4580-4588` (Officer/Location block)

**Interfaces:**
- Consumes: `sectionPrefix`, `zoneLeaf`, `beatLeaf` — all already exported by
  `client/src/utils/dispatchCodeParts.ts` (signatures:
  `sectionPrefix(zoneCode: string | null | undefined): string`,
  `zoneLeaf(zoneCode: string | null | undefined): string`,
  `beatLeaf(beatCode: string | null | undefined): string`).
- Produces: nothing consumed by later tasks — this task is self-contained.

- [ ] **Step 1: Add the missing import**

`zoneLeaf`, `beatLeaf`, and `sectionZoneBeatCombined` are already imported at
line 17. Add `sectionPrefix` to the same import:

```ts
import { zoneLeaf, beatLeaf, sectionZoneBeatCombined, sectionPrefix } from './dispatchCodeParts';
```

- [ ] **Step 2: Fix the Incident Location block (lines 3467-3472)**

Current code:

```ts
      const fy5 = addFieldPair(doc, 'Section/Zone/Beat', sectionZoneBeatCombined(data.sector_id, data.zone_id, data.beat_id) || data.dispatch_code || '', lx + w3 * 2, y, w3);
      y = Math.max(fy3, fy4, fy5);
      // Row 3: Section, Zone, Beat (each as leaf — no parent prefixes)
      const fy6 = addFieldPair(doc, 'Section', data.sector_id || '', lx, y, w3);
      const fy7 = addFieldPair(doc, 'Zone', zoneLeaf(data.zone_id), lx + w3, y, w3);
      const fy8 = addFieldPair(doc, 'Beat', beatLeaf(data.beat_id), lx + w3 * 2, y, w3);
```

Replace with:

```ts
      const fy5 = addFieldPair(doc, 'Sector/Zone/Beat', sectionZoneBeatCombined(data.sector_id, data.zone_id, data.beat_id) || data.dispatch_code || '', lx + w3 * 2, y, w3);
      y = Math.max(fy3, fy4, fy5);
      // Row 3: Sector, Zone, Beat (each as leaf — no parent prefixes)
      const fy6 = addFieldPair(doc, 'Sector', sectionPrefix(data.zone_id) || data.sector_id || '', lx, y, w3);
      const fy7 = addFieldPair(doc, 'Zone', zoneLeaf(data.zone_id), lx + w3, y, w3);
      const fy8 = addFieldPair(doc, 'Beat', beatLeaf(data.beat_id), lx + w3 * 2, y, w3);
```

(Only the label text on `fy5`, and the label + value on `fy6`, changed. `fy7`/
`fy8` were already correct.)

- [ ] **Step 3: Fix the Daily Activity Report form (lines 4278-4283)**

Current code:

```ts
    // Row 1: Officer Name (2/5), Section (1/5), Zone (1/5), Beat (1/5)
    const w5 = ffw / 5;
    const fy1 = addFieldPair(doc, 'Officer Name', data.officer_name || '', lx, y, w5 * 2);
    const fy2 = addFieldPair(doc, 'Section', data.sector_id || '', lx + w5 * 2, y, w5);
    const fy3 = addFieldPair(doc, 'Zone', data.zone_id || '', lx + w5 * 3, y, w5);
    const fy4 = addFieldPair(doc, 'Beat', data.beat_id || '', lx + w5 * 4, y, w5);
```

Replace with:

```ts
    // Row 1: Officer Name (2/5), Sector (1/5), Zone (1/5), Beat (1/5)
    const w5 = ffw / 5;
    const fy1 = addFieldPair(doc, 'Officer Name', data.officer_name || '', lx, y, w5 * 2);
    const fy2 = addFieldPair(doc, 'Sector', sectionPrefix(data.zone_id) || data.sector_id || '', lx + w5 * 2, y, w5);
    const fy3 = addFieldPair(doc, 'Zone', zoneLeaf(data.zone_id), lx + w5 * 3, y, w5);
    const fy4 = addFieldPair(doc, 'Beat', beatLeaf(data.beat_id), lx + w5 * 4, y, w5);
```

- [ ] **Step 4: Fix the Officer/Location block (lines 4580-4588)**

Current code:

```ts
    const olFields = [
      { label: 'Officer', value: data.officer_name || '' },
      { label: 'Location', value: data.location || '' },
      { label: 'Section ID', value: data.sector_id || '' },
      { label: 'Zone ID', value: data.zone_id || '' },
      { label: 'Beat ID', value: data.beat_id || '' },
    ];
```

Replace with:

```ts
    const olFields = [
      { label: 'Officer', value: data.officer_name || '' },
      { label: 'Location', value: data.location || '' },
      { label: 'Sector', value: sectionPrefix(data.zone_id) || data.sector_id || '' },
      { label: 'Zone', value: zoneLeaf(data.zone_id) },
      { label: 'Beat', value: beatLeaf(data.beat_id) },
    ];
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (this file already imports `dispatchCodeParts` helpers
elsewhere with identical signatures, so adding one more named import cannot
introduce a type error).

- [ ] **Step 6: Manual PDF regeneration check**

Using the app's existing "Preview PDF report" action (or the dev PDF gallery
if one is configured — check `client/src/devtools/pdfGallery/` for a runnable
harness), generate one Daily Activity Report and one Incident Location–bearing
report (e.g. a standard incident report) for a call whose stored
`zone_id = 'SL1-SSL'` and `beat_id = 'SL1-SSL/A1'`. Confirm all three fixed
blocks now print `Sector: SL1`, `Zone: SSL`, `Beat: A1` — not the raw
`SL1-SSL` / `SL1-SSL/A1` strings, and not labeled "Section." If no call with
that exact data is available, any call with a non-null `zone_id` works — the
point is confirming the leaf-stripped value renders, not the specific codes.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/pdfGenerator.ts
git commit -m "$(cat <<'EOF'
fix(pdf): render Sector/Zone/Beat through canonical helpers, not raw codes

Three call sites in pdfGenerator.ts printed the raw parent-prefixed
zone_id/beat_id strings (e.g. "SL1-SSL/A1") under bare "Zone"/"Beat"
labels, and one still used the pre-2026-07-07 "Section" label — that
rename was scoped to the Map UI only and never reached PDFs. All three
now go through the same zoneLeaf/beatLeaf/sectionPrefix helpers every
other PDF form in this file already uses.
EOF
)"
```

---

### Task 2: Pass `sectionCode` from `CallCard.tsx`

**Files:**
- Modify: `client/src/components/CallCard.tsx:373`
- Test: `client/src/components/__tests__/ZsbBadge.test.ts` (verify existing
  coverage already proves this is safe — no new test needed, see Step 2)

**Interfaces:**
- Consumes: `zsbComposite(opts: { zoneId?, beatId?, dispatchCode?, sectionCode? }): string`
  from `client/src/utils/dispatchCodeParts.ts` (imported in this file via
  `client/src/components/ZsbBadge.tsx`'s re-export, per line 16:
  `import { zsbComposite } from './ZsbBadge';`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `sectionCode` to the existing call**

Current code (line 373):

```tsx
            const code = zsbComposite({ zoneId: call.zone_id, beatId: call.beat_id, dispatchCode: call.dispatch_code });
```

Replace with:

```tsx
            const code = zsbComposite({ zoneId: call.zone_id, beatId: call.beat_id, dispatchCode: call.dispatch_code, sectionCode: call.sector_id });
```

`call.sector_id` is typed `sector_id?: string` on `CallForService`
(`client/src/types/index.ts:290`) and is a Spillman-style code string
(e.g. `'SL1'`) stored directly on the row — confirmed via
`migrations/0009_calls_for_service_columns.sql:41` (`ADD COLUMN sector_id
TEXT`) and the code-normalization data in `migrations/0013_spillman_codes.sql`
(e.g. `UPDATE calls_for_service SET sector_id = 'SL1' WHERE sector_id =
'SLC'`) — not a numeric foreign key, so it's safe to pass directly as
`sectionCode` with no lookup.

- [ ] **Step 2: Confirm existing test coverage already proves this is correct**

`zsbComposite`'s `sectionCode` behavior is already covered by
`client/src/components/__tests__/ZsbBadge.test.ts` (e.g. "explicit
sectionCode wins over the embedded prefix", "sector only (resolved code) →
SL1"). This task only changes what `CallCard.tsx` *passes into* an
already-tested function — no new logic, so no new test is needed. Confirm
those existing tests still pass:

Run: `cd client && npx vitest run ZsbBadge.test.ts`
Expected: `9 tests passed` (the 9 cases already in that file), unchanged.

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/CallCard.tsx
git commit -m "$(cat <<'EOF'
fix(dispatch): pass sector_id into CallCard's chart-code badge

CallCard called zsbComposite() without sectionCode, relying on the
zone_id's embedded prefix. calls_for_service.sector_id is already a
plain code string (e.g. "SL1"), not a numeric FK, so passing it
directly closes the edge case where a leaf-only zone_id would drop
the sector segment on queue list rows.
EOF
)"
```

---

### Task 3: Pass `sectionCode` from `MdtPage.tsx`

**Files:**
- Modify: `client/src/pages/MdtPage.tsx:1462`

**Interfaces:**
- Consumes: `ZsbBadge` component props
  `{ zoneId?, beatId?, dispatchCode?, sectionCode? }` from
  `client/src/components/ZsbBadge.tsx`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `sectionCode` to the existing `ZsbBadge` usage**

Current code (line 1462):

```tsx
                  <div className="ml-4 mt-1"><ZsbBadge zoneId={selectedCall.zone_id} beatId={selectedCall.beat_id} dispatchCode={selectedCall.dispatch_code} /></div>
```

Replace with:

```tsx
                  <div className="ml-4 mt-1"><ZsbBadge zoneId={selectedCall.zone_id} beatId={selectedCall.beat_id} dispatchCode={selectedCall.dispatch_code} sectionCode={selectedCall.sector_id} /></div>
```

Same rationale as Task 2 — `selectedCall` is a `CallForService`, and
`sector_id` is the same plain code-string column.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm existing coverage still passes**

Run: `cd client && npx vitest run ZsbBadge.test.ts`
Expected: `9 tests passed`, unchanged (same reasoning as Task 2 — this is a
prop pass-through into already-tested logic, no new test needed).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/MdtPage.tsx
git commit -m "$(cat <<'EOF'
fix(mdt): pass sector_id into the MDT call view's chart-code badge

Same fix as CallCard.tsx — selectedCall.sector_id is a plain code
string, not a numeric FK, so it's safe to pass straight through as
ZsbBadge's sectionCode instead of relying on zone_id's embedded
prefix alone.
EOF
)"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: all test files pass (this codebase's documented baseline is 100%
passing; any failure here is caused by Tasks 1-3, not pre-existing — confirm
by checking the failing test's file is one touched above before assuming
otherwise).

- [ ] **Step 2: Run the worker test suite** (unaffected by these changes, but
confirms nothing outside `client/` was accidentally touched)

Run: `npx vitest run`
Expected: same pass/fail state as the pre-existing baseline. If
`tests/osmSpeedLimitLookup.test.ts` fails with `PbfWriter is not a
constructor`, that is a confirmed pre-existing, unrelated `pbf` package
version issue — not caused by this work. Any other failure is a regression to
investigate before proceeding.

- [ ] **Step 3: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.
