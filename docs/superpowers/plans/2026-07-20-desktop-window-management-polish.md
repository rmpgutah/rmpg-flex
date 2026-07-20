# Desktop Window Management Polish (Chunk A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 7 items in Chunk A of the desktop launcher's "Window Management" category: Ctrl+\` window cycling, multi-monitor pop-out placement, snap-left/right, Show Desktop, always-on-top pinning, per-window opacity, and remembered window position — plus wire real controls into the Settings app's "Window Management" category (currently a placeholder).

**Architecture:** All 7 items extend the existing `DesktopWindowManagerContext`/`FloatingWindow.tsx`/`DesktopTaskbar.tsx` desktop-shell components already shipped. Two small new device-scoped (`localStorage`) preference utilities (`snapPreference.ts`, `multiMonitor.ts`) and one session-scoped (`sessionStorage`) utility (`desktopWindowPositions.ts`) are added — none touch D1/`user_preferences`.

**Tech Stack:** React 18 + TypeScript client (Vite), Vitest + `@testing-library/react`.

## Global Constraints

- `Ctrl+\`` cycles forward through open windows; `Ctrl+Shift+\`` reverses. Never intercept literal Alt+Tab (impossible from a browser tab anyway).
- Multi-monitor placement applies only to `openDetachedWindow()` (real `window.open()` pop-outs) — never to in-desktop `FloatingWindow` panels, which cannot leave their browser tab's monitor.
- The multi-monitor enabled flag lives in `localStorage` (`rmpg_desktop_multi_monitor`), never a `user_preferences` D1 column — device-scoped, not account-scoped.
- The snap-to-edge enabled flag lives in `localStorage` (`rmpg_desktop_snap_enabled`), default enabled (`true`) — same device-scoped reasoning.
- Remembered window positions live in `sessionStorage` (`rmpg_desktop_window_positions`), never synced to the server.
- `DesktopWindowState` gains `alwaysOnTop: boolean` and `opacity: number` (range `0.3`–`1`, default `1`). Every read site must treat `undefined` (from pre-existing sessionStorage entries created before this change) the same as the documented default — no migration/normalizer needed.
- No new D1 columns, no new API endpoints, anywhere in this plan.
- Run `cd client && npx tsc --noEmit` and the relevant `npx vitest run <file>` after every task; do not proceed to the next task on a red build.

---

## Task 1: Window Cycling (Ctrl+\`)

**Files:**
- Create: `client/src/components/desktop/DesktopWindowSwitcher.tsx`
- Create: `client/src/components/desktop/DesktopWindowSwitcher.test.tsx`
- Modify: `client/src/utils/windowManager.ts`
- Modify: `client/src/pages/DesktopPage.tsx`

**Interfaces:**
- Consumes: `useDesktopWindows()` (`windows: DesktopWindowState[]`, `focusWindow(id: string): void`) — both already exist.
- Produces: `getWindowIconByPath(path: string): React.ElementType | undefined` (new export in `windowManager.ts`) — no other task depends on this.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/desktop/DesktopWindowSwitcher.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopWindowSwitcher from './DesktopWindowSwitcher';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';

function Harness() {
  const { openWindow, windows } = useDesktopWindows();
  return (
    <>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open-dispatch</button>
      <button onClick={() => openWindow('/map', 'Live Map')}>open-map</button>
      <button onClick={() => openWindow('/records', 'Records')}>open-records</button>
      <DesktopWindowSwitcher />
      <ul>{windows.map(w => <li key={w.id}>{w.title}-{w.zIndex}</li>)}</ul>
    </>
  );
}

function ctrlBacktickDown(shift = false) {
  fireEvent.keyDown(window, { key: '`', ctrlKey: true, shiftKey: shift });
}
function ctrlUp() {
  fireEvent.keyUp(window, { key: 'Control' });
}

function zIndexOf(items: string[], titlePrefix: string): number {
  const entry = items.find(t => t.startsWith(`${titlePrefix}-`))!;
  return parseInt(entry.split('-')[1], 10);
}

