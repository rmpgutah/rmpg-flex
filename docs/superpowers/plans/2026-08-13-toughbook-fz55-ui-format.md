# Toughbook FZ-55 UI Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect the Panasonic Toughbook FZ-55 at runtime and apply scoped CSS fixes for overlapping elements, clipped modals, table overflow, and gloved-hand touch targets across the entire app.

**Architecture:** A `useDeviceClass` hook stamps `device-fz55` on `<html>` when running on FZ-55 hardware. A dedicated `fz55.css` stylesheet scopes all fixes under `.device-fz55` so they never affect other viewports. Layout.tsx mounts the hook once for the app-wide class effect. PanelTitleBar gets a `data-panel-header` attribute so the CSS can target it without relying on minified class names.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite 6, `vitest`

## Global Constraints

- All CSS fixes MUST be scoped under `.device-fz55` — no global overrides
- No hex colors in new CSS — use CSS variables from `theme-palettes.css`
- No new dependencies
- Touch target minimum: 44px height and width (WCAG 2.5.5)
- Run `cd client && npx vitest run` after every task — zero new failures allowed
- Run `cd client && npx tsc --noEmit` after every task — zero new type errors

---

### Task 1: `useDeviceClass` hook

**Files:**
- Create: `client/src/hooks/useDeviceClass.ts`
- Create: `client/src/hooks/__tests__/useDeviceClass.test.ts`

**Interfaces:**
- Produces: `useDeviceClass(): { isFz55: boolean }` — imported by `Layout.tsx` in Task 4

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/hooks/__tests__/useDeviceClass.test.ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Helper to set screen dimensions and touch points
function mockScreen(width: number, height: number, touchPoints = 0, ua = 'Mozilla/5.0') {
  Object.defineProperty(window, 'screen', {
    value: { width, height },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: touchPoints,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    writable: true,
    configurable: true,
  });
}

