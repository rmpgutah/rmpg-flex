# Desktop Personalization Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clock format (12h/24h), desktop sound effects (with real sounds wired to window events), a window-transparency baseline for newly-opened windows, and two more wallpaper/accent presets to the `/desktop` system's Personalization category.

**Architecture:** Three small localStorage preference files (`clockPreference.ts`, `desktopSoundPreference.ts`, `windowOpacityPreference.ts`) plus a thin `desktopSounds.ts` wrapper around the already-built `playSoundAsset('click')`. `useClock.ts` reads the clock-format preference. `DesktopWindowManager.tsx` reads the opacity-baseline preference for new windows and fires desktop sounds on open/close/minimize. `FloatingWindow.tsx` fires a sound when a snap is actually applied. `DesktopSettingsApp.tsx`'s Personalization category gets three new sections. Two new entries each in `desktopWallpapers.ts`/`desktopAccents.ts`.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react.

## Global Constraints

- All new preferences are `localStorage` (device-scoped), never D1/API — no new migration, no new column.
- All new chrome uses the project's CSS-variable-backed Tailwind tokens (`var(--surface-raised)`, `var(--brand-400)`, `var(--rmpg-400)`, etc.) — never hardcoded hex. New wallpaper/accent entries must use only already-existing CSS variables.
- No new D1 migrations in this build.
- No new sound assets/WAV files — desktop sounds reuse the existing `'click'` `UiSoundKey` via `playSoundAsset`.
- The window-transparency baseline only affects newly-opened windows going forward; it must never retroactively change an already-open window's current opacity.

---

### Task 1: `clockPreference.ts` + wire into `useClock.ts`

**Files:**
- Create: `client/src/utils/clockPreference.ts`
- Modify: `client/src/hooks/useClock.ts`
- Test: `client/src/utils/clockPreference.test.ts`
- Test: `client/src/hooks/useClock.test.ts`

**Interfaces:**
- Produces: `ClockFormat = '12h' | '24h'`, `getClockFormat(): ClockFormat`, `setClockFormat(format: ClockFormat): void` — Task 8 (Settings UI) consumes these.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/utils/clockPreference.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getClockFormat, setClockFormat } from './clockPreference';

describe('clockPreference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 24h', () => {
    expect(getClockFormat()).toBe('24h');
  });

  it('setClockFormat(12h) persists and getClockFormat reflects it', () => {
    setClockFormat('12h');
    expect(getClockFormat()).toBe('12h');
    expect(localStorage.getItem('rmpg_desktop_clock_format')).toBe('12h');
  });

  it('setClockFormat(24h) persists and getClockFormat reflects it', () => {
    setClockFormat('12h');
    setClockFormat('24h');
    expect(getClockFormat()).toBe('24h');
  });
});
```

Append to `client/src/hooks/useClock.test.ts` (read its current content first — it already has one test using `vi.useFakeTimers()`/`vi.setSystemTime()`):

```ts
import { getClockFormat, setClockFormat } from '../utils/clockPreference';

describe('useClock — format preference', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => setClockFormat('24h'));

  it('respects 12h format when set', () => {
    setClockFormat('12h');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T20:00:00Z')); // 20:00 UTC = 2:00 PM Denver (MDT, UTC-6)
    const { result } = renderHook(() => useClock());
    expect(result.current.time).toMatch(/AM|PM/i);
  });

  it('respects 24h format when set', () => {
    setClockFormat('24h');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T20:00:00Z'));
    const { result } = renderHook(() => useClock());
    expect(result.current.time).not.toMatch(/AM|PM/i);
  });
});
```

Add `import { beforeEach, afterEach } from 'vitest';` to the existing `vitest` import line in `useClock.test.ts` if not already present (check first — the file may already import some of these).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/utils/clockPreference.test.ts src/hooks/useClock.test.ts`
Expected: FAIL — `clockPreference` module not found; `useClock` ignores format entirely (both new tests fail since the current implementation doesn't pass `hour12` at all, so its default `Intl` behavior for `'en-US'` already includes AM/PM regardless of the "24h" test's expectation).

