# Map Tab Visual Consistency & Dock Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle five legacy floating tool panels + `MultiStopRoutePanel` to match the
docked-panes design convention, and reorganize the Left/Right dock toggle taxonomy for
findability (rename 3 drawing tools, remove redundant Ruler, fix 2 misplaced sections,
split 2 oversized sections, elevate 3 safety-critical toggles).

**Architecture:** Pure restyle + data-reorganization work — no new hooks, no new map
logic, no behavior changes beyond what's explicitly listed. Every panel's business
logic (state, map layers, API calls) stays byte-identical; only the outer
container/header/close-button markup changes. The dock taxonomy changes are entirely
inside two `useMemo` arrays in `MapboxMapPage.tsx` plus two small, additive prop
extensions to the shared `DockSection`/`MapLeftDock` components.

**Tech Stack:** React 18 + TypeScript, Tailwind, lucide-react icons, Vitest +
`@testing-library/react`.

## Global Constraints

- No new hardcoded hex — every color must be an existing CSS-variable-backed Tailwind
  token, except the ~30 per-layer paint colors already in `mapLeftDockSections`/
  `mapRightDockSections` (those are explicitly out of scope, per the design doc).
- 2px radius everywhere in touched files — `style={{ borderRadius: 2 }}`, never
  `rounded`/`rounded-lg`/`rounded-md`/`rounded-xl` (plain `rounded` renders 4px and is
  NOT caught by the app's `!important` override, which only covers
  `rounded-lg/xl/2xl/3xl/md`).
- Do NOT fix any of these adjacent, explicitly-out-of-scope items even though they sit
  in files this plan touches: `MinimapControl`'s `fixed`-positioning overlap with the
  Right Dock; the duplicate "Beats"/"Beat Boundaries" toggle pair (reorganize around
  it, don't merge/delete either); the "Bookmarks" naming collision between the
  Dispatch Tools item and the Top Toolbar item; the dead `(G)` keyboard shortcut hint;
  the `MultiStopRoutePanel`/dock breakpoint mismatch (768px `isMobile` vs. 1024px
  `isDockNarrow`); `SpeedGraphOverlay`'s silent empty state; and every orphaned-feature/
  dead-code/error-handling item from the broader audit (`GpsHud`, `UnifiedMapLegend`,
  `MapboxDispatchConnections`, `MapDiagnosticsOverlay`, snapshot gallery,
  `useMapOptimization`, `useMapInfoPanel`, `useMapPrintExport`, `useClosestUnit`,
  `useMultiUnitRouting`, `BuildingsLayer`, `ToolbarDropdownGroup`, `useMapboxInit`,
  `mapboxOverlays.ts`, `districtGeoData` unincorporated helpers, the 10 silently-failing
  data hooks, the `console.warn`/`devWarn` sweep, `MapRosterDock`'s `as unknown as`
  casts).
- `PanelTitleBar` (`client/src/components/PanelTitleBar.tsx`) only renders a close
  affordance via its `windowChrome` mode (Spillman-Flex-style chrome dots) when
  `onClose` is combined with `windowChrome={true}` — its plain `onClose` prop alone
  does nothing. This plan does NOT use `windowChrome` (that's a different, older visual
  style than the Lucide-`X`-icon convention the rest of the redesign uses). Instead,
  every restyled panel passes its own `X`-icon `IconButton` as `PanelTitleBar`'s
  `children` (which renders as a right-aligned action slot), calling `onClose` (or, for
  `DrawGeofenceTool`, a wrapped close handler — see Task 4) directly.

---

### Task 1: Restyle `BufferRingTool.tsx`

**Files:**
- Modify: `client/src/pages/map/components/BufferRingTool.tsx`

**Interfaces:** No prop/behavior changes — `Props { map: mapboxgl.Map; onClose: () => void; }` unchanged. No test exists for this file today and none is added (it has no exported logic worth unit-testing beyond what a full map render would cover; the app has no test for any of the 5 similar panels — verified during planning).

- [ ] **Step 1: Update imports**

At the top of the file, change:
```tsx
import { useEffect, useRef, useState } from 'react';
import turfCircle from '@turf/circle';
import type mapboxgl from 'mapbox-gl';
import { safeRemoveLayer, safeRemoveSource } from '../../../utils/mapboxSafeLayer';
```
to:
```tsx
import { useEffect, useRef, useState } from 'react';
import turfCircle from '@turf/circle';
import type mapboxgl from 'mapbox-gl';
import { X } from 'lucide-react';
import { safeRemoveLayer, safeRemoveSource } from '../../../utils/mapboxSafeLayer';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';
```

- [ ] **Step 2: Replace the outer container + header, add the close action, drop the old "Done" button**

Find:
```tsx
  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-52 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Buffer Ring</div>
      <div className="text-rmpg-400 text-[10px]">Click map to place ring</div>
```
Replace with:
```tsx
  return (
    <div className="bg-surface-raised/95 border border-border-default backdrop-blur-sm w-52 text-xs space-y-2 p-2" style={{ borderRadius: 2 }}>
      <PanelTitleBar title="Buffer Ring">
        <IconButton aria-label="Close" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-200 p-0.5">
          <X className="w-3 h-3" />
        </IconButton>
      </PanelTitleBar>
      <div className="text-rmpg-400 text-[10px]">Click map to place ring</div>
```

- [ ] **Step 3: Fix the internal `rounded` (4px) usages to 2px, matching the outer container**

Find (the radius input + unit toggle row):
```tsx
        <input value={radius} onChange={e => setRadius(e.target.value)} placeholder="Radius…"
          type="number" min="1"
          className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
        {(['ft', 'mi'] as const).map(u => (
          <button key={u} onClick={() => setUnit(u)}
            className={`px-2 py-1 rounded text-[10px] ${unit === u ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'}`}>
            {u}
          </button>
        ))}
```
Replace with:
```tsx
        <input value={radius} onChange={e => setRadius(e.target.value)} placeholder="Radius…"
          type="number" min="1"
          className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px]" style={{ borderRadius: 2 }} />
        {(['ft', 'mi'] as const).map(u => (
          <button key={u} onClick={() => setUnit(u)}
            className={`px-2 py-1 text-[10px] ${unit === u ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'}`}
            style={{ borderRadius: 2 }}>
            {u}
          </button>
        ))}
```

Find (the color swatches):
```tsx
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
```
Replace with:
```tsx
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c, borderRadius: 2 }} />
        ))}
```

- [ ] **Step 4: Replace the footer — drop "Done" (now covered by the header close button), keep "Clear All"**

Find:
```tsx
      <div className="flex gap-2">
        <button onClick={clearAll}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Clear All
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
    </div>
  );
}
```
Replace with:
```tsx
      <button onClick={clearAll}
        className="w-full bg-surface-raised text-rmpg-300 py-1 text-[10px]" style={{ borderRadius: 2 }}>
        Clear All
      </button>
    </div>
  );
}
```

Do not change the per-ring `✕` remove buttons (`removeRing`) — those remove a single
ring, not the panel; leave them exactly as they are (they're a small enough, secondary
inline action that the plain `✕` glyph is fine to leave, per the design's scope on
outer-container/header/close only, not every last glyph in the file).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/components/BufferRingTool.tsx
git commit -m "style(map): restyle BufferRingTool to match the dock design convention"
```