describe('DesktopWindowSwitcher', () => {
  it('renders no overlay when not cycling', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    expect(screen.queryByTestId('window-switcher-overlay')).not.toBeInTheDocument();
  });

  it('Ctrl+` shows the overlay with the next-most-recent window highlighted', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    ctrlBacktickDown();
    expect(screen.getByTestId('window-switcher-overlay')).toBeInTheDocument();
    const dispatchEntry = screen.getByText('Dispatch').closest('[aria-current]');
    expect(dispatchEntry).toHaveAttribute('aria-current', 'true');
  });

  it('releasing Ctrl after a single tap focuses the next-most-recent window', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    ctrlBacktickDown();
    ctrlUp();
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(zIndexOf(items, 'Dispatch')).toBeGreaterThan(zIndexOf(items, 'Live Map'));
    expect(screen.queryByTestId('window-switcher-overlay')).not.toBeInTheDocument();
  });

  it('repeated ` presses advance through all open windows and wrap around', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    fireEvent.click(screen.getByText('open-records'));
    // MRU order at this point: Records (front), Live Map, Dispatch
    ctrlBacktickDown(); // -> Live Map
    ctrlBacktickDown(); // -> Dispatch
    ctrlBacktickDown(); // -> wraps back to Records
    ctrlUp();
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(zIndexOf(items, 'Records')).toBeGreaterThan(zIndexOf(items, 'Live Map'));
    expect(zIndexOf(items, 'Records')).toBeGreaterThan(zIndexOf(items, 'Dispatch'));
  });

  it('Ctrl+Shift+` reverses direction', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-dispatch'));
    fireEvent.click(screen.getByText('open-map'));
    fireEvent.click(screen.getByText('open-records'));
    // MRU order: Records (front), Live Map, Dispatch — reverse from front lands on Dispatch
    ctrlBacktickDown(true);
    ctrlUp();
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(zIndexOf(items, 'Dispatch')).toBeGreaterThan(zIndexOf(items, 'Live Map'));
    expect(zIndexOf(items, 'Dispatch')).toBeGreaterThan(zIndexOf(items, 'Records'));
  });

  it('does nothing when no windows are open', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    ctrlBacktickDown();
    expect(screen.queryByTestId('window-switcher-overlay')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowSwitcher.test.tsx`
Expected: FAIL — `DesktopWindowSwitcher.tsx` doesn't exist yet.

- [ ] **Step 3: Add `getWindowIconByPath` to `windowManager.ts`**

In `client/src/utils/windowManager.ts`, add this export directly after the existing `isWindowablePath` function (which already sits near `NAV_FUNCTION_BY_PATH`):

```ts
export function getWindowIconByPath(path: string): NavFunction['icon'] | undefined {
  return NAV_FUNCTION_BY_PATH[path]?.icon;
}
```

`NavFunction` is already imported in this file (used by the existing `getWindowConfig`/`activateNavFunction` signatures) and `NAV_FUNCTION_BY_PATH` already exists as a module-level constant — no new imports needed.

- [ ] **Step 4: Create `DesktopWindowSwitcher.tsx`**

```tsx
// client/src/components/desktop/DesktopWindowSwitcher.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDesktopWindows } from './DesktopWindowManager';
import { getWindowIconByPath } from '../../utils/windowManager';

export default function DesktopWindowSwitcher() {
  const { windows, focusWindow } = useDesktopWindows();
  const [cycling, setCycling] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const mruWindows = useMemo(
    () => [...windows].sort((a, b) => b.zIndex - a.zIndex),
    [windows],
  );

  const advance = useCallback((direction: 1 | -1) => {
    if (mruWindows.length === 0) return;
    setCycling(true);
    setHighlightIndex(prev => (prev + direction + mruWindows.length) % mruWindows.length);
  }, [mruWindows.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== '`') return;
      e.preventDefault();
      advance(e.shiftKey ? -1 : 1);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Control') return;
      if (cycling && mruWindows[highlightIndex]) {
        focusWindow(mruWindows[highlightIndex].id);
      }
      setCycling(false);
      setHighlightIndex(0);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [advance, cycling, highlightIndex, mruWindows, focusWindow]);

  if (!cycling || mruWindows.length === 0) return null;

  return (
    <div
      data-testid="window-switcher-overlay"
      style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        display: 'flex', gap: 8, padding: 12, background: 'var(--surface-raised)',
        border: '1px solid var(--border-strong)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 5000,
      }}
    >
      {mruWindows.map((w, i) => {
        const Icon = getWindowIconByPath(w.path);
        return (
          <div
            key={w.id}
            aria-current={i === highlightIndex ? 'true' : undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 8, width: 88,
              background: i === highlightIndex ? 'rgba(var(--rmpg-500-rgb),0.25)' : 'transparent',
              border: i === highlightIndex ? '1px solid var(--brand-400)' : '1px solid transparent',
            }}
          >
            <div className="flex items-center justify-center" style={{ width: 32, height: 32, background: 'rgba(var(--rmpg-500-rgb),0.1)' }}>
              {Icon && <Icon className="w-4 h-4" style={{ color: 'var(--rmpg-300)' }} />}
            </div>
            <span className="text-[10px] truncate" style={{ color: 'var(--text-primary)', maxWidth: 80 }}>{w.title}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Wire it into `DesktopPage.tsx`**

Replace:

```tsx
import FloatingWindow from '../components/desktop/FloatingWindow';
```

with:

```tsx
import FloatingWindow from '../components/desktop/FloatingWindow';
import DesktopWindowSwitcher from '../components/desktop/DesktopWindowSwitcher';
```

Replace:

```tsx
              <DesktopWidgetPanel widgets={widgets} catalog={allFunctions} onMoveWidget={handleMoveWidget} onAdjustWidget={handleAdjustWidget} />
              <WindowLayer />
            </DesktopWallpaper>
```

with:

```tsx
              <DesktopWidgetPanel widgets={widgets} catalog={allFunctions} onMoveWidget={handleMoveWidget} onAdjustWidget={handleAdjustWidget} />
              <WindowLayer />
              <DesktopWindowSwitcher />
            </DesktopWallpaper>
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowSwitcher.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add client/src/components/desktop/DesktopWindowSwitcher.tsx client/src/components/desktop/DesktopWindowSwitcher.test.tsx client/src/utils/windowManager.ts client/src/pages/DesktopPage.tsx
git commit -m "desktop: add Ctrl+\` window cycling with MRU switcher overlay"
```

---

## Task 2: Multi-Monitor Pop-Out Placement

**Files:**
- Create: `client/src/utils/multiMonitor.ts`
- Create: `client/src/utils/multiMonitor.test.ts`
- Modify: `client/src/utils/windowManager.ts`

**Interfaces:**
- Produces: `isMultiMonitorSupported(): boolean`, `isMultiMonitorEnabled(): boolean`, `requestMultiMonitorAccess(): Promise<boolean>`, `getSecondaryScreenBounds(): { left: number; top: number; width: number; height: number } | null` — consumed by Task 4 (Settings UI) and this task's own `openDetachedWindow` wiring.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/multiMonitor.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isMultiMonitorSupported,
  isMultiMonitorEnabled,
  requestMultiMonitorAccess,
  getSecondaryScreenBounds,
} from './multiMonitor';

const PRIMARY = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080, isPrimary: true };
const SECONDARY = { availLeft: 1920, availTop: 0, availWidth: 1280, availHeight: 1024, isPrimary: false };

describe('multiMonitor', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).getScreenDetails;
  });
  afterEach(() => {
    delete (window as any).getScreenDetails;
  });

  it('reports unsupported when the Window Management API is absent', () => {
    expect(isMultiMonitorSupported()).toBe(false);
    expect(getSecondaryScreenBounds()).toBeNull();
  });

  it('reports supported when the API is present', () => {
    (window as any).getScreenDetails = vi.fn();
    expect(isMultiMonitorSupported()).toBe(true);
  });

  it('is disabled until requestMultiMonitorAccess succeeds', () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY, SECONDARY], currentScreen: PRIMARY });
    expect(isMultiMonitorEnabled()).toBe(false);
    expect(getSecondaryScreenBounds()).toBeNull();
  });

  it('requestMultiMonitorAccess grants access and persists the enabled flag', async () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY, SECONDARY], currentScreen: PRIMARY });
    const granted = await requestMultiMonitorAccess();
    expect(granted).toBe(true);
    expect(isMultiMonitorEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_multi_monitor')).toBe('1');
  });

  it('getSecondaryScreenBounds returns the non-primary screen bounds once granted', async () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY, SECONDARY], currentScreen: PRIMARY });
    await requestMultiMonitorAccess();
    expect(getSecondaryScreenBounds()).toEqual({ left: 1920, top: 0, width: 1280, height: 1024 });
  });

  it('returns null when the user denies the permission prompt', async () => {
    (window as any).getScreenDetails = vi.fn().mockRejectedValue(new Error('denied'));
    const granted = await requestMultiMonitorAccess();
    expect(granted).toBe(false);
    expect(isMultiMonitorEnabled()).toBe(false);
    expect(getSecondaryScreenBounds()).toBeNull();
  });

  it('returns null on a single-screen setup even when enabled', async () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY], currentScreen: PRIMARY });
    await requestMultiMonitorAccess();
    expect(getSecondaryScreenBounds()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/utils/multiMonitor.test.ts`
Expected: FAIL — `multiMonitor.ts` doesn't exist yet.

- [ ] **Step 3: Create `multiMonitor.ts`**

```ts
// client/src/utils/multiMonitor.ts
// Wraps the browser's Window Management API (getScreenDetails), which lets a
// page enumerate physical screens and open a *new* window.open() window
// targeting a specific one. It cannot make an in-page floating panel span a
// second monitor — see docs/superpowers/specs/2026-07-20-desktop-window-management-polish-design.md
// Section B for the full reasoning. Chromium-only; Safari/Firefox always
// report unsupported.

const STORAGE_KEY = 'rmpg_desktop_multi_monitor';

interface ScreenBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Minimal shape of the experimental Window Management API's ScreenDetails —
// not yet in lib.dom.d.ts, so declared locally.
interface ScreenDetailedShape {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
}
interface ScreenDetailsShape {
  screens: ScreenDetailedShape[];
  currentScreen: ScreenDetailedShape;
}

declare global {
  interface Window {
    getScreenDetails?: () => Promise<ScreenDetailsShape>;
  }
}

let cachedDetails: ScreenDetailsShape | null = null;

export function isMultiMonitorSupported(): boolean {
  return typeof window !== 'undefined' && 'getScreenDetails' in window;
}

export function isMultiMonitorEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export async function requestMultiMonitorAccess(): Promise<boolean> {
  if (!isMultiMonitorSupported()) return false;
  try {
    cachedDetails = await window.getScreenDetails!();
    localStorage.setItem(STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous by design so it can slot into openDetachedWindow's existing
 * synchronous call site without restructuring it into async. If the
 * in-memory cache hasn't been populated yet this page load (e.g. right after
 * a fresh reload, before any pop-out has happened), this returns null for
 * that first call and kicks off a background re-fetch — already-granted
 * permission doesn't require a fresh user gesture, so this is safe to fire
 * here. Subsequent calls in the same page session then succeed.
 */
export function getSecondaryScreenBounds(): ScreenBounds | null {
  if (!isMultiMonitorEnabled()) return null;
  if (!cachedDetails) {
    void requestMultiMonitorAccess();
    return null;
  }
  const secondary = cachedDetails.screens.find(s => !s.isPrimary);
  if (!secondary) return null;
  return { left: secondary.availLeft, top: secondary.availTop, width: secondary.availWidth, height: secondary.availHeight };
}
```

- [ ] **Step 4: Wire `openDetachedWindow` to use it**

In `client/src/utils/windowManager.ts`, add the import at the top (alongside the existing `navCatalog` import):

```ts
import { getSecondaryScreenBounds } from './multiMonitor';
```

Replace:

```ts
function openDetachedWindow(path: string, title: string, width = 1100, height = 850) {
  const left = Math.round((window.screen.width - width) / 2);
  const top = Math.round((window.screen.height - height) / 2);
```

with:

```ts
function openDetachedWindow(path: string, title: string, width = 1100, height = 850) {
  const secondary = getSecondaryScreenBounds();
  const left = secondary
    ? Math.round(secondary.left + (secondary.width - width) / 2)
    : Math.round((window.screen.width - width) / 2);
  const top = secondary
    ? Math.round(secondary.top + (secondary.height - height) / 2)
    : Math.round((window.screen.height - height) / 2);
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd client && npx vitest run src/utils/multiMonitor.test.ts src/utils/windowManager.test.ts`
Expected: PASS (both files — `windowManager.test.ts` should be unaffected since `getSecondaryScreenBounds()` returns `null` by default in the test environment, matching `openDetachedWindow`'s prior behavior exactly)

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/multiMonitor.ts client/src/utils/multiMonitor.test.ts client/src/utils/windowManager.ts
git commit -m "desktop: add multi-monitor pop-out placement via the Window Management API"
```

---

## Task 3: Snap-Left / Snap-Right

**Files:**
- Create: `client/src/utils/snapPreference.ts`
- Create: `client/src/utils/snapPreference.test.ts`
- Modify: `client/src/components/desktop/FloatingWindow.tsx`
- Modify: `client/src/components/desktop/FloatingWindow.test.tsx`

**Interfaces:**
- Produces: `isSnapEnabled(): boolean`, `setSnapEnabled(enabled: boolean): void` — consumed by this task's own drag logic and by Task 4 (Settings UI toggle).

- [ ] **Step 1: Write the failing test for `snapPreference.ts`**

Create `client/src/utils/snapPreference.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isSnapEnabled, setSnapEnabled } from './snapPreference';

describe('snapPreference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to enabled when nothing has been saved yet', () => {
    expect(isSnapEnabled()).toBe(true);
  });

  it('setSnapEnabled(false) persists and isSnapEnabled reflects it', () => {
    setSnapEnabled(false);
    expect(isSnapEnabled()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_snap_enabled')).toBe('0');
  });

  it('setSnapEnabled(true) persists and isSnapEnabled reflects it', () => {
    setSnapEnabled(false);
    setSnapEnabled(true);
    expect(isSnapEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_snap_enabled')).toBe('1');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/utils/snapPreference.test.ts`
Expected: FAIL — `snapPreference.ts` doesn't exist yet.

- [ ] **Step 3: Create `snapPreference.ts`**

```ts
// client/src/utils/snapPreference.ts
const STORAGE_KEY = 'rmpg_desktop_snap_enabled';

export function isSnapEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setSnapEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch { /* silent — sessionless devices just always see the default */ }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/utils/snapPreference.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for snap-drag behavior in `FloatingWindow.test.tsx`**

Add to `client/src/components/desktop/FloatingWindow.test.tsx`, as a new `describe` block after the existing `describe('FloatingWindow — title sync', ...)` block:

```tsx
describe('FloatingWindow — snap to edge', () => {
  // getByText('Dispatch') is the <span> inside the title-bar div; .closest('div')
  // from a <span> returns its nearest div ancestor, which IS the title-bar div
  // itself (the span has no wrapping div of its own) — this is the element
  // onTitleBarPointerDown is actually attached to.
  function dragTitleBarTo(clientX: number, clientY: number) {
    const titleBar = screen.getByText('Dispatch').closest('div')!;
    fireEvent.pointerDown(titleBar, { clientX: 500, clientY: 300 });
    fireEvent.pointerMove(window, { clientX, clientY });
  }
  function releaseDrag() {
    fireEvent.pointerUp(window);
  }

  it('shows a snap preview and snaps to the left half when dropped near the left edge', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(10, 300);
    expect(screen.getByTestId('snap-preview-left')).toBeInTheDocument();
    releaseDrag();
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.left).toBe('0px');
    expect(windowEl.style.width).toBe(`${window.innerWidth / 2}px`);
  });

  it('does not snap when the drop point is away from an edge', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(500, 300);
    expect(screen.queryByTestId('snap-preview-left')).not.toBeInTheDocument();
    expect(screen.queryByTestId('snap-preview-right')).not.toBeInTheDocument();
    releaseDrag();
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.width).not.toBe(`${window.innerWidth / 2}px`);
  });

  it('does not snap when snapping is disabled via preference', () => {
    setSnapEnabled(false);
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(10, 300);
    expect(screen.queryByTestId('snap-preview-left')).not.toBeInTheDocument();
    setSnapEnabled(true);
  });
});
```

Add the import at the top of `FloatingWindow.test.tsx`:

```tsx
import { setSnapEnabled } from '../../utils/snapPreference';
```

- [ ] **Step 6: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: FAIL — no `snap-preview-left` testid exists yet, and dragging to the edge doesn't resize the window.

- [ ] **Step 7: Implement snap-to-edge in `FloatingWindow.tsx`**

Replace:

```tsx
import React, { useCallback, useEffect, useRef } from 'react';
import { X, Minus, Square } from 'lucide-react';
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import { getWindowConfigByPath } from '../../utils/windowManager';

const TITLE_BAR_HEIGHT = 30;
const TITLE_SYNC_POLL_MS = 500;
```

with:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Minus, Square } from 'lucide-react';
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import { getWindowConfigByPath } from '../../utils/windowManager';
import { isSnapEnabled } from '../../utils/snapPreference';

const TITLE_BAR_HEIGHT = 30;
const TITLE_SYNC_POLL_MS = 500;
const SNAP_EDGE_THRESHOLD = 24;
const TASKBAR_HEIGHT = 48;
const MIN_SNAP_HALF_WIDTH = 360;
```

Replace:

```tsx
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
```

with:

```tsx
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [snapPreview, setSnapPreview] = useState<'left' | 'right' | null>(null);
  // Captured the instant a snap is applied — lets a subsequent drag "pull the
  // window away" from the edge to restore its pre-snap bounds, matching the
  // real OS un-snap feel. Not persisted: a transient drag-interaction detail.
  const preSnapBounds = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const snappedSide = useRef<'left' | 'right' | null>(null);
  // Tracks the window's live position during a title-bar drag (title-bar
  // drags never change width/height, only x/y) — needed because win.x/win.y
  // in this closure are stale (captured at pointerdown), but preSnapBounds
  // must reflect wherever the window actually is at the moment of release.
  const liveDragPos = useRef({ x: win.x, y: win.y });
```

Replace:

```tsx
  const onTitleBarPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    focusWindow(win.id);
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: win.x, originY: win.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const nextX = Math.max(0, dragState.current.originX + dx);
      const nextY = Math.max(0, dragState.current.originY + dy);
      moveResize(win.id, { x: nextX, y: nextY });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [win.id, win.x, win.y, focusWindow, moveResize]);
```

with:

```tsx
  const onTitleBarPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    focusWindow(win.id);
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: win.x, originY: win.y };
    liveDragPos.current = { x: win.x, y: win.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      let nextX = Math.max(0, dragState.current.originX + dx);
      const nextY = Math.max(0, dragState.current.originY + dy);

      if (isSnapEnabled()) {
        if (ev.clientX <= SNAP_EDGE_THRESHOLD) {
          setSnapPreview('left');
        } else if (ev.clientX >= window.innerWidth - SNAP_EDGE_THRESHOLD) {
          setSnapPreview('right');
        } else {
          setSnapPreview(null);
        }

        // Un-snap: dragging a currently-snapped window away from the edge
        // restores its pre-snap size before continuing the drag normally.
        if (snappedSide.current && Math.abs(dx) > SNAP_EDGE_THRESHOLD) {
          const restore = preSnapBounds.current;
          snappedSide.current = null;
          preSnapBounds.current = null;
          if (restore) {
            nextX = restore.x;
            moveResize(win.id, { x: nextX, y: nextY, width: restore.width, height: restore.height });
            liveDragPos.current = { x: nextX, y: nextY };
            return;
          }
        }
      }

      moveResize(win.id, { x: nextX, y: nextY });
      liveDragPos.current = { x: nextX, y: nextY };
    };
    const onUp = () => {
      if (snapPreview) {
        const desktopHeight = window.innerHeight - TASKBAR_HEIGHT;
        const halfWidth = window.innerWidth / 2;
        if (halfWidth >= MIN_SNAP_HALF_WIDTH) {
          preSnapBounds.current = { x: liveDragPos.current.x, y: liveDragPos.current.y, width: win.width, height: win.height };
          snappedSide.current = snapPreview;
          moveResize(win.id, {
            x: snapPreview === 'left' ? 0 : halfWidth,
            y: 0,
            width: halfWidth,
            height: desktopHeight,
          });
        }
        setSnapPreview(null);
      }
      dragState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [win.id, win.x, win.y, win.width, win.height, focusWindow, moveResize, snapPreview]);
```

Replace the component's `return` statement's outer wrapper — currently a single root `<div>`. Replace:

```tsx
  return (
    <div
      style={{ ...style, background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
      onPointerDown={(e) => {
```

with:

```tsx
  return (
    <>
    {snapPreview && (
      <div
        data-testid={`snap-preview-${snapPreview}`}
        style={{
          position: 'fixed', top: 0, left: snapPreview === 'left' ? 0 : '50%',
          width: '50%', height: `calc(100vh - ${TASKBAR_HEIGHT}px)`,
          background: 'rgba(var(--rmpg-500-rgb),0.15)', border: '2px solid var(--brand-400)',
          zIndex: 4999, pointerEvents: 'none',
        }}
      />
    )}
    <div
      style={{ ...style, background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
      onPointerDown={(e) => {
```

Finally, close the new outer `<>` fragment. Replace the component's last two lines:

```tsx
    </div>
  );
}
```

with:

```tsx
    </div>
    </>
  );
}
```

- [ ] **Step 8: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: PASS (all tests in the file, including the 3 new snap tests)

- [ ] **Step 9: Run the client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add client/src/utils/snapPreference.ts client/src/utils/snapPreference.test.ts client/src/components/desktop/FloatingWindow.tsx client/src/components/desktop/FloatingWindow.test.tsx
git commit -m "desktop: add snap-to-edge (snap-left/snap-right) with un-snap-on-drag-away"
```

---

## Task 4: Wire the Settings App's "Window Management" Category

**Files:**
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx`
- Modify: `client/src/components/desktop/DesktopSettingsApp.test.tsx`

**Interfaces:**
- Consumes: `isSnapEnabled`/`setSnapEnabled` (Task 3), `isMultiMonitorSupported`/`isMultiMonitorEnabled`/`requestMultiMonitorAccess` (Task 2).

- [ ] **Step 1: Update the existing stale test**

The current test asserts the OLD placeholder text, which this task removes. In `client/src/components/desktop/DesktopSettingsApp.test.tsx`, replace:

```tsx
  it('Window Management category shows a placeholder and calls no callbacks', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    expect(screen.getByText(/coming in a future phase/i)).toBeInTheDocument();
    expect(props.onIconSizeChange).not.toHaveBeenCalled();
    expect(props.onWallpaperChange).not.toHaveBeenCalled();
  });
```

with:

```tsx
  it('Window Management category shows cycling info, a snap toggle, and multi-monitor status, calling no personalization callbacks', () => {
    const props = renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    expect(screen.getByText(/cycle through open windows/i)).toBeInTheDocument();
    expect(screen.getByText(/Drag a window to a screen edge/i)).toBeInTheDocument();
    expect(screen.getByText(/not supported in this browser/i)).toBeInTheDocument();
    expect(props.onIconSizeChange).not.toHaveBeenCalled();
    expect(props.onWallpaperChange).not.toHaveBeenCalled();
  });

  it('toggling snap-to-edge persists to localStorage', () => {
    renderApp();
    fireEvent.click(screen.getByText('Window Management'));
    const checkbox = screen.getByLabelText(/Drag a window to a screen edge/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_snap_enabled')).toBe('0');
    fireEvent.click(checkbox);
  });
```

(The "not supported in this browser" assertion is correct for this test environment: jsdom has no `getScreenDetails`, so `isMultiMonitorSupported()` is always `false` here — same as real Safari/Firefox users.)

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: FAIL — the new assertions don't match the still-placeholder content.

- [ ] **Step 3: Wire real content into `DesktopSettingsApp.tsx`**

Replace:

```tsx
import React, { useState, useRef, useCallback } from 'react';
import { Sliders, LayoutGrid, AppWindow, FolderKanban, X } from 'lucide-react';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { DESKTOP_WALLPAPERS } from '../../data/desktopWallpapers';
import { DESKTOP_ACCENTS } from '../../data/desktopAccents';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
```

with:

```tsx
import React, { useState, useRef, useCallback } from 'react';
import { Sliders, LayoutGrid, AppWindow, FolderKanban, X } from 'lucide-react';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { DESKTOP_WALLPAPERS } from '../../data/desktopWallpapers';
import { DESKTOP_ACCENTS } from '../../data/desktopAccents';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
import { isSnapEnabled, setSnapEnabled } from '../../utils/snapPreference';
import { isMultiMonitorSupported, isMultiMonitorEnabled, requestMultiMonitorAccess } from '../../utils/multiMonitor';
```

Replace:

```tsx
  const [activeCategory, setActiveCategory] = useState<CategoryId>('personalization');
  const [pos, setPos] = useState(() => ({
```

with:

```tsx
  const [activeCategory, setActiveCategory] = useState<CategoryId>('personalization');
  const [snapEnabled, setSnapEnabledState] = useState(() => isSnapEnabled());
  const [multiMonitorEnabled, setMultiMonitorEnabledState] = useState(() => isMultiMonitorEnabled());
  const multiMonitorSupported = isMultiMonitorSupported();
  const [pos, setPos] = useState(() => ({
```

Replace:

```tsx
          {activeCategory === 'window-management' && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Window cycling and multi-monitor placement are coming in a future phase.
            </div>
          )}
```

with:

```tsx
          {activeCategory === 'window-management' && (
            <div>
              <div className="text-[10px] font-semibold uppercase mb-1" style={sectionLabelStyle()}>Window Cycling</div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Hold Ctrl and press ` to cycle through open windows; Ctrl+Shift+` cycles in reverse.
              </p>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Snap to Edge</div>
              <label className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  checked={snapEnabled}
                  onChange={(e) => { setSnapEnabled(e.target.checked); setSnapEnabledState(e.target.checked); }}
                />
                Drag a window to a screen edge to snap it to half the desktop
              </label>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Multi-Monitor</div>
              {multiMonitorSupported ? (
                <button
                  type="button"
                  onClick={async () => {
                    const granted = await requestMultiMonitorAccess();
                    setMultiMonitorEnabledState(granted || isMultiMonitorEnabled());
                  }}
                  className="text-[10px] px-2 py-1"
                  style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                >
                  {multiMonitorEnabled ? 'Secondary-monitor pop-outs enabled' : 'Enable secondary-monitor pop-outs'}
                </button>
              ) : (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Not supported in this browser.</p>
              )}
            </div>
          )}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS (all tests, including the 2 updated/new ones)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/components/desktop/DesktopSettingsApp.test.tsx
git commit -m "desktop: wire real controls into Settings' Window Management category"
```

---

## Task 5: Show Desktop

**Files:**
- Modify: `client/src/components/desktop/DesktopWindowManager.tsx`
- Modify: `client/src/components/desktop/DesktopWindowManager.test.tsx`
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Modify: `client/src/components/desktop/DesktopTaskbar.test.tsx`

**Interfaces:**
- Produces: `minimizeAll(): string[]` (returns the ids it minimized), `restoreAll(ids: string[]): void` on `DesktopWindowManagerContextValue`.

- [ ] **Step 1: Write the failing test for the context actions**

In `client/src/components/desktop/DesktopWindowManager.test.tsx`, add to the `Harness` function (after the existing `retitle-first` button):

```tsx
      <button onClick={() => { const ids = minimizeAll(); lastMinimizedIds.current = ids; }}>minimize-all</button>
      <button onClick={() => restoreAll(lastMinimizedIds.current)}>restore-all</button>
```

and destructure the two new actions plus add a ref, updating the top of `Harness`:

```tsx
function Harness() {
  const { windows, openWindow, closeWindow, focusWindow, minimizeWindow, updateWindowTitle, minimizeAll, restoreAll } = useDesktopWindows();
  const capResults = useRef<boolean[]>([]);
  const lastMinimizedIds = useRef<string[]>([]);
```

Add this test to the `describe('DesktopWindowManager', ...)` block:

```ts
  it('minimizeAll minimizes only non-minimized windows and returns their ids; restoreAll un-minimizes exactly those', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('open-map').click());
    act(() => screen.getByText('minimize-first').click()); // manually minimize Dispatch first
    act(() => screen.getByText('minimize-all').click());
    // Both should now be minimized (Dispatch was already, Live Map just got minimized)
    expect(screen.getAllByText(/-min-/).length).toBe(2);
    act(() => screen.getByText('restore-all').click());
    // restoreAll should only un-minimize what minimizeAll actually touched (Live Map) —
    // Dispatch, which the user had manually minimized beforehand, stays minimized.
    const items = screen.getAllByRole('listitem').map(li => li.textContent!);
    expect(items.find(t => t.startsWith('Dispatch-'))).toMatch(/-min-/);
    expect(items.find(t => t.startsWith('Live Map-'))).not.toMatch(/-min-/);
  });

  it('minimizeAll with zero open windows returns an empty array and is a no-op', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('minimize-all').click());
    expect(screen.getAllByRole('listitem').length).toBe(0);
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: FAIL — `minimizeAll is not a function`.

- [ ] **Step 3: Implement `minimizeAll`/`restoreAll` in `DesktopWindowManager.tsx`**

Replace:

```ts
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => void;
  /** Updates a window's display title only — never its path/iframe src. See FloatingWindow.tsx's title-sync effect for why those must stay decoupled. */
  updateWindowTitle: (id: string, title: string) => void;
}
```

with:

```ts
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => void;
  /** Updates a window's display title only — never its path/iframe src. See FloatingWindow.tsx's title-sync effect for why those must stay decoupled. */
  updateWindowTitle: (id: string, title: string) => void;
  /** Minimizes every currently non-minimized window and returns the ids it touched, so a caller can later restore exactly those and leave anything the user had already minimized alone. */
  minimizeAll: () => string[];
  restoreAll: (ids: string[]) => void;
}
```

Replace:

```ts
  const updateWindowTitle = useCallback((id: string, title: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, title } : w));
  }, [commit]);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle }}
    >