- [ ] **Step 3: Write `clockPreference.ts`**

```ts
// client/src/utils/clockPreference.ts
const STORAGE_KEY = 'rmpg_desktop_clock_format';

export type ClockFormat = '12h' | '24h';

export function getClockFormat(): ClockFormat {
  try {
    return localStorage.getItem(STORAGE_KEY) === '12h' ? '12h' : '24h';
  } catch {
    return '24h';
  }
}

export function setClockFormat(format: ClockFormat): void {
  try {
    localStorage.setItem(STORAGE_KEY, format);
  } catch { /* silent — sessionless devices just always see the default */ }
}
```

- [ ] **Step 4: Wire into `useClock.ts`**

In `client/src/hooks/useClock.ts`, add the import:

```ts
import { getClockFormat } from '../utils/clockPreference';
```

Change the `format()` function's `time` computation:

```ts
function format(): { time: string; date: string } {
  const now = new Date();
  return {
    time: new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: getClockFormat() === '12h',
    }).format(now),
    date: new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    }).format(now),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/clockPreference.test.ts src/hooks/useClock.test.ts`
Expected: PASS, all tests including the pre-existing `useClock` test.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/clockPreference.ts client/src/utils/clockPreference.test.ts client/src/hooks/useClock.ts client/src/hooks/useClock.test.ts
git commit -m "desktop: add clock format preference (12h/24h), wire into useClock"
```

---

### Task 2: `desktopSoundPreference.ts` + `desktopSounds.ts`

**Files:**
- Create: `client/src/utils/desktopSoundPreference.ts`
- Create: `client/src/utils/desktopSounds.ts`
- Test: `client/src/utils/desktopSoundPreference.test.ts`
- Test: `client/src/utils/desktopSounds.test.ts`

**Interfaces:**
- Produces: `isDesktopSoundEnabled(): boolean`, `setDesktopSoundEnabled(enabled: boolean): void`, `playDesktopSound(): void` — Tasks 3, 4, 5, 8 consume these.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/utils/desktopSoundPreference.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isDesktopSoundEnabled, setDesktopSoundEnabled } from './desktopSoundPreference';

describe('desktopSoundPreference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to enabled', () => {
    expect(isDesktopSoundEnabled()).toBe(true);
  });

  it('setDesktopSoundEnabled(false) persists and isDesktopSoundEnabled reflects it', () => {
    setDesktopSoundEnabled(false);
    expect(isDesktopSoundEnabled()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_sound_enabled')).toBe('0');
  });

  it('setDesktopSoundEnabled(true) persists and isDesktopSoundEnabled reflects it', () => {
    setDesktopSoundEnabled(false);
    setDesktopSoundEnabled(true);
    expect(isDesktopSoundEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_sound_enabled')).toBe('1');
  });
});
```

```ts
// client/src/utils/desktopSounds.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const playSoundAssetMock = vi.fn();
vi.mock('./soundAssets', () => ({ playSoundAsset: (...args: unknown[]) => playSoundAssetMock(...args) }));

import { setDesktopSoundEnabled } from './desktopSoundPreference';
import { playDesktopSound } from './desktopSounds';

describe('playDesktopSound', () => {
  beforeEach(() => {
    localStorage.clear();
    playSoundAssetMock.mockClear();
  });

  it('calls playSoundAsset("click") when desktop sound is enabled', () => {
    setDesktopSoundEnabled(true);
    playDesktopSound();
    expect(playSoundAssetMock).toHaveBeenCalledWith('click');
  });

  it('does not call playSoundAsset when desktop sound is disabled', () => {
    setDesktopSoundEnabled(false);
    playDesktopSound();
    expect(playSoundAssetMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/utils/desktopSoundPreference.test.ts src/utils/desktopSounds.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/utils/desktopSoundPreference.ts
const STORAGE_KEY = 'rmpg_desktop_sound_enabled';

export function isDesktopSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setDesktopSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch { /* silent */ }
}
```