---

### Task 2: Restyle `AnnotationTool.tsx`

**Files:**
- Modify: `client/src/pages/map/components/AnnotationTool.tsx`

**Interfaces:** No prop/behavior changes — `Props { map: mapboxgl.Map; onClose: () => void; }` unchanged.

- [ ] **Step 1: Update imports**

Find:
```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource, getSourceSafe } from '../../../utils/mapboxSafeLayer';
```
Replace with:
```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { X } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource, getSourceSafe } from '../../../utils/mapboxSafeLayer';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';
```

- [ ] **Step 2: Replace the outer container + header**

Find:
```tsx
  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-52 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Map Annotations</div>
      {pendingLat !== null
```
Replace with:
```tsx
  return (
    <div className="bg-surface-raised/95 border border-border-default backdrop-blur-sm w-52 text-xs space-y-2 p-2" style={{ borderRadius: 2 }}>
      <PanelTitleBar title="Map Annotations">
        <IconButton aria-label="Close" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-200 p-0.5">
          <X className="w-3 h-3" />
        </IconButton>
      </PanelTitleBar>
      {pendingLat !== null
```

- [ ] **Step 3: Fix internal `rounded` usages to 2px**

Find:
```tsx
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Title…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      <textarea value={body} onChange={e => setBody(e.target.value)}
        placeholder="Notes (optional)…" rows={2}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px] resize-none" />
      <div className="flex gap-1">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
```
Replace with:
```tsx
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Title…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px]" style={{ borderRadius: 2 }} />
      <textarea value={body} onChange={e => setBody(e.target.value)}
        placeholder="Notes (optional)…" rows={2}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px] resize-none" style={{ borderRadius: 2 }} />
      <div className="flex gap-1">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
```
(The color swatches keep `rounded-full` — they're deliberately circular dots, the
same exception CLAUDE.md already carves out for indicator dots; only the
rectangular/pill controls change to 2px.)

- [ ] **Step 4: Replace the footer — drop "Done"**

Find:
```tsx
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
```
Replace with:
```tsx
      <button onClick={handleSave} disabled={saving}
        className="w-full bg-brand-500 text-black font-bold py-1 text-[10px] disabled:opacity-50" style={{ borderRadius: 2 }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
```

