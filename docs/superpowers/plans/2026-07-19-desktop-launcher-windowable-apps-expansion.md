# Desktop Launcher — Windowable Apps Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand which pages can open as in-desktop floating windows on `/desktop` from a curated ~18-route allowlist to nearly all 85 nav-catalog entries, by replacing the drifted `navCatalog.ts`/`POPOUT_PAGES` data-split with a single source of truth.

**Architecture:** Two new optional fields on `NavFunction` (`windowSize`, `notWindowable`) make windowability default-on and catalog-driven. New pure helpers in `windowManager.ts` (`getWindowConfig`, `isWindowablePath`, `activateNavFunction`) replace the standalone `POPOUT_PAGES` map at all three of its current read sites (desktop icon grid, taskbar search, `Layout.tsx`'s pop-out button, `ModuleDirectoryPage.tsx`'s pop-out button) so there is exactly one place windowability is decided.

**Tech Stack:** React 18 + TypeScript client (Vite), Vitest + `@testing-library/react` for tests. No Worker/D1 changes.

## Global Constraints

- No page component behavior changes except the two audit-driven fixes noted below (`/serve`, `/navigation` stay excluded) — the "iframe isolation makes most pages safe by default" premise from the design doc holds for all 66 other newly-included pages, verified by direct source audit in this plan (not deferred).
- Default window size for any entry without a curated `windowSize` is **1050×800**.
- `MAX_OPEN_WINDOWS` goes from 6 → **10**.
- Every `notWindowable` value is a non-empty, human-readable reason string — never a bare boolean.
- Run `cd client && npx tsc --noEmit` and `cd client && npx vitest run <file>` after every task; do not proceed to the next task on a red build.

---

## Audit results (already completed as part of planning — no further page-by-page investigation needed)

Every one of the 85 `NAV_CATEGORIES` entries not already in the old 18-route `POPOUT_PAGES` map was read in full and checked against 4 disqualifying patterns (live camera/GPS HUD, top-level `window.location`/`window.top` redirect, full-screen/kiosk design, single-instance storage locking). Only two are excluded:

- **`/navigation`** — full-screen in-vehicle drive HUD, rendered outside `<Layout>` in `App.tsx`, uses the native Fullscreen API. Confirmed via `App.tsx`'s own comment ("Full-screen in-vehicle drive HUD — intentionally OUTSIDE `<Layout>`... kiosk-style") and `NavigationPage.tsx`'s `requestFullscreen()` call.
- **`/serve`** — `ServePage.tsx:318`'s "edit before print" action does `window.location.href = '/pdf-editor?from=serve&...'`, a full-page reload inside whichever context it runs in. Inside a floating window this would silently replace the window's content with the PDF editor while the title bar still reads "Process Server," with no way back except closing the window.

Two more things worth noting; folded into Task 6:
- `/radio`'s push-to-talk (`useVoiceChannel.ts`) uses `navigator.mediaDevices.getUserMedia` for the mic. Browsers require a same-origin iframe to explicitly opt in via the `allow` attribute for `getUserMedia` to succeed — without it, PTT would silently fail to get mic permission inside a floating window.
- `/command-center` calls the native Fullscreen API behind a supervisor toolbar button — same `allow`-attribute requirement for `fullscreen`.

Everything else (66 pages) is windowable at the default size with zero page-level changes.

---

## Task 1: NavFunction data model — add windowability fields, apply audit results

**Files:**
- Modify: `client/src/data/navCatalog.ts`
- Test: `client/src/data/navCatalog.windowability.test.ts` (new)

**Interfaces:**
- Produces: `NavFunction.windowSize?: { width: number; height: number }`, `NavFunction.notWindowable?: string` — consumed by Task 2's `windowManager.ts` helpers.

- [ ] **Step 1: Write the failing test**

Create `client/src/data/navCatalog.windowability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NAV_CATEGORIES } from './navCatalog';

const ALL = NAV_CATEGORIES.flatMap(cat => cat.functions);

describe('navCatalog — windowability metadata', () => {
  it('every function is either windowable (no notWindowable) or has a non-empty exclusion reason', () => {
    for (const fn of ALL) {
      if (fn.notWindowable !== undefined) {
        expect(typeof fn.notWindowable).toBe('string');
        expect(fn.notWindowable.length).toBeGreaterThan(0);
      }
    }
  });

  it('every windowSize is a positive width/height pair', () => {
    for (const fn of ALL) {
      if (fn.windowSize) {
        expect(fn.windowSize.width).toBeGreaterThan(0);
        expect(fn.windowSize.height).toBeGreaterThan(0);
      }
    }
  });

  it('/navigation is excluded — full-screen kiosk drive HUD', () => {
    const fn = ALL.find(f => f.path === '/navigation');
    expect(fn?.notWindowable).toBeTruthy();
  });

  it('/serve is excluded — mid-workflow window.location.href navigation to /pdf-editor', () => {
    const fn = ALL.find(f => f.path === '/serve');
    expect(fn?.notWindowable).toBeTruthy();
  });

  it('the old broken "/national-warrants" path no longer exists — fixed to /national-warrant-search', () => {
    expect(ALL.some(f => f.path === '/national-warrants')).toBe(false);
    const fixed = ALL.find(f => f.path === '/national-warrant-search');
    expect(fixed?.windowSize).toEqual({ width: 1180, height: 860 });
  });

  it('/law-book is reachable from the catalog and windowable', () => {
    const fn = ALL.find(f => f.path === '/law-book');
    expect(fn).toBeDefined();
    expect(fn?.notWindowable).toBeUndefined();
    expect(fn?.windowSize).toEqual({ width: 1100, height: 820 });
  });

  it('no duplicate paths exist in the catalog', () => {
    const paths = ALL.map(f => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/data/navCatalog.windowability.test.ts`
Expected: FAIL — `/navigation`/`/serve` have no `notWindowable`, `/law-book` doesn't exist, `/national-warrant-search` has no `windowSize`.

- [ ] **Step 3: Add the two fields to the `NavFunction` interface**

In `client/src/data/navCatalog.ts`, replace:

```ts
export interface NavFunction {
  path: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  description: string;
  adminOnly?: boolean;
  badgeKey?: string;
}
```

with:

```ts
export interface NavFunction {
  path: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  description: string;
  adminOnly?: boolean;
  badgeKey?: string;
  /** In-desktop floating window size. Omit for the default 1050x800. */
  windowSize?: { width: number; height: number };
  /** Non-empty reason this page must NOT open in a floating desktop window (falls back to navigate()). */
  notWindowable?: string;
}
```