```

with:

```ts
  const updateWindowTitle = useCallback((id: string, title: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, title } : w));
  }, [commit]);

  const minimizeAll = useCallback(() => {
    const prev = windowsRef.current;
    const toMinimize = prev.filter(w => !w.minimized).map(w => w.id);
    if (toMinimize.length === 0) return [];
    commit(prev.map(w => toMinimize.includes(w.id) ? { ...w, minimized: true } : w));
    return toMinimize;
  }, [commit]);

  const restoreAll = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    commit(windowsRef.current.map(w => ids.includes(w.id) ? { ...w, minimized: false } : w));
  }, [commit]);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, minimizeAll, restoreAll }}
    >
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for the taskbar button**

Add to `client/src/components/desktop/DesktopTaskbar.test.tsx`, a new `describe` block:

```tsx
describe('DesktopTaskbar — Show Desktop', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('clicking Show Desktop minimizes every open window; clicking again restores them', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByText('simulate-open'));
    fireEvent.click(screen.getByLabelText('Show desktop'));
    expect(screen.getByLabelText('Show windows')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show windows'));
    expect(screen.getByLabelText('Show desktop')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: FAIL — no "Show desktop" button exists yet.

- [ ] **Step 7: Add the Show Desktop button to `DesktopTaskbar.tsx`**

Replace:

```tsx
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Grid3X3, Bell, Clock as ClockIcon, Radio, FileWarning } from 'lucide-react';
```

with:

```tsx
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Grid3X3, Bell, Clock as ClockIcon, Radio, FileWarning, Monitor } from 'lucide-react';
```

Replace:

```tsx
  const { windows, focusWindow, openWindow } = useDesktopWindows();
