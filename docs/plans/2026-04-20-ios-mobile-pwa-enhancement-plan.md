# iOS Mobile PWA Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship two parallel tracks — (A) iOS PWA shell polish that improves every page on iPhone, and (B) a new role-aware `/mobile` card-grid dashboard that becomes the home screen for installed-PWA users on phone-sized viewports.

**Architecture:** Track A modifies `client/index.html`, `manifest.json`, `index.css`, and `Layout.tsx` plus a new `useStandalone` hook + install coaching modal. Track B adds `client/src/pages/mobile/` with 8 lazy-loaded role-gated cards reusing existing APIs and the `useLiveSync` WS context — zero new server routes.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind, Vitest (jsdom) for tests, OpenLayers (already in tree from `map-v2`), better-sqlite3 server unchanged.

**Reference design:** `docs/plans/2026-04-20-ios-mobile-pwa-enhancement-design.md`

---

## Conventions for every task

- **Branch / worktree:** already on `claude/elastic-kepler-1e7327`. Stay here.
- **TDD:** every task with logic writes the failing test first, then the minimal code, then verifies. CSS-only / asset-only tasks use a manual verification step instead of unit tests.
- **Typecheck gate:** after each implementation step, run `cd client && npx tsc --noEmit` — must pass with 0 errors. This is the deploy gate (per CLAUDE.md Gotcha #21).
- **Smoke test gate:** after Phase 2+ tasks, run `cd client && npx vitest run --reporter=dot` — must pass.
- **Commit cadence:** one commit per task. Commit message format: `feat(mobile): <task summary>` or `fix(pwa): ...` etc.
- **Do NOT bump `CACHE_NAME` in `client/public/sw.js` until Phase 5.** That's done once at the end of each shippable batch.
- **Service worker / deploy:** do NOT deploy from this worktree at any step — see CLAUDE.md Gotcha #43. Final deploy is the user's call after merge.

---

## Phase 1 — Track A: Shell polish (Tasks 1-6)

### Task 1: Add `useStandalone` hook

**Files:**
- Create: `client/src/hooks/useStandalone.ts`
- Test: `client/src/hooks/__tests__/useStandalone.test.ts`

**Step 1: Write the failing test**

```typescript
// client/src/hooks/__tests__/useStandalone.test.ts
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStandalone } from '../useStandalone';

describe('useStandalone', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 375 });
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
  });

  it('detects standalone iOS phone viewport', () => {
    const { result } = renderHook(() => useStandalone());
    expect(result.current.isStandalone).toBe(true);
    expect(result.current.isIOS).toBe(true);
    expect(result.current.isMobileViewport).toBe(true);
  });

  it('returns false flags on desktop chrome', () => {
    (window.matchMedia as any).mockImplementation((q: string) => ({
      matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1440 });
    Object.defineProperty(navigator, 'userAgent', {
      writable: true, value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
    });
    const { result } = renderHook(() => useStandalone());
    expect(result.current.isStandalone).toBe(false);
    expect(result.current.isIOS).toBe(false);
    expect(result.current.isMobileViewport).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useStandalone.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// client/src/hooks/useStandalone.ts
import { useEffect, useState } from 'react';

export interface StandaloneState {
  isStandalone: boolean;
  isIOS: boolean;
  isMobileViewport: boolean;
}

const MOBILE_BREAKPOINT_PX = 768;

function detect(): StandaloneState {
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      // legacy iOS Safari
      (navigator as any).standalone === true);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent ?? '');
  const isMobileViewport =
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX;
  return { isStandalone, isIOS, isMobileViewport };
}

export function useStandalone(): StandaloneState {
  const [state, setState] = useState<StandaloneState>(detect);
  useEffect(() => {
    const onResize = () => setState(detect());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return state;
}
```

**Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useStandalone.test.ts && npx tsc --noEmit`
Expected: PASS, 0 TS errors.

**Step 5: Commit**

```bash
git add client/src/hooks/useStandalone.ts client/src/hooks/__tests__/useStandalone.test.ts
git commit -m "feat(pwa): add useStandalone hook for iOS PWA detection"
```

---

### Task 2: Add safe-area + 16px-input + 44px-touch CSS rules

**Files:**
- Modify: `client/src/index.css` (append to end, inside the existing Spillman enforcement block area)

**Step 1: Add CSS (no test — visual change)**

Append at end of `client/src/index.css`:

```css
/* ── iOS PWA shell polish (2026-04-20) ──────────────────── */
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}

