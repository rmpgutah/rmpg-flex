# Desktop & Icons Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add right-click Sort/View/Icon-size/Auto-arrange/Show-Hide shortcuts on the empty desktop, a persistent auto-arrange mode, per-icon rename, and a show/hide-desktop-icons toggle to the `/desktop` system.

**Architecture:** A new `desktopIconPreferences.ts` localStorage layer (mirroring `snapPreference.ts`) backs three independent preferences (label overrides, auto-arrange, icons-hidden). `DesktopPage.tsx`'s existing empty-desktop `ContextMenu` gains new items wired to existing handlers (`handleSortModeChange`, `handleViewModeChange`, `handleIconSizeChange`) plus two new toggles. A new `nextAutoArrangeSlot` helper in `desktopLayoutOps.ts`, combined with a new reconciliation `useEffect` in `DesktopPage.tsx`, fixes the previously-missing position-assignment for newly-pinned icons. `DesktopIconGrid.tsx` gains an inline-edit "Rename" flow reading/writing label overrides.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, existing `ContextMenu.tsx` component.

## Global Constraints

- All new preferences are `localStorage` (device-scoped), never D1/API — no new migration, no new column, and specifically NOT added to `DesktopLayout`/`desktop_layout_json` (the D1-synced layout state in `normalizeDesktopLayout.ts`).
- All new chrome uses the project's CSS-variable-backed Tailwind tokens (`var(--surface-raised)`, `var(--brand-400)`, `var(--rmpg-400)`, etc.) — never hardcoded hex.
- No new D1 migrations in this build.
- Rename overrides only affect the desktop icon grid's rendered label — Module Directory, the taskbar, and the nav catalog itself must keep showing the canonical `NavFunction.label`.
- Auto-arrange only governs where *newly appearing* icons land — it must never retroactively move an already-placed icon.

---

### Task 1: `desktopIconPreferences.ts` data layer

**Files:**
- Create: `client/src/utils/desktopIconPreferences.ts`
- Test: `client/src/utils/desktopIconPreferences.test.ts`

**Interfaces:**
- Produces: `getIconLabelOverride(path: string): string | null`, `setIconLabelOverride(path: string, label: string): void`, `clearIconLabelOverride(path: string): void`, `isAutoArrangeEnabled(): boolean`, `setAutoArrangeEnabled(enabled: boolean): void`, `areIconsHidden(): boolean`, `setIconsHidden(hidden: boolean): void` — every later task consumes these exact names.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/utils/desktopIconPreferences.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIconLabelOverride, setIconLabelOverride, clearIconLabelOverride,
  isAutoArrangeEnabled, setAutoArrangeEnabled,
  areIconsHidden, setIconsHidden,
} from './desktopIconPreferences';

describe('desktopIconPreferences — label overrides', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to no override for any path', () => {
    expect(getIconLabelOverride('/dispatch')).toBeNull();
  });

  it('setIconLabelOverride persists and getIconLabelOverride reflects it', () => {
    setIconLabelOverride('/dispatch', 'Radio Ops');
    expect(getIconLabelOverride('/dispatch')).toBe('Radio Ops');
  });

  it('overrides for different paths do not collide', () => {
    setIconLabelOverride('/dispatch', 'Radio Ops');
    setIconLabelOverride('/map', 'Live Tracker');
    expect(getIconLabelOverride('/dispatch')).toBe('Radio Ops');
    expect(getIconLabelOverride('/map')).toBe('Live Tracker');
  });

  it('clearIconLabelOverride reverts a path to no override', () => {
    setIconLabelOverride('/dispatch', 'Radio Ops');
    clearIconLabelOverride('/dispatch');
    expect(getIconLabelOverride('/dispatch')).toBeNull();
  });

  it('clearing a path that was never overridden is a silent no-op', () => {
    clearIconLabelOverride('/never-set');
    expect(getIconLabelOverride('/never-set')).toBeNull();
  });
});

describe('desktopIconPreferences — auto-arrange', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to disabled', () => {
    expect(isAutoArrangeEnabled()).toBe(false);
  });

  it('setAutoArrangeEnabled(true) persists and isAutoArrangeEnabled reflects it', () => {
    setAutoArrangeEnabled(true);
    expect(isAutoArrangeEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_auto_arrange')).toBe('1');
  });

  it('setAutoArrangeEnabled(false) persists and isAutoArrangeEnabled reflects it', () => {
    setAutoArrangeEnabled(true);
    setAutoArrangeEnabled(false);
    expect(isAutoArrangeEnabled()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_auto_arrange')).toBe('0');
  });
});