```

with:

```tsx
  const { windows, focusWindow, openWindow, minimizeAll, restoreAll } = useDesktopWindows();
  const [autoMinimizedIds, setAutoMinimizedIds] = useState<string[]>([]);

  const handleShowDesktop = useCallback(() => {
    if (autoMinimizedIds.length > 0) {
      restoreAll(autoMinimizedIds);
      setAutoMinimizedIds([]);
    } else {
      setAutoMinimizedIds(minimizeAll());
    }
  }, [autoMinimizedIds, minimizeAll, restoreAll]);
```

Replace:

```tsx
      <div className="flex items-center gap-3">
        <div className="relative">
          <Bell className="w-4 h-4" style={{ color: 'var(--rmpg-400)' }} />
```

with:

```tsx
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={autoMinimizedIds.length > 0 ? 'Show windows' : 'Show desktop'}
          onClick={handleShowDesktop}
          className="p-1.5 hover:bg-surface-hover"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <Monitor className="w-3.5 h-3.5" style={{ color: 'var(--rmpg-400)' }} />
        </button>
        <div className="relative">
          <Bell className="w-4 h-4" style={{ color: 'var(--rmpg-400)' }} />
```

- [ ] **Step 8: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx src/components/desktop/DesktopTaskbar.commandBar.test.tsx`
Expected: PASS (both files)

