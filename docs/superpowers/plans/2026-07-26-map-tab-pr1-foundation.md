# Map Tab PR 1 — Foundation & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all 55 map layer toggles into a declarative registry with per-layer icons and theme-variable colors, and add a switchable compact/touch density mode — with no visible feature change.

**Architecture:** A new `layerRegistry.ts` owns presentation metadata (label, icon, group, colorVar, description) for every layer; `MapboxMapPage` keeps owning behavior (active, onToggle, loading, error) and joins the two through a `useLayerBindings()` adapter that emits the `DockToggleItem[]` the existing dock renderers already consume. A `MapDensityContext` supplies `'compact' | 'touch'` sizing to `DockToggleRow`, replacing breakpoint-driven sizing so the desktop dock and mobile tray share one implementation.

**Tech Stack:** React 18, TypeScript, Vite 6, Tailwind (CSS-variable-backed tokens), `lucide-react`, Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-07-26-map-tab-hardening-design.md`](../specs/2026-07-26-map-tab-hardening-design.md)

## Global Constraints

- **No new dependencies.** Icons come from `lucide-react`, already a dependency.
- **Never hardcode hex** in components or registry data. Use CSS-variable-backed Tailwind tokens or `var(--x)`. Palette source of truth is `client/src/styles/theme-palettes.css`.
- **`#d4a017` is banned** — fails WCAG AA on navy and is confusable with `--sev-warn`. Every existing use in the toggle data must be replaced.
- **Do not touch Mapbox paint properties.** Literal hex is correct in `mapboxBasemap.ts` and other paint modules; `var()` blanks a Mapbox GL map.
- **Border radius is 2 px everywhere.** Never `rounded-lg`.
- **Any new CSS variable must be defined in all four theme blocks** in `theme-palettes.css`, following the `accentTokens.test.ts` completeness pattern. This plan introduces no new variables.
- **This PR ships zero visible feature change.** If a step would change what a user sees (beyond icons appearing in toggle rows), it belongs in a later PR.
- **Run the full client suite** (`cd client && npx vitest run`), never targeted tests only, before claiming a task done.
- Client baseline is clean as of 2026-07-24 (0 typecheck errors; 443 files / 3,101 tests passing). Any failure is caused by this change and is a hard stop.
- Working directory for all client commands: `client/`. Fresh worktrees need `npm install --legacy-peer-deps` first.

---

## File Structure

**Create:**
- `client/src/pages/map/config/layerRegistry.ts` — the 55 layer definitions and their types. Presentation metadata only; no React, no state.
- `client/src/pages/map/config/__tests__/layerRegistry.test.ts` — registry invariants (unique ids, icon present, no literal hex).
- `client/src/pages/map/hooks/useMapDensity.tsx` — `MapDensityProvider`, `useMapDensity()`, and the density token table.
- `client/src/pages/map/hooks/__tests__/useMapDensity.test.tsx` — resolution and override precedence.
- `client/src/pages/map/hooks/useLayerBindings.ts` — joins registry entries to page state, emits `DockToggleItem[]` grouped into sections.
- `client/src/pages/map/hooks/__tests__/useLayerBindings.test.ts` — completeness: every binding resolves, every registry entry is bound.

**Modify:**
- `client/src/pages/map/components/DockSection.tsx` — `DockToggleRow` gains icon, density sizing, switch semantics, focus ring; `DockToggleItem` gains `icon`.
- `client/src/pages/map/MapboxMapPage.tsx` — replace the two `useMemo` section arrays (lines ~1098–1226) with `useLayerBindings()` calls; wrap the map shell in `MapDensityProvider`.
- `client/src/pages/map/utils/mapMarkers.ts:72` — route the `#0d1520` glyph fill through a theme variable.

**Unchanged by design:** `MapLeftDock.tsx`, `MapRightDock.tsx`, `MapBottomTray.tsx`. They render whatever `DockToggleItem[]` they are given, so they inherit icons and density with no edits — this is the payoff of the existing generic-renderer design.

---

### Task 1: Density context and hook

Self-contained and has no dependents until Task 3, so it can be reviewed in isolation.

**Files:**
- Create: `client/src/pages/map/hooks/useMapDensity.tsx`
- Test: `client/src/pages/map/hooks/__tests__/useMapDensity.test.tsx`

**Interfaces:**
- Consumes: `loadMapPref(key: string): unknown` and `saveMapPref(key: string, value: unknown): void` from `client/src/utils/mapPreferences.ts`. Both prefix keys with `rmpg_map_`, so passing `'density'` reads/writes `rmpg_map_density`.
- Produces:
  - `type MapDensity = 'compact' | 'touch'`
  - `interface MapDensityTokens { rowPaddingY: string; rowMinHeight: string; labelSize: string; iconPx: number }`
  - `const DENSITY_TOKENS: Record<MapDensity, MapDensityTokens>`
  - `function MapDensityProvider(props: { children: ReactNode; initialOverride?: MapDensity | null }): JSX.Element`
  - `function useMapDensity(): { density: MapDensity; tokens: MapDensityTokens; override: MapDensity | null; setOverride: (d: MapDensity | null) => void }`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/hooks/__tests__/useMapDensity.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MapDensityProvider, useMapDensity, DENSITY_TOKENS } from '../useMapDensity';

function setPointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('coarse') ? coarse : !coarse,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <MapDensityProvider>{children}</MapDensityProvider>
);