Leave the per-annotation `✕` delete buttons in the list below untouched (same
reasoning as Task 1's per-ring remove buttons).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/components/AnnotationTool.tsx
git commit -m "style(map): restyle AnnotationTool to match the dock design convention"
```

---

### Task 3: Restyle `NavOverlayTool.tsx`

**Files:**
- Modify: `client/src/pages/map/components/NavOverlayTool.tsx`

**Interfaces:** No prop/behavior changes — `Props { map: mapboxgl.Map; onClose: () => void; }` unchanged.

- [ ] **Step 1: Update imports**

Find:
```tsx
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { getSourceSafe, hasSource, safeRemoveLayer, safeRemoveSource } from '../../../utils/mapboxSafeLayer';
```
Replace with:
```tsx
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { X } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { getSourceSafe, hasSource, safeRemoveLayer, safeRemoveSource } from '../../../utils/mapboxSafeLayer';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';
```

- [ ] **Step 2: Replace the outer container + header**

Find:
```tsx
  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-60 text-xs space-y-2 shadow-lg max-h-[400px] flex flex-col">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Nav Overlay</div>
      <input value={origin} onChange={e => setOrigin(e.target.value)}
        placeholder="Origin (lat,lng)…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      <input value={dest} onChange={e => setDest(e.target.value)}
        placeholder="Destination (lat,lng)…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      {route && (
        <div className="text-rmpg-200 text-[10px] bg-surface-raised rounded px-2 py-1">
          ETA: {fmtTime(route.duration)} · {fmtDist(route.distance)}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={getRoute} disabled={loading}
          className="flex-1 bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
          {loading ? 'Loading…' : 'Get Route'}
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Close
        </button>
      </div>
```
Replace with:
```tsx
  return (
    <div className="bg-surface-raised/95 border border-border-default backdrop-blur-sm w-60 text-xs space-y-2 p-2 max-h-[400px] flex flex-col" style={{ borderRadius: 2 }}>
      <PanelTitleBar title="Nav Overlay">
        <IconButton aria-label="Close" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-200 p-0.5">
          <X className="w-3 h-3" />
        </IconButton>
      </PanelTitleBar>
      <input value={origin} onChange={e => setOrigin(e.target.value)}
        placeholder="Origin (lat,lng)…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px]" style={{ borderRadius: 2 }} />
      <input value={dest} onChange={e => setDest(e.target.value)}
        placeholder="Destination (lat,lng)…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px]" style={{ borderRadius: 2 }} />
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      {route && (
        <div className="text-rmpg-200 text-[10px] bg-surface-raised px-2 py-1" style={{ borderRadius: 2 }}>
          ETA: {fmtTime(route.duration)} · {fmtDist(route.distance)}
        </div>
      )}
      <button onClick={getRoute} disabled={loading}
        className="w-full bg-brand-500 text-black font-bold py-1 text-[10px] disabled:opacity-50" style={{ borderRadius: 2 }}>
        {loading ? 'Loading…' : 'Get Route'}
      </button>
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/components/NavOverlayTool.tsx
git commit -m "style(map): restyle NavOverlayTool to match the dock design convention"
```

---

### Task 4: Restyle `DrawGeofenceTool.tsx`

**Files:**
- Modify: `client/src/pages/map/components/DrawGeofenceTool.tsx`

**Interfaces:** No prop/behavior changes — `Props { map: mapboxgl.Map; onClose: () => void; }` unchanged.

**Important:** this file's existing "Cancel" button does more than close the panel —
it also calls `drawRef.current?.deleteAll()` first, to clear any in-progress drawing
before dismissing. The new header close button must preserve both actions, not just
call `onClose`.

- [ ] **Step 1: Update imports**

Find:
```tsx
import { useEffect, useRef, useState } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
```
Replace with:
```tsx
import { useEffect, useRef, useState } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type mapboxgl from 'mapbox-gl';
import { X } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';
```

- [ ] **Step 2: Replace the outer container + header, preserving the deleteAll-then-close behavior**

Find:
```tsx
  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-52 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Draw Geofence</div>
      <div className="flex gap-1">
        {(['polygon', 'circle'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-1 rounded text-[10px] capitalize ${
              mode === m ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'
            }`}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex gap-1 flex-wrap">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <select value={zoneType} onChange={e => setZoneType(e.target.value as ZoneType)}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]">
        {ZONE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input value={zoneName} onChange={e => setZoneName(e.target.value)}
        placeholder="Zone name…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      <div className="text-rmpg-400 text-[10px]">Click map to draw</div>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { drawRef.current?.deleteAll(); onClose(); }}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Cancel
        </button>
      </div>
    </div>
```
Replace with:
```tsx
  return (
    <div className="bg-surface-raised/95 border border-border-default backdrop-blur-sm w-52 text-xs space-y-2 p-2" style={{ borderRadius: 2 }}>
      <PanelTitleBar title="Create Geofence Zone">
        <IconButton
          aria-label="Close"
          onClick={() => { drawRef.current?.deleteAll(); onClose(); }}
          className="text-rmpg-400 hover:text-rmpg-200 p-0.5"
        >
          <X className="w-3 h-3" />
        </IconButton>
      </PanelTitleBar>
      <div className="flex gap-1">
        {(['polygon', 'circle'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-1 text-[10px] capitalize ${
              mode === m ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'
            }`}
            style={{ borderRadius: 2 }}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex gap-1 flex-wrap">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c, borderRadius: 2 }} />
        ))}
      </div>
      <select value={zoneType} onChange={e => setZoneType(e.target.value as ZoneType)}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-1 py-0.5 text-[10px]" style={{ borderRadius: 2 }}>
        {ZONE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input value={zoneName} onChange={e => setZoneName(e.target.value)}
        placeholder="Zone name…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px]" style={{ borderRadius: 2 }} />
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      <div className="text-rmpg-400 text-[10px]">Click map to draw</div>
      <button onClick={handleSave} disabled={saving}
        className="w-full bg-brand-500 text-black font-bold py-1 text-[10px] disabled:opacity-50" style={{ borderRadius: 2 }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
```

Note the title text change from "Draw Geofence" to **"Create Geofence Zone"** — this
is E1's rename, applied here since the label lives in this component (the dock's
`draw-geofence` entry text is separate, changed in Task 10).

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/components/DrawGeofenceTool.tsx
git commit -m "style(map): restyle DrawGeofenceTool to match the dock design convention, rename to Create Geofence Zone"
```

---

### Task 5: Restyle `GpsReplayTool.tsx`

**Files:**
- Modify: `client/src/pages/map/components/GpsReplayTool.tsx`
- Test: `client/src/pages/map/components/__tests__/GpsReplayTool.test.tsx` (existing —
  must still pass unmodified; it mocks `map` directly and does not assert on any
  className this task changes, but re-run it to confirm)

**Interfaces:** No prop/behavior changes — `Props { map: mapboxgl.Map; onClose: () => void; }` unchanged.

- [ ] **Step 1: Update imports**

Find the top of the file (imports block — read the file first to get its exact current
import lines, since this is the one file in this task group with an existing test that
could be sensitive to import-shape changes) and add, alongside whatever is already
there:
```tsx
import { X } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';
```

- [ ] **Step 2: Replace the outer container + header**

Find:
```tsx
  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-56 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">GPS Replay</div>
```
Replace with:
```tsx
  return (
    <div className="bg-surface-raised/95 border border-border-default backdrop-blur-sm w-56 text-xs space-y-2 p-2" style={{ borderRadius: 2 }}>
      <PanelTitleBar title="GPS Replay">
        <IconButton aria-label="Close" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-200 p-0.5">
          <X className="w-3 h-3" />
        </IconButton>
      </PanelTitleBar>
```

- [ ] **Step 3: Replace the footer — drop "Done", keep "Play"/"Pause" and "Stop"**

Find:
```tsx
      <div className="flex gap-2">
        <button onClick={playing ? stop : play} disabled={!positions.length}
          className="flex-1 bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={stop}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Stop
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
```
Replace with:
```tsx
      <div className="flex gap-2">
        <button onClick={playing ? stop : play} disabled={!positions.length}
          className="flex-1 bg-brand-500 text-black font-bold py-1 text-[10px] disabled:opacity-50" style={{ borderRadius: 2 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={stop}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 text-[10px]" style={{ borderRadius: 2 }}>
          Stop
        </button>
```

Leave the `rounded` usages on the three `<select>` dropdowns and the range slider
inside this file as a lower-priority pass — if time allows apply the same `rounded` →
`style={{borderRadius:2}}` swap used in Tasks 1-4, but do not let it block this task;
the outer-container/header/close-button change is the part validated against the
existing test.

- [ ] **Step 4: Run the existing test to confirm no regression**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/GpsReplayTool.test.tsx`
Expected: all existing tests still pass (they assert on `screen.getByText('Play')` /
`screen.getByText('Stop')` and `apiFetch` calls — none of which this restyle touches).

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/components/GpsReplayTool.tsx
git commit -m "style(map): restyle GpsReplayTool to match the dock design convention"
```

---

### Task 6: Rewrite `MultiStopRoutePanel.tsx` off inline styles

**Files:**
- Modify: `client/src/pages/map/components/MultiStopRoutePanel.tsx`

**Interfaces:** No prop changes — `Props` interface (`queue`, `units`, `selectedUnit`,
`result`, `loading`, `isMobile`, `onSelectUnit`, `onRemoveStop`, `onClear`,
`onOptimize`) unchanged; `QueuedStop` export unchanged.

- [ ] **Step 1: Replace the whole file**

This file is currently 100% inline `style={{}}` (no Tailwind tokens at all), with
hardcoded `GOLD = '#d4a017'` and `PANEL_BG = 'rgba(10,10,10,0.96)'` (pure black), and
`z-[1001]`. Replace the entire file with:

```tsx
// ============================================================
// RMPG Flex — Multi-Stop Patrol Route Panel
// ============================================================
// Floating panel for building an optimized one-unit-many-calls patrol
// route (PSO client requests, welfare checks, paper service, etc.).
// Queue calls from their popups, pick the responding unit, and let the
// Mapbox Optimization API solve the fastest visiting order.
// ============================================================

import { Route, X, Trash2, Zap, GripVertical } from 'lucide-react';
import type { MultiStopRoute } from '../../../hooks/useMapRouting';
import type { MapUnit } from '../utils/mapConstants';

export interface QueuedStop {
  callNumber: string;
  lat: number;
  lng: number;
  label?: string;
}

interface Props {
  queue: QueuedStop[];
  units: MapUnit[];
  selectedUnit: string | null;
  result: MultiStopRoute | null;
  loading: boolean;
  isMobile: boolean;
  onSelectUnit: (callSign: string) => void;
  onRemoveStop: (callNumber: string) => void;
  onClear: () => void;
  onOptimize: () => void;
}

export default function MultiStopRoutePanel({
  queue,
  units,
  selectedUnit,
  result,
  loading,
  isMobile,
  onSelectUnit,
  onRemoveStop,
  onClear,
  onOptimize,
}: Props) {
  if (queue.length === 0) return null;

  // Units that can actually be an origin (valid GPS).
  const routableUnits = units.filter((u) => u.latitude != null && u.longitude != null);
  const canOptimize = queue.length >= 1 && !!selectedUnit && !loading;

  return (
    <div
      className={`absolute z-30 bg-surface-raised/95 border border-border-default backdrop-blur-md font-mono overflow-hidden ${
        isMobile ? '' : ''
      }`}
      style={{
        ...(isMobile
          ? { top: 56, left: 8, right: 8 }
          : { top: 64, right: 16, width: 300 }),
        borderRadius: 2,
        boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border-subtle">
        <Route className="w-3.5 h-3.5 text-brand-gold-500" />
        <span className="text-[10px] font-black tracking-wider text-brand-gold-500 flex-1 uppercase">
          Patrol Route
        </span>
        <span className="text-[8px] font-black text-surface-base bg-brand-gold-500 px-1.5 py-px" style={{ borderRadius: 2 }}>
          {queue.length} STOP{queue.length === 1 ? '' : 'S'}
        </span>
        <button onClick={onClear} aria-label="Clear patrol route" className="text-rmpg-500 hover:text-rmpg-300 flex">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Unit selector */}
      <div className="px-2.5 py-2 border-b border-border-subtle">
        <div className="text-[7px] text-rmpg-500 tracking-wider mb-1 uppercase">Responding Unit</div>
        {routableUnits.length === 0 ? (
          <div className="text-[9px] text-red-400">No units with GPS available</div>
        ) : (
          <select
            id="ff-multistoproutepanel-0"
            value={selectedUnit ?? ''}
            onChange={(e) => onSelectUnit(e.target.value)}
            className="w-full bg-surface-overlay text-rmpg-300 border border-border-subtle px-1.5 py-1 text-[10px] outline-none"
            style={{ borderRadius: 2 }}
          >
            <option value="" disabled>
              Select unit…
            </option>
            {routableUnits.map((u) => (
              <option key={u.id} value={u.call_sign}>
                {u.call_sign} — {u.officer_name || 'Unassigned'}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Stops list — optimized order if we have a result, else queue order */}
      <div className="scrollbar-dark overflow-y-auto" style={{ maxHeight: isMobile ? 180 : 260 }}>
        {result
          ? result.stops.map((s) => (
              <div key={s.callNumber} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border-subtle">
                <span
                  className="w-[18px] h-[18px] shrink-0 flex items-center justify-center border text-brand-gold-500 text-[10px] font-black bg-surface-base"
                  style={{ borderRadius: 2 }}
                >
                  {s.order}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-rmpg-200 truncate">{s.callNumber}</div>
                  {s.label && <div className="text-[8px] text-rmpg-500 truncate">{s.label}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] text-brand-gold-500 font-bold">{s.legEta}</div>
                  <div className="text-[7px] text-rmpg-500">{s.legDistance}</div>
                </div>
              </div>
            ))
          : queue.map((s) => (
              <div key={s.callNumber} className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border-subtle">
                <GripVertical className="w-3 h-3 text-rmpg-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-rmpg-200 truncate">{s.callNumber}</div>
                  {s.label && <div className="text-[8px] text-rmpg-500 truncate">{s.label}</div>}
                </div>
                <button
                  onClick={() => onRemoveStop(s.callNumber)}
                  aria-label={`Remove ${s.callNumber}`}
                  className="text-rmpg-500 hover:text-red-400 shrink-0 flex p-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
      </div>

      {/* Result totals */}
      {result && (
        <div className="flex items-baseline gap-2.5 px-2.5 py-2 border-t border-border-subtle">
          <span className="text-[7px] text-rmpg-500 tracking-wider uppercase">Total</span>
          <span className="text-[15px] font-black text-brand-gold-500">{result.totalEta}</span>
          <span className="text-[10px] text-rmpg-400">{result.totalDistance}</span>
        </div>
      )}

      {/* Action */}
      <div className="px-2.5 py-2">
        <button
          onClick={onOptimize}
          disabled={!canOptimize}
          className={`w-full flex items-center justify-center gap-1.5 py-1.5 text-[9px] font-black tracking-wider uppercase transition-colors ${
            canOptimize
              ? 'bg-brand-gold-500 text-surface-base border border-brand-gold-500'
              : 'bg-surface-raised text-rmpg-600 border border-border-subtle cursor-not-allowed'
          }`}
          style={{ borderRadius: 2 }}
        >
          <Zap className="w-3 h-3" />
          {loading ? 'Optimizing…' : result ? 'Re-optimize' : 'Optimize & Route'}
        </button>
      </div>
    </div>
  );
}
```

(The `UNIT_STATUS_HEX` import from the original file was unused there — confirm this
during implementation by checking the original file for any actual reference to
`UNIT_STATUS_HEX` before dropping it; if it turns out to be used somewhere this plan's
excerpt didn't capture, keep the import and its usage.)

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new TypeScript errors.

- [ ] **Step 3: Full client suite**

Run: `cd client && npx vitest run`
Expected: no new failures (this component has no dedicated test file — confirmed
during planning).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/map/components/MultiStopRoutePanel.tsx
git commit -m "style(map): rewrite MultiStopRoutePanel off inline styles onto design tokens"
```

---

### Task 7: `DockSection`/`MapLeftDock`/`MapBottomTray` — loading indicator + collapsible + pinned support

**Files:**
- Modify: `client/src/pages/map/components/DockSection.tsx`
- Modify: `client/src/pages/map/components/MapLeftDock.tsx`
- Modify: `client/src/pages/map/components/MapBottomTray.tsx`
- Modify: `client/src/pages/map/components/__tests__/DockSection.test.tsx`
- Modify: `client/src/pages/map/components/__tests__/MapLeftDock.test.tsx`

**Interfaces:**
- Produces: `DockSectionProps` gains `collapsible?: boolean` (default `true`). When
  `false`, the section renders as a static, always-expanded header with no click
  handler and no chevron. `DockToggleItem` gains `pinned?: boolean` (default
  `false`/undefined) — when true, `DockToggleRow` renders a colored left-border accent
  using the item's own resolved `dotColor`. `MapLeftDockSection` (in `MapLeftDock.tsx`)
  gains `collapsible?: boolean`, forwarded to its `DockSection`. `MapBottomTray.tsx`'s
  Layers-tab rendering (which builds `DockSection`s directly from `leftSections`, not
  through `MapLeftDock`) must forward the same field for the tray to stay consistent
  with the desktop dock.
- Consumes: nothing new from other tasks.

- [ ] **Step 1: Write failing tests for the new `DockSection` behavior**

Append to `client/src/pages/map/components/__tests__/DockSection.test.tsx`, inside the
existing `describe('DockSection', ...)` block:

```tsx
  it('renders as always-expanded with no toggle button when collapsible is false', () => {
    render(<DockSection title="Live Conditions" collapsible={false}><div>Traffic</div></DockSection>);
    expect(screen.getByText('Traffic')).toBeInTheDocument();
    // No clickable header button — just static text, so clicking the title does nothing.
    fireEvent.click(screen.getByText('Live Conditions'));
    expect(screen.getByText('Traffic')).toBeInTheDocument();
  });
```

And inside the existing `describe('DockToggleRow', ...)` block:

```tsx
  it('renders a colored left-border accent when pinned is true', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'p1audio', label: 'P1 Audio Alert', active: true, onToggle, color: '#ef4444', pinned: true }} />);
    const row = screen.getByText('P1 Audio Alert').closest('button')!;
    expect(row).toHaveStyle({ borderLeft: '3px solid #ef4444' });
  });

  it('has no left-border accent when pinned is false or omitted', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'traffic', label: 'Live Traffic', active: true, onToggle, color: '#22c55e' }} />);
    const row = screen.getByText('Live Traffic').closest('button')!;
    expect(row).not.toHaveStyle({ borderLeft: '3px solid #22c55e' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/DockSection.test.tsx`
Expected: FAIL — `collapsible` prop doesn't exist yet, `pinned` field isn't read yet.

- [ ] **Step 3: Implement in `DockSection.tsx`**

Replace the full file with:

```tsx
// ============================================================
// RMPG Flex — Map Dock building blocks
// Shared accordion section + toggle row used by MapLeftDock,
// MapRightDock, and MapBottomTray so all three render the same
// section/toggle markup instead of duplicating it.
// ============================================================

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

export interface DockSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** When false, renders as a static always-expanded header with no
   *  collapse control — for sections whose state must always stay
   *  visible (e.g. safety-critical toggles). Defaults to true. */
  collapsible?: boolean;
  children: ReactNode;
}

export default function DockSection({ title, defaultOpen = true, collapsible = true, children }: DockSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  if (!collapsible) {
    return (
      <div className="border-b border-border-subtle">
        <div className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-rmpg-400">
          <span>{title}</span>
        </div>
        <div className="pb-1">{children}</div>
      </div>
    );
  }

  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-rmpg-400 hover:text-rmpg-200 transition-colors"
      >
        <span>{title}</span>
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {isOpen && <div className="pb-1">{children}</div>}
    </div>
  );
}

