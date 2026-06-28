# Map UI — Seam + Surface Fix Program — Design Spec

**Date**: 2026-06-21
**Status**: Approved (brainstormed in-session with operator)
**Owner**: Christopher Zamora (operator-owner)
**Implementation**: 2-PR program (PR 1 seam + integration, PR 2 per-surface)
**Worktree**: `stoic-wu-e26574` on branch `claude/stoic-wu-e26574`
**Related**: [2026-06-21-dispatch-records-map-gps-repair-design.md](2026-06-21-dispatch-records-map-gps-repair-design.md) (different scope — dispatch/records/GPS audit, not Map UI)

---

## Goal

Fix every issue found in a six-agent parallel audit of the Map UI surface — eight distinct map surfaces (desktop MapPage, FleetMapPage, mobile field UI, four embedded mini-maps) plus the shared seams (`mapboxBasemap.ts`, `mapMarkers.ts`, `mapboxSafeLayer.ts`, `webglRecovery.ts`, `mapboxLoader.ts`, `mapboxApiKey.ts`) plus the supporting backend routes (`mapData`, `mapbox` proxy, `fleetViz`, `fleet`, `clearpathgps`, `geo`, `geocode`, `patrol`).

18 findings audited; **2 dropped after live-file verification** (S2 already fixed in code, S3 error message already correct — both were audit hallucinations vs. ground truth). **16 real fixes** — **5 high, 7 medium, 4 low** — land in two cohesive PRs.

## Non-goals