```ts
// client/src/utils/desktopSounds.ts
import { playSoundAsset } from './soundAssets';
import { isDesktopSoundEnabled } from './desktopSoundPreference';

export function playDesktopSound(): void {
  if (!isDesktopSoundEnabled()) return;
  playSoundAsset('click');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/desktopSoundPreference.test.ts src/utils/desktopSounds.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/desktopSoundPreference.ts client/src/utils/desktopSoundPreference.test.ts client/src/utils/desktopSounds.ts client/src/utils/desktopSounds.test.ts
git commit -m "desktop: add desktop sound preference + playDesktopSound wrapper"
```

---

### Task 3: `windowOpacityPreference.ts` + wire baseline into `openWindow`

**Files:**
- Create: `client/src/utils/windowOpacityPreference.ts`
- Modify: `client/src/components/desktop/DesktopWindowManager.tsx`
- Test: `client/src/utils/windowOpacityPreference.test.ts`
- Test: `client/src/components/desktop/DesktopWindowManager.test.tsx` (create if it doesn't exist — check first; `FloatingWindow.test.tsx` and `DesktopTaskbar.test.tsx` both import `DesktopWindowManagerProvider`/`useDesktopWindows` from this module, so a dedicated test file for the manager itself may or may not already exist)

**Interfaces:**
- Produces: `getDefaultWindowOpacity(): number`, `setDefaultWindowOpacity(opacity: number): void`.
- Consumes (Task 3 does NOT wire sounds yet — that's Task 4): nothing new besides the above.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/utils/windowOpacityPreference.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDefaultWindowOpacity, setDefaultWindowOpacity } from './windowOpacityPreference';

describe('windowOpacityPreference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 1 (fully opaque)', () => {
    expect(getDefaultWindowOpacity()).toBe(1);
  });

  it('setDefaultWindowOpacity persists and getDefaultWindowOpacity reflects it', () => {
    setDefaultWindowOpacity(0.7);
    expect(getDefaultWindowOpacity()).toBe(0.7);
  });

  it('clamps below 0.3 up to the 0.3 floor', () => {
    setDefaultWindowOpacity(0.1);
    expect(getDefaultWindowOpacity()).toBe(0.3);
  });

  it('clamps above 1 down to the 1.0 ceiling', () => {
    setDefaultWindowOpacity(1.5);
    expect(getDefaultWindowOpacity()).toBe(1);
  });

  it('rounds to one decimal to avoid float drift', () => {
    setDefaultWindowOpacity(0.1 + 0.2); // 0.30000000000000004 in raw JS float math
    expect(getDefaultWindowOpacity()).toBe(0.3);
  });
});
```

Before writing the `DesktopWindowManager.tsx` test, check whether `client/src/components/desktop/DesktopWindowManager.test.tsx` already exists. If it does, append the block below preserving its existing content/imports. If it doesn't, create it with the imports shown plus this block (the render harness mirrors the pattern already used in `FloatingWindow.test.tsx`/`DesktopTaskbar.test.tsx`):

```tsx
import { setDefaultWindowOpacity } from '../../utils/windowOpacityPreference';

