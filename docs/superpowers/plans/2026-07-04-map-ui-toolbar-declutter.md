# Map UI Toolbar Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `MapboxMapPage.tsx`'s ~85 flat icon-button toggles into 5 categorized groups (Overlays, Analysis, Drawing & Measure, Alerts & Safety, View), per `docs/superpowers/specs/2026-07-04-map-ui-toolbar-declutter-design.md` (Phase 3 of the Map UI redesign program).

**Architecture:** Create one small reusable presentational component, `ToolbarDropdownGroup`, in `client/src/pages/map/components/ToolbarDropdownGroup.tsx` — takes an icon, label, open/close state, and children (the group's member `IconButton`s), rendering the same expand/collapse dropdown pattern already used by the existing measure/draw menus in `MapboxMapPage.tsx`. Each of the 4 dropdown groups (Overlays, Analysis, Drawing & Measure, View) becomes one `ToolbarDropdownGroup` instance; Alerts & Safety stays a flat, always-visible 3-button row (no dropdown, per the spec's safety requirement). No hook/state logic changes — every toggle's existing `onClick`/`enabled` wiring is moved as-is into its new group, not rewritten.

**Tech Stack:** React, TypeScript, existing `IconButton` component, Tailwind tokens (post Phase 2).

---

## Task 1: Create `ToolbarDropdownGroup` component

**Files:**
- Create: `client/src/pages/map/components/ToolbarDropdownGroup.tsx`
- Create: `client/src/pages/map/components/__tests__/ToolbarDropdownGroup.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/map/components/__tests__/ToolbarDropdownGroup.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Layers } from 'lucide-react';
import ToolbarDropdownGroup from '../ToolbarDropdownGroup';

describe('ToolbarDropdownGroup', () => {
  it('renders the trigger button and hides children until opened', () => {
    render(
      <ToolbarDropdownGroup icon={Layers} label="Overlays" open={false} onToggle={vi.fn()}>
        <div data-testid="child-toggle">child</div>
      </ToolbarDropdownGroup>
    );
    expect(screen.getByLabelText('Overlays')).toBeInTheDocument();
    expect(screen.queryByTestId('child-toggle')).not.toBeInTheDocument();
  });

  it('shows children when open is true', () => {
    render(
      <ToolbarDropdownGroup icon={Layers} label="Overlays" open={true} onToggle={vi.fn()}>
        <div data-testid="child-toggle">child</div>
      </ToolbarDropdownGroup>
    );
    expect(screen.getByTestId('child-toggle')).toBeInTheDocument();
  });

  it('calls onToggle when the trigger button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <ToolbarDropdownGroup icon={Layers} label="Overlays" open={false} onToggle={onToggle}>
        <div>child</div>
      </ToolbarDropdownGroup>
    );
    fireEvent.click(screen.getByLabelText('Overlays'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/ToolbarDropdownGroup.test.tsx`
Expected: FAIL — `Cannot find module '../ToolbarDropdownGroup'`

- [ ] **Step 3: Write the component**

First run `grep -n "showAdvancedToolbar" client/src/pages/map/MapboxMapPage.tsx` and read the surrounding ~10 lines to confirm the exact trigger-button className/style pattern already established (`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm`, `style={{ borderRadius: 2 }}`) — match it exactly so the new groups look identical to the existing "Advanced map tools" trigger button, not a new visual style.

