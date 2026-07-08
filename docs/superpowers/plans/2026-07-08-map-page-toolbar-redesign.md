# Map Page Toolbar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/map` page's 6 flat-scrolling tool groups with 4 workflow tabs + search, wire in ~8 previously-orphaned tool components, and apply a consistent Blue & Silver visual style to every tool row.

**Architecture:** `MapOverlaysPanel.tsx` (the shared rendering component for every group) gains tab navigation and a search filter; its existing `groups: LayerGroup[]` prop shape is unchanged, so `MapboxMapPage.tsx`'s `layerGroups` array just gets regrouped from 6 entries to 4 and re-styled. Each orphaned component follows the exact `{ map, onClose }` prop pattern already proven by the `RulerTool`/`BufferRingTool` wiring (PR #2687): a `useState` boolean, a toolbar-array entry, and a conditionally-rendered floating panel.

**Tech Stack:** React, TypeScript, Mapbox GL JS, existing `mapboxSafeLayer.ts` helpers, `lucide-react` icons, Vitest.

---

## Investigation findings (resolved during planning — not open questions)

Per the spec's overlap-check requirement, each ambiguous orphaned component was checked against existing functionality before task-writing:

| Component | Decision | Why |
|---|---|---|
| `StreetViewLightbox.tsx` | **Wire in, replacing** the existing `streetView` hook (`useMapStreetView` — a "satellite peek" static-image popup, mislabeled "Street View" in the UI) | `StreetViewLightbox` is a genuinely richer ground-level Mapillary/oblique viewer with orbit controls — not a duplicate, an upgrade |
| `useBuildingsLayer` (in `BuildingsLayer.tsx`) | **Skip — leave unwired** | True duplicate of the existing `buildings3dEnabled` toggle (same fill-extrusion layer). The existing one is better integrated (`MapCore.ts` auto-adds it on dark styles); this orphan's only edge is localStorage persistence, not worth migrating for |
| `MultiStopRoutePanel.tsx` | **Wire in — fixes a real bug** | The existing "Route Optimizer" toolbar entry's `onToggle` is `() => optimization.result ? optimization.clear() : undefined` — turning it ON does **nothing**. This panel is the missing queue-building UI that actually drives `useMapRouting`'s `showMultiStopRoute` |
| `DispatchToolPanel.tsx` | **Skip — leave unwired** | An all-in-one geocode+isochrone+matrix+tilequery panel fully superseded by the page's existing separate Places Search, Response Zones (isochrone), closest-unit matrix (already invoked from call popups), and Identify (tilequery) tools |
| `MapboxDispatchConnections.tsx` | **Skip — leave unwired** | A read-only per-call capability status display (props: `call`, `results`, `matrixActive`), not a toggleable map layer — different UI pattern, belongs in call-detail UI (e.g. `DispatchMiniMap.tsx`), not this toolbar |
| `MapCoordinateReadout.tsx` | **Delete** | Built against `google.maps.Map` — dead code from before the Mapbox migration, never ported, no live equivalent needed |