- [ ] **Step 4: Apply curated sizes to the `ops` category (Dispatch, Map, MDT)**

Replace:

```ts
      { path: '/dispatch', label: 'Dispatch Console', icon: Radio, shortcut: 'F2', badgeKey: 'activeCalls', description: 'Full CAD dispatch console for call management, unit assignments, and real-time ops' },
      { path: '/map', label: 'Tactical Map', icon: Map, shortcut: 'F3', description: 'Real-time tactical map with live GPS, call markers, beat overlays, and offline tiles' },
      { path: '/mdt', label: 'Mobile Data Terminal', icon: Monitor, shortcut: 'F4', description: 'In-vehicle mobile data terminal for field officers' },
```

with:

```ts
      { path: '/dispatch', label: 'Dispatch Console', icon: Radio, shortcut: 'F2', badgeKey: 'activeCalls', description: 'Full CAD dispatch console for call management, unit assignments, and real-time ops', windowSize: { width: 1200, height: 900 } },
      { path: '/map', label: 'Tactical Map', icon: Map, shortcut: 'F3', description: 'Real-time tactical map with live GPS, call markers, beat overlays, and offline tiles', windowSize: { width: 1200, height: 900 } },
      { path: '/mdt', label: 'Mobile Data Terminal', icon: Monitor, shortcut: 'F4', description: 'In-vehicle mobile data terminal for field officers', windowSize: { width: 1000, height: 800 } },
```

- [ ] **Step 5: Apply curated sizes to the `records` category (Incidents, Records, Evidence, Cases)**

Replace:

```ts
      { path: '/incidents', label: 'Incidents', icon: FileText, description: 'Incident report management with UCR/NIBRS classification and multi-officer tracking' },
      { path: '/records', label: 'Records (RMS)', icon: Database, description: 'Master records for persons, vehicles, addresses, and property with compound search' },
```

with:

```ts
      { path: '/incidents', label: 'Incidents', icon: FileText, description: 'Incident report management with UCR/NIBRS classification and multi-officer tracking', windowSize: { width: 1100, height: 850 } },
      { path: '/records', label: 'Records (RMS)', icon: Database, description: 'Master records for persons, vehicles, addresses, and property with compound search', windowSize: { width: 1100, height: 850 } },
```

Replace:

```ts
      { path: '/evidence', label: 'Evidence / Property', icon: Package, description: 'Evidence and property management with chain-of-custody tracking' },
```

with:

```ts
      { path: '/evidence', label: 'Evidence / Property', icon: Package, description: 'Evidence and property management with chain-of-custody tracking', windowSize: { width: 1100, height: 850 } },
```

Replace:

```ts
      { path: '/cases', label: 'Case Management', icon: Briefcase, badgeKey: 'openCases', description: 'Full case management with evidence, suspect/witness tracking, and cross-referencing' },
```

with:

```ts
      { path: '/cases', label: 'Case Management', icon: Briefcase, badgeKey: 'openCases', description: 'Full case management with evidence, suspect/witness tracking, and cross-referencing', windowSize: { width: 1100, height: 850 } },
```

- [ ] **Step 6: Fix `/national-warrant-search`, exclude `/serve`, add `/law-book` to the `enforce` category**

Replace the entire `enforce` category's `functions` array:

```ts
    functions: [
      { path: '/warrants', label: 'Warrants', icon: AlertTriangle, badgeKey: 'activeWarrants', description: 'Active warrant tracking with person associations, status management, and national search' },
      { path: '/national-warrant-search', label: 'National Warrant Search', icon: Globe, description: 'Federated warrant search across multiple state and national databases' },
      { path: '/citations', label: 'Citations', icon: FileWarning, description: 'Traffic and non-traffic citation management with violation tracking' },
      { path: '/trespass-orders', label: 'Trespass Orders', icon: ShieldBan, description: 'Trespass order management and enforcement tracking' },
      { path: '/code-enforcement', label: 'Code Enforcement', icon: Construction, description: 'Municipal and property code enforcement case management' },
      { path: '/court', label: 'Court Tracker', icon: Gavel, description: 'Court date and event tracking for officers and cases' },
      { path: '/offender-registry', label: 'Offender Registry', icon: UserX, description: 'Registered offender tracking and compliance management' },
      { path: '/sex-offender-registry', label: 'Sex Offender Registry', icon: Fingerprint, description: 'Sex offender registration and verification' },
      { path: '/serve', label: 'Process Server', icon: Briefcase, badgeKey: 'pendingServe', description: 'Serve queue with GPS tracking, route optimization, and attempt logging' },
      { path: '/serve-intake', label: 'Service Intake', icon: ClipboardPen, description: 'Process service intake and document receipt' },
    ],
```

with:

```ts
    functions: [
      { path: '/warrants', label: 'Warrants', icon: AlertTriangle, badgeKey: 'activeWarrants', description: 'Active warrant tracking with person associations, status management, and national search', windowSize: { width: 1140, height: 840 } },
      { path: '/national-warrant-search', label: 'National Warrant Search', icon: Globe, description: 'Federated warrant search across multiple state and national databases', windowSize: { width: 1180, height: 860 } },
      { path: '/citations', label: 'Citations', icon: FileWarning, description: 'Traffic and non-traffic citation management with violation tracking', windowSize: { width: 1000, height: 800 } },
      { path: '/law-book', label: 'Law Book', icon: BookOpen, description: 'Statute and code reference library for charge lookup and legal research', windowSize: { width: 1100, height: 820 } },
      { path: '/trespass-orders', label: 'Trespass Orders', icon: ShieldBan, description: 'Trespass order management and enforcement tracking' },
      { path: '/code-enforcement', label: 'Code Enforcement', icon: Construction, description: 'Municipal and property code enforcement case management' },
      { path: '/court', label: 'Court Tracker', icon: Gavel, description: 'Court date and event tracking for officers and cases' },
      { path: '/offender-registry', label: 'Offender Registry', icon: UserX, description: 'Registered offender tracking and compliance management' },
      { path: '/sex-offender-registry', label: 'Sex Offender Registry', icon: Fingerprint, description: 'Sex offender registration and verification' },
      { path: '/serve', label: 'Process Server', icon: Briefcase, badgeKey: 'pendingServe', description: 'Serve queue with GPS tracking, route optimization, and attempt logging', notWindowable: 'The "edit before print" action does a full-page window.location.href navigation to /pdf-editor (ServePage.tsx:318), which would replace the window\'s content while the title bar stays stale.' },
      { path: '/serve-intake', label: 'Service Intake', icon: ClipboardPen, description: 'Process service intake and document receipt' },
    ],
```