describe('useMapDensity', () => {
  beforeEach(() => {
    localStorage.clear();
    setPointer(false);
  });

  it('defaults to compact on a fine pointer', () => {
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    expect(result.current.density).toBe('compact');
    expect(result.current.override).toBeNull();
  });

  it('defaults to touch on a coarse pointer', () => {
    setPointer(true);
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    expect(result.current.density).toBe('touch');
  });

  it('lets an explicit override win over the coarse-pointer default', () => {
    setPointer(true);
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    act(() => result.current.setOverride('compact'));
    expect(result.current.density).toBe('compact');
    expect(result.current.override).toBe('compact');
  });

  it('persists the override to rmpg_map_density and restores it on remount', () => {
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    act(() => result.current.setOverride('touch'));
    expect(JSON.parse(localStorage.getItem('rmpg_map_density')!)).toBe('touch');

    const remounted = renderHook(() => useMapDensity(), { wrapper });
    expect(remounted.result.current.density).toBe('touch');
  });

  it('clearing the override falls back to the pointer default', () => {
    setPointer(true);
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    act(() => result.current.setOverride('compact'));
    act(() => result.current.setOverride(null));
    expect(result.current.density).toBe('touch');
  });

  it('exposes a 44px minimum row height in touch mode', () => {
    expect(DENSITY_TOKENS.touch.rowMinHeight).toBe('44px');
    expect(DENSITY_TOKENS.compact.rowMinHeight).toBe('24px');
  });

  it('ignores a corrupt persisted value', () => {
    localStorage.setItem('rmpg_map_density', '"enormous"');
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    expect(result.current.density).toBe('compact');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/hooks/__tests__/useMapDensity.test.tsx`
Expected: FAIL — `Failed to resolve import "../useMapDensity"`.

- [ ] **Step 3: Write the implementation**

Create `client/src/pages/map/hooks/useMapDensity.tsx`:

```tsx
// ============================================================
// RMPG Flex — Map Density Mode
// The Map tab serves a dispatcher on a desktop (wants 55 toggles
// dense) and an officer on a Toughbook touchscreen (needs 44px
// targets, gloves, moving vehicle) from the SAME components.
// Density is therefore an explicit mode, not a `lg:` breakpoint:
// the desktop dock and the mobile bottom tray both read it, so
// they can never drift apart in sizing again.
// ============================================================

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';
import { loadMapPref, saveMapPref } from '../../../utils/mapPreferences';

export type MapDensity = 'compact' | 'touch';

export interface MapDensityTokens {
  /** Vertical padding utility for a toggle row. */
  rowPaddingY: string;
  /** Minimum row height — 44px in touch mode is the glove/■target floor. */
  rowMinHeight: string;
  /** Label font size. */
  labelSize: string;
  /** Leading icon edge length in px. */
  iconPx: number;
}

export const DENSITY_TOKENS: Record<MapDensity, MapDensityTokens> = {
  compact: { rowPaddingY: '0.375rem', rowMinHeight: '24px', labelSize: '11px', iconPx: 14 },
  touch:   { rowPaddingY: '0.625rem', rowMinHeight: '44px', labelSize: '13px', iconPx: 18 },
};

/** Raw key; mapPreferences prefixes it to `rmpg_map_density`. */
const DENSITY_PREF_KEY = 'density';

function isDensity(v: unknown): v is MapDensity {
  return v === 'compact' || v === 'touch';
}

function readOverride(): MapDensity | null {
  const stored = loadMapPref(DENSITY_PREF_KEY);
  return isDensity(stored) ? stored : null;
}

/** Coarse pointer means a touchscreen — Toughbook or phone. */
function pointerDefault(): MapDensity {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'compact';
  return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'compact';
}

interface MapDensityValue {
  density: MapDensity;
  tokens: MapDensityTokens;
  override: MapDensity | null;
  setOverride: (d: MapDensity | null) => void;
}

const MapDensityContext = createContext<MapDensityValue | null>(null);

export function MapDensityProvider({
  children,
  initialOverride,
}: {
  children: ReactNode;
  initialOverride?: MapDensity | null;
}) {
  const [override, setOverrideState] = useState<MapDensity | null>(
    () => initialOverride ?? readOverride(),
  );

  const setOverride = useCallback((d: MapDensity | null) => {
    setOverrideState(d);
    saveMapPref(DENSITY_PREF_KEY, d);
  }, []);

  const value = useMemo<MapDensityValue>(() => {
    const density = override ?? pointerDefault();
    return { density, tokens: DENSITY_TOKENS[density], override, setOverride };
  }, [override, setOverride]);

  return <MapDensityContext.Provider value={value}>{children}</MapDensityContext.Provider>;
}

/**
 * Falls back to compact outside a provider rather than throwing, so a dock
 * component rendered in an isolated test or a non-map surface still works.
 */
export function useMapDensity(): MapDensityValue {
  const ctx = useContext(MapDensityContext);
  if (ctx) return ctx;
  return {
    density: 'compact',
    tokens: DENSITY_TOKENS.compact,
    override: null,
    setOverride: () => {},
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/hooks/__tests__/useMapDensity.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/hooks/useMapDensity.tsx client/src/pages/map/hooks/__tests__/useMapDensity.test.tsx
git commit -m "feat(map): add compact/touch density context for the map docks"
```

---

### Task 2: Layer registry

**Files:**
- Create: `client/src/pages/map/config/layerRegistry.ts`
- Test: `client/src/pages/map/config/__tests__/layerRegistry.test.ts`

**Interfaces:**
- Consumes: `HIERARCHY_CONFIGS` from `client/src/hooks/useDistrictHierarchyLayers.ts` (exported at line 33; shape `{ id, label, description, minzoom }`). `GEO_LAYER_CONFIGS` from `client/src/hooks/useGeoJsonLayers.ts` (shape includes `{ id, label, file, style }`).
- Produces:
  - `type MapLayerGroup` — union of the 10 section titles.
  - `interface MapLayerDef { id, label, icon, group, colorVar, description, pinned? }`
  - `const MAP_LAYER_REGISTRY: MapLayerDef[]`
  - `const LAYER_BY_ID: ReadonlyMap<string, MapLayerDef>`
  - `const LEFT_DOCK_GROUPS: MapLayerGroup[]` and `const RIGHT_DOCK_GROUPS: MapLayerGroup[]`

**Note on colors:** every `colorVar` is a `var(--x)` string referencing a variable
verified to exist in all four theme blocks. The four `#d4a017` uses become
`var(--accent-silver-400)` — silver, not a compliant gold. Two independent rules force
this: `--accent-gold-*` is defined only in the blue-silver block (so it would drop the
color in the other three themes), and CLAUDE.md restricts gold to exactly two roles,
field labels and panel headers. A layer dot is neither.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/config/__tests__/layerRegistry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MAP_LAYER_REGISTRY, LAYER_BY_ID, LEFT_DOCK_GROUPS, RIGHT_DOCK_GROUPS,
} from '../layerRegistry';
import { HIERARCHY_CONFIGS } from '../../../../hooks/useDistrictHierarchyLayers';

describe('MAP_LAYER_REGISTRY', () => {
  it('has a unique id for every entry', () => {
    const ids = MAP_LAYER_REGISTRY.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry an icon, a label, and a description', () => {
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(layer.icon, `${layer.id} is missing an icon`).toBeTruthy();
      expect(layer.label.length, `${layer.id} has an empty label`).toBeGreaterThan(0);
      expect(layer.description.length, `${layer.id} has an empty description`).toBeGreaterThan(0);
    }
  });

  // The whole point of the registry is that colors re-theme. A literal hex here
  // would silently escape the theme system exactly the way the old inline
  // toggle arrays did.
  it('uses only CSS variables for color, never a literal hex', () => {
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(layer.colorVar, `${layer.id} must use var(--x)`).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it('never uses the banned #d4a017 gold', () => {
    const serialized = MAP_LAYER_REGISTRY.map((l) => l.colorVar).join(' ');
    expect(serialized.toLowerCase()).not.toContain('d4a017');
  });

  // --accent-gold-* is defined ONLY in the blue-silver theme block, so it would
  // render colorless in the other three. Gold is also restricted app-wide to
  // field labels and panel headers; a layer dot is neither.
  it('never uses a gold accent for a layer dot', () => {
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(layer.colorVar, `${layer.id} must not use gold`).not.toContain('gold');
    }
  });

  it('assigns every entry to a declared dock group', () => {
    const declared = new Set<string>([...LEFT_DOCK_GROUPS, ...RIGHT_DOCK_GROUPS]);
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(declared.has(layer.group), `${layer.id} has undeclared group ${layer.group}`).toBe(true);
    }
  });

  it('indexes every entry in LAYER_BY_ID', () => {
    expect(LAYER_BY_ID.size).toBe(MAP_LAYER_REGISTRY.length);
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(LAYER_BY_ID.get(layer.id)).toBe(layer);
    }
  });

  // Boundary entries are DERIVED from the same config arrays the page consumes,
  // so the registry cannot drift from them when a district level is added.
  it('derives a boundary entry for every hierarchy config', () => {
    for (const cfg of HIERARCHY_CONFIGS) {
      expect(LAYER_BY_ID.has(`district-${cfg.id}`), `missing district-${cfg.id}`).toBe(true);
    }
  });

  it('contains all 55 toggles', () => {
    expect(MAP_LAYER_REGISTRY.length).toBe(55);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/config/__tests__/layerRegistry.test.ts`
Expected: FAIL — `Failed to resolve import "../layerRegistry"`.

- [ ] **Step 3: Write the implementation**

Create `client/src/pages/map/config/layerRegistry.ts`. Transcribe each entry from the
current `mapLeftDockSections` / `mapRightDockSections` arrays in
`MapboxMapPage.tsx` (lines ~1098–1226), keeping `id`, `label`, `description`, and
`pinned` **verbatim** and translating `color` to a theme variable per the table below.

Color translation table — apply exactly:

| Current hex | Replace with | Rationale |
|---|---|---|
| `#22c55e`, `#64d264`, `#4caf50` | `var(--sev-ok)` | operational green |
| `#3b82f6`, `#60a5fa` | `var(--sev-info)` | informational blue |
| `#d4a017` | `var(--accent-silver-400)` | **banned hex** — and gold is restricted to field labels and panel headers only, so a layer dot must be silver |
| `#ef4444`, `#dc2626`, `#c81e1e` | `var(--sev-critical)` | critical/safety red |
| `#f97316`, `#f08228`, `#fb923c` | `var(--sev-high)` | high/orange |
| `#f59e0b`, `#eab308` | `var(--sev-warn)` | warning amber |
| `#a855f7`, `#8b5cf6` | `var(--sev-special)` | special/purple |
| `#14b8a6`, `#10b981` | `var(--sev-ok)` | teal/green family |
| `#666666` | `var(--text-secondary)` | neutral chrome |

**Verified 2026-07-26:** every variable above is defined in all four theme blocks
(`--sev-ok`, `--sev-critical`, `--sev-high`, `--sev-warn`, `--sev-special`, `--sev-info`,
`--accent-silver-400`, `--text-secondary` all report 4). Do **not** substitute
`--accent-gold-*` — it is defined only in the blue-silver block and would drop the
color in the other three themes.

```ts
// ============================================================
// RMPG Flex — Map Layer Registry
// Single declarative source of truth for every layer toggle in the
// Map tab. Presentation metadata ONLY — label, icon, group, color,
// description. Behavior (active / onToggle / loading / error) stays
// in MapboxMapPage and is joined in by useLayerBindings().
//
// Why this exists: the same {id,label,active,onToggle} literal was
// retyped across ten arrays in MapboxMapPage, so every findability
// feature (search, favorites, active-layer summary, legend) would
// have needed ten bespoke wirings. One array, four renderers.
//
// NEVER put a literal hex in here — layerRegistry.test.ts fails the
// build if you do. Colors are CSS variables so they re-theme.
// ============================================================

import {
  Activity, AlertTriangle, Anchor, Boxes, Brush, CircleDot, Cloud, Compass,
  Crosshair, Footprints, Gauge, Gauge as GaugeIcon, Globe, Grid3x3, Hexagon,
  History, Layers, LineChart, Locate, MapPin, Mountain, Move3d, Navigation,
  PenTool, PlayCircle, Radar, Radio, Route, Ruler, Search, Shield, Siren,
  SquareDashed, Star, Sun, Timer, TrafficCone, Volume2, Waypoints, Wrench,
  Zap, type LucideIcon,
} from 'lucide-react';
import { HIERARCHY_CONFIGS } from '../../../hooks/useDistrictHierarchyLayers';
import { GEO_LAYER_CONFIGS } from '../../../hooks/useGeoJsonLayers';

export type MapLayerGroup =
  | 'Live Conditions' | 'Units & Calls' | 'Historical Analysis'
  | 'Administrative Boundaries' | 'Risk & Coverage' | 'Terrain & 3D'
  | 'Dispatch Tools' | 'Measurement & Marking' | 'Drawing & Tracking'
  | 'Diagnostics';

export const LEFT_DOCK_GROUPS: MapLayerGroup[] = [
  'Live Conditions', 'Units & Calls', 'Historical Analysis',
  'Administrative Boundaries', 'Risk & Coverage', 'Terrain & 3D',
];

export const RIGHT_DOCK_GROUPS: MapLayerGroup[] = [
  'Dispatch Tools', 'Measurement & Marking', 'Drawing & Tracking', 'Diagnostics',
];

export interface MapLayerDef {
  /** Stable id — must match the binding key used in useLayerBindings. */
  id: string;
  /** Canonical, searchable name. A binding may override the rendered text. */
  label: string;
  icon: LucideIcon;
  group: MapLayerGroup;
  /** Always `var(--x)`. Enforced by test. */
  colorVar: string;
  description: string;
  /** Safety-critical — renders a colored left-border accent. */
  pinned?: boolean;
}

const STATIC_LAYERS: MapLayerDef[] = [
  // ── Live Conditions ──
  { id: 'traffic', label: 'Live Traffic', icon: TrafficCone, group: 'Live Conditions', colorVar: 'var(--sev-ok)', description: 'Real-time congestion' },
  { id: 'weather', label: 'Weather Radar', icon: Cloud, group: 'Live Conditions', colorVar: 'var(--sev-info)', description: 'Precipitation overlay' },
  { id: 'p1audio', label: 'P1 Audio Alert', icon: Volume2, group: 'Live Conditions', colorVar: 'var(--sev-critical)', description: 'Chirp on new P1 calls', pinned: true },
  { id: 'autopan', label: 'Auto-Pan P1', icon: Siren, group: 'Live Conditions', colorVar: 'var(--sev-critical)', description: 'Pan to new Priority 1 calls', pinned: true },
  { id: 'geofences', label: 'Geofence Zones', icon: Shield, group: 'Live Conditions', colorVar: 'var(--sev-critical)', description: 'Premise alerts on click', pinned: true },

  // ── Units & Calls ──
  { id: 'breadcrumbs', label: 'Unit Trails', icon: Footprints, group: 'Units & Calls', colorVar: 'var(--sev-info)', description: 'GPS history (B)' },
  { id: 'clustering', label: 'Call Clusters', icon: Boxes, group: 'Units & Calls', colorVar: 'var(--accent-silver-400)', description: 'Group markers (C)' },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle, group: 'Units & Calls', colorVar: 'var(--sev-critical)', description: 'RMS incident clusters' },
  { id: 'repeat-addresses', label: 'Repeat Addresses', icon: History, group: 'Units & Calls', colorVar: 'var(--sev-ok)', description: 'Locations with 3+ calls' },
  { id: 'selfpos', label: 'My Position', icon: Locate, group: 'Units & Calls', colorVar: 'var(--sev-info)', description: 'Show my own GPS position' },

  // ── Historical Analysis ──
  { id: 'heatmap', label: 'Crime Heatmap', icon: Radar, group: 'Historical Analysis', colorVar: 'var(--sev-critical)', description: 'Incident density (H) — click label to switch Live/Historical' },
  { id: 'call-history', label: 'Call History', icon: History, group: 'Historical Analysis', colorVar: 'var(--sev-ok)', description: 'Past 30 days of calls' },
  { id: 'speed-heatmap', label: 'Speed Heatmap', icon: Gauge, group: 'Historical Analysis', colorVar: 'var(--sev-high)', description: 'GPS speed density' },
  { id: 'speed-violations', label: 'Speed Violations', icon: Zap, group: 'Historical Analysis', colorVar: 'var(--sev-critical)', description: 'Recent high-speed events — click a marker for the speed graph' },
  { id: 'pursuit-segments', label: 'Pursuit Tracks', icon: Route, group: 'Historical Analysis', colorVar: 'var(--sev-critical)', description: 'Recent vehicle/foot pursuit paths' },
  { id: 'response-time', label: 'Response Time by Beat', icon: Timer, group: 'Historical Analysis', colorVar: 'var(--sev-ok)', description: '30-day avg response time (historical)' },

  // ── Risk & Coverage ──
  { id: 'coverage-gaps', label: 'Coverage Gaps', icon: SquareDashed, group: 'Risk & Coverage', colorVar: 'var(--sev-high)', description: 'Response-time gap grid' },
  { id: 'safety-zones', label: 'Safety Zones', icon: Shield, group: 'Risk & Coverage', colorVar: 'var(--sev-critical)', description: 'Risk-weighted call clusters' },
  { id: 'isochrone', label: 'Response Zones', icon: Hexagon, group: 'Risk & Coverage', colorVar: 'var(--sev-ok)', description: '5/10/15 min driving' },

  // ── Terrain & 3D ──
  { id: 'terrain', label: '3D Terrain', icon: Mountain, group: 'Terrain & 3D', colorVar: 'var(--sev-special)', description: 'Elevation relief' },
  { id: 'buildings', label: '3D Buildings', icon: Boxes, group: 'Terrain & 3D', colorVar: 'var(--text-secondary)', description: 'Extruded building footprints' },
  { id: 'daylight', label: 'Day/Night', icon: Sun, group: 'Terrain & 3D', colorVar: 'var(--sev-warn)', description: 'Solar terminator (D)' },
  { id: 'projection', label: 'Projection', icon: Globe, group: 'Terrain & 3D', colorVar: 'var(--sev-ok)', description: 'Globe / Mercator / Equal Earth' },
  { id: 'atmosphere', label: 'Atmosphere', icon: Cloud, group: 'Terrain & 3D', colorVar: 'var(--sev-special)', description: 'Fog, sky & star effects' },
  { id: 'grid', label: 'Coordinate Grid', icon: Grid3x3, group: 'Terrain & 3D', colorVar: 'var(--accent-silver-400)', description: 'Lat/Lng graticule (G)' },
  { id: 'orbit', label: 'Orbit Animation', icon: Move3d, group: 'Terrain & 3D', colorVar: 'var(--sev-warn)', description: 'Cinematic map rotation' },

  // ── Dispatch Tools ──
  { id: 'directions', label: 'Live Directions', icon: Navigation, group: 'Dispatch Tools', colorVar: 'var(--sev-info)', description: 'Point-to-point routing engine' },
  { id: 'nav-overlay', label: 'Manual Route', icon: Waypoints, group: 'Dispatch Tools', colorVar: 'var(--sev-info)', description: 'Draw a route between two typed coordinates' },
  { id: 'identify', label: 'Identify', icon: Crosshair, group: 'Dispatch Tools', colorVar: 'var(--sev-warn)', description: 'Click the map for place/district info' },
  { id: 'places', label: 'Places Search', icon: Search, group: 'Dispatch Tools', colorVar: 'var(--sev-ok)', description: 'Nearby POI search' },
  { id: 'bookmarks', label: 'Drop Bookmark', icon: Star, group: 'Dispatch Tools', colorVar: 'var(--sev-warn)', description: 'Click the map to save a location' },
  { id: 'gps-hud', label: 'GPS HUD', icon: GaugeIcon, group: 'Dispatch Tools', colorVar: 'var(--sev-ok)', description: 'Heading, speed, route progress' },
  { id: 'optimize', label: 'Route Optimizer', icon: Compass, group: 'Dispatch Tools', colorVar: 'var(--sev-special)', description: 'Queue calls, pick a unit, optimize the visiting order' },

  // ── Measurement & Marking ──
  { id: 'measure', label: 'Measure', icon: Ruler, group: 'Measurement & Marking', colorVar: 'var(--sev-info)', description: 'Distance / area measurement' },
  { id: 'buffer-ring', label: 'Buffer Ring', icon: CircleDot, group: 'Measurement & Marking', colorVar: 'var(--sev-high)', description: 'Radius rings around a point' },
  { id: 'annotation', label: 'Annotations', icon: MapPin, group: 'Measurement & Marking', colorVar: 'var(--sev-info)', description: 'Pin notes on the map' },

  // ── Drawing & Tracking ──
  { id: 'draw', label: 'Quick Draw', icon: PenTool, group: 'Drawing & Tracking', colorVar: 'var(--accent-silver-400)', description: 'Polygon / polyline / circle — session-only, not saved' },
  { id: 'gl-draw', label: 'Draw & Edit', icon: Brush, group: 'Drawing & Tracking', colorVar: 'var(--accent-silver-400)', description: 'Vertex editing — select and reshape existing shapes' },
  { id: 'draw-geofence', label: 'Create Geofence Zone', icon: Hexagon, group: 'Drawing & Tracking', colorVar: 'var(--sev-special)', description: 'Saves a named alert/exclusion zone' },
  { id: 'gps-replay', label: 'GPS Replay', icon: PlayCircle, group: 'Drawing & Tracking', colorVar: 'var(--sev-ok)', description: "Scrub a unit's GPS history on a timeline" },
  { id: 'speed-analytics', label: 'Speed Analytics Panel', icon: LineChart, group: 'Drawing & Tracking', colorVar: 'var(--sev-high)', description: 'Per-beat speed stats + coverage timeline' },

  // ── Diagnostics ──
  { id: 'inspect', label: 'Feature Inspector', icon: Wrench, group: 'Diagnostics', colorVar: 'var(--sev-special)', description: 'Click features for details' },
  { id: 'mapmatch', label: 'Map Match Trace', icon: Anchor, group: 'Diagnostics', colorVar: 'var(--sev-high)', description: 'Snap GPS to roads' },
  { id: 'deck', label: 'GPU Overlay', icon: Layers, group: 'Diagnostics', colorVar: 'var(--sev-special)', description: 'Deck.gl accelerated rendering' },
  { id: 'perf-hud', label: 'Performance HUD', icon: Activity, group: 'Diagnostics', colorVar: 'var(--sev-high)', description: 'FPS, layer count, render timing' },
  { id: 'mapbox-status', label: 'Mapbox API Status', icon: Radio, group: 'Diagnostics', colorVar: 'var(--sev-info)', description: 'Directions/Matrix/Geocoding diagnostics for the queued call' },
];

// Boundary entries are DERIVED from the very config arrays MapboxMapPage
// consumes, so adding a district level or a GeoJSON layer can never leave the
// registry stale. Only icon + color (absent from those configs) live here.
const BOUNDARY_LAYERS: MapLayerDef[] = [
  ...HIERARCHY_CONFIGS.map((cfg): MapLayerDef => ({
    id: `district-${cfg.id}`,
    label: cfg.label,
    icon: Hexagon,
    group: 'Administrative Boundaries',
    colorVar: 'var(--accent-silver-400)',
    description: cfg.description,
  })),
  ...GEO_LAYER_CONFIGS.map((cfg): MapLayerDef => ({
    id: `geo-${cfg.id}`,
    label: cfg.label,
    icon: Layers,
    group: 'Administrative Boundaries',
    colorVar: 'var(--accent-silver-400)',
    description: cfg.file.replace('.geojson', ''),
  })),
];

export const MAP_LAYER_REGISTRY: MapLayerDef[] = [...STATIC_LAYERS, ...BOUNDARY_LAYERS];

export const LAYER_BY_ID: ReadonlyMap<string, MapLayerDef> = new Map(
  MAP_LAYER_REGISTRY.map((l) => [l.id, l]),
);
```

- [ ] **Step 4: Verify the CSS variables actually exist in all four theme blocks**

Run:

```bash
cd client && for v in --sev-ok --sev-critical --sev-high --sev-warn --sev-special --sev-info --accent-silver-400 --text-secondary; do printf '%s: %s\n' "$v" "$(grep -c -- "$v:" src/styles/theme-palettes.css)"; done
```

Expected: each variable reports a count of **4 or more** (one definition per theme block). A count below 4 means the color silently drops in at least one theme — if so, add the missing definitions to `theme-palettes.css` before continuing, and note it in the commit.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/config/__tests__/layerRegistry.test.ts`
Expected: PASS — 9 tests. If the count assertion fails, do not change the assertion to match; find the missing or duplicated entry.

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: clean. A "no exported member `GEO_LAYER_CONFIGS`" error means the constant is not exported from `useGeoJsonLayers.ts` — add `export` to its declaration.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/config/layerRegistry.ts client/src/pages/map/config/__tests__/layerRegistry.test.ts
git commit -m "feat(map): add declarative layer registry with icons and theme colors"
```

---

### Task 3: DockToggleRow — icon, density, switch semantics

**Files:**
- Modify: `client/src/pages/map/components/DockSection.tsx`
- Test: `client/src/pages/map/components/__tests__/DockSection.test.tsx` (exists — add cases)

**Interfaces:**
- Consumes: `useMapDensity()` from Task 1.
- Produces: `DockToggleItem` gains `icon?: LucideIcon`. All other fields keep their current names and types (`id`, `label`, `active`, `onToggle`, `color?`, `description?`, `loading?`, `error?`, `pinned?`).

The `color` field stays a `string` and continues to accept `var(--x)`; the registry now
always supplies a variable, and `withAlpha()` already handles both forms.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/pages/map/components/__tests__/DockSection.test.tsx`:

```tsx
import { Cloud } from 'lucide-react';
import { MapDensityProvider } from '../../hooks/useMapDensity';

describe('DockToggleRow accessibility and density', () => {
  const baseItem = {
    id: 'weather',
    label: 'Weather Radar',
    active: false,
    onToggle: () => {},
    color: 'var(--sev-info)',
    description: 'Precipitation overlay',
    icon: Cloud,
  };

  it('exposes switch semantics so keyboard and screen-reader users can toggle it', () => {
    render(<DockToggleRow item={baseItem} />);
    const row = screen.getByRole('switch', { name: /weather radar/i });
    expect(row).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects the active state in aria-checked', () => {
    render(<DockToggleRow item={{ ...baseItem, active: true }} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onToggle when activated', async () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ ...baseItem, onToggle }} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders a 44px minimum row height in touch density', () => {
    render(
      <MapDensityProvider initialOverride="touch">
        <DockToggleRow item={baseItem} />
      </MapDensityProvider>,
    );
    expect(screen.getByRole('switch')).toHaveStyle({ minHeight: '44px' });
  });

  it('renders the compact row height by default', () => {
    render(
      <MapDensityProvider initialOverride="compact">
        <DockToggleRow item={baseItem} />
      </MapDensityProvider>,
    );
    expect(screen.getByRole('switch')).toHaveStyle({ minHeight: '24px' });
  });

  it('still renders when a layer has no icon', () => {
    const { icon: _icon, ...noIcon } = baseItem;
    render(<DockToggleRow item={noIcon} />);
    expect(screen.getByRole('switch', { name: /weather radar/i })).toBeInTheDocument();
  });
});
```

Ensure the file's existing imports include `userEvent` from `@testing-library/user-event`
and `vi` from `vitest`; add them if absent.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/DockSection.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "switch"` (the row is currently a plain `<button>`).

- [ ] **Step 3: Rewrite `DockToggleRow`**

In `client/src/pages/map/components/DockSection.tsx`, add to the imports:

```tsx
import type { LucideIcon } from 'lucide-react';
import { useMapDensity } from '../hooks/useMapDensity';
```

Add the icon field to the interface:

```tsx
export interface DockToggleItem {
  id: string;
  label: string;
  active: boolean;
  onToggle: () => void;
  color?: string;
  description?: string;
  loading?: boolean;
  /** Set when the layer's most recent data fetch failed — renders a red
   *  alert icon in place of the loading spinner and replaces the tooltip. */
  error?: string | null;
  /** Renders a colored left-border accent so this toggle's state stays
   *  glanceable even among other rows — for safety-critical items. */
  pinned?: boolean;
  /** Leading icon from the layer registry. Optional so a row still renders
   *  if a caller supplies an ad-hoc item outside the registry. */
  icon?: LucideIcon;
}
```

Replace the whole `DockToggleRow` function with:

```tsx
export function DockToggleRow({ item }: { item: DockToggleItem }) {
  const { tokens } = useMapDensity();
  const dotColor = item.color ?? 'var(--brand-gold)';
  // Previously guarded with `.startsWith('#')` and fell back to the opaque
  // color, which was valid CSS but silently dropped the glow's transparency for
  // every token-valued dot. withAlpha keeps the alpha in both cases.
  const glowColor = withAlpha(dotColor, '80');
  const Icon = item.icon;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={item.active}
      onClick={item.onToggle}
      title={item.error || item.description}
      className="w-full flex items-center gap-2 px-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-silver-400)]"
      style={{
        minHeight: tokens.rowMinHeight,
        paddingTop: tokens.rowPaddingY,
        paddingBottom: tokens.rowPaddingY,
        fontSize: tokens.labelSize,
        background: item.active ? 'var(--surface-raised)' : 'transparent',
        color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderLeft: item.pinned ? `3px solid ${dotColor}` : undefined,
      }}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className="shrink-0"
          style={{
            width: tokens.iconPx,
            height: tokens.iconPx,
            color: item.active ? dotColor : 'var(--text-secondary)',
            filter: item.active ? `drop-shadow(0 0 3px ${glowColor})` : undefined,
          }}
        />
      ) : (
        <span
          className="w-1.5 h-1.5 shrink-0"
          style={{
            borderRadius: '50%',
            background: item.active ? dotColor : 'var(--text-secondary)',
            boxShadow: item.active ? `0 0 4px ${glowColor}` : 'none',
          }}
        />
      )}
      <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
      {item.error ? (
        <AlertCircle className="w-3 h-3 shrink-0" style={{ color: 'var(--sev-critical)' }} />
      ) : (
        item.loading && <Loader2 className="w-3 h-3 shrink-0 animate-spin" style={{ color: 'var(--brand-gold)' }} />
      )}
    </button>
  );
}
```

Note the `#ef4444` fallback on `--sev-critical` is dropped — the variable is defined in
all four theme blocks, so the fallback was dead code that would have masked a missing
definition rather than surfacing it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/DockSection.test.tsx`
Expected: PASS — the pre-existing cases plus the 6 new ones.

- [ ] **Step 5: Run the full client suite**

Run: `cd client && npx vitest run`
Expected: all pass. Any other test asserting on the old dot markup or on `role="button"`
for these rows must be updated to the switch role — that is a legitimate test update, not
a regression.

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/components/DockSection.tsx client/src/pages/map/components/__tests__/DockSection.test.tsx
git commit -m "feat(map): give dock toggles icons, switch semantics, and density sizing"
```

---

### Task 4: Bind the registry into MapboxMapPage

The risky step. Mechanical only — no behavior changes in this commit.

**Files:**
- Create: `client/src/pages/map/hooks/useLayerBindings.ts`
- Test: `client/src/pages/map/hooks/__tests__/useLayerBindings.test.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (the two `useMemo` blocks at ~1098–1226, and the shell render)

**Interfaces:**
- Consumes: `MAP_LAYER_REGISTRY`, `LAYER_BY_ID`, `LEFT_DOCK_GROUPS`, `RIGHT_DOCK_GROUPS`, `MapLayerGroup` from Task 2; `DockToggleItem` from Task 3.
- Produces:
  - `interface LayerBinding { active: boolean; onToggle: () => void; loading?: boolean; error?: string | null; label?: string }`
  - `type LayerBindingMap = Record<string, LayerBinding>`
  - `function buildDockSections(groups: MapLayerGroup[], bindings: LayerBindingMap): { title: MapLayerGroup; items: DockToggleItem[]; collapsible?: boolean }[]`
  - `function findUnboundLayers(bindings: LayerBindingMap): { missingBinding: string[]; unknownBinding: string[] }`

`buildDockSections` is a pure function, which is what makes the completeness property
testable without rendering the 1,893-line page.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/hooks/__tests__/useLayerBindings.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildDockSections, findUnboundLayers, type LayerBindingMap } from '../useLayerBindings';
import { MAP_LAYER_REGISTRY, LEFT_DOCK_GROUPS, RIGHT_DOCK_GROUPS } from '../../config/layerRegistry';

function allBindings(): LayerBindingMap {
  const map: LayerBindingMap = {};
  for (const layer of MAP_LAYER_REGISTRY) {
    map[layer.id] = { active: false, onToggle: vi.fn() };
  }
  return map;
}

describe('buildDockSections', () => {
  it('emits one section per requested group, in order', () => {
    const sections = buildDockSections(LEFT_DOCK_GROUPS, allBindings());
    expect(sections.map((s) => s.title)).toEqual(LEFT_DOCK_GROUPS);
  });

  it('places every registry entry into exactly one dock section', () => {
    const bindings = allBindings();
    const all = [
      ...buildDockSections(LEFT_DOCK_GROUPS, bindings),
      ...buildDockSections(RIGHT_DOCK_GROUPS, bindings),
    ];
    const ids = all.flatMap((s) => s.items.map((i) => i.id));
    expect(ids.sort()).toEqual(MAP_LAYER_REGISTRY.map((l) => l.id).sort());
  });

  it('carries icon, color, and description through from the registry', () => {
    const [section] = buildDockSections(['Live Conditions'], allBindings());
    const traffic = section.items.find((i) => i.id === 'traffic')!;
    expect(traffic.icon).toBeTruthy();
    expect(traffic.color).toBe('var(--sev-ok)');
    expect(traffic.description).toBe('Real-time congestion');
  });

  it('lets a binding override the label for computed-label layers', () => {
    const bindings = allBindings();
    bindings.heatmap = { ...bindings.heatmap, label: 'Crime Heatmap (Live)' };
    const [section] = buildDockSections(['Historical Analysis'], bindings);
    expect(section.items.find((i) => i.id === 'heatmap')!.label).toBe('Crime Heatmap (Live)');
  });

  it('falls back to the registry label when no override is supplied', () => {
    const [section] = buildDockSections(['Historical Analysis'], allBindings());
    expect(section.items.find((i) => i.id === 'heatmap')!.label).toBe('Crime Heatmap');
  });

  it('omits a layer that has no binding rather than rendering a dead toggle', () => {
    const bindings = allBindings();
    delete bindings.traffic;
    const [section] = buildDockSections(['Live Conditions'], bindings);
    expect(section.items.some((i) => i.id === 'traffic')).toBe(false);
  });

  it('keeps Live Conditions non-collapsible so safety toggles stay visible', () => {
    const [section] = buildDockSections(['Live Conditions'], allBindings());
    expect(section.collapsible).toBe(false);
  });
});

describe('findUnboundLayers', () => {
  it('reports nothing when every registry entry is bound', () => {
    expect(findUnboundLayers(allBindings())).toEqual({ missingBinding: [], unknownBinding: [] });
  });

  it('reports a registry entry that the page forgot to bind', () => {
    const bindings = allBindings();
    delete bindings.traffic;
    expect(findUnboundLayers(bindings).missingBinding).toContain('traffic');
  });

  it('reports a binding whose id is not in the registry', () => {
    const bindings = allBindings();
    bindings['ghost-layer'] = { active: false, onToggle: vi.fn() };
    expect(findUnboundLayers(bindings).unknownBinding).toContain('ghost-layer');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/hooks/__tests__/useLayerBindings.test.ts`
Expected: FAIL — `Failed to resolve import "../useLayerBindings"`.

- [ ] **Step 3: Write the implementation**

Create `client/src/pages/map/hooks/useLayerBindings.ts`:

```ts
// ============================================================
// RMPG Flex — Layer Bindings
// Joins the declarative layer registry (presentation) to the page's
// live state (behavior) and emits the DockToggleItem[] the existing
// dock renderers already consume.
//
// buildDockSections is a PURE function on purpose: it lets the
// registry-completeness property be tested without mounting the
// 1,893-line MapboxMapPage.
// ============================================================

import type { DockToggleItem } from '../components/DockSection';
import {
  LAYER_BY_ID, MAP_LAYER_REGISTRY, type MapLayerGroup,
} from '../config/layerRegistry';

export interface LayerBinding {
  active: boolean;
  onToggle: () => void;
  loading?: boolean;
  error?: string | null;
  /** Overrides the registry label for layers that interpolate live state
   *  (heatmap mode, projection, atmosphere preset). */
  label?: string;
}

export type LayerBindingMap = Record<string, LayerBinding>;

export interface DockSectionData {
  title: MapLayerGroup;
  items: DockToggleItem[];
  collapsible?: boolean;
}

/** Safety-critical toggles must never hide inside a collapsed section. */
const NON_COLLAPSIBLE_GROUPS: ReadonlySet<MapLayerGroup> = new Set<MapLayerGroup>([
  'Live Conditions',
]);

export function buildDockSections(
  groups: MapLayerGroup[],
  bindings: LayerBindingMap,
): DockSectionData[] {
  return groups.map((group) => ({
    title: group,
    collapsible: NON_COLLAPSIBLE_GROUPS.has(group) ? false : undefined,
    items: MAP_LAYER_REGISTRY
      .filter((layer) => layer.group === group && bindings[layer.id] !== undefined)
      .map((layer): DockToggleItem => {
        const binding = bindings[layer.id];
        return {
          id: layer.id,
          label: binding.label ?? layer.label,
          icon: layer.icon,
          color: layer.colorVar,
          description: layer.description,
          pinned: layer.pinned,
          active: binding.active,
          onToggle: binding.onToggle,
          loading: binding.loading,
          error: binding.error,
        };
      }),
  }));
}

/**
 * Development guard against the one way this refactor can fail silently:
 * a layer that exists in the registry but was never wired up (renders
 * nothing), or a binding whose id was typo'd (renders nothing, no error).
 */
export function findUnboundLayers(bindings: LayerBindingMap): {
  missingBinding: string[];
  unknownBinding: string[];
} {
  const missingBinding = MAP_LAYER_REGISTRY
    .filter((l) => bindings[l.id] === undefined)
    .map((l) => l.id);
  const unknownBinding = Object.keys(bindings).filter((id) => !LAYER_BY_ID.has(id));
  return { missingBinding, unknownBinding };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/hooks/__tests__/useLayerBindings.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit the pure layer before touching the page**

```bash
git add client/src/pages/map/hooks/useLayerBindings.ts client/src/pages/map/hooks/__tests__/useLayerBindings.test.ts
git commit -m "feat(map): add pure layer-binding join between registry and page state"
```

- [ ] **Step 6: Replace the section arrays in MapboxMapPage**

In `client/src/pages/map/MapboxMapPage.tsx`, add imports:

```tsx
import { buildDockSections, type LayerBindingMap } from './hooks/useLayerBindings';
import { LEFT_DOCK_GROUPS, RIGHT_DOCK_GROUPS } from './config/layerRegistry';
import { MapDensityProvider } from './hooks/useMapDensity';
```

Replace the entire `mapLeftDockSections` and `mapRightDockSections` `useMemo` blocks
(currently ~lines 1098–1226) with a single bindings map plus two derived section lists.
Copy each `active` / `onToggle` / `loading` / `error` expression **verbatim** from the
array entry it replaces — this step must change no behavior:

```tsx
  // Behavior only. Presentation (label, icon, color, description, pinned,
  // grouping) now lives in config/layerRegistry.ts. Keys MUST match registry ids;
  // useLayerBindings.findUnboundLayers() is the test-time guard against a typo.
  const layerBindings = useMemo<LayerBindingMap>(() => ({
    // ── Live Conditions ──
    traffic: { active: traffic.enabled, onToggle: traffic.toggle },
    weather: { active: weatherRadar.enabled, onToggle: weatherRadar.toggle },
    p1audio: { active: p1AudioEnabled, onToggle: () => setP1AudioEnabled((v: boolean) => !v) },
    autopan: { active: autoPanEnabled, onToggle: () => setAutoPanEnabled((v: boolean) => !v) },
    geofences: { active: geofenceAlerts.enabled, onToggle: geofenceAlerts.toggle },

    // ── Units & Calls ──
    breadcrumbs: { active: breadcrumbs.enabled, onToggle: breadcrumbs.toggle },
    clustering: { active: clustering.enabled, onToggle: clustering.toggle },
    incidents: { active: incidentsEnabled, onToggle: () => setIncidentsEnabled((v) => !v), loading: incidentsLayer.loading, error: incidentsLayer.error },
    'repeat-addresses': { active: repeatAddressesEnabled, onToggle: () => setRepeatAddressesEnabled((v) => !v), loading: repeatAddresses.loading, error: repeatAddresses.error },
    selfpos: { active: selfPosVisible, onToggle: () => setSelfPosVisible((v: boolean) => !v) },

    // ── Historical Analysis ──
    heatmap: {
      active: heatmap.enabled,
      onToggle: () => { void populateAndToggleHeatmap(); },
      label: `Crime Heatmap (${heatmapMode === 'live' ? 'Live' : 'Historical'})`,
    },
    'call-history': { active: historyCallsEnabled, onToggle: () => setHistoryCallsEnabled((v) => !v), loading: historyCalls.loading, error: historyCalls.error },
    'speed-heatmap': { active: speedHeatmapEnabled, onToggle: () => setSpeedHeatmapEnabled((v) => !v), loading: speedHeatmap.loading, error: speedHeatmap.error },
    'speed-violations': { active: speedViolationsEnabled, onToggle: () => setSpeedViolationsEnabled((v) => !v), loading: speedViolationsLayer.loading, error: speedViolationsLayer.error },
    'pursuit-segments': { active: pursuitSegmentsEnabled, onToggle: () => setPursuitSegmentsEnabled((v) => !v), loading: pursuitSegmentsLayer.loading, error: pursuitSegmentsLayer.error },
    'response-time': { active: responseTimeEnabled, onToggle: () => setResponseTimeEnabled((v) => !v), loading: responseTime.loading, error: responseTime.error },

    // ── Administrative Boundaries (ids derived the same way the registry derives them) ──
    ...Object.fromEntries(districtHierarchy.hierarchyConfigs.map((cfg) => [
      `district-${cfg.id}`,
      {
        active: districtHierarchy.hierarchyStates[cfg.id]?.visible ?? false,
        onToggle: () => districtHierarchy.toggleHierarchyLayer(cfg.id),
      },
    ])),
    ...Object.fromEntries(geoJsonLayers.configs.map((cfg) => [
      `geo-${cfg.id}`,
      {
        active: geoJsonLayers.layerStates[cfg.id]?.visible ?? false,
        onToggle: () => geoJsonLayers.toggleGeoLayer(cfg.id),
      },
    ])),

    // ── Risk & Coverage ──
    'coverage-gaps': { active: coverageGapsEnabled, onToggle: () => setCoverageGapsEnabled((v) => !v), loading: coverageGaps.loading, error: coverageGaps.error },
    'safety-zones': { active: safetyZonesEnabled, onToggle: () => setSafetyZonesEnabled((v) => !v), loading: safetyZones.loading, error: safetyZones.error },
    isochrone: { active: isochroneEnabled, onToggle: toggleIsochrone },

    // ── Terrain & 3D ──
    terrain: { active: terrainEnabled, onToggle: () => setTerrainEnabled((v: boolean) => !v) },
    buildings: { active: buildings3dEnabled, onToggle: () => setBuildings3dEnabled((v: boolean) => !v) },
    daylight: { active: daylight.enabled, onToggle: daylight.toggle },
    projection: { active: projection.projection !== 'mercator', onToggle: projection.cycle, label: `Projection: ${projection.projection}` },
    atmosphere: { active: atmosphere.enabled, onToggle: atmosphere.cycle, label: `Atmosphere: ${atmosphere.preset}` },
    grid: { active: coordGrid.enabled, onToggle: coordGrid.toggle },
    orbit: { active: cameraAnimation.animating, onToggle: () => cameraAnimation.animating ? cameraAnimation.stop() : cameraAnimation.orbit() },

    // ── Dispatch Tools ──
    directions: { active: directionsPanel.result !== null, onToggle: () => directionsPanel.result ? directionsPanel.clearDirections() : directionsPanel.setPickMode('origin') },
    'nav-overlay': { active: activeFloatingTool === 'nav-overlay', onToggle: () => setActiveFloatingTool((v) => v === 'nav-overlay' ? null : 'nav-overlay') },
    identify: { active: identifyEnabled, onToggle: () => setIdentifyEnabled((v) => !v), loading: tilequery.loading },
    places: { active: placesSearch.results.length > 0, onToggle: () => placesSearch.results.length > 0 ? placesSearch.clearResults() : placesSearch.searchCategory('restaurant') },
    bookmarks: { active: mapBookmarks.dropMode, onToggle: () => mapBookmarks.setDropMode(!mapBookmarks.dropMode) },
    'gps-hud': { active: gpsHudOpen, onToggle: () => setGpsHudOpen((v) => !v) },
    optimize: { active: multiStopPanelOpen, onToggle: () => setMultiStopPanelOpen((v) => !v) },

    // ── Measurement & Marking ──
    measure: { active: measure.mode !== 'none', onToggle: () => setShowMeasureMenu((v) => !v) },
    'buffer-ring': { active: activeFloatingTool === 'buffer-ring', onToggle: () => setActiveFloatingTool((v) => v === 'buffer-ring' ? null : 'buffer-ring') },
    annotation: { active: activeFloatingTool === 'annotation', onToggle: () => setActiveFloatingTool((v) => v === 'annotation' ? null : 'annotation') },

    // ── Drawing & Tracking ──
    draw: { active: drawing.mode !== 'none', onToggle: () => setShowDrawMenu((v) => !v) },
    'gl-draw': { active: glDraw.enabled, onToggle: () => glDraw.toggle() },
    'draw-geofence': { active: activeFloatingTool === 'draw-geofence', onToggle: () => setActiveFloatingTool((v) => v === 'draw-geofence' ? null : 'draw-geofence') },
    'gps-replay': { active: activeFloatingTool === 'gps-replay', onToggle: () => setActiveFloatingTool((v) => v === 'gps-replay' ? null : 'gps-replay') },
    'speed-analytics': { active: speedAnalyticsPanelOpen, onToggle: () => setSpeedAnalyticsPanelOpen((v) => !v), loading: speedZoneStats.loading },

    // ── Diagnostics ──
    inspect: { active: featureInspect.enabled, onToggle: featureInspect.toggle },
    mapmatch: { active: mapMatchTrace.collecting, onToggle: () => mapMatchTrace.collecting ? mapMatchTrace.clear() : mapMatchTrace.startCollecting() },
    deck: { active: deckEnabled, onToggle: () => setDeckEnabled((v: boolean) => !v) },
    'perf-hud': { active: diagnosticsOpen, onToggle: () => setDiagnosticsOpen((v) => !v) },
    'mapbox-status': { active: dispatchConnectionsOpen, onToggle: () => setDispatchConnectionsOpen((v) => !v) },
  }), [
    traffic, weatherRadar, p1AudioEnabled, setP1AudioEnabled, autoPanEnabled, setAutoPanEnabled,
    geofenceAlerts, breadcrumbs, clustering, incidentsEnabled, incidentsLayer.loading,
    incidentsLayer.error, repeatAddressesEnabled, repeatAddresses.loading, repeatAddresses.error,
    selfPosVisible, setSelfPosVisible, heatmap, populateAndToggleHeatmap, heatmapMode,
    historyCallsEnabled, historyCalls.loading, historyCalls.error, speedHeatmapEnabled,
    speedHeatmap.loading, speedHeatmap.error, speedViolationsEnabled, speedViolationsLayer.loading,
    speedViolationsLayer.error, pursuitSegmentsEnabled, pursuitSegmentsLayer.loading,
    pursuitSegmentsLayer.error, responseTimeEnabled, responseTime.loading, responseTime.error,
    districtHierarchy, geoJsonLayers, coverageGapsEnabled, coverageGaps.loading, coverageGaps.error,
    safetyZonesEnabled, safetyZones.loading, safetyZones.error, isochroneEnabled, toggleIsochrone,
    terrainEnabled, setTerrainEnabled, buildings3dEnabled, setBuildings3dEnabled, daylight,
    projection, atmosphere, coordGrid, cameraAnimation, directionsPanel, activeFloatingTool,
    setActiveFloatingTool, identifyEnabled, tilequery.loading, placesSearch, mapBookmarks,
    gpsHudOpen, setGpsHudOpen, multiStopPanelOpen, measure.mode, setShowMeasureMenu, drawing.mode,
    setShowDrawMenu, glDraw, speedAnalyticsPanelOpen, speedZoneStats.loading, featureInspect,
    mapMatchTrace, deckEnabled, setDeckEnabled, diagnosticsOpen, setDiagnosticsOpen,
    dispatchConnectionsOpen, setDispatchConnectionsOpen,
  ]);

  const mapLeftDockSections = useMemo(
    () => buildDockSections(LEFT_DOCK_GROUPS, layerBindings),
    [layerBindings],
  );
  const mapRightDockSections = useMemo(
    () => buildDockSections(RIGHT_DOCK_GROUPS, layerBindings),
    [layerBindings],
  );
```

Two deliberate simplifications, both behavior-preserving:
- `bookmarks.onToggle` collapses `dropMode ? setDropMode(false) : setDropMode(true)` to `setDropMode(!dropMode)`.
- The `deck` description no longer varies on `deckSupportsProjection`. If that conditional hint matters, keep it by adding `label`/binding support rather than reintroducing a description override — but leaving it static is correct for this PR since the registry description is the fallback and no user-visible copy changes materially.

If `MapLeftDockSection` / `MapRightDockSection` type imports become unused, remove them.
`DockSectionData['title']` is `MapLayerGroup` (a string union), which is assignable to the
docks' `title: string`.

- [ ] **Step 7: Wrap the map shell in the density provider**

Find the outermost returned element of `MapboxMapPage` and wrap it:

```tsx
  return (
    <MapDensityProvider>
      {/* …existing shell… */}
    </MapDensityProvider>
  );
```

- [ ] **Step 8: Add the page-level completeness test**

Append to `client/src/pages/map/hooks/__tests__/useLayerBindings.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Guards the one silent failure mode of this refactor: a registry entry the
// page never binds (renders nothing, no error) or a typo'd binding key.
// Reading the source is deliberate — mounting MapboxMapPage requires a live
// Mapbox GL context, which is not available in jsdom.
describe('MapboxMapPage binding coverage', () => {
  it('binds every registry layer id', () => {
    const src = readFileSync(
      resolve(__dirname, '../../MapboxMapPage.tsx'),
      'utf8',
    );
    const bindingBlock = src.slice(
      src.indexOf('const layerBindings'),
      src.indexOf('const mapLeftDockSections'),
    );
    expect(bindingBlock.length, 'layerBindings block not found').toBeGreaterThan(0);

    const dynamic = new Set(['district-', 'geo-']);
    const missing = MAP_LAYER_REGISTRY
      .filter((l) => ![...dynamic].some((p) => l.id.startsWith(p)))
      .filter((l) => !bindingBlock.includes(`'${l.id}'`) && !new RegExp(`\\b${l.id}\\s*:`).test(bindingBlock))
      .map((l) => l.id);

    expect(missing, `unbound registry layers: ${missing.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 9: Run the full client suite**

Run: `cd client && npx vitest run`
Expected: all pass.

- [ ] **Step 10: Typecheck and build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: clean typecheck; successful build.

- [ ] **Step 11: Verify in the browser — this is the real gate**

Start the dev server via the preview tooling (never `npm run dev` in a raw shell) and open the Map tab. Confirm:
- All 10 dock sections render, with the same layer names as before.
- The Administrative Boundaries section shows 9 entries (3 district levels + 6 GeoJSON layers).
- Every row now shows a leading icon.
- Toggling three layers from different groups still turns the corresponding map layers on and off.
- `Crime Heatmap (Live)`, `Projection: mercator`, and `Atmosphere: …` still show their computed labels.
- The browser console has no new errors.

- [ ] **Step 12: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx client/src/pages/map/hooks/__tests__/useLayerBindings.test.ts
git commit -m "refactor(map): drive dock sections from the layer registry"
```

---

### Task 5: Route the marker glyph fill through the theme

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts:72`
- Test: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts` (exists — add a case)

**Interfaces:** No signature changes. `UNIT_GLYPH_SVG` becomes a function of the resolved fill color, or the fill is set via CSS on the containing element.

This is a DOM-rendered glyph, **not** a Mapbox paint property, so the theme variable is
correct here. Do not apply this pattern to `mapboxBasemap.ts`.

- [ ] **Step 1: Write the failing test**

Append to `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('unit marker glyph theming', () => {
  it('does not hardcode the glyph fill hex', () => {
    const src = readFileSync(resolve(__dirname, '../mapMarkers.ts'), 'utf8');
    expect(src).not.toContain('#0d1520');
  });

  it('resolves the glyph fill from a theme variable', () => {
    const src = readFileSync(resolve(__dirname, '../mapMarkers.ts'), 'utf8');
    expect(src).toMatch(/var\(--surface-sunken\)|currentColor/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: FAIL — `expected '…#0d1520…' not to contain '#0d1520'`.

- [ ] **Step 3: Implement**

In `client/src/pages/map/utils/mapMarkers.ts`, replace lines 72–73:

```ts
// Fill is `currentColor` so the glyph inherits from the badge element, whose
// color is set from a theme variable below. This keeps the marker inside the
// theme system. NOTE: this is a DOM-rendered SVG, not a Mapbox paint property —
// paint properties must keep literal hex, because var() blanks a Mapbox map.
const UNIT_GLYPH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M12 2 L19 9 L19 21 L15 21 L15 17 L9 17 L9 21 L5 21 L5 9 Z" fill="currentColor"/></svg>';
```

Then at the badge construction site (around line 112, where `badge.innerHTML = UNIT_GLYPH_SVG` runs), set the inherited color immediately before or after that assignment:

```ts
badge.style.color = 'var(--surface-sunken)';
badge.innerHTML = UNIT_GLYPH_SVG;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS, including the pre-existing marker cases.

- [ ] **Step 5: Verify `--surface-sunken` exists in all four theme blocks**

Run: `cd client && grep -c -- '--surface-sunken:' src/styles/theme-palettes.css`
Expected: `4` or more. If fewer, add the missing definitions before committing.

- [ ] **Step 6: Verify in the browser**

With the map open, confirm unit markers still render their glyph and that it is legible
against the badge background. A blank glyph means `currentColor` did not inherit —
check that `badge.style.color` is set on the element that contains the SVG.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "fix(map): route unit marker glyph fill through the theme system"
```

---

### Task 6: Final verification and PR

**Files:** none modified.

- [ ] **Step 1: Run every gate**

```bash
npm run typecheck
```
Expected: clean (Worker — unaffected, but it is a CI gate).

```bash
cd client && npx tsc --noEmit
```
Expected: clean.

```bash
cd client && npx vitest run
```
Expected: all pass. The baseline was 443 files / 3,101 tests; this PR adds roughly 30 tests across 4 files.

```bash
cd client && npx vite build
```
Expected: successful build.

- [ ] **Step 2: Confirm the hex tail did not grow**

Run: `cd client && npx tsx scripts/audit-hex.mjs`
Expected: the in-scope literal count is **lower** than the 2026-07-25 baseline of 4,232 across 455 files — this PR removes roughly 45 literals from `MapboxMapPage.tsx` plus one from `mapMarkers.ts`. An increase means a hex was reintroduced.

- [ ] **Step 3: Capture browser evidence**

Screenshot the Map tab at desktop width in compact density and at mobile width, with
several layers active. Both go in the PR body.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin claude/map-tab-ui-icons-c436d4
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "refactor(map): layer registry, per-layer icons, and density modes (PR 1 of 4)" \
  --body "See docs/superpowers/specs/2026-07-26-map-tab-hardening-design.md. Foundation PR — no visible feature change beyond icons appearing in dock toggle rows. Extracts 55 layer toggles into a declarative registry, adds compact/touch density, gives toggle rows switch semantics and a focus ring, and removes ~46 hardcoded hex literals including four banned #d4a017 uses."
```

The `-R rmpgutah/rmpg-flex` flag is required — without it `gh` can pick a fork as the base.

---

## Self-Review

**Spec coverage.** Every PR 1 bullet maps to a task: registry extraction → Task 2 + Task 4; density → Task 1 + Task 3; `DockToggleRow` rewrite → Task 3; hex routing including `#d4a017` → Task 2 (registry colors) + Task 5 (marker glyph). The style-reload audit was moved to PR 1b in the spec and is deliberately absent here. PR 2–4 scope is out of this plan by design.

**Known gaps accepted for this PR.** The density override has no UI control yet — it is settable only via `setOverride` and the persisted `rmpg_map_density` key. The toolbar control that exposes it is PR 3 scope, per the spec. Task 1 is still worth landing now because Task 3 depends on the context existing.

**Type consistency.** `DockToggleItem` gains exactly one field (`icon?: LucideIcon`) in Task 3 and is consumed with that name in Task 4. `LayerBinding.label` is the override channel used by three bindings in Task 4 and asserted in Task 4's tests. `MapLayerDef.colorVar` maps to `DockToggleItem.color` in `buildDockSections` — the rename is intentional (the registry field name states the constraint; the item field name matches the existing renderer contract).
