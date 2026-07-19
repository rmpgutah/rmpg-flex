# Desktop Launcher v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Organization/Widgets/Personalization/Productivity slice of the v1 desktop launcher's enhancement backlog: icon grouping, icon-size/list-view/sort/snap-arrange/reset controls, bulk-pin, three new widgets (shift timer, pinned-call ticker, mini-map) with freeform drag + opacity/blur, accent-color presets, more wallpaper presets, sticky notes, command-bar quick actions, and drag-a-person-onto-the-Records-icon.

**Architecture:** Extend the two existing `user_preferences` JSON columns (`desktop_layout_json`, `desktop_widgets_json`) to richer shapes via pure, unit-tested normalizer functions that upgrade any already-saved v1 flat-array data on read — no data migration needed. Add two new columns (`desktop_accent`, `desktop_notes_json`) via a D1 migration. Build each new client feature as a small, focused addition under `client/src/components/desktop/` and `client/src/data/`, reusing v1's established patterns (debounced-save-to-preferences, `ContextMenu.tsx`, `useNavBadges`, `useClock`) and reusing the existing `DashboardMiniMap.tsx` component wholesale for the mini-map widget instead of writing a new Mapbox integration.

**Tech Stack:** React 18 + TypeScript + Vite (client), Hono + D1 (Worker), Vitest + `@testing-library/react` (client tests), Miniflare/`cloudflare:test` (Worker route smoke tests, in `test-workers/`).

## Global Constraints

- No hardcoded hex colors in component code — use existing CSS-variable-backed tokens. Where this plan introduces new *named presets* (accent swatches), each preset references an **existing** token already defined in `client/src/styles/theme-palettes.css` (e.g. `var(--stat-accent-amber-bright)`), never a fresh hex value — this keeps `desktopAccents.ts` consistent with how `desktopWallpapers.ts` already works (backgrounds are all `var(--surface-...)` references, not hex).
- Radius is 2px everywhere — never use `rounded-lg`; the global Tailwind override in `client/src/index.css` already enforces this.
- All new D1 queries must `await` — D1 calls are async (CLAUDE.md gotcha #3).
- Windowing remains scoped to the existing `POPOUT_PAGES` list in `client/src/utils/windowManager.ts` — this plan does not add new windowable routes.
- Migration high-water mark is `0193` (confirmed via `ls migrations/ | tail` — `0193_warrant_watch_extensions.sql` already exists from a separate, already-merged feature) — this plan's migration is **`0194_desktop_v2.sql`**, not `0193` as an earlier draft of the design spec assumed before that number was taken.
- `PREF_DEFAULTS`/`PREF_COLUMNS` in `src/routes/stubs.ts` already contain `desktop_layout_json`, `desktop_wallpaper`, `desktop_widgets_json` from v1 — this plan adds two more keys to the same object; the route handlers need no other changes (generic reflection over `PREF_COLUMNS`).
- Debounced-save pattern: every new piece of per-user layout state (groups, icon size, sort mode, widget positions/opacity/blur, accent, notes) is folded into `DesktopPage.tsx`'s existing single 800ms-debounced `PUT /api/preferences` effect — do not add a second debounce timer.
- Spec: [docs/superpowers/specs/2026-07-18-desktop-launcher-v2-design.md](../specs/2026-07-18-desktop-launcher-v2-design.md).

---

### Task 1: Desktop layout normalizer (icons/groups/iconSize/sortMode)

**Files:**
- Create: `client/src/utils/normalizeDesktopLayout.ts`
- Create: `client/src/utils/normalizeDesktopLayout.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 4, 5, 6, 15): `DesktopIconPosition { path: string; x: number; y: number }`, `DesktopGroup { id: string; label: string; x: number; y: number; w: number; h: number; memberPaths: string[] }`, `DesktopLayout { icons: DesktopIconPosition[]; groups: DesktopGroup[]; iconSize: 'small' | 'medium' | 'large'; viewMode: 'grid' | 'list'; sortMode: 'manual' | 'alpha' | 'usage' }`, `normalizeDesktopLayout(raw: string | null | undefined): DesktopLayout`, `serializeDesktopLayout(layout: DesktopLayout): string`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/normalizeDesktopLayout.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeDesktopLayout, serializeDesktopLayout } from './normalizeDesktopLayout';

describe('normalizeDesktopLayout', () => {
  it('upgrades a v1 flat icon-position array into the v2 shape', () => {
    const raw = JSON.stringify([{ path: '/dispatch', x: 20, y: 20 }, { path: '/map', x: 116, y: 20 }]);
    const layout = normalizeDesktopLayout(raw);
    expect(layout).toEqual({
      icons: [{ path: '/dispatch', x: 20, y: 20 }, { path: '/map', x: 116, y: 20 }],
      groups: [],
      iconSize: 'medium',
      viewMode: 'grid',
      sortMode: 'manual',
    });
  });

  it('passes through an already-v2-shape object, filling in any missing fields', () => {
    const raw = JSON.stringify({ icons: [{ path: '/records', x: 5, y: 5 }], iconSize: 'large' });
    const layout = normalizeDesktopLayout(raw);
    expect(layout).toEqual({
      icons: [{ path: '/records', x: 5, y: 5 }],
      groups: [],
      iconSize: 'large',
      viewMode: 'grid',
      sortMode: 'manual',
    });
  });

  it('returns an empty default layout for null, undefined, or invalid JSON', () => {
    const empty = { icons: [], groups: [], iconSize: 'medium', viewMode: 'grid', sortMode: 'manual' };
    expect(normalizeDesktopLayout(null)).toEqual(empty);
    expect(normalizeDesktopLayout(undefined)).toEqual(empty);
    expect(normalizeDesktopLayout('{not json')).toEqual(empty);
  });

  it('serializeDesktopLayout round-trips through normalizeDesktopLayout', () => {
    const layout = {
      icons: [{ path: '/dispatch', x: 1, y: 2 }],
      groups: [{ id: 'g1', label: 'Ops', x: 0, y: 0, w: 200, h: 100, memberPaths: ['/dispatch'] }],
      iconSize: 'small' as const,
      viewMode: 'list' as const,
      sortMode: 'alpha' as const,
    };
    expect(normalizeDesktopLayout(serializeDesktopLayout(layout))).toEqual(layout);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/normalizeDesktopLayout.test.ts`
Expected: FAIL — `Cannot find module './normalizeDesktopLayout'`

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/normalizeDesktopLayout.ts
export interface DesktopIconPosition {
  path: string;
  x: number;
  y: number;
}

export interface DesktopGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  memberPaths: string[];
}

export interface DesktopLayout {
  icons: DesktopIconPosition[];
  groups: DesktopGroup[];
  iconSize: 'small' | 'medium' | 'large';
  viewMode: 'grid' | 'list';
  sortMode: 'manual' | 'alpha' | 'usage';
}

const EMPTY_LAYOUT: DesktopLayout = { icons: [], groups: [], iconSize: 'medium', viewMode: 'grid', sortMode: 'manual' };

export function normalizeDesktopLayout(raw: string | null | undefined): DesktopLayout {
  if (!raw) return { ...EMPTY_LAYOUT, icons: [], groups: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_LAYOUT, icons: [], groups: [] };
  }
  // v1 shape: a bare array of {path,x,y}
  if (Array.isArray(parsed)) {
    return { icons: parsed as DesktopIconPosition[], groups: [], iconSize: 'medium', viewMode: 'grid', sortMode: 'manual' };
  }
  // v2 shape: an object, possibly missing newer fields from an older save
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Partial<DesktopLayout>;
    return {
      icons: Array.isArray(obj.icons) ? obj.icons : [],
      groups: Array.isArray(obj.groups) ? obj.groups : [],
      iconSize: obj.iconSize ?? 'medium',
      viewMode: obj.viewMode ?? 'grid',
      sortMode: obj.sortMode ?? 'manual',
    };
  }
  return { ...EMPTY_LAYOUT, icons: [], groups: [] };
}

export function serializeDesktopLayout(layout: DesktopLayout): string {
  return JSON.stringify(layout);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/normalizeDesktopLayout.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/normalizeDesktopLayout.ts client/src/utils/normalizeDesktopLayout.test.ts
git commit -m "feat(desktop): add v1→v2 desktop layout normalizer"
```

---

### Task 2: Desktop widgets normalizer (freeform per-widget state)

**Files:**
- Create: `client/src/utils/normalizeDesktopWidgets.ts`
- Create: `client/src/utils/normalizeDesktopWidgets.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 8, 9, 10, 15): `DesktopWidgetState { id: string; x: number; y: number; on: boolean; opacity: number; blur: number }`, `ALL_WIDGET_IDS: readonly ['clock','ops-summary','notifications','quick-access','shift-timer','pinned-call-ticker','mini-map']`, `V1_DEFAULT_ON_IDS: readonly ['clock','ops-summary','notifications','quick-access']`, `normalizeDesktopWidgets(raw: string | null | undefined): DesktopWidgetState[]`, `serializeDesktopWidgets(widgets: DesktopWidgetState[]): string`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/normalizeDesktopWidgets.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeDesktopWidgets, serializeDesktopWidgets, ALL_WIDGET_IDS } from './normalizeDesktopWidgets';

