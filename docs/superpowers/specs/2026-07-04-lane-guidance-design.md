# Lane Guidance (Navigation Gap-Closing, Part 1 of 3)

**Date:** 2026-07-04
**Status:** Approved for planning

## Context

This is part 1 of a 3-part navigation enhancement program, itself a follow-up to
the Map UI redesign (see `docs/superpowers/specs/2026-07-03-map-ui-portal-redesign-design.md`).
Research into the existing navigation system (`NavigationPage.tsx`,
`useNavGuidanceEngine.ts`, `useMapRouting.ts`) found it already has a mature,
traffic-aware turn-by-turn experience (Mapbox Directions API v5, voice guidance,
rerouting on deviation, congestion coloring, hazard scanning). Mapbox's actual
"Navigation SDK" product doesn't exist for web (iOS/Android only), so this app's
hand-built approach is the only viable path — this program closes specific gaps
rather than adopting an SDK.

Three gaps were identified: **lane guidance** (this spec), **MDT/Dispatch nav
widget integration** (part 2), and **officer→dispatch live nav mirroring**
(part 3, requires new server-side sync — biggest piece, out of scope here).
A fourth gap, live incident warnings, was deferred pending a feasibility spike
(unclear whether the account's Mapbox tier exposes incident data at all).

## Goal

Add lane-level guidance (lane arrows, "stay in left lane") to the existing
turn-by-turn banner on `NavigationPage.tsx`, using data Mapbox Directions v5
already returns but the app currently discards.

## Non-goals (this spec)

- MDT (`MdtPage.tsx`) or Dispatch (`DispatchPage.tsx`) integration — parts 2/3.
- Any new API call or routing-engine change — this is pure client-side parsing
  of data already fetched (`steps=true` is already in the existing Directions
  request in `useNavGuidanceEngine.ts`).
- Mobile/iOS lane guidance (out of scope — this is the web `NavigationPage` only).
- Lane data smoothing/interpolation between steps, or any lane-change alerting
  (that's closer to part 3/incident-warnings territory — not this spec).
- Extracting a standalone, cross-page `NextManeuverWidget` component — that
  refactor belongs to part 2, once there's a second consumer (MDT) that
  actually needs the shared component. Building it now, with only one
  consumer, would be premature abstraction.

## Data source

Mapbox Directions v5 nests lane data under each step's **first intersection**,
not top-level on the step itself:

```json
{
  "steps": [{
    "maneuver": { "type": "turn", "modifier": "left", "instruction": "..." },
    "intersections": [{
      "lanes": [
        { "valid": true,  "active": false, "indications": ["left"] },
        { "valid": true,  "active": true,  "indications": ["straight"] },
        { "valid": false, "active": false, "indications": ["right"] }
      ]
    }]
  }]
}
```

`valid` = this lane can be used for the upcoming maneuver. `active` = Mapbox's
recommended lane (present on some responses, not guaranteed). `indications` =
array of directions this lane permits (a lane can permit more than one, e.g.
`["straight", "right"]`). Many steps have no `intersections[0].lanes` at all —
lane data is only present at multi-lane decision points, so absence is the
common case, not an error.

## Changes

### 1. Type: `client/src/hooks/useMapRouting.ts`

Extend the exported `RouteStep` interface (currently at line ~34):

```ts
export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  distanceText: string;
  maneuverType: string;
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

### 2. Parsing: `client/src/hooks/useNavGuidanceEngine.ts`

In the existing step-mapping code (~line 196-206), read the lane data off
`s.intersections?.[0]?.lanes` and map it into the new `lanes` field:

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

No lane data present → `lanes` stays `undefined` (not an empty array), so
downstream rendering can use a simple truthy/length check to decide whether to
show the lane strip at all.

### 3. Rendering: `client/src/pages/navigation/hud/HudInstruments.tsx`

`HudNextManeuver` (the component already rendering the next-turn banner in
`NavigationPage.tsx`, mounted around line 2578) gains a new optional `lanes`
prop. When present and non-empty, render a horizontal strip of lane icons
directly below the existing instruction/distance text:

- One icon per lane, in Directions-array order (left-to-right, matching real
  road layout).
- Each icon is a small arrow (or set of stacked arrows if `indications` has
  more than one direction) rotated/mirrored per that lane's `indications`.
- `valid: true` lanes render in brand gold (matching the existing HUD accent
  color already used for active guidance elements); `valid: false` lanes
  render dimmed (matching the existing muted-text token already used
  elsewhere in the HUD for de-emphasized state).
- If Mapbox provided an `active: true` lane, give it a subtle highlight
  (e.g. a border) distinguishing "recommended" from merely "valid" — but
  this is a nice-to-have, not a hard requirement if it adds meaningful
  visual complexity.

`NavigationPage.tsx`'s existing call site (~line 2578) passes
`lanes={step.lanes}` alongside the existing `maneuverType`/`modifier`/etc. props.

## Testing

- **Unit test** for the parsing logic: given a fixture Directions response
  with `intersections[0].lanes` present on one step and absent on another,
  confirm `useNavGuidanceEngine`'s step-mapper produces the right
  `RouteStep.lanes` (present + correctly shaped for the first, `undefined`
  for the second). No live Mapbox call needed — this is pure function testing
  against a fixture payload.
- **Component test** for `HudNextManeuver`: renders the lane strip when
  `lanes` is provided and non-empty, does NOT render it when `lanes` is
  `undefined` or an empty array, and renders valid/invalid lanes with visibly
  distinct styling (assert on the rendered class names / test ids, not exact
  pixel colors).
- No end-to-end/live-Mapbox test — this feature is parsing + presentation of
  data the app already fetches, not a new network integration.

## Risks

- **Lane data is inconsistently present.** Even at genuine multi-lane
  intersections, Mapbox doesn't always return `intersections[0].lanes` (data
  quality varies by region/road). The UI must gracefully show nothing extra
  when absent — already covered by the `undefined`-when-missing design above.
- **`intersections` can have more than one entry** per step (a step can cross
  multiple intersections). This spec only reads `intersections[0]` — the
  first intersection the step encounters — which is the one relevant to the
  step's own maneuver. Reading further intersections would be for a future
  "upcoming lane change 2 turns from now" feature, not in scope here.
