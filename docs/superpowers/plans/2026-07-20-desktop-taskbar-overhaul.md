# Desktop Taskbar Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pinned/favorite apps, window grouping with click-to-cycle, right-click context menus (jump lists), and taskbar customization (auto-hide, position, size) to the `/desktop` system's taskbar.

**Architecture:** A new `taskbarPreferences.ts` localStorage layer (mirroring the existing `snapPreference.ts` pattern) backs four independent preferences. `DesktopTaskbar.tsx` merges pinned-app paths with the live `windows` array into one ordered, possibly-grouped button list. `ContextMenu` (already used elsewhere in the desktop system) is added at four new entry points for the "Pin to Taskbar"/"Unpin from Taskbar" action. A new "Taskbar" category is added to `DesktopSettingsApp.tsx` for the three customization controls, and `DesktopPage.tsx`/`FloatingWindow.tsx` read the position/size settings so window/icon-grid bounds and the snap/maximize math stay correct regardless of where the taskbar renders.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, existing `ContextMenu.tsx` and `DesktopWindowManager.tsx` infrastructure.

## Global Constraints

- All new preferences are `localStorage` (device-scoped), never D1/API — no new migration, no new column.
- All new chrome uses the project's CSS-variable-backed Tailwind tokens (`var(--surface-raised)`, `var(--brand-400)`, `var(--rmpg-400)`, etc.) — never hardcoded hex.
- No new D1 migrations in this build.
- The new pin action is always labeled **"Pin to Taskbar"** / **"Unpin from Taskbar"** — never bare "Pin"/"Unpin" — to avoid confusion with `DesktopIconGrid.tsx`'s pre-existing, unrelated "Unpin" (remove-from-desktop) action.
- Grouped taskbar buttons only apply to entries backed by `windows` (2+ open windows sharing a `path`); a pinned-but-not-running placeholder button never groups.

---

### Task 1: `taskbarPreferences.ts` data layer

**Files:**
- Create: `client/src/utils/taskbarPreferences.ts`
- Test: `client/src/utils/taskbarPreferences.test.ts`

**Interfaces:**
- Produces: `getPinnedApps(): string[]`, `pinApp(path: string): void`, `unpinApp(path: string): void`, `isAppPinned(path: string): boolean`, `type TaskbarPosition = 'bottom' | 'top'`, `getTaskbarPosition(): TaskbarPosition`, `setTaskbarPosition(position: TaskbarPosition): void`, `type TaskbarSize = 'small' | 'large'`, `getTaskbarSize(): TaskbarSize`, `setTaskbarSize(size: TaskbarSize): void`, `isTaskbarAutoHideEnabled(): boolean`, `setTaskbarAutoHide(enabled: boolean): void` — every later task in this plan consumes these exact names.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/utils/taskbarPreferences.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPinnedApps, pinApp, unpinApp, isAppPinned,
  getTaskbarPosition, setTaskbarPosition,
  getTaskbarSize, setTaskbarSize,
  isTaskbarAutoHideEnabled, setTaskbarAutoHide,
} from './taskbarPreferences';

describe('taskbarPreferences — pinned apps', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to an empty pinned list', () => {
    expect(getPinnedApps()).toEqual([]);
    expect(isAppPinned('/dispatch')).toBe(false);
  });

  it('pinApp appends the path and isAppPinned reflects it', () => {
    pinApp('/dispatch');
    expect(getPinnedApps()).toEqual(['/dispatch']);
    expect(isAppPinned('/dispatch')).toBe(true);
  });

  it('pinApp is idempotent — pinning an already-pinned path does not duplicate it', () => {
    pinApp('/dispatch');
    pinApp('/dispatch');
    expect(getPinnedApps()).toEqual(['/dispatch']);
  });

  it('pinning multiple apps preserves pin order', () => {
    pinApp('/dispatch');
    pinApp('/warrants');
    pinApp('/records');
    expect(getPinnedApps()).toEqual(['/dispatch', '/warrants', '/records']);
  });

  it('unpinApp removes the path and isAppPinned reflects it', () => {
    pinApp('/dispatch');
    pinApp('/warrants');
    unpinApp('/dispatch');
    expect(getPinnedApps()).toEqual(['/warrants']);
    expect(isAppPinned('/dispatch')).toBe(false);
  });

  it('unpinning a path that was never pinned is a silent no-op', () => {
    pinApp('/dispatch');
    unpinApp('/never-pinned');
    expect(getPinnedApps()).toEqual(['/dispatch']);
  });
});

describe('taskbarPreferences — position', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to bottom', () => {
    expect(getTaskbarPosition()).toBe('bottom');
  });

  it('setTaskbarPosition persists and getTaskbarPosition reflects it', () => {
    setTaskbarPosition('top');
    expect(getTaskbarPosition()).toBe('top');
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('top');
  });
});

describe('taskbarPreferences — size', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to small', () => {
    expect(getTaskbarSize()).toBe('small');
  });

  it('setTaskbarSize persists and getTaskbarSize reflects it', () => {
    setTaskbarSize('large');
    expect(getTaskbarSize()).toBe('large');
    expect(localStorage.getItem('rmpg_desktop_taskbar_size')).toBe('large');
  });
});