- [ ] **Step 9: Commit**

```bash
git add client/src/components/desktop/DesktopWindowManager.tsx client/src/components/desktop/DesktopWindowManager.test.tsx client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/DesktopTaskbar.test.tsx
git commit -m "desktop: add Show Desktop taskbar button (minimize/restore all)"
```

---

## Task 6: Always-On-Top Pin

**Files:**
- Modify: `client/src/components/desktop/DesktopWindowManager.tsx`
- Modify: `client/src/components/desktop/DesktopWindowManager.test.tsx`
- Modify: `client/src/components/desktop/FloatingWindow.tsx`
- Modify: `client/src/components/desktop/FloatingWindow.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DesktopWindowState.alwaysOnTop: boolean`, `toggleAlwaysOnTop(id: string): void` on `DesktopWindowManagerContextValue`.

- [ ] **Step 1: Write the failing test for the context action**

In `client/src/components/desktop/DesktopWindowManager.test.tsx`, add to `Harness`:

```tsx
      <button onClick={() => windows[0] && toggleAlwaysOnTop(windows[0].id)}>toggle-pin-first</button>
      <span data-testid="first-pinned">{windows[0]?.alwaysOnTop ? 'pinned' : 'unpinned'}</span>
```

and destructure `toggleAlwaysOnTop` in `Harness`'s hook call (add it to the existing destructure list).