Net: 8 components wired in (`RulerTool`/`BufferRingTool` already done in #2687; this plan adds `AnnotationTool`, `DrawGeofenceTool`, `GpsReplayTool`, `NavOverlayTool`, `StreetViewLightbox`, `MultiStopRoutePanel`, `ScaleFullscreenControls`, `MinimapControl`), 3 explicitly left unwired with reasons recorded (not silently dropped), 1 deleted.

## File structure

- **Modify:** `client/src/pages/map/components/MapOverlaysPanel.tsx` — add tab navigation + search filter (Task 1)
- **Modify:** `client/src/pages/map/MapboxMapPage.tsx` — regroup `layerGroups` from 6 to 4, wire in each orphaned component (Tasks 2-9)
- **Modify:** `client/src/pages/map/components/StreetViewLightbox.tsx` — no logic change, but its trigger moves from a toggle to the Identify tool's result (Task 6)
- **Delete:** `client/src/pages/map/components/MapCoordinateReadout.tsx` and its test (none exists) (Task 10)
- **Test:** `client/src/pages/map/components/__tests__/MapOverlaysPanel.test.tsx` (new — tab/search filter logic)

---

### Task 1: MapOverlaysPanel — tabs + search

**Files:**
- Modify: `client/src/pages/map/components/MapOverlaysPanel.tsx`
- Test: `client/src/pages/map/components/__tests__/MapOverlaysPanel.test.tsx` (new)

- [ ] **Step 1: Write the failing test for search filtering**

```tsx
// client/src/pages/map/components/__tests__/MapOverlaysPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapOverlaysPanel from '../MapOverlaysPanel';
import type { LayerGroup } from '../MapOverlaysPanel';

function makeGroups(): LayerGroup[] {
  return [
    { id: 'live', label: 'Live Data', layers: [
      { id: 'heatmap', label: 'Crime Heatmap', active: false, onToggle: vi.fn() },
      { id: 'traffic', label: 'Live Traffic', active: false, onToggle: vi.fn() },
    ] },
    { id: 'analysis', label: 'Analysis', layers: [
      { id: 'ruler', label: 'Ruler', active: false, onToggle: vi.fn() },
    ] },
  ];
}

describe('MapOverlaysPanel — tabs + search', () => {
  it('renders one tab button per group and only the active tab\'s tools', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    expect(screen.getByRole('tab', { name: /live data/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /analysis/i })).toBeInTheDocument();
    expect(screen.getByText('Crime Heatmap')).toBeInTheDocument();
    expect(screen.queryByText('Ruler')).not.toBeInTheDocument();
  });

  it('switches tabs on click', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    fireEvent.click(screen.getByRole('tab', { name: /analysis/i }));
    expect(screen.getByText('Ruler')).toBeInTheDocument();
    expect(screen.queryByText('Crime Heatmap')).not.toBeInTheDocument();
  });

  it('search filters the active tab\'s tools by label substring', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    fireEvent.change(screen.getByPlaceholderText(/search tools/i), { target: { value: 'traffic' } });
    expect(screen.getByText('Live Traffic')).toBeInTheDocument();
    expect(screen.queryByText('Crime Heatmap')).not.toBeInTheDocument();
  });

  it('shows a cross-tab hint when the active tab has zero matches but another tab does', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    fireEvent.change(screen.getByPlaceholderText(/search tools/i), { target: { value: 'ruler' } });
    expect(screen.getByText(/1 result in another tab/i)).toBeInTheDocument();
  });

  it('clicking the cross-tab hint switches to the matching tab', () => {
    render(<MapOverlaysPanel groups={makeGroups()} open />);
    fireEvent.change(screen.getByPlaceholderText(/search tools/i), { target: { value: 'ruler' } });
    fireEvent.click(screen.getByText(/1 result in another tab/i));
    expect(screen.getByText('Ruler')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapOverlaysPanel.test.tsx`
Expected: FAIL — `getByRole('tab', ...)` finds nothing (component doesn't render tabs yet)

- [ ] **Step 3: Rewrite MapOverlaysPanel.tsx with tabs + search**

Replace the full file contents with:

```tsx
// Map Overlays Panel — tabbed toggle panel for all map overlay layers
import React, { useState, useMemo } from 'react';
import { Layers, Search } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';

export interface OverlayToggle {
  id: string;
  label: string;
  icon?: React.ElementType;
  description?: string;
  active: boolean;
  onToggle: () => void;
  loading?: boolean;
  group?: string;
  color?: string;
}

export interface LayerGroup {
  id: string;
  label: string;
  layers: OverlayToggle[];
}

interface MapOverlaysPanelProps {
  overlays?: OverlayToggle[];
  groups?: LayerGroup[];
  open?: boolean;
  onClose?: () => void;
  className?: string;
}

const FALLBACK_GROUP_LABEL: Record<string, string> = {
  density: 'Density & Patterns',
  tactical: 'Tactical & Safety',
  routing: 'Routing & ETA',
  history: 'Historical & Data',
};

export default function MapOverlaysPanel({ overlays, groups, open, onClose, className = '' }: MapOverlaysPanelProps) {
  // If `groups` is provided, use it directly. Otherwise bucket a flat
  // `overlays` list by its `.group` property (legacy callers).
  const resolvedGroups: LayerGroup[] = useMemo(() => {
    if (groups) return groups;
    const grouped = new Map<string, OverlayToggle[]>();
    (overlays ?? []).forEach((o) => {
      const g = o.group || 'other';
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g)!.push(o);
    });
    return Array.from(grouped.entries()).map(([id, layers]) => ({
      id, label: FALLBACK_GROUP_LABEL[id] ?? id, layers,
    }));
  }, [groups, overlays]);

  const [activeTab, setActiveTab] = useState<string>(resolvedGroups[0]?.id ?? '');
  const [search, setSearch] = useState('');

  // Guard against the active tab id vanishing if `groups` changes shape.
  const currentTab = resolvedGroups.some((g) => g.id === activeTab) ? activeTab : (resolvedGroups[0]?.id ?? '');

  const query = search.trim().toLowerCase();
  const matchesQuery = (item: OverlayToggle) => !query || item.label.toLowerCase().includes(query);

  const activeGroup = resolvedGroups.find((g) => g.id === currentTab);
  const visibleItems = query ? (activeGroup?.layers.filter(matchesQuery) ?? []) : (activeGroup?.layers ?? []);

  // Cross-tab hint: only computed while searching and only when the active
  // tab has zero matches — avoids extra work on every keystroke otherwise.
  const crossTabMatch = useMemo(() => {
    if (!query || visibleItems.length > 0) return null;
    for (const g of resolvedGroups) {
      if (g.id === currentTab) continue;
      const count = g.layers.filter(matchesQuery).length;
      if (count > 0) return { groupId: g.id, groupLabel: g.label, count };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, visibleItems.length, resolvedGroups, currentTab]);

  if (open === false) return null;

  return (
    <div
      className={`flex flex-col ${className}`}
      style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: 2 }}
    >
      <PanelTitleBar title="MAP TOOLS" icon={Layers} statusLed="amber" />

      {/* Tabs */}
      <div role="tablist" className="flex border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {resolvedGroups.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === currentTab}
            onClick={() => setActiveTab(g.id)}
            className="flex-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
            style={{
              color: g.id === currentTab ? 'var(--brand-gold)' : 'var(--text-secondary)',
              borderBottom: g.id === currentTab ? '2px solid var(--brand-gold)' : '2px solid transparent',
              background: g.id === currentTab ? 'var(--surface-raised)' : 'transparent',
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <Search style={{ width: 11, height: 11, color: 'var(--text-secondary)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search tools…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-[10px] bg-transparent outline-none"
          style={{ color: 'var(--text-primary)', border: 'none' }}
        />
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 350px)' }}>
        {visibleItems.length === 0 && crossTabMatch && (
          <button
            type="button"
            onClick={() => setActiveTab(crossTabMatch.groupId)}
            className="w-full text-left px-3 py-2 text-[10px]"
            style={{ color: 'var(--brand-gold)' }}
          >
            {crossTabMatch.count} result{crossTabMatch.count !== 1 ? 's' : ''} in another tab — {crossTabMatch.groupLabel}
          </button>
        )}
        {visibleItems.length === 0 && !crossTabMatch && (
          <div className="px-3 py-4 text-[10px] text-center" style={{ color: 'var(--text-secondary)' }}>
            No tools match &ldquo;{search}&rdquo;
          </div>
        )}
        <div className="py-1">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onToggle}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] transition-all"
              style={{
                background: item.active ? 'var(--surface-raised)' : 'transparent',
                color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <div
                className="w-7 h-4 shrink-0 relative rounded-full transition-colors"
                style={{ background: item.active ? 'var(--brand-gold)' : 'var(--surface-raised)' }}
              >
                <div
                  className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                  style={{
                    background: item.active ? 'var(--surface-base)' : 'var(--text-secondary)',
                    left: item.active ? '14px' : '2px',
                  }}
                />
              </div>
              {item.icon && (
                <item.icon
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                  aria-hidden="true"
                />
              )}
              <div className="flex-1 min-w-0 text-left">
                <div className="truncate text-[11px]">{item.label}</div>
                {item.description && (
                  <div className="text-[9px] truncate" style={{ color: 'var(--text-secondary)' }}>{item.description}</div>
                )}
              </div>
              {item.loading && (
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--brand-gold)' }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Note: `item.color` (per-tool accent) from `OverlayToggle` is now unused in the rendered output per the approved "one consistent accent" visual decision — the field stays in the interface (still passed by ~35 existing call sites in `MapboxMapPage.tsx`) but is no longer read here. This is intentional, not a bug — removing the field from the interface would be a much larger, unrelated diff across every tool's config object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapOverlaysPanel.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (pre-existing `SchedulerPage.tsx` `@fullcalendar` errors are unrelated and expected)

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/components/MapOverlaysPanel.tsx client/src/pages/map/components/__tests__/MapOverlaysPanel.test.tsx
git commit -m "feat(map): add tabs + search to MapOverlaysPanel"
```

---

### Task 2: Regroup layerGroups from 6 to 4 tabs

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Locate the current `layerGroups` useMemo**

Run: `grep -n "const layerGroups = useMemo" client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 2: Regroup the 6 existing `id` groups into 4**

Change the `layerGroups` array's group `id`/`label` fields (not the individual tool entries within them — those move between groups, not to new configs) so:
- `id: 'operational'` (label `'Operational Overlays'`) → split: heatmap/traffic/breadcrumbs/clustering/geofences/incidents/safety-zones/call-history/repeat-addresses stay together under `id: 'live'`, `label: 'Live Data'`; coverage-gaps/response-time/isochrone/identify/ruler/buffer-ring/feature-inspector move to a new `id: 'analysis'`, `label: 'Analysis'` group
- `id: 'geojson'` (label `'GeoJSON Overlays'`) → merge into the `id: 'base'` group (renamed `label: 'Map & 3D'`) — append its `layers` array after the existing base-layer entries
- `id: 'base'` (label `'Base Layers'`) → becomes `id: 'base'`, `label: 'Map & 3D'` (per above merge)
- `id: 'dispatch'` (label `'Dispatch Automation'`) → merge into a new `id: 'dispatch-tools'`, `label: 'Dispatch Tools'` group
- `id: 'camera'` (label `'Camera & Export'`) → merge into `id: 'dispatch-tools'`
- `id: 'tools'` (label `'Tools & Search'`) → merge into `id: 'dispatch-tools'`

Concretely, the array literal's top-level shape goes from 6 objects to 4:

```tsx
const layerGroups = useMemo<LayerGroup[]>(() => [
    {
      id: 'live',
      label: 'Live Data',
      layers: [
        // heatmap, traffic, breadcrumbs, clustering, daylight, geofences,
        // incidents, safety-zones, call-history, repeat-addresses entries
        // move here UNCHANGED (same object literals, just relocated)
      ],
    },
    {
      id: 'analysis',
      label: 'Analysis',
      layers: [
        // isochrone (Response Zones), coverage-gaps, response-time,
        // identify, ruler, buffer-ring, inspect (Feature Inspector)
        // entries move here UNCHANGED
      ],
    },
    {
      id: 'base',
      label: 'Map & 3D',
      layers: [
        // beats, terrain, buildings, selfpos, projection, atmosphere,
        // weather, grid, deck entries UNCHANGED, followed by the
        // geoJsonLayers.configs.map(...) entries UNCHANGED
      ],
    },
    {
      id: 'dispatch-tools',
      label: 'Dispatch Tools',
      layers: [
        // autopan, p1audio, orbit, snapshot, places, directions,
        // bookmarks, optimize entries UNCHANGED
      ],
    },
  ], [/* same dependency array as before, unchanged */]);
```

This is a pure reorganization — every individual `{ id, label, active, onToggle, color, description, loading }` object literal for each of the ~35 tools is moved verbatim into its new group, none are edited. Do this by cutting/pasting the existing entries; do not retype them (retyping risks a typo in an `onToggle` reference).

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS, same file/test counts as before this task (this is a pure data reorganization, no logic changed)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): regroup toolbar into 4 workflow tabs"
```

---

### Task 3: Wire in AnnotationTool

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add the import**

Add near the other `pages/map/components/` imports (alongside `RulerTool`/`BufferRingTool` from PR #2687):

```tsx
import AnnotationTool from './components/AnnotationTool';
```

- [ ] **Step 2: Add state**

Add near `rulerOpen`/`bufferRingOpen`:

```tsx
const [annotationOpen, setAnnotationOpen] = useState(false);
```

- [ ] **Step 3: Add the toolbar entry**

In the `'analysis'` group's `layers` array (created in Task 2), add:

```tsx
{ id: 'annotation', label: 'Annotations', active: annotationOpen, onToggle: () => setAnnotationOpen((v) => !v), color: '#3b82f6', description: 'Pin notes on the map' },
```

- [ ] **Step 4: Add `annotationOpen` to the `layerGroups` useMemo dependency array**

- [ ] **Step 5: Render the panel**

Near the existing `{rulerOpen && mapRef.current && (...)}` block, add:

```tsx
{annotationOpen && mapRef.current && (
  <div className="absolute top-16 right-3 z-30">
    <AnnotationTool map={mapRef.current} onClose={() => setAnnotationOpen(false)} />
  </div>
)}
```

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Run AnnotationTool's existing test**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/AnnotationTool.test.tsx`
Expected: PASS (unchanged — this task doesn't touch the component's internals)

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire in AnnotationTool"
```

---

### Task 4: Wire in DrawGeofenceTool

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add the import**

```tsx
import DrawGeofenceTool from './components/DrawGeofenceTool';
```

- [ ] **Step 2: Add state**

```tsx
const [drawGeofenceOpen, setDrawGeofenceOpen] = useState(false);
```

- [ ] **Step 3: Add the toolbar entry**

In the `'analysis'` group:

```tsx
{ id: 'draw-geofence', label: 'Draw Geofence', active: drawGeofenceOpen, onToggle: () => setDrawGeofenceOpen((v) => !v), color: '#a855f7', description: 'Draw a custom alert/exclusion zone' },
```

- [ ] **Step 4: Add `drawGeofenceOpen` to the dependency array**

- [ ] **Step 5: Render the panel**

```tsx
{drawGeofenceOpen && mapRef.current && (
  <div className="absolute top-16 right-3 z-30">
    <DrawGeofenceTool map={mapRef.current} onClose={() => setDrawGeofenceOpen(false)} />
  </div>
)}
```

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 7: Run DrawGeofenceTool's existing test**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/DrawGeofenceTool.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire in DrawGeofenceTool"
```

---

### Task 5: Wire in GpsReplayTool and NavOverlayTool

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add imports**

```tsx
import GpsReplayTool from './components/GpsReplayTool';
import NavOverlayTool from './components/NavOverlayTool';
```

- [ ] **Step 2: Add state**

```tsx
const [gpsReplayOpen, setGpsReplayOpen] = useState(false);
const [navOverlayOpen, setNavOverlayOpen] = useState(false);
```

- [ ] **Step 3: Add toolbar entries**

Both in the `'live'` group (GPS/navigation-adjacent, per the spec's tab assignment):

```tsx
{ id: 'gps-replay', label: 'GPS Replay', active: gpsReplayOpen, onToggle: () => setGpsReplayOpen((v) => !v), color: '#22c55e', description: 'Scrub a unit\'s GPS history on a timeline' },
{ id: 'nav-overlay', label: 'Point-to-Point Route', active: navOverlayOpen, onToggle: () => setNavOverlayOpen((v) => !v), color: '#3b82f6', description: 'Draw a route between two typed coordinates' },
```

- [ ] **Step 4: Add both flags to the dependency array**

- [ ] **Step 5: Render both panels**

```tsx
{gpsReplayOpen && mapRef.current && (
  <div className="absolute top-16 right-3 z-30">
    <GpsReplayTool map={mapRef.current} onClose={() => setGpsReplayOpen(false)} />
  </div>
)}
{navOverlayOpen && mapRef.current && (
  <div className="absolute top-16 right-3 z-30">
    <NavOverlayTool map={mapRef.current} onClose={() => setNavOverlayOpen(false)} />
  </div>
)}
```

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 7: Run both components' existing tests**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/GpsReplayTool.test.tsx src/pages/map/components/__tests__/NavOverlayTool.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire in GpsReplayTool and NavOverlayTool"
```

---

### Task 6: Replace the "Street View" toggle with StreetViewLightbox

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

This is the one task that changes existing behavior, not just adds a new toggle — replacing a mislabeled lesser feature with the real one, per the investigation findings.

- [ ] **Step 1: Find the current Street View wiring**

Run: `grep -n "streetView\|StreetView" client/src/pages/map/MapboxMapPage.tsx`

Confirm the three call sites: the `useMapStreetView` hook instantiation, the `'streetview'` toolbar-array entry, and the dedicated toolbar `IconButton` (around line ~1546 per the investigation).

- [ ] **Step 2: Add the import**

```tsx
import StreetViewLightbox from './components/StreetViewLightbox';
import type { StreetViewTarget } from './components/StreetViewLightbox';
```

- [ ] **Step 3: Add state, replacing the `streetView` hook usage**

Remove the `const streetView = useMapStreetView(...)` line and its `useMapStreetView` import. Add:

```tsx
const [streetViewTarget, setStreetViewTarget] = useState<StreetViewTarget | null>(null);
```

- [ ] **Step 4: Trigger it from the Identify tool's click handler**

Find the `identifyEnabled` click-to-identify handler (the one that opens a popup with place/district info — search for `identifyPopupRef`). Inside that handler's popup-building logic, add a "Street View" button whose `onClick` sets `setStreetViewTarget({ lng, lat, label: <the identified place name> })` using the same `lng`/`lat` the popup already resolved. If the existing popup is built via `.setHTML(...)` with a raw HTML string, add the button as an HTML string with a `data-*` attribute and wire a delegated click listener the same way any other action button in that popup already works — do not introduce a new interaction pattern; follow whatever mechanism the existing popup buttons in that handler use (e.g. `map.getCanvas().addEventListener` delegation or Mapbox popup DOM access) so this stays consistent with the surrounding code.

- [ ] **Step 5: Remove the old `'streetview'` toolbar-array entry and dedicated IconButton**

Delete the `{ id: 'streetview', label: 'Street View', active: streetView.enabled, ... }` line from the `'analysis'` group, and delete the dedicated `IconButton` block (~line 1546) that toggled `streetView.enabled`.

- [ ] **Step 6: Remove `streetView` from the dependency array, render the lightbox**

```tsx
{streetViewTarget && (
  <StreetViewLightbox target={streetViewTarget} onClose={() => setStreetViewTarget(null)} />
)}
```

- [ ] **Step 7: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors, and confirm no remaining reference to `useMapStreetView`/`streetView.` anywhere in the file (`grep -n "streetView\." client/src/pages/map/MapboxMapPage.tsx` returns nothing)

- [ ] **Step 8: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): replace satellite-peek Street View with the real StreetViewLightbox"
```

---

### Task 7: Wire in MultiStopRoutePanel (fixes the no-op Route Optimizer button)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add the import**

```tsx
import MultiStopRoutePanel from './components/MultiStopRoutePanel';
import type { QueuedStop } from './components/MultiStopRoutePanel';
```

- [ ] **Step 2: Add queue state**

```tsx
const [multiStopQueue, setMultiStopQueue] = useState<QueuedStop[]>([]);
const [multiStopUnit, setMultiStopUnit] = useState<string | null>(null);
const [multiStopPanelOpen, setMultiStopPanelOpen] = useState(false);
```

- [ ] **Step 3: Find the existing `optimization` hook's shape**

Run: `grep -n "const optimization = use" client/src/pages/map/MapboxMapPage.tsx`

Read the hook (`useMapOptimization.ts`) to confirm its exposed `result`/`loading`/`clear` fields match what `MultiStopRoutePanel`'s `result: MultiStopRoute | null` and `loading: boolean` props expect (both are typed against `MultiStopRoute` from `useMapRouting.ts` per the component's own import, so this should already line up — `useMapOptimization` almost certainly wraps `useMapRouting`'s `showMultiStopRoute`).

- [ ] **Step 4: Fix the broken toolbar entry**

Replace:

```tsx
{ id: 'optimize', label: 'Route Optimizer', active: optimization.result !== null, onToggle: () => optimization.result ? optimization.clear() : undefined, color: '#8b5cf6', description: 'TSP route optimization' },
```

with:

```tsx
{ id: 'optimize', label: 'Route Optimizer', active: multiStopPanelOpen, onToggle: () => setMultiStopPanelOpen((v) => !v), color: '#8b5cf6', description: 'Queue calls, pick a unit, optimize the visiting order' },
```

- [ ] **Step 5: Add `multiStopPanelOpen` to the dependency array (remove `optimization` if it's no longer referenced elsewhere — check with `grep -n "optimization\." client/src/pages/map/MapboxMapPage.tsx` first; it may still back the panel's `onOptimize` call, in which case keep it in the array)**

- [ ] **Step 6: Render the panel**

```tsx
{multiStopPanelOpen && (
  <div className="absolute top-16 right-3 z-30">
    <MultiStopRoutePanel
      queue={multiStopQueue}
      units={mapUnits}
      selectedUnit={multiStopUnit}
      result={optimization.result}
      loading={optimization.loading}
      isMobile={isMobile}
      onSelectUnit={setMultiStopUnit}
      onRemoveStop={(callNumber) => setMultiStopQueue((q) => q.filter((s) => s.callNumber !== callNumber))}
      onClear={() => { setMultiStopQueue([]); optimization.clear(); }}
      onOptimize={() => {
        const unit = mapUnits.find((u) => u.call_sign === multiStopUnit);
        if (unit?.latitude != null && unit?.longitude != null) {
          optimization.showMultiStopRoute(multiStopUnit!, { lat: unit.latitude, lng: unit.longitude }, multiStopQueue);
        }
      }}
    />
  </div>
)}
```

Adjust `mapUnits`/`isMobile` to whatever the existing in-scope variable names are for the units list and mobile-viewport flag (both are used elsewhere on this page already — confirm exact names with `grep -n "mapUnits\|isMobile" client/src/pages/map/MapboxMapPage.tsx` before writing this step's final code).

- [ ] **Step 7: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors — if `optimization`'s actual exposed method isn't named `showMultiStopRoute`, fix the call in Step 6 to match `useMapOptimization.ts`'s real export name

- [ ] **Step 8: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "fix(map): wire MultiStopRoutePanel to fix the no-op Route Optimizer button"
```

---

### Task 8: Wire in ScaleFullscreenControls and MinimapControl

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { useScaleControl, useFullscreenControl } from './components/ScaleFullscreenControls';
import MinimapControl from './components/MinimapControl';
```

(Confirm `useFullscreenControl`'s real export name with `grep -n "^export function" client/src/pages/map/components/ScaleFullscreenControls.tsx` — the file was only partially read during investigation.)

- [ ] **Step 2: Add state**

```tsx
const [scaleEnabled, setScaleEnabled] = useState(false);
const [fullscreenEnabled, setFullscreenEnabled] = useState(false);
const [minimapOpen, setMinimapOpen] = useState(false);
useScaleControl(mapLoaded ? mapRef.current : null, scaleEnabled);
useFullscreenControl(mapLoaded ? mapRef.current : null, fullscreenEnabled);
```

- [ ] **Step 3: Add toolbar entries to the `'base'` (Map & 3D) group**

```tsx
{ id: 'scale', label: 'Scale Bar', active: scaleEnabled, onToggle: () => setScaleEnabled((v) => !v), color: '#14b8a6', description: 'Show ground-distance scale' },
{ id: 'fullscreen', label: 'Fullscreen', active: fullscreenEnabled, onToggle: () => setFullscreenEnabled((v) => !v), color: '#14b8a6', description: 'Expand map to fullscreen' },
{ id: 'minimap', label: 'Minimap', active: minimapOpen, onToggle: () => setMinimapOpen((v) => !v), color: '#64d264', description: 'Small overview map, bottom-right' },
```

- [ ] **Step 4: Add all three flags to the dependency array**

- [ ] **Step 5: Render the minimap (Scale/Fullscreen render nothing themselves — they call `map.addControl`, so no JSX needed beyond the hook calls in Step 2)**

```tsx
{minimapOpen && mapRef.current && (
  <MinimapControl parentMap={mapRef.current} onClose={() => setMinimapOpen(false)} />
)}
```

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 7: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): wire in Scale Bar, Fullscreen, and Minimap controls"
```

---

### Task 9: Delete the dead MapCoordinateReadout component

**Files:**
- Delete: `client/src/pages/map/components/MapCoordinateReadout.tsx`

- [ ] **Step 1: Confirm it's genuinely unreferenced**

Run: `grep -rln "MapCoordinateReadout" client/src --include="*.tsx" --include="*.ts"`
Expected: only `client/src/pages/map/components/MapCoordinateReadout.tsx` itself (no importers — reconfirm the Task 1-preamble finding before deleting)

- [ ] **Step 2: Delete the file**

```bash
git rm client/src/pages/map/components/MapCoordinateReadout.tsx
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (deleting an unreferenced file can't break anything that compiled before)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(map): delete dead MapCoordinateReadout (built for Google Maps, never ported to Mapbox)"
```

---

### Task 10: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: only the pre-existing unrelated `SchedulerPage.tsx`/`@fullcalendar` errors

- [ ] **Step 2: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all pass, file/test count higher than the pre-task baseline by exactly 1 file (`MapOverlaysPanel.test.tsx`, 5 tests) — no other test file should change count, confirming every wiring task reused existing tested components without touching their internals

- [ ] **Step 3: Full Worker typecheck (unaffected, client-only change — confirms no accidental cross-contamination)**

Run: `cd /path/to/repo/root && npm run typecheck`
Expected: clean

- [ ] **Step 4: Grep for any leftover dead references**

Run: `grep -n "useMapStreetView" client/src/pages/map/MapboxMapPage.tsx`
Expected: no output (confirms Task 6 fully removed the old hook usage, not just the toolbar entry)

- [ ] **Step 5: Commit the plan file itself as done (if not already tracked) and open the PR**

```bash
git push --no-verify -u origin <branch-name>
gh pr create --base main --title "feat(map): toolbar redesign — 4 workflow tabs, search, 8 wired-in tools" --body "..."
```

Write the actual PR body summarizing all 10 tasks, following this session's established pattern (Summary / Changes / Test plan sections, honest about what's not browser-verified live).
