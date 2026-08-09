# Feature Toggle Nav Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Admin → System Config → System Settings → Feature Toggles for **Warrants, Fleet Mgmt, Evidence, and Patrol QR** actually hide their nav entry everywhere when disabled, instead of writing to a config bag nothing reads.

**Architecture:** The 4 toggles are already saved (via `PUT /admin/system-settings`) into `system_config` (category `'system_settings'`, keys `feature_warrants`/`feature_fleet`/`feature_evidence`/`feature_patrol_checkpoints`, string `'1'`/`'0'`). The endpoint that reads them back (`GET /admin/system-settings`) is deliberately admin/manager-only because it shares a table with plaintext third-party secrets — it cannot be opened to every role. This plan adds a new narrow, any-authenticated-role endpoint (`GET /api/feature-flags`) that reads ONLY these 4 keys, plus a client-side module mirroring the existing `systemSettings.ts` cache/hook pattern, then extends the 7 existing nav-filter functions (Sidebar, Layout ×3, MobileDrawer, ModuleTileBar, DesktopPage, ModuleDirectoryPage) and the static MenuBar entries with the same one-line-per-check pattern they already use for role-based hiding (`CLIENT_VIEWER_BLOCKED`/`CONTRACT_MANAGER_BLOCKED`/`adminOnly`).

**Tech Stack:** Hono route handlers, D1 (`system_config` table, read-only in this plan), React hooks, Vitest + React Testing Library (`client/src/**/__tests__`).

## Global Constraints

- Worker code lives under `/src/`; client code under `/client/src/`.
- **BOLOs is explicitly OUT OF SCOPE for this plan** — it has 4 separate entry points (communications badge, `/intel/bolos` route, header banner, mobile card) with no single nav-catalog entry, unlike the other 4 features which each have exactly one route + one nav label. It needs its own follow-up plan.
- **Server-side API blocking is explicitly OUT OF SCOPE.** This plan only hides nav entries. Disabling a toggle does not (yet) block the underlying API routes (`src/routes/warrants.ts`, `fleet.ts`, `evidence.ts`, `patrol.ts`) — a user who already knows the URL/API can still reach it. That is a larger, separate effort.
- The new `GET /api/feature-flags` endpoint must NEVER read or expose any key matching the existing `SECRET_KEY_PATTERN` used in `src/routes/admin.ts`'s `GET /admin/system-settings` handler — it must only ever query the 4 named `feature_*` keys, never `SELECT *` from `system_config`.
- All D1 calls are async — every `db.prepare(...)`/`query(...)` call must be `await`ed.
- Default-safe behavior: if a toggle row doesn't exist yet (nobody has saved System Settings), the feature must show as ENABLED (matches `DEFAULT_SYSTEM_SETTINGS` in `AdminSystemTab.tsx`, where all 4 default to `'1'`) — an admin who has never touched this section must see zero behavior change.
- Path → feature-flag-key mapping used throughout this plan: `/warrants` → `feature_warrants`, `/fleet` → `feature_fleet`, `/evidence` → `feature_evidence`, `/patrol` → `feature_patrol_checkpoints`.

---

## File Structure

- **Create:** `src/routes/featureFlags.ts` — new Hono router, `GET /` returns `{ feature_warrants: boolean, feature_fleet: boolean, feature_evidence: boolean, feature_patrol_checkpoints: boolean }`.
- **Modify:** `src/routesConfig.ts` — one new `ROUTE_REGISTRY` entry (alphabetically placed) mounting the router at `/api/feature-flags`, `auth: 'required'`.
- **Create:** `client/src/utils/featureFlags.ts` — client cache/hook module mirroring `client/src/utils/systemSettings.ts`'s pattern (`loadFeatureFlags()`, `isFeatureEnabled(path)`, `useFeatureFlags()`).
- **Modify:** `client/src/components/Layout.tsx` — call `loadFeatureFlags()` alongside the existing `loadSystemSettings()` call; add the toggle check to its 3 existing nav-filter closures.
- **Modify:** `client/src/components/Sidebar.tsx`, `client/src/components/mobile/MobileDrawer.tsx`, `client/src/components/ModuleTileBar.tsx`, `client/src/pages/DesktopPage.tsx`, `client/src/pages/ModuleDirectoryPage.tsx` — add the toggle check to each file's existing single filter function.
- **Modify:** `client/src/components/MenuBar.tsx` — conditionally include the `/warrants`, `/fleet`, `/evidence`, `/patrol` static menu entries.