describe('DesktopWindowManager — default window opacity baseline', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('a newly-opened window starts at the configured default opacity', () => {
    setDefaultWindowOpacity(0.7);
    function Harness() {
      const { openWindow, windows } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
          <ul>{windows.map(w => <li key={w.id}>{w.opacity}</li>)}</ul>
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('0.7')).toBeInTheDocument();
    setDefaultWindowOpacity(1); // cleanup for other tests
  });

  it('an already-open window is unaffected when the default opacity setting later changes', () => {
    setDefaultWindowOpacity(1);
    function Harness() {
      const { openWindow, windows } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
          <ul>{windows.map(w => <li key={w.id}>{w.opacity}</li>)}</ul>
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('1')).toBeInTheDocument();
    setDefaultWindowOpacity(0.5); // changing the setting AFTER the window opened
    expect(screen.getByText('1')).toBeInTheDocument(); // still 1, not retroactively changed
    setDefaultWindowOpacity(1); // cleanup
  });
});
```

If `DesktopWindowManager.test.tsx` needs to be created fresh, use this header (matching the import conventions of `FloatingWindow.test.tsx`):

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/utils/windowOpacityPreference.test.ts src/components/desktop/DesktopWindowManager.test.tsx`
Expected: FAIL — module not found; `openWindow` still hardcodes `opacity: 1`.

- [ ] **Step 3: Write `windowOpacityPreference.ts`**

```ts
// client/src/utils/windowOpacityPreference.ts
const STORAGE_KEY = 'rmpg_desktop_default_window_opacity';
const MIN_OPACITY = 0.3;
const MAX_OPACITY = 1;

function clamp(value: number): number {
  return Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, Math.round(value * 10) / 10));
}

export function getDefaultWindowOpacity(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed) : 1;
  } catch {
    return 1;
  }
}

export function setDefaultWindowOpacity(opacity: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clamp(opacity)));
  } catch { /* silent */ }
}
```

- [ ] **Step 4: Wire into `DesktopWindowManager.tsx`**

Add the import:

```ts
import { getDefaultWindowOpacity } from '../../utils/windowOpacityPreference';
```

In `openWindow`, change the new-window object literal's `opacity: 1` to:

```ts
opacity: getDefaultWindowOpacity(),
```

