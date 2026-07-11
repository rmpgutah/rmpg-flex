# Lane Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lane-level guidance (lane arrows, valid/invalid lane state) to the existing turn-by-turn banner on `NavigationPage.tsx`, using Mapbox Directions v5 lane data the app already fetches but currently discards.

**Architecture:** Extend the existing `RouteStep` type with an optional `lanes` field, parse it out of the Directions response's `intersections[0].lanes` inside the existing step-mapping code in `useNavGuidanceEngine.ts`, and render it as a new prop on the existing `HudNextManeuver` presentational component. No new API calls, no new files beyond tests — this is additive parsing + rendering on data already in hand.

**Tech Stack:** React, TypeScript, Vitest + @testing-library/react, Mapbox Directions API v5 (data already fetched, not modified).

**Spec:** `docs/superpowers/specs/2026-07-04-lane-guidance-design.md`

---

## Task 1: Extend `RouteStep` with lane data

**Files:**
- Modify: `client/src/hooks/useMapRouting.ts` (around line 34, the `RouteStep` interface)

- [ ] **Step 1: Read the current `RouteStep` interface to confirm the exact insertion point**

Run: `grep -n "export interface RouteStep" client/src/hooks/useMapRouting.ts`

- [ ] **Step 2: Add the new type and field**

In `client/src/hooks/useMapRouting.ts`, immediately after the existing `RouteStep` interface, add a new exported interface, and add a `lanes` field to `RouteStep`:

```ts
export interface RouteStep {
  /** Human-readable instruction, e.g. "Turn left onto S Main St". */
  instruction: string;
  /** Distance covered by this step, in meters. */
  distanceMeters: number;
  /** Formatted distance, e.g. "0.3 mi" or "400 ft". */
  distanceText: string;
  /** Mapbox maneuver type: depart | turn | merge | arrive | … */
  maneuverType: string;
  /** Mapbox maneuver modifier: left | right | straight | … (optional). */
  modifier?: string;
  /**
   * Lane guidance for this step's upcoming maneuver, if Mapbox provided it
   * (only present at multi-lane decision points — absent on most steps).
   */
  lanes?: RouteStepLane[];
}

/** One lane's guidance state at a maneuver. */
export interface RouteStepLane {
  /** Whether this lane can be used to complete the upcoming maneuver. */
  valid: boolean;
  /** Mapbox's recommended lane, when provided. */
  active: boolean;
  /** Directions this lane permits, e.g. ["straight", "left"]. */
  indications: string[];
}
```

(Keep the existing `RouteStep` fields exactly as they are — only add the new `lanes?` field and the new `RouteStepLane` interface below it.)

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (this is a pure additive type change — nothing consumes `lanes` yet, so no existing code should break)

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMapRouting.ts
git commit -m "feat(nav): add RouteStepLane type and RouteStep.lanes field"
```

---

## Task 2: Parse lane data in `useNavGuidanceEngine`

**Files:**
- Modify: `client/src/hooks/useNavGuidanceEngine.ts` (the step-mapping code, around line 196-206)
- Test: `client/src/hooks/__tests__/useNavGuidanceEngine.test.ts` (existing file — add tests, don't replace)

- [ ] **Step 1: Read the current step-mapping code and the existing test file's fixture pattern**

Run:
```bash
grep -n "const steps: RouteStep\[\]" client/src/hooks/useNavGuidanceEngine.ts
sed -n '1,40p' client/src/hooks/__tests__/useNavGuidanceEngine.test.ts
```
Confirm the existing `directionsResponse()` fixture function and mocked-`fetch` pattern used by the existing tests — you'll extend that same fixture, not build a new one.

- [ ] **Step 2: Write the failing test**

Add this test to `client/src/hooks/__tests__/useNavGuidanceEngine.test.ts`, inside the existing `describe('useNavGuidanceEngine', ...)` block. It needs its own fixture function (a copy of `directionsResponse()` with lane data added to one step), since the shared fixture is used by other tests and shouldn't change shape for all of them:

```ts
function directionsResponseWithLanes() {
  return {
    routes: [{
      duration: 300,
      distance: 2224,
      geometry: { type: 'LineString', coordinates: COORDS },
      legs: [{
        annotation: { congestion: ['low', 'moderate', 'heavy'] },
        steps: [
          {
            maneuver: { instruction: 'Turn left onto S Main St', type: 'turn', modifier: 'left' },
            distance: 1112,
            intersections: [{
              lanes: [
                { valid: true, active: false, indications: ['left'] },
                { valid: true, active: true, indications: ['straight'] },
                { valid: false, active: false, indications: ['right'] },
              ],
            }],
          },
          { maneuver: { instruction: 'Arrive', type: 'arrive' }, distance: 1112 },
        ],
      }],
    }],
  };
}