---

### Task 1: `GET /api/feature-flags` — Worker endpoint

**Files:**
- Create: `src/routes/featureFlags.ts`
- Modify: `src/routesConfig.ts`
- Test: `tests/featureFlags.test.ts` (Node, mocked D1) — check `ls tests/ | grep -i feature` first; also check `test-workers/` for the Miniflare-level convention this repo prefers for route smoke tests and add one there too if similar routes have both (grep `test-workers/` for another simple `auth: 'required'`, read-only GET route's test as a template, e.g. `test-workers/adminSystemConfig.test.ts`).

**Interfaces:**
- Produces: `GET /api/feature-flags` → `200 { feature_warrants: boolean, feature_fleet: boolean, feature_evidence: boolean, feature_patrol_checkpoints: boolean }`, available to ANY authenticated role (no role gate beyond `authMiddleware`).

- [ ] **Step 1: Write the failing Node test**

```typescript
// tests/featureFlags.test.ts
import { describe, it, expect, vi } from 'vitest';
import featureFlags from '../src/routes/featureFlags';

function fakeEnv(rows: Array<{ config_key: string; config_value: string }>) {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: rows }),
        }),
      }),
    },
  };
}

describe('GET /api/feature-flags', () => {
  it('returns true for all 4 flags when no rows are saved (fail-open default)', async () => {
    const res = await featureFlags.request('/', {}, fakeEnv([]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      feature_warrants: true,
      feature_fleet: true,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
  });

  it('returns false only for the specific flag saved as 0', async () => {
    const res = await featureFlags.request('/', {}, fakeEnv([
      { config_key: 'feature_fleet', config_value: '0' },
    ]));
    const body = await res.json();
    expect(body).toEqual({
      feature_warrants: true,
      feature_fleet: false,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
  });

  it('treats any non-"0" saved value as enabled (matches the "1"/"0" string convention)', async () => {
    const res = await featureFlags.request('/', {}, fakeEnv([
      { config_key: 'feature_warrants', config_value: '1' },
    ]));
    const body = await res.json();
    expect(body.feature_warrants).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/featureFlags.test.ts`
Expected: FAIL with "Cannot find module '../src/routes/featureFlags'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/routes/featureFlags.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

const featureFlags = new Hono<Env>();

// The 4 keys this endpoint is allowed to ever return. Deliberately an
// allowlist, not a SELECT * — system_config also stores plaintext
// third-party secrets (see the SECRET_KEY_PATTERN guard on the admin/manager-
// only GET /admin/system-settings), and this endpoint is open to every
// authenticated role, so it must never be able to leak a secret-shaped key
// even if one were accidentally saved under a similar name.
const FLAG_KEYS = [
  'feature_warrants',
  'feature_fleet',
  'feature_evidence',
  'feature_patrol_checkpoints',
] as const;

featureFlags.get('/', async (c) => {
  const db = getDb(c.env);
  const rows = await query<{ config_key: string; config_value: string }>(
    db,
    `SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?, ?)`,
    ...FLAG_KEYS,
  );
  const saved = new Map(rows.map((r) => [r.config_key, r.config_value]));
  const result: Record<string, boolean> = {};
  for (const key of FLAG_KEYS) {
    // Fail-open: an unsaved key means "no admin has touched this yet", which
    // must mean enabled (matches DEFAULT_SYSTEM_SETTINGS in AdminSystemTab.tsx,
    // where all 4 toggles default to '1'). Only an explicit '0' disables.
    result[key] = saved.get(key) !== '0';
  }
  return c.json(result);
});

export default featureFlags;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/featureFlags.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Mount the route**

In `src/routesConfig.ts`, add the import near the other route imports (alphabetical, per the file's own documented convention) and add one entry to `ROUTE_REGISTRY`:

```typescript
import featureFlags from './routes/featureFlags';
```

```typescript
  { prefix: '/api/feature-flags', router: featureFlags, auth: 'required' },
```

Place it alphabetically among the other `/api/f*`-prefixed entries per the file's documented convention (search for the nearest alphabetical neighbor, e.g. near `/api/fleet` if one exists, to land on a unique line and avoid merge collisions).

- [ ] **Step 6: Typecheck and run the full worker test suite**

Run: `npm run typecheck && npx vitest run`
Expected: 0 typecheck errors; all tests pass.

- [ ] **Step 7: Add a Miniflare smoke test if the repo's convention calls for one**

If `test-workers/` has a simple pattern for a read-only `auth: 'required'` GET route (check `test-workers/adminSystemConfig.test.ts` or similar), add one test there confirming `GET /api/feature-flags` returns `200` for a non-admin authenticated role (e.g. `officer`) — this is the property that matters most: proving the endpoint is NOT role-gated like its admin/manager-only sibling. Run `npm run test:worker` and confirm it passes.

- [ ] **Step 8: Commit**

```bash
git add src/routes/featureFlags.ts src/routesConfig.ts tests/featureFlags.test.ts
git commit -m "feat(nav): add GET /api/feature-flags endpoint for any authenticated role"
```

(Add the Miniflare test file to the `git add` list too if Step 7 created one.)

---

### Task 2: Client `featureFlags.ts` module + boot wiring

**Files:**
- Create: `client/src/utils/featureFlags.ts`
- Modify: `client/src/components/Layout.tsx` (only the boot-load call site — the 3 filter-function edits are Task 6)
- Test: `client/src/utils/__tests__/featureFlags.test.ts`

**Interfaces:**
- Consumes: `apiFetch` from `../hooks/useApi` (same helper `systemSettings.ts` uses)
- Produces: `loadFeatureFlags(): Promise<Record<string, boolean>>`, `isFeatureEnabled(path: string): boolean`, `useFeatureFlags(): void` (a hook with no return value — its only job is to force a re-render via `useReducer` when flags finish loading, exactly like `useSystemSetting` does; components read the current state via the module-level `isFeatureEnabled` getter, not via this hook's return value)

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/utils/__tests__/featureFlags.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../hooks/useApi', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../hooks/useApi';
import { loadFeatureFlags, isFeatureEnabled, useFeatureFlags } from '../featureFlags';

describe('featureFlags', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('isFeatureEnabled defaults to true before any load (fail-open)', () => {
    expect(isFeatureEnabled('/warrants')).toBe(true);
    expect(isFeatureEnabled('/some-unmapped-path')).toBe(true);
  });

  it('loadFeatureFlags populates the cache from GET /feature-flags', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      feature_warrants: true,
      feature_fleet: false,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
    await loadFeatureFlags();
    expect(isFeatureEnabled('/fleet')).toBe(false);
    expect(isFeatureEnabled('/warrants')).toBe(true);
  });

  it('soft-fails on a fetch error, leaving the previous (or default) state intact', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('network error'));
    await loadFeatureFlags();
    // Still fail-open — a fetch error must never hide a nav item.
    expect(isFeatureEnabled('/fleet')).toBe(true);
  });

  it('useFeatureFlags re-renders a consumer once the load completes', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      feature_warrants: true,
      feature_fleet: false,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
    const { result } = renderHook(() => {
      useFeatureFlags();
      return isFeatureEnabled('/fleet');
    });
    await act(async () => { await loadFeatureFlags(); });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/featureFlags.test.ts`
Expected: FAIL with "Cannot find module '../featureFlags'"

- [ ] **Step 3: Write the implementation**

```typescript
// client/src/utils/featureFlags.ts
// ============================================================
// RMPG Flex — Feature-flag bridge (Admin System Config → nav)
// ============================================================
// The 4 Feature Toggles (Warrants/Fleet/Evidence/Patrol QR) are saved via
// PUT /admin/system-settings into system_config, but that read-back endpoint
// is deliberately admin/manager-only (it shares a table with plaintext
// third-party secrets). This module instead pulls from the narrow
// GET /api/feature-flags endpoint, open to every authenticated role, and
// mirrors systemSettings.ts's cache/hook pattern so nav components can read
// synchronously and re-render once the load completes.
// ============================================================

import { useEffect, useReducer } from 'react';
import { apiFetch } from '../hooks/useApi';

// path → system_config key. BOLOs is intentionally absent — it has no single
// nav entry and is out of scope for this module (see the Phase 2 plan).
const PATH_TO_FLAG_KEY: Record<string, string> = {
  '/warrants': 'feature_warrants',
  '/fleet': 'feature_fleet',
  '/evidence': 'feature_evidence',
  '/patrol': 'feature_patrol_checkpoints',
};

let cache: Record<string, boolean> = {};
let loaded = false;
const subscribers = new Set<() => void>();

export async function loadFeatureFlags(): Promise<Record<string, boolean>> {
  try {
    const res = await apiFetch<Record<string, boolean>>('/feature-flags');
    cache = res ?? {};
  } catch {
    // Soft-fail: keep whatever we have (or the fail-open default) — a
    // network hiccup must never hide a nav item a user is entitled to see.
  } finally {
    loaded = true;
    subscribers.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }
  return cache;
}

export function isFeatureEnabled(path: string): boolean {
  const key = PATH_TO_FLAG_KEY[path];
  if (!key) return true; // unmapped path — not one of the 4 toggled features
  const v = cache[key];
  return v == null ? true : v; // fail-open until loaded, or if the key is absent
}

export function useFeatureFlags(): void {
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subscribers.add(forceRender);
    return () => { subscribers.delete(forceRender); };
  }, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/featureFlags.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the boot-load call**

In `client/src/components/Layout.tsx`, find the existing `loadSystemSettings()` call (near line 749, inside a mount `useEffect`) and add the new call alongside it:

```typescript
import { loadFeatureFlags } from '../utils/featureFlags';
```

```typescript
    loadSystemSettings();
    loadFeatureFlags();
```

(Add the import near the existing `loadSystemSettings` import at the top of the file, and add the call on the line immediately after the existing `loadSystemSettings()` call — search for that literal line rather than trusting the line number, since earlier merges may have shifted it.)

- [ ] **Step 6: Typecheck and run the client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/featureFlags.ts client/src/utils/__tests__/featureFlags.test.ts client/src/components/Layout.tsx
git commit -m "feat(nav): add client feature-flags cache/hook + boot-load wiring"
```

---

### Task 3: Wire `Sidebar.tsx`

**Files:**
- Modify: `client/src/components/Sidebar.tsx`
- Test: `client/src/components/__tests__/Sidebar.test.tsx` (check for an existing file first)

**Interfaces:**
- Consumes: `isFeatureEnabled`, `useFeatureFlags` from `../utils/featureFlags` (Task 2)

- [ ] **Step 1: Check for an existing test file to extend**

Run: `ls client/src/components/__tests__/ | grep -i sidebar`

- [ ] **Step 2: Write the failing test**

```typescript
// client/src/components/__tests__/Sidebar.test.tsx (add to existing file, or create — check imports/render helpers used elsewhere in this directory first and match them)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../utils/featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
  useFeatureFlags: vi.fn(),
}));