Add this test:

```ts
  it('toggleAlwaysOnTop flips a window\'s pinned state', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-pinned').textContent).toBe('unpinned');
    act(() => screen.getByText('toggle-pin-first').click());
    expect(screen.getByTestId('first-pinned').textContent).toBe('pinned');
    act(() => screen.getByText('toggle-pin-first').click());
    expect(screen.getByTestId('first-pinned').textContent).toBe('unpinned');
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: FAIL — `toggleAlwaysOnTop is not a function`.

- [ ] **Step 3: Add `alwaysOnTop` and `toggleAlwaysOnTop` to `DesktopWindowManager.tsx`**

Replace:

```ts
export interface DesktopWindowState {
  id: string;
  path: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
}
```

with:

```ts
export interface DesktopWindowState {
  id: string;
  path: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  alwaysOnTop: boolean;
  opacity: number;
}
```

(`opacity` is added here too, in the same interface edit, since Task 7 needs it on the same interface — Task 7's own steps set its behavior; this task only needs to not break the type by adding `alwaysOnTop` alone. Both fields are required on the type, with explicit defaults set at window-creation time below — see the Global Constraints note on why `undefined` from old sessionStorage entries is still safe.)

Replace:

```ts
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => void;
  /** Updates a window's display title only — never its path/iframe src. See FloatingWindow.tsx's title-sync effect for why those must stay decoupled. */
  updateWindowTitle: (id: string, title: string) => void;
  /** Minimizes every currently non-minimized window and returns the ids it touched, so a caller can later restore exactly those and leave anything the user had already minimized alone. */
  minimizeAll: () => string[];
  restoreAll: (ids: string[]) => void;
}
```

with:

```ts
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => void;
  /** Updates a window's display title only — never its path/iframe src. See FloatingWindow.tsx's title-sync effect for why those must stay decoupled. */
  updateWindowTitle: (id: string, title: string) => void;
  /** Minimizes every currently non-minimized window and returns the ids it touched, so a caller can later restore exactly those and leave anything the user had already minimized alone. */
  minimizeAll: () => string[];
  restoreAll: (ids: string[]) => void;
  toggleAlwaysOnTop: (id: string) => void;
}
```

Replace the `win` object literal inside `openWindow`:

```ts
      const win: DesktopWindowState = {
        id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        path, title,
        x: 80 + offset, y: 60 + offset,
        width: size?.width ?? 1050, height: size?.height ?? 800,
        zIndex: nextZIndex, minimized: false, maximized: false,
      };
```

with:

```ts
      const win: DesktopWindowState = {
        id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        path, title,
        x: 80 + offset, y: 60 + offset,
        width: size?.width ?? 1050, height: size?.height ?? 800,
        zIndex: nextZIndex, minimized: false, maximized: false,
        alwaysOnTop: false, opacity: 1,
      };
```

Replace:

```ts
  const restoreAll = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    commit(windowsRef.current.map(w => ids.includes(w.id) ? { ...w, minimized: false } : w));
  }, [commit]);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, minimizeAll, restoreAll }}
    >
```

with:

```ts
  const restoreAll = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    commit(windowsRef.current.map(w => ids.includes(w.id) ? { ...w, minimized: false } : w));
  }, [commit]);

  const toggleAlwaysOnTop = useCallback((id: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, alwaysOnTop: !w.alwaysOnTop } : w));
  }, [commit]);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, minimizeAll, restoreAll, toggleAlwaysOnTop }}
    >
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: PASS (note: this will still show a TypeScript error at this point since `FloatingWindow.tsx` hasn't been updated to handle the now-required `opacity` field's usage — that's fine, Step 3 above already gave every window a concrete `opacity: 1` default, so no runtime issue; the type is satisfied. Confirm with `cd client && npx tsc --noEmit` after this step too.)

- [ ] **Step 5: Write the failing test for the pin button and rendering effect**

Add to `client/src/components/desktop/FloatingWindow.test.tsx`, a new `describe` block:

```tsx
describe('FloatingWindow — always-on-top', () => {
  it('clicking the pin button toggles the aria-label between Pin and Unpin', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByLabelText('Pin Dispatch on top')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Pin Dispatch on top'));
    expect(screen.getByLabelText('Unpin Dispatch')).toBeInTheDocument();
  });

  it('a pinned-but-unfocused window renders above an unpinned, more-recently-focused window', () => {
    function Harness2() {
      const { windows, openWindow, focusWindow } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open-a</button>
          <button onClick={() => openWindow('/map', 'Live Map')}>open-b</button>
          <button onClick={() => windows[1] && focusWindow(windows[1].id)}>focus-second</button>
          {windows.map(w => <FloatingWindow key={w.id} win={w} />)}
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness2 /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open-a'));
    fireEvent.click(screen.getByText('open-b'));
    fireEvent.click(screen.getByLabelText('Pin Dispatch on top'));
    fireEvent.click(screen.getByText('focus-second'));
    const dispatchWindowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    const mapWindowEl = screen.getByTitle('Live Map').parentElement as HTMLElement;
    expect(parseInt(dispatchWindowEl.style.zIndex, 10)).toBeGreaterThan(parseInt(mapWindowEl.style.zIndex, 10));
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: FAIL — no pin button exists yet.

- [ ] **Step 7: Add the pin button and effective z-index to `FloatingWindow.tsx`**

Replace:

```tsx
import { X, Minus, Square } from 'lucide-react';
```

with:

```tsx
import { X, Minus, Square, Pin, PinOff } from 'lucide-react';
```

Replace:

```tsx
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle } = useDesktopWindows();
```

with:

```tsx
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, toggleAlwaysOnTop } = useDesktopWindows();
```

Replace:

```tsx
  const style: React.CSSProperties = win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: 48, zIndex: win.zIndex }
    : {
        position: 'fixed', left: win.x, top: win.y,
        width: win.width, height: win.minimized ? TITLE_BAR_HEIGHT : win.height,
        zIndex: win.zIndex,
      };
```

with:

```tsx
  // Pinned windows always render above unpinned ones, regardless of normal
  // focus-based zIndex — a flat offset large enough to clear any realistic
  // focus-order zIndex value keeps focus order working correctly *within*
  // each of the two bands (pinned vs. unpinned) while pinned always wins
  // across them.
  const effectiveZIndex = win.zIndex + (win.alwaysOnTop ? 10000 : 0);
  const style: React.CSSProperties = win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: 48, zIndex: effectiveZIndex }
    : {
        position: 'fixed', left: win.x, top: win.y,
        width: win.width, height: win.minimized ? TITLE_BAR_HEIGHT : win.height,
        zIndex: effectiveZIndex,
      };