export interface DockToggleItem {
  id: string;
  label: string;
  active: boolean;
  onToggle: () => void;
  color?: string;
  description?: string;
  loading?: boolean;
  /** Renders a colored left-border accent so this toggle's state stays
   *  glanceable even among other rows — for safety-critical items. */
  pinned?: boolean;
}

export function DockToggleRow({ item }: { item: DockToggleItem }) {
  const dotColor = item.color ?? 'var(--brand-gold)';
  const glowColor = dotColor.startsWith('#') ? `${dotColor}80` : dotColor;
  return (
    <button
      type="button"
      onClick={item.onToggle}
      title={item.description}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors"
      style={{
        background: item.active ? 'var(--surface-raised)' : 'transparent',
        color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderLeft: item.pinned ? `3px solid ${dotColor}` : undefined,
      }}
    >
      <span
        className="w-1.5 h-1.5 shrink-0"
        style={{
          borderRadius: '50%',
          background: item.active ? dotColor : 'var(--text-secondary)',
          boxShadow: item.active ? `0 0 4px ${glowColor}` : 'none',
        }}
      />
      <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
      {item.loading && <Loader2 className="w-3 h-3 shrink-0 animate-spin" style={{ color: 'var(--brand-gold)' }} />}
    </button>
  );
}
```

(This also implements D5's loading-indicator fix: the 6px pulsing dot is replaced with
a `Loader2` spin icon, matching the app's better-established loading pattern seen
elsewhere, e.g. `DispatchToolPanel`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/DockSection.test.tsx`
Expected: PASS (10 tests: the original 8 plus these 2 new ones).

