# Map marker/popup CAD-realism redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the map's unit marker, call marker, and call popup card to match real CAD/AVL visual conventions (directional arrow, rounded-square call marker, dense labeled popup), and add live call-age / en-route ETA/distance timers.

**Architecture:** All shape/layout/content changes live in the existing pure DOM-builder module `client/src/pages/map/utils/mapMarkers.ts` (functions consumed by `MapboxMapPage.tsx`). En-route ETA/distance is a new small polling hook (`client/src/pages/map/hooks/useEnRouteEta.ts`) that calls the existing `fetchMapboxRoute` routing client and is wired into `MapboxMapPage.tsx`'s existing marker/popup-refresh effects — no new mapboxgl.Marker instances, no new popup instances.

**Tech Stack:** React + TypeScript, Mapbox GL JS (`mapboxgl.Marker`/`Popup`), Vitest + jsdom for tests.

## Global Constraints

- Target file for all shape/content changes: `client/src/pages/map/utils/mapMarkers.ts` — **not** the unrelated sibling `client/src/utils/mapMarkers.ts` (used by mini-maps/forensic track map; out of scope).
- Do not touch `UNIT_STATUS_COLORS`/`UNIT_STATUS_HEX`, `UNIT_STATUS_ABBREV`, or `priorityHex`/`PRIORITY_HEX` — palette is unchanged, only shape/layout.
- Border radius on any new rectangular element: `2px` (app-wide "radius-2 everywhere" rule).
- `UnitStatus` enum values are exactly: `available`, `dispatched`, `enroute`, `onscene`, `busy`, `off_duty`, `out_of_service` (from `client/src/utils/statusColors.ts`). The en-route indicator keys off `status === 'enroute'`.
- Units are matched to calls via `unit.call_number === call.call_number` (existing pattern in `MapboxMapPage.tsx`), not `current_call_id`.
- Never call `fetchMapboxRoute` per GPS tick — it must be polled/cached (Task 6 owns this).
- Full test suite (`cd client && npx vitest run`) and typecheck (`cd client && npx tsc --noEmit`) must stay green after every task.

---

## File Structure

- **Modify** `client/src/pages/map/utils/mapMarkers.ts` — shape changes (Tasks 1–2), popup redesign + call-age timer (Task 3), en-route tag + formatting helpers (Task 4), popup ETA/DISTANCE rows (Task 5).
- **Modify** `client/src/pages/map/utils/__tests__/mapMarkers.test.ts` — new/updated assertions for every task above.
- **Create** `client/src/pages/map/hooks/useEnRouteEta.ts` — polling hook computing `{ [callNumber]: { etaSeconds, distanceMiles } }` for en-route unit/call pairs (Task 6).
- **Create** `client/src/pages/map/hooks/__tests__/useEnRouteEta.test.ts` — hook tests (Task 6).
- **Modify** `client/src/pages/map/MapboxMapPage.tsx` — wire `useEnRouteEta` output into the existing unit-marker and call-marker/popup refresh effects (Task 7).

---

### Task 1: Unit marker — replace filled circle badge with a directional arrow

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts:93-171` (`buildUnitMarkerEl`), `:179-223` (`applyUnitMarkerState`)
- Test: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`

**Interfaces:**
- Consumes: nothing new — same `MapUnit` shape, same `UNIT_STATUS_COLORS`, `getGpsStaleness`, `withAlpha` already imported in this file.
- Produces: `buildUnitMarkerEl(unit)` and `applyUnitMarkerState(el, unit)` keep their exact existing signatures and return types (`HTMLDivElement` / `void`). The `[data-role="badge"]` element now contains an inline `<svg>` arrow instead of a filled circle + vehicle glyph; later tasks (4) query this same `[data-role="badge"]` node to size the en-route tag next to it, so the attribute name must not change.

- [ ] **Step 1: Write the failing test for the new arrow shape**

Add to `client/src/pages/map/utils/__tests__/mapMarkers.test.ts` (inside the existing `describe('mapMarkers', ...)` block, after the "builds a unit marker element with the call sign text" test):

```ts
  it('renders the unit badge as an arrow svg, not a filled circle', () => {
    const el = buildUnitMarkerEl(unit);
    const badge = el.querySelector('[data-role="badge"]');
    expect(badge?.querySelector('svg')).toBeTruthy();
    expect(badge?.querySelector('path')).toBeTruthy();
    // No circular badge fill/border-radius left on the badge element itself
    expect(badge?.getAttribute('style') || '').not.toContain('border-radius:50%');
  });

  it('rotates the arrow to gps_heading when present, and defaults to 0deg otherwise', () => {
    const withHeading = buildUnitMarkerEl({ ...unit, gps_heading: 90 } as MapUnit);
    const svgWithHeading = withHeading.querySelector('[data-role="badge"] svg') as SVGElement;
    expect(svgWithHeading.style.transform).toBe('rotate(90deg)');

    const withoutHeading = buildUnitMarkerEl({ ...unit, gps_heading: null } as MapUnit);
    const svgWithoutHeading = withoutHeading.querySelector('[data-role="badge"] svg') as SVGElement;
    expect(svgWithoutHeading.style.transform).toBe('rotate(0deg)');
  });

  it('applyUnitMarkerState updates the arrow rotation and fill color in place', () => {
    const el = buildUnitMarkerEl(unit);
    applyUnitMarkerState(el, { ...unit, status: 'busy', gps_heading: 200 } as MapUnit);
    const svg = el.querySelector('[data-role="badge"] svg') as SVGElement;
    expect(svg.style.transform).toBe('rotate(200deg)');
    const path = el.querySelector('[data-role="badge"] path') as SVGPathElement;
    expect(path.getAttribute('fill')).toBe(UNIT_STATUS_COLORS.busy);
  });
```