- **No backend route changes.** The backend audit confirmed all routes mounted, auth-gated, 503-graceful, no missing `await`, no schema drift. Out of scope here.
- **No MapPage megafile refactor.** Only the targeted P9 click-race null-check.
- **No new map features.** No new layers, no new controls, no new integrations. Pure fixes.
- **No CSS token system changes.** Working as designed (PR #1277 / #1279 system stands).
- **No `useMapbox*` hook changes** (`useMapboxResponseTime`, `useMapboxHeatmap`, `useMapboxIsochrone`, `useMapboxMapMatching`, `useMapboxTilequery`, `useActivityChoropleth`, `useNavGuidanceEngine`). Out of audit scope; out of fix scope.
- **No live-D1 migrations.** No schema work needed.

## Decisions locked in brainstorming

1. **Two-PR sequence, not one mega-PR.** PR 1 is *infrastructure* (seam + integration files, no user-visible behavior change in a feature). PR 2 is *behavior* (each fix changes how one component renders or cleans up). Splitting along that line matches review lenses.
2. **PR 2 rebases on PR 1.** PR 2's P7 (`buildDotMarker` signature extension) depends on PR 1's S1 consolidation; PR 2 cannot ship before PR 1.
3. **`isFinite` guard rejects only the exact `(0,0)` pair, not nearby coords.** Real Utah positions have ≥4 significant digits; the no-fix ClearPath GPS signature is exact `0,0`.
4. **Token consolidation collapses two paths into one.** `mapboxApiKey.ts::getMapboxAccessToken` becomes a thin re-export of `mapboxLoader.ts::resolveMapboxAccessToken`. Cache and error string unified.
5. **`buildDotMarker` gets an additive optional `halo` arg.** No breaking signature change — every existing caller works unchanged.
6. **`NavMapView` inset is lazy-mounted.** Existing callers that show the inset stay default-on for now (preserves current behavior); new prop-driven path enables tear-down for low-WebGL contexts.
7. **Standard PR flow per `feedback-use-pr-flow-not-direct-push`.** Branch off `origin/main`, `gh pr create`, operator reviews + merges. SW bump in each PR per CLAUDE.md cache-invalidation rule.

---

## PR 1 — Map seams + integration data flow (7 findings: S1, S4, S5, S6, I1, I2, I3)

**File scope:**
- `client/src/utils/mapboxApiKey.ts`
- `client/src/utils/mapboxLoader.ts`
- `client/src/utils/mapboxBasemap.ts`
- `client/src/utils/mapMarkers.ts`
- `client/src/utils/webglRecovery.ts`
- `client/src/pages/fleet/InsightsRoute.tsx` (FleetMapCard inline component)
- `client/public/sw.js` (cache version bump)

### Changes

#### S1 — Token consolidation *(High; consolidate dual paths)*

Two different async resolvers fetch the same `/integrations/mapbox/client-token` endpoint but with different machinery:
- `mapboxApiKey.ts::getMapboxAccessToken` uses the shared `apiFetch` helper (auth-aware) + in-flight dedupe.
- `mapboxLoader.ts::resolveMapboxAccessToken` uses raw `fetch` with manual `Authorization: Bearer` + a 3-retry counter.

They have **separate caches**, so a token mutation invalidating one doesn't invalidate the other.

Fix: `mapboxApiKey.ts` becomes a thin re-export delegating to the loader:

```ts
// Re-export the loader's resolver so call sites converge on one async path + one cache.
export { resolveMapboxAccessToken, clearMapboxConfigCache } from './mapboxLoader';
export const getMapboxAccessToken = resolveMapboxAccessToken; // alias for back-compat callers
export function getCachedMapboxAccessToken(): string {
  // Keep the sync getter for callers that need a synchronous build-time fallback.
  return ((import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() || '';
}
export function getMapboxTokenErrorMessage(): string {
  return 'Mapbox access token not configured. Set VITE_MAPBOX_ACCESS_TOKEN in client/.env or Cloudflare Pages environment variables.';
}
```

Callers (`ForensicTrackMap.tsx`, `NavMapView.tsx`, etc.) keep working unchanged — the export names are preserved. `FleetMapCard` (PR 1's I2 fix) consumes the loader directly.

#### S2 — *(dropped; already fixed in `mapboxLoader.ts:147-150,163`)*

The audit claimed a listener leak on the second `idle` handler, but the live code already captures `onIdleHideRecovery` in a const at line 147 and removes it at line 163. The comment block at lines 143-146 documents this *prior* fix, which the auditor mistook for a current bug. No action.

#### S3 — *(dropped; error message already correct)*

The audit (and the stale CLAUDE.md note) said the error message points to "dead VPS server/.env." The live `mapboxApiKey.ts:6-7` already reads:

```
Mapbox access token not configured. Set VITE_MAPBOX_ACCESS_TOKEN in client/.env or Cloudflare Pages environment variables.
```

That's correct. No action. (CLAUDE.md note is itself stale — out of scope for this PR but worth flagging in a follow-up memory consolidation.)

#### S4 — Observability on `mapboxBasemap.ts` paint setters *(Medium; silent failures)*

The `as never` casts in `setPaint`/`setLayout` are an accepted workaround for Mapbox GL JS's strict overload types — keeping them is fine. The real issue: the bare `catch { /* skip */ }` swallows real bugs silently. Add a dev-only warn:

```ts
function setPaint(map: mapboxgl.Map, id: string, prop: string, value: unknown): void {
  try {
    if (map.getLayer(id)) map.setPaintProperty(id, prop as never, value as never);
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[basemap] setPaint failed', { id, prop, err });
  }
}
```

Same for `setLayout`. Production behavior unchanged (try/catch still guards). Dev mode now surfaces a real signal for theme debugging.

#### S5 — `webglRecovery.ts` double `getContext` *(Medium; throws on Safari/iOS)*

Replace:
```ts
const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
```
with:
```ts
let ctx: WebGL2RenderingContext | WebGLRenderingContext | null = null;
try {
  ctx = canvas.getContext('webgl2');
  if (!ctx) ctx = canvas.getContext('webgl');
} catch {
  ctx = null;
}
```
Two call sites (`webglRecovery.ts:73` and `:191`).

#### S6 — Animation duration alignment *(Low; cosmetic)*

`mapboxLoader.ts` keyframe `@keyframes rmpg-recovery-pulse` duration changed to `1.4s` to match `mapMarkers.ts:164` consumer.

#### I1 — Finite-coord guard at marker call sites *(High; cascades to every map)*

**Important correction during self-review:** `buildUnitMarker`/`buildCallMarker`/`buildDotMarker` return `HTMLElement`, NOT `mapboxgl.Marker`. They have no knowledge of coordinates — coordinates are handed to the wrapping `new mapboxgl.Marker({ element }).setLngLat([lng, lat])`. Therefore the guard must live at the **call site**, not in the builder.

Export a helper from `client/src/utils/mapMarkers.ts`:

```ts
// Reject ClearPath no-fix (exact 0,0), NaN/Infinity, and out-of-globe coords.
// Real Utah positions have ≥4 significant digits, so the (0,0) exact match is safe.
export function isValidLngLat(lng: unknown, lat: unknown): lng is number {
  return (
    typeof lng === 'number' && typeof lat === 'number' &&
    Number.isFinite(lng) && Number.isFinite(lat) &&
    !(lng === 0 && lat === 0) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}
```

Patch each call site that constructs a `mapboxgl.Marker` from raw lat/lng:

- **MapPage.tsx unit marker effect** (around line 1663): replace `if (unit.latitude != null && unit.longitude != null)` with `if (isValidLngLat(unit.longitude, unit.latitude))`.
- **MapPage.tsx call marker effect** (around line 1791): same swap.
- **DispatchMiniMap.tsx** (lines 245, 286): guard the `setLngLat([lng, lat])` chain.
- **ForensicTrackMap.tsx** (lines 55, 60): guard the start/end and playback marker construction.
- **SightingsMap.tsx** (line 85 + the new in-place loop from P2): guard each sighting's coords before adding/moving.

**Verification:** MapPage breadcrumb code (line 2596) already uses `isFinite`; this brings unit/call/dot markers into line — same standard, single helper.

#### I2 — FleetMapCard bootstraps via loader *(High; first-open path shows error toast)*

`client/src/pages/fleet/InsightsRoute.tsx::FleetMapCard` — before `new mapboxgl.Map({...})`, ensure the token is resolved AND `mapboxgl.accessToken` is set:

```ts
import { resolveMapboxAccessToken, initMapbox, isMapboxReady } from '../../utils/mapboxLoader';

// inside the init effect:
if (!isMapboxReady()) {
  const token = await resolveMapboxAccessToken();
  if (!token) {
    // Fall into the existing token-missing fallback (try/catch on new mapboxgl.Map).
    throw new Error('Mapbox token unresolved');
  }
  initMapbox(token);
}
// THEN construct the map.
const map = new mapboxgl.Map({...});
```

`mapboxLoader.ts` already sets `mapboxgl.accessToken` at module-import time from `VITE_MAPBOX_ACCESS_TOKEN` (lines 15-16) — so the bug only manifests when the token is **not** at build time and must be fetched at runtime. The fix wires the runtime path. The existing try/catch around `new mapboxgl.Map` stays as the final safety net (PR #1516's fallback).

#### I3 — FleetMapCard rebuild-race fix *(Medium; markers torn down mid-rebuild)*

Add a generation token to the marker rebuild effect:

```ts
const rebuildGen = useRef(0);
useEffect(() => {
  const myGen = ++rebuildGen.current;
  // ... build markers ...
  // Before each .remove() or .addTo(), check:
  if (myGen !== rebuildGen.current) return;
}, [data]);
```

Stale rebuilds abort cleanly when `data` changes mid-flight.

### Tests (PR 1)

- `client/src/utils/__tests__/mapMarkers.test.ts` — `isValidLngLat` truth table (NaN, Infinity, (0,0), valid Utah coord like (-111.876, 40.760), out-of-range like lat=91).
- Existing `client/src/pages/fleet/__tests__/InsightsRoute.test.tsx` augmented to assert FleetMapCard awaits `resolveMapboxAccessToken` + `initMapbox` before constructing the map.
- (S2 and S3 dropped → no tests for them.)

### Risks (PR 1)

- **`isFinite` guard could hide a legitimate Utah (0,0) unit.** Mitigation: guard rejects only the *exact* `(0,0)` pair. Utah lat ≈ 40.x, lng ≈ -111.x; no legitimate position rounds to exactly `(0,0)`.
- **Token consolidation changes the cache.** `mapboxApiKey` previously had its own cache; consolidating to `mapboxLoader.resolveMapboxAccessToken` switches all callers to the loader's cache. Behavior should be indistinguishable, but a stale token cached separately could surface here. Mitigation: SW bump forces fresh load; loader's cache is in-memory (no persisted state).
- **FleetMapCard `await ensureMapboxLoaded()` adds a microtask.** First paint of the card may be one frame later. Acceptable — the card already shows a loading skeleton.

---

## PR 2 — Per-surface bugs (9 findings)

**File scope:**
- `client/src/components/ForensicTrackMap.tsx`
- `client/src/components/SightingsMap.tsx`
- `client/src/components/NavMapView.tsx`
- `client/src/components/DispatchMiniMap.tsx`
- `client/src/components/navMapHelpers.ts`
- `client/src/pages/mobile/FieldCameraPage.tsx`
- `client/src/pages/map/MapPage.tsx` (one targeted null-check; no megafile refactor)
- `client/src/pages/fleet/InsightsRoute.tsx` (FleetMapCard popup CSS only)
- `client/src/utils/mapMarkers.ts` (extend `buildDotMarker` with optional halo arg — PR 1 must merge first)
- `client/public/sw.js` (cache version bump)

### Changes

#### P1 — ForensicTrackMap marker leak fix *(High)*

Track all markers (start, end, playback) in a single ref array. On unmount, iterate + `.remove()`.

```ts
const markersRef = useRef<mapboxgl.Marker[]>([]);
// during init:
const m = buildDotMarker({...}); if (m) { m.addTo(map); markersRef.current.push(m); }
// during cleanup:
markersRef.current.forEach((m) => { try { m.remove(); } catch { /* idempotent */ } });
markersRef.current = [];
```

#### P2 — SightingsMap in-place marker move *(High)*

Replace the rebuild-everything pattern with a diff-and-move:

```ts
const markersById = useRef<Map<string, mapboxgl.Marker>>(new Map());
useEffect(() => {
  const seen = new Set<string>();
  for (const s of sightings) {
    seen.add(s.id);
    const existing = markersById.current.get(s.id);
    if (existing) {
      existing.setLngLat([s.lng, s.lat]);
    } else {
      const m = buildDotMarker({ lng: s.lng, lat: s.lat, halo: s.hit ? { color: 'gold', size: 16 } : undefined });
      if (m) { m.addTo(map); markersById.current.set(s.id, m); }
    }
  }
  for (const [id, m] of markersById.current) {
    if (!seen.has(id)) { try { m.remove(); } catch {} markersById.current.delete(id); }
  }
}, [sightings]);
```

Eliminates jitter on live ALPR feeds.

#### P3 — NavMapView lazy inset *(Medium; WebGL context cap)*

Inset map mounted only when `showInset` prop is `true` (default `true` to preserve current behavior). When false, the entire inset subtree (including the second `mapboxgl.Map`) is not rendered.

The `low-power mode` path at line 399 already tears down the inset — extend that behavior to a top-level prop so callers can opt out.

#### P4 — FieldCameraPage safe-area *(Medium; Dynamic Island overlap)*

The fixed `inset-0` container gets `safe-pt safe-pb safe-px` (Tailwind safe-area utilities — these exist in the codebase already per audit). Specifically:

- Top bar (Back / Flip): wrap in `pt-[env(safe-area-inset-top)]` or use existing `safe-pt` helper.
- Bottom patrol log overlay: `pb-[env(safe-area-inset-bottom)]` / `safe-pb`.
- Patrol-hit dismiss banner: `safe-pt`.
- HUD overlays (clock, GPS status, officer name): `safe-pt` so they don't sit behind the notch.

#### P5 — FleetMapCard popup inherits color *(Medium)*

Remove inline `color: #0d1722` from the popup HTML. Wrap content in a `<div class="text-surface-base">` and let it pick up the theme token. Mapbox popup will use this color when the underlying surface re-themes.

#### P6 — NavMapView overlay color theme-awareness *(Medium)*

In `client/src/components/navMapHelpers.ts`, add:

```ts
export function navOverlayPalette(theme: 'dark' | 'light'): { route: string; position: string; predicted: string } {
  // Gold reads on dark steel-blue night basemap; deeper amber reads on light-grey day basemap.
  return theme === 'light'
    ? { route: '#a07d12', position: '#a07d12', predicted: '#c9961d' }
    : { route: '#d4a017', position: '#d4a017', predicted: '#d4a017' };
}
```

`NavMapView.tsx` consumes this palette based on the current resolved theme (read from `UserPreferencesContext`'s effective theme). Circle/line layers use these values instead of hardcoded `#d4a017`.

#### P7 — `buildDotMarker` halo seam *(Low)*

Extend signature additively:

```ts
type BuildDotMarkerOpts = {
  lng: number; lat: number;
  color?: string;
  size?: number;
  halo?: { color: string; size: number };
};
```

`SightingsMap` consumes this for its hit-ring (replacing manual DOM border/box-shadow). Every other caller is unchanged — `halo` is optional.

#### P8 — DispatchMiniMap status colors *(Low)*

Replace `#22c55e`, `#d4a017`, `#f59e0b`, `#888888` literals with constants exported from `mapMarkers.ts`:

```ts
export const STATUS_COLORS = {
  online: '#22c55e',     // emerald-500
  warning: '#d4a017',    // RMPG brand gold
  caution: '#f59e0b',    // amber-500
  offline: '#888888',    // neutral
} as const;
```

Allowed exception to the "never hardcode hex" rule: Mapbox layer paint properties don't support CSS variables, and these are the canonical status semantics — one named source.

#### P9 — MapPage click-race null-check *(Low)*

In `MapPage.tsx` property-click handler (around line 1902):

```ts
const fetched = await fetchProperty(propId);
if (!mapInstanceRef.current || lastClickedPropRef.current !== propId) return;
infoWindowRef.current?.setHTML(...).setLngLat(...);
```

Adds a single null-check + race guard read.

### Tests (PR 2)

- `client/src/components/__tests__/ForensicTrackMap.test.tsx` — mount + unmount; assert all 3 marker `.remove()` calls fire.
- `client/src/components/__tests__/SightingsMap.test.tsx` — feed sightings stream; assert marker DOM nodes don't churn (count stable through updates).
- `client/src/components/__tests__/NavMapView.test.tsx` — `showInset={false}` doesn't construct a second map.
- `client/src/components/__tests__/DispatchMiniMap.test.tsx` — status color constant resolution.

### Risks (PR 2)

- **P3 inset behavior change.** Default `showInset={true}` preserves current behavior, but any caller that explicitly opts out via `showInset={false}` loses the inset until they re-enable. Mitigation: callers updated in a follow-up if needed.
- **P6 theme color change.** Day-mode users will see slightly deeper amber instead of gold on NavMapView. Mitigation: reviewed visually in the operator's review (browser-eyeballed during merge).
- **P7 signature change in `buildDotMarker`** — additive only, every existing call site works without modification. SightingsMap is the only caller that consumes the new `halo` arg in this PR.

---

## Deployment & Verification

### Per-PR

1. Branch off `origin/main` (main is in a sibling worktree).
2. Local `npm run typecheck` (worker), `cd client && npx tsc --noEmit && npx vitest run`.
3. `gh pr create` with title `fix(map): <PR summary>` and body listing the finding IDs.
4. Operator reviews + squash-merges; `deploy.yml` ships Worker + Pages together.

### After merge

- **No migrations.** No live-D1 patches needed.
- **No secrets.** All required env vars (Mapbox token, Roboflow key, ClearPath creds) already set.
- **SW cache bump in each PR.** Without this, users keep serving stale chunks. Sequence in this worktree:
  - PR 1 bumps to next `flex-vN`.
  - PR 2 bumps to `flex-vN+1`.
- **Browser smoke check** (operator) — WAF blocks curl on any path except `/api/health`:
  - Open `/map` in real browser — verify unit markers appear, no (0,0) ghosts at Africa.
  - Open `/fleet` insights — verify Fleet map renders (or shows clean fallback if token unset on dev).
  - Open dispatch — verify mini-map renders.
  - Open a Forensic Playback session — verify markers clean up on close.
  - Open a SightingsMap with live ALPR feed — verify no jitter.
  - Open NavMapView during a turn-by-turn — verify overlay color theme-appropriate.
  - Open `/field-camera` on a notched device — verify safe-area.

### Rollback

Each PR is a single commit on its own branch. Worst case: revert the squash-merge commit on `main`. No DB rollback needed (no migrations).

---

## Appendix A — Audit punch list (16 fixes after self-review)

| # | Sev | Issue | Source file | PR |
|---|---|---|---|---|
| S1 | H | Dual token resolvers (separate caches, separate fetch machinery) | `mapboxApiKey.ts` + `mapboxLoader.ts` | 1 |
| ~~S2~~ | — | *Dropped — already fixed in `mapboxLoader.ts:147-150,163`* | — | — |
| ~~S3~~ | — | *Dropped — error message already correct at `mapboxApiKey.ts:6-7`* | — | — |
| S4 | M | Paint setters swallow errors silently — add dev warn | `mapboxBasemap.ts` | 1 |
| S5 | M | Double `getContext` can throw on Safari/iOS | `webglRecovery.ts` | 1 |
| S6 | L | Animation duration mismatch (1s keyframe vs 1.4s consumer) | `mapboxLoader.ts:119` + `mapMarkers.ts:164` | 1 |
| I1 | H | `(0,0)` plotted at Africa equator — guard at call sites | `mapMarkers.ts` helper + 5 call sites | 1 |
| I2 | H | FleetMapCard bypasses loader/token-resolve | `InsightsRoute.tsx` | 1 |
| I3 | M | FleetMapCard rebuild race | `InsightsRoute.tsx` | 1 |
| P1 | H | ForensicTrackMap orphans start/end markers | `ForensicTrackMap.tsx` | 2 |
| P2 | H | SightingsMap rebuild-on-change → use diff-and-move | `SightingsMap.tsx` | 2 |
| P3 | M | NavMapView 2 WebGL contexts — lazy-mount inset | `NavMapView.tsx` | 2 |
| P4 | M | FieldCameraPage safe-area (Dynamic Island) | `FieldCameraPage.tsx` | 2 |
| P5 | M | FleetMapCard popup hardcoded color | `InsightsRoute.tsx` | 2 |
| P6 | M | NavMapView overlay colors hardcoded | `NavMapView.tsx` + `navMapHelpers.ts` | 2 |
| P7 | L | SightingsMap bypasses `buildDotMarker` seam | `SightingsMap.tsx` + `mapMarkers.ts` | 2 |
| P8 | L | DispatchMiniMap hardcoded status colors | `DispatchMiniMap.tsx` + `mapMarkers.ts` | 2 |
| P9 | L | MapPage popup-click race null-check | `MapPage.tsx` | 2 |

**Totals: 16 fixes (5 H, 7 M, 4 L). PR 1 = 8 fixes (3 H, 4 M, 1 L). PR 2 = 8 fixes (2 H, 4 M, 2 L).**

## Appendix B — Verified clean (no action needed)

- Backend routes (`mapData`, `mapbox`, `fleet`, `fleetViz`, `clearpathgps`, `geo`, `geocode`, `patrol`) — all mounted in `routesConfig.ts`, auth-gated correctly, 503-graceful, no missing `await`, no schema drift.
- MapPage WebGL recovery, listener teardown, and `applyRmpgBasemap` wiring.
- ClearPath OAuth refresh path, KV cache, encryption (`cpgCrypto.ts`).
- Mapbox proxy (`/api/mapbox` — PR #1339; all 9 endpoints token-gated with 503 when unset).
- `applyRmpgBasemap` never-throws contract (verified — line 116 guards all mutations).
- `mapMarkers` builders own no DOM lifecycle (callers own marker objects via `mapboxgl.Marker` wrapper).
- `webglRecovery.ts` `map.off()` cleanup is try/catch-safe.

---

## Notes for the implementation plan

- **Order matters** — within PR 1, S1 (token consolidation) must merge before I2 (FleetMapCard uses the consolidated loader). Do them in the same commit.
- **PR 2 rebases on PR 1.** Wait for PR 1 squash-merge before pushing PR 2.
- **No new files** — every change edits an existing file.
- **No new dependencies.**
- **Test files** in PR 2 reference test infrastructure that exists (`client/src/**/__tests__/`); no new test scaffolding needed.
- **SW bump** per PR is non-negotiable (CLAUDE.md cache invalidation rule).