- [ ] **Step 5: Thread `collapsible` through `MapLeftDock.tsx`**

Find:
```tsx
export interface MapLeftDockSection {
  title: string;
  items: DockToggleItem[];
}
```
Replace with:
```tsx
export interface MapLeftDockSection {
  title: string;
  items: DockToggleItem[];
  /** Forwarded to DockSection — when false, this section renders
   *  always-expanded with no collapse control. */
  collapsible?: boolean;
}
```

Find:
```tsx
      {sections.map((section) => (
        <DockSection key={section.title} title={section.title}>
          {section.items.map((item) => (
            <DockToggleRow key={item.id} item={item} />
          ))}
        </DockSection>
      ))}
```
Replace with:
```tsx
      {sections.map((section) => (
        <DockSection key={section.title} title={section.title} collapsible={section.collapsible}>
          {section.items.map((item) => (
            <DockToggleRow key={item.id} item={item} />
          ))}
        </DockSection>
      ))}
```

- [ ] **Step 6: Add a test confirming `MapLeftDock` forwards `collapsible`**

Append to `client/src/pages/map/components/__tests__/MapLeftDock.test.tsx`, inside the
existing `describe('MapLeftDock', ...)` block:

```tsx
  it('forwards collapsible=false to a non-collapsible section', () => {
    const sections = [{ title: 'Live Conditions', collapsible: false, items: [{ id: 'p1audio', label: 'P1 Audio Alert', active: true, onToggle: vi.fn() }] }];
    render(<MapLeftDock sections={sections} />);
    fireEvent.click(screen.getByText('Live Conditions'));
    expect(screen.getByText('P1 Audio Alert')).toBeInTheDocument();
  });
```

- [ ] **Step 7: Thread `collapsible` through `MapBottomTray.tsx`'s Layers tab**

Read `client/src/pages/map/components/MapBottomTray.tsx` first to confirm its current
exact rendering of the Layers tab (it maps `leftSections` directly to `DockSection`
elements — built in Task 6 of the prior plan). Find the line rendering each `DockSection`
for `activeTab === 'layers'`:
```tsx
          {activeTab === 'layers' && leftSections.map((section) => (
            <DockSection key={section.title} title={section.title}>
              {section.items.map((item) => <DockToggleRow key={item.id} item={item} />)}
            </DockSection>
          ))}
```
Replace with:
```tsx
          {activeTab === 'layers' && leftSections.map((section) => (
            <DockSection key={section.title} title={section.title} collapsible={section.collapsible}>
              {section.items.map((item) => <DockToggleRow key={item.id} item={item} />)}
            </DockSection>
          ))}
```

- [ ] **Step 8: Run the full test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new TypeScript errors, no test regressions.

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/map/components/DockSection.tsx client/src/pages/map/components/MapLeftDock.tsx client/src/pages/map/components/MapBottomTray.tsx client/src/pages/map/components/__tests__/DockSection.test.tsx client/src/pages/map/components/__tests__/MapLeftDock.test.tsx
git commit -m "feat(map): add collapsible/pinned support to DockSection, better loading indicator"
```

---

### Task 8: `SpeedAnalyticsPanel.tsx` loading text size

**Files:**
- Modify: `client/src/pages/map/components/SpeedAnalyticsPanel.tsx`

**Interfaces:** No changes.

- [ ] **Step 1: Fix the loading text size**

Find:
```tsx
          {loading && <span className="text-[8px] text-rmpg-500">loading…</span>}
```
Replace with:
```tsx
          {loading && <span className="text-[10px] text-rmpg-500">loading…</span>}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/components/SpeedAnalyticsPanel.tsx
git commit -m "style(map): increase SpeedAnalyticsPanel's loading text to a legible size"
```

---

### Task 9: Remove `RulerTool` (E2)

**Files:**
- Delete: `client/src/pages/map/components/RulerTool.tsx`
- Delete: `client/src/pages/map/components/__tests__/RulerTool.test.tsx`
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:** Removes the `ruler` entry from `mapRightDockSections` entirely — no
replacement, no renamed successor (Measure is the sole remaining measurement tool,
already present).

- [ ] **Step 1: Delete the files**

```bash
git rm client/src/pages/map/components/RulerTool.tsx client/src/pages/map/components/__tests__/RulerTool.test.tsx
```

- [ ] **Step 2: Remove the import**

In `client/src/pages/map/MapboxMapPage.tsx`, find and delete this line:
```tsx
import RulerTool from './components/RulerTool';
```

- [ ] **Step 3: Remove the floating-tool mount block**

Find:
```tsx
      {activeFloatingTool === 'ruler' && mapRef.current && (
        <div className="absolute top-16 right-3 z-30">
          <RulerTool map={mapRef.current} onClose={() => setActiveFloatingTool(null)} />
        </div>
      )}