Add `UNIT_STATUS_COLORS` to the test file's existing import from `'../mapConstants'` (it's already re-exported there per `mapConstants.ts:9`):

```ts
import type { MapUnit, ActiveCall } from '../mapConstants';
import { UNIT_STATUS_COLORS } from '../mapConstants';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: FAIL — `badge?.querySelector('svg')` is falsy (current badge has no `<svg>`, just a `UNIT_GLYPH_SVG` innerHTML with a differently-shaped path and a `border-radius:50%` circle).

- [ ] **Step 3: Replace the glyph constant and rewrite the badge markup**

In `client/src/pages/map/utils/mapMarkers.ts`, replace the `UNIT_GLYPH_SVG` constant (lines 90-91) with an arrow path builder:

```ts
// Directional triangular arrow — replaces the old vehicle-silhouette glyph.
// Points north (0deg) by default; buildUnitMarkerEl/applyUnitMarkerState set
// the rotation via the returned <svg>'s own style.transform, not a wrapping
// element, so the fill color and the rotation can be updated independently
// without re-parsing HTML on every poll.
function buildUnitArrowSvg(fillColor: string, headingDeg: number | null | undefined): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  const rotation = headingDeg != null && Number.isFinite(headingDeg) ? headingDeg : 0;
  svg.style.transform = `rotate(${rotation}deg)`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 2 20 21 12 16 4 21Z');
  path.setAttribute('fill', fillColor);
  path.setAttribute('stroke', TACTICAL_BADGE_SURFACE);
  path.setAttribute('stroke-width', '1');
  svg.appendChild(path);
  return svg;
}
```

Replace the badge-building block inside `buildUnitMarkerEl` (lines 120-138) with:

```ts
  const badge = document.createElement('div');
  badge.setAttribute('data-role', 'badge');
  const ringColor = staleness === 'ok' ? color : '#6b7280';
  badge.style.cssText = `
    display:flex;align-items:center;justify-content:center;
    filter:drop-shadow(0 0 4px ${withAlpha(ringColor, 'b3')});
  `;
  const arrowFill = staleness === 'ok' ? color : ringColor;
  badge.appendChild(buildUnitArrowSvg(arrowFill, unit.gps_heading));
  inner.appendChild(badge);
```

- [ ] **Step 4: Update `applyUnitMarkerState` to mutate the arrow in place**

Replace the badge-update block inside `applyUnitMarkerState` (lines 189-196) with:

```ts
  const ringColor = staleness === 'ok' ? color : '#6b7280';
  const badge = el.querySelector<HTMLElement>('[data-role="badge"]');
  if (badge) {
    badge.style.filter = `drop-shadow(0 0 4px ${withAlpha(ringColor, 'b3')})`;
    const arrowFill = staleness === 'ok' ? color : ringColor;
    const svg = badge.querySelector('svg') as SVGSVGElement | null;
    const path = badge.querySelector('path') as SVGPathElement | null;
    if (svg && path) {
      const rotation = unit.gps_heading != null && Number.isFinite(unit.gps_heading) ? unit.gps_heading : 0;
      svg.style.transform = `rotate(${rotation}deg)`;
      path.setAttribute('fill', arrowFill);
      path.setAttribute('stroke', TACTICAL_BADGE_SURFACE);
    }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS — all 3 new tests, plus every pre-existing test in this file still passes (call-sign text, popup HTML, staleness/accuracy-ring tests are untouched by this change).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "feat(map): unit marker uses a directional arrow instead of a filled circle badge"
```

---

### Task 2: Call marker — diamond → rounded square, add call-number label

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts:247-285` (`buildCallMarkerEl`)
- Test: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`

**Interfaces:**
- Consumes: same `ActiveCall` shape, `priorityHex`, `priorityLabel`, `CALL_MARKER_INK` already imported.
- Produces: `buildCallMarkerEl(call)` keeps its exact signature/return type (`HTMLDivElement`). The root's `textContent` used to be exactly the priority label (e.g. `"P1"`, asserted by the existing "PP1 regression" tests) — this task adds a second child with the call number, so `el.textContent` becomes the **concatenation** of both. The existing regression tests assert `el.textContent).toBe(expected)` where `expected` is just the priority label; those assertions must be updated to query the priority-square specifically rather than the whole root (done in Step 1 below), or they will break.

- [ ] **Step 1: Write the failing test, and fix the two now-outdated assertions in the same file**

First, update the existing "PP1 regression" tests (`client/src/pages/map/utils/__tests__/mapMarkers.test.ts`, inside `describe('priority label never double-prefixes', ...)`) — the `for` loop currently does:

```ts
      it(`renders ${JSON.stringify(input)} as ${expected} on the marker`, () => {
        const el = buildCallMarkerEl({ ...call, priority: input } as unknown as ActiveCall);
        expect(el.textContent).toBe(expected);
        expect(el.textContent).not.toMatch(/^PP/);
      });
```

Change it to read the priority square specifically (add `[data-role="priority-square"]` — Step 2 below adds that attribute):

```ts
      it(`renders ${JSON.stringify(input)} as ${expected} on the marker`, () => {
        const el = buildCallMarkerEl({ ...call, priority: input } as unknown as ActiveCall);
        const square = el.querySelector('[data-role="priority-square"]') as HTMLElement;
        expect(square.textContent).toBe(expected);
        expect(square.textContent).not.toMatch(/^PP/);
      });