`BookOpen` is already imported at the top of `navCatalog.ts` (used elsewhere) — no import changes needed.

- [ ] **Step 7: Apply curated sizes to the `personnel` category (Personnel, Fleet, Body Cameras)**

Replace:

```ts
      { path: '/personnel', label: 'Personnel', icon: Users, description: 'Officer and staff profiles, certifications, assignments, and contact info' },
      { path: '/hr', label: 'HR Console', icon: ClipboardCheck, description: 'HR management with leave, payroll, performance reviews, and disciplinary records' },
      { path: '/fleet', label: 'Fleet Management', icon: Car, description: 'Vehicle fleet management with maintenance, fuel logs, and inspections' },
      { path: '/body-cameras', label: 'Body Cameras', icon: Video, description: 'Body-worn camera management, video review, and evidence tagging' },
```

with:

```ts
      { path: '/personnel', label: 'Personnel', icon: Users, description: 'Officer and staff profiles, certifications, assignments, and contact info', windowSize: { width: 1100, height: 850 } },
      { path: '/hr', label: 'HR Console', icon: ClipboardCheck, description: 'HR management with leave, payroll, performance reviews, and disciplinary records' },
      { path: '/fleet', label: 'Fleet Management', icon: Car, description: 'Vehicle fleet management with maintenance, fuel logs, and inspections', windowSize: { width: 1100, height: 850 } },
      { path: '/body-cameras', label: 'Body Cameras', icon: Video, description: 'Body-worn camera management, video review, and evidence tagging', windowSize: { width: 1000, height: 800 } },
```

- [ ] **Step 8: Apply curated sizes to the `comms` category (Communications, Patrol)**

Replace:

```ts
      { path: '/communications', label: 'Communications', icon: MessageSquare, badgeKey: 'activeBOLOs', description: 'Secure messaging between dispatchers and units with channel-based comms' },
      { path: '/radio', label: 'Radio Console', icon: Radio, description: 'Integrated radio console with channel management and PTT controls' },
      { path: '/email', label: 'Email', icon: Mail, badgeKey: 'unreadEmail', description: 'Integrated email client for agency communications' },
      { path: '/patrol', label: 'Patrol Operations', icon: QrCode, description: 'Patrol operations and QR-based reporting' },
```

with:

```ts
      { path: '/communications', label: 'Communications', icon: MessageSquare, badgeKey: 'activeBOLOs', description: 'Secure messaging between dispatchers and units with channel-based comms', windowSize: { width: 1000, height: 800 } },
      { path: '/radio', label: 'Radio Console', icon: Radio, description: 'Integrated radio console with channel management and PTT controls' },
      { path: '/email', label: 'Email', icon: Mail, badgeKey: 'unreadEmail', description: 'Integrated email client for agency communications' },
      { path: '/patrol', label: 'Patrol Operations', icon: QrCode, description: 'Patrol operations and QR-based reporting', windowSize: { width: 1100, height: 850 } },
```

- [ ] **Step 9: Apply curated sizes to the `analysis` category (Reports, Daily Activity)**

Replace:

```ts
      { path: '/reports', label: 'Reports', icon: BarChart3, description: 'Comprehensive reporting with charts, analytics, and PDF export' },
```

with:

```ts
      { path: '/reports', label: 'Reports', icon: BarChart3, description: 'Comprehensive reporting with charts, analytics, and PDF export', windowSize: { width: 1100, height: 850 } },
```

Replace:

```ts
      { path: '/dar', label: 'Daily Activity Reports', icon: ClipboardCheck, description: 'Daily activity report generation and officer log review' },
```

with:

```ts
      { path: '/dar', label: 'Daily Activity Reports', icon: ClipboardCheck, description: 'Daily activity report generation and officer log review', windowSize: { width: 1100, height: 850 } },
```

- [ ] **Step 10: Exclude `/navigation` in the `support` category**

Replace:

```ts
      { path: '/navigation', label: 'Navigation / Drive', icon: Navigation, description: 'In-vehicle GPS turn-by-turn navigation and drive instruments' },
```

with:

```ts
      { path: '/navigation', label: 'Navigation / Drive', icon: Navigation, description: 'In-vehicle GPS turn-by-turn navigation and drive instruments', notWindowable: 'Full-screen in-vehicle drive HUD rendered outside <Layout> (kiosk mode, uses the native Fullscreen API) — not meant to run inside a small floating window.' },
```

- [ ] **Step 11: Run test, verify it passes**