it('parses lane guidance from intersections[0].lanes when present, and leaves it undefined when absent', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => directionsResponseWithLanes(),
  }) as any;

  const { result } = renderHook(() => useNavGuidanceEngine());
  await act(async () => {
    await result.current.startGuidance('NAV', 'dest', 40.760, -111.891, 40.780, -111.891);
  });

  const steps = result.current.activeRoute?.steps;
  expect(steps).toHaveLength(2);

  // First step has lane data.
  expect(steps![0].lanes).toEqual([
    { valid: true, active: false, indications: ['left'] },
    { valid: true, active: true, indications: ['straight'] },
    { valid: false, active: false, indications: ['right'] },
  ]);

  // Second step (arrive) has no intersections/lanes in the fixture — must be undefined, not [].
  expect(steps![1].lanes).toBeUndefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useNavGuidanceEngine.test.ts`
Expected: FAIL — `steps![0].lanes` is `undefined` (the step-mapper doesn't read `intersections` yet)

- [ ] **Step 4: Implement the parsing**

In `client/src/hooks/useNavGuidanceEngine.ts`, find the existing step-mapping code (search for `const steps: RouteStep[] = ((route.legs?.[0]?.steps ?? []) as any[]).map`) and replace it with:

```ts
const steps: RouteStep[] = ((route.legs?.[0]?.steps ?? []) as any[]).map((s) => {
  const man = s.maneuver || {};
  const meters = typeof s.distance === 'number' ? s.distance : 0;
  const rawLanes = s.intersections?.[0]?.lanes as
    { valid?: boolean; active?: boolean; indications?: string[] }[] | undefined;
  return {
    instruction: man.instruction || s.name || 'Continue',
    distanceMeters: Math.round(meters),
    distanceText: fmtStepDist(meters),
    maneuverType: man.type || '',
    modifier: man.modifier,
    lanes: rawLanes?.map((l) => ({
      valid: l.valid === true,
      active: l.active === true,
      indications: Array.isArray(l.indications) ? l.indications : [],
    })),
  };
});
```

(This is a full replacement of the existing `.map()` callback body — keep everything else in the surrounding function unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useNavGuidanceEngine.test.ts`
Expected: PASS (all tests in the file, including the new one and the pre-existing ones — confirm you didn't break the existing tests)

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/useNavGuidanceEngine.ts client/src/hooks/__tests__/useNavGuidanceEngine.test.ts
git commit -m "feat(nav): parse lane guidance from Directions intersections[0].lanes"
```

---

## Task 3: Render lane guidance in `HudNextManeuver`

**Files:**
- Modify: `client/src/pages/navigation/hud/HudInstruments.tsx` (the `HudNextManeuver` component, around line 295-323)
- Test: Create `client/src/pages/navigation/hud/__tests__/HudInstruments.test.tsx`

**Important convention note:** this file's header comment states it "defines its own props/types and does NOT import from other lanes' new files." Do **not** import `RouteStepLane` from `client/src/hooks/useMapRouting.ts` here — define a local, structurally-identical type instead, matching the existing pattern in this file.

- [ ] **Step 1: Read the current `HudNextManeuver` component**

Run: `sed -n '294,323p' client/src/pages/navigation/hud/HudInstruments.tsx`

- [ ] **Step 2: Write the failing tests**

Create `client/src/pages/navigation/hud/__tests__/HudInstruments.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudNextManeuver } from '../HudInstruments';

const baseProps = {
  maneuverType: 'turn',
  modifier: 'left',
  instruction: 'Turn left onto S Main St',
  distanceToTurnMeters: 200,
  stepDistanceMeters: 1112,
};

