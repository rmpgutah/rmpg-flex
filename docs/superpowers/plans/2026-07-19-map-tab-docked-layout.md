# Map Tab Docked-Panes Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `MapboxMapPage.tsx`'s flat toolbar + floating-panel layout with six
fixed regions (top toolbar, Roster dock, Layers dock, Info & Tools dock, map canvas,
bottom status bar), collapsing the three docks into a bottom tabbed tray below 1024px.

**Architecture:** Five new presentational components under
`client/src/pages/map/components/` (`DockSection`, `MapRosterDock`, `MapLeftDock`,
`MapRightDock`, `MapTopToolbar`, `MapBottomTray` — six, counting the shared
`DockSection`) consume the exact same toggle data/state `MapboxMapPage.tsx` already
owns (hooks, `useState`, `layerGroups`-equivalent data). Only *where* each toggle's
control renders changes; no state, hook, or business logic moves.

**Tech Stack:** React 18 + TypeScript, Tailwind, lucide-react icons, Vitest +
`@testing-library/react`.

## Global Constraints

- No new visual style, colors, or theme changes — reuse existing Blue & Silver design
  tokens, 2px radius (`style={{ borderRadius: 2 }}` or `rounded-sm`), and the
  `tactical-dark` map surface class already on the root element.
- Scoped entirely to `client/src/pages/map/` — no changes to `NavMapView.tsx`,
  `DispatchMiniMap`, or any other map surface.