```
Delete this block entirely.

- [ ] **Step 4: Remove the `ruler` entry from `mapRightDockSections`**

In the `Analysis` section's `items` array (inside the `mapRightDockSections`
`useMemo`), find and delete this line:
```tsx
        { id: 'ruler', label: 'Ruler', active: activeFloatingTool === 'ruler', onToggle: () => setActiveFloatingTool((v) => v === 'ruler' ? null : 'ruler'), color: '#d4a017', description: 'Multi-point distance measurement' },
```

(This step only removes the `ruler` line — the full re-bucketing of the rest of
`mapLeftDockSections`/`mapRightDockSections`, including everything else that touches
these two arrays, happens in Task 10. Do the `ruler` removal here, first, so this
task's diff is self-contained and independently reviewable before the larger
reorganization lands on top of it.)

- [ ] **Step 5: Typecheck and full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new TypeScript errors (confirm no other file references `RulerTool` —
`grep -rn "RulerTool" client/src` should return nothing), no test regressions.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(map): remove Ruler — Measure already covers distance + area

RulerTool was a separate implementation of distance-only measurement,
a strict subset of what the existing Measure tool already does
(distance + area). Confirmed with the user before removing.
EOF
)"
```

---

### Task 10: Reorganize the dock taxonomy in `MapboxMapPage.tsx`

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

**Interfaces:** Consumes `collapsible`/`pinned` from Task 7. This task performs every
remaining taxonomy change (E1, E3–E8), the E9 data wiring (marking the 3
safety-critical items `pinned: true` and the Live Conditions section
`collapsible: false`), and D3 (the 2 hardcoded-hex fixes). This is one task because
every change here lives inside the same two `useMemo` arrays (plus two nearby dropdown
blocks) — splitting it further would mean re-touching the same few hundred lines
across multiple commits for no independent-review benefit.

- [ ] **Step 1: Replace `mapLeftDockSections` in full**

Find the entire current `mapLeftDockSections` `useMemo` (from `const
mapLeftDockSections = useMemo<MapLeftDockSection[]>(() => [` through its closing `],
[...dependency array...]);`) and replace it with:

```tsx
  const mapLeftDockSections = useMemo<MapLeftDockSection[]>(() => [
    {
      title: 'Live Conditions',
      collapsible: false,
      items: [
        { id: 'traffic', label: 'Live Traffic', active: traffic.enabled, onToggle: traffic.toggle, color: '#22c55e', description: 'Real-time congestion' },
        { id: 'weather', label: 'Weather Radar', active: weatherRadar.enabled, onToggle: weatherRadar.toggle, color: '#3b82f6', description: 'Precipitation overlay' },
        { id: 'p1audio', label: 'P1 Audio Alert', active: p1AudioEnabled, onToggle: () => setP1AudioEnabled((v: boolean) => !v), color: '#ef4444', description: 'Chirp on new P1 calls', pinned: true },
        { id: 'autopan', label: 'Auto-Pan P1', active: autoPanEnabled, onToggle: () => setAutoPanEnabled((v: boolean) => !v), color: '#ef4444', description: 'Pan to new Priority 1 calls', pinned: true },
        { id: 'geofences', label: 'Geofence Zones', active: geofenceAlerts.enabled, onToggle: geofenceAlerts.toggle, color: '#ef4444', description: 'Premise alerts on click', pinned: true },
      ],
    },
    {
      title: 'Units & Calls',
      items: [
        { id: 'breadcrumbs', label: 'Unit Trails', active: breadcrumbs.enabled, onToggle: breadcrumbs.toggle, color: '#3b82f6', description: 'GPS history (B)' },
        { id: 'clustering', label: 'Call Clusters', active: clustering.enabled, onToggle: clustering.toggle, color: '#d4a017', description: 'Group markers (C)' },
        { id: 'incidents', label: 'Incidents', active: incidentsEnabled, onToggle: () => setIncidentsEnabled((v) => !v), color: '#ef4444', description: 'RMS incident clusters', loading: incidentsLayer.loading },
        { id: 'repeat-addresses', label: 'Repeat Addresses', active: repeatAddressesEnabled, onToggle: () => setRepeatAddressesEnabled((v) => !v), color: '#64d264', description: 'Locations with 3+ calls', loading: repeatAddresses.loading },
        { id: 'selfpos', label: 'My Position', active: selfPosVisible, onToggle: () => setSelfPosVisible((v: boolean) => !v), color: '#3b82f6' },
      ],
    },
    {
      title: 'Historical Analysis',
      items: [
        { id: 'heatmap', label: `Crime Heatmap (${heatmapMode === 'live' ? 'Live' : 'Historical'})`, active: heatmap.enabled, onToggle: () => { void populateAndToggleHeatmap(); }, color: '#ef4444', description: 'Incident density (H) — click label to switch Live/Historical' },
        { id: 'call-history', label: 'Call History', active: historyCallsEnabled, onToggle: () => setHistoryCallsEnabled((v) => !v), color: '#64d264', description: 'Past 30 days of calls', loading: historyCalls.loading },
        { id: 'speed-heatmap', label: 'Speed Heatmap', active: speedHeatmapEnabled, onToggle: () => setSpeedHeatmapEnabled((v) => !v), color: '#f97316', description: 'GPS speed density', loading: speedHeatmap.loading },
        { id: 'speed-violations', label: 'Speed Violations', active: speedViolationsEnabled, onToggle: () => setSpeedViolationsEnabled((v) => !v), color: '#ef4444', description: 'Recent high-speed events — click a marker for the speed graph', loading: speedViolationsLayer.loading },
        { id: 'pursuit-segments', label: 'Pursuit Tracks', active: pursuitSegmentsEnabled, onToggle: () => setPursuitSegmentsEnabled((v) => !v), color: '#dc2626', description: 'Recent vehicle/foot pursuit paths', loading: pursuitSegmentsLayer.loading },
        { id: 'response-time', label: 'Response Time by Beat', active: responseTimeEnabled, onToggle: () => setResponseTimeEnabled((v) => !v), color: '#4caf50', description: '30-day avg response time (historical)', loading: responseTime.loading },
      ],
    },
    {
      title: 'Administrative Boundaries',
      items: [
        { id: 'beats', label: 'Beat Boundaries', active: beatsVisible, onToggle: () => setBeatsVisible((v: boolean) => !v), color: '#d4a017' },
        ...districtHierarchy.hierarchyConfigs.map(cfg => ({
          id: `district-${cfg.id}`,
          label: cfg.label,
          active: districtHierarchy.hierarchyStates[cfg.id]?.visible ?? false,
          onToggle: () => districtHierarchy.toggleHierarchyLayer(cfg.id),
          color: '#d4a017',
          description: cfg.description,
        })),
        ...geoJsonLayers.configs.map(cfg => ({
          id: `geo-${cfg.id}`,
          label: cfg.label,
          active: geoJsonLayers.layerStates[cfg.id]?.visible ?? false,
          onToggle: () => geoJsonLayers.toggleGeoLayer(cfg.id),
          color: cfg.style.strokeColor || cfg.style.fillColor,
          description: cfg.file.replace('.geojson', ''),
        })),
      ],
    },
    {
      title: 'Risk & Coverage',
      items: [
        { id: 'coverage-gaps', label: 'Coverage Gaps', active: coverageGapsEnabled, onToggle: () => setCoverageGapsEnabled((v) => !v), color: '#f08228', description: 'Response-time gap grid', loading: coverageGaps.loading },
        { id: 'safety-zones', label: 'Safety Zones', active: safetyZonesEnabled, onToggle: () => setSafetyZonesEnabled((v) => !v), color: '#c81e1e', description: 'Risk-weighted call clusters', loading: safetyZones.loading },
        { id: 'isochrone', label: 'Response Zones', active: isochroneEnabled, onToggle: toggleIsochrone, color: '#22c55e', description: '5/10/15 min driving' },
      ],
    },
    {
      title: 'Terrain & 3D',
      items: [
        { id: 'terrain', label: '3D Terrain', active: terrainEnabled, onToggle: () => setTerrainEnabled((v: boolean) => !v), color: '#a855f7' },
        { id: 'buildings', label: '3D Buildings', active: buildings3dEnabled, onToggle: () => setBuildings3dEnabled((v: boolean) => !v), color: '#666666', description: 'Extruded building footprints' },
        { id: 'daylight', label: 'Day/Night', active: daylight.enabled, onToggle: daylight.toggle, color: '#f59e0b', description: 'Solar terminator (D)' },
        { id: 'projection', label: `Projection: ${projection.projection}`, active: projection.projection !== 'mercator', onToggle: projection.cycle, color: '#14b8a6', description: 'Globe / Mercator / Equal Earth' },
        { id: 'atmosphere', label: `Atmosphere: ${atmosphere.preset}`, active: atmosphere.enabled, onToggle: atmosphere.cycle, color: '#a855f7', description: 'Fog, sky & star effects' },
        { id: 'grid', label: 'Coordinate Grid', active: coordGrid.enabled, onToggle: coordGrid.toggle, color: '#d4a017', description: 'Lat/Lng graticule (G)' },
        { id: 'orbit', label: 'Orbit Animation', active: cameraAnimation.animating, onToggle: () => cameraAnimation.animating ? cameraAnimation.stop() : cameraAnimation.orbit(), color: '#f59e0b', description: 'Cinematic map rotation' },
      ],
    },
  ], [heatmap, traffic, breadcrumbs, clustering, daylight, geofenceAlerts, isochroneEnabled, toggleIsochrone, beatsVisible, districtHierarchy, terrainEnabled, selfPosVisible, autoPanEnabled, p1AudioEnabled, setBeatsVisible, setTerrainEnabled, setSelfPosVisible, setAutoPanEnabled, setP1AudioEnabled, weatherRadar, coordGrid, geoJsonLayers, buildings3dEnabled, setBuildings3dEnabled, projection, atmosphere, cameraAnimation, incidentsEnabled, incidentsLayer.loading, coverageGapsEnabled, coverageGaps.loading, responseTimeEnabled, responseTime.loading, safetyZonesEnabled, safetyZones.loading, historyCallsEnabled, historyCalls.loading, heatmapMode, populateAndToggleHeatmap, repeatAddressesEnabled, repeatAddresses.loading, speedHeatmapEnabled, speedHeatmap.loading, speedViolationsEnabled, speedViolationsLayer.loading, pursuitSegmentsEnabled, pursuitSegmentsLayer.loading]);
```