@media (max-width: 767px) {
  /* Kill iOS auto-zoom on input focus (triggered when font-size < 16px) */
  input, textarea, select {
    font-size: 16px !important;
  }
  /* Touch target minimum per Apple HIG */
  button, a[role="button"], .touch-target {
    min-height: 44px;
    min-width: 44px;
  }
  /* Safe-area utilities */
  .safe-px { padding-left: var(--safe-left); padding-right: var(--safe-right); }
  .safe-pt { padding-top: var(--safe-top); }
  .safe-pb { padding-bottom: var(--safe-bottom); }
  /* Prevent iOS rubber-band overscroll on full-page scrollers */
  .no-overscroll { overscroll-behavior: none; }
}
```

**Step 2: Verify desktop unchanged**

Run: `cd client && npx vite build` — must succeed.
Open `client/dist/index.html` in a desktop browser at >768px viewport — confirm no visible regression on `/dashboard`.

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "feat(pwa): safe-area, 16px input, 44px touch CSS for mobile"
```

---

### Task 3: Wire safe-area insets into Layout.tsx mobile branch

**Files:**
- Modify: `client/src/components/Layout.tsx` (mobile header + drawer sections)

**Step 1: Locate mobile header**

Run: `cd client && grep -n "48px\|md:hidden\|mobile" src/components/Layout.tsx | head -20`

**Step 2: Add `safe-px` and `safe-pt` classes to the mobile header div and the drawer container**