describe('HudNextManeuver', () => {
  it('does not render a lane strip when lanes is undefined', () => {
    render(<HudNextManeuver {...baseProps} />);
    expect(screen.queryByTestId('lane-strip')).not.toBeInTheDocument();
  });

  it('does not render a lane strip when lanes is an empty array', () => {
    render(<HudNextManeuver {...baseProps} lanes={[]} />);
    expect(screen.queryByTestId('lane-strip')).not.toBeInTheDocument();
  });

  it('renders one lane icon per lane, with valid/invalid styling distinguishable', () => {
    render(
      <HudNextManeuver
        {...baseProps}
        lanes={[
          { valid: true, active: false, indications: ['left'] },
          { valid: true, active: true, indications: ['straight'] },
          { valid: false, active: false, indications: ['right'] },
        ]}
      />
    );
    const strip = screen.getByTestId('lane-strip');
    const lanes = screen.getAllByTestId('lane-icon');
    expect(lanes).toHaveLength(3);
    expect(strip).toBeInTheDocument();
    // Valid lanes carry a different data attribute than invalid ones.
    expect(lanes[0]).toHaveAttribute('data-lane-valid', 'true');
    expect(lanes[1]).toHaveAttribute('data-lane-valid', 'true');
    expect(lanes[2]).toHaveAttribute('data-lane-valid', 'false');
    // The Mapbox-recommended ("active") lane is flagged distinctly from a merely-valid one.
    expect(lanes[0]).toHaveAttribute('data-lane-active', 'false');
    expect(lanes[1]).toHaveAttribute('data-lane-active', 'true');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/navigation/hud/__tests__/HudInstruments.test.tsx`
Expected: FAIL — `HudNextManeuver` doesn't accept a `lanes` prop yet, so `lane-strip`/`lane-icon` test ids never render

- [ ] **Step 4: Implement the lane strip**

Replace the existing `HudNextManeuver` function in `client/src/pages/navigation/hud/HudInstruments.tsx` (lines ~295-323) with:

```tsx
/** One lane's guidance state at a maneuver — mirrors RouteStepLane's shape (this
 *  file intentionally defines its own types rather than importing from
 *  useMapRouting.ts, per this lane's "no cross-lane imports" convention). */
interface HudLane {
  valid: boolean;
  active: boolean;
  indications: string[];
}

// ── #41/#42 — next-maneuver mini-icon + progress micro-bar ───────────────────────
export function HudNextManeuver({
  maneuverType, modifier, instruction, distanceToTurnMeters, stepDistanceMeters, lanes,
}: {
  maneuverType: string | null; modifier?: string; instruction?: string;
  distanceToTurnMeters: number | null; stepDistanceMeters: number | null;
  lanes?: HudLane[];
}) {
  if (!maneuverType) return null;
  const Icon = maneuverIconFor(maneuverType, modifier);
  const dt = distanceToTurnMeters;
  const dText = dt == null ? '' : dt < 160 ? `${Math.round(dt * 3.28084)} ft` : `${(dt / 1609.34).toFixed(1)} mi`;
  // fill grows as we approach (remaining shrinks against the step length)
  const frac = (dt != null && stepDistanceMeters && stepDistanceMeters > 0)
    ? Math.max(0, Math.min(1, 1 - dt / stepDistanceMeters)) : 0;
  return (
    <div className="flex flex-col gap-0.5 px-1.5 py-1 border border-rmpg-800" style={{ borderRadius: 2, background: 'rgba(20,20,20,0.6)' }} title={instruction || 'Next maneuver'}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-4 h-4 text-brand-300 shrink-0" />
        <div className="min-w-0">
          <div className="text-[8px] uppercase tracking-wider text-rmpg-600 leading-none">Next</div>
          <div className="font-mono font-bold text-[12px] text-brand-200 leading-none mt-0.5">{dText || '—'}</div>
        </div>
      </div>
      {/* #42 — distance-to-turn micro-bar */}
      <div className="h-1 bg-rmpg-800 overflow-hidden" style={{ borderRadius: 2 }}>
        <div className="h-full" style={{ width: `${Math.round(frac * 100)}%`, background: '#d4a017', transition: 'width 0.4s ease-out' }} />
      </div>
      {lanes && lanes.length > 0 && (
        <div data-testid="lane-strip" className="flex items-center gap-1 mt-0.5">
          {lanes.map((lane, i) => (
            <ArrowUp
              key={i}
              data-testid="lane-icon"
              data-lane-valid={lane.valid}
              data-lane-active={lane.active}
              className="w-3 h-3"
              style={{
                color: lane.valid ? '#d4a017' : 'var(--rmpg-700)',
                transform: laneRotation(lane.indications),
                ...(lane.active ? { filter: 'drop-shadow(0 0 2px #d4a017)' } : {}),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Rough rotation for a lane's primary indication — good enough for a small icon strip. */
function laneRotation(indications: string[]): string {
  if (indications.includes('left')) return 'rotate(-45deg)';
  if (indications.includes('right')) return 'rotate(45deg)';
  if (indications.includes('slight left')) return 'rotate(-22deg)';
  if (indications.includes('slight right')) return 'rotate(22deg)';
  return 'rotate(0deg)';
}
```

(`ArrowUp` is already imported at the top of this file from `lucide-react` — confirm with `grep -n "ArrowUp" client/src/pages/navigation/hud/HudInstruments.tsx` before assuming; if it's not already imported, add it to the existing `lucide-react` import list at the top of the file.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/navigation/hud/__tests__/HudInstruments.test.tsx`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/navigation/hud/HudInstruments.tsx client/src/pages/navigation/hud/__tests__/HudInstruments.test.tsx
git commit -m "feat(nav): render lane guidance strip in HudNextManeuver"
```

---

## Task 4: Wire lane data through to `HudNextManeuver` in `NavigationPage.tsx`

**Files:**
- Modify: `client/src/pages/NavigationPage.tsx` (the `HudNextManeuver` call site, around line 2578, and the `step` variable it reads `maneuverType`/`modifier`/`instruction` from)

- [ ] **Step 1: Locate the current call site and the `step` variable's origin**

Run:
```bash
grep -n "HudNextManeuver\|const step = \|pickCurrentStep" client/src/pages/NavigationPage.tsx
```
Confirm `step` (used at the `HudNextManeuver` call site) is produced by `pickCurrentStep(...)` (a function already defined in this file, around line 107) operating on the `steps` array from the guidance engine — the same `RouteStep[]` that now carries `lanes` after Task 2. Read `pickCurrentStep`'s signature and return type to confirm it passes through the full step object (including the new `lanes` field) rather than picking out only specific fields.

- [ ] **Step 2: Update the call site**

Find the existing `HudNextManeuver` JSX call (around line 2578):

```tsx
<HudNextManeuver
  maneuverType={step.maneuverType}
  modifier={step.modifier}
  instruction={step.instruction}
  distanceToTurnMeters={distanceToTurnMeters}
  stepDistanceMeters={step.distanceMeters}
/>
```

Add the `lanes` prop:

```tsx
<HudNextManeuver
  maneuverType={step.maneuverType}
  modifier={step.modifier}
  instruction={step.instruction}
  distanceToTurnMeters={distanceToTurnMeters}
  stepDistanceMeters={step.distanceMeters}
  lanes={step.lanes}
/>
```

If `pickCurrentStep`'s return type is narrower than the full `RouteStep` (i.e. it explicitly picks `{ instruction, distanceMeters, distanceText, maneuverType, modifier }` as its own inline type rather than reusing `RouteStep`), widen that inline type to include `lanes?: RouteStepLane[]` (import `RouteStepLane` from `client/src/hooks/useMapRouting.ts` if not already imported in this file) so the field survives the pick.

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Since this wires live data through to a real page, verify in the browser preview:
1. Start the dev server, navigate to `/navigation`.
2. Start guidance to any destination that produces a route with multi-lane intersections (a real Mapbox route through a city street with a turn lane — you may need to try a couple of test destinations to hit one, since lane data isn't present on every step).
3. Confirm the lane strip appears in the next-maneuver HUD tile when approaching a step that has lane data, and does NOT appear on steps without it (no visual regression on the common case).

If you can't get a live route to naturally produce lane data (Mapbox's lane data availability varies by exact street), it's acceptable to confirm via `tsc`/tests alone and note in your report that live lane-data verification wasn't possible — the parsing/rendering logic is already covered by Tasks 2 and 3's unit/component tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/NavigationPage.tsx
git commit -m "feat(nav): wire lane data from route step through to HudNextManeuver"
```

---

## Self-Review Notes

- **Spec coverage:** Covers all 3 changes from the spec (type extension, parsing, rendering) plus the wiring step the spec's "Rendering" section implied but didn't spell out as a separate file change (the `NavigationPage.tsx` call site) — added as Task 4 so the feature is actually reachable, not just built in isolation.
- **Placeholder scan:** No TBD/TODO. Every code step has complete, real code sourced from the actual current file contents read during planning.
- **Type consistency:** `RouteStepLane` (Task 1) → consumed identically in Task 2's parsing and Task 4's wiring. `HudLane` (Task 3) is a deliberately separate, structurally-identical type in `HudInstruments.tsx` per that file's own "no cross-lane imports" convention — not a naming bug, an intentional boundary documented in Task 3's own note.
- **Out-of-scope reminder:** Per the spec, this plan does NOT touch `MdtPage.tsx`, `DispatchPage.tsx`, or extract a shared cross-page widget — those are parts 2 and 3 of the larger navigation program, each needing their own spec once this part ships.