import { isFeatureEnabled } from '../../utils/featureFlags';
import Sidebar from '../Sidebar';
// NOTE: adjust the mocked useAuth/useUser import below to match whatever
// hook Sidebar.tsx actually uses to read isAdmin/isContractManager — read
// the file's imports first rather than guessing the mock target.

describe('Sidebar feature-toggle gating', () => {
  beforeEach(() => { vi.mocked(isFeatureEnabled).mockReturnValue(true); });

  it('hides the Fleet Management nav item when feature_fleet is disabled', () => {
    vi.mocked(isFeatureEnabled).mockImplementation((path: string) => path !== '/fleet');
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(screen.queryByText('Fleet Management')).not.toBeInTheDocument();
  });

  it('shows the Fleet Management nav item when feature_fleet is enabled', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(screen.getByText('Fleet Management')).toBeInTheDocument();
  });
});
```

If `Sidebar.tsx` requires additional context providers (auth/user context) to render without throwing, read the top of the file to find them and wrap the test's `render(...)` accordingly — do not skip the test by stubbing everything into pass-through mocks; the point is verifying real filter behavior.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/__tests__/Sidebar.test.tsx`
Expected: FAIL — Fleet Management still shows (no gating yet), or a compile error if the mock setup needs adjusting for this specific file's actual context dependencies.