Run: `cd client && npx vitest run src/data/navCatalog.windowability.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 12: Commit**

```bash
git add client/src/data/navCatalog.ts client/src/data/navCatalog.windowability.test.ts
git commit -m "desktop: add windowability metadata to NavFunction, apply audit results"
```

---

## Task 2: `windowManager.ts` helpers — `getWindowConfig`, `getWindowConfigByPath`, `isWindowablePath`, `activateNavFunction`

**Files:**
- Modify: `client/src/utils/windowManager.ts`
- Test: `client/src/utils/windowManager.test.ts` (new)

**Interfaces:**
- Consumes: `NavFunction.windowSize`/`notWindowable` from Task 1.
- Produces: `getWindowConfig(fn: NavFunction): WindowConfig | null`, `getWindowConfigByPath(path: string): WindowConfig | null`, `isWindowablePath(path: string): boolean`, `activateNavFunction(fn: NavFunction, handlers: { openWindow: (path: string, title: string, size?: {width:number;height:number}) => void; navigate: (path: string) => void }): void` — consumed by Tasks 4, 5, 7, 8. `POPOUT_PAGES` stays exported and unchanged in this task (still used by 3 not-yet-migrated consumers); it's removed in Task 9.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/windowManager.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Radio } from 'lucide-react';
import { getWindowConfig, getWindowConfigByPath, isWindowablePath, activateNavFunction } from './windowManager';
import type { NavFunction } from '../data/navCatalog';

const WINDOWABLE_DEFAULT: NavFunction = { path: '/foo', label: 'Foo', icon: Radio, description: 'd' };
const WINDOWABLE_SIZED: NavFunction = { path: '/bar', label: 'Bar', icon: Radio, description: 'd', windowSize: { width: 1200, height: 900 } };
const EXCLUDED: NavFunction = { path: '/baz', label: 'Baz', icon: Radio, description: 'd', notWindowable: 'kiosk HUD' };

describe('getWindowConfig', () => {
  it('defaults to 1050x800 when no windowSize is set', () => {
    expect(getWindowConfig(WINDOWABLE_DEFAULT)).toEqual({ title: 'Foo', width: 1050, height: 800 });
  });

  it('uses the curated windowSize when present', () => {
    expect(getWindowConfig(WINDOWABLE_SIZED)).toEqual({ title: 'Bar', width: 1200, height: 900 });
  });

  it('returns null when notWindowable is set', () => {
    expect(getWindowConfig(EXCLUDED)).toBeNull();
  });
});

describe('getWindowConfigByPath / isWindowablePath', () => {
  it('resolves real catalog paths, e.g. /dispatch', () => {
    expect(getWindowConfigByPath('/dispatch')).toEqual({ title: 'Dispatch Console', width: 1200, height: 900 });
    expect(isWindowablePath('/dispatch')).toBe(true);
  });

  it('excludes /navigation', () => {
    expect(isWindowablePath('/navigation')).toBe(false);
  });

  it('returns null/false for a path with no catalog entry', () => {
    expect(getWindowConfigByPath('/not-a-real-route')).toBeNull();
    expect(isWindowablePath('/not-a-real-route')).toBe(false);
  });
});

describe('activateNavFunction', () => {
  it('opens a window with the resolved size for a windowable function', () => {
    const openWindow = vi.fn();
    const navigate = vi.fn();
    activateNavFunction(WINDOWABLE_SIZED, { openWindow, navigate });
    expect(openWindow).toHaveBeenCalledWith('/bar', 'Bar', { width: 1200, height: 900 });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates for a non-windowable function', () => {
    const openWindow = vi.fn();
    const navigate = vi.fn();
    activateNavFunction(EXCLUDED, { openWindow, navigate });
    expect(navigate).toHaveBeenCalledWith('/baz');
    expect(openWindow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/utils/windowManager.test.ts`
Expected: FAIL — none of the 4 named exports exist yet.

- [ ] **Step 3: Add the helpers to `windowManager.ts`**

At the top of `client/src/utils/windowManager.ts`, after the existing header comment, add the import and the new helpers (before the `POPOUT_PAGES` declaration):

```ts
import { NAV_CATEGORIES, type NavFunction } from '../data/navCatalog';

const ALL_NAV_FUNCTIONS: NavFunction[] = NAV_CATEGORIES.flatMap(cat => cat.functions);
const NAV_FUNCTION_BY_PATH: Record<string, NavFunction> = Object.fromEntries(
  ALL_NAV_FUNCTIONS.map(fn => [fn.path, fn]),
);

const DEFAULT_WINDOW_WIDTH = 1050;
const DEFAULT_WINDOW_HEIGHT = 800;

export interface WindowConfig {
  title: string;
  width: number;
  height: number;
}

/** Windowability + size for a nav function. null means "not windowable — navigate() instead." */
export function getWindowConfig(fn: NavFunction): WindowConfig | null {
  if (fn.notWindowable) return null;
  const size = fn.windowSize ?? { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT };
  return { title: fn.label, width: size.width, height: size.height };
}

/** Same as getWindowConfig, but looked up by raw path — for callers that only have a path (e.g. location.pathname). */
export function getWindowConfigByPath(path: string): WindowConfig | null {
  const fn = NAV_FUNCTION_BY_PATH[path];
  return fn ? getWindowConfig(fn) : null;
}

export function isWindowablePath(path: string): boolean {
  return getWindowConfigByPath(path) !== null;
}

/** Shared activation logic for desktop icon clicks and taskbar search results: open a
 *  floating window for windowable pages, otherwise fall back to a normal SPA navigate(). */
export function activateNavFunction(
  fn: NavFunction,
  handlers: {
    openWindow: (path: string, title: string, size?: { width: number; height: number }) => void;
    navigate: (path: string) => void;
  },
): void {
  const config = getWindowConfig(fn);
  if (config) {
    handlers.openWindow(fn.path, config.title, { width: config.width, height: config.height });
  } else {
    handlers.navigate(fn.path);
  }
}
```

- [ ] **Step 4: Route `openPageWindow` through `getWindowConfigByPath`**

Replace:

```ts
export function openPageWindow(routePath: string) {
  const page = POPOUT_PAGES[routePath];
  if (page) {
    return openDetachedWindow(routePath, page.title, page.width, page.height);
  }
  // Fallback for unknown routes
  return openDetachedWindow(routePath, 'RMPG Flex', 1100, 850);
}
```

with:

```ts
export function openPageWindow(routePath: string) {
  const config = getWindowConfigByPath(routePath);
  if (config) {
    return openDetachedWindow(routePath, config.title, config.width, config.height);
  }
  // Fallback for unknown/non-windowable routes
  return openDetachedWindow(routePath, 'RMPG Flex', 1100, 850);
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd client && npx vitest run src/utils/windowManager.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the full client test suite to confirm nothing else broke**

Run: `cd client && npx vitest run`
Expected: PASS (all existing tests still green — `POPOUT_PAGES` is untouched, only `openPageWindow`'s internals changed, and its behavior is equivalent for all previously-covered paths since Task 1 preserved every curated size).

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/windowManager.ts client/src/utils/windowManager.test.ts
git commit -m "desktop: add getWindowConfig/isWindowablePath/activateNavFunction helpers"
```

---

## Task 3: `DesktopWindowManager.tsx` — size param, cap 6→10, cap-hit return value

**Files:**
- Modify: `client/src/components/desktop/DesktopWindowManager.tsx`
- Modify: `client/src/components/desktop/DesktopWindowManager.test.tsx`

**Interfaces:**
- Produces: `useDesktopWindows().openWindow: (path: string, title: string, size?: { width: number; height: number }) => boolean` (return value: `true` if opened/focused, `false` if the cap was hit and the call was a no-op) — consumed by Tasks 4, 5.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `client/src/components/desktop/DesktopWindowManager.test.tsx`:

```tsx
// client/src/components/desktop/DesktopWindowManager.test.tsx
import { useRef } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';

function Harness() {
  const { windows, openWindow, closeWindow, focusWindow, minimizeWindow } = useDesktopWindows();
  const capResults = useRef<boolean[]>([]);
  return (
    <div>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open-dispatch</button>
      <button onClick={() => openWindow('/map', 'Live Map')}>open-map</button>
      <button onClick={() => openWindow('/records', 'Records', { width: 1100, height: 850 })}>open-records-sized</button>
      <button onClick={() => { capResults.current = Array.from({ length: 11 }, (_, i) => openWindow(`/p${i}`, `P${i}`)); }}>open-eleven</button>
      <button onClick={() => windows[0] && closeWindow(windows[0].id)}>close-first</button>
      <button onClick={() => windows[0] && focusWindow(windows[0].id)}>focus-first</button>
      <button onClick={() => windows[0] && minimizeWindow(windows[0].id)}>minimize-first</button>
      <span data-testid="cap-results">{capResults.current.join(',')}</span>
      <ul>{windows.map(w => <li key={w.id}>{w.title}-{w.zIndex}-{w.minimized ? 'min' : 'open'}-{w.width}x{w.height}</li>)}</ul>
    </div>
  );
}

describe('DesktopWindowManager', () => {
  beforeEach(() => sessionStorage.clear());

  it('opens, focuses (raising zIndex), minimizes, and closes windows', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    act(() => screen.getByText('open-map').click());
    expect(screen.getAllByRole('listitem').length).toBe(2);

    const beforeFocus = screen.getByText(/^Dispatch-/).textContent;
    act(() => screen.getByText('focus-first').click());
    const afterFocus = screen.getByText(/^Dispatch-/).textContent;
    expect(afterFocus).not.toBe(beforeFocus); // zIndex raised

    act(() => screen.getByText('minimize-first').click());
    expect(screen.getByText(/^Dispatch-.*-min-/)).toBeInTheDocument();

    act(() => screen.getByText('close-first').click());
    expect(screen.getAllByRole('listitem').length).toBe(1);
  });

  it('persists open windows to sessionStorage under rmpg_desktop_windows', async () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    await waitFor(() => {
      const raw = sessionStorage.getItem('rmpg_desktop_windows');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)[0].path).toBe('/dispatch');
    });
  });

  it('opens a window at the requested size, defaulting to 900x640 when no size is given', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    expect(screen.getByText(/^Dispatch-.*-900x640$/)).toBeInTheDocument();
    act(() => screen.getByText('open-records-sized').click());
    expect(screen.getByText(/^Records-.*-1100x850$/)).toBeInTheDocument();
  });

  it('caps at 10 open windows: the 11th openWindow call returns false and is dropped', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-eleven').click());
    expect(screen.getAllByRole('listitem').length).toBe(10);
    const results = screen.getByTestId('cap-results').textContent!.split(',').map(v => v === 'true');
    expect(results).toEqual([true, true, true, true, true, true, true, true, true, true, false]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: FAIL — `openWindow` doesn't accept a 3rd arg or return a value yet; cap is still 6, not 10; the `-{w.width}x{w.height}` suffix isn't in `<li>` items yet (compiles fine since `w.width`/`w.height` already exist on `DesktopWindowState`, but the 900x640/1100x850/cap assertions fail).

- [ ] **Step 3: Update `DesktopWindowManager.tsx`**

Replace:

```ts
const SESSION_KEY = 'rmpg_desktop_windows';
const MAX_OPEN_WINDOWS = 6;
```

with:

```ts
const SESSION_KEY = 'rmpg_desktop_windows';
const MAX_OPEN_WINDOWS = 10;
```

Replace:

```ts
interface DesktopWindowManagerContextValue {
  windows: DesktopWindowState[];
  openWindow: (path: string, title: string) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => void;
}
```

with:

```ts
interface DesktopWindowManagerContextValue {
  windows: DesktopWindowState[];
  /** Returns true if the window was opened/focused, false if the cap was hit and the call was a no-op. */
  openWindow: (path: string, title: string, size?: { width: number; height: number }) => boolean;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => void;
}
```

Replace:

```ts
  const openWindow = useCallback((path: string, title: string) => {
    setWindows(prev => {
      const existing = prev.find(w => w.path === path);
      if (existing) {
        nextZIndex += 1;
        return prev.map(w => w.id === existing.id ? { ...w, minimized: false, zIndex: nextZIndex } : w);
      }
      if (prev.length >= MAX_OPEN_WINDOWS) return prev;
      nextZIndex += 1;
      const offset = prev.length * 24;
      const win: DesktopWindowState = {
        id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        path, title,
        x: 80 + offset, y: 60 + offset, width: 900, height: 640,
        zIndex: nextZIndex, minimized: false, maximized: false,
      };
      return [...prev, win];
    });
  }, []);