For each mobile-only chrome element (the 48px header, the hamburger drawer), add `safe-px` to the className (and `safe-pt` for the top of the header so the notch doesn't overlap content).

Example transformation:
```tsx
// before
<header className="md:hidden h-12 bg-[#0a0a0a] flex items-center px-3">
// after
<header className="md:hidden h-12 bg-[#0a0a0a] flex items-center px-3 safe-px safe-pt">
```

Do this for: mobile header bar, drawer container, any fixed-bottom mobile element.

**Step 3: Typecheck and visual check**

```bash
cd client && npx tsc --noEmit
```

Open in iPhone simulator or DevTools mobile emulation (iPhone 14 Pro) — confirm header sits below the notch.

**Step 4: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "feat(pwa): apply safe-area insets to Layout mobile chrome"
```

---

### Task 4: Add 180×180 apple-touch-icon + larger icon set to manifest

**Files:**
- Modify: `client/public/manifest.json`
- Create: `client/public/icons/icon-180.png` (resize from `rmpg flex.png`)
- Create: `client/public/icons/icon-192.png`
- Create: `client/public/icons/icon-512.png`
- Modify: `client/index.html` (add explicit `<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">`)

**Step 1: Generate icons**

```bash
cd client/public
mkdir -p icons
# Requires sips (macOS built-in) or ImageMagick
sips -z 180 180 "rmpg flex.png" --out icons/icon-180.png
sips -z 192 192 "rmpg flex.png" --out icons/icon-192.png
sips -z 512 512 "rmpg flex.png" --out icons/icon-512.png
```

**Step 2: Update manifest.json**

```json
{
  "name": "RMPG Flex — CAD/RMS",
  "short_name": "RMPG Flex",
  "description": "Rocky Mountain Protective Group — Computer-Aided Dispatch & Records Management System",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "orientation": "any",
  "categories": ["business", "productivity", "utilities"],
  "icons": [
    { "src": "/favicon.png", "sizes": "64x64", "type": "image/png" },
    { "src": "/icons/icon-180.png", "sizes": "180x180", "type": "image/png" },
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" },
    { "src": "/rmpg flex.png", "sizes": "1024x1024", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

**Step 3: Update index.html**

Replace line 6 of `client/index.html`:
```html
<link rel="apple-touch-icon" href="/rmpg flex.png" />
```
with:
```html
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png" />
```

**Step 4: Verify**

Run: `cd client && npx vite build` — must succeed. Confirm `dist/icons/icon-180.png` exists.

**Step 5: Commit**

```bash
git add client/public/manifest.json client/public/icons/ client/index.html
git commit -m "feat(pwa): add 180/192/512 PWA icons and manifest entries"
```

---

### Task 5: Add iOS install coaching modal (iOS-only, 30-day suppression)

**Files:**
- Create: `client/src/components/InstallCoachingModal.tsx`
- Test: `client/src/components/__tests__/InstallCoachingModal.test.tsx`
- Modify: `client/src/App.tsx` (mount modal once, near root)

**Step 1: Write the failing test**

```typescript
// client/src/components/__tests__/InstallCoachingModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstallCoachingModal } from '../InstallCoachingModal';

describe('InstallCoachingModal', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn(),
      }),
    });
    Object.defineProperty(navigator, 'userAgent', {
      writable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    });
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 375 });
  });

  it('renders for iOS Safari mobile when not standalone and not dismissed', () => {
    render(<InstallCoachingModal />);
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument();
  });

  it('does not render when already dismissed within 30 days', () => {
    localStorage.setItem('rmpg_install_dismissed_at', String(Date.now()));
    render(<InstallCoachingModal />);
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument();
  });

  it('persists dismissal on close click', () => {
    render(<InstallCoachingModal />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(localStorage.getItem('rmpg_install_dismissed_at')).toBeTruthy();
  });
});
```

**Step 2: Run test — expect fail**

Run: `cd client && npx vitest run src/components/__tests__/InstallCoachingModal.test.tsx`
Expected: FAIL.

**Step 3: Implement**

```tsx
// client/src/components/InstallCoachingModal.tsx
import { useState } from 'react';
import { useStandalone } from '../hooks/useStandalone';

const STORAGE_KEY = 'rmpg_install_dismissed_at';
const SUPPRESS_DAYS = 30;
const SUPPRESS_MS = SUPPRESS_DAYS * 24 * 60 * 60 * 1000;

export function InstallCoachingModal() {
  const { isStandalone, isIOS, isMobileViewport } = useStandalone();
  const [dismissed, setDismissed] = useState(() => {
    const at = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
    return at > 0 && Date.now() - at < SUPPRESS_MS;
  });

  if (isStandalone || !isIOS || !isMobileViewport || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 safe-pb">
      <div className="w-full max-w-md bg-[#141414] border-t border-[#222] p-4 rounded-t-sm">
        <h2 className="text-[#d4a017] text-sm font-bold tracking-widest mb-2">
          INSTALL RMPG FLEX
        </h2>
        <p className="text-white text-sm mb-3">
          Add to Home Screen for full-screen access, faster launch, and offline maps.
        </p>
        <ol className="text-gray-300 text-xs space-y-1 mb-4 list-decimal list-inside">
          <li>Tap the Share icon at the bottom of Safari.</li>
          <li>Scroll and tap <span className="text-[#d4a017]">Add to Home Screen</span>.</li>
          <li>Tap <span className="text-[#d4a017]">Add</span> in the top-right.</li>
        </ol>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="w-full h-11 bg-[#1a1a1a] border border-[#222] text-gray-300 text-xs uppercase tracking-widest"
        >
          Not Now
        </button>
      </div>
    </div>
  );
}
```

**Step 4: Mount in App.tsx**

Add import near other component imports, and place `<InstallCoachingModal />` once inside the authenticated layout tree (after `<Layout>` opens, or at root inside `<AuthProvider>`). Confirm placement does not break existing route render.

**Step 5: Run tests + typecheck**

```bash
cd client && npx vitest run src/components/__tests__/InstallCoachingModal.test.tsx && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add client/src/components/InstallCoachingModal.tsx client/src/components/__tests__/InstallCoachingModal.test.tsx client/src/App.tsx
git commit -m "feat(pwa): iOS install coaching modal with 30-day suppression"
```

---

### Task 6: Add 8s reload-button fallback to pre-splash

**Files:**
- Modify: `client/index.html` (lines 53-65 — the `#pre-splash` block)