- [ ] **Step 4: Wire the check**

In `client/src/components/Sidebar.tsx`, add the import:

```typescript
import { isFeatureEnabled, useFeatureFlags } from '../utils/featureFlags';
```

Call the hook once near the top of the component body (alongside other hooks like `useState`):

```typescript
  useFeatureFlags();
```

Edit the existing `isVisible` function (near line 218):

```typescript
  const isVisible = (item: SidebarItem) => {
    if (item.adminOnly && !isAdmin) return false;
    if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(item.path)) return false;
    if (!isFeatureEnabled(item.path)) return false;
    return true;
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/__tests__/Sidebar.test.tsx`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Sidebar.tsx client/src/components/__tests__/Sidebar.test.tsx
git commit -m "feat(nav): gate Sidebar nav items on saved feature toggles"
```

---

### Task 4: Wire `MobileDrawer.tsx`, `ModuleTileBar.tsx`, `DesktopPage.tsx`, `ModuleDirectoryPage.tsx`

These 4 files each have exactly one filter function with the identical existing shape (`if (...) return false;` chain ending `return true;`), so this task applies the same one-line addition to all 4 in one pass. Splitting further would mean 4 near-duplicate task write-ups for a mechanical, low-risk change; keep them together here but commit and test each file's edit individually inside this task so a failure in one doesn't hide a pass in another.

**Files:**
- Modify: `client/src/components/mobile/MobileDrawer.tsx`
- Modify: `client/src/components/ModuleTileBar.tsx`
- Modify: `client/src/pages/DesktopPage.tsx`
- Modify: `client/src/pages/ModuleDirectoryPage.tsx`
- Test: one test file per component, following each directory's existing convention (check for existing test files first; add to them if present)

**Interfaces:**
- Consumes: `isFeatureEnabled`, `useFeatureFlags` from `../utils/featureFlags` (Task 2) — adjust the relative import path per each file's directory depth (`../../utils/featureFlags` from `components/mobile/`, `../utils/featureFlags` from `components/` and `pages/`).

- [ ] **Step 1: `MobileDrawer.tsx`**

Add the import and call `useFeatureFlags()` near the component's other hooks. Edit the existing filter (near line 356):

```typescript
            const visibleItems = group.items.filter((item) => {
              if (item.adminOnly && !isAdmin) return false;
              if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(item.path)) return false;
              if (!isFeatureEnabled(item.path)) return false;
              return true;
            });