Two changes from the current dependency array: `deckEnabled`/`setDeckEnabled` are
removed (the `deck` item moves to Diagnostics in Step 2 below, so it's no longer read
in this `useMemo`). Everything else in the dependency list is unchanged from the
current array — confirm this against the actual current file before finalizing, since
an incorrect dependency array is a real bug (stale closures), not just a lint nit.

- [ ] **Step 2: Replace `mapRightDockSections` in full**

Find the entire current `mapRightDockSections` `useMemo` and replace it with:

```tsx
  const mapRightDockSections = useMemo<MapRightDockSection[]>(() => [
    {
      title: 'Dispatch Tools',
      items: [
        { id: 'directions', label: 'Live Directions', active: directionsPanel.result !== null, onToggle: () => directionsPanel.result ? directionsPanel.clearDirections() : directionsPanel.setPickMode('origin'), color: '#3b82f6', description: 'Point-to-point routing engine' },
        { id: 'nav-overlay', label: 'Manual Route', active: activeFloatingTool === 'nav-overlay', onToggle: () => setActiveFloatingTool((v) => v === 'nav-overlay' ? null : 'nav-overlay'), color: '#3b82f6', description: 'Draw a route between two typed coordinates' },
        { id: 'identify', label: 'Identify', active: identifyEnabled, onToggle: () => setIdentifyEnabled((v) => !v), color: '#eab308', description: 'Click the map for place/district info', loading: tilequery.loading },
        { id: 'places', label: 'Places Search', active: placesSearch.results.length > 0, onToggle: () => placesSearch.results.length > 0 ? placesSearch.clearResults() : placesSearch.searchCategory('restaurant'), color: '#10b981', description: 'Nearby POI search' },
        { id: 'bookmarks', label: 'Bookmarks', active: mapBookmarks.bookmarks.length > 0, onToggle: () => mapBookmarks.dropMode ? mapBookmarks.setDropMode(false) : mapBookmarks.setDropMode(true), color: '#eab308', description: 'Save map locations' },
        { id: 'optimize', label: 'Route Optimizer', active: multiStopPanelOpen, onToggle: () => setMultiStopPanelOpen((v) => !v), color: '#8b5cf6', description: 'Queue calls, pick a unit, optimize the visiting order' },
      ],
    },
    {
      title: 'Measurement & Marking',
      items: [
        { id: 'measure', label: 'Measure', active: measure.mode !== 'none', onToggle: () => setShowMeasureMenu(v => !v), color: '#3b82f6', description: 'Distance / area measurement' },
        { id: 'buffer-ring', label: 'Buffer Ring', active: activeFloatingTool === 'buffer-ring', onToggle: () => setActiveFloatingTool((v) => v === 'buffer-ring' ? null : 'buffer-ring'), color: '#f08228', description: 'Radius rings around a point' },
        { id: 'annotation', label: 'Annotations', active: activeFloatingTool === 'annotation', onToggle: () => setActiveFloatingTool((v) => v === 'annotation' ? null : 'annotation'), color: '#3b82f6', description: 'Pin notes on the map' },
      ],
    },
    {
      title: 'Drawing & Tracking',
      items: [
        { id: 'draw', label: 'Quick Draw', active: drawing.mode !== 'none', onToggle: () => setShowDrawMenu(v => !v), color: '#d4a017', description: 'Polygon / polyline / circle — session-only, not saved' },
        { id: 'gl-draw', label: 'Draw & Edit', active: glDraw.enabled, onToggle: () => glDraw.toggle(), color: '#d4a017', description: 'Vertex editing — select and reshape existing shapes' },
        { id: 'draw-geofence', label: 'Create Geofence Zone', active: activeFloatingTool === 'draw-geofence', onToggle: () => setActiveFloatingTool((v) => v === 'draw-geofence' ? null : 'draw-geofence'), color: '#a855f7', description: 'Saves a named alert/exclusion zone' },
        { id: 'gps-replay', label: 'GPS Replay', active: activeFloatingTool === 'gps-replay', onToggle: () => setActiveFloatingTool((v) => v === 'gps-replay' ? null : 'gps-replay'), color: '#22c55e', description: 'Scrub a unit\'s GPS history on a timeline' },
        { id: 'speed-analytics', label: 'Speed Analytics Panel', active: speedAnalyticsPanelOpen, onToggle: () => setSpeedAnalyticsPanelOpen((v) => !v), color: '#f97316', description: 'Per-beat speed stats + coverage timeline', loading: speedZoneStats.loading },
      ],
    },
    {
      title: 'Diagnostics',
      items: [
        { id: 'inspect', label: 'Feature Inspector', active: featureInspect.enabled, onToggle: featureInspect.toggle, color: '#8b5cf6', description: 'Click features for details' },
        { id: 'mapmatch', label: 'Map Match Trace', active: mapMatchTrace.collecting, onToggle: () => mapMatchTrace.collecting ? mapMatchTrace.clear() : mapMatchTrace.startCollecting(), color: '#fb923c', description: 'Snap GPS to roads' },
        { id: 'deck', label: 'GPU Overlay', active: deckEnabled, onToggle: () => setDeckEnabled((v: boolean) => !v), color: '#a855f7', description: 'Deck.gl accelerated rendering' },
      ],
    },
  ], [directionsPanel, placesSearch, mapBookmarks, multiStopPanelOpen, speedAnalyticsPanelOpen, speedZoneStats.loading, activeFloatingTool, measure.mode, drawing.mode, glDraw, identifyEnabled, tilequery.loading, featureInspect, mapMatchTrace, deckEnabled, setDeckEnabled]);
```