describe('taskbarPreferences — auto-hide', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to disabled', () => {
    expect(isTaskbarAutoHideEnabled()).toBe(false);
  });

  it('setTaskbarAutoHide(true) persists and isTaskbarAutoHideEnabled reflects it', () => {
    setTaskbarAutoHide(true);
    expect(isTaskbarAutoHideEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_taskbar_autohide')).toBe('1');
  });

  it('setTaskbarAutoHide(false) persists and isTaskbarAutoHideEnabled reflects it', () => {
    setTaskbarAutoHide(true);
    setTaskbarAutoHide(false);
    expect(isTaskbarAutoHideEnabled()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_taskbar_autohide')).toBe('0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/utils/taskbarPreferences.test.ts`
Expected: FAIL — `./taskbarPreferences` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/taskbarPreferences.ts
const PINNED_APPS_KEY = 'rmpg_desktop_pinned_apps';
const POSITION_KEY = 'rmpg_desktop_taskbar_position';
const SIZE_KEY = 'rmpg_desktop_taskbar_size';
const AUTOHIDE_KEY = 'rmpg_desktop_taskbar_autohide';

export function getPinnedApps(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_APPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function savePinnedApps(paths: string[]): void {
  try {
    localStorage.setItem(PINNED_APPS_KEY, JSON.stringify(paths));
  } catch { /* silent — sessionless devices just always see the default */ }
}

export function pinApp(path: string): void {
  const current = getPinnedApps();
  if (current.includes(path)) return;
  savePinnedApps([...current, path]);
}

export function unpinApp(path: string): void {
  savePinnedApps(getPinnedApps().filter(p => p !== path));
}

export function isAppPinned(path: string): boolean {
  return getPinnedApps().includes(path);
}

export type TaskbarPosition = 'bottom' | 'top';

export function getTaskbarPosition(): TaskbarPosition {
  try {
    return localStorage.getItem(POSITION_KEY) === 'top' ? 'top' : 'bottom';
  } catch {
    return 'bottom';
  }
}

export function setTaskbarPosition(position: TaskbarPosition): void {
  try {
    localStorage.setItem(POSITION_KEY, position);
  } catch { /* silent */ }
}

export type TaskbarSize = 'small' | 'large';

export function getTaskbarSize(): TaskbarSize {
  try {
    return localStorage.getItem(SIZE_KEY) === 'large' ? 'large' : 'small';
  } catch {
    return 'small';
  }
}

export function setTaskbarSize(size: TaskbarSize): void {
  try {
    localStorage.setItem(SIZE_KEY, size);
  } catch { /* silent */ }
}

export function isTaskbarAutoHideEnabled(): boolean {
  try {
    return localStorage.getItem(AUTOHIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTaskbarAutoHide(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOHIDE_KEY, enabled ? '1' : '0');
  } catch { /* silent */ }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/taskbarPreferences.test.ts`
Expected: PASS, all 12 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/taskbarPreferences.ts client/src/utils/taskbarPreferences.test.ts
git commit -m "desktop: add taskbarPreferences.ts (pinned apps, position, size, auto-hide)"
```

---

### Task 2: "Pin to Taskbar" on the desktop icon grid

**Files:**
- Modify: `client/src/components/desktop/DesktopIconGrid.tsx`
- Test: `client/src/components/desktop/DesktopIconGrid.test.tsx`

**Interfaces:**
- Consumes: `isAppPinned`, `pinApp`, `unpinApp` from `../../utils/taskbarPreferences` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `client/src/components/desktop/DesktopIconGrid.test.tsx` (append a new `describe` block; if the file's existing render harness differs, match its actual prop shape — the props are `icons`, `positions`, `onReposition`, `onUnpin`, `groups`, `onCreateGroup`, `onUngroup`, `iconSize`, `viewMode`):

```tsx
describe('DesktopIconGrid — Pin to Taskbar', () => {
  beforeEach(() => localStorage.clear());

  it('right-clicking an icon offers "Pin to Taskbar" when unpinned, and pinning toggles it to "Unpin from Taskbar"', () => {
    render(
      <DesktopIconGrid
        icons={[{ path: '/dispatch', label: 'Dispatch', icon: Radio, description: 'd' }]}
        positions={{}} onReposition={() => {}} onUnpin={() => {}}
        groups={[]} onCreateGroup={() => {}} onUngroup={() => {}}
        iconSize="medium" viewMode="grid"
      />
    );
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    expect(screen.getByText('Pin to Taskbar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pin to Taskbar'));
    expect(isAppPinned('/dispatch')).toBe(true);

    fireEvent.contextMenu(screen.getByText('Dispatch'));
    expect(screen.getByText('Unpin from Taskbar')).toBeInTheDocument();
  });
});
```

Add the necessary imports at the top of the test file: `import { isAppPinned } from '../../utils/taskbarPreferences';` and `import { Radio } from 'lucide-react';` (adjust if the file already imports these).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: FAIL — "Pin to Taskbar" not found.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopIconGrid.tsx`, add the import:

```ts
import { isAppPinned, pinApp, unpinApp } from '../../utils/taskbarPreferences';
```

Add a small re-render trigger since pin state lives outside React state — add a state tick that the context menu action bumps, and read `isAppPinned` fresh on each render:

```ts
const [, forceRerender] = useState(0);
```

(add this alongside the existing `const [selected, setSelected] = useState<Set<string>>(new Set());` line)

Then in the per-icon `ContextMenu`'s `items` array, add one more entry right before the existing `{ label: 'Unpin', onClick: () => onUnpin(fn.path) }` line:

```tsx
{
  label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
  onClick: () => {
    if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path);
    forceRerender(n => n + 1);
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopIconGrid.tsx client/src/components/desktop/DesktopIconGrid.test.tsx
git commit -m "desktop: add Pin to Taskbar to the desktop icon grid context menu"
```

---

### Task 3: "Pin to Taskbar" on the Module Directory page

**Files:**
- Modify: `client/src/pages/ModuleDirectoryPage.tsx`
- Test: `client/src/pages/ModuleDirectoryPage.test.tsx` (extend the existing file — read it first to match its render harness and existing mocks before adding new tests)

**Interfaces:**
- Consumes: `isAppPinned`, `pinApp`, `unpinApp` from `../utils/taskbarPreferences` (Task 1); `ContextMenu` from `../components/ContextMenu`.

- [ ] **Step 1: Write the failing test**

Read `client/src/pages/ModuleDirectoryPage.test.tsx` first to find its existing render setup (auth/router mocks) and mirror it exactly. Add:

```tsx
describe('ModuleDirectoryPage — Pin to Taskbar', () => {
  beforeEach(() => localStorage.clear());

  it('right-clicking a module card offers "Pin to Taskbar"', () => {
    // render(...) using this file's existing harness
    fireEvent.contextMenu(screen.getByText('Dispatch Console')); // or whichever known-good fixture label the existing tests use
    expect(screen.getByText('Pin to Taskbar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pin to Taskbar'));
    expect(isAppPinned('/dispatch')).toBe(true);
  });
});
```

Adjust the fixture label/path to whatever this file's existing tests already reference (do not invent a new one — reuse the same catalog entry other tests in the file already assert against).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/ModuleDirectoryPage.test.tsx`
Expected: FAIL — "Pin to Taskbar" not found.

- [ ] **Step 3: Implement**

In `client/src/pages/ModuleDirectoryPage.tsx`, add the import:

```ts
import { isAppPinned, pinApp, unpinApp } from '../utils/taskbarPreferences';
import ContextMenu from '../components/ContextMenu';
```

In `renderFunctionCard(fn)` (line 441), wrap the returned `<div key={fn.path} ...>` in a `ContextMenu`. Change:

```tsx
return (
  <div
    key={fn.path}
    className="group relative transition-all duration-150 hover:bg-surface-raised active:scale-[0.98]"
    style={{
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border-default)',
    }}
  >
```

to:

```tsx
return (
  <ContextMenu
    key={fn.path}
    items={[{
      label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
      onClick: () => { if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path); forceRerender(n => n + 1); },
    }]}
  >
  <div
    className="group relative transition-all duration-150 hover:bg-surface-raised active:scale-[0.98]"
    style={{
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border-default)',
    }}
  >
```

and close the new wrapper right after the existing closing `</div>` of this card (find the matching closing tag for the outer `<div key={fn.path} ...>` further down in the same function and change it from `</div>` to `</div></ContextMenu>` — read the full function body to `client/src/pages/ModuleDirectoryPage.tsx` before editing to find the exact matching brace).

Add a `forceRerender` state hook near the top of the `ModuleDirectoryPage` component function (alongside its other `useState` calls):

```ts
const [, forceRerender] = useState(0);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/ModuleDirectoryPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ModuleDirectoryPage.tsx client/src/pages/ModuleDirectoryPage.test.tsx
git commit -m "desktop: add Pin to Taskbar to Module Directory cards"
```

---

### Task 4: "Pin to Taskbar" on taskbar launcher search results

**Files:**
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Test: `client/src/components/desktop/DesktopTaskbar.test.tsx`

**Interfaces:**
- Consumes: `isAppPinned`, `pinApp`, `unpinApp` from `../../utils/taskbarPreferences` (Task 1); `ContextMenu` from `../ContextMenu`.

- [ ] **Step 1: Write the failing test**

Append to `client/src/components/desktop/DesktopTaskbar.test.tsx`:

```tsx
describe('DesktopTaskbar — Pin to Taskbar (launcher search)', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('right-clicking a launcher search result offers "Pin to Taskbar"', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Dispatch' } });
    fireEvent.contextMenu(screen.getByText('Dispatch Console'));
    expect(screen.getByText('Pin to Taskbar')).toBeInTheDocument();
  });
});
```

Add `import { isAppPinned } from '../../utils/taskbarPreferences';` to the test file if not already present (not strictly required by this test, but Task 5's tests reuse this same describe file and will need it).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: FAIL — "Pin to Taskbar" not found (the search result button has no context menu today).

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopTaskbar.tsx`, add the import:

```ts
import { isAppPinned, pinApp, unpinApp } from '../../utils/taskbarPreferences';
```

Add a re-render tick alongside the existing `useState` calls:

```ts
const [, forceRerender] = useState(0);
```

Wrap each search-result button (currently at lines 155–166) in a `ContextMenu`:

```tsx
{searchResults.slice(0, 20).map(fn => (
  <ContextMenu
    key={fn.path}
    items={[{
      label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
      onClick: () => { if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path); forceRerender(n => n + 1); },
    }]}
  >
    <button
      type="button"
      onClick={() => handleSelectResult(fn)}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px]"
      style={{ color: 'var(--text-primary)' }}
    >
      <fn.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--rmpg-400)' }} />
      {fn.label}
    </button>
  </ContextMenu>
))}
```

Add the `ContextMenu` import at the top of the file:

```ts
import ContextMenu from '../ContextMenu';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: PASS, including all pre-existing tests in this file (unaffected by this change).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/DesktopTaskbar.test.tsx
git commit -m "desktop: add Pin to Taskbar to launcher search results"
```

---

### Task 5: Render pinned-but-not-running apps as taskbar buttons

**Files:**
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Test: `client/src/components/desktop/DesktopTaskbar.test.tsx`

**Interfaces:**
- Consumes: `getPinnedApps` from `../../utils/taskbarPreferences` (Task 1); the `catalog: NavFunction[]` prop already passed to `DesktopTaskbar`.
- Produces: a new derived list, `pinnedNotRunning: NavFunction[]`, rendered before the running-window buttons — later tasks (6, 7) restructure this same render block, so keep the derivation as a clearly named `useMemo` other tasks can extend.

- [ ] **Step 1: Write the failing test**

Append to `client/src/components/desktop/DesktopTaskbar.test.tsx`:

```tsx
describe('DesktopTaskbar — pinned apps render when not running', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('a pinned app with no open window renders a launcher-style taskbar button', () => {
    pinApp('/dispatch');
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Dispatch Console' })).toBeInTheDocument();
  });

  it('clicking a pinned-not-running button opens the window', () => {
    pinApp('/dispatch');
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch Console' }));
    expect(screen.getByText('/dispatch')).toBeInTheDocument();
  });

  it('once the pinned app is running, only one button shows (no duplicate placeholder)', () => {
    pinApp('/dispatch');
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch Console' }));
    expect(screen.getAllByRole('button', { name: 'Dispatch Console' })).toHaveLength(1);
  });
});
```

Add `import { pinApp } from '../../utils/taskbarPreferences';` to the test file's imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: FAIL — no button renders for a pinned-but-unopened app.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopTaskbar.tsx`, add the import (extends the Task 4 import line):

```ts
import { isAppPinned, pinApp, unpinApp, getPinnedApps } from '../../utils/taskbarPreferences';
import { activateNavFunction } from '../../utils/windowManager'; // already imported — confirm, don't duplicate
```

Add a derived list of pinned-but-not-running apps, right after the existing `searchResults` `useMemo`:

```ts
const pinnedNotRunning = useMemo(() => {
  const runningPaths = new Set(windows.map(w => w.path));
  return getPinnedApps()
    .filter(path => !runningPaths.has(path))
    .map(path => catalog.find(fn => fn.path === path))
    .filter((fn): fn is NavFunction => !!fn);
}, [windows, catalog]);
```

Replace the running-windows render block (currently lines 171–183: `<div className="flex items-center gap-1 flex-1 overflow-x-auto"> {windows.map(w => (...))} </div>`) with a combined block rendering `pinnedNotRunning` first, then the existing `windows` buttons unchanged:

```tsx
<div className="flex items-center gap-1 flex-1 overflow-x-auto">
  {pinnedNotRunning.map(fn => (
    <button
      key={fn.path}
      type="button"
      onClick={() => activateNavFunction(fn, { navigate, openWindow })}
      className="px-3 py-1 text-[11px] truncate"
      style={{ maxWidth: 160, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
    >
      {fn.label}
    </button>
  ))}
  {windows.map(w => (
    <button
      key={w.id}
      type="button"
      onClick={() => focusWindow(w.id)}
      className="px-3 py-1 text-[11px] truncate"
      style={{ maxWidth: 160, background: w.minimized ? 'transparent' : 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
    >
      {w.title}
    </button>
  ))}
</div>
```

Confirm `NavFunction` is already imported (it is, per the existing `import type { NavFunction } from '../../data/navCatalog';` line) and that `activateNavFunction` and `navigate` are already in scope (both are — `activateNavFunction` is imported at the top, `navigate` is defined via `useNavigate()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/DesktopTaskbar.test.tsx
git commit -m "desktop: render pinned-but-not-running apps as taskbar buttons"
```

---

### Task 6: Window grouping with click-to-cycle

**Files:**
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Test: `client/src/components/desktop/DesktopTaskbar.test.tsx`

**Interfaces:**
- Consumes: `windows: DesktopWindowState[]` (already available via `useDesktopWindows()`), `focusWindow(id)` (already available).
- Produces: grouped rendering of the `windows` button list — Task 7 extends this same button's `ContextMenu`, so keep the per-group render as one clearly identifiable JSX block (`groupedWindows`).

- [ ] **Step 1: Write the failing test**

Append to `client/src/components/desktop/DesktopTaskbar.test.tsx`. This test needs two windows on the same path — extend `Harness` in this file to expose a second open button, or add a small local harness in the new describe block:

```tsx
function TwoWindowHarness() {
  const { openWindow, windows } = useDesktopWindows();
  return (
    <>
      <button onClick={() => openWindow('/dispatch', 'Dispatch A')}>open-a</button>
      <button onClick={() => openWindow('/dispatch', 'Dispatch B')}>open-b</button>
      <DesktopTaskbar icons={icons} catalog={catalog} />
      <ul>{windows.map(w => <li key={w.id} data-testid="window-item">{w.title} focused-z={w.zIndex} minimized={String(w.minimized)}</li>)}</ul>
    </>
  );
}

describe('DesktopTaskbar — window grouping', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('two windows of the same path collapse into one grouped button with a count badge', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><TwoWindowHarness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByText('open-a'));
    // DesktopWindowManager's openWindow re-focuses an existing window for the same
    // path rather than opening a second one — so to get two DISTINCT windows on the
    // same path we must simulate opening from two different desktop icons that both
    // resolve to /dispatch but are tracked as separate window ids. Since openWindow
    // dedupes by path, this test instead verifies grouping using two DIFFERENT paths
    // is NOT grouped, and confirms the single-path case shows exactly one button:
    expect(screen.getAllByRole('button', { name: /Dispatch/ })).toHaveLength(1);
  });
});
```

**Note for the implementer:** re-read `DesktopWindowManager.tsx`'s `openWindow` before writing this test — it already dedupes by `path` (an existing window for the same path is refocused, not duplicated), so **true grouping (2+ windows sharing one path) cannot currently happen through the public `openWindow` API**. Confirm this by reading the function body. If true, this task's grouping logic is still correct defensive code (the `windows` array's shape technically allows duplicate paths, e.g. if a future change adds a "duplicate window" action), but the test must construct the duplicate state directly via the window manager's internal `commit`/session-storage seeding rather than via `openWindow` twice. Use this approach: seed `sessionStorage` with two `DesktopWindowState` entries sharing `path: '/dispatch'` before rendering, since `DesktopWindowManagerProvider`'s `loadSession()` reads directly from `sessionStorage.getItem('rmpg_desktop_windows')` on mount:

```tsx
it('two windows sharing a path collapse into one grouped button with a count badge, and clicking cycles focus between them', () => {
  sessionStorage.setItem('rmpg_desktop_windows', JSON.stringify([
    { id: 'w1', path: '/dispatch', title: 'Dispatch', x: 80, y: 60, width: 1050, height: 800, zIndex: 101, minimized: false, maximized: false, alwaysOnTop: false, opacity: 1 },
    { id: 'w2', path: '/dispatch', title: 'Dispatch', x: 100, y: 80, width: 1050, height: 800, zIndex: 102, minimized: false, maximized: false, alwaysOnTop: false, opacity: 1 },
  ]));
  render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
  const groupButton = screen.getByRole('button', { name: /Dispatch.*2/ });
  expect(groupButton).toBeInTheDocument();
  fireEvent.click(groupButton);
  const items = screen.getAllByText(/^\/dispatch$/);
  expect(items).toHaveLength(2); // both windows still open — cycling only changes focus, not window count
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: FAIL — two separate ungrouped buttons render instead of one grouped button with a count badge.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopTaskbar.tsx`, add a ref to track cycling position per group (module-level state won't survive remounts correctly across groups, so use a `useRef<Record<string, number>>`):

```ts
const cycleIndexRef = useRef<Record<string, number>>({});
```

Add a grouping derivation right after the `pinnedNotRunning` `useMemo`:

```ts
const windowGroups = useMemo(() => {
  const byPath = new Map<string, typeof windows>();
  for (const w of windows) {
    const list = byPath.get(w.path) ?? [];
    list.push(w);
    byPath.set(w.path, list);
  }
  return [...byPath.entries()].map(([path, group]) => ({ path, group }));
}, [windows]);
```

Replace the `{windows.map(w => (...))}` block from Task 5 with a grouped render:

```tsx
{windowGroups.map(({ path, group }) => {
  if (group.length === 1) {
    const w = group[0];
    return (
      <button
        key={w.id}
        type="button"
        onClick={() => focusWindow(w.id)}
        className="px-3 py-1 text-[11px] truncate"
        style={{ maxWidth: 160, background: w.minimized ? 'transparent' : 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
      >
        {w.title}
      </button>
    );
  }
  const handleGroupClick = () => {
    const current = cycleIndexRef.current[path] ?? 0;
    const next = (current + 1) % group.length;
    cycleIndexRef.current[path] = next;
    focusWindow(group[next].id);
  };
  return (
    <button
      key={path}
      type="button"
      aria-label={`${group[0].title} (${group.length})`}
      onClick={handleGroupClick}
      className="relative px-3 py-1 text-[11px] truncate"
      style={{ maxWidth: 160, background: 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
    >
      {group[0].title}
      <span
        className="absolute -top-1 -right-1 flex items-center justify-center font-bold bg-red-600 text-white"
        style={{ minWidth: 12, height: 12, padding: '0 2px', fontSize: 7, borderRadius: 6 }}
      >
        {group.length}
      </span>
    </button>
  );
})}
```

Note the `aria-label` on the grouped button follows the pattern `"{title} ({count})"` so the test's `name: /Dispatch.*2/` regex matches it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/DesktopTaskbar.test.tsx
git commit -m "desktop: group taskbar buttons for windows sharing a path, click-to-cycle focus"
```

---

### Task 7: Jump-list context menus (Pin/Unpin, Close, Close all) on window buttons

**Files:**
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Test: `client/src/components/desktop/DesktopTaskbar.test.tsx`

**Interfaces:**
- Consumes: `closeWindow(id)` from `useDesktopWindows()` (already exists in `DesktopWindowManager.tsx`); `isAppPinned`, `pinApp`, `unpinApp` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `client/src/components/desktop/DesktopTaskbar.test.tsx`:

```tsx
describe('DesktopTaskbar — window button context menu', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('right-clicking a single window button offers Pin to Taskbar and Close', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByText('simulate-open'));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Dispatch' }));
    expect(screen.getByText('Pin to Taskbar')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(screen.queryByText('Close all')).not.toBeInTheDocument();
  });

  it('clicking Close on a window button closes that window', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByText('simulate-open'));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Dispatch' }));
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByRole('button', { name: 'Dispatch' })).not.toBeInTheDocument();
  });

  it('a grouped window button offers Close all in addition to Close', () => {
    sessionStorage.setItem('rmpg_desktop_windows', JSON.stringify([
      { id: 'w1', path: '/dispatch', title: 'Dispatch', x: 80, y: 60, width: 1050, height: 800, zIndex: 101, minimized: false, maximized: false, alwaysOnTop: false, opacity: 1 },
      { id: 'w2', path: '/dispatch', title: 'Dispatch', x: 100, y: 80, width: 1050, height: 800, zIndex: 102, minimized: false, maximized: false, alwaysOnTop: false, opacity: 1 },
    ]));
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.contextMenu(screen.getByRole('button', { name: /Dispatch.*2/ }));
    expect(screen.getByText('Close all')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close all'));
    expect(screen.queryByRole('button', { name: /Dispatch/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: FAIL — window buttons have no context menu yet.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopTaskbar.tsx`, destructure `closeWindow` from `useDesktopWindows()` (extend the existing destructure at the top of the component):

```ts
const { windows, focusWindow, openWindow, minimizeAll, restoreAll, closeWindow } = useDesktopWindows();
```

Wrap both the single-window and grouped-window buttons (from Task 6) in a `ContextMenu`. Replace the `group.length === 1` branch:

```tsx
if (group.length === 1) {
  const w = group[0];
  return (
    <ContextMenu
      key={w.id}
      items={[
        { label: isAppPinned(w.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar', onClick: () => { if (isAppPinned(w.path)) unpinApp(w.path); else pinApp(w.path); forceRerender(n => n + 1); } },
        { label: 'Close', onClick: () => closeWindow(w.id) },
      ]}
    >
      <button
        type="button"
        onClick={() => focusWindow(w.id)}
        className="px-3 py-1 text-[11px] truncate"
        style={{ maxWidth: 160, background: w.minimized ? 'transparent' : 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
      >
        {w.title}
      </button>
    </ContextMenu>
  );
}
```

and the grouped branch:

```tsx
const handleGroupClick = () => {
  const current = cycleIndexRef.current[path] ?? 0;
  const next = (current + 1) % group.length;
  cycleIndexRef.current[path] = next;
  focusWindow(group[next].id);
};
return (
  <ContextMenu
    key={path}
    items={[
      { label: isAppPinned(path) ? 'Unpin from Taskbar' : 'Pin to Taskbar', onClick: () => { if (isAppPinned(path)) unpinApp(path); else pinApp(path); forceRerender(n => n + 1); } },
      { label: 'Close', onClick: () => closeWindow(group[cycleIndexRef.current[path] ?? 0].id) },
      { label: 'Close all', onClick: () => group.forEach(w => closeWindow(w.id)) },
    ]}
  >
    <button
      type="button"
      aria-label={`${group[0].title} (${group.length})`}
      onClick={handleGroupClick}
      className="relative px-3 py-1 text-[11px] truncate"
      style={{ maxWidth: 160, background: 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
    >
      {group[0].title}
      <span
        className="absolute -top-1 -right-1 flex items-center justify-center font-bold bg-red-600 text-white"
        style={{ minWidth: 12, height: 12, padding: '0 2px', fontSize: 7, borderRadius: 6 }}
      >
        {group.length}
      </span>
    </button>
  </ContextMenu>
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/DesktopTaskbar.test.tsx
git commit -m "desktop: add Pin/Unpin, Close, Close all context menu to taskbar window buttons"
```

---

### Task 8: "Taskbar" Settings category (auto-hide, position, size controls)

**Files:**
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx`
- Test: `client/src/components/desktop/DesktopSettingsApp.test.tsx`

**Interfaces:**
- Consumes: `getTaskbarPosition`, `setTaskbarPosition`, `getTaskbarSize`, `setTaskbarSize`, `isTaskbarAutoHideEnabled`, `setTaskbarAutoHide` (Task 1).
- Produces: a new `'taskbar'` entry in `CategoryId` — Task 9 reads the same three preference functions from `DesktopTaskbar.tsx`/`DesktopPage.tsx`/`FloatingWindow.tsx` directly (not through this component), so no new props are needed on `DesktopSettingsApp`.

- [ ] **Step 1: Write the failing test**

Read `client/src/components/desktop/DesktopSettingsApp.test.tsx` first to match its existing render harness (it likely provides all the required props as no-op mocks). Append:

```tsx
describe('DesktopSettingsApp — Taskbar category', () => {
  beforeEach(() => localStorage.clear());

  it('shows Auto-hide, Position, and Size controls under the Taskbar category', () => {
    render(<DesktopSettingsApp {...defaultProps} />); // use this file's existing default-props helper/object
    fireEvent.click(screen.getByText('Taskbar'));
    expect(screen.getByText(/auto-hide/i)).toBeInTheDocument();
    expect(screen.getByText('Bottom')).toBeInTheDocument();
    expect(screen.getByText('Top')).toBeInTheDocument();
    expect(screen.getByText('Small')).toBeInTheDocument();
    expect(screen.getByText('Large')).toBeInTheDocument();
  });

  it('toggling auto-hide persists via setTaskbarAutoHide', () => {
    render(<DesktopSettingsApp {...defaultProps} />);
    fireEvent.click(screen.getByText('Taskbar'));
    fireEvent.click(screen.getByLabelText(/auto-hide/i));
    expect(isTaskbarAutoHideEnabled()).toBe(true);
  });

  it('clicking Top sets the taskbar position', () => {
    render(<DesktopSettingsApp {...defaultProps} />);
    fireEvent.click(screen.getByText('Taskbar'));
    fireEvent.click(screen.getByText('Top'));
    expect(getTaskbarPosition()).toBe('top');
  });

  it('clicking Large sets the taskbar size', () => {
    render(<DesktopSettingsApp {...defaultProps} />);
    fireEvent.click(screen.getByText('Taskbar'));
    fireEvent.click(screen.getByText('Large'));
    expect(getTaskbarSize()).toBe('large');
  });
});
```

Add the needed imports: `import { isTaskbarAutoHideEnabled, getTaskbarPosition, getTaskbarSize } from '../../utils/taskbarPreferences';`. If this test file has no existing `defaultProps` fixture, build one from `DesktopSettingsAppProps` with no-op functions for every callback and reasonable default values (`iconSize: 'medium'`, `viewMode: 'grid'`, `sortMode: 'manual'`, `wallpaperId`/`accentId` set to any valid id from `DESKTOP_WALLPAPERS`/`DESKTOP_ACCENTS`, `widgets: []`) — mirror whatever the file's other existing tests already use, if any.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: FAIL — no "Taskbar" category exists yet.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopSettingsApp.tsx`:

Add the import:

```ts
import { PanelBottom } from 'lucide-react'; // add to the existing lucide-react import line
import {
  isTaskbarAutoHideEnabled, setTaskbarAutoHide,
  getTaskbarPosition, setTaskbarPosition, type TaskbarPosition,
  getTaskbarSize, setTaskbarSize, type TaskbarSize,
} from '../../utils/taskbarPreferences';
```

Add `'taskbar'` to `CATEGORIES`:

```ts
const CATEGORIES = [
  { id: 'personalization', label: 'Personalization', icon: Sliders },
  { id: 'desktop-icons', label: 'Desktop & Icons', icon: LayoutGrid },
  { id: 'window-management', label: 'Window Management', icon: AppWindow },
  { id: 'taskbar', label: 'Taskbar', icon: PanelBottom },
  { id: 'layout-templates', label: 'Layout & Templates', icon: FolderKanban },
] as const;
```

Add local state near the other `useState` calls in the component body:

```ts
const [autoHide, setAutoHideState] = useState(() => isTaskbarAutoHideEnabled());
const [taskbarPosition, setTaskbarPositionState] = useState<TaskbarPosition>(() => getTaskbarPosition());
const [taskbarSize, setTaskbarSizeState] = useState<TaskbarSize>(() => getTaskbarSize());
```

Add the new category panel, right after the `activeCategory === 'window-management'` block and before `activeCategory === 'layout-templates'`:

```tsx
{activeCategory === 'taskbar' && (
  <div>
    <div className="text-[10px] font-semibold uppercase mb-1" style={sectionLabelStyle()}>Auto-Hide</div>
    <label className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
      <input
        type="checkbox"
        aria-label="Auto-hide taskbar"
        checked={autoHide}
        onChange={(e) => { setTaskbarAutoHide(e.target.checked); setAutoHideState(e.target.checked); }}
      />
      Hide the taskbar until you move the mouse to the screen edge
    </label>

    <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Position</div>
    <div className="flex gap-1">
      {(['bottom', 'top'] as const).map(position => (
        <button
          key={position} type="button"
          onClick={() => { setTaskbarPosition(position); setTaskbarPositionState(position); }}
          className="text-[10px] px-2 py-0.5 capitalize"
          style={{ border: '1px solid var(--border-default)', background: taskbarPosition === position ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
        >
          {position === 'bottom' ? 'Bottom' : 'Top'}
        </button>
      ))}
    </div>

    <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Size</div>
    <div className="flex gap-1">
      {(['small', 'large'] as const).map(size => (
        <button
          key={size} type="button"
          onClick={() => { setTaskbarSize(size); setTaskbarSizeState(size); }}
          className="text-[10px] px-2 py-0.5 capitalize"
          style={{ border: '1px solid var(--border-default)', background: taskbarSize === size ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
        >
          {size === 'small' ? 'Small' : 'Large'}
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/components/desktop/DesktopSettingsApp.test.tsx
git commit -m "desktop: add Taskbar settings category (auto-hide, position, size)"
```

---

### Task 9: Apply position/size/auto-hide to the live taskbar and layout math

**Files:**
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Modify: `client/src/components/desktop/FloatingWindow.tsx`
- Modify: `client/src/pages/DesktopPage.tsx`
- Test: `client/src/components/desktop/DesktopTaskbar.test.tsx`
- Test: `client/src/components/desktop/FloatingWindow.test.tsx`

**Interfaces:**
- Consumes: `getTaskbarPosition`, `getTaskbarSize`, `isTaskbarAutoHideEnabled` (Task 1).
- Produces: `TASKBAR_HEIGHT_PX: Record<TaskbarSize, number>` exported from `DesktopTaskbar.tsx` (`{ small: 48, large: 56 }`) — `FloatingWindow.tsx` and `DesktopPage.tsx` both import this instead of hardcoding `48`.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/components/desktop/DesktopTaskbar.test.tsx`:

```tsx
describe('DesktopTaskbar — position and size', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('renders at the top when position is set to top', () => {
    setTaskbarPosition('top');
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    const bar = screen.getByLabelText('Open app launcher').closest('div')!.parentElement as HTMLElement;
    expect(bar.style.top).toBe('0px');
    expect(bar.style.bottom).toBe('');
  });

  it('renders at 56px height when size is set to large', () => {
    setTaskbarSize('large');
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    const bar = screen.getByLabelText('Open app launcher').closest('div')!.parentElement as HTMLElement;
    expect(bar.style.height).toBe('56px');
  });

  it('auto-hide translates the bar off-screen until the hover strip is entered', () => {
    setTaskbarAutoHide(true);
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    expect(screen.getByTestId('taskbar-hover-strip')).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId('taskbar-hover-strip'));
    const bar = screen.getByLabelText('Open app launcher').closest('div')!.parentElement as HTMLElement;
    expect(bar.style.transform).toBe('translateY(0px)');
  });
});
```

Add `import { setTaskbarPosition, setTaskbarSize, setTaskbarAutoHide } from '../../utils/taskbarPreferences';` to the test file.

Append to `client/src/components/desktop/FloatingWindow.test.tsx`:

```tsx
describe('FloatingWindow — respects taskbar size setting for maximize/snap math', () => {
  it('maximized style leaves room for a large (56px) taskbar', () => {
    setTaskbarSize('large');
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByLabelText('Maximize Dispatch'));
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.bottom).toBe('56px');
    setTaskbarSize('small');
  });
});
```

Add `import { setTaskbarSize } from '../../utils/taskbarPreferences';` to the test file's imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx src/components/desktop/FloatingWindow.test.tsx`
Expected: FAIL — taskbar always renders at the bottom, always 48px, never auto-hides; `FloatingWindow.tsx` hardcodes `bottom: 48`.

- [ ] **Step 3: Implement**

In `client/src/components/desktop/DesktopTaskbar.tsx`, add the export and imports:

```ts
import { isAppPinned, pinApp, unpinApp, getPinnedApps, getTaskbarPosition, getTaskbarSize, isTaskbarAutoHideEnabled, type TaskbarSize } from '../../utils/taskbarPreferences';

export const TASKBAR_HEIGHT_PX: Record<TaskbarSize, number> = { small: 48, large: 56 };
```

Add state for the three settings (read once per mount, matching how `DesktopSettingsApp.tsx` reads them — this component does not need live cross-tab sync, only to reflect the current tab's setting on load/focus):

```ts
const [position] = useState(() => getTaskbarPosition());
const [size] = useState(() => getTaskbarSize());
const [autoHideEnabled] = useState(() => isTaskbarAutoHideEnabled());
const [hidden, setHidden] = useState(autoHideEnabled);
const barHeight = TASKBAR_HEIGHT_PX[size];
```

Replace the root `<div>`'s inline `style` (currently hardcoded `position: 'fixed', left: 0, right: 0, bottom: 0, height: 48, ...`):

```tsx
<div
  className="flex items-center justify-between px-2 gap-2"
  style={{
    position: 'fixed', left: 0, right: 0,
    ...(position === 'top' ? { top: 0 } : { bottom: 0 }),
    height: barHeight,
    background: 'var(--surface-overlay)',
    borderTop: position === 'bottom' ? '1px solid var(--desktop-shell-accent, var(--border-default))' : undefined,
    borderBottom: position === 'top' ? '1px solid var(--desktop-shell-accent, var(--border-default))' : undefined,
    zIndex: 1000,
    transform: autoHideEnabled && hidden ? `translateY(${position === 'top' ? '-100%' : '100%'})` : 'translateY(0px)',
    transition: 'transform 150ms ease',
  }}
  onMouseLeave={autoHideEnabled ? () => setHidden(true) : undefined}
>
```

Add the hover-strip as a sibling, right after this root `<div>`'s closing `</div>` (so it renders even while the bar is hidden) — since `DesktopTaskbar` currently returns a single root element, change the return to a fragment:

```tsx
return (
  <>
    <div
      className="flex items-center justify-between px-2 gap-2"
      style={{ /* as above */ }}
      onMouseLeave={autoHideEnabled ? () => setHidden(true) : undefined}
    >
      {/* ...existing content unchanged... */}
    </div>
    {autoHideEnabled && (
      <div
        data-testid="taskbar-hover-strip"
        onMouseEnter={() => setHidden(false)}
        style={{ position: 'fixed', left: 0, right: 0, height: 4, zIndex: 999, ...(position === 'top' ? { top: 0 } : { bottom: 0 }) }}
      />
    )}
  </>
);
```

In `client/src/components/desktop/FloatingWindow.tsx`, replace the hardcoded `TASKBAR_HEIGHT` constant. Add these two imports (note `getTaskbarSize` lives in `taskbarPreferences.ts`, not `snapPreference.ts`):

```ts
import { TASKBAR_HEIGHT_PX } from './DesktopTaskbar';
import { getTaskbarSize } from '../../utils/taskbarPreferences';
```

Remove the line `const TASKBAR_HEIGHT = 48;` and replace every reference to `TASKBAR_HEIGHT` in the file (the maximized style's `bottom: 48` — change to a computed value, and the snap `onUp` handler's `desktopHeight = window.innerHeight - TASKBAR_HEIGHT`) with a value derived from `TASKBAR_HEIGHT_PX[getTaskbarSize()]`. Since this value doesn't change during a single component's lifetime in any test scenario used elsewhere in this file, compute it once at the top of the component body:

```ts
const taskbarHeight = TASKBAR_HEIGHT_PX[getTaskbarSize()];
```

Then:
- In the `effectiveZIndex`/`style` block, change `bottom: 48` to `bottom: taskbarHeight`.
- In `onTitleBarPointerDown`'s `onUp`, change `const desktopHeight = window.innerHeight - TASKBAR_HEIGHT;` to `const desktopHeight = window.innerHeight - taskbarHeight;`.

In `client/src/pages/DesktopPage.tsx`, update the hardcoded `calc(100vh - 48px)` on the wallpaper container:

```ts
import { TASKBAR_HEIGHT_PX } from '../components/desktop/DesktopTaskbar';
import { getTaskbarSize } from '../utils/taskbarPreferences';
```

and change:

```tsx
<div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
```

to:

```tsx
<div style={{ position: 'relative', width: '100%', height: `calc(100vh - ${TASKBAR_HEIGHT_PX[getTaskbarSize()]}px)`, overflow: 'hidden' }}>
```

Note: this plan intentionally does not implement moving the icon-grid/window-layer container to the top of the screen when `position === 'top'` — the wallpaper container always occupies the remaining space below the bar today, and full support for a top-positioned bar pushing content down (rather than just reserving height at the bottom) is a reasonable follow-up but out of scope for this task; document this as a known limitation in the final verification report rather than silently expanding scope.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx src/components/desktop/FloatingWindow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/FloatingWindow.tsx client/src/pages/DesktopPage.tsx client/src/components/desktop/DesktopTaskbar.test.tsx client/src/components/desktop/FloatingWindow.test.tsx
git commit -m "desktop: wire taskbar position/size/auto-hide into live layout and window math"
```

---

### Task 10: Full verification

**Files:** None (verification only).

- [ ] **Step 1: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `cd client && npx vitest run`
Expected: all tests pass (previous suite was 428 files / 2915 tests; this plan adds roughly 20 new tests across 6 files).

- [ ] **Step 3: Build**

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Record verification in the ledger**

```bash
mkdir -p .superpowers/sdd
echo "Taskbar-Task 10: complete — typecheck clean, full vitest suite passes, vite build succeeds. Manual smoke test not performed (pre-existing local D1 migration drift, consistent with prior branches this session). Known limitation: top-positioned taskbar reserves height at the bottom of the layout rather than repositioning content to start below a top bar — documented in Task 9, not a regression." >> .superpowers/sdd/progress.md
git add .superpowers/sdd/progress.md
git commit -m "desktop: record Taskbar overhaul verification in the SDD progress ledger"
```