```

Write a test mirroring Task 3's Sidebar test shape (render with a disabled flag, assert the item is absent; render with it enabled, assert present), scoped to one of the 4 gated features. Run `cd client && npx vitest run src/components/mobile/__tests__/MobileDrawer.test.tsx` (or wherever this component's existing tests live — check first) to confirm RED then GREEN.

- [ ] **Step 2: `ModuleTileBar.tsx`**

Add the import and call `useFeatureFlags()`. Edit the existing `shouldShow` callback (near line 90) — note this one is wrapped in `useCallback`, so its dependency array needs updating too since `isFeatureEnabled`'s underlying cache can change after mount:

```typescript
  const shouldShow = useCallback(
    (path: string, adminOnly?: boolean) => {
      if (adminOnly && !isAdmin) return false;
      if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(path)) return false;
      if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(path)) return false;
      if (!isFeatureEnabled(path)) return false;
      return true;
    },
    [isAdmin, isClientViewer, isContractManager],
  );
```

The dependency array does NOT need `isFeatureEnabled` added to it — that function reads a module-level mutable cache (not React state), so it's stable across renders by reference; the `useFeatureFlags()` hook call is what forces the surrounding component to re-render (and thus re-run `shouldShow`) when the flags finish loading, which is why Step 0 of adding the hook call matters even though this callback's own deps don't change. Write and run a test the same way as Step 1.

- [ ] **Step 3: `DesktopPage.tsx`**

Add the import and call `useFeatureFlags()`. Edit the existing `allFunctions` `useMemo` (near line 70):

```typescript
  const allFunctions = useMemo(() => {
    return NAV_CATEGORIES.flatMap(cat => cat.functions).filter(fn => {
      if (fn.adminOnly && !isAdmin) return false;
      if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(fn.path)) return false;
      if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(fn.path)) return false;
      if (!isFeatureEnabled(fn.path)) return false;
      return true;
    });
  }, [isAdmin, isClientViewer, isContractManager]);