```

with:

```ts
  const openWindow = useCallback((path: string, title: string, size?: { width: number; height: number }) => {
    let opened = true;
    setWindows(prev => {
      const existing = prev.find(w => w.path === path);
      if (existing) {
        nextZIndex += 1;
        return prev.map(w => w.id === existing.id ? { ...w, minimized: false, zIndex: nextZIndex } : w);
      }
      if (prev.length >= MAX_OPEN_WINDOWS) {
        opened = false;
        return prev;
      }
      nextZIndex += 1;
      const offset = prev.length * 24;
      const win: DesktopWindowState = {
        id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        path, title,
        x: 80 + offset, y: 60 + offset,
        width: size?.width ?? 900, height: size?.height ?? 640,
        zIndex: nextZIndex, minimized: false, maximized: false,
      };
      return [...prev, win];
    });
    return opened;
  }, []);
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopWindowManager.tsx client/src/components/desktop/DesktopWindowManager.test.tsx
git commit -m "desktop: openWindow accepts a size and reports cap-hit; raise MAX_OPEN_WINDOWS to 10"
```

---

## Task 4: `DesktopIconGrid.tsx` — migrate off `POPOUT_PAGES`

**Files:**
- Modify: `client/src/components/desktop/DesktopIconGrid.tsx`
- Modify: `client/src/components/desktop/DesktopIconGrid.test.tsx`
- No change needed: `client/src/components/desktop/DesktopIconGrid.dragDrop.test.tsx` (its `/records` fixture has no `windowSize`/`notWindowable`, so it now resolves to the default-windowable path — same outcome the test already asserts, since the `onDrop` handler is unconditionally keyed on `fn.path === '/records'` regardless of windowability).

**Interfaces:**
- Consumes: `getWindowConfig`, `activateNavFunction` from Task 2; `openWindow` now returns `boolean` per Task 3 (ignored here — no UI feedback needed at the icon-click level, only at taskbar search per Task 5).

- [ ] **Step 1: Update the fixtures in `DesktopIconGrid.test.tsx` to the new default-on model**

In `client/src/components/desktop/DesktopIconGrid.test.tsx`, replace:

```ts
// Restored from the pre-Task-4 v1 desktop launcher suite (originally added in
// commit 4fcb48999b). Task 4's rewrite replaced this whole file with the
// multi-select/grouping suite above and dropped these 3 tests, even though the
// underlying behavior they cover (POPOUT-eligible click opens a window,
// non-eligible click falls back to navigate(), right-click "Unpin") is still
// present in the rewritten component. Adapted for the current
// `DesktopIconGridProps` signature (now requires `groups`/`onCreateGroup`/
// `onUngroup`) and the hoisted `navigateSpy` mock introduced by Task 4.
const RESTORED_ICONS: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch Console', icon: LayoutDashboard, description: 'd' }, // in POPOUT_PAGES
  { path: '/impound', label: 'Impound', icon: Package, description: 'imp' }, // NOT in POPOUT_PAGES
];
```

with:

```ts
// Restored from the pre-Task-4 v1 desktop launcher suite (originally added in
// commit 4fcb48999b). Adapted again for the windowable-apps-expansion pass:
// windowability is now default-on via getWindowConfig/NavFunction.notWindowable
// (see windowManager.ts) instead of a separate POPOUT_PAGES allowlist, so the
// "non-eligible" fixture must explicitly opt out via notWindowable.
const RESTORED_ICONS: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch Console', icon: LayoutDashboard, description: 'd', windowSize: { width: 1200, height: 900 } }, // windowable
  { path: '/impound', label: 'Impound', icon: Package, description: 'imp', notWindowable: 'test fixture: explicitly excluded' }, // NOT windowable
];
```

- [ ] **Step 2: Run test, verify it still passes (this is a fixture-only change, behavior it exercises is unchanged)**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: PASS — this step confirms the *test* still describes correct behavior before the component changes underneath it; it should still pass because `DesktopIconGrid.tsx` hasn't been touched yet (still reads the old `POPOUT_PAGES`, which doesn't have `/dispatch` or `/impound` — wait, `/dispatch` IS in `POPOUT_PAGES`, so this still passes against the untouched component).

- [ ] **Step 3: Migrate `DesktopIconGrid.tsx` off `POPOUT_PAGES`**

Replace:

```ts
import { POPOUT_PAGES } from '../../utils/windowManager';
```

with:

```ts
import { getWindowConfig, activateNavFunction } from '../../utils/windowManager';
```

Replace:

```ts
  const handleActivate = useCallback((fn: NavFunction) => {
    if (POPOUT_PAGES[fn.path]) {
      openWindow(fn.path, fn.label);
    } else {
      navigate(fn.path);
    }
  }, [navigate, openWindow]);
```

with:

```ts
  const handleActivate = useCallback((fn: NavFunction) => {
    activateNavFunction(fn, { openWindow, navigate });
  }, [navigate, openWindow]);
```

Replace:

```ts
        const eligible = !!POPOUT_PAGES[fn.path];
```

with:

```ts
        const eligible = !!getWindowConfig(fn);
```

Replace:

```ts
              onDrop={fn.path === '/records' ? (e) => {
                e.preventDefault();
                try {
                  const payload = JSON.parse(e.dataTransfer.getData('application/json'));
                  if (payload?.type === 'person' && payload.id) {
                    openWindow(`/records?personId=${encodeURIComponent(payload.id)}`, 'Records');
                  }
                } catch { /* ignore malformed drag payloads */ }
              } : undefined}
```

with:

```ts
              onDrop={fn.path === '/records' ? (e) => {
                e.preventDefault();
                try {
                  const payload = JSON.parse(e.dataTransfer.getData('application/json'));
                  if (payload?.type === 'person' && payload.id) {
                    const config = getWindowConfig(fn);
                    openWindow(`/records?personId=${encodeURIComponent(payload.id)}`, 'Records', config ? { width: config.width, height: config.height } : undefined);
                  }
                } catch { /* ignore malformed drag payloads */ }
              } : undefined}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx src/components/desktop/DesktopIconGrid.dragDrop.test.tsx`
Expected: PASS (both files)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopIconGrid.tsx client/src/components/desktop/DesktopIconGrid.test.tsx
git commit -m "desktop: DesktopIconGrid uses getWindowConfig/activateNavFunction instead of POPOUT_PAGES"
```

---

## Task 5: `DesktopTaskbar.tsx` — windowable search results, window-cap toast