**Step 1: Add inline script that reveals a Reload button after 8s if React hasn't hydrated**

Inside the `#pre-splash` div, add:
```html
<button id="pre-splash-reload" type="button"
  style="display:none;margin-top:18px;padding:10px 16px;background:#1a1a1a;border:1px solid #222;color:#ccc;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;cursor:pointer"
  onclick="window.location.reload()">
  Reload
</button>
```

After the existing `<style>` block at line 65, add:
```html
<script>
  setTimeout(function () {
    var splash = document.getElementById('pre-splash');
    var btn = document.getElementById('pre-splash-reload');
    if (splash && splash.offsetParent !== null && btn) btn.style.display = 'inline-block';
  }, 8000);
</script>
```

**Step 2: Verify**

Run: `cd client && npx vite build` — must succeed.

**Step 3: Commit**

```bash
git add client/index.html
git commit -m "feat(pwa): show Reload button after 8s if React hydration stalls"
```

---

## Phase 2 — Track B scaffold (Tasks 7-9)

### Task 7: Add `useMobileLayout(role)` hook

**Files:**
- Create: `client/src/pages/mobile/hooks/useMobileLayout.ts`
- Test: `client/src/pages/mobile/hooks/__tests__/useMobileLayout.test.ts`

**Step 1: Write failing test**

```typescript
// client/src/pages/mobile/hooks/__tests__/useMobileLayout.test.ts
import { describe, it, expect } from 'vitest';
import { useMobileLayout, CardId } from '../useMobileLayout';

describe('useMobileLayout', () => {
  it('returns full set ordered for officer', () => {
    expect(useMobileLayout('officer')).toEqual<CardId[]>([
      'unit', 'calls', 'search', 'bolos', 'map', 'actions', 'messages', 'shift',
    ]);
  });
  it('returns calls-first for dispatcher', () => {
    expect(useMobileLayout('dispatcher')).toEqual<CardId[]>([
      'calls', 'map', 'messages', 'bolos', 'search',
    ]);
  });
  it('returns shift-only for human_resources', () => {
    expect(useMobileLayout('human_resources')).toEqual<CardId[]>(['shift']);
  });
  it('returns minimal view-only for client_viewer', () => {
    expect(useMobileLayout('client_viewer')).toEqual<CardId[]>(['bolos', 'calls']);
  });
});
```

**Step 2: Run — expect fail.**

Run: `cd client && npx vitest run src/pages/mobile/hooks/__tests__/useMobileLayout.test.ts`

**Step 3: Implement**

```typescript
// client/src/pages/mobile/hooks/useMobileLayout.ts
export type CardId =
  | 'unit' | 'calls' | 'search' | 'bolos' | 'map' | 'actions' | 'messages' | 'shift';

export type Role =
  | 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher'
  | 'contract_manager' | 'client_viewer' | 'human_resources';

const LAYOUTS: Record<Role, CardId[]> = {
  officer: ['unit', 'calls', 'search', 'bolos', 'map', 'actions', 'messages', 'shift'],
  dispatcher: ['calls', 'map', 'messages', 'bolos', 'search'],
  supervisor: ['calls', 'map', 'unit', 'messages', 'bolos'],
  admin: ['search', 'calls', 'bolos', 'messages'],
  manager: ['calls', 'shift', 'messages', 'bolos'],
  contract_manager: ['shift', 'calls'],
  client_viewer: ['bolos', 'calls'],
  human_resources: ['shift'],
};

export function useMobileLayout(role: Role | string | undefined): CardId[] {
  return LAYOUTS[(role as Role)] ?? ['calls', 'search'];
}
```