```

Same reasoning as Step 2 applies to the dependency array — no change needed there, but the `useFeatureFlags()` hook call at the top of the component is what causes this `useMemo` to re-run once flags load, SINCE the component itself re-renders and `useMemo`'s deps (`isAdmin` etc.) are unchanged — actually, because the deps array is unchanged, `useMemo` will NOT recompute on that forced re-render alone. **This is a real bug risk — fix it:** add a version counter from `useFeatureFlags()` so the memo actually recomputes. Change `useFeatureFlags(): void` is not enough here; instead, for this file (and Step 2's `useCallback`, and Task 3/Step 1's inline recompute — inline non-memoized recomputes are fine, memoized ones are not), the dependency array MUST include something that changes when flags load. Modify `useFeatureFlags` in `client/src/utils/featureFlags.ts` (Task 2) is out of scope to change now — instead, add a local force-updated counter in each memoized consumer: after calling `useFeatureFlags()`, also read a change-token. Simplest fix: change `client/src/utils/featureFlags.ts`'s `useFeatureFlags` to return the render-count value instead of `void`, so consumers can put it in their dependency arrays:

```typescript
// in client/src/utils/featureFlags.ts — revise useFeatureFlags to return a value:
export function useFeatureFlags(): number {
  const [tick, forceRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const fn = () => forceRender();
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return tick;
}
```

Then in `DesktopPage.tsx`:

```typescript
  const flagsTick = useFeatureFlags();
  const allFunctions = useMemo(() => {
    return NAV_CATEGORIES.flatMap(cat => cat.functions).filter(fn => {
      if (fn.adminOnly && !isAdmin) return false;
      if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(fn.path)) return false;
      if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(fn.path)) return false;
      if (!isFeatureEnabled(fn.path)) return false;
      return true;
    });
  }, [isAdmin, isClientViewer, isContractManager, flagsTick]);
```

And likewise in `ModuleTileBar.tsx` (Step 2 above): `const flagsTick = useFeatureFlags();` then add `flagsTick` to `shouldShow`'s dependency array.

**Go back and update `client/src/utils/featureFlags.ts`'s test** (from Task 2) to assert `useFeatureFlags()` returns an incrementing number across loads, not just that it triggers a re-render — add:

```typescript
  it('useFeatureFlags returns an incrementing tick each time flags reload', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ feature_warrants: true, feature_fleet: true, feature_evidence: true, feature_patrol_checkpoints: true });
    const { result } = renderHook(() => useFeatureFlags());
    const before = result.current;
    await act(async () => { await loadFeatureFlags(); });
    expect(result.current).toBeGreaterThan(before);
  });
```

Run `cd client && npx vitest run src/utils/__tests__/featureFlags.test.ts` to confirm this addition passes against the revised implementation.

Write and run a `DesktopPage.tsx` test the same way as Step 1.

- [ ] **Step 4: `ModuleDirectoryPage.tsx`**

Same pattern as Step 3 (it's a `useMemo` over `NAV_CATEGORIES`, near line 68) — add `useFeatureFlags()`'s returned tick to the dependency array:

```typescript
  const flagsTick = useFeatureFlags();
  const visibleCategories = useMemo(() => {
    return NAV_CATEGORIES.map(cat => ({
      ...cat,
      functions: cat.functions.filter(fn => {
        if (fn.adminOnly && !isAdmin) return false;
        if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(fn.path)) return false;
        if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(fn.path)) return false;
        if (!isFeatureEnabled(fn.path)) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return fn.label.toLowerCase().includes(q) ||
            fn.description.toLowerCase().includes(q);
        }
        return true;
      }),
    }));
  }, [isAdmin, isClientViewer, isContractManager, searchQuery, flagsTick]);
```

(Preserve whatever the real existing `searchQuery` branch logic is beyond what's shown here — read the actual current body of this `useMemo` before editing, since this plan's excerpt may not be the complete function.) Write and run a test the same way as Step 1.

- [ ] **Step 5: Full client verification**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/featureFlags.ts client/src/utils/__tests__/featureFlags.test.ts \
        client/src/components/mobile/MobileDrawer.tsx \
        client/src/components/ModuleTileBar.tsx \
        client/src/pages/DesktopPage.tsx \
        client/src/pages/ModuleDirectoryPage.tsx
git commit -m "feat(nav): gate MobileDrawer/ModuleTileBar/DesktopPage/ModuleDirectoryPage on feature toggles"
```