```

Replace:

```tsx
          <button type="button" aria-label={`Minimize ${win.title}`} onClick={() => minimizeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <Minus className="w-3 h-3" style={{ color: 'var(--rmpg-400)' }} />
          </button>
```

with:

```tsx
          <button
            type="button"
            aria-label={win.alwaysOnTop ? `Unpin ${win.title}` : `Pin ${win.title} on top`}
            onClick={() => toggleAlwaysOnTop(win.id)}
            className="p-1 hover:bg-surface-hover"
          >
            {win.alwaysOnTop ? <Pin className="w-3 h-3" style={{ color: 'var(--brand-400)' }} /> : <PinOff className="w-3 h-3" style={{ color: 'var(--rmpg-400)' }} />}
          </button>
          <button type="button" aria-label={`Minimize ${win.title}`} onClick={() => minimizeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <Minus className="w-3 h-3" style={{ color: 'var(--rmpg-400)' }} />
          </button>
```

- [ ] **Step 8: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 9: Run the full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/desktop/DesktopWindowManager.tsx client/src/components/desktop/DesktopWindowManager.test.tsx client/src/components/desktop/FloatingWindow.tsx client/src/components/desktop/FloatingWindow.test.tsx
git commit -m "desktop: add always-on-top window pinning"
```

---

## Task 7: Per-Window Opacity

**Files:**
- Modify: `client/src/components/desktop/DesktopWindowManager.tsx`
- Modify: `client/src/components/desktop/DesktopWindowManager.test.tsx`
- Modify: `client/src/components/desktop/FloatingWindow.tsx`
- Modify: `client/src/components/desktop/FloatingWindow.test.tsx`

**Interfaces:**
- Consumes: `DesktopWindowState.opacity` (already added to the interface and given a default in Task 6, Step 3 — this task adds the setter and the UI).
- Produces: `setWindowOpacity(id: string, opacity: number): void` on `DesktopWindowManagerContextValue`, clamped to `0.3`–`1`.

- [ ] **Step 1: Write the failing test for the context action**

In `client/src/components/desktop/DesktopWindowManager.test.tsx`, add to `Harness`:

```tsx
      <button onClick={() => windows[0] && setWindowOpacity(windows[0].id, 2)}>set-opacity-too-high</button>
      <button onClick={() => windows[0] && setWindowOpacity(windows[0].id, 0)}>set-opacity-too-low</button>
      <button onClick={() => windows[0] && setWindowOpacity(windows[0].id, 0.6)}>set-opacity-valid</button>
      <span data-testid="first-opacity">{windows[0]?.opacity ?? ''}</span>
```

and destructure `setWindowOpacity` in `Harness`'s hook call.

Add this test:

```ts
  it('setWindowOpacity clamps to the 0.3–1 range', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('1');
    act(() => screen.getByText('set-opacity-too-high').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('1');
    act(() => screen.getByText('set-opacity-too-low').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('0.3');
    act(() => screen.getByText('set-opacity-valid').click());
    expect(screen.getByTestId('first-opacity').textContent).toBe('0.6');
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: FAIL — `setWindowOpacity is not a function`.

- [ ] **Step 3: Implement `setWindowOpacity` in `DesktopWindowManager.tsx`**

Replace:

```ts
  restoreAll: (ids: string[]) => void;
  toggleAlwaysOnTop: (id: string) => void;
}
```

with:

```ts
  restoreAll: (ids: string[]) => void;
  toggleAlwaysOnTop: (id: string) => void;
  setWindowOpacity: (id: string, opacity: number) => void;
}
```

Replace:

```ts
const SESSION_KEY = 'rmpg_desktop_windows';
const MAX_OPEN_WINDOWS = 10;
```

with:

```ts
const SESSION_KEY = 'rmpg_desktop_windows';
const MAX_OPEN_WINDOWS = 10;
const MIN_WINDOW_OPACITY = 0.3;
const MAX_WINDOW_OPACITY = 1;

function clampOpacity(value: number): number {
  return Math.min(MAX_WINDOW_OPACITY, Math.max(MIN_WINDOW_OPACITY, value));
}
```

Replace:

```ts
  const toggleAlwaysOnTop = useCallback((id: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, alwaysOnTop: !w.alwaysOnTop } : w));
  }, [commit]);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, minimizeAll, restoreAll, toggleAlwaysOnTop }}
    >
```

with:

```ts
  const toggleAlwaysOnTop = useCallback((id: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, alwaysOnTop: !w.alwaysOnTop } : w));
  }, [commit]);

  const setWindowOpacity = useCallback((id: string, opacity: number) => {
    const clamped = clampOpacity(opacity);
    commit(windowsRef.current.map(w => w.id === id ? { ...w, opacity: clamped } : w));
  }, [commit]);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, minimizeAll, restoreAll, toggleAlwaysOnTop, setWindowOpacity }}
    >
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for the opacity context menu**

Add to `client/src/components/desktop/FloatingWindow.test.tsx`, a new `describe` block:

```tsx
describe('FloatingWindow — opacity', () => {
  it('applies win.opacity to the window\'s rendered style, defaulting to 1', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.opacity).toBe('1');
  });

  it('right-clicking the title bar offers Increase/Decrease opacity, which call setWindowOpacity', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    fireEvent.contextMenu(screen.getByText('Dispatch'));
    fireEvent.click(screen.getByText('Decrease opacity'));
    const windowEl = screen.getByTitle('Dispatch').parentElement as HTMLElement;
    expect(windowEl.style.opacity).toBe('0.9');
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: FAIL — no opacity style applied, no context menu on the title bar.

- [ ] **Step 7: Add the opacity style and context menu to `FloatingWindow.tsx`**

Replace:

```tsx
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import { getWindowConfigByPath } from '../../utils/windowManager';
import { isSnapEnabled } from '../../utils/snapPreference';
```

with:

```tsx
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import { getWindowConfigByPath } from '../../utils/windowManager';
import { isSnapEnabled } from '../../utils/snapPreference';
import ContextMenu from '../ContextMenu';
```

Replace:

```tsx
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, toggleAlwaysOnTop } = useDesktopWindows();
```

with:

```tsx
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, toggleAlwaysOnTop, setWindowOpacity } = useDesktopWindows();
```

Replace:

```tsx
  const effectiveZIndex = win.zIndex + (win.alwaysOnTop ? 10000 : 0);
  const style: React.CSSProperties = win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: 48, zIndex: effectiveZIndex }
    : {
        position: 'fixed', left: win.x, top: win.y,
        width: win.width, height: win.minimized ? TITLE_BAR_HEIGHT : win.height,
        zIndex: effectiveZIndex,
      };
```

with:

```tsx
  const effectiveZIndex = win.zIndex + (win.alwaysOnTop ? 10000 : 0);
  const style: React.CSSProperties = win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: 48, zIndex: effectiveZIndex, opacity: win.opacity ?? 1 }
    : {
        position: 'fixed', left: win.x, top: win.y,
        width: win.width, height: win.minimized ? TITLE_BAR_HEIGHT : win.height,
        zIndex: effectiveZIndex, opacity: win.opacity ?? 1,
      };