describe('useDeviceClass', () => {
  beforeEach(() => {
    document.documentElement.className = '';
  });

  afterEach(() => {
    document.documentElement.className = '';
    vi.restoreAllMocks();
  });

  it('stamps device-fz55 on html when all three conditions met (1920x1080 touch laptop)', async () => {
    mockScreen(1920, 1080, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(true);
    expect(document.documentElement.classList.contains('device-fz55')).toBe(true);
  });

  it('stamps device-fz55 for 1366x768 config', async () => {
    mockScreen(1366, 768, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(true);
  });

  it('stamps device-fz55 for 1536x864 scaled config', async () => {
    mockScreen(1536, 864, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(true);
  });

  it('does NOT stamp when no touch points', async () => {
    mockScreen(1920, 1080, 0);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(false);
    expect(document.documentElement.classList.contains('device-fz55')).toBe(false);
  });

  it('does NOT stamp for phone viewport (too small)', async () => {
    mockScreen(390, 844, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(false);
  });

  it('does NOT stamp for 4K monitor (too wide)', async () => {
    mockScreen(3840, 2160, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(false);
  });

  it('does NOT stamp for mobile UA even if screen matches', async () => {
    mockScreen(1366, 768, 5, 'Mozilla/5.0 (Android; Mobile; rv:102.0)');
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(false);
  });

  it('removes device-fz55 class on resize to non-FZ55 dimensions', async () => {
    mockScreen(1920, 1080, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    renderHook(() => useDeviceClass());
    expect(document.documentElement.classList.contains('device-fz55')).toBe(true);

    // Simulate connect to 4K external monitor
    act(() => {
      mockScreen(3840, 2160, 5);
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.documentElement.classList.contains('device-fz55')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd client && npx vitest run src/hooks/__tests__/useDeviceClass.test.ts
```

Expected: FAIL — `Cannot find module '../useDeviceClass'`

- [ ] **Step 3: Implement the hook**

```typescript
// client/src/hooks/useDeviceClass.ts
import { useEffect, useState } from 'react';

const FZ55_CLASS = 'device-fz55';

function detectFz55(): boolean {
  return (
    navigator.maxTouchPoints > 0 &&
    screen.width >= 1300 && screen.width <= 1960 &&
    screen.height >= 700 && screen.height <= 1120 &&
    !/Mobi|Android/i.test(navigator.userAgent)
  );
}

export function useDeviceClass(): { isFz55: boolean } {
  const [isFz55, setIsFz55] = useState(() => {
    const match = detectFz55();
    if (match) {
      document.documentElement.classList.add(FZ55_CLASS);
    }
    return match;
  });

  useEffect(() => {
    function handleResize() {
      const match = detectFz55();
      if (match) {
        document.documentElement.classList.add(FZ55_CLASS);
      } else {
        document.documentElement.classList.remove(FZ55_CLASS);
      }
      setIsFz55(match);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { isFz55 };
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd client && npx vitest run src/hooks/__tests__/useDeviceClass.test.ts
```

Expected: 8 tests PASS

- [ ] **Step 5: Run full client suite — zero new failures**

```bash
cd client && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useDeviceClass.ts client/src/hooks/__tests__/useDeviceClass.test.ts
git commit -m "feat(fz55): useDeviceClass hook — stamps device-fz55 on html for Toughbook FZ-55 detection"
```

---

### Task 2: FZ-55 scoped CSS + index.css import

**Files:**
- Create: `client/src/styles/fz55.css`
- Modify: `client/src/index.css` (line 1 — add import)

**Interfaces:**
- Consumes: `device-fz55` class on `<html>` (stamped by hook in Task 1)
- Consumes: `data-panel-header` attribute on PanelTitleBar (added in Task 3)
- Produces: All layout fixes active when `.device-fz55` is present on `<html>`

- [ ] **Step 1: Create `fz55.css`**

```css
/* client/src/styles/fz55.css
   Panasonic Toughbook FZ-55 layout fixes.
   All rules scoped under .device-fz55 — zero effect on any other viewport. */

/* ── Touch targets — WCAG 2.5.5 / 44px gloved-hand minimum ── */
.device-fz55 button,
.device-fz55 a,
.device-fz55 [role="button"],
.device-fz55 input,
.device-fz55 select,
.device-fz55 textarea {
  min-height: 44px;
  min-width: 44px;
}

/* Icon-only buttons: extra padding fills the tap target without changing
   visual size. :has(> svg:only-child) matches a button whose only child is
   an SVG — the Lucide icon pattern used throughout the app. */
.device-fz55 button:has(> svg:only-child),
.device-fz55 [role="button"]:has(> svg:only-child) {
  padding: 10px;
  box-sizing: border-box;
}

/* ── Tables — horizontal scroll instead of viewport overflow ── */
.device-fz55 .table-wrapper,
.device-fz55 [class*="overflow-x-auto"] {
  overflow-x: auto;
  max-width: 100%;
}

/* ── Panel headers — never collapse under a flex parent ── */
.device-fz55 [data-panel-header] {
  flex-shrink: 0;
}

/* ── Modal height containment ── */
/* Prevents Save/Cancel buttons from falling below the 768px effective
   viewport at 125% Windows scaling. Targets the outer dialog backdrop. */
.device-fz55 [role="dialog"] {
  max-height: 90dvh;
}

/* Inner scroll body — allows content to scroll while footer buttons stay
   visible. Apply to the first div child of the dialog. */
.device-fz55 [role="dialog"] > div {
  max-height: 90dvh;
  overflow-y: auto;
}

/* ── Z-index stacking ladder ── */
/* Resolves sidebar-overlay-over-modal and dropdown-under-modal overlap
   classes. Values are explicit px to override Tailwind z-* utilities. */
.device-fz55 .sidebar-overlay { z-index: 40; }
.device-fz55 .sidebar         { z-index: 50; }
.device-fz55 [role="dialog"]  { z-index: 60; }
.device-fz55 [role="tooltip"] { z-index: 65; }
.device-fz55 .toast-container { z-index: 70; }
```

- [ ] **Step 2: Add import to `client/src/index.css`**

The first line of `index.css` is currently:
```css
@import './styles/theme-palettes.css';
```

Change it to:
```css
@import './styles/fz55.css';
@import './styles/theme-palettes.css';
```

`fz55.css` must come before `theme-palettes.css` so that theme variables are
available when fz55.css rules reference them (they don't today, but this order
is future-safe).

- [ ] **Step 3: Run client typecheck — no new errors**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Run full client suite — zero new failures**

```bash
cd client && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add client/src/styles/fz55.css client/src/index.css
git commit -m "feat(fz55): scoped CSS fixes for touch targets, modal height, table overflow, z-index"
```

---

### Task 3: Add `data-panel-header` to PanelTitleBar

**Files:**
- Modify: `client/src/components/PanelTitleBar.tsx` (line ~53 — the root `<div>`)

**Interfaces:**
- Consumes: nothing new
- Produces: `data-panel-header="true"` attribute on the title bar root div, consumed by `.device-fz55 [data-panel-header]` in `fz55.css`

**Why:** CSS class names are minified in the Vite production build. Targeting
`[data-panel-header]` is stable across builds; targeting a class name is not.

- [ ] **Step 1: Add the data attribute to the root div**

In `client/src/components/PanelTitleBar.tsx`, find the return statement's root div:

```tsx
  return (
    <div
      className={`panel-title-bar ${className}`}
      role="heading"
      aria-level={3}
      onMouseEnter={() => setHovered('chrome')}
      onMouseLeave={() => setHovered(null)}
    >
```

Add `data-panel-header="true"`:

```tsx
  return (
    <div
      className={`panel-title-bar ${className}`}
      role="heading"
      aria-level={3}
      data-panel-header="true"
      onMouseEnter={() => setHovered('chrome')}
      onMouseLeave={() => setHovered(null)}
    >
```

- [ ] **Step 2: Run client typecheck — no new errors**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 3: Run full client suite — zero new failures**

```bash
cd client && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/PanelTitleBar.tsx
git commit -m "feat(fz55): add data-panel-header attribute to PanelTitleBar for stable CSS targeting"
```

---

### Task 4: Mount `useDeviceClass` in `Layout.tsx`

**Files:**
- Modify: `client/src/components/Layout.tsx` (import + one hook call inside the Layout function body)

**Interfaces:**
- Consumes: `useDeviceClass(): { isFz55: boolean }` from Task 1
- Produces: `device-fz55` class stamped on `<html>` for every authenticated route (Layout wraps all authenticated routes)

**Note:** `isFz55` is not used in JSX here — the hook's side effect (class on `<html>`) is the
deliverable. The return value is destructured anyway so future callers can import it from context
without adding another hook call. No JSX changes needed in this task.

- [ ] **Step 1: Add the import**

In `client/src/components/Layout.tsx`, find the block of local hook imports (near the top, after the
long Lucide icon imports). Add:

```typescript
import { useDeviceClass } from '../hooks/useDeviceClass';
```

- [ ] **Step 2: Call the hook inside the Layout function**

In `client/src/components/Layout.tsx`, find `export default function Layout()` (line 393). Inside
the function body, near the other hook calls at the top (after `const location = useLocation()` etc.),
add:

```typescript
// Stamps device-fz55 on <html> when running on a Toughbook FZ-55.
// The CSS in fz55.css scopes all layout fixes under that class.
useDeviceClass();
```

- [ ] **Step 3: Run client typecheck — no new errors**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Run full client suite — zero new failures**

```bash
cd client && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "feat(fz55): mount useDeviceClass in Layout — activates FZ-55 CSS fixes app-wide"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Detection hook — touch + screen size + non-mobile UA | Task 1 |
| Re-evaluates on resize (external monitor) | Task 1 |
| Stamps `device-fz55` on `<html>` | Task 1 |
| Touch targets 44px minimum | Task 2 |
| Icon-only button padding | Task 2 |
| Table horizontal scroll | Task 2 |
| Panel header flex-shrink: 0 | Tasks 2 + 3 |
| Modal max-height 90dvh | Task 2 |
| Z-index stacking ladder | Task 2 |
| Import fz55.css in index.css | Task 2 |
| `data-panel-header` attribute on PanelTitleBar | Task 3 |
| Mount hook in Layout.tsx | Task 4 |
| Sidebar collapse (design spec) | **N/A** — sidebar removed prior to this work; navigation is a top icon toolbar |

**Placeholder scan:** No TBDs, no "implement later", no "similar to Task N" — all steps include complete code. ✅

**Type consistency:**
- `useDeviceClass` returns `{ isFz55: boolean }` in Task 1 — destructured in Task 4 as `useDeviceClass()` (return value unused but typed correctly). ✅
- `data-panel-header` is a standard HTML data attribute — no TypeScript declaration needed. ✅