```

Also update the earlier basic test ("builds a call marker element with the priority label"):

```ts
  it('builds a call marker element with the priority label', () => {
    const el = buildCallMarkerEl(call);
    const square = el.querySelector('[data-role="priority-square"]') as HTMLElement;
    expect(square.textContent).toBe('P1');
  });
```

Now add the new tests for the shape and the new call-number label, right after it:

```ts
  it('renders the call marker as a rounded square, not a rotated diamond', () => {
    const el = buildCallMarkerEl(call);
    const square = el.querySelector('[data-role="priority-square"]') as HTMLElement;
    expect(square.style.transform).toBe('');
    expect(square.style.borderRadius).toBe('2px');
  });

  it('renders a call-number label below the priority square', () => {
    const el = buildCallMarkerEl(call);
    const numberLabel = el.querySelector('[data-role="call-number-label"]') as HTMLElement;
    expect(numberLabel.textContent).toBe('CFS-1');
    expect(numberLabel.style.color).toBe(priorityHex(call.priority));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: FAIL — `[data-role="priority-square"]` and `[data-role="call-number-label"]` don't exist yet (current markup has no `data-role` on the diamond and no call-number element at all).

- [ ] **Step 3: Rewrite `buildCallMarkerEl`**

Replace the whole function body (lines 247-285) with:

```ts
/** Build HTML for a call marker element: rounded priority square + call-number label below. */
export function buildCallMarkerEl(call: ActiveCall): HTMLDivElement {
  const color = priorityHex(call.priority);
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-call';
  el.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;`;

  const square = document.createElement('div');
  square.setAttribute('data-role', 'priority-square');
  square.style.cssText = `
    width:22px;height:22px;
    background:${color};border:2px solid ${color};
    border-radius:2px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 0 8px ${withAlpha(color, '99')};
  `;
  const priorityText = document.createElement('span');
  priorityText.style.cssText = `font-size:8px;font-weight:700;color:${CALL_MARKER_INK};font-family:ui-monospace,monospace;`;
  // priorityLabel, not `P${call.priority}` — live rows store 'P1'..'P4', so the
  // hand-built prefix rendered "PP1" on the map.
  priorityText.textContent = priorityLabel(call.priority);
  square.appendChild(priorityText);
  el.appendChild(square);

  const numberLabel = document.createElement('div');
  numberLabel.setAttribute('data-role', 'call-number-label');
  numberLabel.style.cssText = `
    background:#101820;border:1.2px solid ${color};border-radius:2px;
    padding:1px 5px;font-size:8px;font-weight:700;color:${color};
    font-family:ui-monospace,monospace;white-space:nowrap;
  `;
  numberLabel.textContent = call.call_number;
  el.appendChild(numberLabel);

  el.title = `${call.call_number} — ${formatIncidentType(call.incident_type)}`;
  return el;
}
```

This drops the old `rotate(45deg)`/`rotate(-45deg)` counter-rotation entirely (no longer needed without the diamond), and with it the jsdom cssText/border-radius interaction this file's original comment (lines 269-273) worked around — a plain `border-radius:2px` in the same `cssText` string as `background` is fine because there is no `transform` involved.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS — all tests in the file, including the popup test right after this one ("renders the same label in the popup") which reads `buildCallPopupHtml`, not `buildCallMarkerEl`, and is unaffected.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "feat(map): call marker is a rounded square with a call-number label, not a diamond"
```

---

### Task 3: Call-age timer helper + popup header/field-table redesign

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts:288-312` (`buildCallPopupHtml`)
- Test: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`

**Interfaces:**
- Consumes: `ActiveCall.created_at` (already on the type, per `mapConstants.ts:55`), `formatEnumValue`, `escapeHtml`, `HAZARD_FLAGS`, `withAlpha` (already imported).
- Produces: a new exported pure helper `formatCallAge(createdAt: string | null | undefined, nowMs: number): string | null` (returns `null` when `createdAt` is missing/unparseable, so callers can omit the timer row instead of showing `NaN`). `buildCallPopupHtml` gains a **third parameter, `nowMs: number`** (required — callers must pass a timestamp explicitly rather than the function calling `Date.now()` itself, so the popup's rendered age is deterministic and testable) **and a fourth, optional parameter, `assignedUnit`** (added in this same task's implementation step, to keep the popup rewrite self-contained rather than editing the same function body twice across two tasks). Task 5 only adds tests verifying the 4th parameter's rendering; Task 7 is the only real caller and passes `Date.now()` at the call site.

- [ ] **Step 1: Write the failing tests**

Add to the test file, in a new `describe` block after the existing `describe('priority label never double-prefixes', ...)` block:

```ts
describe('formatCallAge', () => {
  it('formats an elapsed duration as HH:MM:SS', () => {
    const created = '2026-08-09T12:00:00Z';
    const now = new Date('2026-08-09T12:14:32Z').getTime();
    expect(formatCallAge(created, now)).toBe('00:14:32');
  });

  it('formats durations over an hour with a non-zero hours segment', () => {
    const created = '2026-08-09T10:00:00Z';
    const now = new Date('2026-08-09T12:05:09Z').getTime();
    expect(formatCallAge(created, now)).toBe('02:05:09');
  });

  it('returns null when created_at is missing', () => {
    expect(formatCallAge(null, Date.now())).toBeNull();
    expect(formatCallAge(undefined, Date.now())).toBeNull();
  });

  it('returns null when created_at does not parse', () => {
    expect(formatCallAge('not-a-date', Date.now())).toBeNull();
  });
});

describe('buildCallPopupHtml header + field table', () => {
  const now = new Date('2026-08-09T12:14:32Z').getTime();
  const callWithAge: ActiveCall = { ...call, created_at: '2026-08-09T12:00:00Z' };

  it('shows the call-age timer under the call number when created_at is present', () => {
    const html = buildCallPopupHtml(callWithAge, false, now);
    expect(html).toContain('00:14:32');
    expect(html).toContain('open');
  });

  it('omits the timer line when created_at is missing', () => {
    const html = buildCallPopupHtml({ ...call, created_at: null }, false, now);
    expect(html).not.toContain('open');
  });

  it('shows STATUS, BEAT, ADDRESS, and UNIT rows in a labeled field table', () => {
    const html = buildCallPopupHtml({ ...callWithAge, beat_name: 'A-2' }, false, now);
    expect(html).toContain('STATUS');
    expect(html).toContain('BEAT');
    expect(html).toContain('ADDRESS');
    expect(html).toContain('UNIT');
    expect(html).toContain('A-2');
  });

  it('shows an em-dash placeholder for UNIT when no unit is assigned', () => {
    const html = buildCallPopupHtml(callWithAge, false, now);
    expect(html).toContain('unassigned');
  });
});
```

Add the new import at the top of the test file:

```ts
import { buildUnitMarkerEl, applyUnitMarkerState, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml, shouldAnimateMarkerMove, computeAccuracyRingGeometry, CALL_MARKER_INK, formatCallAge } from '../mapMarkers';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: FAIL — `formatCallAge` doesn't exist (TS/import error), and `buildCallPopupHtml` doesn't accept a third argument or produce the new header/table markup.

- [ ] **Step 3: Add `formatCallAge` and rewrite `buildCallPopupHtml`**

Add this new exported function right above `buildCallPopupHtml` in `mapMarkers.ts`:

```ts
/**
 * Elapsed time since `createdAt`, as `HH:MM:SS` (hours segment grows past
 * 99 rather than rolling over — a call open for 100+ hours is a data
 * problem worth seeing, not something to hide by wrapping the display).
 * Returns null when createdAt is missing or unparseable so callers can
 * omit the timer row entirely instead of rendering "NaN:NaN:NaN".
 */
export function formatCallAge(createdAt: string | null | undefined, nowMs: number): string | null {
  if (!createdAt) return null;
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return null;
  const elapsedSec = Math.max(0, Math.floor((nowMs - createdMs) / 1000));
  const hh = Math.floor(elapsedSec / 3600);
  const mm = Math.floor((elapsedSec % 3600) / 60);
  const ss = elapsedSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
```

Replace the entire `buildCallPopupHtml` function (lines 288-312) with:

```ts
/** Build HTML popup for a call: priority-colored header + call-age timer + labeled field table. */
export function buildCallPopupHtml(
  call: ActiveCall,
  queued: boolean = false,
  nowMs: number,
  assignedUnit?: { callSign: string; etaLabel?: string; distanceLabel?: string } | null,
): string {
  const color = priorityHex(call.priority);
  const age = formatCallAge(call.created_at, nowMs);
  const flags = HAZARD_FLAGS
    .filter(f => (call as any)[f.key])
    .map(f => `<span style="background:${withAlpha(f.color, '22')};color:${f.color};padding:1px 4px;border-radius:2px;font-size:8px;font-weight:700;margin-right:3px;">${f.label}</span>`)
    .join('');
  const hasCoords = call.latitude != null && call.longitude != null;
  const addToRouteBtn = hasCoords
    ? queued
      ? `<button disabled style="width:100%;font:10px monospace;font-weight:700;color:#666;background:transparent;border:none;border-top:1px solid ${TACTICAL_BORDER};padding:8px 6px;cursor:default;">✓ ON ROUTE</button>`
      : `<button data-action="add-to-route" data-call-number="${escapeHtml(call.call_number)}" style="width:100%;font:10px monospace;font-weight:700;color:#8b5cf6;background:transparent;border:none;border-top:1px solid ${TACTICAL_BORDER};padding:8px 6px;cursor:pointer;">+ ADD TO ROUTE</button>`
    : '';

  const fieldRows: Array<[string, string]> = [
    ['STATUS', escapeHtml(formatEnumValue(call.status)).toUpperCase()],
  ];
  if (call.beat_name) fieldRows.push(['BEAT', escapeHtml(call.beat_name)]);
  if (call.cross_street) fieldRows.push(['CROSS', escapeHtml(call.cross_street)]);
  fieldRows.push(['ADDRESS', escapeHtml(call.location_address)]);
  fieldRows.push(['UNIT', assignedUnit ? escapeHtml(assignedUnit.callSign) : '— unassigned —']);
  if (assignedUnit?.etaLabel) fieldRows.push(['ETA', escapeHtml(assignedUnit.etaLabel)]);
  if (assignedUnit?.distanceLabel) fieldRows.push(['DISTANCE', escapeHtml(assignedUnit.distanceLabel)]);

  const rowsHtml = fieldRows
    .map(([label, value]) => `
      <tr><td style="color:${TACTICAL_TEXT_MUTED};padding:2px 0;width:70px;vertical-align:top;">${label}</td><td style="color:${TACTICAL_TEXT_PRIMARY};">${value}</td></tr>`)
    .join('');

  return `
    <div style="background:${TACTICAL_SURFACE_RAISED};color:${TACTICAL_TEXT_PRIMARY};border:1px solid ${TACTICAL_BORDER};border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:200px;overflow:hidden;">
      <div style="background:${color};padding:6px 10px;display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font:800 12px monospace;color:${CALL_MARKER_INK};">${escapeHtml(call.call_number)}</div>
          ${age ? `<div style="font:700 10px monospace;color:${CALL_MARKER_INK};opacity:.75;margin-top:1px;">⏱ ${age} open</div>` : ''}
        </div>
        <span style="font:800 11px monospace;color:${CALL_MARKER_INK};background:rgba(0,0,0,.2);padding:1px 6px;border-radius:2px;">${escapeHtml(priorityLabel(call.priority))}</span>
      </div>
      <div style="padding:8px 10px 0;">
        <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(formatIncidentType(call.incident_type))}</div>
        <table style="width:100%;font:11px monospace;border-collapse:collapse;">${rowsHtml}</table>
        ${flags ? `<div style="margin-top:6px;">${flags}</div>` : ''}
      </div>
      ${addToRouteBtn}
    </div>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS. Note the earlier "PP1 regression" test `it('renders the same label in the popup', ...)` and the "builds call popup HTML containing the call number" test call `buildCallPopupHtml` with only 1-2 args — since `nowMs` is now a required third parameter, update both call sites in the test file to pass a timestamp, e.g. `buildCallPopupHtml(call, false, Date.now())`. Do this as part of this step, re-running until green.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "feat(map): call popup gets a priority-colored header, call-age timer, and labeled field table"
```

---

### Task 4: En-route tag formatting helpers + DOM builder

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts` (new exports, and extend `buildUnitMarkerEl`/`applyUnitMarkerState`)
- Test: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `formatEtaSeconds(seconds: number): string` → `mm:ss`; `formatDistanceMiles(miles: number): string` → `"##.# mi"` (one decimal); `buildUnitMarkerEl` and `applyUnitMarkerState` each gain an **optional second parameter**, `enRoute?: { etaSeconds: number; distanceMiles: number } | null`. Task 6/7 supply this from the new hook; when omitted or the unit's status isn't `enroute`, no tag is rendered (existing callers with one argument keep working unchanged).

- [ ] **Step 1: Write the failing tests**

Add to the test file:

```ts
describe('formatEtaSeconds / formatDistanceMiles', () => {
  it('formats seconds as mm:ss, zero-padded', () => {
    expect(formatEtaSeconds(192)).toBe('03:12');
    expect(formatEtaSeconds(5)).toBe('00:05');
    expect(formatEtaSeconds(0)).toBe('00:00');
  });

  it('formats miles to one decimal place', () => {
    expect(formatDistanceMiles(1.44)).toBe('1.4 mi');
    expect(formatDistanceMiles(0)).toBe('0.0 mi');
    expect(formatDistanceMiles(12.98)).toBe('13.0 mi');
  });
});

describe('en-route tag on the unit marker', () => {
  const enrouteUnit: MapUnit = { ...unit, status: 'enroute' } as MapUnit;

  it('does not render an en-route tag when enRoute data is omitted', () => {
    const el = buildUnitMarkerEl(enrouteUnit);
    expect(el.querySelector('[data-role="enroute-tag"]')).toBeNull();
  });

  it('renders unit call sign, ENROUTE, ETA, and DIS when enRoute data is provided', () => {
    const el = buildUnitMarkerEl(enrouteUnit, { etaSeconds: 192, distanceMiles: 1.44 });
    const tag = el.querySelector('[data-role="enroute-tag"]') as HTMLElement;
    expect(tag).toBeTruthy();
    expect(tag.textContent).toContain('A12');
    expect(tag.textContent).toContain('ENROUTE');
    expect(tag.textContent).toContain('ETA 03:12');
    expect(tag.textContent).toContain('DIS 1.4 mi');
  });

  it('applyUnitMarkerState adds/removes the tag as enRoute data comes and goes', () => {
    const el = buildUnitMarkerEl(enrouteUnit);
    expect(el.querySelector('[data-role="enroute-tag"]')).toBeNull();

    applyUnitMarkerState(el, enrouteUnit, { etaSeconds: 60, distanceMiles: 0.5 });
    expect(el.querySelector('[data-role="enroute-tag"]')).toBeTruthy();

    applyUnitMarkerState(el, enrouteUnit, null);
    expect(el.querySelector('[data-role="enroute-tag"]')).toBeNull();
  });
});
```

Add the two new function names to the existing import line for `mapMarkers`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: FAIL — `formatEtaSeconds`/`formatDistanceMiles` don't exist; `buildUnitMarkerEl`/`applyUnitMarkerState` don't accept a second argument or render a tag.

- [ ] **Step 3: Add the formatting helpers and the tag builder**

Add near the top of `mapMarkers.ts` (after `shouldAnimateMarkerMove`):

```ts
/** `mm:ss`, zero-padded. Minutes are not capped at 59 — a >59min ETA is real data, not an overflow to hide. */
export function formatEtaSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(clamped / 60);
  const ss = clamped % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** One decimal place, always shown (e.g. "0.0 mi", never "0 mi"). */
export function formatDistanceMiles(miles: number): string {
  return `${miles.toFixed(1)} mi`;
}

export interface EnRouteEta {
  etaSeconds: number;
  distanceMiles: number;
}

function buildEnRouteTagEl(callSign: string, enRoute: EnRouteEta): HTMLDivElement {
  const tag = document.createElement('div');
  tag.setAttribute('data-role', 'enroute-tag');
  tag.style.cssText = `
    background:#000;border:1px solid #1d4ed8;border-radius:2px;
    padding:3px 6px;display:grid;grid-template-columns:auto auto;gap:0 8px;
    font-family:ui-monospace,monospace;white-space:nowrap;
  `;
  const rows: Array<[string, string]> = [
    [callSign.slice(0, 6), 'ENROUTE'],
    [`ETA ${formatEtaSeconds(enRoute.etaSeconds)}`, `DIS ${formatDistanceMiles(enRoute.distanceMiles)}`],
  ];
  for (const [left, right] of rows) {
    const leftEl = document.createElement('span');
    leftEl.style.cssText = 'font-size:9px;font-weight:800;color:#e8f0ff;';
    leftEl.textContent = left;
    const rightEl = document.createElement('span');
    rightEl.style.cssText = 'font-size:9px;font-weight:700;color:#93c5fd;';
    rightEl.textContent = right;
    tag.appendChild(leftEl);
    tag.appendChild(rightEl);
  }
  return tag;
}
```

Then update `buildUnitMarkerEl`'s signature and add the tag at the end of the function body (before `return el;`):

```ts
export function buildUnitMarkerEl(unit: Unit, enRoute?: EnRouteEta | null): HTMLDivElement {
```

```ts
  if (unit.status === 'enroute' && enRoute) {
    inner.appendChild(buildEnRouteTagEl(unit.call_sign, enRoute));
  }

  return el;
```

And update `applyUnitMarkerState`'s signature, adding tag add/remove/update logic at the end (before the closing `}`):

```ts
export function applyUnitMarkerState(el: HTMLElement, unit: Unit, enRoute?: EnRouteEta | null): void {
```

```ts
  const inner = el.querySelector<HTMLElement>('[data-role="marker-inner"]') || el;
  const existingTag = el.querySelector('[data-role="enroute-tag"]');
  if (unit.status === 'enroute' && enRoute) {
    if (existingTag) existingTag.remove();
    inner.appendChild(buildEnRouteTagEl(unit.call_sign, enRoute));
  } else if (existingTag) {
    existingTag.remove();
  }
}
```

(Note: `applyUnitMarkerState` already declares a local `const inner = ...` near its top for opacity — reuse that existing binding rather than redeclaring it; place the tag logic at the very end of the function using the same variable.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS — all tests in the file, including Task 1's tests (the second parameter is optional, so `buildUnitMarkerEl(unit)` single-argument calls from Task 1's tests are unaffected).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "feat(map): en-route unit marker shows a compact ETA/distance tag"
```

---

### Task 5: Wire ETA/DISTANCE into the popup's assigned-unit row

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts` (already-updated `buildCallPopupHtml` from Task 3 — this task only adds tests, since the `assignedUnit` parameter and its `etaLabel`/`distanceLabel` fields were already implemented in Task 3's rewrite to keep that task's diff self-contained)
- Test: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`

**Interfaces:**
- Consumes: `buildCallPopupHtml`'s 4th parameter `assignedUnit?: { callSign: string; etaLabel?: string; distanceLabel?: string } | null` (added in Task 3).
- Produces: nothing new — this task is verification-only that the popup's ETA/DISTANCE rows render with values matching `formatEtaSeconds`/`formatDistanceMiles` from Task 4, since Task 7 is what actually computes and passes them.

- [ ] **Step 1: Write the failing test**

Add to the test file:

```ts
describe('buildCallPopupHtml assigned-unit ETA/distance rows', () => {
  const now = new Date('2026-08-09T12:14:32Z').getTime();

  it('shows ETA and DISTANCE rows when an assigned unit with en-route data is passed', () => {
    const html = buildCallPopupHtml(call, false, now, {
      callSign: 'D190',
      etaLabel: formatEtaSeconds(192),
      distanceLabel: formatDistanceMiles(1.44),
    });
    expect(html).toContain('D190');
    expect(html).toContain('ETA');
    expect(html).toContain('03:12');
    expect(html).toContain('DISTANCE');
    expect(html).toContain('1.4 mi');
  });

  it('omits ETA/DISTANCE rows when no assigned unit is passed', () => {
    const html = buildCallPopupHtml(call, false, now);
    expect(html).not.toContain('DISTANCE');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS immediately if Task 3 was implemented exactly as written (its `buildCallPopupHtml` already accepts and renders `assignedUnit`). If it fails, that means Task 3's `fieldRows` logic for `assignedUnit` was skipped or altered — go back and re-apply Task 3 Step 3's `buildCallPopupHtml` body exactly before proceeding.

- [ ] **Step 3: (No implementation step — Task 3 already covers it.) Confirm green.**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "test(map): verify call popup ETA/distance rows render from assignedUnit data"
```

---

### Task 6: `useEnRouteEta` polling hook

**Files:**
- Create: `client/src/pages/map/hooks/useEnRouteEta.ts`
- Test: `client/src/pages/map/hooks/__tests__/useEnRouteEta.test.ts`

**Interfaces:**
- Consumes: `fetchMapboxRoute(origin: CoordinatePair, destination: CoordinatePair): Promise<MapboxRouteSummary | null>` from `client/src/utils/mapboxRouting.ts` (existing; confirm its `MapboxRouteSummary` shape includes a duration-in-seconds and distance field before writing Step 3 — read `client/src/utils/mapboxRouting.ts:6-13` first). `MapUnit`/`ActiveCall` from `../utils/mapConstants`.
- Produces: `useEnRouteEta(units: MapUnit[], calls: ActiveCall[]): Record<string, EnRouteEta>` (import `EnRouteEta` from `../utils/mapMarkers`, added in Task 4), keyed by **call_number** (matching the existing `unit.call_number === call.call_number` join pattern already used in `MapboxMapPage.tsx`). Only computes entries for units where `status === 'enroute'` and both the unit's and the matched call's coordinates are present. Task 7 is the sole consumer.

- [ ] **Step 1: Read the routing client's return shape**

Run: `sed -n '1,20p' client/src/utils/mapboxRouting.ts`
Confirm the exact field names on `MapboxRouteSummary` (e.g. `durationSeconds`/`distanceMiles`, or similarly named) before writing Step 3 — the plan's example below assumes `durationSeconds: number` and `distanceMeters: number` per the interface declared at lines 6-13; if the real field names differ, use the real ones and convert meters→miles with `distanceMeters / 1609.34`.

- [ ] **Step 2: Write the failing test**

Create `client/src/pages/map/hooks/__tests__/useEnRouteEta.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEnRouteEta } from '../useEnRouteEta';
import type { MapUnit, ActiveCall } from '../../utils/mapConstants';

vi.mock('../../../../utils/mapboxRouting', () => ({
  fetchMapboxRoute: vi.fn(),
}));
import { fetchMapboxRoute } from '../../../../utils/mapboxRouting';

const enrouteUnit: MapUnit = {
  id: 'u1', call_sign: 'D190', officer_name: '', status: 'enroute',
  vehicle: '', current_call_type: null, current_call_location: null, call_number: 'CFS-1',
  latitude: 40.7, longitude: -111.9,
} as MapUnit;

const availableUnit: MapUnit = {
  ...enrouteUnit, id: 'u2', status: 'available', call_number: null,
} as MapUnit;

const call: ActiveCall = {
  id: 'c1', call_number: 'CFS-1', incident_type: 'welfare_check', priority: 'P1',
  status: 'dispatched', location_address: '123 Main St', latitude: 40.76, longitude: -111.89,
} as ActiveCall;

beforeEach(() => {
  vi.mocked(fetchMapboxRoute).mockReset();
});

describe('useEnRouteEta', () => {
  it('fetches a route for an en-route unit matched to its call, and returns eta/distance keyed by call_number', async () => {
    vi.mocked(fetchMapboxRoute).mockResolvedValue({ durationSeconds: 192, distanceMeters: 2317 } as any);

    const { result } = renderHook(() => useEnRouteEta([enrouteUnit], [call]));

    await waitFor(() => {
      expect(result.current['CFS-1']).toBeDefined();
    });

    expect(result.current['CFS-1'].etaSeconds).toBe(192);
    expect(result.current['CFS-1'].distanceMiles).toBeCloseTo(1.44, 1);
    expect(fetchMapboxRoute).toHaveBeenCalledWith(
      { lng: -111.9, lat: 40.7 },
      { lng: -111.89, lat: 40.76 },
    );
  });

  it('does not fetch a route for a unit that is not en route', async () => {
    renderHook(() => useEnRouteEta([availableUnit], [call]));
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMapboxRoute).not.toHaveBeenCalled();
  });

  it('returns an empty object when no units are en route', () => {
    const { result } = renderHook(() => useEnRouteEta([availableUnit], [call]));
    expect(result.current).toEqual({});
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/hooks/__tests__/useEnRouteEta.test.ts`
Expected: FAIL — `../useEnRouteEta` module does not exist yet.

- [ ] **Step 4: Implement the hook**

Create `client/src/pages/map/hooks/useEnRouteEta.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import type { MapUnit, ActiveCall } from '../utils/mapConstants';
import type { EnRouteEta } from '../utils/mapMarkers';
import { fetchMapboxRoute } from '../../../utils/mapboxRouting';

const METERS_PER_MILE = 1609.34;
// Refetch cadence: real drive time doesn't change meaningfully faster than
// this, and it keeps a busy dispatch board well under Mapbox's Directions
// rate limits even with a dozen units en route simultaneously.
const REFRESH_MS = 30_000;

/**
 * ETA/distance for every currently en-route unit, keyed by the call_number
 * of the call it's matched to (mirrors the `unit.call_number === call.call_number`
 * join already used elsewhere in MapboxMapPage.tsx — units carry no
 * dedicated foreign key to a call row on the map's client-side shape).
 * Returns real routed duration/distance from Mapbox Directions, not a
 * straight-line estimate, refreshed on a fixed interval rather than on
 * every GPS poll tick.
 */
export function useEnRouteEta(units: MapUnit[], calls: ActiveCall[]): Record<string, EnRouteEta> {
  const [etas, setEtas] = useState<Record<string, EnRouteEta>>({});
  const unitsRef = useRef(units);
  const callsRef = useRef(calls);
  unitsRef.current = units;
  callsRef.current = calls;

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const currentUnits = unitsRef.current;
      const currentCalls = callsRef.current;
      const pairs = currentUnits
        .filter((u) => u.status === 'enroute' && u.call_number && u.latitude != null && u.longitude != null)
        .map((u) => ({ unit: u, call: currentCalls.find((c) => c.call_number === u.call_number) }))
        .filter((p): p is { unit: MapUnit; call: ActiveCall } =>
          p.call != null && p.call.latitude != null && p.call.longitude != null);

      if (pairs.length === 0) {
        if (!cancelled) setEtas({});
        return;
      }

      const results = await Promise.all(pairs.map(async ({ unit, call }) => {
        const route = await fetchMapboxRoute(
          { lng: unit.longitude as number, lat: unit.latitude as number },
          { lng: call.longitude as number, lat: call.latitude as number },
        );
        if (!route) return null;
        return {
          callNumber: call.call_number,
          eta: { etaSeconds: route.durationSeconds, distanceMiles: route.distanceMeters / METERS_PER_MILE },
        };
      }));

      if (cancelled) return;
      const next: Record<string, EnRouteEta> = {};
      for (const r of results) {
        if (r) next[r.callNumber] = r.eta;
      }
      setEtas(next);
    };

    tick();
    const interval = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
    // Re-running this effect only on mount + interval (not on every `units`/
    // `calls` change) is intentional: those arrays get a new reference on
    // every poll, and refetching Directions on every poll tick is exactly
    // the abuse pattern this hook exists to avoid. unitsRef/callsRef give
    // the interval's closure access to current data without that dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return etas;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/hooks/__tests__/useEnRouteEta.test.ts`
Expected: PASS. If the field names checked in Step 1 differ from `durationSeconds`/`distanceMeters`, adjust both the implementation and the test's mock return value to match the real `MapboxRouteSummary` shape before this passes.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/hooks/useEnRouteEta.ts client/src/pages/map/hooks/__tests__/useEnRouteEta.test.ts
git commit -m "feat(map): add useEnRouteEta hook — polls Mapbox Directions for en-route units"
```

---

### Task 7: Wire `useEnRouteEta` into `MapboxMapPage.tsx`

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (unit marker effect around lines 964-972, call marker/popup effect around lines 1020-1041)

**Interfaces:**
- Consumes: `useEnRouteEta` (Task 6), updated `buildUnitMarkerEl`/`applyUnitMarkerState`/`buildCallPopupHtml` signatures (Tasks 3–5).
- Produces: nothing new — this is the final wiring task; no later task depends on it.

This task has no isolated unit test of its own (it's glue code inside an existing component that already has integration/manual test coverage via the live map); verify it by running the full client suite plus a manual smoke check.

- [ ] **Step 1: Import the hook and call it**

In `client/src/pages/map/MapboxMapPage.tsx`, add the import near the other `./hooks`/`./utils` imports:

```ts
import { useEnRouteEta } from './hooks/useEnRouteEta';
```

Inside the component body, near where `units` and `calls` state/props are already available (before the unit-marker `useEffect` at line ~964), add:

```ts
  const enRouteEtas = useEnRouteEta(units, calls);
```

- [ ] **Step 2: Pass en-route data into the unit marker effect**

In the unit-marker effect (the `existing`/`else` branch around lines 962-972), change:

```ts
        applyUnitMarkerState(existing.getElement(), unit);
```
to:
```ts
        applyUnitMarkerState(existing.getElement(), unit, unit.call_number ? enRouteEtas[unit.call_number] : null);
```

and:
```ts
        const el = buildUnitMarkerEl(unit);
```
to:
```ts
        const el = buildUnitMarkerEl(unit, unit.call_number ? enRouteEtas[unit.call_number] : null);
```

Add `enRouteEtas` to that effect's dependency array (currently `[units, mapLoaded]` → `[units, mapLoaded, enRouteEtas]`), so a fresh ETA re-renders the existing markers, not just newly-created ones.

- [ ] **Step 3: Pass the assigned-unit ETA/distance into the call popup**

In the call-marker effect, `buildCallPopupHtml` is called in two places (existing-marker refresh and new-marker creation, around lines 1029 and 1033). For each, resolve the assigned unit and pass it as the 4th argument:

```ts
      const assignedUnit = units.find((u) => u.call_number === call.call_number && u.status === 'enroute');
      const assignedUnitInfo = assignedUnit
        ? {
            callSign: assignedUnit.call_sign,
            etaLabel: enRouteEtas[call.call_number] ? formatEtaSeconds(enRouteEtas[call.call_number].etaSeconds) : undefined,
            distanceLabel: enRouteEtas[call.call_number] ? formatDistanceMiles(enRouteEtas[call.call_number].distanceMiles) : undefined,
          }
        : null;
```

placed once per loop iteration (right after `const isQueued = ...` at line 1023), then update both call sites:

```ts
        if (popup) popup.setHTML(buildCallPopupHtml(call, isQueued, Date.now(), assignedUnitInfo));
```
```ts
          .setHTML(buildCallPopupHtml(call, isQueued, Date.now(), assignedUnitInfo));
```

Add `formatEtaSeconds` and `formatDistanceMiles` to the existing `./utils/mapMarkers` import at the top of the file, and add `enRouteEtas` to this effect's dependency array.

- [ ] **Step 4: Run the full client suite and typecheck**

Run: `cd client && npx vitest run`
Expected: all tests pass (no test in this file changed, but confirm no regression).

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire useEnRouteEta into unit marker and call popup rendering"
```

---

## Final verification (after all 7 tasks)

- [ ] Run `cd client && npx vitest run` — full client suite green.
- [ ] Run `cd client && npx tsc --noEmit` — clean.
- [ ] Run `npx vitest run` from the repo root — worker suite unaffected (this plan touches no `/src` files), confirms nothing else regressed.
- [ ] Manual smoke check in the live browser preview: open the Map page, confirm a unit renders as an arrow (not a circle), a call renders as a rounded square with its CFS number below, the popup shows the priority-colored header with a running call-age timer, and (if a unit can be put into `enroute` status in the current environment) the en-route tag and popup ETA/DISTANCE rows appear and update.