**Files:**
- Modify: `client/src/components/desktop/DesktopTaskbar.tsx`
- Modify: `client/src/components/desktop/DesktopTaskbar.test.tsx`
- No change needed: `client/src/components/desktop/DesktopTaskbar.commandBar.test.tsx` (command-bar quick actions don't touch search-result activation).

**Interfaces:**
- Consumes: `activateNavFunction` from Task 2, `openWindow` returning `boolean` from Task 3, `useToast().addToast` (already used in this file for clock-in/out errors).

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `client/src/components/desktop/DesktopTaskbar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect } from 'react';

const apiFetchMock = vi.fn().mockResolvedValue({ count: 0 });
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));
const addToastMock = vi.fn();
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigateMock }));

import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import DesktopTaskbar from './DesktopTaskbar';
import { Radio, Package } from 'lucide-react';
import type { NavFunction } from '../../data/navCatalog';

const icons: NavFunction[] = [{ path: '/dispatch', label: 'Dispatch Console', icon: Radio, description: 'd' }];
const catalog: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch Console', icon: Radio, description: 'd', windowSize: { width: 1200, height: 900 } },
  { path: '/impound', label: 'Impound', icon: Package, description: 'imp', notWindowable: 'test fixture: explicitly excluded' },
];

function Harness() {
  const { openWindow, windows } = useDesktopWindows();
  return (
    <>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>simulate-open</button>
      <DesktopTaskbar icons={icons} catalog={catalog} />
      <ul>{windows.map(w => <li key={w.id}>{w.path}</li>)}</ul>
    </>
  );
}

function CapHarness() {
  const { openWindow } = useDesktopWindows();
  useEffect(() => {
    for (let i = 0; i < 10; i++) openWindow(`/p${i}`, `P${i}`);
  }, [openWindow]);
  return <DesktopTaskbar icons={icons} catalog={catalog} />;
}

describe('DesktopTaskbar', () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    navigateMock.mockClear();
    addToastMock.mockClear();
    sessionStorage.clear();
  });

  it('shows a button for each open window and clicking it focuses/restores', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByText('simulate-open'));
    expect(screen.getByRole('button', { name: 'Dispatch' })).toBeInTheDocument();
  });

  it('typing in the launcher search filters the catalog to matching modules', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Dispatch' } });
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
  });

  it('selecting a windowable search result opens a floating window instead of navigating', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Dispatch' } });
    fireEvent.click(screen.getByText('Dispatch Console'));
    expect(screen.getByText('/dispatch')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('selecting a non-windowable search result navigates instead of opening a window', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Impound' } });
    fireEvent.click(screen.getByText('Impound'));
    expect(navigateMock).toHaveBeenCalledWith('/impound');
  });

  it('shows a toast instead of opening a window when the window cap is already hit', () => {
    render(<MemoryRouter><DesktopWindowManagerProvider><CapHarness /></DesktopWindowManagerProvider></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Open app launcher'));
    fireEvent.change(screen.getByPlaceholderText(/search modules/i), { target: { value: 'Dispatch' } });
    fireEvent.click(screen.getByText('Dispatch Console'));
    expect(addToastMock).toHaveBeenCalledWith('Close a window to open another', 'error');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: FAIL — search results still always `navigate()`, so the "windowable result opens a window" and "cap toast" tests fail.

- [ ] **Step 3: Update `DesktopTaskbar.tsx`**

Replace:

```ts
import { useDesktopWindows } from './DesktopWindowManager';
```

with:

```ts
import { useDesktopWindows } from './DesktopWindowManager';
import { activateNavFunction } from '../../utils/windowManager';
```

Replace:

```ts
  const { windows, focusWindow } = useDesktopWindows();
```

with:

```ts
  const { windows, focusWindow, openWindow } = useDesktopWindows();
```

Add a new handler right after the `handleClockToggle` callback (before `quickActions`):

```ts
  const handleSelectResult = useCallback((fn: NavFunction) => {
    let capHit = false;
    activateNavFunction(fn, {
      navigate,
      openWindow: (path, title, size) => {
        if (!openWindow(path, title, size)) capHit = true;
      },
    });
    if (capHit) addToast('Close a window to open another', 'error');
    setLauncherOpen(false);
    setQuery('');
  }, [navigate, openWindow, addToast]);
```

Replace:

```tsx
            {searchResults.slice(0, 20).map(fn => (
              <button
                key={fn.path}
                type="button"
                onClick={() => { navigate(fn.path); setLauncherOpen(false); setQuery(''); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-surface-hover"
                style={{ color: 'var(--text-primary)' }}
              >
                <fn.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--rmpg-400)' }} />
                {fn.label}
              </button>
            ))}
```

with:

```tsx
            {searchResults.slice(0, 20).map(fn => (
              <button
                key={fn.path}
                type="button"
                onClick={() => handleSelectResult(fn)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-surface-hover"
                style={{ color: 'var(--text-primary)' }}
              >
                <fn.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--rmpg-400)' }} />
                {fn.label}
              </button>
            ))}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx src/components/desktop/DesktopTaskbar.commandBar.test.tsx`
Expected: PASS (both files)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/DesktopTaskbar.test.tsx
git commit -m "desktop: taskbar search opens windowable results as windows, toasts on cap-hit"
```

---

## Task 6: `FloatingWindow.tsx` — grant `microphone`/`fullscreen` to the iframe

**Files:**
- Modify: `client/src/components/desktop/FloatingWindow.tsx`
- Modify: `client/src/components/desktop/FloatingWindow.test.tsx`

Without this, `/radio`'s push-to-talk (`getUserMedia`) and `/command-center`'s fullscreen toggle would silently fail to get permission inside a floating window — same-origin iframes still need an explicit `allow` attribute for these two APIs.

- [ ] **Step 1: Write the failing test**

Add to `client/src/components/desktop/FloatingWindow.test.tsx`, inside the existing `describe('FloatingWindow', ...)` block, after the last `it(...)`:

```ts
  it('grants microphone and fullscreen permissions to the iframe (needed by Radio push-to-talk and Command Center fullscreen)', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    const iframe = screen.getByTitle('Dispatch') as HTMLIFrameElement;
    expect(iframe.getAttribute('allow')).toBe('microphone; fullscreen');
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: FAIL — the iframe has no `allow` attribute yet (`getAttribute('allow')` returns `null`).

- [ ] **Step 3: Add the `allow` attribute**

Replace:

```tsx
          <iframe title={win.title} src={win.path} style={{ width: '100%', height: `calc(100% - ${TITLE_BAR_HEIGHT}px)`, border: 'none' }} />
```

with:

```tsx
          <iframe
            title={win.title}
            src={win.path}
            allow="microphone; fullscreen"
            style={{ width: '100%', height: `calc(100% - ${TITLE_BAR_HEIGHT}px)`, border: 'none' }}
          />
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/FloatingWindow.tsx client/src/components/desktop/FloatingWindow.test.tsx
git commit -m "desktop: grant microphone/fullscreen permissions to floating-window iframes"
```

---

## Task 7: `Layout.tsx` — top-bar pop-out button uses `isWindowablePath`

**Files:**
- Modify: `client/src/components/Layout.tsx`

No existing test file covers this button (`Layout.test.tsx` doesn't exist in this repo); Task 10's manual smoke test covers it directly.

- [ ] **Step 1: Update the import and gate**

Replace:

```ts
import { openPageWindow, POPOUT_PAGES } from '../utils/windowManager';
```

with:

```ts
import { openPageWindow, isWindowablePath } from '../utils/windowManager';
```

Replace:

```tsx
              {POPOUT_PAGES[location.pathname] && (
```

with:

```tsx
              {isWindowablePath(location.pathname) && (
```

- [ ] **Step 2: Run the client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "desktop: Layout's pop-out button uses isWindowablePath"
```

---

## Task 8: `ModuleDirectoryPage.tsx` — pop-out affordance uses `isWindowablePath`

**Files:**
- Modify: `client/src/pages/ModuleDirectoryPage.tsx`

No test-file changes needed — `ModuleDirectoryPage.test.tsx` and `ModuleDirectoryPage.bulkPin.test.tsx` contain no assertions on `POPOUT_PAGES`/`canPopOut`/the pop-out button (confirmed by grep before writing this plan).

- [ ] **Step 1: Update the import and gate**

Replace:

```ts
import { POPOUT_PAGES, openPageWindow } from '../utils/windowManager';
```

with:

```ts
import { isWindowablePath, openPageWindow } from '../utils/windowManager';
```

Replace:

```ts
    const canPopOut = POPOUT_PAGES[fn.path] !== undefined;
```

with:

```ts
    const canPopOut = isWindowablePath(fn.path);
```

- [ ] **Step 2: Run the existing tests, verify they still pass**

Run: `cd client && npx vitest run src/pages/ModuleDirectoryPage.test.tsx src/pages/ModuleDirectoryPage.bulkPin.test.tsx`
Expected: PASS (unchanged — neither file asserts on pop-out eligibility)

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ModuleDirectoryPage.tsx
git commit -m "desktop: ModuleDirectoryPage pop-out affordance uses isWindowablePath"
```

---

## Task 9: Remove `POPOUT_PAGES` — the last dual-source-of-truth cleanup

**Files:**
- Modify: `client/src/utils/windowManager.ts`

All 4 original consumers (`DesktopIconGrid.tsx`, `Layout.tsx`, `ModuleDirectoryPage.tsx`) were migrated in Tasks 4, 7, 8; `DesktopTaskbar.tsx` never read `POPOUT_PAGES` directly (Task 5 added its own `activateNavFunction`-based path). It's now safe to delete.

- [ ] **Step 1: Verify no remaining references**

Run: `grep -rn "POPOUT_PAGES" client/src --include="*.tsx" --include="*.ts"`
Expected: only the declaration line in `windowManager.ts` itself (about to be deleted in Step 2).

- [ ] **Step 2: Delete the `POPOUT_PAGES` export**

Remove this block from `client/src/utils/windowManager.ts` (it sits between the new helpers added in Task 2 and `openDetachedWindow`):

```ts
/** Pages that can be popped out into separate windows */
export const POPOUT_PAGES: Record<string, { title: string; width: number; height: number }> = {
  '/dispatch':       { title: 'Dispatch',           width: 1200, height: 900 },
  '/map':            { title: 'Live Map',            width: 1200, height: 900 },
  '/incidents':      { title: 'Incidents',           width: 1100, height: 850 },
  '/records':        { title: 'Records',             width: 1100, height: 850 },
  '/personnel':      { title: 'Personnel',           width: 1100, height: 850 },
  '/communications': { title: 'Communications',      width: 1000, height: 800 },

  '/patrol':         { title: 'Patrol',              width: 1100, height: 850 },
  '/fleet':          { title: 'Fleet',               width: 1100, height: 850 },
  '/reports':        { title: 'Reports',             width: 1100, height: 850 },
  '/mdt':            { title: 'MDT',                 width: 1000, height: 800 },
  '/warrants':       { title: 'Warrant Search',      width: 1140, height: 840 },
  '/national-warrants': { title: 'National Warrant Search', width: 1180, height: 860 },
  '/citations':      { title: 'Citations',           width: 1000, height: 800 },
  '/law-book':       { title: 'Law Book',            width: 1100, height: 820 },
  '/body-cameras':   { title: 'Body Cameras',        width: 1000, height: 800 },
  '/cases':          { title: 'Case Management',     width: 1100, height: 850 },
  '/evidence':       { title: 'Evidence & Property', width: 1100, height: 850 },
  '/dar':            { title: 'Daily Activity',      width: 1100, height: 850 },
};
```

- [ ] **Step 3: Run the client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (confirms nothing still imports `POPOUT_PAGES`).

- [ ] **Step 4: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS (all tests, including every file touched in Tasks 1–8)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/windowManager.ts
git commit -m "desktop: remove POPOUT_PAGES — navCatalog.ts is now the single source of windowability"
```

---

## Task 10: Full verification and manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full client test suite**

Run: `cd client && npx vitest run`
Expected: all tests PASS.

- [ ] **Step 3: Full client production build**

Run: `cd client && npx vite build`
Expected: builds successfully (confirms no dead-code-elimination surprises from the `POPOUT_PAGES` removal).

- [ ] **Step 4: Manual dev-server smoke test**

Start the dev server (`cd client && npm run dev`) and, logged in as an admin/officer role with several modules favorited on `/desktop`:

1. **Regression — previously-windowed pages still work**: open Dispatch, Map, MDT, Records, Warrants from desktop icons; confirm each still opens in a floating window at its original curated size (Dispatch/Map 1200×900, MDT/Communications 1000×800, etc.) — data model changed under them even though behavior shouldn't.
2. **Fixed entries**: open "National Warrant Search" and "Law Book" from the desktop icon grid (favorite them first if not already); confirm both open as floating windows now (previously `/national-warrants` silently fell through to `navigate()` due to the path mismatch, and `/law-book` wasn't reachable from the desktop at all).
3. **Newly-windowable pages, one per nav category**: favorite and open one previously-non-windowable page per category — e.g. `/ncic` (ops), `/field-interviews` (records), `/trespass-orders` (enforce), `/hr` (personnel), `/radio` (comms — confirm PTT mic prompt/capture works inside the window), `/shift-plans` (analysis), `/skip-tracer` (investigations), `/jail` (jail), `/billing` (services), `/crm` (overwatch), `/settings` (support), `/audit` (system, admin role). Confirm each renders and is interactively usable inside its window.
4. **Excluded pages stay excluded**: confirm `/navigation` and `/serve` icons still `navigate()` the whole desktop tab away (no window opens, no "Open in new browser tab" context-menu item).
5. **Window cap**: open 10 windows, confirm an 11th attempt (via icon or taskbar search) shows the "Close a window to open another" toast and does not open an 11th window.
6. **Taskbar search consistency**: Ctrl+K/⌘K, search for a windowable module (e.g. "Billing"), select it — confirm it opens as a window, not a full navigate.
7. **Layout pop-out button**: navigate directly to a newly-windowable page (e.g. `/billing`) outside the desktop, confirm the top-bar "Open in new window" button now appears (it didn't before this change) and works.
8. **Module Directory pop-out**: on `/module-directory` (or wherever `ModuleDirectoryPage` is routed), confirm the pop-out icon now appears on cards for newly-windowable modules.
9. **Command Center fullscreen**: open Command Center in a floating window, trigger its fullscreen toggle, confirm it actually goes fullscreen (validates the `allow="fullscreen"` iframe attribute from Task 6).

- [ ] **Step 5: Report results**

If any manual check in Step 4 fails, treat it as a new finding — do not silently patch around it; go back to the relevant task, fix the root cause, and re-run that task's tests plus this full verification task before considering the plan complete.