(Leave the existing refocus branch — `existing` found, `commit(prev.map(...))` — completely untouched; it never sets `opacity` at all, so it already leaves an existing window's opacity alone.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/windowOpacityPreference.test.ts src/components/desktop/DesktopWindowManager.test.tsx`
Expected: PASS. Also run `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx src/components/desktop/DesktopTaskbar.test.tsx` to confirm zero regressions in the other files that exercise `DesktopWindowManagerProvider`.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/windowOpacityPreference.ts client/src/utils/windowOpacityPreference.test.ts client/src/components/desktop/DesktopWindowManager.tsx client/src/components/desktop/DesktopWindowManager.test.tsx
git commit -m "desktop: add default-window-opacity baseline, applied to newly-opened windows"
```

---

### Task 4: Wire `playDesktopSound` into open/close/minimize

**Files:**
- Modify: `client/src/components/desktop/DesktopWindowManager.tsx`
- Test: `client/src/components/desktop/DesktopWindowManager.test.tsx`

**Interfaces:**
- Consumes: `playDesktopSound` from `../../utils/desktopSounds` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `client/src/components/desktop/DesktopWindowManager.test.tsx`:

```tsx
vi.mock('../../utils/desktopSounds', () => ({ playDesktopSound: vi.fn() }));
import { playDesktopSound } from '../../utils/desktopSounds';

describe('DesktopWindowManager — desktop sounds on window events', () => {
  beforeEach(() => { sessionStorage.clear(); vi.mocked(playDesktopSound).mockClear(); });

  it('plays a sound when a genuinely new window opens, not when an existing one is refocused', () => {
    function Harness() {
      const { openWindow } = useDesktopWindows();
      return <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>;
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(playDesktopSound).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('open')); // same path — refocus, not a new window
    expect(playDesktopSound).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('plays a sound when a window closes', () => {
    function Harness() {
      const { openWindow, closeWindow, windows } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
          {windows.map(w => <button key={w.id} onClick={() => closeWindow(w.id)}>close</button>)}
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    vi.mocked(playDesktopSound).mockClear();
    fireEvent.click(screen.getByText('close'));
    expect(playDesktopSound).toHaveBeenCalledTimes(1);
  });

  it('plays a sound when a window is minimized or restored', () => {
    function Harness() {
      const { openWindow, minimizeWindow, windows } = useDesktopWindows();
      return (
        <>
          <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
          {windows.map(w => <button key={w.id} onClick={() => minimizeWindow(w.id)}>toggle-min</button>)}
        </>
      );
    }
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    vi.mocked(playDesktopSound).mockClear();
    fireEvent.click(screen.getByText('toggle-min'));
    expect(playDesktopSound).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('toggle-min'));
    expect(playDesktopSound).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: FAIL — `playDesktopSound` never called.

- [ ] **Step 3: Implement**

Add the import:

```ts
import { playDesktopSound } from '../../utils/desktopSounds';
```

In `openWindow`, call `playDesktopSound()` only on the genuinely-new-window branch (after the `if (prev.length >= MAX_OPEN_WINDOWS) return false;` cap check, before or after `commit`):

```ts
const openWindow = useCallback((path: string, title: string, size?: { width: number; height: number }) => {
  const prev = windowsRef.current;
  const existing = prev.find(w => w.path === path);
  if (existing) {
    nextZIndex += 1;
    commit(prev.map(w => w.id === existing.id ? { ...w, minimized: false, zIndex: nextZIndex } : w));
    return true;
  }
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
    alwaysOnTop: false, opacity: getDefaultWindowOpacity(),
  };
  commit([...prev, win]);
  playDesktopSound();
  return true;
}, [commit]);
```

In `closeWindow`:

```ts
const closeWindow = useCallback((id: string) => {
  commit(windowsRef.current.filter(w => w.id !== id));
  playDesktopSound();
}, [commit]);
```

In `minimizeWindow`:

```ts
const minimizeWindow = useCallback((id: string) => {
  commit(windowsRef.current.map(w => w.id === id ? { ...w, minimized: !w.minimized } : w));
  playDesktopSound();
}, [commit]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: PASS. Also run `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx src/components/desktop/DesktopTaskbar.test.tsx src/pages/DesktopPage.test.tsx` to confirm zero regressions — these files exercise `openWindow`/`closeWindow`/`minimizeWindow` extensively and do NOT mock `desktopSounds`, so `playDesktopSound` will actually attempt to call the real (mocked-at-a-lower-level, since `soundAssets.ts` itself is likely safe to call in jsdom, or may need checking) `playSoundAsset` — if any of these other test files fail due to an unmocked audio call throwing in jsdom, that's a real integration gap to fix in this task (e.g. by confirming `soundAssets.ts`'s `playSoundAsset` is safe to call with no `AudioContext` available in jsdom, since this codebase already plays sounds elsewhere in the app under test without mocking, per the existing `actionChimes.ts`/`uiClickSounds.ts` usage elsewhere).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopWindowManager.tsx client/src/components/desktop/DesktopWindowManager.test.tsx
git commit -m "desktop: play a desktop sound on window open/close/minimize"
```

---

### Task 5: Wire `playDesktopSound` into snap-to-edge

**Files:**
- Modify: `client/src/components/desktop/FloatingWindow.tsx`
- Test: `client/src/components/desktop/FloatingWindow.test.tsx`

**Interfaces:**
- Consumes: `playDesktopSound` from `../../utils/desktopSounds` (Task 2).

- [ ] **Step 1: Write the failing test**

Read the current full content of `client/src/components/desktop/FloatingWindow.tsx` and `.test.tsx` first — find the exact `onUp` handler inside the snap-to-edge `onTitleBarPointerDown` callback (the one checking `snapEdgeRef.current` and calling `moveResize` with the half-screen bounds) and the existing `describe('FloatingWindow — snap to edge', ...)` test block's `dragTitleBarTo`/`releaseDrag` helpers — reuse them.

Append to that existing describe block (or add a new one immediately after it):

```tsx
vi.mock('../../utils/desktopSounds', () => ({ playDesktopSound: vi.fn() }));
import { playDesktopSound } from '../../utils/desktopSounds';

describe('FloatingWindow — snap sound', () => {
  beforeEach(() => vi.mocked(playDesktopSound).mockClear());

  it('plays a sound when a snap is actually applied', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(10, 300); // near the left edge — a snap will apply
    releaseDrag();
    expect(playDesktopSound).toHaveBeenCalledTimes(1);
  });

  it('does not play a sound on a normal drag release with no snap applied', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    dragTitleBarTo(500, 300); // away from any edge — no snap
    releaseDrag();
    expect(playDesktopSound).not.toHaveBeenCalled();
  });
});
```

(`Harness`, `dragTitleBarTo`, `releaseDrag` are the existing helpers already defined in this test file's snap-to-edge describe block — reuse them exactly, do not redefine.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: FAIL — `playDesktopSound` never called.

- [ ] **Step 3: Implement**

Add the import to `client/src/components/desktop/FloatingWindow.tsx`:

```ts
import { playDesktopSound } from '../../utils/desktopSounds';
```

In the `onUp` handler inside `onTitleBarPointerDown`, find the branch that actually applies a snap (checks `halfWidth >= MIN_SNAP_HALF_WIDTH` before calling `moveResize` with the half-screen bounds) and add `playDesktopSound()` right after that `moveResize` call, inside the same `if` block that applies the snap — NOT in the outer `if (snapEdgeRef.current)` block, since that only means the cursor was near an edge at release time, not that a snap was actually applied (the `halfWidth >= MIN_SNAP_HALF_WIDTH` guard can still skip it on a very narrow screen).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/FloatingWindow.tsx client/src/components/desktop/FloatingWindow.test.tsx
git commit -m "desktop: play a desktop sound when a snap-to-edge is actually applied"
```

---

### Task 6: Two more wallpaper presets

**Files:**
- Modify: `client/src/data/desktopWallpapers.ts`

**Interfaces:**
- Produces: 2 additional `WallpaperPreset` entries — consumed automatically by `DesktopSettingsApp.tsx`'s existing `DESKTOP_WALLPAPERS.map(...)` rendering (no code change needed there for this task).

- [ ] **Step 1: Implement (no dedicated test file — pure data, consistent with the existing 6 entries having none)**

In `client/src/data/desktopWallpapers.ts`, add two entries to the `DESKTOP_WALLPAPERS` array, after the existing `shift-gradient` entry:

```ts
{
  id: 'steel-mesh',
  label: 'Steel Mesh',
  background:
    'linear-gradient(45deg, var(--border-subtle) 1px, transparent 1px), ' +
    'linear-gradient(-45deg, var(--border-subtle) 1px, transparent 1px), var(--surface-sunken)',
},
{
  id: 'twilight-fade',
  label: 'Twilight Fade',
  background: 'linear-gradient(160deg, var(--surface-base) 0%, var(--surface-overlay) 100%)',
},
```

- [ ] **Step 2: Verify via the existing Settings test**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS (the existing personalization tests iterate/click specific known swatches by label; adding two new array entries must not break those — confirm by running, not just by inspection, since the two new labels could theoretically collide with an existing `aria-label` string if written carelessly, though `Wallpaper: Steel Mesh`/`Wallpaper: Twilight Fade` do not collide with any existing label).

- [ ] **Step 3: Commit**

```bash
git add client/src/data/desktopWallpapers.ts
git commit -m "desktop: add Steel Mesh and Twilight Fade wallpaper presets"
```

---

### Task 7: Two more accent presets

**Files:**
- Modify: `client/src/data/desktopAccents.ts`

**Interfaces:**
- Produces: 2 additional `AccentPreset` entries — consumed automatically by `DesktopSettingsApp.tsx`'s existing `DESKTOP_ACCENTS.map(...)` rendering.

- [ ] **Step 1: Confirm the CSS variables exist**

Run: `grep -n "stat-accent-red:\|stat-accent-default:" client/src/styles/theme-palettes.css`
Expected: both `--stat-accent-red` and `--stat-accent-default` are present (confirmed present as of this plan's writing — re-verify live before using them, per the spec's note, since token files can change between spec-writing and implementation).

- [ ] **Step 2: Implement (no dedicated test file — pure data)**

In `client/src/data/desktopAccents.ts`, add two entries to the `DESKTOP_ACCENTS` array, after the existing `purple` entry:

```ts
{ id: 'garnet', label: 'Garnet', accent: 'var(--stat-accent-red)', shadow: 'rgba(220, 38, 38, 0.35)' },
{ id: 'graphite', label: 'Graphite', accent: 'var(--stat-accent-default)', shadow: 'rgba(148, 163, 184, 0.35)' },
```

- [ ] **Step 3: Verify via the existing Settings test**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS (confirm the new `Accent: Garnet`/`Accent: Graphite` labels don't collide with any existing accent label).

- [ ] **Step 4: Commit**

```bash
git add client/src/data/desktopAccents.ts
git commit -m "desktop: add Garnet and Graphite accent presets"
```

---

### Task 8: Settings UI — Clock Format, Desktop Sounds, Window Transparency sections

**Files:**
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx`
- Test: `client/src/components/desktop/DesktopSettingsApp.test.tsx`

**Interfaces:**
- Consumes: `getClockFormat`/`setClockFormat` (Task 1), `isDesktopSoundEnabled`/`setDesktopSoundEnabled` (Task 2), `getDefaultWindowOpacity`/`setDefaultWindowOpacity` (Task 3).

- [ ] **Step 1: Write the failing tests**

Read the current full content of `client/src/components/desktop/DesktopSettingsApp.tsx` and `.test.tsx` in full first — prior builds (Settings App Shell) already added a search box, Export/Import section, and per-category Reset buttons to this file; the Personalization category currently ends with its own Reset button (added in that prior build) — insert your three new sections BEFORE that existing Reset button, so "Reset this category to default" always stays the last item in the panel.

Append to `client/src/components/desktop/DesktopSettingsApp.test.tsx`:

```tsx
import { getClockFormat } from '../../utils/clockPreference';
import { isDesktopSoundEnabled } from '../../utils/desktopSoundPreference';
import { getDefaultWindowOpacity } from '../../utils/windowOpacityPreference';

describe('DesktopSettingsApp — Personalization: clock format, sounds, transparency', () => {
  beforeEach(() => localStorage.clear());

  it('clicking 12-hour/24-hour sets the clock format', () => {
    renderApp();
    fireEvent.click(screen.getByText('12-hour'));
    expect(getClockFormat()).toBe('12h');
    fireEvent.click(screen.getByText('24-hour'));
    expect(getClockFormat()).toBe('24h');
  });

  it('toggling Desktop Sounds persists the preference', () => {
    renderApp();
    fireEvent.click(screen.getByLabelText('Desktop sounds'));
    expect(isDesktopSoundEnabled()).toBe(false);
  });

  it('Increase/Decrease transparency buttons adjust and clamp the default window opacity', () => {
    renderApp();
    fireEvent.click(screen.getByText('Decrease'));
    expect(getDefaultWindowOpacity()).toBe(0.9);
    fireEvent.click(screen.getByText('Increase'));
    expect(getDefaultWindowOpacity()).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: FAIL — no new controls exist yet.

- [ ] **Step 3: Implement**

Add the imports:

```ts
import { getClockFormat, setClockFormat, type ClockFormat } from '../../utils/clockPreference';
import { isDesktopSoundEnabled, setDesktopSoundEnabled } from '../../utils/desktopSoundPreference';
import { getDefaultWindowOpacity, setDefaultWindowOpacity } from '../../utils/windowOpacityPreference';
```

Add state near the component's other `useState` calls:

```ts
const [clockFormat, setClockFormatState] = useState<ClockFormat>(() => getClockFormat());
const [soundEnabled, setSoundEnabledState] = useState(() => isDesktopSoundEnabled());
const [windowOpacity, setWindowOpacityState] = useState(() => getDefaultWindowOpacity());
```

In the `personalization` category panel, insert this block after the existing "Accent Color" section and before the existing "Reset this category to default" block:

```tsx
<div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Clock Format</div>
<div className="flex gap-1">
  {(['12h', '24h'] as const).map(fmt => (
    <button
      key={fmt} type="button"
      onClick={() => { setClockFormat(fmt); setClockFormatState(fmt); }}
      className="text-[10px] px-2 py-0.5"
      style={{ border: '1px solid var(--border-default)', background: clockFormat === fmt ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
    >
      {fmt === '12h' ? '12-hour' : '24-hour'}
    </button>
  ))}
</div>

<div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Desktop Sounds</div>
<label className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
  <input
    type="checkbox"
    aria-label="Desktop sounds"
    checked={soundEnabled}
    onChange={(e) => { setDesktopSoundEnabled(e.target.checked); setSoundEnabledState(e.target.checked); }}
  />
  Play a sound when opening, closing, minimizing, or snapping a window
</label>

<div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Window Transparency</div>
<div className="flex items-center gap-2">
  <button
    type="button"
    onClick={() => { const next = getDefaultWindowOpacity() - 0.1; setDefaultWindowOpacity(next); setWindowOpacityState(getDefaultWindowOpacity()); }}
    className="text-[10px] px-2 py-0.5"
    style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
  >
    Decrease
  </button>
  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{Math.round(windowOpacity * 100)}%</span>
  <button
    type="button"
    onClick={() => { const next = getDefaultWindowOpacity() + 0.1; setDefaultWindowOpacity(next); setWindowOpacityState(getDefaultWindowOpacity()); }}
    className="text-[10px] px-2 py-0.5"
    style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
  >
    Increase
  </button>
</div>
```

(Note the pattern `setDefaultWindowOpacity(next); setWindowOpacityState(getDefaultWindowOpacity())` deliberately re-reads through `getDefaultWindowOpacity()` after writing, rather than using the raw `next` value directly, so the displayed percentage always reflects the actual clamped/rounded stored value rather than a possibly-unclamped intermediate.)

Also update the Personalization category's existing "Reset this category to default" button (added in the prior Settings App Shell build) to also reset these three new preferences, since a full "reset this category" should cover everything the category now contains:

```tsx
onClick={() => {
  if (window.confirm('Reset wallpaper, accent color, clock format, desktop sounds, and window transparency to default?')) {
    onWallpaperChange(DEFAULT_WALLPAPER_ID);
    onAccentChange(DEFAULT_ACCENT_ID);
    setClockFormat('24h'); setClockFormatState('24h');
    setDesktopSoundEnabled(true); setSoundEnabledState(true);
    setDefaultWindowOpacity(1); setWindowOpacityState(1);
  }
}}
```

(Find the existing reset button's exact current `onClick` and `window.confirm` message text in the file and replace both consistently — do not leave the old confirm-message text describing only wallpaper/accent once the reset covers more.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopSettingsApp.test.tsx`
Expected: PASS, all tests including every pre-existing one (Personalization, Desktop & Icons, Window Management, Taskbar, search, export/import, per-category reset).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/components/desktop/DesktopSettingsApp.test.tsx
git commit -m "desktop: add Clock Format, Desktop Sounds, Window Transparency to Personalization settings"
```

---

### Task 9: Full verification

**Files:** None (verification only).

- [ ] **Step 1: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `cd client && npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Build**

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Record verification in the ledger**

```bash
mkdir -p .superpowers/sdd
echo "Personalization-Task 9: complete — typecheck clean, full vitest suite passes, vite build succeeds. Manual smoke test not performed (pre-existing local D1 migration drift, consistent with prior branches this session)." >> .superpowers/sdd/progress.md
```