```tsx
// client/src/pages/map/components/ToolbarDropdownGroup.tsx
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import IconButton from '../../../components/IconButton';

interface ToolbarDropdownGroupProps {
  icon: LucideIcon;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** A collapsible group of related map-toolbar toggles, sharing one trigger
 *  button. Matches the existing "Advanced map tools" expand/collapse pattern
 *  in MapboxMapPage.tsx — extracted here so Overlays/Analysis/Drawing &
 *  Measure/View can each reuse it instead of duplicating the trigger markup. */
export default function ToolbarDropdownGroup({
  icon: Icon, label, open, onToggle, children,
}: ToolbarDropdownGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <IconButton
        aria-label={label}
        onClick={onToggle}
        className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${
          open ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'
        }`}
        style={{ borderRadius: 2 }}
        title={label}
      >
        <Icon className="w-4 h-4" />
      </IconButton>
      {open && (
        <div className="flex flex-col gap-1">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/ToolbarDropdownGroup.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/components/ToolbarDropdownGroup.tsx client/src/pages/map/components/__tests__/ToolbarDropdownGroup.test.tsx
git commit -m "feat(map): add ToolbarDropdownGroup component for toolbar declutter"
```

---

## Task 2: Migrate "Overlays" group (beats, terrain, isochrone, self-position, breadcrumbs, daylight, coord grid, weather radar, GPU overlay)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add the group's open/close state**

Find the existing `showAdvancedToolbar`/`showDrawMenu`/`showMeasureMenu` state declarations (`grep -n "showAdvancedToolbar\|showDrawMenu\|showMeasureMenu" client/src/pages/map/MapboxMapPage.tsx`) and add a sibling declaration immediately after them:

```ts
const [showOverlaysGroup, setShowOverlaysGroup] = useState(false);
```

- [ ] **Step 2: Import the new component**

Add near the top of the file, alongside the other `./components/*` imports:
```ts
import ToolbarDropdownGroup from './components/ToolbarDropdownGroup';
```

- [ ] **Step 3: Extract the 9 Overlays toggles into the new group**

In the "Sidebar Footer — quick actions" block (`grep -n "Sidebar Footer" client/src/pages/map/MapboxMapPage.tsx` to locate), remove these 9 `IconButton`s from the flat `flex items-center gap-1 flex-wrap` row (leave `Refresh data`, `Fly to my position`, `Layers panel`, `Bookmarks`, `Export map image` in place — those aren't part of any of the 5 groups per the spec's table, so they stay as quick actions):
- `beatsVisible` (Eye/EyeOff)
- `terrainEnabled` (Mountain)
- `isochroneEnabled` (Clock)
- `selfPosVisible` (Navigation2)
- `breadcrumbs.enabled` (Footprints)
- `daylight.enabled` (Sun)
- `coordGrid.enabled` (Hash)
- `weatherRadar.enabled` (CloudRain)
- `deckEnabled` (Zap)

Re-render them inside a new `ToolbarDropdownGroup`, placed in the Advanced Map Tools toolbar area (alongside where the other groups will go in later tasks — for now, add it directly after the "Advanced map tools" toggle button in the `{mapLoaded && !mapLibreFallback && (...)}` block):

```tsx
<ToolbarDropdownGroup
  icon={Layers}
  label="Overlays"
  open={showOverlaysGroup}
  onToggle={() => setShowOverlaysGroup(v => !v)}
>
  <IconButton
    aria-label={beatsVisible ? 'Hide beat boundaries' : 'Show beat boundaries'}
    onClick={() => setBeatsVisible(v => !v)}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${beatsVisible ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
  >
    {beatsVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
  </IconButton>
  <IconButton
    aria-label={terrainEnabled ? 'Disable 3D terrain' : 'Enable 3D terrain'}
    onClick={() => setTerrainEnabled(v => !v)}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${terrainEnabled ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
  >
    <Mountain className="w-4 h-4" />
  </IconButton>
  <IconButton
    aria-label={isochroneEnabled ? 'Hide response zones' : 'Show response time zones'}
    onClick={toggleIsochrone}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${isochroneEnabled ? 'text-[#22c55e]' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
  >
    <Clock className="w-4 h-4" />
  </IconButton>
  <IconButton
    aria-label={selfPosVisible ? 'Hide my position' : 'Show my position'}
    onClick={() => setSelfPosVisible(v => !v)}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${selfPosVisible ? 'text-blue-400' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
  >
    <Navigation2 className="w-4 h-4" />
  </IconButton>
  <IconButton
    aria-label={breadcrumbs.enabled ? 'Hide unit trails' : 'Show unit trails'}
    onClick={() => breadcrumbs.toggle()}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${breadcrumbs.enabled ? 'text-[#3b82f6]' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
    title="GPS Breadcrumb Trails (B)"
  >
    <Footprints className="w-4 h-4" />
  </IconButton>
  <IconButton
    aria-label={daylight.enabled ? 'Hide day/night overlay' : 'Show day/night overlay'}
    onClick={() => daylight.toggle()}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${daylight.enabled ? 'text-[#f59e0b]' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
    title="Day/Night Terminator (D)"
  >
    <Sun className="w-4 h-4" />
  </IconButton>
  <IconButton
    aria-label={coordGrid.enabled ? 'Hide coordinate grid' : 'Show coordinate grid'}
    onClick={() => coordGrid.toggle()}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${coordGrid.enabled ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
    title="Coordinate Grid (G)"
  >
    <Hash className="w-4 h-4" />
  </IconButton>
  <IconButton
    aria-label={weatherRadar.enabled ? 'Hide weather radar' : 'Show weather radar'}
    onClick={() => weatherRadar.toggle()}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${weatherRadar.enabled ? 'text-[#3b82f6]' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
    title="Weather Radar"
  >
    <CloudRain className="w-4 h-4" />
  </IconButton>
  <IconButton
    aria-label={deckEnabled ? 'Disable GPU overlay' : 'Enable GPU overlay'}
    onClick={() => setDeckEnabled(v => !v)}
    className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${deckEnabled ? 'text-[#a855f7]' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
    style={{ borderRadius: 2 }}
    title="Deck.gl GPU Overlay"
  >
    <Zap className="w-4 h-4" />
  </IconButton>
</ToolbarDropdownGroup>
```

Note the className padding/size changed from the sidebar-footer style (`p-1.5`, `w-3.5 h-3.5`, plain text color no border) to the Advanced-Toolbar style (`bg-surface-raised/95 border border-border-default p-2`, `w-4 h-4`) — this is intentional: these buttons are relocating from the sidebar footer's compact inline style to the floating toolbar's boxed-button style, matching their new siblings inside `ToolbarDropdownGroup`. Confirm this reads correctly in the browser (Step 5) rather than assuming the size/padding numbers above are final — adjust only the group's internal consistency, not the overall boxed-button pattern itself.

- [ ] **Step 4: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual browser verification**

Start the dev server, open `/map`, click the new "Overlays" group trigger, confirm all 9 toggles appear and each one still functions identically (beats show/hide, terrain toggles, etc.) — compare on/off visual state against pre-change behavior.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "refactor(map): migrate Overlays toggles into ToolbarDropdownGroup"
```

---

## Task 3: Migrate "Analysis" group (heatmap, traffic, clustering)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add state**

```ts
const [showAnalysisGroup, setShowAnalysisGroup] = useState(false);
```

- [ ] **Step 2: Read the current heatmap/traffic/clustering JSX**

Run: `grep -n "Heatmap\|Traffic\|Clustering" client/src/pages/map/MapboxMapPage.tsx` and read the 3 `IconButton`s in full (they're currently inside the `{showAdvancedToolbar && (...)}` block, using `heatmap.enabled`/`populateAndToggleHeatmap()`, `traffic.enabled`/`traffic.toggle()`, `clustering.enabled`/`clustering.toggle()` — copy their EXACT current `onClick` handlers verbatim, since `populateAndToggleHeatmap` in particular has non-trivial logic that must not be altered).

- [ ] **Step 3: Move these 3 IconButtons into a new `ToolbarDropdownGroup`**

```tsx
<ToolbarDropdownGroup
  icon={BarChart3}
  label="Analysis"
  open={showAnalysisGroup}
  onToggle={() => setShowAnalysisGroup(v => !v)}
>
  {/* paste the 3 existing IconButtons here verbatim, unchanged onClick/className */}
</ToolbarDropdownGroup>
```

(`BarChart3` needs to be added to the existing `lucide-react` import list at the top of the file if not already present — check first with `grep -n "BarChart3" client/src/pages/map/MapboxMapPage.tsx`; if a different icon is already conventionally used for "analysis" elsewhere in the app, prefer consistency over inventing a new icon choice — check `grep -rn "BarChart3\|TrendingUp" client/src/pages --include="*.tsx" -l | head -3` for precedent.)

- [ ] **Step 4: Run typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 5: Manual browser verification**

Confirm heatmap/traffic/clustering all still toggle correctly from inside the new group.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "refactor(map): migrate Analysis toggles into ToolbarDropdownGroup"
```

---

## Task 4: Migrate "Drawing & Measure" group (measure dropdown, draw dropdown, GL Draw)

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Read the current measure/draw/GL-draw JSX**

Run: `grep -n "showMeasureMenu\|showDrawMenu\|glDraw" client/src/pages/map/MapboxMapPage.tsx` and read the full blocks — these already have their OWN internal dropdown behavior (`showMeasureMenu`/`showDrawMenu` toggle sub-panels of measure-mode/draw-mode options). This task does NOT change their internal dropdown logic — it only wraps the three trigger buttons (Measure, Draw, GL Draw) together under one outer `ToolbarDropdownGroup`, so opening "Drawing & Measure" reveals the 3 existing triggers, each of which still opens its own sub-dropdown as before (a group containing dropdowns, not a flattening of them).

- [ ] **Step 2: Add state**

```ts
const [showDrawingMeasureGroup, setShowDrawingMeasureGroup] = useState(false);
```

- [ ] **Step 3: Wrap the 3 existing trigger-button blocks**

```tsx
<ToolbarDropdownGroup
  icon={PenTool}
  label="Drawing & Measure"
  open={showDrawingMeasureGroup}
  onToggle={() => setShowDrawingMeasureGroup(v => !v)}
>
  {/* paste the existing Measure trigger + its showMeasureMenu conditional sub-panel here, verbatim */}
  {/* paste the existing Draw trigger + its showDrawMenu conditional sub-panel here, verbatim */}
  {/* paste the existing GL Draw IconButton here, verbatim */}
</ToolbarDropdownGroup>
```

(`PenTool` is already imported per the file's existing `lucide-react` import list — confirm with `grep -n "PenTool" client/src/pages/map/MapboxMapPage.tsx` since it's already used as the Draw tool's own icon; reusing it as the group icon is acceptable since the group's dominant use case is drawing, but double check it doesn't read as visually redundant next to the Draw sub-button — if it does, pick a different lucide icon, e.g. `Ruler`, for the group trigger instead and note the substitution in your report.)

- [ ] **Step 4: Run typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 5: Manual browser verification**

Confirm Measure dropdown still opens its distance/area sub-menu, Draw dropdown still opens its polygon/polyline/circle sub-menu, and GL Draw still toggles — all nested correctly one level deeper than before (Drawing & Measure group → individual tool trigger → tool's own sub-menu).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "refactor(map): migrate Drawing & Measure tools into ToolbarDropdownGroup"
```

---

## Task 5: Migrate "View" group (satellite peek, 3D buildings, map style) + relabel Alerts & Safety as a distinct visible row

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Read the current satellite-peek/3D-buildings/style-selector JSX**

Run: `grep -n "streetView.enabled\|buildings3dEnabled\|showStyleMenu" client/src/pages/map/MapboxMapPage.tsx` and read each block in full.

- [ ] **Step 2: Add state**

```ts
const [showViewGroup, setShowViewGroup] = useState(false);
```

- [ ] **Step 3: Wrap the 3 existing controls**

```tsx
<ToolbarDropdownGroup
  icon={Eye}
  label="View"
  open={showViewGroup}
  onToggle={() => setShowViewGroup(v => !v)}
>
  {/* paste the existing Satellite Peek IconButton here, verbatim */}
  {/* paste the existing 3D Buildings toggle here, verbatim */}
  {/* paste the existing map-style-selector trigger + its showStyleMenu sub-panel here, verbatim */}
</ToolbarDropdownGroup>
```

(If `Eye` is already used elsewhere as a differently-meaning icon in this file — e.g. the beats show/hide toggle inside the Overlays group from Task 2 also uses `Eye`/`EyeOff` — pick a distinct icon for the View group trigger instead, such as `Camera` or `Satellite` if already imported, to avoid visual ambiguity between "a toggle that means beats-visible" and "a group trigger that means open the View menu." Check `grep -n "^import.*lucide-react" -A 15 client/src/pages/map/MapboxMapPage.tsx` for what's already available before adding a new icon import.)

- [ ] **Step 4: Relabel Alerts & Safety as a visually distinct, always-visible row**

Find the 3 safety toggles (P1 audio `Volume2`, auto-pan P1 `Radio`, geofence alerts `MapPinned`) — currently in the sidebar-footer flat row (untouched by Task 2, since Task 2 only extracted the 9 Overlays toggles). Wrap just these 3 in a small visually-separated `<div>` (NOT a `ToolbarDropdownGroup` — per the spec, these must stay permanently visible, no extra click):

```tsx
{/* Alerts & Safety — always visible, never collapsed behind a menu */}
<div className="flex items-center gap-1 pl-2 ml-1 border-l border-border-default">
  {/* paste the existing geofenceAlerts.enabled IconButton here, verbatim */}
  {/* paste the existing autoPanEnabled IconButton here, verbatim */}
  {/* paste the existing p1AudioEnabled IconButton here, verbatim */}
</div>
```

Place this `<div>` at the end of the sidebar-footer's quick-actions row (after Refresh/Fly-to-position/Layers-panel/Bookmarks/Export, which stay as ungrouped quick actions per the spec).

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`

- [ ] **Step 6: Manual browser verification**

Confirm View group's 3 controls work from inside its dropdown. Confirm the 3 Alerts & Safety toggles are visible WITHOUT opening any menu, visually separated (left border) from the other quick actions, and still function identically.

- [ ] **Step 7: Final full-page verification**

Click through EVERY one of the 5 groups plus the Alerts & Safety row plus the untouched quick actions (Refresh, Fly-to-position, Layers panel, Bookmarks, Export) — confirm all ~85 original controls are present somewhere and none were dropped during the reorganization.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "refactor(map): migrate View group, separate Alerts & Safety as always-visible row"
```

---

## Self-Review Notes

- **Spec coverage:** All 5 groups from the spec's table are covered (Overlays=Task 2, Analysis=Task 3, Drawing & Measure=Task 4, View=Task 5, Alerts & Safety=Task 5's second half as a non-dropdown row). Non-goals (no new features, no theme changes, no sidebar tab changes) are respected — no task touches UNITS/CALLS tabs or introduces new toggle state beyond the 4 `showXGroup` booleans.
- **Placeholder scan:** Tasks 3-5 use "paste the existing X here verbatim" instead of re-printing already-shown code blocks from Task 2's fuller example — this is intentional plan compression (the exact same copy-paste-and-rewrap mechanical pattern established in Task 2's fully-spelled-out example), not a vague instruction, since each task's Step 1 tells the implementer exactly which grep to run to find the exact current code before moving it.
- **Type consistency:** `ToolbarDropdownGroup`'s props (`icon`, `label`, `open`, `onToggle`, `children`) are used identically across Tasks 2-5. State variable naming (`showOverlaysGroup`, `showAnalysisGroup`, `showDrawingMeasureGroup`, `showViewGroup`) follows one consistent pattern.