describe('normalizeDesktopWidgets', () => {
  it('upgrades a v1 on/off string array into freeform per-widget state, all "on"', () => {
    const raw = JSON.stringify(['clock', 'quick-access']);
    const widgets = normalizeDesktopWidgets(raw);
    const byId = Object.fromEntries(widgets.map(w => [w.id, w]));
    expect(byId['clock'].on).toBe(true);
    expect(byId['quick-access'].on).toBe(true);
    // every known widget id is present, even ones absent from the old array
    expect(ALL_WIDGET_IDS.every(id => byId[id])).toBe(true);
    expect(byId['ops-summary'].on).toBe(false);
    expect(byId['shift-timer'].on).toBe(false); // new widget ids default OFF, never auto-enabled
    expect(byId['clock'].opacity).toBe(1);
    expect(byId['clock'].blur).toBe(0);
    expect(typeof byId['clock'].x).toBe('number');
  });

  it('passes through an already-v2-shape array, filling defaults for missing widget ids', () => {
    const raw = JSON.stringify([{ id: 'clock', x: 10, y: 10, on: true, opacity: 0.8, blur: 4 }]);
    const widgets = normalizeDesktopWidgets(raw);
    const byId = Object.fromEntries(widgets.map(w => [w.id, w]));
    expect(byId['clock']).toEqual({ id: 'clock', x: 10, y: 10, on: true, opacity: 0.8, blur: 4 });
    expect(byId['mini-map'].on).toBe(false);
  });

  it('returns v1 defaults (4 widgets on, 3 new ones off) for null/undefined/invalid JSON', () => {
    for (const raw of [null, undefined, '{not json']) {
      const widgets = normalizeDesktopWidgets(raw);
      const byId = Object.fromEntries(widgets.map(w => [w.id, w]));
      expect(byId['clock'].on).toBe(true);
      expect(byId['ops-summary'].on).toBe(true);
      expect(byId['notifications'].on).toBe(true);
      expect(byId['quick-access'].on).toBe(true);
      expect(byId['shift-timer'].on).toBe(false);
      expect(byId['pinned-call-ticker'].on).toBe(false);
      expect(byId['mini-map'].on).toBe(false);
    }
  });

  it('serializeDesktopWidgets round-trips through normalizeDesktopWidgets', () => {
    const widgets = normalizeDesktopWidgets(null);
    expect(normalizeDesktopWidgets(serializeDesktopWidgets(widgets))).toEqual(widgets);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/normalizeDesktopWidgets.test.ts`
Expected: FAIL — `Cannot find module './normalizeDesktopWidgets'`

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/normalizeDesktopWidgets.ts
export interface DesktopWidgetState {
  id: string;
  x: number;
  y: number;
  on: boolean;
  opacity: number;
  blur: number;
}

export const ALL_WIDGET_IDS = [
  'clock', 'ops-summary', 'notifications', 'quick-access',
  'shift-timer', 'pinned-call-ticker', 'mini-map',
] as const;

export const V1_DEFAULT_ON_IDS: readonly string[] = ['clock', 'ops-summary', 'notifications', 'quick-access'];

function defaultPositionFor(index: number): { x: number; y: number } {
  // Stacked top-right, matching v1's fixed DesktopWidgetPanel layout —
  // only used as a starting point; the user can drag afterward (Task 10).
  return { x: 1180, y: 16 + index * 160 };
}

function defaultWidget(id: string, index: number, on: boolean): DesktopWidgetState {
  return { id, ...defaultPositionFor(index), on, opacity: 1, blur: 0 };
}

export function normalizeDesktopWidgets(raw: string | null | undefined): DesktopWidgetState[] {
  let parsed: unknown = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }

  // v1 shape: a bare array of on-widget id strings (order = display order)
  if (Array.isArray(parsed) && (parsed.length === 0 || typeof parsed[0] === 'string')) {
    const onIds = new Set(parsed as string[]);
    return ALL_WIDGET_IDS.map((id, i) => defaultWidget(id, i, onIds.has(id)));
  }

  // v2 shape: an array of per-widget state objects
  if (Array.isArray(parsed)) {
    const byId = new Map((parsed as Partial<DesktopWidgetState>[]).map(w => [w.id as string, w]));
    return ALL_WIDGET_IDS.map((id, i) => {
      const saved = byId.get(id);
      if (!saved) return defaultWidget(id, i, false);
      const fallback = defaultPositionFor(i);
      return {
        id,
        x: saved.x ?? fallback.x,
        y: saved.y ?? fallback.y,
        on: saved.on ?? false,
        opacity: saved.opacity ?? 1,
        blur: saved.blur ?? 0,
      };
    });
  }

  // null/undefined/invalid — v1 defaults, new widgets start off
  return ALL_WIDGET_IDS.map((id, i) => defaultWidget(id, i, V1_DEFAULT_ON_IDS.includes(id)));
}

export function serializeDesktopWidgets(widgets: DesktopWidgetState[]): string {
  return JSON.stringify(widgets);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/normalizeDesktopWidgets.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/normalizeDesktopWidgets.ts client/src/utils/normalizeDesktopWidgets.test.ts
git commit -m "feat(desktop): add v1→v2 desktop widgets normalizer"
```

---

### Task 3: D1 migration + preferences route for desktop v2 fields

**Files:**
- Create: `migrations/0194_desktop_v2.sql`
- Modify: `src/routes/stubs.ts:7-18`
- Modify: `test-workers/desktopPreferences.test.ts`

**Interfaces:**
- Produces: two new keys on `PUT /api/preferences` / `GET /api/preferences`: `desktop_accent: string`, `desktop_notes_json: string | null`.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0194_desktop_v2.sql
ALTER TABLE user_preferences ADD COLUMN desktop_accent TEXT;
ALTER TABLE user_preferences ADD COLUMN desktop_notes_json TEXT;
```

- [ ] **Step 2: Apply it to local D1**

Run: `npm run migrate:local`
Expected: migration `0194_desktop_v2.sql` applies with no errors.

- [ ] **Step 3: Write the failing test — extend the existing desktop preferences smoke test**

Open `test-workers/desktopPreferences.test.ts` (created in v1). Add `desktop_accent` and `desktop_notes_json` columns to the `beforeAll` `CREATE TABLE IF NOT EXISTS user_preferences` statement, and add a new test case:

```ts
// Add to the CREATE TABLE column list in beforeAll:
//   desktop_accent TEXT, desktop_notes_json TEXT,

it('persists and reads back desktop_accent and desktop_notes_json', async () => {
  const putRes = await app.request('/api/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      desktop_accent: 'amber',
      desktop_notes_json: JSON.stringify([{ id: 'n1', x: 40, y: 40, width: 180, height: 140, text: 'Check plate ABC123', color: 'amber' }]),
    }),
  }, env as unknown as Record<string, unknown>);
  expect(putRes.status).toBe(200);

  const getRes = await app.request('/api/preferences', {}, env as unknown as Record<string, unknown>);
  const getBody = await getRes.json() as Record<string, unknown>;
  expect(getBody.desktop_accent).toBe('amber');
  expect(JSON.parse(getBody.desktop_notes_json as string)[0].text).toBe('Check plate ABC123');
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/desktopPreferences.test.ts`
Expected: FAIL — `getBody.desktop_accent` is `undefined` because `PREF_DEFAULTS` doesn't have the key yet, so the `PUT` silently drops it.

- [ ] **Step 5: Add the two keys to `PREF_DEFAULTS`**

Use the Edit tool on `src/routes/stubs.ts`:

old_string:
```
  desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default',
  desktop_widgets_json: null,
} as const;
```

new_string:
```
  desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default',
  desktop_widgets_json: null,
  desktop_accent: 'default', desktop_notes_json: null,
} as const;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/desktopPreferences.test.ts`
Expected: PASS (all cases including the new one)

- [ ] **Step 7: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: PASS — `PREF_COLUMNS` is derived via `Object.keys(PREF_DEFAULTS)`, type-agnostic.

- [ ] **Step 8: Commit**

```bash
git add migrations/0194_desktop_v2.sql src/routes/stubs.ts test-workers/desktopPreferences.test.ts
git commit -m "feat(desktop): add desktop_accent + desktop_notes_json preference columns"
```

---

### Task 4: DesktopIconGrid — multi-select + grouping

**Files:**
- Modify: `client/src/components/desktop/DesktopIconGrid.tsx`
- Create: `client/src/components/desktop/DesktopIconGrid.test.tsx`

**Interfaces:**
- Consumes: `DesktopGroup` from Task 1.
- Produces (consumed by Task 15): `DesktopIconGridProps` gains `groups: DesktopGroup[]`, `onCreateGroup: (memberPaths: string[], label: string) => void`, `onUngroup: (groupId: string) => void`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/desktop/DesktopIconGrid.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LayoutDashboard, Map as MapIcon } from 'lucide-react';
import DesktopIconGrid from './DesktopIconGrid';
import { DesktopWindowManagerProvider } from './DesktopWindowManager';
import type { NavFunction } from '../../data/navCatalog';

const ICONS: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch', icon: LayoutDashboard, description: 'd' },
  { path: '/map', label: 'Live Map', icon: MapIcon, description: 'm' },
];

function renderGrid(overrides: Partial<React.ComponentProps<typeof DesktopIconGrid>> = {}) {
  const props = {
    icons: ICONS,
    positions: { '/dispatch': { x: 20, y: 20 }, '/map': { x: 116, y: 20 } },
    onReposition: vi.fn(),
    onUnpin: vi.fn(),
    groups: [],
    onCreateGroup: vi.fn(),
    onUngroup: vi.fn(),
    ...overrides,
  };
  render(<MemoryRouter><DesktopWindowManagerProvider><DesktopIconGrid {...props} /></DesktopWindowManagerProvider></MemoryRouter>);
  return props;
}

describe('DesktopIconGrid — multi-select + grouping', () => {
  beforeEach(() => vi.spyOn(window, 'prompt').mockReturnValue('Patrol Tools'));

  it('ctrl-clicking a second icon adds it to the selection instead of activating it', () => {
    const navigateSpy = vi.fn();
    vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigateSpy }));
    renderGrid();
    fireEvent.click(screen.getByText('Dispatch'), { ctrlKey: true });
    fireEvent.click(screen.getByText('Live Map'), { ctrlKey: true });
    // Neither ctrl-click should have navigated — both were selection toggles
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('right-clicking with 2 icons selected offers "Group as..." and calls onCreateGroup with both paths', () => {
    const props = renderGrid();
    fireEvent.click(screen.getByText('Dispatch'), { ctrlKey: true });
    fireEvent.click(screen.getByText('Live Map'), { ctrlKey: true });
    fireEvent.contextMenu(screen.getByText('Live Map'));
    fireEvent.click(screen.getByText('Group as...'));
    expect(props.onCreateGroup).toHaveBeenCalledWith(
      expect.arrayContaining(['/dispatch', '/map']),
      'Patrol Tools',
    );
  });

  it('renders a group region with its label and an Ungroup context action', () => {
    const props = renderGrid({
      groups: [{ id: 'g1', label: 'Patrol Tools', x: 10, y: 10, w: 220, h: 100, memberPaths: ['/dispatch', '/map'] }],
    });
    expect(screen.getByText('Patrol Tools')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId('desktop-group-g1'));
    fireEvent.click(screen.getByText('Ungroup'));
    expect(props.onUngroup).toHaveBeenCalledWith('g1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: FAIL — current `DesktopIconGridProps` has no `groups`/`onCreateGroup`/`onUngroup`, and there is no selection or "Group as..." behavior.

- [ ] **Step 3: Rewrite `DesktopIconGrid.tsx`**

```tsx
// client/src/components/desktop/DesktopIconGrid.tsx
import React, { useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavFunction } from '../../data/navCatalog';
import type { DesktopGroup } from '../../utils/normalizeDesktopLayout';
import { POPOUT_PAGES } from '../../utils/windowManager';
import { useDesktopWindows } from './DesktopWindowManager';
import ContextMenu from '../ContextMenu';

export interface DesktopIconGridProps {
  icons: NavFunction[];
  positions: Record<string, { x: number; y: number }>;
  onReposition: (path: string, x: number, y: number) => void;
  onUnpin: (path: string) => void;
  groups: DesktopGroup[];
  onCreateGroup: (memberPaths: string[], label: string) => void;
  onUngroup: (groupId: string) => void;
}

const ICON_SIZE = 64;

export default function DesktopIconGrid({
  icons, positions, onReposition, onUnpin, groups, onCreateGroup, onUngroup,
}: DesktopIconGridProps) {
  const navigate = useNavigate();
  const { openWindow } = useDesktopWindows();
  const dragRef = useRef<{ path: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleActivate = useCallback((fn: NavFunction) => {
    if (POPOUT_PAGES[fn.path]) {
      openWindow(fn.path, fn.label);
    } else {
      navigate(fn.path);
    }
  }, [navigate, openWindow]);

  const handleIconClick = useCallback((fn: NavFunction, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(fn.path)) next.delete(fn.path); else next.add(fn.path);
        return next;
      });
      return;
    }
    setSelected(new Set());
    handleActivate(fn);
  }, [handleActivate]);

  const onIconPointerDown = useCallback((fn: NavFunction, e: React.PointerEvent) => {
    const pos = positions[fn.path] ?? { x: 20, y: 20 };
    dragRef.current = { path: fn.path, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      onReposition(dragRef.current.path, Math.max(0, dragRef.current.originX + dx), Math.max(0, dragRef.current.originY + dy));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [positions, onReposition]);

  const handleGroupAs = useCallback(() => {
    const label = window.prompt('Group name:', 'New Group');
    if (label && label.trim()) {
      onCreateGroup([...selected], label.trim());
      setSelected(new Set());
    }
  }, [selected, onCreateGroup]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {groups.map(group => (
        <ContextMenu
          key={group.id}
          items={[{ label: 'Ungroup', onClick: () => onUngroup(group.id) }]}
        >
          <div
            data-testid={`desktop-group-${group.id}`}
            style={{
              position: 'absolute', left: group.x, top: group.y, width: group.w, height: group.h,
              border: '1px dashed var(--border-default)', background: 'rgba(var(--rmpg-500-rgb),0.04)',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{ position: 'absolute', top: -18, left: 2, fontSize: 10, color: 'var(--text-muted)', pointerEvents: 'auto' }}
            >
              {group.label}
            </span>
          </div>
        </ContextMenu>
      ))}
      {icons.map((fn) => {
        const pos = positions[fn.path] ?? { x: 20, y: 20 };
        const Icon = fn.icon;
        const eligible = !!POPOUT_PAGES[fn.path];
        const isSelected = selected.has(fn.path);
        const multiSelected = selected.size > 1 && isSelected;
        return (
          <ContextMenu
            key={fn.path}
            items={[
              { label: 'Open', onClick: () => handleActivate(fn) },
              ...(eligible ? [{ label: 'Open in new browser tab', onClick: () => window.open(fn.path, '_blank', 'noopener,noreferrer') }] : []),
              ...(multiSelected ? [{ label: 'Group as...', onClick: handleGroupAs }] : []),
              { label: 'Unpin', onClick: () => onUnpin(fn.path) },
            ]}
          >
            <button
              type="button"
              onClick={(e) => handleIconClick(fn, e)}
              onPointerDown={(e) => onIconPointerDown(fn, e)}
              style={{
                position: 'absolute', left: pos.x, top: pos.y, width: ICON_SIZE + 24,
                outline: isSelected ? '1px solid var(--brand-400)' : 'none',
              }}
              className="flex flex-col items-center gap-1 p-1 text-center"
            >
              <div
                className="flex items-center justify-center"
                style={{ width: ICON_SIZE, height: ICON_SIZE, background: 'rgba(var(--rmpg-500-rgb),0.1)', border: '1px solid var(--border-subtle)' }}
              >
                <Icon className="w-6 h-6" style={{ color: 'var(--rmpg-300)' }} />
              </div>
              <span className="text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>{fn.label}</span>
            </button>
          </ContextMenu>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: errors only in `DesktopPage.tsx` (doesn't pass `groups`/`onCreateGroup`/`onUngroup` yet — fixed in Task 15). No errors in `DesktopIconGrid.tsx` itself.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/desktop/DesktopIconGrid.tsx client/src/components/desktop/DesktopIconGrid.test.tsx
git commit -m "feat(desktop): add multi-select + icon grouping to DesktopIconGrid"
```

---

### Task 5: DesktopIconGrid — icon size + list view

**Files:**
- Modify: `client/src/components/desktop/DesktopIconGrid.tsx`
- Modify: `client/src/components/desktop/DesktopIconGrid.test.tsx`

**Interfaces:**
- Produces (consumed by Task 15): `DesktopIconGridProps` gains `iconSize: 'small' | 'medium' | 'large'`, `viewMode: 'grid' | 'list'`.

- [ ] **Step 1: Add the failing tests**

Append to `client/src/components/desktop/DesktopIconGrid.test.tsx`:

```tsx
describe('DesktopIconGrid — icon size + list view', () => {
  it('scales the icon tile with iconSize', () => {
    const { rerender } = render(
      <MemoryRouter><DesktopWindowManagerProvider>
        <DesktopIconGrid
          icons={ICONS} positions={{}} onReposition={vi.fn()} onUnpin={vi.fn()}
          groups={[]} onCreateGroup={vi.fn()} onUngroup={vi.fn()}
          iconSize="small" viewMode="grid"
        />
      </DesktopWindowManagerProvider></MemoryRouter>,
    );
    const smallTile = screen.getByText('Dispatch').closest('button')!.querySelector('div')!;
    expect(smallTile).toHaveStyle({ width: '40px' });

    rerender(
      <MemoryRouter><DesktopWindowManagerProvider>
        <DesktopIconGrid
          icons={ICONS} positions={{}} onReposition={vi.fn()} onUnpin={vi.fn()}
          groups={[]} onCreateGroup={vi.fn()} onUngroup={vi.fn()}
          iconSize="large" viewMode="grid"
        />
      </DesktopWindowManagerProvider></MemoryRouter>,
    );
    const largeTile = screen.getByText('Dispatch').closest('button')!.querySelector('div')!;
    expect(largeTile).toHaveStyle({ width: '88px' });
  });

  it('renders compact rows instead of absolutely-positioned tiles in list view', () => {
    render(
      <MemoryRouter><DesktopWindowManagerProvider>
        <DesktopIconGrid
          icons={ICONS} positions={{}} onReposition={vi.fn()} onUnpin={vi.fn()}
          groups={[]} onCreateGroup={vi.fn()} onUngroup={vi.fn()}
          iconSize="medium" viewMode="list"
        />
      </DesktopWindowManagerProvider></MemoryRouter>,
    );
    const button = screen.getByText('Dispatch').closest('button')!;
    expect(button).not.toHaveStyle({ position: 'absolute' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: FAIL — `iconSize`/`viewMode` props don't exist yet, tile size is hardcoded at 64px, no list-view branch.

- [ ] **Step 3: Add size + list-view support**

Use the Edit tool on `client/src/components/desktop/DesktopIconGrid.tsx`:

old_string:
```
export interface DesktopIconGridProps {
  icons: NavFunction[];
  positions: Record<string, { x: number; y: number }>;
  onReposition: (path: string, x: number, y: number) => void;
  onUnpin: (path: string) => void;
  groups: DesktopGroup[];
  onCreateGroup: (memberPaths: string[], label: string) => void;
  onUngroup: (groupId: string) => void;
}

const ICON_SIZE = 64;

export default function DesktopIconGrid({
  icons, positions, onReposition, onUnpin, groups, onCreateGroup, onUngroup,
}: DesktopIconGridProps) {
```

new_string:
```
export interface DesktopIconGridProps {
  icons: NavFunction[];
  positions: Record<string, { x: number; y: number }>;
  onReposition: (path: string, x: number, y: number) => void;
  onUnpin: (path: string) => void;
  groups: DesktopGroup[];
  onCreateGroup: (memberPaths: string[], label: string) => void;
  onUngroup: (groupId: string) => void;
  iconSize: 'small' | 'medium' | 'large';
  viewMode: 'grid' | 'list';
}

const ICON_SIZE_PX: Record<'small' | 'medium' | 'large', number> = { small: 40, medium: 64, large: 88 };

export default function DesktopIconGrid({
  icons, positions, onReposition, onUnpin, groups, onCreateGroup, onUngroup, iconSize, viewMode,
}: DesktopIconGridProps) {
  const ICON_SIZE = ICON_SIZE_PX[iconSize];
```

Then update the icon-tile rendering to react to `viewMode`. old_string:
```
            <button
              type="button"
              onClick={(e) => handleIconClick(fn, e)}
              onPointerDown={(e) => onIconPointerDown(fn, e)}
              style={{
                position: 'absolute', left: pos.x, top: pos.y, width: ICON_SIZE + 24,
                outline: isSelected ? '1px solid var(--brand-400)' : 'none',
              }}
              className="flex flex-col items-center gap-1 p-1 text-center"
            >
```

new_string:
```
            <button
              type="button"
              onClick={(e) => handleIconClick(fn, e)}
              onPointerDown={viewMode === 'grid' ? (e) => onIconPointerDown(fn, e) : undefined}
              style={
                viewMode === 'grid'
                  ? { position: 'absolute', left: pos.x, top: pos.y, width: ICON_SIZE + 24, outline: isSelected ? '1px solid var(--brand-400)' : 'none' }
                  : { width: '100%', outline: isSelected ? '1px solid var(--brand-400)' : 'none' }
              }
              className={viewMode === 'grid' ? 'flex flex-col items-center gap-1 p-1 text-center' : 'flex items-center gap-2 px-2 py-1 text-left'}
            >
```

Also wrap the `groups`/`icons` map bodies so grid-only elements (group regions, absolute positioning) are skipped in list view — old_string:
```
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {groups.map(group => (
```

new_string:
```
  return (
    <div style={viewMode === 'grid' ? { position: 'absolute', inset: 0 } : { position: 'relative' }}>
      {viewMode === 'grid' && groups.map(group => (
```

(This leaves the closing `))}` from the original `groups.map` unchanged — only the opening condition changes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: PASS (5 tests total)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopIconGrid.tsx client/src/components/desktop/DesktopIconGrid.test.tsx
git commit -m "feat(desktop): add icon size + list view to DesktopIconGrid"
```

---

### Task 6: Desktop layout controls — sort modes + snap-arrange + reset-to-default

**Files:**
- Create: `client/src/utils/desktopLayoutOps.ts`
- Create: `client/src/utils/desktopLayoutOps.test.ts`

**Interfaces:**
- Produces (consumed by Task 15): `sortIconPositions(icons: NavFunction[], mode: 'alpha' | 'usage', recentPaths: string[]): Record<string, {x,y}>`, `snapToGrid(positions: Record<string, {x,y}>): Record<string, {x,y}>`.

These are pure layout-math functions kept separate from `DesktopIconGrid` (a rendering component) so they're trivially unit-testable and so `DesktopPage.tsx` (Task 15) can call them directly from its "Sort" / "Snap to grid" / "Reset to default" settings-popover actions.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/desktopLayoutOps.test.ts
import { describe, it, expect } from 'vitest';
import { LayoutDashboard, Map as MapIcon, Users } from 'lucide-react';
import { sortIconPositions, snapToGrid } from './desktopLayoutOps';
import type { NavFunction } from '../data/navCatalog';

const ICONS: NavFunction[] = [
  { path: '/records', label: 'Records', icon: Users, description: 'r' },
  { path: '/dispatch', label: 'Dispatch', icon: LayoutDashboard, description: 'd' },
  { path: '/map', label: 'Live Map', icon: MapIcon, description: 'm' },
];

describe('sortIconPositions', () => {
  it('alpha mode lays out icons left-to-right, top-to-bottom by label', () => {
    const positions = sortIconPositions(ICONS, 'alpha', []);
    // Dispatch < Live Map < Records alphabetically
    expect(positions['/dispatch'].x).toBeLessThan(positions['/map'].x);
    expect(positions['/map'].x).toBeLessThan(positions['/records'].x);
    expect(positions['/dispatch'].y).toBe(positions['/map'].y);
  });

  it('usage mode orders by position in recentPaths (most-recent first), unlisted icons last', () => {
    const positions = sortIconPositions(ICONS, 'usage', ['/map', '/records']);
    expect(positions['/map'].x).toBeLessThan(positions['/records'].x);
    expect(positions['/records'].x).toBeLessThan(positions['/dispatch'].x); // not in recentPaths — last
  });
});

describe('snapToGrid', () => {
  it('rounds every position to the nearest 96px grid cell', () => {
    const snapped = snapToGrid({ '/dispatch': { x: 130, y: 47 }, '/map': { x: 10, y: 200 } });
    expect(snapped['/dispatch']).toEqual({ x: 96, y: 0 });
    expect(snapped['/map']).toEqual({ x: 0, y: 192 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/desktopLayoutOps.test.ts`
Expected: FAIL — `Cannot find module './desktopLayoutOps'`

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/desktopLayoutOps.ts
import type { NavFunction } from '../data/navCatalog';

const GRID_COLS = 6;
const CELL_W = 96;
const CELL_H = 96;

function gridLayout(orderedPaths: string[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  orderedPaths.forEach((path, i) => {
    positions[path] = { x: (i % GRID_COLS) * CELL_W + 20, y: Math.floor(i / GRID_COLS) * CELL_H + 20 };
  });
  return positions;
}

export function sortIconPositions(
  icons: NavFunction[],
  mode: 'alpha' | 'usage',
  recentPaths: string[],
): Record<string, { x: number; y: number }> {
  if (mode === 'alpha') {
    const ordered = [...icons].sort((a, b) => a.label.localeCompare(b.label)).map(fn => fn.path);
    return gridLayout(ordered);
  }
  // usage: most-recently-used first (per recentPaths order), anything not in
  // recentPaths keeps its original catalog order at the end.
  const recentIndex = new Map(recentPaths.map((p, i) => [p, i]));
  const ordered = [...icons]
    .sort((a, b) => {
      const ai = recentIndex.has(a.path) ? recentIndex.get(a.path)! : Number.MAX_SAFE_INTEGER;
      const bi = recentIndex.has(b.path) ? recentIndex.get(b.path)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    })
    .map(fn => fn.path);
  return gridLayout(ordered);
}

export function snapToGrid(positions: Record<string, { x: number; y: number }>): Record<string, { x: number; y: number }> {
  const snapped: Record<string, { x: number; y: number }> = {};
  for (const [path, pos] of Object.entries(positions)) {
    snapped[path] = { x: Math.round(pos.x / CELL_W) * CELL_W, y: Math.round(pos.y / CELL_H) * CELL_H };
  }
  return snapped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/desktopLayoutOps.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/desktopLayoutOps.ts client/src/utils/desktopLayoutOps.test.ts
git commit -m "feat(desktop): add sort-mode + snap-to-grid layout math"
```

---

### Task 7: Bulk-pin from Module Directory

**Files:**
- Modify: `client/src/pages/ModuleDirectoryPage.tsx`
- Create: `client/src/pages/ModuleDirectoryPage.bulkPin.test.tsx`

**Interfaces:** none new — purely additive UI state within `ModuleDirectoryPage.tsx`, reusing `loadFavorites`/`saveFavorites` from `client/src/utils/navFavorites.ts` (already imported by this file per v1).

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/ModuleDirectoryPage.bulkPin.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../hooks/useApi', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: '1', role: 'officer' } }) }));

import ModuleDirectoryPage from './ModuleDirectoryPage';

describe('ModuleDirectoryPage — bulk pin', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('select-multiple mode stars every checked module in one save', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
    fireEvent.click(screen.getByText(/Search modules/i) ?? screen.getByPlaceholderText(/Search modules/i));
    fireEvent.click(screen.getByLabelText(/Select multiple/i));
    fireEvent.change(screen.getByPlaceholderText(/Search modules/i), { target: { value: 'Dispatch Console' } });
    fireEvent.click(screen.getByLabelText(/Select Dispatch Console/i));
    fireEvent.change(screen.getByPlaceholderText(/Search modules/i), { target: { value: 'Live Map' } });
    fireEvent.click(screen.getByLabelText(/Select Live Map/i));
    fireEvent.click(screen.getByText(/Pin 2 selected/i));
    const favorites = JSON.parse(localStorage.getItem('rmpg_nav_favorites') ?? '[]');
    expect(favorites).toEqual(expect.arrayContaining(['/dispatch', '/map']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/ModuleDirectoryPage.bulkPin.test.tsx`
Expected: FAIL — no "Select multiple" control exists yet.

- [ ] **Step 3: Add select-multiple mode**

Read `client/src/pages/ModuleDirectoryPage.tsx` around its favorites state (`const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);`, confirmed at line 24) and its `toggleFavorite` callback (confirmed at line 83). Add sibling state and a toolbar control:

Use the Edit tool, old_string:
```
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
```

new_string:
```
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  const toggleBulkSelected = useCallback((path: string) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const commitBulkPin = useCallback(() => {
    setFavorites(prev => {
      const next = new Set(prev);
      bulkSelected.forEach(path => next.add(path));
      saveFavorites(next);
      return next;
    });
    setBulkSelected(new Set());
    setBulkMode(false);
  }, [bulkSelected]);
```

Then add the toolbar toggle and per-row checkbox. Locate the search input (the element matched by `getByPlaceholderText(/Search modules/i)` in existing tests) and add, immediately after its containing element:

```tsx
<div className="flex items-center gap-2 px-2">
  <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
    <input
      type="checkbox"
      aria-label="Select multiple"
      checked={bulkMode}
      onChange={(e) => { setBulkMode(e.target.checked); setBulkSelected(new Set()); }}
    />
    Select multiple
  </label>
  {bulkMode && bulkSelected.size > 0 && (
    <button type="button" onClick={commitBulkPin} className="text-[10px] px-2 py-0.5" style={{ color: 'var(--brand-400)', border: '1px solid var(--border-default)' }}>
      Pin {bulkSelected.size} selected
    </button>
  )}
</div>
```

Then, in the per-module row render (near the existing `toggleFavorite` star button at line ~492), add a checkbox shown only in bulk mode:

```tsx
{bulkMode && (
  <input
    type="checkbox"
    aria-label={`Select ${fn.label}`}
    checked={bulkSelected.has(fn.path)}
    onChange={() => toggleBulkSelected(fn.path)}
    onClick={(e) => e.stopPropagation()}
  />
)}
```
placed immediately before the existing star `<button>` in that row's JSX, inside the same flex container.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/ModuleDirectoryPage.bulkPin.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the existing regression test + typecheck**

Run: `cd client && npx vitest run src/pages/ModuleDirectoryPage.test.tsx && npx tsc --noEmit`
Expected: PASS — bulk-pin additions are purely additive, don't change existing star/search/favorite behavior.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ModuleDirectoryPage.tsx client/src/pages/ModuleDirectoryPage.bulkPin.test.tsx
git commit -m "feat(desktop): add bulk-pin select-multiple mode to Module Directory"
```

---

### Task 8: `DesktopShiftTimerWidget` + `DesktopPinnedCallTicker`

**Files:**
- Create: `client/src/components/desktop/widgets/DesktopShiftTimerWidget.tsx`
- Create: `client/src/components/desktop/widgets/DesktopShiftTimerWidget.test.tsx`
- Create: `client/src/components/desktop/widgets/DesktopPinnedCallTicker.tsx`
- Create: `client/src/components/desktop/widgets/DesktopPinnedCallTicker.test.tsx`

**Interfaces:**
- Produces (consumed by Task 10's widget registry): `DesktopShiftTimerWidget()` (no props — polls `GET /personnel/time/mine/active`, same as `DesktopClockWidget`), `DesktopPinnedCallTicker()` (no props — polls `GET /dispatch/queue`, same endpoint `DashboardMiniMap` uses).

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/desktop/widgets/DesktopShiftTimerWidget.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopShiftTimerWidget from './DesktopShiftTimerWidget';

describe('DesktopShiftTimerWidget', () => {
  beforeEach(() => { apiFetchMock.mockReset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows elapsed on-duty time when clocked in', async () => {
    apiFetchMock.mockResolvedValue({ active: true, entry: { clock_in: new Date(Date.now() - 65_000).toISOString() } });
    render(<DesktopShiftTimerWidget />);
    await waitFor(() => expect(screen.getByText(/on duty/i)).toBeInTheDocument());
    expect(screen.getByText(/01:0[0-9]/)).toBeInTheDocument(); // ~65s elapsed
  });

  it('shows an off-duty state when not clocked in', async () => {
    apiFetchMock.mockResolvedValue({ active: false, entry: null });
    render(<DesktopShiftTimerWidget />);
    await waitFor(() => expect(screen.getByText(/off duty/i)).toBeInTheDocument());
  });
});
```

```tsx
// client/src/components/desktop/widgets/DesktopPinnedCallTicker.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopPinnedCallTicker from './DesktopPinnedCallTicker';

describe('DesktopPinnedCallTicker', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('renders each active call\'s type and address', async () => {
    apiFetchMock.mockResolvedValue([
      { id: 1, call_type: 'Traffic Stop', address: '123 Main St', priority: 2 },
      { id: 2, call_type: 'Domestic Disturbance', address: '456 Elm St', priority: 1 },
    ]);
    render(<DesktopPinnedCallTicker />);
    await waitFor(() => expect(screen.getByText(/Traffic Stop/)).toBeInTheDocument());
    expect(screen.getByText(/123 Main St/)).toBeInTheDocument();
    expect(screen.getByText(/Domestic Disturbance/)).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no active calls', async () => {
    apiFetchMock.mockResolvedValue([]);
    render(<DesktopPinnedCallTicker />);
    await waitFor(() => expect(screen.getByText(/no active calls/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/widgets/DesktopShiftTimerWidget.test.tsx src/components/desktop/widgets/DesktopPinnedCallTicker.test.tsx`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `DesktopShiftTimerWidget.tsx`**

```tsx
// client/src/components/desktop/widgets/DesktopShiftTimerWidget.tsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function DesktopShiftTimerWidget() {
  const [clockIn, setClockIn] = useState<string | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ active: boolean; entry: { clock_in: string } | null }>('/personnel/time/mine/active')
      .then(res => { if (!cancelled) { setActive(res.active); setClockIn(res.entry?.clock_in ?? null); } })
      .catch(() => { if (!cancelled) setActive(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = active && clockIn ? formatElapsed(now - new Date(clockIn).getTime()) : null;

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 200 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--rmpg-400)' }}>Shift Timer</div>
      {active === null ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>…</div>
      ) : active ? (
        <>
          <div className="text-[18px] font-mono" style={{ color: 'var(--text-primary)' }}>{elapsed}</div>
          <div className="text-[10px]" style={{ color: 'var(--brand-400)' }}>On Duty</div>
        </>
      ) : (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Off Duty</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `DesktopPinnedCallTicker.tsx`**

```tsx
// client/src/components/desktop/widgets/DesktopPinnedCallTicker.tsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface TickerCall {
  id: number | string;
  call_type: string;
  address: string;
  priority: number;
}

export default function DesktopPinnedCallTicker() {
  const [calls, setCalls] = useState<TickerCall[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      apiFetch<TickerCall[]>('/dispatch/queue')
        .then(rows => { if (!cancelled) { setCalls(Array.isArray(rows) ? rows : []); setLoaded(true); } })
        .catch(() => { if (!cancelled) setLoaded(true); });
    }
    poll();
    const interval = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 220, maxHeight: 160, overflowY: 'auto' }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--rmpg-400)' }}>Active Calls</div>
      {!loaded ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>…</div>
      ) : calls.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No active calls</div>
      ) : (
        calls.map(c => (
          <div key={c.id} className="text-[11px] py-0.5" style={{ color: 'var(--text-primary)' }}>
            <span className="font-semibold">{c.call_type}</span>
            <span style={{ color: 'var(--text-muted)' }}> — {c.address}</span>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/widgets/DesktopShiftTimerWidget.test.tsx src/components/desktop/widgets/DesktopPinnedCallTicker.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/desktop/widgets/DesktopShiftTimerWidget.tsx client/src/components/desktop/widgets/DesktopShiftTimerWidget.test.tsx client/src/components/desktop/widgets/DesktopPinnedCallTicker.tsx client/src/components/desktop/widgets/DesktopPinnedCallTicker.test.tsx
git commit -m "feat(desktop): add shift-timer and pinned-call-ticker widgets"
```

---

### Task 9: `DesktopMiniMapWidget`

**Files:**
- Create: `client/src/components/desktop/widgets/DesktopMiniMapWidget.tsx`
- Create: `client/src/components/desktop/widgets/DesktopMiniMapWidget.test.tsx`

**Interfaces:**
- Consumes: `DashboardMiniMap` (existing component, `client/src/components/DashboardMiniMap.tsx`, zero props).
- Produces (consumed by Task 10's widget registry): `DesktopMiniMapWidget()`.

Reuses the **existing** `DashboardMiniMap.tsx` wholesale instead of writing a new Mapbox integration — it already renders a fleet-wide live map (units + active calls, auto-fit bounds) with its own loading/error states and an "Open full map" button. This is the single heaviest widget in this pass (a second live Mapbox GL context), so the wrapper's only job is sizing it to fit the desktop widget panel and ensuring the map unmounts cleanly when the widget is toggled off — which `DashboardMiniMap` already does via its own `useEffect` cleanup (`mapRef.current?.remove()`).

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/desktop/widgets/DesktopMiniMapWidget.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('mapbox-gl', () => ({
  default: {
    Map: vi.fn().mockImplementation(() => ({
      addControl: vi.fn(), on: vi.fn(), remove: vi.fn(), fitBounds: vi.fn(),
    })),
    Marker: vi.fn().mockImplementation(() => ({ setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn(), setPopup: vi.fn().mockReturnThis() })),
    Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
    LngLatBounds: vi.fn().mockImplementation(() => ({ extend: vi.fn() })),
    AttributionControl: vi.fn(),
  },
}));
vi.mock('../../../utils/mapboxApiKey', () => ({ getMapboxToken: vi.fn().mockResolvedValue('') }));
vi.mock('../../../utils/mapboxLoader', () => ({ injectMapboxStyles: vi.fn() }));
vi.mock('../../../utils/mapboxBasemap', () => ({ applyRmpgBasemap: vi.fn() }));
vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn().mockResolvedValue([]) }));

import DesktopMiniMapWidget from './DesktopMiniMapWidget';

describe('DesktopMiniMapWidget', () => {
  it('renders the shared DashboardMiniMap inside the widget frame', () => {
    render(<MemoryRouter><DesktopMiniMapWidget /></MemoryRouter>);
    expect(screen.getByText(/Live Situational Map/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/widgets/DesktopMiniMapWidget.test.tsx`
Expected: FAIL — `Cannot find module './DesktopMiniMapWidget'`

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/desktop/widgets/DesktopMiniMapWidget.tsx
import React from 'react';
import DashboardMiniMap from '../../DashboardMiniMap';

export default function DesktopMiniMapWidget() {
  return (
    <div style={{ width: 260 }}>
      <DashboardMiniMap />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/widgets/DesktopMiniMapWidget.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/widgets/DesktopMiniMapWidget.tsx client/src/components/desktop/widgets/DesktopMiniMapWidget.test.tsx
git commit -m "feat(desktop): add mini-map widget wrapping DashboardMiniMap"
```

---

### Task 10: Freeform widget drag + per-widget opacity/blur

**Files:**
- Create: `client/src/hooks/useDraggablePosition.ts`
- Create: `client/src/hooks/useDraggablePosition.test.ts`
- Modify: `client/src/components/desktop/DesktopWidgetPanel.tsx`
- Create: `client/src/components/desktop/DesktopWidgetPanel.test.tsx` (replaces the v1 test of the same name — see Step 6)

**Interfaces:**
- Produces (consumed by this task's `DesktopWidgetPanel` and reusable by `DesktopStickyNote` in Task 12): `useDraggablePosition(x: number, y: number, onMove: (x: number, y: number) => void): { onPointerDown: (e: React.PointerEvent) => void }` — extracted from the pointer-drag math already in `DesktopIconGrid.tsx`'s `onIconPointerDown`, generalized to any x/y setter.
- `DesktopWidgetPanelProps` changes from `{ enabledWidgets: string[]; catalog: NavFunction[] }` to `{ widgets: DesktopWidgetState[]; catalog: NavFunction[]; onMoveWidget: (id: string, x: number, y: number) => void; onAdjustWidget: (id: string, patch: Partial<Pick<DesktopWidgetState, 'opacity' | 'blur'>>) => void }`.

- [ ] **Step 1: Write the failing test for the extracted drag hook**

```ts
// client/src/hooks/useDraggablePosition.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraggablePosition } from './useDraggablePosition';

describe('useDraggablePosition', () => {
  it('calls onMove with the origin position plus pointer delta on drag', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useDraggablePosition(50, 60, onMove));

    act(() => {
      result.current.onPointerDown({ clientX: 100, clientY: 100 } as React.PointerEvent);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, clientY: 90 }));
    });
    expect(onMove).toHaveBeenCalledWith(80, 50); // 50+30, 60-10

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
    onMove.mockClear();
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 999, clientY: 999 }));
    });
    expect(onMove).not.toHaveBeenCalled(); // listeners removed after pointerup
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/useDraggablePosition.test.ts`
Expected: FAIL — `Cannot find module './useDraggablePosition'`

- [ ] **Step 3: Write the hook**

```ts
// client/src/hooks/useDraggablePosition.ts
import { useRef, useCallback } from 'react';

export function useDraggablePosition(x: number, y: number, onMove: (x: number, y: number) => void) {
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: x, originY: y };
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      onMove(Math.max(0, dragRef.current.originX + dx), Math.max(0, dragRef.current.originY + dy));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [x, y, onMove]);

  return { onPointerDown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/useDraggablePosition.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the hook**

```bash
git add client/src/hooks/useDraggablePosition.ts client/src/hooks/useDraggablePosition.test.ts
git commit -m "feat(desktop): extract useDraggablePosition hook for freeform drag"
```

- [ ] **Step 6: Replace `DesktopWidgetPanel.test.tsx` with the freeform-layout version**

```tsx
// client/src/components/desktop/DesktopWidgetPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('../../hooks/useApi', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
vi.mock('../../hooks/useClock', () => ({ useClock: () => ({ time: '12:00:00', date: 'Sat, Jul 18, 2026' }) }));
vi.mock('../../hooks/useNavBadges', () => ({ useNavBadges: () => ({ badges: {} }) }));

import DesktopWidgetPanel from './DesktopWidgetPanel';
import { normalizeDesktopWidgets } from '../../utils/normalizeDesktopWidgets';

describe('DesktopWidgetPanel — freeform layout', () => {
  it('positions each enabled widget absolutely at its own x/y, applying opacity + blur', () => {
    const widgets = normalizeDesktopWidgets(null).map(w => w.id === 'clock' ? { ...w, x: 300, y: 40, opacity: 0.6, blur: 4 } : w);
    const onMoveWidget = vi.fn();
    render(<DesktopWidgetPanel widgets={widgets} catalog={[]} onMoveWidget={onMoveWidget} onAdjustWidget={vi.fn()} />);
    const clockPanel = screen.getByText('12:00:00').closest('[data-widget-id="clock"]') as HTMLElement;
    expect(clockPanel).toHaveStyle({ position: 'absolute', left: '300px', top: '40px', opacity: '0.6' });
    expect(clockPanel.style.backdropFilter).toContain('blur(4px)');
  });

  it('renders only widgets with on:true', () => {
    const widgets = normalizeDesktopWidgets(null); // v1 defaults: clock/ops-summary/notifications/quick-access on, others off
    render(<DesktopWidgetPanel widgets={widgets} catalog={[]} onMoveWidget={vi.fn()} onAdjustWidget={vi.fn()} />);
    expect(screen.queryByText(/Shift Timer/i)).not.toBeInTheDocument();
  });

  it('right-clicking a widget offers opacity and blur adjustments that call onAdjustWidget', () => {
    const widgets = normalizeDesktopWidgets(null).map(w => w.id === 'clock' ? { ...w, opacity: 1, blur: 0 } : w);
    const onAdjustWidget = vi.fn();
    render(<DesktopWidgetPanel widgets={widgets} catalog={[]} onMoveWidget={vi.fn()} onAdjustWidget={onAdjustWidget} />);
    const clockPanel = screen.getByText('12:00:00').closest('[data-widget-id="clock"]') as HTMLElement;
    fireEvent.contextMenu(clockPanel);
    fireEvent.click(screen.getByText('Decrease opacity'));
    expect(onAdjustWidget).toHaveBeenCalledWith('clock', { opacity: 0.9 });
    fireEvent.click(screen.getByText('Toggle blur'));
    expect(onAdjustWidget).toHaveBeenCalledWith('clock', { blur: 6 });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWidgetPanel.test.tsx`
Expected: FAIL — current `DesktopWidgetPanel` takes `enabledWidgets: string[]`, not `widgets: DesktopWidgetState[]`, and has no drag/opacity/blur/context-menu.

- [ ] **Step 8: Rewrite `DesktopWidgetPanel.tsx`**

```tsx
// client/src/components/desktop/DesktopWidgetPanel.tsx
import React from 'react';
import type { NavFunction } from '../../data/navCatalog';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
import ContextMenu from '../ContextMenu';
import DesktopClockWidget from './widgets/DesktopClockWidget';
import DesktopOpsSummaryWidget from './widgets/DesktopOpsSummaryWidget';
import DesktopNotificationsWidget from './widgets/DesktopNotificationsWidget';
import DesktopQuickAccessWidget from './widgets/DesktopQuickAccessWidget';
import DesktopShiftTimerWidget from './widgets/DesktopShiftTimerWidget';
import DesktopPinnedCallTicker from './widgets/DesktopPinnedCallTicker';
import DesktopMiniMapWidget from './widgets/DesktopMiniMapWidget';

export interface DesktopWidgetPanelProps {
  widgets: DesktopWidgetState[];
  catalog: NavFunction[];
  onMoveWidget: (id: string, x: number, y: number) => void;
  onAdjustWidget: (id: string, patch: Partial<Pick<DesktopWidgetState, 'opacity' | 'blur'>>) => void;
}

const WIDGET_COMPONENTS: Record<string, React.ComponentType<any>> = {
  'clock': DesktopClockWidget,
  'ops-summary': DesktopOpsSummaryWidget,
  'notifications': DesktopNotificationsWidget,
  'quick-access': DesktopQuickAccessWidget,
  'shift-timer': DesktopShiftTimerWidget,
  'pinned-call-ticker': DesktopPinnedCallTicker,
  'mini-map': DesktopMiniMapWidget,
};

function clampOpacity(v: number): number {
  return Math.max(0.2, Math.min(1, Math.round(v * 10) / 10));
}

function WidgetFrame({
  widget, catalog, onMoveWidget, onAdjustWidget,
}: {
  widget: DesktopWidgetState;
  catalog: NavFunction[];
  onMoveWidget: (id: string, x: number, y: number) => void;
  onAdjustWidget: (id: string, patch: Partial<Pick<DesktopWidgetState, 'opacity' | 'blur'>>) => void;
}) {
  const { onPointerDown } = useDraggablePosition(widget.x, widget.y, (x, y) => onMoveWidget(widget.id, x, y));
  const Widget = WIDGET_COMPONENTS[widget.id];
  if (!Widget) return null;
  return (
    <ContextMenu
      items={[
        { label: 'Increase opacity', onClick: () => onAdjustWidget(widget.id, { opacity: clampOpacity(widget.opacity + 0.1) }) },
        { label: 'Decrease opacity', onClick: () => onAdjustWidget(widget.id, { opacity: clampOpacity(widget.opacity - 0.1) }) },
        { label: 'Toggle blur', onClick: () => onAdjustWidget(widget.id, { blur: widget.blur > 0 ? 0 : 6 }) },
      ]}
    >
      <div
        data-widget-id={widget.id}
        onPointerDown={onPointerDown}
        style={{ position: 'absolute', left: widget.x, top: widget.y, opacity: widget.opacity, backdropFilter: widget.blur > 0 ? `blur(${widget.blur}px)` : undefined, cursor: 'move' }}
      >
        {widget.id === 'quick-access' ? <Widget catalog={catalog} /> : <Widget />}
      </div>
    </ContextMenu>
  );
}

export default function DesktopWidgetPanel({ widgets, catalog, onMoveWidget, onAdjustWidget }: DesktopWidgetPanelProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
        {widgets.filter(w => w.on).map(w => (
          <WidgetFrame key={w.id} widget={w} catalog={catalog} onMoveWidget={onMoveWidget} onAdjustWidget={onAdjustWidget} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopWidgetPanel.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 10: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: errors only in `DesktopPage.tsx` (still passes the old `enabledWidgets`/no `onMoveWidget`/`onAdjustWidget` — fixed in Task 15) and `DesktopWidgetSettingsPopover.tsx` (still expects `enabledWidgets: string[]` — fixed in Task 11).

- [ ] **Step 11: Commit**

```bash
git add client/src/components/desktop/DesktopWidgetPanel.tsx client/src/components/desktop/DesktopWidgetPanel.test.tsx
git commit -m "feat(desktop): freeform widget drag positions + opacity/blur"
```

---

### Task 11: Accent presets + seasonal wallpaper presets + settings popover pickers

**Files:**
- Create: `client/src/data/desktopAccents.ts`
- Create: `client/src/data/desktopAccents.test.ts`
- Modify: `client/src/data/desktopWallpapers.ts`
- Modify: `client/src/data/desktopWallpapers.test.ts`
- Rewrite: `client/src/components/desktop/DesktopWidgetSettingsPopover.tsx`
- Create: `client/src/components/desktop/DesktopWidgetSettingsPopover.test.tsx`

**Interfaces:**
- Produces (consumed by Task 15): `AccentPreset { id: string; label: string; accent: string; shadow: string }`, `DEFAULT_ACCENT_ID = 'default'`, `DESKTOP_ACCENTS: AccentPreset[]`, `getAccent(id: string): AccentPreset`.
- `DesktopWidgetSettingsPopoverProps` changes to also accept `iconSize`, `onIconSizeChange`, `sortMode`, `onSortModeChange`, `onSnapToGrid`, `wallpaperId`, `onWallpaperChange`, `accentId`, `onAccentChange`, `onResetToDefault`.

- [ ] **Step 1: Write the failing test for accent presets**

```ts
// client/src/data/desktopAccents.test.ts
import { describe, it, expect } from 'vitest';
import { DESKTOP_ACCENTS, DEFAULT_ACCENT_ID, getAccent } from './desktopAccents';

describe('desktopAccents', () => {
  it('includes the default accent id in the preset list', () => {
    expect(DESKTOP_ACCENTS.some(a => a.id === DEFAULT_ACCENT_ID)).toBe(true);
  });

  it('getAccent falls back to the default for an unknown id', () => {
    expect(getAccent('not-a-real-id').id).toBe(DEFAULT_ACCENT_ID);
  });

  it('every preset\'s accent color references an existing CSS variable, never a hardcoded hex', () => {
    for (const a of DESKTOP_ACCENTS) {
      expect(a.accent).toMatch(/var\(--/);
      expect(a.accent).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/data/desktopAccents.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write `desktopAccents.ts`**

Reuses existing semantic tokens already defined in `client/src/styles/theme-palettes.css` — the Blue & Silver default reuses `--brand-blue` (the same value `--desktop-shell-accent` already holds), and the four alternates reuse the existing `--stat-accent-*` tokens rather than introducing new hex, exactly mirroring how `desktopWallpapers.ts` only ever references existing `--surface-*` tokens.

```ts
// client/src/data/desktopAccents.ts
export interface AccentPreset {
  id: string;
  label: string;
  accent: string;
  shadow: string;
}

export const DEFAULT_ACCENT_ID = 'default';

export const DESKTOP_ACCENTS: AccentPreset[] = [
  { id: 'default', label: 'Blue & Silver', accent: 'var(--brand-blue)', shadow: 'rgba(0, 0, 0, 0.4)' },
  { id: 'amber', label: 'Amber', accent: 'var(--stat-accent-amber-bright)', shadow: 'rgba(251, 191, 36, 0.35)' },
  { id: 'crimson', label: 'Crimson', accent: 'var(--stat-accent-red-bright)', shadow: 'rgba(239, 68, 68, 0.35)' },
  { id: 'forest', label: 'Forest', accent: 'var(--stat-accent-green)', shadow: 'rgba(34, 197, 94, 0.35)' },
  { id: 'purple', label: 'Purple', accent: 'var(--stat-accent-purple)', shadow: 'rgba(168, 85, 247, 0.35)' },
];

export function getAccent(id: string): AccentPreset {
  return DESKTOP_ACCENTS.find(a => a.id === id) ?? DESKTOP_ACCENTS[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/data/desktopAccents.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add seasonal/precinct wallpaper presets + extend their test**

Use the Edit tool on `client/src/data/desktopWallpapers.ts`, old_string:
```
  {
    id: 'panel-grid',
    label: 'Panel Grid',
    background:
      'linear-gradient(var(--border-subtle) 1px, transparent 1px), ' +
      'linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px), var(--surface-base)',
  },
];
```

new_string:
```
  {
    id: 'panel-grid',
    label: 'Panel Grid',
    background:
      'linear-gradient(var(--border-subtle) 1px, transparent 1px), ' +
      'linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px), var(--surface-base)',
  },
  {
    id: 'precinct-radial',
    label: 'Precinct Radial',
    background: 'radial-gradient(circle at center, var(--surface-raised) 0%, var(--surface-base) 70%)',
  },
  {
    id: 'shift-gradient',
    label: 'Shift Gradient',
    background: 'linear-gradient(160deg, var(--surface-overlay) 0%, var(--surface-base) 100%)',
  },
];
```

Update `client/src/data/desktopWallpapers.test.ts` — its existing "no hardcoded hex" test iterates `DESKTOP_WALLPAPERS`, so the two new entries are covered automatically; no test changes needed beyond re-running it.

- [ ] **Step 6: Run the wallpaper test to confirm the additions pass the existing assertions**

Run: `cd client && npx vitest run src/data/desktopWallpapers.test.ts`
Expected: PASS (existing 3 tests, now covering 6 presets)

- [ ] **Step 7: Commit the data files**

```bash
git add client/src/data/desktopAccents.ts client/src/data/desktopAccents.test.ts client/src/data/desktopWallpapers.ts
git commit -m "feat(desktop): add accent color presets and seasonal wallpaper presets"
```

- [ ] **Step 8: Write the failing test for the expanded settings popover**

```tsx
// client/src/components/desktop/DesktopWidgetSettingsPopover.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopWidgetSettingsPopover from './DesktopWidgetSettingsPopover';
import { normalizeDesktopWidgets } from '../../utils/normalizeDesktopWidgets';

function renderPopover(overrides: Partial<React.ComponentProps<typeof DesktopWidgetSettingsPopover>> = {}) {
  const props = {
    widgets: normalizeDesktopWidgets(null),
    onToggleWidget: vi.fn(),
    iconSize: 'medium' as const,
    onIconSizeChange: vi.fn(),
    viewMode: 'grid' as const,
    onViewModeChange: vi.fn(),
    sortMode: 'manual' as const,
    onSortModeChange: vi.fn(),
    onSnapToGrid: vi.fn(),
    wallpaperId: 'blue-silver-default',
    onWallpaperChange: vi.fn(),
    accentId: 'default',
    onAccentChange: vi.fn(),
    onResetToDefault: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<DesktopWidgetSettingsPopover {...props} />);
  return props;
}

describe('DesktopWidgetSettingsPopover', () => {
  it('toggling a widget checkbox calls onToggleWidget with the widget id', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByLabelText('Clock & Shift'));
    expect(props.onToggleWidget).toHaveBeenCalledWith('clock', false);
  });

  it('clicking an icon-size button calls onIconSizeChange', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByText('Large'));
    expect(props.onIconSizeChange).toHaveBeenCalledWith('large');
  });

  it('clicking the List view button calls onViewModeChange', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByText('List'));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('clicking a sort-mode button calls onSortModeChange, and Snap to Grid calls onSnapToGrid', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByText('Alphabetical'));
    expect(props.onSortModeChange).toHaveBeenCalledWith('alpha');
    fireEvent.click(screen.getByText('Snap to Grid'));
    expect(props.onSnapToGrid).toHaveBeenCalled();
  });

  it('clicking a wallpaper swatch calls onWallpaperChange, an accent swatch calls onAccentChange', () => {
    const props = renderPopover();
    fireEvent.click(screen.getByLabelText('Wallpaper: Sunken Slate'));
    expect(props.onWallpaperChange).toHaveBeenCalledWith('sunken');
    fireEvent.click(screen.getByLabelText('Accent: Amber'));
    expect(props.onAccentChange).toHaveBeenCalledWith('amber');
  });

  it('Reset to Default asks for confirmation before calling onResetToDefault', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const props = renderPopover();
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(window.confirm).toHaveBeenCalled();
    expect(props.onResetToDefault).toHaveBeenCalled();
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWidgetSettingsPopover.test.tsx`
Expected: FAIL — current popover only handles `enabledWidgets`/`onToggle`.

- [ ] **Step 10: Rewrite `DesktopWidgetSettingsPopover.tsx`**

```tsx
// client/src/components/desktop/DesktopWidgetSettingsPopover.tsx
import React from 'react';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { DESKTOP_WALLPAPERS } from '../../data/desktopWallpapers';
import { DESKTOP_ACCENTS } from '../../data/desktopAccents';

const ALL_WIDGETS: { id: string; label: string }[] = [
  { id: 'clock', label: 'Clock & Shift' },
  { id: 'ops-summary', label: 'Live Ops Summary' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'quick-access', label: 'Quick Access' },
  { id: 'shift-timer', label: 'Shift Timer' },
  { id: 'pinned-call-ticker', label: 'Pinned Call Ticker' },
  { id: 'mini-map', label: 'Mini Map' },
];

const ICON_SIZES: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];
const SORT_MODES: Array<'manual' | 'alpha' | 'usage'> = ['manual', 'alpha', 'usage'];
const SORT_LABELS: Record<'manual' | 'alpha' | 'usage', string> = { manual: 'Manual', alpha: 'Alphabetical', usage: 'Most Used' };

export interface DesktopWidgetSettingsPopoverProps {
  widgets: DesktopWidgetState[];
  onToggleWidget: (id: string, enabled: boolean) => void;
  iconSize: 'small' | 'medium' | 'large';
  onIconSizeChange: (size: 'small' | 'medium' | 'large') => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  sortMode: 'manual' | 'alpha' | 'usage';
  onSortModeChange: (mode: 'manual' | 'alpha' | 'usage') => void;
  onSnapToGrid: () => void;
  wallpaperId: string;
  onWallpaperChange: (id: string) => void;
  accentId: string;
  onAccentChange: (id: string) => void;
  onResetToDefault: () => void;
  onClose: () => void;
}

function sectionLabelStyle(): React.CSSProperties {
  return { color: 'var(--rmpg-400)' };
}

export default function DesktopWidgetSettingsPopover({
  widgets, onToggleWidget, iconSize, onIconSizeChange, viewMode, onViewModeChange, sortMode, onSortModeChange, onSnapToGrid,
  wallpaperId, onWallpaperChange, accentId, onAccentChange, onResetToDefault, onClose,
}: DesktopWidgetSettingsPopoverProps) {
  const enabledIds = new Set(widgets.filter(w => w.on).map(w => w.id));

  return (
    <div
      style={{ position: 'fixed', right: 16, top: 16, width: 260, maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', zIndex: 2000 }}
      className="p-2"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase" style={sectionLabelStyle()}>Desktop Settings</span>
        <button type="button" onClick={onClose} className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Close</button>
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Widgets</div>
      {ALL_WIDGETS.map(w => (
        <label key={w.id} className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={enabledIds.has(w.id)} onChange={(e) => onToggleWidget(w.id, e.target.checked)} />
          {w.label}
        </label>
      ))}

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Icon Size</div>
      <div className="flex gap-1">
        {ICON_SIZES.map(size => (
          <button
            key={size}
            type="button"
            onClick={() => onIconSizeChange(size)}
            className="text-[10px] px-2 py-0.5 capitalize"
            style={{ border: '1px solid var(--border-default)', background: iconSize === size ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
          >
            {size}
          </button>
        ))}
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>View</div>
      <div className="flex gap-1">
        {(['grid', 'list'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => onViewModeChange(mode)}
            className="text-[10px] px-2 py-0.5 capitalize"
            style={{ border: '1px solid var(--border-default)', background: viewMode === mode ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
          >
            {mode === 'grid' ? 'Grid' : 'List'}
          </button>
        ))}
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Sort</div>
      <div className="flex gap-1 flex-wrap">
        {SORT_MODES.map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => onSortModeChange(mode)}
            className="text-[10px] px-2 py-0.5"
            style={{ border: '1px solid var(--border-default)', background: sortMode === mode ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
          >
            {SORT_LABELS[mode]}
          </button>
        ))}
        <button type="button" onClick={onSnapToGrid} className="text-[10px] px-2 py-0.5" style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
          Snap to Grid
        </button>
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Wallpaper</div>
      <div className="flex gap-1.5 flex-wrap">
        {DESKTOP_WALLPAPERS.map(w => (
          <button
            key={w.id}
            type="button"
            aria-label={`Wallpaper: ${w.label}`}
            onClick={() => onWallpaperChange(w.id)}
            style={{ width: 24, height: 24, background: w.background, border: wallpaperId === w.id ? '2px solid var(--brand-400)' : '1px solid var(--border-default)' }}
          />
        ))}
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Accent Color</div>
      <div className="flex gap-1.5 flex-wrap">
        {DESKTOP_ACCENTS.map(a => (
          <button
            key={a.id}
            type="button"
            aria-label={`Accent: ${a.label}`}
            onClick={() => onAccentChange(a.id)}
            style={{ width: 20, height: 20, borderRadius: '50%', background: a.accent, border: accentId === a.id ? '2px solid var(--text-primary)' : '1px solid var(--border-default)' }}
          />
        ))}
      </div>

      <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button
          type="button"
          onClick={() => { if (window.confirm('Reset your desktop layout, widgets, wallpaper, accent, and sticky notes back to default? This cannot be undone.')) onResetToDefault(); }}
          className="text-[10px] px-2 py-1 w-full"
          style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
        >
          Reset to Default
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopWidgetSettingsPopover.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 12: Commit**

```bash
git add client/src/components/desktop/DesktopWidgetSettingsPopover.tsx client/src/components/desktop/DesktopWidgetSettingsPopover.test.tsx
git commit -m "feat(desktop): expand settings popover with icon size, sort, wallpaper, accent, reset"
```

---

### Task 12: Sticky notes

**Files:**
- Create: `client/src/hooks/useDesktopNotes.ts`
- Create: `client/src/hooks/useDesktopNotes.test.ts`
- Create: `client/src/components/desktop/DesktopStickyNote.tsx`
- Create: `client/src/components/desktop/DesktopStickyNote.test.tsx`

**Interfaces:**
- Produces (consumed by Task 15): `DesktopNote { id: string; x: number; y: number; width: number; height: number; text: string; color: string }`, `useDesktopNotes(initial: DesktopNote[]): { notes: DesktopNote[]; addNote: (x: number, y: number) => void; updateNote: (id: string, patch: Partial<DesktopNote>) => void; deleteNote: (id: string) => void }`, `DesktopStickyNote({ note, onChange, onDelete }: { note: DesktopNote; onChange: (patch: Partial<DesktopNote>) => void; onDelete: () => void })`.

- [ ] **Step 1: Write the failing test for the notes hook**

```ts
// client/src/hooks/useDesktopNotes.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDesktopNotes } from './useDesktopNotes';

describe('useDesktopNotes', () => {
  it('adds a note at the given position with default size/color/empty text', () => {
    const { result } = renderHook(() => useDesktopNotes([]));
    act(() => result.current.addNote(40, 60));
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0]).toMatchObject({ x: 40, y: 60, text: '', color: 'amber' });
  });

  it('updateNote patches only the given note', () => {
    const { result } = renderHook(() => useDesktopNotes([
      { id: 'a', x: 0, y: 0, width: 180, height: 140, text: '', color: 'amber' },
      { id: 'b', x: 10, y: 10, width: 180, height: 140, text: '', color: 'amber' },
    ]));
    act(() => result.current.updateNote('a', { text: 'Follow up on BOLO' }));
    expect(result.current.notes.find(n => n.id === 'a')?.text).toBe('Follow up on BOLO');
    expect(result.current.notes.find(n => n.id === 'b')?.text).toBe('');
  });

  it('deleteNote removes only the given note', () => {
    const { result } = renderHook(() => useDesktopNotes([
      { id: 'a', x: 0, y: 0, width: 180, height: 140, text: '', color: 'amber' },
    ]));
    act(() => result.current.deleteNote('a'));
    expect(result.current.notes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/useDesktopNotes.test.ts`
Expected: FAIL — `Cannot find module './useDesktopNotes'`

- [ ] **Step 3: Write the hook**

```ts
// client/src/hooks/useDesktopNotes.ts
import { useState, useCallback } from 'react';

export interface DesktopNote {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
}

export function useDesktopNotes(initial: DesktopNote[]) {
  const [notes, setNotes] = useState<DesktopNote[]>(initial);

  const addNote = useCallback((x: number, y: number) => {
    const note: DesktopNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      x, y, width: 180, height: 140, text: '', color: 'amber',
    };
    setNotes(prev => [...prev, note]);
  }, []);

  const updateNote = useCallback((id: string, patch: Partial<DesktopNote>) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notes, addNote, updateNote, deleteNote };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/useDesktopNotes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit the hook**

```bash
git add client/src/hooks/useDesktopNotes.ts client/src/hooks/useDesktopNotes.test.ts
git commit -m "feat(desktop): add useDesktopNotes hook"
```

- [ ] **Step 6: Write the failing test for the note component**

```tsx
// client/src/components/desktop/DesktopStickyNote.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopStickyNote from './DesktopStickyNote';
import type { DesktopNote } from '../../hooks/useDesktopNotes';

const NOTE: DesktopNote = { id: 'n1', x: 20, y: 30, width: 180, height: 140, text: 'Check plate ABC123', color: 'amber' };

describe('DesktopStickyNote', () => {
  it('renders the note text in an editable textarea', () => {
    render(<DesktopStickyNote note={NOTE} onChange={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByDisplayValue('Check plate ABC123')).toBeInTheDocument();
  });

  it('typing in the textarea calls onChange with the new text', () => {
    const onChange = vi.fn();
    render(<DesktopStickyNote note={NOTE} onChange={onChange} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('Check plate ABC123'), { target: { value: 'Updated note' } });
    expect(onChange).toHaveBeenCalledWith({ text: 'Updated note' });
  });

  it('clicking the close control calls onDelete', () => {
    const onDelete = vi.fn();
    render(<DesktopStickyNote note={NOTE} onChange={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText('Delete note'));
    expect(onDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopStickyNote.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 8: Write the component**

```tsx
// client/src/components/desktop/DesktopStickyNote.tsx
import React from 'react';
import { X } from 'lucide-react';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
import type { DesktopNote } from '../../hooks/useDesktopNotes';
import { DESKTOP_ACCENTS, getAccent } from '../../data/desktopAccents';

export interface DesktopStickyNoteProps {
  note: DesktopNote;
  onChange: (patch: Partial<DesktopNote>) => void;
  onDelete: () => void;
}

export default function DesktopStickyNote({ note, onChange, onDelete }: DesktopStickyNoteProps) {
  const { onPointerDown } = useDraggablePosition(note.x, note.y, (x, y) => onChange({ x, y }));
  const accent = getAccent(note.color === 'amber' ? 'amber' : note.color);

  return (
    <div
      style={{
        position: 'absolute', left: note.x, top: note.y, width: note.width, height: note.height,
        background: 'var(--surface-raised)', border: `1px solid ${accent.accent}`, boxShadow: `0 2px 8px ${accent.shadow}`,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div onPointerDown={onPointerDown} className="flex items-center justify-between px-1.5 py-1" style={{ cursor: 'move', borderBottom: `1px solid ${accent.accent}` }}>
        <div className="flex gap-1">
          {DESKTOP_ACCENTS.map(a => (
            <button
              key={a.id}
              type="button"
              aria-label={`Note color: ${a.label}`}
              onClick={() => onChange({ color: a.id })}
              style={{ width: 10, height: 10, borderRadius: '50%', background: a.accent, border: note.color === a.id ? '1px solid var(--text-primary)' : 'none' }}
            />
          ))}
        </div>
        <button type="button" aria-label="Delete note" onClick={onDelete}>
          <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>
      <textarea
        value={note.text}
        onChange={(e) => onChange({ text: e.target.value })}
        className="flex-1 w-full p-2 text-[11px] resize-none bg-transparent focus:outline-none"
        style={{ color: 'var(--text-primary)' }}
      />
    </div>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopStickyNote.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add client/src/components/desktop/DesktopStickyNote.tsx client/src/components/desktop/DesktopStickyNote.test.tsx
git commit -m "feat(desktop): add DesktopStickyNote component"
```

---

### Task 13: Command bar quick actions (Clock In/Out, New Call, New Incident)

**Files:**
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Create: `client/src/components/desktop/DesktopTaskbar.commandBar.test.tsx`

**Interfaces:** none new — reuses `apiFetch` (already imported by `DesktopTaskbar.tsx`) and `useNavigate` (already imported).

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/desktop/DesktopTaskbar.commandBar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetchMock = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
vi.mock('../../hooks/useClock', () => ({ useClock: () => ({ time: '12:00:00', date: 'x' }) }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigateMock }));

import DesktopTaskbar from './DesktopTaskbar';
import { DesktopWindowManagerProvider } from './DesktopWindowManager';

describe('DesktopTaskbar — command bar quick actions', () => {
  beforeEach(() => { apiFetchMock.mockReset(); navigateMock.mockReset(); });

  function openLauncher() {
    render(<MemoryRouter><DesktopWindowManagerProvider><DesktopTaskbar icons={[]} catalog={[]} /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
  }

  it('shows Clock In when off duty, and clicking it calls the clock-in endpoint', async () => {
    apiFetchMock.mockImplementation((path: string) => path === '/personnel/time/mine/active'
      ? Promise.resolve({ active: false, entry: null })
      : Promise.resolve({}));
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock In')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clock In'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/personnel/time/clock-in', expect.objectContaining({ method: 'POST' })));
  });

  it('shows Clock Out when on duty, and clicking it calls the clock-out endpoint', async () => {
    apiFetchMock.mockImplementation((path: string) => path === '/personnel/time/mine/active'
      ? Promise.resolve({ active: true, entry: { clock_in: new Date().toISOString() } })
      : Promise.resolve({}));
    openLauncher();
    await waitFor(() => expect(screen.getByText('Clock Out')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clock Out'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/personnel/time/clock-out', expect.objectContaining({ method: 'POST' })));
  });

  it('New Call navigates to /dispatch?newCall=1, New Incident to /incidents?newIncident=1', async () => {
    apiFetchMock.mockResolvedValue({ active: false, entry: null });
    openLauncher();
    await waitFor(() => expect(screen.getByText('New Call')).toBeInTheDocument());
    fireEvent.click(screen.getByText('New Call'));
    expect(navigateMock).toHaveBeenCalledWith('/dispatch?newCall=1');
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.click(screen.getByText('New Incident'));
    expect(navigateMock).toHaveBeenCalledWith('/incidents?newIncident=1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.commandBar.test.tsx`
Expected: FAIL — no quick actions exist in the launcher yet.

- [ ] **Step 3: Add quick actions to `DesktopTaskbar.tsx`**

Use the Edit tool, old_string (the officer-id lookup needs `useAuth` — not currently imported — and a small effect to know clock state):
```
import React, { useState, useMemo } from 'react';
import { Grid3X3, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDesktopWindows } from './DesktopWindowManager';
import { useClock } from '../../hooks/useClock';
import type { NavFunction } from '../../data/navCatalog';
import { apiFetch } from '../../hooks/useApi';
```

new_string:
```
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Grid3X3, Bell, Clock as ClockIcon, Radio, FileWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDesktopWindows } from './DesktopWindowManager';
import { useClock } from '../../hooks/useClock';
import { useAuth } from '../../context/AuthContext';
import type { NavFunction } from '../../data/navCatalog';
import { apiFetch } from '../../hooks/useApi';
```

Then, inside the component body (after the existing `unreadCount` effect), add:

old_string:
```
  const searchResults = useMemo(() => {
```

new_string:
```
  const { user } = useAuth();
  const [onDuty, setOnDuty] = useState<boolean | null>(null);
  const [clockBusy, setClockBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ active: boolean }>('/personnel/time/mine/active')
      .then(res => { if (!cancelled) setOnDuty(res.active); })
      .catch(() => { if (!cancelled) setOnDuty(false); });
    return () => { cancelled = true; };
  }, [launcherOpen]);

  const handleClockToggle = useCallback(async () => {
    if (!user?.id || clockBusy) return;
    setClockBusy(true);
    try {
      await apiFetch(onDuty ? '/personnel/time/clock-out' : '/personnel/time/clock-in', {
        method: 'POST',
        body: JSON.stringify({ officer_id: user.id }),
      });
      setOnDuty(v => !v);
    } catch { /* toast handled by apiFetch's shared error interceptor */ }
    setClockBusy(false);
    setLauncherOpen(false);
  }, [onDuty, clockBusy, user]);

  const quickActions = useMemo(() => ([
    { key: 'clock', label: onDuty ? 'Clock Out' : 'Clock In', icon: ClockIcon, onClick: handleClockToggle },
    { key: 'new-call', label: 'New Call', icon: Radio, onClick: () => { navigate('/dispatch?newCall=1'); setLauncherOpen(false); } },
    { key: 'new-incident', label: 'New Incident', icon: FileWarning, onClick: () => { navigate('/incidents?newIncident=1'); setLauncherOpen(false); } },
  ]), [onDuty, handleClockToggle, navigate]);

  const searchResults = useMemo(() => {
```

Finally, render the quick actions above the fuzzy search results — old_string:
```
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules…"
              className="w-full px-2 py-1.5 text-[11px] bg-surface-sunken border-b border-rmpg-700 text-rmpg-100 focus:outline-none"
            />
            {searchResults.slice(0, 20).map(fn => (
```

new_string:
```
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules…"
              className="w-full px-2 py-1.5 text-[11px] bg-surface-sunken border-b border-rmpg-700 text-rmpg-100 focus:outline-none"
            />
            {!query.trim() && (
              <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {quickActions.map(action => (
                  <button
                    key={action.key}
                    type="button"
                    onClick={action.onClick}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-surface-hover"
                    style={{ color: 'var(--brand-400)' }}
                  >
                    <action.icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {action.label}
                  </button>
                ))}
              </div>
            )}
            {searchResults.slice(0, 20).map(fn => (
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.commandBar.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the existing DesktopTaskbar regression test + typecheck**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/DesktopTaskbar.commandBar.test.tsx
git commit -m "feat(desktop): add Clock In/Out, New Call, New Incident to command bar"
```

---

### Task 14: Drag a person onto the Records icon

**Files:**
- Modify: `client/src/pages/records/PersonsTab.tsx`
- Modify: `client/src/components/desktop/DesktopIconGrid.tsx`
- Modify: `client/src/pages/RecordsPage.tsx`
- Create: `client/src/components/desktop/DesktopIconGrid.dragDrop.test.tsx`

**Interfaces:** none new — a `dataTransfer` payload `{type:'person', id, name}` and a `?personId=` query param convention on `/records`, mirroring `newCall`/`newIncident`.

- [ ] **Step 1: Read the exact current row markup to confirm the anchor for the edit**

Run: `sed -n '710,740p' client/src/pages/records/PersonsTab.tsx`
Confirm the outer row element is a `<div role="listitem" ...>` around line 718, as established in the source of this plan's research — if the exact text differs from Step 2's `old_string`, adjust the `old_string` to match what this command actually prints before applying the edit.

- [ ] **Step 2: Add `draggable` to the person row**

Use the Edit tool on `client/src/pages/records/PersonsTab.tsx`. old_string (the opening tag of the person-row `<div>`, confirmed to start with `role="listitem"` and end its own-attribute list at `aria-selected={selectedPerson?.id === person.id}`):
```
    role="listitem"
    tabIndex={0}
```

new_string:
```
    role="listitem"
    tabIndex={0}
    draggable
    onDragStart={(e) => {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'person', id: person.id, name: `${person.first_name} ${person.last_name}` }));
      e.dataTransfer.effectAllowed = 'copy';
    }}
```

- [ ] **Step 3: Write the failing test for the Records icon drop target**

```tsx
// client/src/components/desktop/DesktopIconGrid.dragDrop.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Database } from 'lucide-react';
import DesktopIconGrid from './DesktopIconGrid';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import type { NavFunction } from '../../data/navCatalog';

const RECORDS_ICON: NavFunction[] = [
  { path: '/records', label: 'Records', icon: Database, description: 'r' },
];

function Harness() {
  const { windows } = useDesktopWindows();
  return (
    <>
      <DesktopIconGrid
        icons={RECORDS_ICON} positions={{ '/records': { x: 20, y: 20 } }}
        onReposition={vi.fn()} onUnpin={vi.fn()} groups={[]} onCreateGroup={vi.fn()} onUngroup={vi.fn()}
        iconSize="medium" viewMode="grid"
      />
      <ul>{windows.map(w => <li key={w.id}>{w.path}</li>)}</ul>
    </>
  );
}

function makeDataTransfer(payload: unknown) {
  return { getData: () => JSON.stringify(payload) } as unknown as DataTransfer;
}

describe('DesktopIconGrid — drag person onto Records icon', () => {
  it('dropping a person payload on the Records icon opens a window at /records?personId=<id>', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    const recordsIcon = screen.getByText('Records').closest('button')!;
    fireEvent.dragOver(recordsIcon);
    fireEvent.drop(recordsIcon, { dataTransfer: makeDataTransfer({ type: 'person', id: '42', name: 'Jane Doe' }) });
    expect(screen.getByText('/records?personId=42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.dragDrop.test.tsx`
Expected: FAIL — `DesktopIconGrid` has no `onDrop`/`onDragOver` handling yet.

- [ ] **Step 5: Add the drop handler to the Records icon in `DesktopIconGrid.tsx`**

Use the Edit tool, old_string (the icon `<button>` element from Task 5):
```
            <button
              type="button"
              onClick={(e) => handleIconClick(fn, e)}
              onPointerDown={viewMode === 'grid' ? (e) => onIconPointerDown(fn, e) : undefined}
```

new_string:
```
            <button
              type="button"
              onClick={(e) => handleIconClick(fn, e)}
              onPointerDown={viewMode === 'grid' ? (e) => onIconPointerDown(fn, e) : undefined}
              onDragOver={fn.path === '/records' ? (e) => e.preventDefault() : undefined}
              onDrop={fn.path === '/records' ? (e) => {
                e.preventDefault();
                try {
                  const payload = JSON.parse(e.dataTransfer.getData('application/json'));
                  if (payload?.type === 'person' && payload.id) {
                    openWindow(`/records?personId=${payload.id}`, 'Records');
                  }
                } catch { /* ignore malformed drag payloads */ }
              } : undefined}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.dragDrop.test.tsx`
Expected: PASS

- [ ] **Step 7: Add the `personId` query-param effect to `RecordsPage.tsx`**

Read `client/src/pages/RecordsPage.tsx`'s existing tab-mounting logic (mirrors the `?newCall=1` pattern already confirmed in `DispatchPage.tsx`) and add, alongside its other top-of-component `useSearchParams`-driven effects:

```tsx
// Auto-select a person when the desktop launcher drops one onto the Records
// icon (opens /records?personId=<id>) — mirrors the ?newCall=1/?newIncident=1
// convention already used by DispatchPage/IncidentsPage. A stale/unknown id
// falls through to the normal unfiltered view rather than erroring.
useEffect(() => {
  const personId = searchParams.get('personId');
  if (personId) {
    setActiveTab('persons');
    // PersonsTabList resolves the id against its own loaded rows; if it's
    // stale/unknown, the list simply shows its default unfiltered state.
    setPendingPersonId(personId);
    const next = new URLSearchParams(searchParams);
    next.delete('personId');
    setSearchParams(next, { replace: true });
  }
}, []);
```

(`setPendingPersonId` is a new small piece of state threaded to `PersonsTabList` as a prop it uses once, on the row list finishing its own load, to call the same `setSelectedPerson` it already uses on row click — implementers should locate `PersonsTabList`'s existing `selectedPerson`/`setSelectedPerson` wiring in `PersonsTab.tsx` and pass `pendingPersonId` through the same prop channel already used for `state={personsState}`, matching the file's existing prop-drilling style rather than introducing a new context.)

- [ ] **Step 8: Run the client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/records/PersonsTab.tsx client/src/components/desktop/DesktopIconGrid.tsx client/src/pages/RecordsPage.tsx client/src/components/desktop/DesktopIconGrid.dragDrop.test.tsx
git commit -m "feat(desktop): drag a person record onto the Records icon to open their file"
```

---

### Task 15: `DesktopPage.tsx` — full v2 wiring

**Files:**
- Modify: `client/src/pages/DesktopPage.tsx`
- Modify: `client/src/pages/DesktopPage.test.tsx`

**Interfaces:** none new — this task is pure integration, wiring every Task 1–13 piece into the single source of persisted desktop state.

- [ ] **Step 1: Read the current `DesktopPage.test.tsx` to confirm what the existing regression coverage asserts**

Run: `cat client/src/pages/DesktopPage.test.tsx`
(This file exists from v1; extend it in Step 4 below rather than replacing it, preserving whatever it already asserts about first-load defaults and debounced save.)

- [ ] **Step 2: Rewrite `DesktopPageInner` in `DesktopPage.tsx`**

```tsx
// client/src/pages/DesktopPage.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED, type NavFunction } from '../data/navCatalog';
import { loadFavorites, saveFavorites, loadRecent } from '../utils/navFavorites';
import { useUserPreferences, type UserPreferences } from '../context/UserPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { DEFAULT_WALLPAPER_ID } from '../data/desktopWallpapers';
import { DEFAULT_ACCENT_ID, getAccent } from '../data/desktopAccents';
import { normalizeDesktopLayout, serializeDesktopLayout, type DesktopGroup } from '../utils/normalizeDesktopLayout';
import { normalizeDesktopWidgets, serializeDesktopWidgets } from '../utils/normalizeDesktopWidgets';
import { sortIconPositions, snapToGrid } from '../utils/desktopLayoutOps';
import DesktopWallpaper from '../components/desktop/DesktopWallpaper';
import { DesktopWindowManagerProvider, useDesktopWindows } from '../components/desktop/DesktopWindowManager';
import FloatingWindow from '../components/desktop/FloatingWindow';
import DesktopIconGrid from '../components/desktop/DesktopIconGrid';
import DesktopTaskbar from '../components/desktop/DesktopTaskbar';
import DesktopWidgetPanel from '../components/desktop/DesktopWidgetPanel';
import DesktopWidgetSettingsPopover from '../components/desktop/DesktopWidgetSettingsPopover';
import DesktopStickyNote from '../components/desktop/DesktopStickyNote';
import { useDesktopNotes } from '../hooks/useDesktopNotes';
import ContextMenu from '../components/ContextMenu';

const GRID_COLS = 6;
const CELL_W = 96;
const CELL_H = 96;

function autoLayoutIcons(paths: string[]): { path: string; x: number; y: number }[] {
  return paths.map((path, i) => ({ path, x: (i % GRID_COLS) * CELL_W + 20, y: Math.floor(i / GRID_COLS) * CELL_H + 20 }));
}

function WindowLayer() {
  const { windows } = useDesktopWindows();
  return <>{windows.map(w => <FloatingWindow key={w.id} win={w} />)}</>;
}

function DesktopPageInner({ prefs, reload }: { prefs: UserPreferences; reload: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isClientViewer = user?.role === 'client_viewer';
  const isContractManager = user?.role === 'contract_manager';

  const allFunctions = useMemo(() => {
    return NAV_CATEGORIES.flatMap(cat => cat.functions).filter(fn => {
      if (fn.adminOnly && !isAdmin) return false;
      if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(fn.path)) return false;
      if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(fn.path)) return false;
      return true;
    });
  }, [isAdmin, isClientViewer, isContractManager]);

  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const pinnedIcons: NavFunction[] = useMemo(
    () => allFunctions.filter(fn => favorites.has(fn.path)),
    [allFunctions, favorites],
  );

  const [layout, setLayout] = useState(() => {
    const normalized = normalizeDesktopLayout(prefs.desktop_layout_json);
    if (normalized.icons.length === 0 && favorites.size > 0) {
      return { ...normalized, icons: autoLayoutIcons([...favorites]) };
    }
    return normalized;
  });
  const positions = useMemo(
    () => Object.fromEntries(layout.icons.map(p => [p.path, { x: p.x, y: p.y }])),
    [layout.icons],
  );

  const [wallpaperId, setWallpaperId] = useState<string>(prefs.desktop_wallpaper || DEFAULT_WALLPAPER_ID);
  const [accentId, setAccentId] = useState<string>(prefs.desktop_accent || DEFAULT_ACCENT_ID);
  const [widgets, setWidgets] = useState(() => normalizeDesktopWidgets(prefs.desktop_widgets_json));
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);
  const { notes, addNote, updateNote, deleteNote } = useDesktopNotes(() => {
    try { return prefs.desktop_notes_json ? JSON.parse(prefs.desktop_notes_json) : []; } catch { return []; }
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiFetch('/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          desktop_layout_json: serializeDesktopLayout(layout),
          desktop_wallpaper: wallpaperId,
          desktop_widgets_json: serializeDesktopWidgets(widgets),
          desktop_accent: accentId,
          desktop_notes_json: JSON.stringify(notes),
        }),
      }).then(() => reload()).catch(() => { /* non-blocking — retried on next change */ });
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, wallpaperId, widgets, accentId, notes]);

  const handleReposition = useCallback((path: string, x: number, y: number) => {
    setLayout(prev => ({ ...prev, icons: prev.icons.map(p => p.path === path ? { ...p, x, y } : p) }));
  }, []);

  const handleUnpin = useCallback((path: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      next.delete(path);
      saveFavorites(next);
      return next;
    });
    setLayout(prev => ({ ...prev, icons: prev.icons.filter(p => p.path !== path) }));
  }, []);

  const handleCreateGroup = useCallback((memberPaths: string[], label: string) => {
    setLayout(prev => {
      const members = prev.icons.filter(p => memberPaths.includes(p.path));
      if (members.length === 0) return prev;
      const minX = Math.min(...members.map(m => m.x)) - 12;
      const minY = Math.min(...members.map(m => m.y)) - 30;
      const maxX = Math.max(...members.map(m => m.x)) + 88;
      const maxY = Math.max(...members.map(m => m.y)) + 100;
      const group: DesktopGroup = { id: `group_${Date.now()}`, label, x: minX, y: minY, w: maxX - minX, h: maxY - minY, memberPaths };
      return { ...prev, groups: [...prev.groups, group] };
    });
  }, []);

  const handleUngroup = useCallback((groupId: string) => {
    setLayout(prev => ({ ...prev, groups: prev.groups.filter(g => g.id !== groupId) }));
  }, []);

  const handleIconSizeChange = useCallback((iconSize: 'small' | 'medium' | 'large') => {
    setLayout(prev => ({ ...prev, iconSize }));
  }, []);

  const handleViewModeChange = useCallback((viewMode: 'grid' | 'list') => {
    setLayout(prev => ({ ...prev, viewMode }));
  }, []);

  const handleSortModeChange = useCallback((sortMode: 'manual' | 'alpha' | 'usage') => {
    setLayout(prev => {
      if (sortMode === 'manual') return { ...prev, sortMode };
      const sorted = sortIconPositions(pinnedIcons, sortMode, loadRecent());
      return { ...prev, sortMode, icons: prev.icons.map(p => ({ ...p, ...(sorted[p.path] ?? {}) })) };
    });
  }, [pinnedIcons]);

  const handleSnapToGrid = useCallback(() => {
    setLayout(prev => {
      const snapped = snapToGrid(Object.fromEntries(prev.icons.map(p => [p.path, { x: p.x, y: p.y }])));
      return { ...prev, icons: prev.icons.map(p => ({ ...p, ...snapped[p.path] })) };
    });
  }, []);

  const handleToggleWidget = useCallback((id: string, enabled: boolean) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, on: enabled } : w));
  }, []);

  const handleMoveWidget = useCallback((id: string, x: number, y: number) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, x, y } : w));
  }, []);

  const handleAdjustWidget = useCallback((id: string, patch: { opacity?: number; blur?: number }) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  }, []);

  const handleResetToDefault = useCallback(() => {
    setLayout({ ...normalizeDesktopLayout(null), icons: autoLayoutIcons([...favorites]) });
    setWallpaperId(DEFAULT_WALLPAPER_ID);
    setAccentId(DEFAULT_ACCENT_ID);
    setWidgets(normalizeDesktopWidgets(null));
  }, [favorites]);

  const accentStyle = useMemo(() => {
    const accent = getAccent(accentId);
    return { '--desktop-shell-accent': accent.accent, '--desktop-shell-accent-shadow': accent.shadow } as React.CSSProperties;
  }, [accentId]);

  return (
    <DesktopWindowManagerProvider>
      <ContextMenu
        items={[
          { label: 'Widget settings', onClick: () => setWidgetSettingsOpen(true) },
          { label: 'New sticky note', onClick: () => addNote(60, 60) },
        ]}
      >
        <div style={{ ...accentStyle, position: 'relative', width: '100%', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
          <DesktopWallpaper wallpaperId={wallpaperId}>
            {pinnedIcons.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--text-muted)' }}>
                No modules pinned yet — star modules from Module Directory, or right-click here to get started.
              </div>
            ) : (
              <DesktopIconGrid
                icons={pinnedIcons} positions={positions} onReposition={handleReposition} onUnpin={handleUnpin}
                groups={layout.groups} onCreateGroup={handleCreateGroup} onUngroup={handleUngroup}
                iconSize={layout.iconSize} viewMode={layout.viewMode}
              />
            )}
            {notes.map(note => (
              <DesktopStickyNote key={note.id} note={note} onChange={(patch) => updateNote(note.id, patch)} onDelete={() => deleteNote(note.id)} />
            ))}
            <DesktopWidgetPanel widgets={widgets} catalog={allFunctions} onMoveWidget={handleMoveWidget} onAdjustWidget={handleAdjustWidget} />
            <WindowLayer />
          </DesktopWallpaper>
        </div>
      </ContextMenu>
      <DesktopTaskbar icons={pinnedIcons} catalog={allFunctions} />
      {widgetSettingsOpen && (
        <DesktopWidgetSettingsPopover
          widgets={widgets} onToggleWidget={handleToggleWidget}
          iconSize={layout.iconSize} onIconSizeChange={handleIconSizeChange}
          viewMode={layout.viewMode} onViewModeChange={handleViewModeChange}
          sortMode={layout.sortMode} onSortModeChange={handleSortModeChange} onSnapToGrid={handleSnapToGrid}
          wallpaperId={wallpaperId} onWallpaperChange={setWallpaperId}
          accentId={accentId} onAccentChange={setAccentId}
          onResetToDefault={handleResetToDefault}
          onClose={() => setWidgetSettingsOpen(false)}
        />
      )}
    </DesktopWindowManagerProvider>
  );
}

export default function DesktopPage() {
  const { prefs, reload, isLoading } = useUserPreferences();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading" />
      </div>
    );
  }

  return <DesktopPageInner prefs={prefs} reload={reload} />;
}
```

- [ ] **Step 3: Run the client typecheck across the whole desktop subsystem**

Run: `cd client && npx tsc --noEmit`
Expected: PASS — every prop shape this file now passes (`groups`, `onCreateGroup`, `onUngroup`, `iconSize`, `viewMode` to `DesktopIconGrid`; `widgets`, `onMoveWidget` to `DesktopWidgetPanel`; the full new prop set to `DesktopWidgetSettingsPopover`) matches what Tasks 4/5/10/11 produced.

- [ ] **Step 4: Extend `DesktopPage.test.tsx` for the new v2 state**

Add these cases to the existing `client/src/pages/DesktopPage.test.tsx` (keep its current v1 assertions intact):

```tsx
it('opens the settings popover with icon size, sort, wallpaper, accent, and reset controls', () => {
  // ...render DesktopPage per this file's existing setup, then:
  fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
  fireEvent.click(screen.getByText('Widget settings'));
  expect(screen.getByText('Icon Size')).toBeInTheDocument();
  expect(screen.getByText('Reset to Default')).toBeInTheDocument();
});

it('right-click "New sticky note" adds a note to the canvas', () => {
  fireEvent.contextMenu(screen.getByText(/No modules pinned yet/i));
  fireEvent.click(screen.getByText('New sticky note'));
  expect(screen.getByLabelText('Delete note')).toBeInTheDocument();
});
```

(Match these to whatever render/setup helper the existing v1 `DesktopPage.test.tsx` already uses — it already mocks `useUserPreferences`/`useAuth`/`apiFetch` per v1's Task 11, so no new mocks should be needed.)

- [ ] **Step 5: Run the full DesktopPage test file**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: PASS (all v1 cases + the 2 new ones)

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DesktopPage.tsx client/src/pages/DesktopPage.test.tsx
git commit -m "feat(desktop): wire v2 layout/widgets/accent/notes state into DesktopPage"
```

---

### Task 16: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS — every test file touched or added in Tasks 1–15, plus no regressions elsewhere.

- [ ] **Step 2: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Full client build**

Run: `cd client && npx vite build`
Expected: PASS — confirms no build-time issues (e.g. circular imports between `normalizeDesktopLayout.ts`/`DesktopIconGrid.tsx`/`DesktopPage.tsx`).

- [ ] **Step 4: Worker typecheck + full Worker test suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 5: Worker route smoke tests (Miniflare)**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: PASS — includes the extended `test-workers/desktopPreferences.test.ts` from Task 3.

- [ ] **Step 6: Manual dev-server verification**

Start the client dev server and the Worker dev server (`npm run dev` at repo root, `cd client && npm run dev` in another terminal), open `/desktop` in a browser, and walk through:
- Ctrl-click 2+ icons, right-click → "Group as..." → confirm the labeled region appears; right-click the region → "Ungroup" → confirm it disappears without moving the icons.
- Toggle icon size (small/medium/large) and list view via the settings popover.
- Switch sort mode to Alphabetical, then Most Used; click "Snap to Grid" after manually dragging an icon off-grid.
- Enable each of the 3 new widgets (Shift Timer, Pinned Call Ticker, Mini Map) from the settings popover; drag each by its own area to a new position; confirm the position persists across a page reload.
- Right-click a widget and use "Increase opacity" / "Decrease opacity" / "Toggle blur"; confirm the widget visibly dims/blurs and the change persists across a page reload.
- Pick a non-default accent color and wallpaper; confirm only the desktop shell chrome recolors, not the app-wide theme (navigate to another page and back — Blue & Silver elsewhere should be unaffected).
- Right-click empty canvas → "New sticky note"; type text; drag it; change its color swatch; delete it.
- Open the command bar (⌘K/Ctrl+K): confirm Clock In/Out toggles and hits the right endpoint (check Network tab), New Call opens the Dispatch new-call modal, New Incident opens the Incidents new-incident modal.
- In Records → Persons, drag a person row onto the desktop's Records icon; confirm a `FloatingWindow` opens at `/records?personId=<id>` with that person auto-selected.
- Click "Reset to Default" in the settings popover; confirm the confirmation dialog appears and, on confirm, layout/widgets/wallpaper/accent/notes all revert.

Expected: every interaction above works as described, with no console errors (`read_console_messages` / browser devtools) and no failed network requests other than expected 404s from stale test data.

- [ ] **Step 7: Post-merge — apply the migration to live D1**

Run: `scripts/apply-migration.sh 0194_desktop_v2.sql`
Then verify: `wrangler d1 execute rmpg-flex --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_preferences'"` and confirm `desktop_accent`/`desktop_notes_json` are present.