- Every one of the ~50 existing toggles/tools must stay reachable — reorganize, don't
  prune. Exception (confirmed with the user): true UI *duplicates* of the same toggle
  state (the Advanced Map Tools Toolbar's copies of items already in `layerGroups`)
  consolidate to one control; the underlying toggle capability is not removed.
- Do not revive orphaned/unimported components (`UnifiedMapLegend`,
  `MapboxDispatchConnections`, `MapDiagnosticsOverlay`) — confirmed dead, out of scope.
- One PR, no feature flag — but land as multiple small, independently-tested commits.
- The address search control (`MapboxGeocoder`, `MapboxMapPage.tsx:902-931`,
  `map.addControl(geocoder, 'top-left')`) is a native Mapbox DOM control, not React
  JSX — it is **not** moved into `MapTopToolbar`. It stays exactly as it is; once the
  map canvas is narrower (sitting between the docks instead of full-width), it will
  naturally render at the top-left of that narrower canvas. `MapTopToolbar` covers map
  chrome (scale/fullscreen/minimap/style selector), bookmarks, and snapshot only.
- Section-to-toggle mapping (Left Dock 5 sections, Right Dock 3 sections) is fully
  specified below — do not re-derive it; use it as given.

---

### Task 1: `DockSection` + `DockToggleRow` shared components

**Files:**
- Create: `client/src/pages/map/components/DockSection.tsx`
- Test: `client/src/pages/map/components/__tests__/DockSection.test.tsx`

**Interfaces:**
- Produces: `DockSection({ title: string, defaultOpen?: boolean, children: ReactNode })`
  — an accordion section with a header button (title + chevron) that shows/hides
  `children`. `DockToggleItem` type `{ id: string; label: string; active: boolean;
  onToggle: () => void; color?: string; description?: string; loading?: boolean }`.
  `DockToggleRow({ item: DockToggleItem })` — a single toggle row (colored status dot +
  label + optional loading pulse). Tasks 3–5 consume both.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/components/__tests__/DockSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DockSection, { DockToggleRow } from '../DockSection';

describe('DockSection', () => {
  it('renders children when defaultOpen is true (default)', () => {
    render(<DockSection title="Live Conditions"><div>Traffic</div></DockSection>);
    expect(screen.getByText('Traffic')).toBeInTheDocument();
  });

  it('hides children when defaultOpen is false', () => {
    render(<DockSection title="Live Conditions" defaultOpen={false}><div>Traffic</div></DockSection>);
    expect(screen.queryByText('Traffic')).not.toBeInTheDocument();
  });

  it('toggles visibility when the header is clicked', () => {
    render(<DockSection title="Live Conditions"><div>Traffic</div></DockSection>);
    fireEvent.click(screen.getByText('Live Conditions'));
    expect(screen.queryByText('Traffic')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Live Conditions'));
    expect(screen.getByText('Traffic')).toBeInTheDocument();
  });
});

describe('DockToggleRow', () => {
  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'traffic', label: 'Live Traffic', active: false, onToggle }} />);
    fireEvent.click(screen.getByText('Live Traffic'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the label and respects the active flag in its title attribute', () => {
    const onToggle = vi.fn();
    render(<DockToggleRow item={{ id: 'traffic', label: 'Live Traffic', active: true, onToggle, description: 'Real-time congestion' }} />);
    const row = screen.getByText('Live Traffic').closest('button')!;
    expect(row).toHaveAttribute('title', 'Real-time congestion');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/DockSection.test.tsx`
Expected: FAIL — `../DockSection` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `client/src/pages/map/components/DockSection.tsx`:

```tsx
// ============================================================
// RMPG Flex — Map Dock building blocks
// Shared accordion section + toggle row used by MapLeftDock,
// MapRightDock, and MapBottomTray so all three render the same
// section/toggle markup instead of duplicating it.
// ============================================================

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface DockSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export default function DockSection({ title, defaultOpen = true, children }: DockSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-rmpg-400 hover:text-rmpg-200 transition-colors"
      >
        <span>{title}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && <div className="pb-1">{children}</div>}
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
}

export function DockToggleRow({ item }: { item: DockToggleItem }) {
  const dotColor = item.color ?? '#d4a017';
  return (
    <button
      type="button"
      onClick={item.onToggle}
      title={item.description}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors"
      style={{
        background: item.active ? 'var(--surface-raised)' : 'transparent',
        color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      <span
        className="w-1.5 h-1.5 shrink-0"
        style={{
          borderRadius: '50%',
          background: item.active ? dotColor : 'var(--text-secondary)',
          boxShadow: item.active ? `0 0 4px ${dotColor}80` : 'none',
        }}
      />
      <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
      {item.loading && (
        <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: 'var(--brand-gold)' }} />
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/DockSection.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/DockSection.tsx client/src/pages/map/components/__tests__/DockSection.test.tsx
git commit -m "feat(map): add DockSection/DockToggleRow shared dock building blocks"
```

---

### Task 2: `MapRosterDock` — extract the existing Units/Calls sidebar

**Files:**
- Create: `client/src/pages/map/components/MapRosterDock.tsx`
- Test: `client/src/pages/map/components/__tests__/MapRosterDock.test.tsx`
- (Read-only reference, not modified this task): `client/src/pages/map/MapboxMapPage.tsx:1267-1491` — the exact JSX being extracted (Sidebar Toggle, Sidebar, Tabs, Tab Content, Sidebar Footer)

**Interfaces:**
- Produces: `MapRosterDock({ open, onOpenChange, units, calls, activeTab, onTabChange,
  isMobile, onFlyToUnit, onFlyToCall, onShowNearestUnit, onRefresh, onFlyToSelf })`.
  Task 7 renders this in place of the current inline Sidebar JSX, threading the exact
  same state/handlers `MapboxMapPage.tsx` already has (`sidebarOpen`/`setSidebarOpen`,
  `activeTab`/`setActiveTab`, `units`, `calls`, `flyToUnit`, `flyToCall`,
  `showNearestUnit`, `silentRefresh`, `flyToSelf`, `isMobile`).

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/components/__tests__/MapRosterDock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapRosterDock from '../MapRosterDock';

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  units: [
    { id: 1, call_sign: 'S-1', officer_name: 'Officer A', status: 'available', latitude: 40.7, longitude: -111.9, current_call_type: null, call_number: null },
  ],
  calls: [
    { id: 2, call_number: 'C-100', priority: 1, incident_type: 'DUI', location_address: '123 Main St', latitude: 40.7, longitude: -111.9 },
  ],
  activeTab: 'units' as const,
  onTabChange: vi.fn(),
  isMobile: false,
  onFlyToUnit: vi.fn(),
  onFlyToCall: vi.fn(),
  onShowNearestUnit: vi.fn(),
  onRefresh: vi.fn(),
  onFlyToSelf: vi.fn(),
};

describe('MapRosterDock', () => {
  it('renders the units tab with unit count and rows', () => {
    render(<MapRosterDock {...baseProps} />);
    expect(screen.getByText('UNITS (1)')).toBeInTheDocument();
    expect(screen.getByText('S-1')).toBeInTheDocument();
  });

  it('switches to the calls tab on click', () => {
    render(<MapRosterDock {...baseProps} />);
    fireEvent.click(screen.getByText('CALLS (1)'));
    expect(baseProps.onTabChange).toHaveBeenCalledWith('calls');
  });

  it('calls onFlyToUnit when a unit row is clicked', () => {
    render(<MapRosterDock {...baseProps} />);
    fireEvent.click(screen.getByText('S-1'));
    expect(baseProps.onFlyToUnit).toHaveBeenCalledWith(baseProps.units[0]);
  });

  it('renders nothing but the open toggle when closed', () => {
    render(<MapRosterDock {...baseProps} open={false} />);
    expect(screen.queryByText('UNITS (1)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Open sidebar')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapRosterDock.test.tsx`
Expected: FAIL — `../MapRosterDock` doesn't exist.

- [ ] **Step 3: Implement**

Create `client/src/pages/map/components/MapRosterDock.tsx`. This is the existing
Sidebar JSX from `MapboxMapPage.tsx:1267-1491`, moved into its own component and
threaded through props instead of closing over `MapboxMapPage`'s local state directly.
The footer's quick-actions row is trimmed from 5 buttons to 2 (Refresh, Fly-to-self) —
the other 3 (Layers panel toggle, Geofence Alerts, Auto-Pan P1) become redundant once
the Layers dock is always visible and geofences/autopan have their own entries in the
Left Dock's Live Conditions section (Task 3), so keeping them here would be a second
control for the same state, the exact duplication this redesign resolves elsewhere:

```tsx
// ============================================================
// RMPG Flex — Map Roster Dock
// Units/Calls tabbed roster, extracted from MapboxMapPage.tsx's
// inline Sidebar block. Same content/behavior, now a standalone
// component so it can be rendered as a dock (desktop) or a tray
// tab (narrow viewport) from MapBottomTray.
// ============================================================

import { Shield, AlertTriangle, Locate, PanelLeftOpen, PanelLeftClose, RefreshCw, Crosshair } from 'lucide-react';
import RmpgLogo from '../../../components/RmpgLogo';
import IconButton from '../../../components/IconButton';
import { UNIT_STATUS_COLORS, PRIORITY_COLORS, HAZARD_FLAGS } from '../utils/mapConstants';
import { formatIncidentType } from '../../../utils/formatters';

export interface RosterUnit {
  id: number;
  call_sign: string;
  officer_name: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  current_call_type: string | null;
  call_number: string | null;
}

export interface RosterCall {
  id: number;
  call_number: string;
  priority: number;
  incident_type: string;
  location_address: string;
  latitude: number | null;
  longitude: number | null;
  [key: string]: unknown; // hazard-flag boolean keys (HAZARD_FLAGS[].key), read dynamically
}

export interface MapRosterDockProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: RosterUnit[];
  calls: RosterCall[];
  activeTab: 'units' | 'calls';
  onTabChange: (tab: 'units' | 'calls') => void;
  isMobile: boolean;
  onFlyToUnit: (unit: RosterUnit) => void;
  onFlyToCall: (call: RosterCall) => void;
  onShowNearestUnit: (call: RosterCall) => void;
  onRefresh: () => void;
  onFlyToSelf: () => void;
}

export default function MapRosterDock({
  open, onOpenChange, units, calls, activeTab, onTabChange, isMobile,
  onFlyToUnit, onFlyToCall, onShowNearestUnit, onRefresh, onFlyToSelf,
}: MapRosterDockProps) {
  if (!open) {
    return (
      <IconButton
        aria-label="Open sidebar"
        onClick={() => onOpenChange(true)}
        className="absolute top-3 left-3 z-30 bg-surface-raised/95 border border-border-default p-2 text-rmpg-300 hover:text-brand-gold-500 backdrop-blur-sm"
        style={{ borderRadius: 2 }}
      >
        <PanelLeftOpen className="w-4 h-4" />
      </IconButton>
    );
  }

  return (
    <div
      className={`relative z-20 h-full bg-surface-raised/95 border-r border-border-default backdrop-blur-sm flex flex-col ${isMobile ? 'w-full' : 'w-[280px]'}`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <RmpgLogo height={20} iconOnly />
          <span className="text-brand-gold-500 text-xs font-semibold tracking-wider">FLEX MAP</span>
        </div>
        <IconButton
          aria-label="Close sidebar"
          onClick={() => onOpenChange(false)}
          className="text-rmpg-400 hover:text-rmpg-200 p-1"
        >
          <PanelLeftClose className="w-4 h-4" />
        </IconButton>
      </div>

      <div className="flex border-b border-border-default">
        <button
          onClick={() => onTabChange('units')}
          className={`flex-1 py-2 text-xs font-semibold tracking-wider transition-colors ${
            activeTab === 'units' ? 'text-brand-gold-500 border-b-2 border-brand-gold-500' : 'text-rmpg-400 hover:text-rmpg-300'
          }`}
        >
          <Shield className="w-3 h-3 inline mr-1" />
          UNITS ({units.length})
        </button>
        <button
          onClick={() => onTabChange('calls')}
          className={`flex-1 py-2 text-xs font-semibold tracking-wider transition-colors ${
            activeTab === 'calls' ? 'text-brand-gold-500 border-b-2 border-brand-gold-500' : 'text-rmpg-400 hover:text-rmpg-300'
          }`}
        >
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          CALLS ({calls.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'units' && (
          <div className="divide-y divide-border-subtle">
            {units.length === 0 && (
              <div className="px-3 py-6 text-center text-rmpg-500 text-xs">No units available</div>
            )}
            {units.map((unit) => {
              const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
              const hasGps = unit.latitude != null && unit.longitude != null;
              return (
                <button
                  key={unit.id}
                  onClick={() => onFlyToUnit(unit)}
                  disabled={!hasGps}
                  className={`w-full text-left px-3 py-1.5 transition-colors ${hasGps ? 'hover:bg-surface-overlay cursor-pointer' : 'opacity-50 cursor-default'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 shrink-0" style={{ borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}80` }} />
                    <span className="text-rmpg-200 text-[11px] font-mono font-semibold">{unit.call_sign}</span>
                    <span className="text-rmpg-400 text-[10px] truncate flex-1">{unit.officer_name}</span>
                    {!hasGps && <span className="text-rmpg-500 text-[9px]">NO GPS</span>}
                  </div>
                  {unit.current_call_type && (
                    <div className="ml-4 text-[10px] text-rmpg-500 truncate">
                      {unit.call_number} — {formatIncidentType(unit.current_call_type)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'calls' && (
          <div className="divide-y divide-border-subtle">
            {calls.length === 0 && (
              <div className="px-3 py-6 text-center text-rmpg-500 text-xs">No active calls</div>
            )}
            {calls.map((call) => {
              const color = PRIORITY_COLORS[call.priority] || '#888888';
              const hasGps = call.latitude != null && call.longitude != null;
              const hasFlags = HAZARD_FLAGS.some((f) => call[f.key]);
              return (
                <button
                  key={call.id}
                  onClick={() => onFlyToCall(call)}
                  disabled={!hasGps}
                  className={`w-full text-left px-3 py-1.5 transition-colors ${hasGps ? 'hover:bg-surface-overlay cursor-pointer' : 'opacity-50 cursor-default'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[8px] font-bold px-1 py-px" style={{ background: `${color}22`, color, borderRadius: 2 }}>
                      P{call.priority}
                    </span>
                    <span className="text-rmpg-200 text-[11px] font-mono font-semibold">{call.call_number}</span>
                    <span className="text-rmpg-400 text-[10px] truncate flex-1">{formatIncidentType(call.incident_type)}</span>
                  </div>
                  <div className="ml-4 text-[10px] text-rmpg-500 truncate">{call.location_address}</div>
                  {hasFlags && (
                    <div className="ml-4 mt-0.5 flex flex-wrap gap-0.5">
                      {HAZARD_FLAGS.filter((f) => call[f.key]).map((f) => (
                        <span key={f.key} className="text-[7px] font-bold px-1 py-px" style={{ background: `${f.color}22`, color: f.color, borderRadius: 2 }}>
                          {f.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {hasGps && (
                    <div className="ml-4 mt-0.5">
                      <span
                        className="text-[8px] text-rmpg-400 hover:text-brand-gold-500 cursor-pointer inline-flex items-center gap-0.5"
                        onClick={(e) => { e.stopPropagation(); onShowNearestUnit(call); }}
                      >
                        <Locate className="w-2.5 h-2.5" /> NEAREST UNIT
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border-default px-3 py-2">
        <div className="flex items-center gap-1 flex-wrap">
          <IconButton aria-label="Refresh data" onClick={onRefresh} className="text-rmpg-400 hover:text-brand-gold-500 p-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton aria-label="Fly to my position" onClick={onFlyToSelf} className="text-rmpg-400 hover:text-brand-gold-500 p-1.5">
            <Crosshair className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
```

Note: verify the exact import paths for `UNIT_STATUS_COLORS`/`PRIORITY_COLORS`/
`HAZARD_FLAGS` and `formatIncidentType` by checking `MapboxMapPage.tsx`'s own import
block before finalizing this file — this plan infers likely paths (`../utils/mapConstants`,
`../../../utils/formatters`) from naming convention, but the implementer must confirm
against the actual import statements at the top of `MapboxMapPage.tsx` and correct if
different.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapRosterDock.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/MapRosterDock.tsx client/src/pages/map/components/__tests__/MapRosterDock.test.tsx
git commit -m "feat(map): extract MapRosterDock from MapboxMapPage's inline sidebar"
```

---

### Task 3: Re-bucket layer toggle data into 5 sections + `MapLeftDock`

**Files:**
- Create: `client/src/pages/map/components/MapLeftDock.tsx`
- Test: `client/src/pages/map/components/__tests__/MapLeftDock.test.tsx`
- (Reference, modified in Task 7 not this task): `client/src/pages/map/MapboxMapPage.tsx:1024-1113` — the current `layerGroups` `useMemo`

**Interfaces:**
- Consumes: `DockSection`, `DockToggleItem`, `DockToggleRow` from Task 1.
- Produces: `MapLeftDock({ sections: { title: string; items: DockToggleItem[] }[] })`
  — renders one `DockSection` per entry, each containing one `DockToggleRow` per item.
  Task 7 builds the `sections` array from a new `mapLayerDockSections` `useMemo` in
  `MapboxMapPage.tsx` (replacing the old `layerGroups`), using the exact mapping table
  below — every `{ id, label, active, onToggle, color, description, loading }` value
  is copied verbatim from the current `layerGroups` array (`MapboxMapPage.tsx:1024-1113`,
  already read in full during planning), only re-bucketed into these 5 named sections
  instead of the old 4 (`live`/`analysis`/`base`/`dispatch-tools`):

  - **Live Conditions**: `traffic`, `weather`, `p1audio`, `autopan`, `geofences`
  - **Units & Calls**: `breadcrumbs`, `clustering`, `incidents`, `repeat-addresses`, `selfpos`
  - **Historical Analysis**: `heatmap`, `call-history`, `speed-heatmap`, `speed-violations`, `pursuit-segments`
  - **Boundaries**: `beats`, `district-*` (spread from `districtHierarchy.hierarchyConfigs`), `geo-*` (spread from `geoJsonLayers.configs`), `coverage-gaps`, `response-time`, `safety-zones`, `isochrone`
  - **Terrain & 3D**: `terrain`, `buildings`, `daylight`, `projection`, `atmosphere`, `grid`, `deck`, `orbit`

  `scale`, `fullscreen`, `minimap`, `snapshot` are pulled OUT of this data entirely —
  they move to `MapTopToolbar` (Task 5) as plain buttons, not `DockToggleItem`s, since
  they're viewport chrome, not layers. `p1audio` and `autopan` currently live in the
  `dispatch-tools` group — this plan moves them to Live Conditions (alerting behavior,
  not a workflow tool). `orbit` currently lives in `dispatch-tools` — this plan moves
  it to Terrain & 3D (camera control, not dispatch). This task only builds the
  `MapLeftDock` component itself (generic renderer); Task 7 does the actual re-bucketing
  inside `MapboxMapPage.tsx` since that's where the closures over hook state live.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/components/__tests__/MapLeftDock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapLeftDock from '../MapLeftDock';

describe('MapLeftDock', () => {
  it('renders each section title and its items', () => {
    const sections = [
      { title: 'Live Conditions', items: [{ id: 'traffic', label: 'Live Traffic', active: false, onToggle: vi.fn() }] },
      { title: 'Boundaries', items: [{ id: 'beats', label: 'Beat Boundaries', active: true, onToggle: vi.fn() }] },
    ];
    render(<MapLeftDock sections={sections} />);
    expect(screen.getByText('Live Conditions')).toBeInTheDocument();
    expect(screen.getByText('Live Traffic')).toBeInTheDocument();
    expect(screen.getByText('Boundaries')).toBeInTheDocument();
    expect(screen.getByText('Beat Boundaries')).toBeInTheDocument();
  });

  it('calls the right item onToggle when clicked', () => {
    const onToggle = vi.fn();
    const sections = [{ title: 'Live Conditions', items: [{ id: 'traffic', label: 'Live Traffic', active: false, onToggle }] }];
    render(<MapLeftDock sections={sections} />);
    fireEvent.click(screen.getByText('Live Traffic'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('has an accessible dock heading', () => {
    render(<MapLeftDock sections={[]} />);
    expect(screen.getByText('LAYERS')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapLeftDock.test.tsx`
Expected: FAIL — `../MapLeftDock` doesn't exist.

- [ ] **Step 3: Implement**

Create `client/src/pages/map/components/MapLeftDock.tsx`:

```tsx
// ============================================================
// RMPG Flex — Map Left Dock ("Layers")
// Always-visible left-side dock replacing the old floating
// Layers Panel (MapOverlaysPanel). Generic renderer over a list
// of { title, items } sections — MapboxMapPage.tsx owns the data.
// ============================================================

import DockSection, { DockToggleRow, type DockToggleItem } from './DockSection';

export interface MapLeftDockSection {
  title: string;
  items: DockToggleItem[];
}

export interface MapLeftDockProps {
  sections: MapLeftDockSection[];
}

export default function MapLeftDock({ sections }: MapLeftDockProps) {
  return (
    <div className="relative z-20 h-full w-[220px] bg-surface-raised/95 border-r border-border-default backdrop-blur-sm flex flex-col overflow-y-auto">
      <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-gold-500 border-b border-border-default">
        LAYERS
      </div>
      {sections.map((section) => (
        <DockSection key={section.title} title={section.title}>
          {section.items.map((item) => (
            <DockToggleRow key={item.id} item={item} />
          ))}
        </DockSection>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapLeftDock.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/MapLeftDock.tsx client/src/pages/map/components/__tests__/MapLeftDock.test.tsx
git commit -m "feat(map): add MapLeftDock — generic 5-section Layers dock renderer"
```

---

### Task 4: `MapRightDock` — Dispatch Tools / Analysis / Diagnostics

**Files:**
- Create: `client/src/pages/map/components/MapRightDock.tsx`
- Test: `client/src/pages/map/components/__tests__/MapRightDock.test.tsx`

**Interfaces:**
- Consumes: `DockSection`, `DockToggleItem`, `DockToggleRow` from Task 1.
- Produces: `MapRightDock({ sections })` — same shape/rendering as `MapLeftDock`
  (both could share one generic component, but are kept separate per the spec's
  component list; `MapLeftDock` and `MapRightDock` may internally delegate to a shared
  private renderer if the implementer prefers — either is acceptable, this plan doesn't
  mandate code sharing between the two beyond `DockSection`/`DockToggleRow`).
  Task 7 builds this dock's `sections` data in `MapboxMapPage.tsx`:
  - **Dispatch Tools**: `directions`, `places`, `bookmarks`, `optimize`
  - **Analysis**: `speed-analytics`, `gps-replay`, `ruler`, `buffer-ring`, `annotation`,
    `draw-geofence` (all existing `layerGroups` items, unchanged data), plus three NEW
    items built from the Advanced Toolbar's separate measure/draw state (not currently
    `DockToggleItem`-shaped — Task 7 wraps them):
    `{ id: 'measure', label: 'Measure', active: measure.mode !== 'none', onToggle: () => setShowMeasureMenu(v => !v), color: '#3b82f6', description: 'Distance / area measurement' }`,
    `{ id: 'draw', label: 'Draw Shapes', active: drawing.mode !== 'none', onToggle: () => setShowDrawMenu(v => !v), color: '#d4a017', description: 'Polygon / polyline / circle' }`,
    `{ id: 'gl-draw', label: 'GL Draw', active: glDraw.enabled, onToggle: () => glDraw.toggle(), color: '#d4a017', description: 'Vertex-editing draw tools' }`
  - **Diagnostics**: `identify`, `inspect`, `mapmatch`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/components/__tests__/MapRightDock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapRightDock from '../MapRightDock';

describe('MapRightDock', () => {
  it('renders each section title and its items', () => {
    const sections = [
      { title: 'Dispatch Tools', items: [{ id: 'directions', label: 'Directions', active: false, onToggle: vi.fn() }] },
      { title: 'Analysis', items: [{ id: 'ruler', label: 'Ruler', active: false, onToggle: vi.fn() }] },
      { title: 'Diagnostics', items: [{ id: 'identify', label: 'Identify', active: false, onToggle: vi.fn() }] },
    ];
    render(<MapRightDock sections={sections} />);
    expect(screen.getByText('Dispatch Tools')).toBeInTheDocument();
    expect(screen.getByText('Directions')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Identify')).toBeInTheDocument();
  });

  it('calls the right item onToggle when clicked', () => {
    const onToggle = vi.fn();
    const sections = [{ title: 'Analysis', items: [{ id: 'ruler', label: 'Ruler', active: false, onToggle }] }];
    render(<MapRightDock sections={sections} />);
    fireEvent.click(screen.getByText('Ruler'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('has an accessible dock heading', () => {
    render(<MapRightDock sections={[]} />);
    expect(screen.getByText('INFO & TOOLS')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapRightDock.test.tsx`
Expected: FAIL — `../MapRightDock` doesn't exist.

- [ ] **Step 3: Implement**

Create `client/src/pages/map/components/MapRightDock.tsx`:

```tsx
// ============================================================
// RMPG Flex — Map Right Dock ("Info & Tools")
// Always-visible right-side dock: Dispatch Tools / Analysis /
// Diagnostics. Generic renderer, same pattern as MapLeftDock.
// ============================================================

import DockSection, { DockToggleRow, type DockToggleItem } from './DockSection';

export interface MapRightDockSection {
  title: string;
  items: DockToggleItem[];
}

export interface MapRightDockProps {
  sections: MapRightDockSection[];
}

export default function MapRightDock({ sections }: MapRightDockProps) {
  return (
    <div className="relative z-20 h-full w-[220px] bg-surface-raised/95 border-l border-border-default backdrop-blur-sm flex flex-col overflow-y-auto">
      <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-gold-500 border-b border-border-default">
        INFO &amp; TOOLS
      </div>
      {sections.map((section) => (
        <DockSection key={section.title} title={section.title}>
          {section.items.map((item) => (
            <DockToggleRow key={item.id} item={item} />
          ))}
        </DockSection>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapRightDock.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/MapRightDock.tsx client/src/pages/map/components/__tests__/MapRightDock.test.tsx
git commit -m "feat(map): add MapRightDock — 3-section Info & Tools dock renderer"
```

---

### Task 5: `MapTopToolbar` — map chrome, bookmarks, snapshot

**Files:**
- Create: `client/src/pages/map/components/MapTopToolbar.tsx`
- Test: `client/src/pages/map/components/__tests__/MapTopToolbar.test.tsx`

**Interfaces:**
- Produces: `MapTopToolbar({ scaleEnabled, onToggleScale, fullscreenEnabled,
  onToggleFullscreen, minimapOpen, onToggleMinimap, mapStyle, onStyleChange,
  showBookmarksPanel, onToggleBookmarks, onSnapshot })`. Task 7 wires this to the
  existing `scaleEnabled`/`setScaleEnabled`, `fullscreenEnabled`/`setFullscreenEnabled`,
  `minimapOpen`/`setMinimapOpen`, `mapStyle`/`handleStyleChange`,
  `showBookmarksPanel`/`setShowBookmarksPanel`, and `printExport.exportImage` from
  `MapboxMapPage.tsx`. Does **not** include the address search box — see Global
  Constraints (native Mapbox Geocoder control, unchanged).

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/components/__tests__/MapTopToolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapTopToolbar from '../MapTopToolbar';

const baseProps = {
  scaleEnabled: false, onToggleScale: vi.fn(),
  fullscreenEnabled: false, onToggleFullscreen: vi.fn(),
  minimapOpen: false, onToggleMinimap: vi.fn(),
  mapStyle: 'dark' as const, onStyleChange: vi.fn(),
  showBookmarksPanel: false, onToggleBookmarks: vi.fn(),
  onSnapshot: vi.fn(),
};

describe('MapTopToolbar', () => {
  it('renders scale, fullscreen, minimap, bookmarks, and snapshot controls', () => {
    render(<MapTopToolbar {...baseProps} />);
    expect(screen.getByLabelText(/scale bar/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fullscreen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/minimap/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bookmarks/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/capture snapshot/i)).toBeInTheDocument();
  });

  it('calls onToggleScale when the scale button is clicked', () => {
    render(<MapTopToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText(/scale bar/i));
    expect(baseProps.onToggleScale).toHaveBeenCalledTimes(1);
  });

  it('calls onSnapshot when the snapshot button is clicked', () => {
    render(<MapTopToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText(/capture snapshot/i));
    expect(baseProps.onSnapshot).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapTopToolbar.test.tsx`
Expected: FAIL — `../MapTopToolbar` doesn't exist.

- [ ] **Step 3: Implement**

`MapboxMapPage.tsx` already has a `MapStyleId` type and a `MAP_STYLE_LABELS` constant
(used by the "Map Style Selector" block being deleted in Step 5 of Task 7, and by
`handleStyleChange` at line 896) — before writing this file, find their exact source
(check the file's own type/const declarations and its imports) and import `MapStyleId`
from there instead of redefining it here. `MAP_STYLE_LABELS` may be page-local (not
exported) — if so, redeclare it locally in this file as shown below (safe to duplicate
a small label map; not safe to duplicate the type, since two independently-declared
`'dark' | 'satellite' | 'streets'` unions would still typecheck against each other
structurally but create two sources of truth for the same concept):

```tsx
// ============================================================
// RMPG Flex — Map Top Toolbar
// Slim, always-visible top bar: map chrome (scale/fullscreen/
// minimap/style), bookmarks, snapshot export. Address search is
// NOT here — it's Mapbox's own native Geocoder control, added
// separately via map.addControl (see MapboxMapPage.tsx).
// ============================================================

import IconButton from '../../../components/IconButton';
import { Ruler, Maximize, Map as MapIcon, Star, Download } from 'lucide-react';
import type { MapStyleId } from '../MapboxMapPage'; // or wherever it's actually declared — confirm before use

const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
  dark: 'Dark', satellite: 'Satellite', streets: 'Streets',
};

export interface MapTopToolbarProps {
  scaleEnabled: boolean;
  onToggleScale: () => void;
  fullscreenEnabled: boolean;
  onToggleFullscreen: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  mapStyle: MapStyleId;
  onStyleChange: (id: MapStyleId) => void;
  showBookmarksPanel: boolean;
  onToggleBookmarks: () => void;
  onSnapshot: () => void;
}

const ITEM_CLASS = 'p-1.5 transition-colors';

export default function MapTopToolbar({
  scaleEnabled, onToggleScale, fullscreenEnabled, onToggleFullscreen,
  minimapOpen, onToggleMinimap, mapStyle, onStyleChange,
  showBookmarksPanel, onToggleBookmarks, onSnapshot,
}: MapTopToolbarProps) {
  return (
    <div className="relative z-20 flex items-center gap-1 px-2 h-9 w-full bg-surface-raised/95 border-b border-border-default backdrop-blur-sm">
      <IconButton
        aria-label={scaleEnabled ? 'Hide scale bar' : 'Show scale bar'}
        onClick={onToggleScale}
        className={`${ITEM_CLASS} ${scaleEnabled ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
      >
        <Ruler className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label={fullscreenEnabled ? 'Exit fullscreen' : 'Enter fullscreen'}
        onClick={onToggleFullscreen}
        className={`${ITEM_CLASS} ${fullscreenEnabled ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
      >
        <Maximize className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label={minimapOpen ? 'Hide minimap' : 'Show minimap'}
        onClick={onToggleMinimap}
        className={`${ITEM_CLASS} ${minimapOpen ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
      >
        <MapIcon className="w-4 h-4" />
      </IconButton>
      <select
        aria-label="Map style"
        value={mapStyle}
        onChange={(e) => onStyleChange(e.target.value as MapStyleId)}
        className="text-[10px] bg-transparent text-rmpg-300 border border-border-subtle px-1.5 py-1"
        style={{ borderRadius: 2 }}
      >
        {(Object.keys(MAP_STYLE_LABELS) as MapStyleId[]).map((id) => (
          <option key={id} value={id}>{MAP_STYLE_LABELS[id]}</option>
        ))}
      </select>
      <div className="flex-1" />
      <IconButton
        aria-label={showBookmarksPanel ? 'Hide bookmarks' : 'Show bookmarks'}
        onClick={onToggleBookmarks}
        className={`${ITEM_CLASS} ${showBookmarksPanel ? 'text-[#f59e0b]' : 'text-rmpg-300 hover:text-brand-gold-500'}`}
      >
        <Star className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label="Capture snapshot"
        onClick={onSnapshot}
        className={`${ITEM_CLASS} text-rmpg-300 hover:text-brand-gold-500`}
      >
        <Download className="w-4 h-4" />
      </IconButton>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapTopToolbar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/MapTopToolbar.tsx client/src/pages/map/components/__tests__/MapTopToolbar.test.tsx
git commit -m "feat(map): add MapTopToolbar — map chrome, bookmarks, snapshot"
```

---

### Task 6: `MapBottomTray` — responsive collapse below 1024px

**Files:**
- Create: `client/src/pages/map/components/MapBottomTray.tsx`
- Test: `client/src/pages/map/components/__tests__/MapBottomTray.test.tsx`

**Interfaces:**
- Consumes: `MapRosterDock` (Task 2), `MapLeftDock`'s section data shape, `MapRightDock`'s
  section data shape (Tasks 3–4) — reuses the same `sections` props those docks take,
  just renders one at a time behind a tab, instead of side-by-side.
- Produces: `MapBottomTray({ rosterProps: MapRosterDockProps, leftSections, rightSections
  })`. Task 7 renders this instead of the three docks when `useIsMobile(1024)` is true.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/map/components/__tests__/MapBottomTray.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapBottomTray from '../MapBottomTray';

const rosterProps = {
  open: true, onOpenChange: vi.fn(), units: [], calls: [],
  activeTab: 'units' as const, onTabChange: vi.fn(), isMobile: true,
  onFlyToUnit: vi.fn(), onFlyToCall: vi.fn(), onShowNearestUnit: vi.fn(),
  onRefresh: vi.fn(), onFlyToSelf: vi.fn(),
};
const leftSections = [{ title: 'Live Conditions', items: [{ id: 'traffic', label: 'Live Traffic', active: false, onToggle: vi.fn() }] }];
const rightSections = [{ title: 'Analysis', items: [{ id: 'ruler', label: 'Ruler', active: false, onToggle: vi.fn() }] }];

describe('MapBottomTray', () => {
  it('renders three tabs and starts closed', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    expect(screen.getByText('Roster')).toBeInTheDocument();
    expect(screen.getByText('Layers')).toBeInTheDocument();
    expect(screen.getByText('Info & Tools')).toBeInTheDocument();
    expect(screen.queryByText('Live Traffic')).not.toBeInTheDocument();
  });

  it('opens the Layers tab content on click', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    fireEvent.click(screen.getByText('Layers'));
    expect(screen.getByText('Live Traffic')).toBeInTheDocument();
  });

  it('switches from Layers to Info & Tools content on tab click', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    fireEvent.click(screen.getByText('Layers'));
    fireEvent.click(screen.getByText('Info & Tools'));
    expect(screen.queryByText('Live Traffic')).not.toBeInTheDocument();
    expect(screen.getByText('Ruler')).toBeInTheDocument();
  });

  it('clicking the open tab again closes the tray', () => {
    render(<MapBottomTray rosterProps={rosterProps} leftSections={leftSections} rightSections={rightSections} />);
    fireEvent.click(screen.getByText('Layers'));
    expect(screen.getByText('Live Traffic')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Layers'));
    expect(screen.queryByText('Live Traffic')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapBottomTray.test.tsx`
Expected: FAIL — `../MapBottomTray` doesn't exist.

- [ ] **Step 3: Implement**

Create `client/src/pages/map/components/MapBottomTray.tsx`:

```tsx
// ============================================================
// RMPG Flex — Map Bottom Tray
// Below the 1024px breakpoint, the Roster/Layers/Info & Tools
// docks collapse into this single bottom tabbed tray. Reuses
// MapRosterDock (Roster tab) and the same section-data shape the
// desktop docks take (Layers / Info & Tools tabs), rendered
// through DockSection/DockToggleRow so content matches exactly.
// ============================================================

import { useState } from 'react';
import DockSection, { DockToggleRow } from './DockSection';
import MapRosterDock, { type MapRosterDockProps } from './MapRosterDock';
import type { MapLeftDockSection } from './MapLeftDock';
import type { MapRightDockSection } from './MapRightDock';

type TrayTab = 'roster' | 'layers' | 'info' | null;

export interface MapBottomTrayProps {
  rosterProps: MapRosterDockProps;
  leftSections: MapLeftDockSection[];
  rightSections: MapRightDockSection[];
}

export default function MapBottomTray({ rosterProps, leftSections, rightSections }: MapBottomTrayProps) {
  const [activeTab, setActiveTab] = useState<TrayTab>(null);

  const selectTab = (tab: Exclude<TrayTab, null>) => {
    setActiveTab((current) => (current === tab ? null : tab));
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30">
      {activeTab && (
        <div className="max-h-[45vh] overflow-y-auto bg-surface-raised/95 border-t border-border-default backdrop-blur-sm">
          {activeTab === 'roster' && <MapRosterDock {...rosterProps} open />}
          {activeTab === 'layers' && leftSections.map((section) => (
            <DockSection key={section.title} title={section.title}>
              {section.items.map((item) => <DockToggleRow key={item.id} item={item} />)}
            </DockSection>
          ))}
          {activeTab === 'info' && rightSections.map((section) => (
            <DockSection key={section.title} title={section.title}>
              {section.items.map((item) => <DockToggleRow key={item.id} item={item} />)}
            </DockSection>
          ))}
        </div>
      )}
      <div className="flex border-t border-border-default bg-surface-raised/95 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => selectTab('roster')}
          className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${activeTab === 'roster' ? 'text-brand-gold-500' : 'text-rmpg-400'}`}
        >
          Roster
        </button>
        <button
          type="button"
          onClick={() => selectTab('layers')}
          className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors border-l border-border-subtle ${activeTab === 'layers' ? 'text-brand-gold-500' : 'text-rmpg-400'}`}
        >
          Layers
        </button>
        <button
          type="button"
          onClick={() => selectTab('info')}
          className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors border-l border-border-subtle ${activeTab === 'info' ? 'text-brand-gold-500' : 'text-rmpg-400'}`}
        >
          Info & Tools
        </button>
      </div>
    </div>
  );
}
```

`MapRosterDock`'s `open`/`onOpenChange` props are only meaningful for the desktop
open/closed toggle; inside the tray, it's always rendered with `open` forced `true`
(the tray's own tab click is what shows/hides it), so `MapRosterDock`'s internal
"closed" collapsed-button state never applies here.

Add `export type { MapRosterDockProps }` to `MapRosterDock.tsx` if the props interface
isn't already exported (it is, per Task 2's code — `export interface
MapRosterDockProps`, confirm this import resolves).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/components/__tests__/MapBottomTray.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/MapBottomTray.tsx client/src/pages/map/components/__tests__/MapBottomTray.test.tsx
git commit -m "feat(map): add MapBottomTray — responsive 3-tab collapse below 1024px"
```

---

### Task 7: Integrate into `MapboxMapPage.tsx`, delete superseded code

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx`
- Delete: `client/src/pages/map/components/MapOverlaysPanel.tsx`
- Delete: `client/src/pages/map/components/__tests__/MapOverlaysPanel.test.tsx`

**Interfaces:**
- Consumes: `MapRosterDock` (Task 2), `MapLeftDock` (Task 3), `MapRightDock` (Task 4),
  `MapTopToolbar` (Task 5), `MapBottomTray` (Task 6), and `useIsMobile` from
  `client/src/hooks/useIsMobile.ts` (existing, accepts a `breakpoint` param — call it
  as `useIsMobile(1024)` for the dock-vs-tray decision; this is a *different* boolean
  from the page's existing `isMobile = useIsMobile()` at line 331, which uses the
  default 768px breakpoint for other purposes and must NOT be reused for this).

This task has no isolated unit test of its own — verification is Task 8 (manual
browser check) plus the existing suite staying green, since `MapboxMapPage.tsx` has
no pre-existing test file to extend (confirmed during planning: no
`MapboxMapPage.test.tsx` exists anywhere in the repo).

- [ ] **Step 1: Add the new imports and the narrow-viewport flag**

Near the top of `MapboxMapPage.tsx`, alongside the existing `const isMobile =
useIsMobile();` (line 331), add:

```tsx
const isDockNarrow = useIsMobile(1024);
```

Add imports for the five new components at the top of the file, alongside the existing
component imports (e.g. near the `MapOverlaysPanel` import being removed in Step 5):

```tsx
import MapRosterDock from './components/MapRosterDock';
import MapLeftDock from './components/MapLeftDock';
import MapRightDock from './components/MapRightDock';
import MapTopToolbar from './components/MapTopToolbar';
import MapBottomTray from './components/MapBottomTray';
```

- [ ] **Step 2: Re-bucket the layer toggle data into 5 sections**

Replace the existing `layerGroups` `useMemo` (`MapboxMapPage.tsx:1024-1113`) with a new
`mapLeftDockSections` `useMemo` producing the `MapLeftDockSection[]` shape. Every
individual toggle object inside is copied verbatim from the current array — same
`id`/`label`/`active`/`onToggle`/`color`/`description`/`loading` expressions, only
re-bucketed per the mapping table in Task 3's brief, and with `scale`/`fullscreen`/
`minimap`/`snapshot` removed (they move to `mapTopToolbarProps` in Step 4 below). Build
this by copying each toggle literal from the current file into its new section array —
do not re-derive the `active`/`onToggle` expressions, they must stay byte-identical to
avoid silently changing behavior.

Also build a `mapRightDockSections` `useMemo` for Dispatch Tools / Analysis /
Diagnostics per Task 4's brief, including the three new `measure`/`draw`/`gl-draw`
wrapper items shown there.

- [ ] **Step 3: Build the roster dock props**

```tsx
const mapRosterDockProps = {
  open: sidebarOpen,
  onOpenChange: setSidebarOpen,
  units,
  calls,
  activeTab,
  onTabChange: setActiveTab,
  isMobile,
  onFlyToUnit: flyToUnit,
  onFlyToCall: flyToCall,
  onShowNearestUnit: showNearestUnit,
  onRefresh: silentRefresh,
  onFlyToSelf: flyToSelf,
};
```

- [ ] **Step 4: Build the top toolbar props**

```tsx
const mapTopToolbarProps = {
  scaleEnabled, onToggleScale: () => setScaleEnabled((v) => !v),
  fullscreenEnabled, onToggleFullscreen: () => setFullscreenEnabled((v) => !v),
  minimapOpen, onToggleMinimap: () => setMinimapOpen((v) => !v),
  mapStyle, onStyleChange: handleStyleChange,
  showBookmarksPanel, onToggleBookmarks: () => setShowBookmarksPanel((v) => !v),
  onSnapshot: () => printExport.exportImage(),
};
```

- [ ] **Step 5: Replace the rendered JSX**

In the `return` block:

1. Delete the "Sidebar Toggle (when closed)" and "Sidebar" blocks
   (`MapboxMapPage.tsx:1267-1491` in the pre-Task-7 file) — replaced by
   `<MapRosterDock {...mapRosterDockProps} />`.
2. Delete the entire "Advanced Map Tools Toolbar" block (`:1494-1776`) — every toggle
   in it either now lives in a dock (Step 2) or is the measure/draw/GL-Draw trio also
   now in a dock (Step 2's `mapRightDockSections`). The `showMeasureMenu`/
   `showDrawMenu` dropdown bodies (the actual distance/area and polygon/polyline/
   circle pickers) stay — only their *launcher* button moves into
   `mapRightDockSections`'s `measure`/`draw` items' `onToggle`; keep the dropdown JSX
   itself reachable (e.g. render it conditionally near the map canvas root, gated on
   `showMeasureMenu`/`showDrawMenu` exactly as before, just no longer nested inside the
   now-deleted toolbar's DOM position).
3. Delete the "Map Style Selector" block (`:1932-1966`) — its `handleStyleChange` and
   `mapStyle` are now wired into `MapTopToolbar` (Step 4); `showStyleMenu` state
   becomes unused and should be removed along with it.
4. Delete the "Layers Panel" block (`:1921-1930`, the `<MapOverlaysPanel>` usage) —
   superseded by `MapLeftDock`/`MapRightDock`. `layersPanelOpen`/`setLayersPanelOpen`
   become unused and should be removed.
5. Wrap the whole return in the new six-region structure below. The five commented
   placeholders in it are not vague — each names an EXACT existing JSX block, at its
   exact current line range in the pre-Task-7 file, that must be cut and pasted
   verbatim (byte-for-byte, no edits) into the new position shown — reproducing all
   ~250 of those already-read, unchanged lines inline in this plan would add no
   information beyond "move this exact block here," so the instruction is: verbatim
   relocation, not rewrite.
   - Loading Overlay: `:1207-1215`
   - Map Container ref div: `:1217-1218`
   - Geocoder styling `<style>` block: `:1220-1265`
   - Floating tool mounts (Safety Alert Ticker through Minimap Control — RulerTool,
     BufferRingTool, AnnotationTool, DrawGeofenceTool, GpsReplayTool, NavOverlayTool,
     MultiStopRoutePanel, SpeedAnalyticsPanel, SpeedGraphOverlay, StreetViewLightbox,
     MinimapControl): `:1836-1919`
   - Measurement Result Banner, Drawing Mode Indicator, Drawing Shapes Count, GL Draw
     Feature Count, Active Route Panel (the five result/status banners tied to
     `measure`/`drawing`/`glDraw`/`routing` state — these stay regardless of where the
     measure/draw *launcher* buttons moved in Step 2, since they react to tool state,
     not to where the launcher renders): `:1778-1816`
   - Status Bar: `:1968-2015`

   Each verbatim block keeps its own internal JSX exactly as-is; only the new parent
   structure around them (this six-region layout) is new code:

```tsx
return (
  <div className="tactical-dark relative w-full overflow-hidden bg-surface-base flex flex-col" style={{ height: '100%', minHeight: '100%' }}>
    {!isDockNarrow && <MapTopToolbar {...mapTopToolbarProps} />}

    <div className="relative flex-1 flex overflow-hidden">
      {!isDockNarrow && <MapRosterDock {...mapRosterDockProps} />}
      {!isDockNarrow && <MapLeftDock sections={mapLeftDockSections} />}

      <div className="relative flex-1">
        {/* Loading Overlay — unchanged */}
        {/* Map Container ref div — unchanged */}
        {/* Geocoder styling <style> block — unchanged */}
        {/* Floating tool mounts (RulerTool/BufferRingTool/.../MultiStopRoutePanel/SpeedAnalyticsPanel/SpeedGraphOverlay/StreetViewLightbox/MinimapControl) — unchanged */}
        {/* Measure/Draw dropdown bodies (kept per Step 5.2 above) — unchanged content, new mount position */}
        {/* Measurement Result Banner / Drawing Mode Indicator / Drawing Shapes Count / GL Draw Feature Count / Active Route Panel / SafetyAlertTicker — unchanged */}
        {/* Status Bar — unchanged */}
      </div>

      {!isDockNarrow && <MapRightDock sections={mapRightDockSections} />}
    </div>

    {isDockNarrow && (
      <MapBottomTray
        rosterProps={mapRosterDockProps}
        leftSections={mapLeftDockSections}
        rightSections={mapRightDockSections}
      />
    )}
  </div>
);
```

Confirm the map container's own sizing still works correctly once it's a flex child
instead of an `absolute inset-0` child of the full-viewport root — the container needs
`className="absolute inset-0"` relative to its new immediate parent (the `relative
flex-1` wrapper div above), which the pseudocode already gives it; verify in the
browser (Task 8) that the Mapbox canvas actually fills that space and resizes
correctly (Mapbox GL needs a `resize()` call or a `ResizeObserver` if its container's
size changes without a window resize event — check whether `MapboxMapPage.tsx`
already calls `map.resize()` anywhere on layout changes, and if not, add one bound to
`isDockNarrow` changing, since docks appearing/disappearing changes the map's
available width without the window itself resizing).

- [ ] **Step 6: Delete the superseded `MapOverlaysPanel`**

```bash
git rm client/src/pages/map/components/MapOverlaysPanel.tsx client/src/pages/map/components/__tests__/MapOverlaysPanel.test.tsx
```

- [ ] **Step 7: Typecheck and full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`

Expected: no new TypeScript errors (in particular: no leftover references to deleted
state like `layersPanelOpen`, `showStyleMenu`, `showAdvancedToolbar`,
`showOverlaysGroup`, `showAnalysisGroup`, or the deleted `layerGroups` name — search
the file for each after making the above edits to confirm nothing still references
them), and no test regressions — in particular re-run the existing floating-tool
component tests under `client/src/pages/map/components/__tests__/` (RulerTool,
BufferRingTool, AnnotationTool, DrawGeofenceTool, GpsReplayTool, NavOverlayTool,
SpeedAnalyticsPanel, MapOverlaysPanel-now-deleted) to confirm the ones that still exist
are unaffected, per the spec's stated risk.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(map): integrate docked-panes layout into MapboxMapPage

Replaces the flat toolbar + floating-panel layout with six fixed
regions (top toolbar, Roster/Layers/Info&Tools docks, map canvas,
bottom status bar), collapsing to a bottom tabbed tray below 1024px.
Deletes the now-superseded Advanced Map Tools Toolbar (its toggles
were all duplicates of layerGroups items, now consolidated to one
control each) and the old floating Layers Panel (MapOverlaysPanel),
whose function MapLeftDock now serves.
EOF
)"
```

---

### Task 8: Manual browser verification

**Files:** none (verification only).

Given the scale of this change (every toggle re-plumbed, map container reparented into
a flex layout, a new responsive breakpoint), automated tests alone aren't sufficient
confidence for a big-bang layout replacement — this task drives the real page in a
browser.

- [ ] **Step 1: Start the client dev server and Worker dev server**

Run (client): `cd client && npm run dev`
Run (worker): `npx wrangler dev --port 8787` (or the repo's `worker-dev` launch config)

- [ ] **Step 2: Desktop-width check (≥1024px)**

Log in, navigate to `/map`. Confirm:
- Top toolbar, Roster dock (left), Layers dock, map canvas, Info & Tools dock (right),
  and the bottom status bar are all visible simultaneously, in that left-to-right order.
- The map canvas actually renders tiles and resizes to fill its space (not a
  zero-width/collapsed canvas — this is the specific risk flagged in Step 5 of Task 7).
- Click a few Layers dock toggles (e.g. Traffic, Beat Boundaries) — confirm the map
  layer actually appears/disappears (not just the button's active state changing).
- Click a few Right dock entries — confirm `RulerTool`/`GpsReplayTool`/etc. still open
  as floating panels over the map, in their existing position/behavior.
- Confirm the Roster dock's unit/call lists populate and clicking a row flies the map
  to that unit/call.
- Confirm the address search (top-left of the map canvas, native Mapbox control) still
  works — type an address, confirm suggestions appear and selecting one flies the map.

- [ ] **Step 3: Narrow-width check (<1024px)**

Resize the browser window below 1024px (or use responsive dev tools). Confirm:
- The three docks disappear and the bottom tabbed tray appears with Roster/Layers/Info
  & Tools tabs.
- Each tab opens/closes its content on click, and content matches what Step 2 showed
  in the desktop docks (same toggles, same roster data).
- The map canvas still renders correctly and fills the available space above the tray.

- [ ] **Step 4: Regression spot-check**

Confirm nothing from the deleted Advanced Toolbar is now unreachable: for each item
that was duplicated (beats, terrain, isochrone, selfpos, breadcrumbs, daylight, grid,
weather, deck, heatmap, traffic, clustering), confirm it's toggleable from its new
single location in the Layers dock. Confirm Measure, Draw, and GL Draw are all
reachable from Right Dock → Analysis and function the same as before (their dropdown
pickers still appear, drawing/measuring on the map still works).

- [ ] **Step 5: Report results**

Note in the PR description (or directly to the user) which of the above passed, and
flag anything that didn't — particularly the map-canvas-resize risk from Task 7 Step 5,
since that's the one piece of genuinely new behavior (a Mapbox map container that can
change size without a window resize event) rather than a straightforward JSX move.