**Step 4: Pass + typecheck**

```bash
cd client && npx vitest run src/pages/mobile/hooks/__tests__/useMobileLayout.test.ts && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add client/src/pages/mobile/hooks/
git commit -m "feat(mobile): role-based card layout hook"
```

---

### Task 8: Add `useGeolocation` hook

**Files:**
- Create: `client/src/pages/mobile/hooks/useGeolocation.ts`
- Test: `client/src/pages/mobile/hooks/__tests__/useGeolocation.test.ts`

**Step 1: Failing test**

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGeolocation } from '../useGeolocation';

describe('useGeolocation', () => {
  let watchCb: PositionCallback | null = null;
  let errCb: PositionErrorCallback | null = null;

  beforeEach(() => {
    watchCb = null; errCb = null;
    Object.defineProperty(navigator, 'geolocation', {
      writable: true,
      value: {
        watchPosition: vi.fn((ok, err) => { watchCb = ok; errCb = err; return 1; }),
        clearWatch: vi.fn(),
      },
    });
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useGeolocation({ enabled: false }));
    expect(result.current.status).toBe('idle');
    expect(result.current.position).toBeNull();
  });

  it('reports position when watch fires', () => {
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    act(() => {
      watchCb!({ coords: { latitude: 40.76, longitude: -111.89, accuracy: 10 } } as any);
    });
    expect(result.current.position?.lat).toBe(40.76);
    expect(result.current.status).toBe('granted');
  });

  it('reports denied error', () => {
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    act(() => {
      errCb!({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    expect(result.current.status).toBe('denied');
  });
});
```

**Step 2: Run — expect fail.**

**Step 3: Implement**

```typescript
// client/src/pages/mobile/hooks/useGeolocation.ts
import { useEffect, useState } from 'react';

export type GeoStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

export function useGeolocation(opts: { enabled: boolean }): {
  status: GeoStatus;
  position: GeoPosition | null;
} {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [position, setPosition] = useState<GeoPosition | null>(null);

  useEffect(() => {
    if (!opts.enabled) return;
    if (!('geolocation' in navigator)) { setStatus('unavailable'); return; }
    setStatus('requesting');
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setStatus('granted');
      },
      (err) => { setStatus(err.code === 1 ? 'denied' : 'unavailable'); },
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [opts.enabled]);

  return { status, position };
}
```

**Step 4: Pass + typecheck.**

```bash
cd client && npx vitest run src/pages/mobile/hooks/__tests__/useGeolocation.test.ts && npx tsc --noEmit
```

**Step 5: Commit.**

```bash
git add client/src/pages/mobile/hooks/useGeolocation.ts client/src/pages/mobile/hooks/__tests__/useGeolocation.test.ts
git commit -m "feat(mobile): GPS watchPosition hook with permission states"
```

---

### Task 9: Scaffold `MobileHomePage` (orchestrator + smoke test)

**Files:**
- Create: `client/src/pages/mobile/MobileHomePage.tsx`
- Create: `client/src/pages/mobile/index.ts` (re-export)
- Create: `client/src/pages/mobile/__tests__/MobileHomePage.smoke.test.tsx`
- Modify: `client/src/App.tsx` — add lazy route `/mobile`

**Step 1: Write smoke test**

```typescript
// client/src/pages/mobile/__tests__/MobileHomePage.smoke.test.tsx
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({})),
}));
vi.mock('../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: () => () => {} }),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'officer', id: 1, username: 'test' } }),
}));