```

Replace:

```tsx
      <div
        onPointerDown={onTitleBarPointerDown}
        className="flex items-center justify-between px-2 select-none cursor-move"
        style={{ height: TITLE_BAR_HEIGHT, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{win.title}</span>
        <div className="flex items-center gap-1">
```

with:

```tsx
      <ContextMenu
        items={[
          { label: 'Increase opacity', onClick: () => setWindowOpacity(win.id, (win.opacity ?? 1) + 0.1) },
          { label: 'Decrease opacity', onClick: () => setWindowOpacity(win.id, (win.opacity ?? 1) - 0.1) },
        ]}
      >
      <div
        onPointerDown={onTitleBarPointerDown}
        className="flex items-center justify-between px-2 select-none cursor-move"
        style={{ height: TITLE_BAR_HEIGHT, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{win.title}</span>
        <div className="flex items-center gap-1">
```

Replace the closing of that same title-bar `<div>` — find:

```tsx
          <button type="button" aria-label={`Close ${win.title}`} onClick={() => closeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--rmpg-400))' }} />
          </button>
        </div>
      </div>
```

with:

```tsx
          <button type="button" aria-label={`Close ${win.title}`} onClick={() => closeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--rmpg-400))' }} />
          </button>
        </div>
      </div>
      </ContextMenu>
```

- [ ] **Step 8: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 9: Run the full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/desktop/DesktopWindowManager.tsx client/src/components/desktop/DesktopWindowManager.test.tsx client/src/components/desktop/FloatingWindow.tsx client/src/components/desktop/FloatingWindow.test.tsx
git commit -m "desktop: add per-window opacity (right-click title bar to adjust)"
```

---

## Task 8: Remembered Window Position

**Files:**
- Create: `client/src/utils/desktopWindowPositions.ts`
- Create: `client/src/utils/desktopWindowPositions.test.ts`
- Modify: `client/src/components/desktop/DesktopWindowManager.tsx`
- Modify: `client/src/components/desktop/DesktopWindowManager.test.tsx`

**Interfaces:**
- Produces: `getSavedPosition(path: string): { x: number; y: number; width: number; height: number } | null`, `saveWindowPosition(path: string, position: { x: number; y: number; width: number; height: number }): void`.

- [ ] **Step 1: Write the failing test for `desktopWindowPositions.ts`**

Create `client/src/utils/desktopWindowPositions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getSavedPosition, saveWindowPosition } from './desktopWindowPositions';

describe('desktopWindowPositions', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns null for a path with no saved position', () => {
    expect(getSavedPosition('/dispatch')).toBeNull();
  });

  it('saveWindowPosition persists and getSavedPosition retrieves it', () => {
    saveWindowPosition('/dispatch', { x: 300, y: 200, width: 900, height: 700 });
    expect(getSavedPosition('/dispatch')).toEqual({ x: 300, y: 200, width: 900, height: 700 });
  });

  it('tracks multiple paths independently', () => {
    saveWindowPosition('/dispatch', { x: 300, y: 200, width: 900, height: 700 });
    saveWindowPosition('/map', { x: 10, y: 10, width: 1200, height: 900 });
    expect(getSavedPosition('/dispatch')).toEqual({ x: 300, y: 200, width: 900, height: 700 });
    expect(getSavedPosition('/map')).toEqual({ x: 10, y: 10, width: 1200, height: 900 });
  });

  it('a later save for the same path overwrites the earlier one', () => {
    saveWindowPosition('/dispatch', { x: 300, y: 200, width: 900, height: 700 });
    saveWindowPosition('/dispatch', { x: 50, y: 50, width: 800, height: 600 });
    expect(getSavedPosition('/dispatch')).toEqual({ x: 50, y: 50, width: 800, height: 600 });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/utils/desktopWindowPositions.test.ts`
Expected: FAIL — `desktopWindowPositions.ts` doesn't exist yet.

- [ ] **Step 3: Create `desktopWindowPositions.ts`**

```ts
// client/src/utils/desktopWindowPositions.ts
// Session-scoped (not synced to the server, unlike desktop_layout_json) —
// see docs/superpowers/specs/2026-07-20-desktop-window-management-polish-design.md
// Section G for why: remembering "where I last put the Records window" is a
// convenience for the current browser tab, not account state worth a
// cross-device round trip.
const STORAGE_KEY = 'rmpg_desktop_window_positions';

export interface SavedWindowPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadAll(): Record<string, SavedWindowPosition> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getSavedPosition(path: string): SavedWindowPosition | null {
  return loadAll()[path] ?? null;
}

export function saveWindowPosition(path: string, position: SavedWindowPosition): void {
  try {
    const all = loadAll();
    all[path] = position;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* silent — position just won't be remembered this session */ }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/utils/desktopWindowPositions.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `DesktopWindowManager.tsx` wiring**

In `client/src/components/desktop/DesktopWindowManager.test.tsx`, add to `Harness`:

```tsx
      <button onClick={() => windows[0] && moveResize(windows[0].id, { x: 999, y: 888, width: 777, height: 666 })}>moveresize-first</button>
      <span data-testid="first-bounds">{windows[0] ? `${windows[0].x},${windows[0].y},${windows[0].width}x${windows[0].height}` : ''}</span>
```

(`moveResize` is already destructured in `Harness` from earlier tasks — no change needed there.)

Add these tests:

```ts
  it('opening a path with a remembered position uses it instead of the cascade default', () => {
    sessionStorage.setItem('rmpg_desktop_window_positions', JSON.stringify({ '/dispatch': { x: 300, y: 200, width: 900, height: 700 } }));
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-bounds').textContent).toBe('300,200,900x700');
  });

  it('opening a path with no remembered position falls back to the cascade default', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByTestId('first-bounds').textContent).toBe('80,60,1050x800');
  });

  it('moveResize persists the new bounds to sessionStorage for its path', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('moveresize-first').click());
    const raw = sessionStorage.getItem('rmpg_desktop_window_positions');
    expect(JSON.parse(raw!)['/dispatch']).toEqual({ x: 999, y: 888, width: 777, height: 666 });
  });
```

- [ ] **Step 6: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: FAIL — new windows always use the cascade default; `moveResize` doesn't write to `rmpg_desktop_window_positions`.

- [ ] **Step 7: Wire `desktopWindowPositions.ts` into `DesktopWindowManager.tsx`**

Replace:

```ts
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
```

with:

```ts
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getSavedPosition, saveWindowPosition } from '../../utils/desktopWindowPositions';
```

Replace:

```ts
    if (prev.length >= MAX_OPEN_WINDOWS) return false;
    nextZIndex += 1;
    const offset = prev.length * 24;
    const win: DesktopWindowState = {
      id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path, title,
      x: 80 + offset, y: 60 + offset,
      width: size?.width ?? 1050, height: size?.height ?? 800,
      zIndex: nextZIndex, minimized: false, maximized: false,
      alwaysOnTop: false, opacity: 1,
    };
```

with:

```ts
    if (prev.length >= MAX_OPEN_WINDOWS) return false;
    nextZIndex += 1;
    const offset = prev.length * 24;
    const saved = getSavedPosition(path);
    const win: DesktopWindowState = {
      id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path, title,
      x: saved?.x ?? (80 + offset), y: saved?.y ?? (60 + offset),
      width: saved?.width ?? size?.width ?? 1050, height: saved?.height ?? size?.height ?? 800,
      zIndex: nextZIndex, minimized: false, maximized: false,
      alwaysOnTop: false, opacity: 1,
    };
```

Replace:

```ts
  const moveResize = useCallback((id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, ...patch } : w));
  }, [commit]);
```

with:

```ts
  const moveResize = useCallback((id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => {
    const next = windowsRef.current.map(w => w.id === id ? { ...w, ...patch } : w);
    commit(next);
    const updated = next.find(w => w.id === id);
    if (updated) {
      saveWindowPosition(updated.path, { x: updated.x, y: updated.y, width: updated.width, height: updated.height });
    }
  }, [commit]);
```

- [ ] **Step 8: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 9: Run the full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add client/src/utils/desktopWindowPositions.ts client/src/utils/desktopWindowPositions.test.ts client/src/components/desktop/DesktopWindowManager.tsx client/src/components/desktop/DesktopWindowManager.test.tsx
git commit -m "desktop: remember and reuse each app's last window position/size"
```

---

## Task 9: Full Verification

**Files:** none (verification only)

- [ ] **Step 1: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all tests PASS.

- [ ] **Step 3: Full client production build**

Run: `cd client && npx vite build`
Expected: builds successfully.

- [ ] **Step 4: Manual verification note**

If a working dev/staging environment is available: open `/desktop`, open 3+ windows, hold Ctrl and tap `` ` `` repeatedly to confirm the switcher overlay cycles and highlights correctly, release to confirm focus lands on the right window; drag a window to the left/right screen edge and confirm it snaps to exactly half the desktop, then drag it away from the edge and confirm it restores to its pre-snap size; click the taskbar's Show Desktop button and confirm all windows minimize, click again and confirm only the auto-minimized ones restore; pin a window via its title-bar pin icon and confirm it stays visually on top even when another window is focused; right-click a window's title bar and adjust its opacity; close and reopen the same app and confirm it reopens at its last position/size; open Settings → Window Management and confirm the snap toggle and multi-monitor button both work (multi-monitor will show "Not supported" in most browsers — that's correct, not a bug).

If no working dev/staging environment is available (as was the case for the prior three changes in this program, due to unrelated local D1 migration drift), state that plainly rather than claiming this step was performed — the automated test suite from Steps 1-3 is real evidence; a skipped manual step is not silently equivalent to it.