(Add each component's new/modified test file to this `git add` list too — the exact paths depend on what Step 1 found on disk.)

---

### Task 5: Wire `Layout.tsx` (3 occurrences)

**Files:**
- Modify: `client/src/components/Layout.tsx`
- Test: `client/src/components/__tests__/Layout.test.tsx` (check for an existing file first)

**Interfaces:**
- Consumes: `isFeatureEnabled`, `useFeatureFlags` from `../utils/featureFlags` (Task 2) — the import was already added in Task 2 for `loadFeatureFlags`; add `isFeatureEnabled` and `useFeatureFlags` to that same import statement rather than creating a second one.

- [ ] **Step 1: Locate all 3 occurrences**

Run: `grep -n "CLIENT_VIEWER_BLOCKED_PATHS.has(item.path)" client/src/components/Layout.tsx`

This should return 3 line numbers (near the toolbar keyboard-shortcut handler, the command-palette `allow` closure, and the toolbar render filter — see plan research). Read 6 lines of context around each to confirm the exact current text before editing (line numbers may have shifted since this plan was written).

- [ ] **Step 2: Write the failing test**

Add a test to `client/src/components/__tests__/Layout.test.tsx` (or create it, matching whatever render/context-provider pattern this directory's other tests use) asserting that the main toolbar nav (not the sidebar) hides a disabled feature's label — e.g. render `Layout` with `isFeatureEnabled` mocked to return `false` for `/warrants`, and assert `screen.queryByText('Warrants')` is absent from the toolbar.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/__tests__/Layout.test.tsx`

- [ ] **Step 4: Call `useFeatureFlags()` once**

Near the top of the `Layout` component body (it should already import `loadFeatureFlags` from Task 2 — add `isFeatureEnabled, useFeatureFlags` to that same `import { ... } from '../utils/featureFlags';` line), add:

```typescript
  const flagsTick = useFeatureFlags();
```

- [ ] **Step 5: Edit all 3 filter closures**

For each of the 3 locations found in Step 1, add one line following the exact existing pattern (e.g.):

```typescript
      const visibleNav = TOOLBAR_NAV.filter(item => {
        if (item.adminOnly && !isAdmin) return false;
        if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(item.path)) return false;
        if (!isFeatureEnabled(item.path)) return false;
        return true;
      });
```

For the 2 occurrences inside a `useMemo` (the command-palette `paletteNavTargets` one — check whether the other 2 are inside `useMemo`/`useCallback` too, since the plan's earlier research only confirmed one of the three is memoized), add `flagsTick` to that hook's dependency array following the same reasoning as Task 4 Step 3. For any occurrence that is NOT memoized (recomputed inline on every render, like the keyboard-shortcut handler), no dependency-array change is needed — the `if (!isFeatureEnabled(item.path)) return false;` line alone is sufficient since it reads the live cache on every call.

Also check `item.children?.forEach(...)` in the command-palette closure (seen in the research at `Layout.tsx:789`) — child nav items need the same check:

```typescript
      item.children?.forEach((child) => {
        if (allow(child.path, child.adminOnly) && !seen.has(child.path)) {
```

If `allow(...)` is the shared closure edited in this step, children get the check automatically for free — verify this is the case rather than assuming, since the plan's research excerpt didn't show `allow`'s full body being reused for children vs. a separate check.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/__tests__/Layout.test.tsx`
Expected: PASS

- [ ] **Step 7: Full client verification**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/Layout.tsx client/src/components/__tests__/Layout.test.tsx
git commit -m "feat(nav): gate Layout toolbar/command-palette nav items on feature toggles"
```

---

### Task 6: Wire `MenuBar.tsx` static menu entries

`MenuBar.tsx` doesn't use a shared filter function like the other 6 files — its menu items are static array literals (e.g. `{ type: 'action', path: '/warrants', label: 'Warrant', ... }`) rendered directly. This task needs its own approach: conditionally include each of the 4 gated entries in the array using a spread.

**Files:**
- Modify: `client/src/components/MenuBar.tsx`
- Test: `client/src/components/__tests__/MenuBar.test.tsx` (check for an existing file first)

**Interfaces:**
- Consumes: `isFeatureEnabled`, `useFeatureFlags` from `../utils/featureFlags` (Task 2)

- [ ] **Step 1: Find every gated entry**

Run: `grep -n "path: '/warrants'\|path: '/fleet'\|path: '/evidence'\|path: '/patrol'" client/src/components/MenuBar.tsx`

Read 3 lines of context around each hit to confirm whether these lines already sit inside any conditional (role-based) wrapping, or are unconditional array elements (per the plan's research, they appear to be unconditional). There may be MORE than one entry per path if the same feature is reachable from multiple menus (e.g. a "New Warrant" action under one menu and a "Warrants" navigation link under another) — find all of them, not just the first match per path.

- [ ] **Step 2: Determine whether the surrounding array is built inline in JSX/an object literal, or assembled via a variable first**

If it's a literal array like `const items = [ {...}, {...} ]`, convert only the 4 gated lines to conditional spreads:

```typescript
          { type: 'action', path: '/citations', label: 'Citation', icon: FileWarning, action: () => navigate('/citations') },
          ...(isFeatureEnabled('/warrants') ? [{ type: 'action' as const, path: '/warrants', label: 'Warrant', icon: Gavel, action: () => navigate('/warrants') }] : []),
          { type: 'action', path: '/trespass-orders', label: 'Trespass Order', icon: ShieldAlert, action: () => navigate('/trespass-orders') },
```

Use the exact existing object shape for each entry (icon, label, action) — do not alter anything except wrapping it in the conditional spread. If TypeScript complains about the `type: 'action'` literal losing its literal type inside the array, add `as const` to that one field as shown above (do not add `as const` to the whole object unless needed — keep the diff minimal).

If any of these menu arrays are actually built via `useMemo`, add `useFeatureFlags()`'s tick to that `useMemo`'s dependency array (same reasoning as Task 4/5); if they're recomputed inline on every render (e.g. directly inside JSX during render, not memoized), no dependency changes are needed — call `useFeatureFlags()` once near the top of the component regardless, so the component re-renders when flags load.

- [ ] **Step 3: Write the failing test**

Add a test asserting a gated menu (whichever menu contains the `/warrants` entry — read the surrounding menu's trigger/label to target it in the test) does not render a "Warrant" menu item when `isFeatureEnabled` returns `false` for `/warrants`, and does render it when `true`. Match this directory's existing test conventions for opening/asserting on `MenuBar`'s dropdown content (check for an existing `MenuBar.test.tsx` pattern first — these menus are likely rendered via a portal or conditionally shown on click, so the test may need to simulate opening the menu before asserting).

- [ ] **Step 4: Run test to verify RED then GREEN**

Run: `cd client && npx vitest run src/components/__tests__/MenuBar.test.tsx` before and after the Step 2 edit.

- [ ] **Step 5: Full client verification**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/MenuBar.tsx client/src/components/__tests__/MenuBar.test.tsx
git commit -m "feat(nav): gate MenuBar static menu entries on feature toggles"
```

---

## Self-Review Notes (for the implementer, not a separate step)

- **Spec coverage:** the 4 in-scope features (Warrants, Fleet, Evidence, Patrol QR) are gated in all 7 identified surfaces (Sidebar, Layout ×3, MobileDrawer, ModuleTileBar, DesktopPage, ModuleDirectoryPage, MenuBar). BOLOs and server-side API blocking are explicitly out of scope per Global Constraints, not silently dropped.
- **The `useMemo`/`useCallback` staleness risk is the single trickiest part of this plan** — a filter wrapped in a memo hook will NOT pick up a feature-flag change after initial load unless something in its dependency array changes. Task 4 discovers and fixes this by changing `useFeatureFlags()`'s return type from `void` to an incrementing tick; every later task that touches a memoized filter (Layout's palette memo, ModuleTileBar, DesktopPage, ModuleDirectoryPage, and possibly MenuBar) must include that tick in its dependency array. Non-memoized inline filters (Sidebar, MobileDrawer, Layout's inline render filter) don't need this since they recompute every render regardless.
- **No placeholders:** every step shows complete code. Where exact current file content couldn't be fully verified ahead of time (Layout.tsx's 3rd occurrence, MenuBar.tsx's array-vs-memo structure, ModuleDirectoryPage's full `searchQuery` branch), the step explicitly instructs the implementer to read the real current code first and preserve it — this is a deliberate "verify against reality" instruction, not a vague "handle appropriately."