describe('desktopIconPreferences — icons hidden', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to shown (not hidden)', () => {
    expect(areIconsHidden()).toBe(false);
  });

  it('setIconsHidden(true) persists and areIconsHidden reflects it', () => {
    setIconsHidden(true);
    expect(areIconsHidden()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_icons_hidden')).toBe('1');
  });

  it('setIconsHidden(false) persists and areIconsHidden reflects it', () => {
    setIconsHidden(true);
    setIconsHidden(false);
    expect(areIconsHidden()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_icons_hidden')).toBe('0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/utils/desktopIconPreferences.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/desktopIconPreferences.ts
const LABEL_OVERRIDES_KEY = 'rmpg_desktop_icon_label_overrides';
const AUTO_ARRANGE_KEY = 'rmpg_desktop_auto_arrange';
const ICONS_HIDDEN_KEY = 'rmpg_desktop_icons_hidden';

function readLabelOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LABEL_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLabelOverrides(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(LABEL_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch { /* silent — sessionless devices just always see the default */ }
}

export function getIconLabelOverride(path: string): string | null {
  return readLabelOverrides()[path] ?? null;
}

export function setIconLabelOverride(path: string, label: string): void {
  const overrides = readLabelOverrides();
  overrides[path] = label;
  writeLabelOverrides(overrides);
}

export function clearIconLabelOverride(path: string): void {
  const overrides = readLabelOverrides();
  if (!(path in overrides)) return;
  delete overrides[path];
  writeLabelOverrides(overrides);
}

export function isAutoArrangeEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_ARRANGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoArrangeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_ARRANGE_KEY, enabled ? '1' : '0');
  } catch { /* silent */ }
}

export function areIconsHidden(): boolean {
  try {
    return localStorage.getItem(ICONS_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setIconsHidden(hidden: boolean): void {
  try {
    localStorage.setItem(ICONS_HIDDEN_KEY, hidden ? '1' : '0');
  } catch { /* silent */ }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/desktopIconPreferences.test.ts`
Expected: PASS, all 12 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/desktopIconPreferences.ts client/src/utils/desktopIconPreferences.test.ts
git commit -m "desktop: add desktopIconPreferences.ts (label overrides, auto-arrange, icons-hidden)"
```

---

### Task 2: `nextAutoArrangeSlot` grid-gap-filling helper

**Files:**
- Modify: `client/src/utils/desktopLayoutOps.ts`
- Test: `client/src/utils/desktopLayoutOps.test.ts` (create if it doesn't already exist — check first; if it exists, append to it)

**Interfaces:**
- Produces: `nextAutoArrangeSlot(occupied: Record<string, {x:number;y:number}>): {x:number;y:number}` — Task 6 (the `DesktopPage.tsx` reconciliation effect) consumes this exact signature.

- [ ] **Step 1: Write the failing tests**

First check whether `client/src/utils/desktopLayoutOps.test.ts` already exists (it likely does, covering `sortIconPositions`/`snapToGrid`). If it exists, append the following `describe` block preserving its existing imports/tests; if it doesn't exist, create it with these imports plus the block below:

```ts
import { describe, it, expect } from 'vitest';
import { nextAutoArrangeSlot } from './desktopLayoutOps';

describe('nextAutoArrangeSlot', () => {
  it('returns the first grid cell (20, 20) when nothing is occupied', () => {
    expect(nextAutoArrangeSlot({})).toEqual({ x: 20, y: 20 });
  });

  it('returns the next cell in row order when cells are occupied contiguously from the start', () => {
    const occupied = { a: { x: 20, y: 20 }, b: { x: 116, y: 20 } };
    expect(nextAutoArrangeSlot(occupied)).toEqual({ x: 212, y: 20 });
  });

  it('fills a gap left by a removed icon rather than appending after the last occupied cell', () => {
    // Cells 0 and 2 occupied (cell 1, at x=116,y=20, is a gap from an unpinned icon).
    const occupied = { a: { x: 20, y: 20 }, c: { x: 212, y: 20 } };
    expect(nextAutoArrangeSlot(occupied)).toEqual({ x: 116, y: 20 });
  });

  it('wraps to the next row after filling 6 columns (GRID_COLS)', () => {
    const occupied: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i < 6; i++) occupied[`p${i}`] = { x: (i % 6) * 96 + 20, y: Math.floor(i / 6) * 96 + 20 };
    expect(nextAutoArrangeSlot(occupied)).toEqual({ x: 20, y: 116 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/desktopLayoutOps.test.ts`
Expected: FAIL — `nextAutoArrangeSlot` is not exported.

- [ ] **Step 3: Implement**

In `client/src/utils/desktopLayoutOps.ts`, add this function (it reuses the file's existing `GRID_COLS`/`CELL_W`/`CELL_H` constants and the same `+20` origin offset as `gridLayout`):

```ts
export function nextAutoArrangeSlot(
  occupied: Record<string, { x: number; y: number }>,
): { x: number; y: number } {
  const taken = new Set(Object.values(occupied).map(pos => `${pos.x},${pos.y}`));
  for (let i = 0; ; i++) {
    const x = (i % GRID_COLS) * CELL_W + 20;
    const y = Math.floor(i / GRID_COLS) * CELL_H + 20;
    if (!taken.has(`${x},${y}`)) return { x, y };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/desktopLayoutOps.test.ts`
Expected: PASS, all tests (new + any pre-existing `sortIconPositions`/`snapToGrid` tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/desktopLayoutOps.ts client/src/utils/desktopLayoutOps.test.ts
git commit -m "desktop: add nextAutoArrangeSlot grid-gap-filling helper"
```

---

### Task 3: Right-click Sort/View/Icon-size shortcuts on the empty desktop

**Files:**
- Modify: `client/src/pages/DesktopPage.tsx`
- Test: `client/src/pages/DesktopPage.test.tsx`

**Interfaces:**
- Consumes: the existing `handleSortModeChange`, `handleViewModeChange`, `handleIconSizeChange` callbacks already defined in `DesktopPageInner`.

- [ ] **Step 1: Write the failing test**

Read the current full content of `client/src/pages/DesktopPage.test.tsx` first to match its exact mocks/harness (it mocks `useApi`, `UserPreferencesContext`, `AuthContext`, `ToastProvider` — reuse these, don't re-mock). Append:

```tsx
describe('DesktopPage — empty-desktop right-click shortcuts', () => {
  it('offers Sort/View/Icon-size items and each calls the matching handler', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument());
    const desktopSurface = screen.getByLabelText('Open app launcher').closest('div')!.parentElement!.parentElement!;
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Sort: Alphabetical')).toBeInTheDocument();
    expect(screen.getByText('View: List')).toBeInTheDocument();
    expect(screen.getByText('Icon size: Large')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sort: Alphabetical'));
    // Re-open to check View next (ContextMenu closes itself after a click).
    fireEvent.contextMenu(desktopSurface);
    fireEvent.click(screen.getByText('View: List'));
  });
});
```

**Note for the implementer:** the exact element to right-click for the empty-desktop `ContextMenu` needs to be located by reading the current `DesktopPage.tsx` render tree — the `ContextMenu` wraps the outer `<div style={{ position: 'relative', ... }}>` containing `DesktopWallpaper`. Adjust the test's element-selection line to whatever concretely reaches that wrapped div (e.g. giving that div a `data-testid="desktop-surface"` if no more direct selector exists is an acceptable, minimal, additive change — but prefer an existing selector path if one already works cleanly).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: FAIL — "Sort: Alphabetical" etc. not found (menu currently only has Settings/New sticky note).

- [ ] **Step 3: Implement**

In `client/src/pages/DesktopPage.tsx`, locate the `<ContextMenu items={[...]}>` block (currently `{ label: 'Settings', ... }, { label: 'New sticky note', ... }`) and prepend new items, keeping the existing two at the end:

```tsx
<ContextMenu
  items={[
    { label: 'Sort: Manual', onClick: () => handleSortModeChange('manual') },
    { label: 'Sort: Alphabetical', onClick: () => handleSortModeChange('alpha') },
    { label: 'Sort: Most Used', onClick: () => handleSortModeChange('usage') },
    { label: 'View: Grid', onClick: () => handleViewModeChange('grid') },
    { label: 'View: List', onClick: () => handleViewModeChange('list') },
    { label: 'Icon size: Small', onClick: () => handleIconSizeChange('small') },
    { label: 'Icon size: Medium', onClick: () => handleIconSizeChange('medium') },
    { label: 'Icon size: Large', onClick: () => handleIconSizeChange('large') },
    { label: 'Settings', onClick: () => setWidgetSettingsOpen(true), divider: true },
    { label: 'New sticky note', onClick: () => addNote(60, 60) },
  ]}
>
```

(the `divider: true` on the `Settings` item renders a divider immediately above it, per `ContextMenu.tsx`'s existing `item.divider` rendering — confirm this matches the component's actual divider semantics by reading `ContextMenu.tsx` before finalizing; if `divider` renders as a separate line item rather than a border-above-this-item flag, insert an explicit divider entry instead, matching whatever `ContextMenu.tsx` actually expects.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: PASS, all tests in the file including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DesktopPage.tsx client/src/pages/DesktopPage.test.tsx
git commit -m "desktop: add Sort/View/Icon-size shortcuts to the empty-desktop right-click menu"
```

---

### Task 4: Auto-arrange toggle + Show/Hide icons toggle (menu items only)

**Files:**
- Modify: `client/src/pages/DesktopPage.tsx`
- Test: `client/src/pages/DesktopPage.test.tsx`

**Interfaces:**
- Consumes: `isAutoArrangeEnabled`, `setAutoArrangeEnabled`, `areIconsHidden`, `setIconsHidden` from `../utils/desktopIconPreferences` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `client/src/pages/DesktopPage.test.tsx`:

```tsx
describe('DesktopPage — auto-arrange and show/hide icons toggles', () => {
  beforeEach(() => localStorage.clear());

  it('toggles the Auto-arrange menu label and persists via setAutoArrangeEnabled', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument());
    const desktopSurface = screen.getByTestId('desktop-surface'); // or whatever selector Task 3 established
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Auto-arrange: Off')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Auto-arrange: Off'));
    expect(isAutoArrangeEnabled()).toBe(true);
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Auto-arrange: On')).toBeInTheDocument();
  });

  it('toggles the Hide/Show icons menu label and persists via setIconsHidden', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument());
    const desktopSurface = screen.getByTestId('desktop-surface');
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Hide icons')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Hide icons'));
    expect(areIconsHidden()).toBe(true);
    fireEvent.contextMenu(desktopSurface);
    expect(screen.getByText('Show icons')).toBeInTheDocument();
  });
});
```

Add the import `import { isAutoArrangeEnabled, areIconsHidden } from '../utils/desktopIconPreferences';` to the test file (note: only the getters are needed by the test itself; the setters are exercised indirectly through the UI).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: FAIL — "Auto-arrange: Off"/"Hide icons" not found.

- [ ] **Step 3: Implement**

In `client/src/pages/DesktopPage.tsx`, add the import:

```ts
import { isAutoArrangeEnabled, setAutoArrangeEnabled, areIconsHidden, setIconsHidden, nextAutoArrangeSlot } from '../utils/desktopIconPreferences';
```

(note: `nextAutoArrangeSlot` actually lives in `../utils/desktopLayoutOps`, not `desktopIconPreferences` — import it from the correct file: `import { nextAutoArrangeSlot } from '../utils/desktopLayoutOps';`, kept as a separate import statement from the `desktopIconPreferences` one above.)

Add a `forceRerender` tick near `DesktopPageInner`'s other `useState` calls:

```ts
const [, forceRerender] = useState(0);
```

Insert two more items into the `ContextMenu`'s `items` array from Task 3, between `Icon size: Large` and the `Settings` divider item:

```tsx
{ label: isAutoArrangeEnabled() ? 'Auto-arrange: On' : 'Auto-arrange: Off', onClick: () => { setAutoArrangeEnabled(!isAutoArrangeEnabled()); forceRerender(n => n + 1); } },
{ label: areIconsHidden() ? 'Show icons' : 'Hide icons', onClick: () => { setIconsHidden(!areIconsHidden()); forceRerender(n => n + 1); } },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DesktopPage.tsx client/src/pages/DesktopPage.test.tsx
git commit -m "desktop: add Auto-arrange and Hide/Show icons toggles to the desktop right-click menu"
```

---

### Task 5: Show/Hide icons — actually hide the icon grid

**Files:**
- Modify: `client/src/pages/DesktopPage.tsx`
- Test: `client/src/pages/DesktopPage.test.tsx`

**Interfaces:**
- Consumes: `areIconsHidden` (Task 1, already imported in Task 4).

- [ ] **Step 1: Write the failing test**

Append to `client/src/pages/DesktopPage.test.tsx`:

```tsx
describe('DesktopPage — hidden icons layer', () => {
  beforeEach(() => localStorage.clear());

  it('hides the icon grid (and empty-state message) but not sticky notes when icons are hidden', async () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Dispatch Console').length).toBeGreaterThan(0));
    const desktopSurface = screen.getByTestId('desktop-surface');
    fireEvent.contextMenu(desktopSurface);
    fireEvent.click(screen.getByText('New sticky note'));
    fireEvent.contextMenu(desktopSurface);
    fireEvent.click(screen.getByText('Hide icons'));
    // The taskbar's own pinned-not-running / quick-access widget rendering of
    // "Dispatch Console" is unaffected (different code path) — this test only
    // needs to confirm the ICON GRID's own tile disappears. Query specifically
    // within the icon-grid region if a plain getAllByText would still find a
    // taskbar/widget instance after hiding (adjust the assertion to whatever
    // is concretely true once you've read the actual rendered DOM structure).
  });
});
```

**Note for the implementer:** the brief above deliberately leaves the exact assertion open — read the actual rendered output (via `screen.debug()` or by inspecting what other elements also render "Dispatch Console", e.g. the "quick-access" widget noted in `DesktopPage.test.tsx`'s existing comments) and write a precise, non-flaky assertion that specifically targets the icon-grid tile disappearing (e.g. by role/testid scoped to the grid container) while confirming a sticky note (which has no text fixture collision) still renders after adding one via the context menu.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: FAIL — icon grid still renders when icons are hidden.

- [ ] **Step 3: Implement**

In `client/src/pages/DesktopPage.tsx`, wrap the icon-grid rendering block (currently the `{pinnedIcons.length === 0 ? (...) : (<DesktopIconGrid .../>)}` conditional) in an outer check:

```tsx
{!areIconsHidden() && (
  pinnedIcons.length === 0 ? (
    <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--text-muted)' }}>
      No modules pinned yet — star modules from Module Directory, or right-click here to get started.
    </div>
  ) : (
    <DesktopIconGrid
      icons={pinnedIcons} positions={positions} onReposition={handleReposition} onUnpin={handleUnpin}
      groups={layout.groups} onCreateGroup={handleCreateGroup} onUngroup={handleUngroup}
      iconSize={layout.iconSize} viewMode={layout.viewMode}
    />
  )
)}
```

Since `areIconsHidden()` reads localStorage directly (not React state), and Task 4's toggle already bumps `forceRerender` on click, this component will correctly re-render and re-evaluate `areIconsHidden()` — no additional state is needed here.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DesktopPage.tsx client/src/pages/DesktopPage.test.tsx
git commit -m "desktop: hide the icon grid layer when icons are hidden"
```

---

### Task 6: Auto-arrange position reconciliation for newly-pinned icons

**Files:**
- Modify: `client/src/pages/DesktopPage.tsx`
- Test: `client/src/pages/DesktopPage.test.tsx`

**Interfaces:**
- Consumes: `nextAutoArrangeSlot` (Task 2), `isAutoArrangeEnabled` (Task 1).
- Produces: a `useEffect` in `DesktopPageInner` that reconciles `layout.icons` against `pinnedIcons` — this is the fix for the pre-existing gap where a favorite added after initial mount has no position and falls back to `DesktopIconGrid.tsx`'s hardcoded `{x:20,y:20}`.

- [ ] **Step 1: Write the failing test**

Append to `client/src/pages/DesktopPage.test.tsx`:

```tsx
describe('DesktopPage — auto-arrange fills gaps for newly-pinned icons', () => {
  beforeEach(() => localStorage.clear());

  it('assigns a newly-favorited path a position that does not overlap an existing icon, when auto-arrange is on', async () => {
    setAutoArrangeEnabled(true);
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Dispatch Console').length).toBeGreaterThan(0));
    // Simulate a second favorite being added after mount (e.g. from Module
    // Directory in a real session) by calling saveFavorites again and
    // forcing DesktopPage to re-read favorites — read DesktopPage.tsx's
    // actual favorites-loading mechanism (loadFavorites/setFavorites) to
    // determine the correct way to trigger this in a test; it may require
    // exposing a re-check or relying on an existing effect/interval if one
    // exists, or restructuring this test to seed BOTH favorites before
    // initial render but pre-seed `desktop_layout_json` prefs with only
    // ONE of the two paths positioned, so the second is the "newly
    // reconciled" one on this same initial render.
    setAutoArrangeEnabled(false); // cleanup for other tests
  });
});
```

**Note for the implementer:** read `DesktopPage.tsx`'s actual favorites-loading code (`loadFavorites`, the `useState<Set<string>>(loadFavorites)` initializer, and whether `favorites` ever re-reads after mount) before finalizing this test. The most reliable way to test "a pinned path lacks a position and gets reconciled" without needing to simulate a live cross-tab favorite addition is: pass `mockPrefs` (or an override of it, following this test file's existing pattern of overriding `mockUseUserPreferences.mockReturnValue(...)`) with a `desktop_layout_json` that already includes ONE positioned icon but favorites (via `saveFavorites`) containing TWO paths — so on initial render, `pinnedIcons` has 2 entries but `layout.icons` only positions 1, exercising the exact reconciliation gap this task fixes. Write the concrete test using this approach.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: FAIL — the unpositioned favorite has no reconciled position (falls back to the `{x:20,y:20}` collision in `DesktopIconGrid.tsx`, or however you've structured the assertion to detect this).

- [ ] **Step 3: Implement**

In `client/src/pages/DesktopPage.tsx`, add a `useEffect` in `DesktopPageInner`, after the existing debounced-save `useEffect`:

```ts
useEffect(() => {
  const positioned = new Set(layout.icons.map(p => p.path));
  const missing = pinnedIcons.filter(fn => !positioned.has(fn.path));
  if (missing.length === 0) return;
  setLayout(prev => {
    const existingPositions = Object.fromEntries(prev.icons.map(p => [p.path, { x: p.x, y: p.y }]));
    const additions = missing.map(fn => {
      const slot = isAutoArrangeEnabled()
        ? nextAutoArrangeSlot(existingPositions)
        : { x: 20 + prev.icons.length * 24, y: 20 + prev.icons.length * 24 };
      existingPositions[fn.path] = slot;
      return { path: fn.path, x: slot.x, y: slot.y };
    });
    return { ...prev, icons: [...prev.icons, ...additions] };
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [pinnedIcons]);
```

(The non-auto-arrange fallback branch intentionally mirrors a simple cascade rather than importing `autoLayoutIcons`'s grid math, since that function computes positions for a whole fresh list rather than appending one-at-a-time to an existing partially-positioned list — a full cascade re-derivation is out of scope for this task, which only needs to guarantee *some* non-overlapping-with-itself position per newly-added icon when auto-arrange is off, not perfect cascade continuity.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DesktopPage.tsx client/src/pages/DesktopPage.test.tsx
git commit -m "desktop: reconcile positions for newly-pinned icons, using auto-arrange gap-filling when enabled"
```

---

### Task 7: Rename icons

**Files:**
- Modify: `client/src/components/desktop/DesktopIconGrid.tsx`
- Test: `client/src/components/desktop/DesktopIconGrid.test.tsx`

**Interfaces:**
- Consumes: `getIconLabelOverride`, `setIconLabelOverride`, `clearIconLabelOverride` from `../../utils/desktopIconPreferences` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `client/src/components/desktop/DesktopIconGrid.test.tsx`:

```tsx
describe('DesktopIconGrid — Rename', () => {
  beforeEach(() => localStorage.clear());

  it('right-clicking an icon offers Rename; typing a new label and pressing Enter updates the display and persists it', () => {
    renderGrid();
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Dispatch');
    fireEvent.change(input, { target: { value: 'Radio Ops' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Radio Ops')).toBeInTheDocument();
    expect(getIconLabelOverride('/dispatch')).toBe('Radio Ops');
  });

  it('pressing Escape while renaming cancels without persisting', () => {
    renderGrid();
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Dispatch');
    fireEvent.change(input, { target: { value: 'Radio Ops' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('Dispatch')).toBeInTheDocument();
    expect(getIconLabelOverride('/dispatch')).toBeNull();
  });

  it('committing an empty value clears the override and reverts to the catalog label', () => {
    setIconLabelOverride('/dispatch', 'Radio Ops');
    renderGrid();
    expect(screen.getByText('Radio Ops')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('Radio Ops'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByDisplayValue('Radio Ops');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Dispatch')).toBeInTheDocument();
    expect(getIconLabelOverride('/dispatch')).toBeNull();
  });
});
```

Add `import { getIconLabelOverride, setIconLabelOverride } from '../../utils/desktopIconPreferences';` to the test file's imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: FAIL — no "Rename" item, no inline input.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopIconGrid.tsx`, add the import:

```ts
import { getIconLabelOverride, setIconLabelOverride, clearIconLabelOverride } from '../../utils/desktopIconPreferences';
```

Add a `renamingPath` state near the existing `selected` state:

```ts
const [renamingPath, setRenamingPath] = useState<string | null>(null);
```

Add a commit/cancel handler:

```ts
const commitRename = useCallback((path: string, value: string) => {
  const trimmed = value.trim();
  if (trimmed) setIconLabelOverride(path, trimmed);
  else clearIconLabelOverride(path);
  setRenamingPath(null);
}, []);
```

In the per-icon `ContextMenu`'s `items` array, add a "Rename" entry after the "Open in new browser tab" conditional entry and before the "Group as..." conditional entry:

```tsx
{ label: 'Rename', onClick: () => setRenamingPath(fn.path) },
```

In the icon's rendered label (currently `<span className="text-[10px] leading-tight" ...>{fn.label}</span>` in grid mode, and a similar span in list mode — check both render branches), replace the label rendering with a conditional: when `renamingPath === fn.path`, render an input instead of the span:

```tsx
{renamingPath === fn.path ? (
  <input
    autoFocus
    defaultValue={getIconLabelOverride(fn.path) ?? fn.label}
    onClick={(e) => e.stopPropagation()}
    onBlur={(e) => commitRename(fn.path, e.target.value)}
    onKeyDown={(e) => {
      if (e.key === 'Enter') { e.currentTarget.blur(); }
      if (e.key === 'Escape') { setRenamingPath(null); }
    }}
    className="text-[10px] leading-tight w-full text-center bg-surface-sunken border border-rmpg-700 text-rmpg-100 focus:outline-none"
  />
) : (
  <span className="text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>{getIconLabelOverride(fn.path) ?? fn.label}</span>
)}
```

Apply the same `getIconLabelOverride(fn.path) ?? fn.label` substitution to the list-view render branch's label span as well (read the current file to find its exact location and mirror the same conditional-render pattern there).

Note the `onKeyDown`'s Escape handler intentionally does NOT call `commitRename` — it just closes the input via `setRenamingPath(null)` without persisting, matching the "Escape cancels" test. The `onBlur` handler is what actually commits (also fires after Enter triggers `.blur()`), which is why the Escape branch must bypass it — since `blur` would otherwise still fire after `setRenamingPath(null)` synchronously unmounts the input. Verify this ordering holds in practice when implementing (React batches the state update from `setRenamingPath` and the input unmounts before a browser-native blur event would fire from just removing focus, but confirm via the test rather than assuming).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopIconGrid.tsx client/src/components/desktop/DesktopIconGrid.test.tsx
git commit -m "desktop: add per-icon Rename (localStorage label override)"
```

---

### Task 8: Full verification

**Files:** None (verification only).

- [ ] **Step 1: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `cd client && npx vitest run`
Expected: all tests pass (previous suite was 428 files / 2949 tests; this plan adds roughly 20-25 new tests across 5 files).

- [ ] **Step 3: Build**

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Record verification in the ledger**

```bash
mkdir -p .superpowers/sdd
echo "Icons-Task 8: complete — typecheck clean, full vitest suite passes, vite build succeeds. Manual smoke test not performed (pre-existing local D1 migration drift, consistent with prior branches this session)." >> .superpowers/sdd/progress.md
```