Two changes from the current dependency array: the `ruler` line is gone (already
removed in Task 9), and `deckEnabled`/`setDeckEnabled` are added (the `deck` item
moves into this array from `mapLeftDockSections` in this step). Confirm the rest of
the dependency list matches the current file exactly before finalizing.

- [ ] **Step 3: Fix the two hardcoded-hex spots (D3)**

Find (Measure dropdown, both `distance` and `area` options use this class pattern):
```tsx
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              measure.mode === 'distance' ? 'text-[#3b82f6] bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
```
Replace with:
```tsx
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              measure.mode === 'distance' ? 'text-brand-gold-500 bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
```
And find:
```tsx
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              measure.mode === 'area' ? 'text-[#3b82f6] bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
```
Replace with:
```tsx
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              measure.mode === 'area' ? 'text-brand-gold-500 bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
```

Find (Active Route Panel ETA text):
```tsx
            <span className="text-[#22c55e] font-semibold">{routing.activeRoute.eta}</span>
```
Replace with:
```tsx
            <span className="text-brand-gold-500 font-semibold">{routing.activeRoute.eta}</span>
```

- [ ] **Step 4: Typecheck and full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new TypeScript errors — in particular, confirm every `id` from the old
arrays still appears exactly once across the two new arrays (cross-check against this
task's own two full replacement blocks above — every id from the pre-Task-9 arrays
should be present except `ruler`, which Task 9 already removed). No test regressions.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "$(cat <<'EOF'
refactor(map): reorganize dock taxonomy for findability

- Rename 3 drawing tools to clarify their distinct purposes (Quick
  Draw / Draw & Edit / Create Geofence Zone)
- Move Manual Route (nav-overlay) next to Live Directions in
  Dispatch Tools (was split across two docks for one concept)
- Move Response Time by Beat into Historical Analysis (was filed
  under Boundaries despite being explicitly historical)
- Move Identify into Dispatch Tools (routine lookup, not diagnostic)
- Move GPU Overlay into Diagnostics (rendering switch, not a visual
  feature)
- Split the oversized Boundaries section into Administrative
  Boundaries and Risk & Coverage
- Split the oversized Analysis section into Measurement & Marking
  and Drawing & Tracking
- Pin P1 Audio Alert / Auto-Pan P1 / Geofence Zones with a visual
  accent and make Live Conditions permanently expanded, so
  safety-critical toggle state can never be hidden
- Fix 2 hardcoded hex colors (Measure dropdown, Active Route ETA)
  to use the existing brand-gold token
EOF
)"
```

---

### Task 11: Manual browser verification

**Files:** none (verification only).

This task changes visual styling across 7 components and reorganizes ~35 toggle
entries — automated tests (typecheck + the component unit tests) don't cover visual
appearance or whether the reorganized taxonomy actually reads well on screen.

- [ ] **Step 1: Start the client dev server**

Run: `cd client && npm run dev`

- [ ] **Step 2: Verify the 5 restyled floating panels**

Log in, navigate to `/map`. From the Right Dock, open each of: Buffer Ring, Map
Annotations (Annotations), Nav Overlay (Manual Route), Create Geofence Zone, GPS
Replay. For each, confirm:
- The panel has the dock-style background/border/blur, 2px corners, and a
  `PanelTitleBar` header with a Lucide X close button (not a "Done"/"Close" text
  button).
- Clicking the X closes the panel.
- For Create Geofence Zone specifically: start drawing a shape, then click the X —
  confirm the in-progress shape is actually cleared from the map (not left behind),
  since this button does `deleteAll()` + close.
- The panel's actual functionality (placing a buffer ring, saving an annotation,
  getting a route, drawing a geofence, scrubbing GPS replay) still works exactly as
  before — this is a pure restyle, so nothing about the underlying behavior should
  differ.

- [ ] **Step 3: Verify `MultiStopRoutePanel`**

Queue at least one call for patrol routing (however this app's existing flow triggers
that — e.g. from a call popup) and open the Route Optimizer. Confirm it now renders
with the dock's navy/token styling (not pure black), the gold accent still reads
clearly, and picking a unit + optimizing still works.

- [ ] **Step 4: Verify Ruler is gone, Measure still works**

Confirm there's no "Ruler" entry anywhere in the Right Dock. Open Measure, confirm
both Distance and Area modes work and the active-mode highlight now shows in gold
(not blue).

- [ ] **Step 5: Verify the reorganized taxonomy**

Confirm: Live Directions and Manual Route sit together in Dispatch Tools; Response
Time by Beat is in Historical Analysis, not Boundaries; Identify is in Dispatch Tools;
GPU Overlay is in Diagnostics, not Terrain & 3D; Boundaries is now two sections
(Administrative Boundaries, Risk & Coverage); Analysis is now two sections
(Measurement & Marking, Drawing & Tracking); the three drawing tools show their new
names (Quick Draw / Draw & Edit / Create Geofence Zone).

- [ ] **Step 6: Verify the pinned safety toggles**

Confirm Live Conditions has no collapse chevron and cannot be collapsed by clicking its
header. Confirm P1 Audio Alert, Auto-Pan P1, and Geofence Zones each show a visible
colored left-border accent that the other two items in that section (Live Traffic,
Weather Radar) do not have.

- [ ] **Step 7: Verify the loading-indicator change**

Toggle on a layer with a `loading` field (e.g. Incidents, Coverage Gaps, Speed
Analytics Panel) and confirm the loading indicator is now a visible spinning icon,
not a barely-visible static dot.

- [ ] **Step 8: Report results**

Note in the PR description which of the above passed, and flag anything that didn't —
in particular the `deleteAll()`-on-close behavior for Create Geofence Zone (Step 2),
since that's the one place this plan changes behavior slightly beyond pure restyle
(consolidating two footer actions into one close action).