describe('MobileHomePage (smoke)', () => {
  it('module loads without throwing', async () => {
    const mod = await import('../MobileHomePage');
    expect(mod.default).toBeDefined();
  });
});
```

**Step 2: Run — expect fail (module missing).**

**Step 3: Implement scaffold**

```tsx
// client/src/pages/mobile/MobileHomePage.tsx
import { lazy, Suspense } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useMobileLayout, CardId } from './hooks/useMobileLayout';

const CARDS: Record<CardId, React.LazyExoticComponent<any>> = {
  unit: lazy(() => import('./cards/UnitStatusCard')),
  calls: lazy(() => import('./cards/ActiveCallsCard')),
  search: lazy(() => import('./cards/QuickSearchCard')),
  bolos: lazy(() => import('./cards/BolosCard')),
  map: lazy(() => import('./cards/MapSnippetCard')),
  actions: lazy(() => import('./cards/QuickActionsCard')),
  messages: lazy(() => import('./cards/MessagesCard')),
  shift: lazy(() => import('./cards/ShiftCard')),
};

export default function MobileHomePage() {
  const { user } = useAuth();
  const cards = useMobileLayout(user?.role);

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-white safe-px safe-pb no-overscroll">
      <header className="safe-pt py-3 border-b border-[#222]">
        <h1 className="text-[#d4a017] text-xs font-bold tracking-widest text-center">
          RMPG FLEX · MOBILE
        </h1>
      </header>
      <main className="p-3 space-y-3">
        {cards.map((id) => {
          const Card = CARDS[id];
          return (
            <Suspense key={id} fallback={<div className="h-32 bg-[#141414] border border-[#222] animate-pulse" />}>
              <Card />
            </Suspense>
          );
        })}
      </main>
    </div>
  );
}
```

```typescript
// client/src/pages/mobile/index.ts
export { default } from './MobileHomePage';
```

Add to `client/src/App.tsx` near the other `lazyRetry` imports:
```typescript
const MobileHomePage = lazyRetry(() => import('./pages/mobile'));
```
And add a route inside the authenticated `<Routes>` block:
```tsx
<Route path="/mobile" element={<MobileHomePage />} />
```

**Step 4: Create stub card files so lazy imports resolve**

For each of the 8 cards, create a placeholder so Phase 2 builds clean. Each card will be filled in during Phase 3.

```bash
cd client/src/pages/mobile && mkdir -p cards
for f in UnitStatusCard ActiveCallsCard QuickSearchCard BolosCard MapSnippetCard QuickActionsCard MessagesCard ShiftCard; do
  cat > cards/$f.tsx <<EOF
export default function $f() {
  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">${f^^}</h2>
      <p className="text-gray-500 text-xs">Coming soon.</p>
    </section>
  );
}
EOF
done
```

(If your shell doesn't support `${f^^}`, just write each file manually with a literal title.)

**Step 5: Run smoke test + typecheck**

```bash
cd client && npx vitest run src/pages/mobile/__tests__/MobileHomePage.smoke.test.tsx && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add client/src/pages/mobile/ client/src/App.tsx
git commit -m "feat(mobile): scaffold /mobile route with role-aware card loader"
```

---

## Phase 3 — Build the 8 cards (Tasks 10-17)

Each card task follows the same structure. The plan below gives the spec per card; the implementer writes a smoke test (`module loads + renders without throwing`) plus one behavioral test (the "Acceptance" line), then implements.

For **every** card task:

- **Test file:** `client/src/pages/mobile/cards/__tests__/<Card>.test.tsx`
- **Mocks:** mock `apiFetch` (`../../../../hooks/useApi`) and `useWebSocket` (`../../../../context/WebSocketContext`).
- **Tailwind tokens:** match Spillman dark theme — surfaces `#141414` raised / `#0a0a0a` base / `#050505` sunken; gold `#d4a017`; borders `#222`; 2px radius (no `rounded-lg`).
- **Headers:** card title is 10px uppercase tracking-widest, gold.
- **Loading state:** show `animate-pulse` skeleton block of same height.
- **Error state:** retry chip — `text-amber-400 text-xs` + `Retry` button (44px tap target).
- **Empty state:** `text-gray-500 text-xs` italic message.
- **Commit:** `feat(mobile): <CardName> card`

### Task 10: `UnitStatusCard`

**Spec:**
- Endpoint: `GET /api/dispatch/units/me` (returns current user's unit if assigned).
- Renders unit ID, current status (10-8/10-7/10-6/10-42), assignment summary.
- 4 status buttons (44px each) → `POST /api/dispatch/units/:id/status` with `{ status: '10-8' }`.
- WS subscribe to `unit_update`; if message's unit.id matches mine, refetch.
- If not assigned to a unit: empty state "Not on a unit. Use /dispatch to log on."
- **Acceptance test:** clicking the 10-7 button calls `apiFetch` with `{ method: 'POST' }` and the right path.

### Task 11: `ActiveCallsCard`

**Spec:**
- Endpoint: `GET /api/dispatch/calls?status=ACTIVE&limit=20`.
- Renders P1 count + P2 count chips at top, then a list of up to 6 calls (call number, type, location, age in `Xm`).
- Toggle: "Show distance" — when on, calls `useGeolocation({ enabled: true })` and computes haversine distance for each call's `lat`/`lng`. Distance shown as `1.2 mi`.
- Each row is a tap target → `navigate(`/dispatch?call=${call_number}`)`.
- WS subscribe to `dispatch_update`; debounce 250ms and refetch.
- **Acceptance test:** mock `apiFetch` to return 3 calls (2 P1, 1 P2); component renders "P1 · 2" and "P2 · 1".

### Task 12: `QuickSearchCard`

**Spec:**
- Single `<input type="search">` — placeholder `"Person, plate, address…"` — 16px font (no zoom).
- On submit (Enter or button): `apiFetch('/api/records/universal-search?q=…')`.
- Result list: top 5 hits, grouped by type (PERSON / VEHICLE / WARRANT / etc.). Each row taps through to its detail route.
- **Acceptance test:** typing "smith", submitting, and resolving the mock to 1 PERSON result renders that result.

### Task 13: `BolosCard`

**Spec:**
- Endpoint: combine `GET /api/bolos?active=1&limit=10` and `GET /api/dispatch/premise-alerts?active=1&limit=5`. (Verify these endpoints exist by `grep -r "premise-alerts\|/api/bolos" server/src/routes`. If different paths, adjust.)
- Renders chronological merged feed; BOLOs in red header, premise alerts in amber.
- WS subscribe to `bolo_update`, `premise_alert`.
- Tap row → modal with full text (use existing modal pattern from `IncidentsPage` or build inline).
- **Acceptance test:** mock both endpoints to return 1 each; expect both items visible.

### Task 14: `MapSnippetCard`

**Spec:**
- Reuses `useOlBeatLayer` and `useOlLiveMarkers` hooks from `client/src/pages/map-v2/hooks/` (already exists per CLAUDE.md).
- 240px tall OpenLayers map fixed to user's GPS center if available, else SLC default `[40.7608, -111.8910]`.
- Read-only — no click handlers; whole card has a single `<a href="/map-v2">Open full map →</a>` footer link.
- **Acceptance test:** module loads, renders the gold "MAP" header, footer link present.

### Task 15: `QuickActionsCard`

**Spec:**
- 3 large buttons (≥56px each, full-width grid):
  1. `+ FI` → `navigate('/field-interviews?new=1')`
  2. `+ Citation` → `navigate('/citations?new=1')`
  3. `+ Incident` → `navigate('/incidents?new=1')`
- Pure routing — no API calls.
- **Acceptance test:** clicking each button calls `useNavigate()` mock with the right path.

### Task 16: `MessagesCard`

**Spec:**
- Endpoint: `GET /api/dispatch-messages?inbox=me&limit=5`.
- Top: unread count badge (`Inbox · 3 new` in gold).
- List: most-recent 3 messages with sender, time, first 60 chars.
- WS subscribe to `dispatch_message`; on new message, refetch.
- Footer: tap "Open thread" → `navigate('/communications?inbox=me')` (or whatever the existing route is — verify with `grep -r '/communications' client/src/App.tsx`).
- **Acceptance test:** mock 2 unread + 1 read → "Inbox · 2 new" rendered.

### Task 17: `ShiftCard`

**Spec:**
- Endpoint: `GET /api/hr/shift/current` (verify path; if different, adjust). Returns `{ active: boolean, started_at, hours_today, calls_handled }`.
- If `active: false`: "Clock In" button → `POST /api/hr/shift/start`.
- If `active: true`: "Clock Out" button → `POST /api/hr/shift/end`, plus `Hours: 4.2` and `Calls: 12` readouts.
- WS subscribe to `shift_update`.
- **Acceptance test:** mock `active: false` → "Clock In" renders; mock `active: true` → "Clock Out" renders with hours.

---

## Phase 4 — Polish + auto-redirect (Tasks 18-19)

### Task 18: Auto-redirect from `/` to `/mobile` for installed-PWA phone users

**Files:**
- Modify: `client/src/App.tsx` — wrap the `/` route with a redirect check using `useStandalone`.

**Step 1: Implement**

In `App.tsx`, replace the `/` route element with:
```tsx
import { useStandalone } from './hooks/useStandalone';

function HomeRedirect({ children }: { children: React.ReactNode }) {
  const { isStandalone, isMobileViewport } = useStandalone();
  if (isStandalone && isMobileViewport) return <Navigate to="/mobile" replace />;
  return <>{children}</>;
}

// route:
<Route path="/" element={<HomeRedirect><DashboardPage /></HomeRedirect>} />
```

**Step 2: Verify desktop unaffected**

Run `cd client && npx vite build && npx vitest run`. Manually open desktop preview — confirm `/` still loads `DashboardPage`.

**Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(mobile): auto-redirect installed PWA on phone to /mobile"
```

---

### Task 19: Bump service worker `CACHE_NAME`

**Files:**
- Modify: `client/public/sw.js`

**Step 1: Find current cache name**

```bash
grep CACHE_NAME client/public/sw.js
```

**Step 2: Increment** (e.g. `rmpg-flex-v273` → `rmpg-flex-v274`).

**Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump CACHE_NAME for iOS PWA enhancement release"
```

---

## Phase 5 — Final verification (no commit)

**Step 1: Full typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: 0 errors.

**Step 2: Full client test suite**

```bash
cd client && npx vitest run
```
Expected: all green.

**Step 3: Production build**

```bash
cd client && npx vite build
```
Expected: no errors. Note the output bundle sizes — the `/mobile` chunk should be small (cards lazy-loaded individually).

**Step 4: Manual smoke (DevTools mobile emulation)**

- Open `client/dist/index.html` via `npx serve client/dist`.
- DevTools → device toolbar → iPhone 14 Pro.
- Confirm: install coaching modal does NOT appear (Chrome UA).
- Override UA to iPhone Safari → install coaching modal appears.
- Navigate to `/mobile` directly → cards render in officer order.
- Switch user role (via login flow with another test user) → confirm card order changes.

**Step 5: Hand off**

Do NOT deploy from this worktree. Open a PR against `main` for review. The user runs `bash deploy/deploy.sh` after merge from the canonical workspace (per Gotcha #43).

---

## Risks recap

| Risk | Mitigation |
|---|---|
| Bad redirect traps users | Only triggers on standalone + <768px + path === `/` |
| Splash binary bloat | 3 PNGs only in this v1 (180/192/512), regenerated from existing source |
| WS suspends in standalone | Existing `useLiveSync` reconnects on focus |
| Test relies on iOS Safari runtime | Manual matrix step in Phase 5; no false CI confidence |

## Skills referenced

- @superpowers:executing-plans (top of file)
- @superpowers:test-driven-development (every task with logic)
- @superpowers:verification-before-completion (Phase 5)
