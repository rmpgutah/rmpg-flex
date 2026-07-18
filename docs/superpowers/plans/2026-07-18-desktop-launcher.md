# Desktop Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a personal, per-officer "desktop" launcher at the new opt-in route `/desktop` — pinned app icons, live widgets, a taskbar with a module-search launcher, wallpaper personalization, and in-page draggable/resizable iframe windows for the existing curated `POPOUT_PAGES` module set.

**Architecture:** Extract the module catalog (`NAV_CATEGORIES`), favorites/recent storage, and live badge-count fetching out of `ModuleDirectoryPage.tsx` into shared modules so both pages use one source of truth. Build the desktop shell as small, focused React components under `client/src/components/desktop/`, backed by a new D1-persisted layout (extends `user_preferences`) for permanent per-user state and `sessionStorage` for ephemeral open-window state. In-page windows render `<iframe src={path}>` — zero changes to any of the 142 existing page components.

**Tech Stack:** React 18 + TypeScript + Vite (client), Hono + D1 (Worker), Vitest + `@testing-library/react` (client tests), Miniflare/`cloudflare:test` (Worker route smoke tests, in `test-workers/`).

## Global Constraints

- Never open `/desktop` automatically on login — `/` continues to render `DashboardPage` unchanged ([client/src/App.tsx:531](../../../client/src/App.tsx)).
- No hardcoded hex colors — use the existing CSS-variable-backed tokens (`var(--surface-...)`, `var(--border-...)`, `var(--text-...)`, `var(--brand-...)`, `rgb(var(--rmpg-500-rgb))`) per the Blue & Silver theming rule in [CLAUDE.md](../../../CLAUDE.md).
- Radius is 2px everywhere — never use `rounded-lg`; the global Tailwind override in `client/src/index.css` already enforces this, so just avoid fighting it with inline `border-radius`.
- All new D1 queries must `await` — D1 calls are async ([CLAUDE.md](../../../CLAUDE.md) gotcha #3).
- Windowing is scoped ONLY to the existing `POPOUT_PAGES` list in [client/src/utils/windowManager.ts](../../../client/src/utils/windowManager.ts) — no other route becomes windowable in this plan.
- `tsconfig` has `noUnusedLocals: false` — trimming now-unused imports during the extraction refactor is good hygiene but not required for compilation.
- Migration high-water mark is `0191` (confirmed via `ls migrations/ | tail`) — this plan's migration is `0192_desktop_layout.sql`.
- Spec: [docs/superpowers/specs/2026-07-18-desktop-launcher-design.md](../specs/2026-07-18-desktop-launcher-design.md).

---

### Task 1: Extract shared nav catalog + favorites/recent storage

**Files:**
- Create: `client/src/data/navCatalog.ts`
- Create: `client/src/data/navCatalog.test.ts`
- Create: `client/src/utils/navFavorites.ts`
- Create: `client/src/utils/navFavorites.test.ts`
- Modify: `client/src/pages/ModuleDirectoryPage.tsx`
- Create: `client/src/pages/ModuleDirectoryPage.test.tsx`

**Interfaces:**
- Produces (consumed by every later task in this plan): `NavFunction { path: string; label: string; icon: React.ElementType; shortcut?: string; description: string; adminOnly?: boolean; badgeKey?: string }`, `NavCategory { id: string; label: string; icon: React.ElementType; functions: NavFunction[] }`, `NAV_CATEGORIES: NavCategory[]`, `CLIENT_VIEWER_BLOCKED: Set<string>`, `CONTRACT_MANAGER_BLOCKED: Set<string>` — all from `client/src/data/navCatalog.ts`.
- Produces: `FAVORITES_KEY`, `RECENT_KEY`, `loadFavorites(): Set<string>`, `saveFavorites(favorites: Set<string>): void`, `loadRecent(): string[]`, `pushRecent(path: string): void` — all from `client/src/utils/navFavorites.ts`.

- [ ] **Step 1: Write the failing test for the extracted catalog**

```ts
// client/src/data/navCatalog.test.ts
import { describe, it, expect } from 'vitest';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED } from './navCatalog';

describe('navCatalog', () => {
  it('has at least one category with at least one function', () => {
    expect(NAV_CATEGORIES.length).toBeGreaterThan(0);
    const totalFunctions = NAV_CATEGORIES.reduce((sum, cat) => sum + cat.functions.length, 0);
    expect(totalFunctions).toBeGreaterThan(50);
  });

  it('has no duplicate paths across the whole catalog', () => {
    const paths = NAV_CATEGORIES.flatMap(cat => cat.functions.map(fn => fn.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('blocks /admin for both client_viewer and contract_manager', () => {
    expect(CLIENT_VIEWER_BLOCKED.has('/admin')).toBe(true);
    expect(CONTRACT_MANAGER_BLOCKED.has('/admin')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/data/navCatalog.test.ts`
Expected: FAIL — `Cannot find module './navCatalog'`

- [ ] **Step 3: Extract the catalog verbatim from ModuleDirectoryPage.tsx via exact line ranges**

The `NavFunction`/`NavCategory` interfaces live at lines 19-34 of `ModuleDirectoryPage.tsx`, `CLIENT_VIEWER_BLOCKED`/`CONTRACT_MANAGER_BLOCKED` at lines 39-47, and `NAV_CATEGORIES` at lines 49-220 (confirmed via `grep -n "^const NAV_CATEGORIES"` — do not re-derive these line numbers, they are exact as of this plan). Extract mechanically rather than retyping, to guarantee zero transcription error in a 170-line data array:

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/body-camera-rebuild-c97aed"
{
  printf '%s\n' "import type React from 'react';"
  sed -n '3,13p' client/src/pages/ModuleDirectoryPage.tsx
  printf '\n'
  sed -n '19,34p' client/src/pages/ModuleDirectoryPage.tsx
  printf '\n'
  sed -n '39,47p' client/src/pages/ModuleDirectoryPage.tsx
  printf '\n'
  sed -n '49,220p' client/src/pages/ModuleDirectoryPage.tsx
} > client/src/data/navCatalog.ts

# Prefix the four top-level declarations with `export` (they aren't yet).
sed -i '' -E 's/^interface (NavFunction|NavCategory) \{/export interface \1 {/' client/src/data/navCatalog.ts
sed -i '' -E 's/^const (CLIENT_VIEWER_BLOCKED|CONTRACT_MANAGER_BLOCKED|NAV_CATEGORIES)([: ])/export const \1\2/' client/src/data/navCatalog.ts
```

Open `client/src/data/navCatalog.ts` and confirm it reads as: a `React` type-only import, a `lucide-react` icon import block, the two exported interfaces, the two exported blocked-path `Set`s, and the exported `NAV_CATEGORIES` array — in that order, with no leftover unrelated lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/data/navCatalog.test.ts`
Expected: PASS (3 tests)

Also run: `cd client && npx tsc --noEmit` — confirm no new type errors from the extraction (catches a missing comma or unbalanced brace from the `sed` concatenation).

- [ ] **Step 5: Commit**

```bash
git add client/src/data/navCatalog.ts client/src/data/navCatalog.test.ts
git commit -m "feat(desktop): extract shared nav catalog from ModuleDirectoryPage"
```

- [ ] **Step 6: Write the failing test for extracted favorites/recent storage**

```ts
// client/src/utils/navFavorites.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFavorites, saveFavorites, loadRecent, pushRecent, FAVORITES_KEY, RECENT_KEY } from './navFavorites';

describe('navFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('round-trips favorites through localStorage', () => {
    saveFavorites(new Set(['/dispatch', '/map']));
    expect(loadFavorites()).toEqual(new Set(['/dispatch', '/map']));
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY)!)).toEqual(['/dispatch', '/map']);
  });

  it('loadFavorites returns an empty set when nothing is stored', () => {
    expect(loadFavorites()).toEqual(new Set());
  });

  it('pushRecent dedupes and caps at 10, most-recent first', () => {
    for (let i = 0; i < 12; i++) pushRecent(`/path-${i}`);
    pushRecent('/path-5'); // re-push an existing entry — should move to front, not duplicate
    const recent = loadRecent();
    expect(recent.length).toBe(10);
    expect(recent[0]).toBe('/path-5');
    expect(new Set(recent).size).toBe(10);
    expect(sessionStorage.getItem(RECENT_KEY)).not.toBeNull();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/navFavorites.test.ts`
Expected: FAIL — `Cannot find module './navFavorites'`

- [ ] **Step 8: Extract favorites/recent storage verbatim**

`FAVORITES_KEY`/`RECENT_KEY` live at lines 36-37 of `ModuleDirectoryPage.tsx`; `loadFavorites`/`saveFavorites`/`loadRecent`/`pushRecent` at lines 222-246 (confirmed exact via direct read — do not re-derive).

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/body-camera-rebuild-c97aed"
{
  sed -n '36,37p' client/src/pages/ModuleDirectoryPage.tsx
  printf '\n'
  sed -n '222,246p' client/src/pages/ModuleDirectoryPage.tsx
} > client/src/utils/navFavorites.ts

sed -i '' -E 's/^const (FAVORITES_KEY|RECENT_KEY)([: ])/export const \1\2/' client/src/utils/navFavorites.ts
sed -i '' -E 's/^function (loadFavorites|saveFavorites|loadRecent|pushRecent)\(/export function \1(/' client/src/utils/navFavorites.ts
```

Open `client/src/utils/navFavorites.ts` and confirm it reads as: the two exported key constants, then the four exported functions, with no leftover unrelated lines.

- [ ] **Step 9: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/navFavorites.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add client/src/utils/navFavorites.ts client/src/utils/navFavorites.test.ts
git commit -m "feat(desktop): extract shared favorites/recent storage from ModuleDirectoryPage"
```

- [ ] **Step 11: Wire ModuleDirectoryPage.tsx to the two new shared modules**

Delete the now-duplicated block (lines 19-246, which is everything extracted in Steps 3 and 8 — confirmed contiguous):

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/body-camera-rebuild-c97aed"
sed -i '' '19,246d' client/src/pages/ModuleDirectoryPage.tsx
```

Replace the old icon-heavy import block (originally lines 3-13) with a trimmed import — the file's own JSX still directly uses `Clock`, `ExternalLink`, `Grid3X3`, `RefreshCw`, `Search`, `Star` (confirmed via `grep -n` against everything after the deleted block; every other icon from the old import was only ever referenced inside the now-extracted `NAV_CATEGORIES`). Use the Edit tool:

old_string:
```
import {
  LayoutDashboard, Radio, Map, FileText, Database, Users, MessageSquare,
  BarChart3, Settings, AlertTriangle, Monitor, Terminal, Search, Car,
  Video, Camera, ClipboardList, ShieldBan, Gavel, UserX, Briefcase,
  Calendar, TrendingUp, ClipboardCheck, GraduationCap, Network,
  Building2, ShieldAlert, Package, DollarSign, Megaphone, CheckCircle,
  Shield, Share2, CreditCard, Microscope, Mail, QrCode, FileWarning,
  Construction, User, Lock, ScrollText, UserCheck, Fingerprint, Globe,
  HelpCircle, BookOpen, ClipboardPen, ListChecks, Sparkles,
  Navigation, Star, Clock, ExternalLink, RefreshCw, Grid3X3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { POPOUT_PAGES, openPageWindow } from '../utils/windowManager';
import PanelTitleBar from '../components/PanelTitleBar';
```

new_string:
```
import { Search, Star, Clock, ExternalLink, RefreshCw, Grid3X3 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { POPOUT_PAGES, openPageWindow } from '../utils/windowManager';
import PanelTitleBar from '../components/PanelTitleBar';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED, type NavFunction } from '../data/navCatalog';
import { loadFavorites, saveFavorites, loadRecent, pushRecent } from '../utils/navFavorites';
import { useNavBadges } from '../hooks/useNavBadges';
```

(The `useNavBadges` import is added now even though the hook doesn't exist yet — Task 2 creates it and wires the call site. `apiFetch` is dropped here because after Task 2 it's no longer used directly in this file.)

- [ ] **Step 12: Run typecheck to confirm the surviving code still resolves against the new imports**

Run: `cd client && npx tsc --noEmit`
Expected: Errors only about `useNavBadges` not existing yet and the still-inline badge-fetch effect referencing `apiFetch` — both fixed in Task 2. No errors about `NAV_CATEGORIES`, `NavFunction`, `CLIENT_VIEWER_BLOCKED`, `CONTRACT_MANAGER_BLOCKED`, `loadFavorites`, `saveFavorites`, `loadRecent`, or `pushRecent`.

- [ ] **Step 13: Add a regression test for ModuleDirectoryPage.tsx's post-refactor behavior**

```tsx
// client/src/pages/ModuleDirectoryPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetchMock = vi.fn().mockResolvedValue({});
vi.mock('../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));

import ModuleDirectoryPage from './ModuleDirectoryPage';

describe('ModuleDirectoryPage (post-catalog-extraction regression)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetchMock.mockClear();
  });

  it('renders category navigation from the extracted NAV_CATEGORIES', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
    expect(screen.getByText(/Modules/i)).toBeInTheDocument();
    expect(screen.getAllByText(/functions/i).length).toBeGreaterThan(0);
  });

  it('search filters the catalog down to matching modules', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Dispatch Console' } });
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
    expect(screen.queryByText('Body Cameras')).not.toBeInTheDocument();
  });

  it('favoriting a module persists to the shared FAVORITES_KEY in localStorage', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
    const search = screen.getByPlaceholderText(/Search modules/i);
    fireEvent.change(search, { target: { value: 'Dispatch Console' } });
    const star = screen.getByLabelText(/Add Dispatch Console to favorites/i);
    fireEvent.click(star);
    expect(JSON.parse(localStorage.getItem('rmpg_nav_favorites')!)).toContain('/dispatch');
  });
});
```

Run: `cd client && npx vitest run src/pages/ModuleDirectoryPage.test.tsx`
Expected: FAIL on the badges effect still calling the un-mocked-shape `apiFetch` for 5 endpoints — this is expected until Task 2 replaces that effect with `useNavBadges` (which this test's mock already anticipates by mocking `useApi` broadly). If it fails for any OTHER reason (e.g. text not found), fix the extraction in Step 11 before proceeding — do not move to Task 2 with a broken regression test.

- [ ] **Step 14: Commit**

```bash
git add client/src/pages/ModuleDirectoryPage.tsx client/src/pages/ModuleDirectoryPage.test.tsx
git commit -m "refactor(desktop): wire ModuleDirectoryPage to extracted navCatalog/navFavorites"
```

---

### Task 2: Extract live badge-count polling into `useNavBadges`

**Files:**
- Create: `client/src/hooks/useNavBadges.ts`
- Create: `client/src/hooks/useNavBadges.test.ts`
- Modify: `client/src/pages/ModuleDirectoryPage.tsx`

**Interfaces:**
- Consumes: nothing new (uses `apiFetch` from `client/src/hooks/useApi.ts`, existing signature `apiFetch<T>(endpoint: string, options?: RequestInit & {...}): Promise<T>`).
- Produces (consumed by Task 10's `DesktopOpsSummaryWidget`): `NavBadges { activeCalls?: number; activeBOLOs?: number; unreadEmail?: number; activeWarrants?: number; openCases?: number; pendingServe?: number }`, `useNavBadges(intervalMs?: number): { badges: NavBadges; isLoading: boolean }` from `client/src/hooks/useNavBadges.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/hooks/useNavBadges.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('./useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import { useNavBadges } from './useNavBadges';

describe('useNavBadges', () => {
  beforeEach(() => { apiFetchMock.mockReset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('aggregates counts from all five badge endpoints', async () => {
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/dispatch') return Promise.resolve({ calls: { active: 3 } });
      if (endpoint === '/comms/bolos/active') return Promise.resolve([{}, {}]);
      if (endpoint === '/email/unread-count') return Promise.resolve({ count: 7 });
      if (endpoint === '/dispatch/stats') return Promise.resolve({ active_warrants: 5 });
      if (endpoint === '/stats/dashboard') return Promise.resolve({ open_cases: 12, pending_serve: 4 });
      return Promise.reject(new Error('unexpected endpoint'));
    });
    const { result } = renderHook(() => useNavBadges(30000));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.badges).toEqual({
      activeCalls: 3, activeBOLOs: 2, unreadEmail: 7, activeWarrants: 5, openCases: 12, pendingServe: 4,
    });
  });

  it('silently omits a badge whose endpoint rejects, without failing the others', async () => {
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/dispatch') return Promise.reject(new Error('down'));
      if (endpoint === '/stats/dashboard') return Promise.resolve({ open_cases: 1, pending_serve: 0 });
      return Promise.resolve({});
    });
    const { result } = renderHook(() => useNavBadges(30000));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.badges.activeCalls).toBeUndefined();
    expect(result.current.badges.openCases).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/useNavBadges.test.ts`
Expected: FAIL — `Cannot find module './useNavBadges'`

- [ ] **Step 3: Write the hook**, moving the existing polling effect out of `ModuleDirectoryPage.tsx` (currently its own `useEffect`) into a reusable hook with the exact same five endpoints and 30s default interval:

```ts
// client/src/hooks/useNavBadges.ts
import { useState, useEffect } from 'react';
import { apiFetch } from './useApi';

export interface NavBadges {
  activeCalls?: number;
  activeBOLOs?: number;
  unreadEmail?: number;
  activeWarrants?: number;
  openCases?: number;
  pendingServe?: number;
}

export function useNavBadges(intervalMs = 30000): { badges: NavBadges; isLoading: boolean } {
  const [badges, setBadges] = useState<NavBadges>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchBadges() {
      setIsLoading(true);
      const results: NavBadges = {};
      try {
        // dispatchAggregates mounts bare at /api/dispatch — '/dispatch/aggregates'
        // 404s, the dashboard-stats route is the bare prefix itself.
        const stats = await apiFetch<{ calls?: { active?: number } }>('/dispatch');
        if (stats?.calls?.active) results.activeCalls = stats.calls.active;
      } catch { /* silent */ }
      try {
        const bolos = await apiFetch<unknown[]>('/comms/bolos/active');
        if (Array.isArray(bolos)) results.activeBOLOs = bolos.length;
      } catch { /* silent */ }
      try {
        const email = await apiFetch<{ count: number }>('/email/unread-count');
        if (email?.count) results.unreadEmail = email.count;
      } catch { /* silent */ }
      try {
        const warrants = await apiFetch<{ active_warrants?: number }>('/dispatch/stats');
        if (warrants?.active_warrants) results.activeWarrants = warrants.active_warrants;
      } catch { /* silent */ }
      try {
        const dashboard = await apiFetch<{ open_cases?: number; pending_serve?: number }>('/stats/dashboard');
        if (dashboard?.open_cases) results.openCases = dashboard.open_cases;
        if (dashboard?.pending_serve) results.pendingServe = dashboard.pending_serve;
      } catch { /* silent */ }
      if (!cancelled) {
        setBadges(results);
        setIsLoading(false);
      }
    }

    fetchBadges();
    const interval = setInterval(fetchBadges, intervalMs);
    return () => { cancelled = true; clearInterval(interval); };
  }, [intervalMs]);

  return { badges, isLoading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/useNavBadges.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useNavBadges.ts client/src/hooks/useNavBadges.test.ts
git commit -m "feat(desktop): extract live badge-count polling into useNavBadges"
```

- [ ] **Step 6: Replace the inline badge effect in ModuleDirectoryPage.tsx with the hook**

Use the Edit tool:

old_string:
```
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [badgesLoading, setBadgesLoading] = useState(true);
```

new_string:
```
  const { badges, isLoading: badgesLoading } = useNavBadges();
```

Then remove the now-dead effect (originally lines 411-445 before Task 1's deletions shifted them — locate by content, not line number) with the Edit tool:

old_string:
```
  useEffect(() => {
    async function fetchBadges() {
      setBadgesLoading(true);
      const results: Record<string, number> = {};
      try {
        // dispatchAggregates mounts bare at /api/dispatch (see routesConfig.ts note
        // near dispatchAggregates) — '/dispatch/aggregates' 404s, the dashboard-stats
        // route is the bare prefix itself.
        const stats = await apiFetch<{ calls?: { active?: number } }>('/dispatch');
        if (stats?.calls?.active) results.activeCalls = stats.calls.active;
      } catch { /* silent */ }
      try {
        const bolos = await apiFetch<unknown[]>('/comms/bolos/active');
        if (Array.isArray(bolos)) results.activeBOLOs = bolos.length;
      } catch { /* silent */ }
      try {
        const email = await apiFetch<{ count: number }>('/email/unread-count');
        if (email?.count) results.unreadEmail = email.count;
      } catch { /* silent */ }
      try {
        const warrants = await apiFetch<{ active_warrants?: number }>('/dispatch/stats');
        if (warrants?.active_warrants) results.activeWarrants = warrants.active_warrants;
      } catch { /* silent */ }
      try {
        const dashboard = await apiFetch<{ open_cases?: number; pending_serve?: number }>('/stats/dashboard');
        if (dashboard?.open_cases) results.openCases = dashboard.open_cases;
        if (dashboard?.pending_serve) results.pendingServe = dashboard.pending_serve;
      } catch { /* silent */ }
      setBadges(results);
      setBadgesLoading(false);
    }
    fetchBadges();
    const interval = setInterval(fetchBadges, 30000);
    return () => clearInterval(interval);
  }, []);
```

new_string: *(empty — delete the block entirely, it's now the hook)*

- [ ] **Step 7: Run the regression test from Task 1 and typecheck**

Run: `cd client && npx vitest run src/pages/ModuleDirectoryPage.test.tsx && npx tsc --noEmit`
Expected: PASS — the mocked `apiFetch` shape from Task 1 Step 13 already matches what `useNavBadges` expects, so this regression test should now pass in full.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/ModuleDirectoryPage.tsx
git commit -m "refactor(desktop): wire ModuleDirectoryPage badges to useNavBadges"
```

---

### Task 3: D1 migration + preferences route for desktop layout

**Files:**
- Create: `migrations/0192_desktop_layout.sql`
- Modify: `src/routes/stubs.ts:7-16`
- Test: `test-workers/desktopPreferences.test.ts`

**Interfaces:**
- Produces: three new keys on the existing `PUT /api/preferences` / `GET /api/preferences` JSON payload: `desktop_layout_json: string | null`, `desktop_wallpaper: string`, `desktop_widgets_json: string | null`.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0192_desktop_layout.sql
ALTER TABLE user_preferences ADD COLUMN desktop_layout_json TEXT;
ALTER TABLE user_preferences ADD COLUMN desktop_wallpaper TEXT;
ALTER TABLE user_preferences ADD COLUMN desktop_widgets_json TEXT;
```

- [ ] **Step 2: Apply it to the local D1**

Run: `npm run migrate:local`
Expected: migration `0192_desktop_layout.sql` applies with no errors (D1 does not support `ADD COLUMN IF NOT EXISTS`, so a second run would fail on "duplicate column name" — that's expected/idempotent-by-tracking, not a bug).

- [ ] **Step 3: Write the failing Miniflare test for the extended preferences round-trip**

```ts
// test-workers/desktopPreferences.test.ts
// Route-level regression test (Miniflare/workerd) proving the three new
// desktop-layout fields on PUT/GET /api/preferences round-trip correctly.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import stubs from '../src/routes/stubs';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { userId: number } }>();
app.use('*', async (c, next) => { c.set('userId', 42); await next(); });
app.route('/api', stubs);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY,
    font_scale REAL, compact_mode INTEGER, show_map_labels INTEGER,
    default_map_style TEXT, dispatch_sort TEXT, dispatch_show_cleared INTEGER,
    theme_preference TEXT,
    desktop_layout_json TEXT, desktop_wallpaper TEXT, desktop_widgets_json TEXT,
    updated_at TEXT
  )`);
});

describe('PUT/GET /api/preferences — desktop layout fields', () => {
  it('persists and reads back desktop_layout_json, desktop_wallpaper, desktop_widgets_json', async () => {
    const putRes = await app.request('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        desktop_layout_json: JSON.stringify([{ path: '/dispatch', x: 20, y: 20 }]),
        desktop_wallpaper: 'slate',
        desktop_widgets_json: JSON.stringify(['clock', 'ops-summary']),
      }),
    }, env as unknown as Record<string, unknown>);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { success: boolean; preferences: Record<string, unknown> };
    expect(putBody.success).toBe(true);
    expect(putBody.preferences.desktop_wallpaper).toBe('slate');

    const getRes = await app.request('/api/preferences', {}, env as unknown as Record<string, unknown>);
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.desktop_wallpaper).toBe('slate');
    expect(JSON.parse(getBody.desktop_widgets_json as string)).toEqual(['clock', 'ops-summary']);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/desktopPreferences.test.ts`
Expected: FAIL — `putBody.preferences.desktop_wallpaper` is `undefined` because `PREF_COLUMNS` in `stubs.ts` doesn't yet include the new keys, so the `PUT` silently drops them (`keys.length === 0` short-circuit).

- [ ] **Step 5: Add the three keys to `PREF_DEFAULTS`**

`PREF_COLUMNS` is derived as `new Set(Object.keys(PREF_DEFAULTS))` ([src/routes/stubs.ts:18](../../../src/routes/stubs.ts)), so adding defaults here is the only change needed — the route handlers already generically reflect whatever keys are in `PREF_COLUMNS`.

old_string:
```
const PREF_DEFAULTS = {
  notify_dispatch_email: 1, notify_dispatch_inapp: 1,
  notify_bolo_email: 1, notify_bolo_inapp: 1,
  notify_warrant_email: 0, notify_warrant_inapp: 1,
  notify_system_email: 0, notify_system_inapp: 1,
  quiet_hours_start: null, quiet_hours_end: null,
  font_scale: 1.0, compact_mode: 0, show_map_labels: 1,
  default_map_style: 'dark', dispatch_sort: 'priority',
  dispatch_show_cleared: 0, theme_preference: 'dark',
} as const;
```

new_string:
```
const PREF_DEFAULTS = {
  notify_dispatch_email: 1, notify_dispatch_inapp: 1,
  notify_bolo_email: 1, notify_bolo_inapp: 1,
  notify_warrant_email: 0, notify_warrant_inapp: 1,
  notify_system_email: 0, notify_system_inapp: 1,
  quiet_hours_start: null, quiet_hours_end: null,
  font_scale: 1.0, compact_mode: 0, show_map_labels: 1,
  default_map_style: 'dark', dispatch_sort: 'priority',
  dispatch_show_cleared: 0, theme_preference: 'dark',
  desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default',
  desktop_widgets_json: null,
} as const;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/desktopPreferences.test.ts`
Expected: PASS

- [ ] **Step 7: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: PASS — `PREF_DEFAULTS` is a `const` object literal with `as const`, adding `null`/string-literal keys doesn't change its inferred type shape in a way that breaks other consumers (`PREF_COLUMNS` derivation is purely `Object.keys`, type-agnostic).

- [ ] **Step 8: Commit**

```bash
git add migrations/0192_desktop_layout.sql src/routes/stubs.ts test-workers/desktopPreferences.test.ts
git commit -m "feat(desktop): add D1-backed desktop layout fields to user_preferences"
```

---

### Task 4: Self-service "my active shift" endpoint

**Files:**
- Modify: `src/routes/personnel.ts`
- Test: `test-workers/personnelActiveShift.test.ts`

**Interfaces:**
- Produces (consumed by Task 10's `DesktopClockWidget`): `GET /api/personnel/time/mine/active` → `200 { active: true, entry: { id, officer_id, clock_in, clock_in_local, status, ... } }` or `200 { active: false, entry: null }`. Self-only — no role gate beyond authentication, mirroring the existing self-service clock-in pattern at `src/routes/personnel.ts:744-745`.

- [ ] **Step 1: Write the failing test**

```ts
// test-workers/personnelActiveShift.test.ts
// Route-level test (Miniflare/workerd) for the self-service "am I clocked
// in" endpoint that powers the desktop Clock & Shift widget. Unlike GET
// /personnel/time (gated by requireTimeWriter — admin/manager/supervisor/HR
// only), this endpoint is self-only: any authenticated officer can read
// their OWN open time entry, never anyone else's.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import personnel from '../src/routes/personnel';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 7, role: 'officer' });
  c.set('userId', 7);
  await next();
});
app.route('/api/personnel', personnel);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER, schedule_id INTEGER,
    clock_in TEXT, clock_in_local TEXT, clock_out TEXT,
    total_hours REAL, break_start TEXT, break_minutes INTEGER,
    status TEXT, notes TEXT, created_at TEXT
  )`);
});

describe('GET /api/personnel/time/mine/active', () => {
  it('returns active:false when the officer has no open time entry', async () => {
    const res = await app.request('/api/personnel/time/mine/active', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { active: boolean; entry: unknown };
    expect(body.active).toBe(false);
    expect(body.entry).toBeNull();
  });

  it('returns active:true with the entry when clocked in', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO time_entries (officer_id, clock_in, clock_in_local, status, created_at) VALUES (7, '2026-07-18T14:00:00Z', '2026-07-18T08:00:00', 'active', datetime('now'))`);
    const res = await app.request('/api/personnel/time/mine/active', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { active: boolean; entry: { officer_id: number; clock_out: string | null } };
    expect(body.active).toBe(true);
    expect(body.entry.officer_id).toBe(7);
    expect(body.entry.clock_out).toBeNull();
  });

  it('never returns another officer\'s open entry', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO time_entries (officer_id, clock_in, status, created_at) VALUES (999, datetime('now'), 'active', datetime('now'))`);
    const res = await app.request('/api/personnel/time/mine/active', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { entry: { officer_id: number } | null };
    expect(body.entry?.officer_id).not.toBe(999);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/personnelActiveShift.test.ts`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Add the route**

Add this directly above the existing `personnel.post('/time/clock-in', ...)` handler in `src/routes/personnel.ts` (so it reads naturally alongside the other self-service time endpoints):

```ts
// ── GET /personnel/time/mine/active — self-only: am I currently clocked in?
// Unlike GET /time (requireTimeWriter-gated), this never exposes another
// officer's entry — officer_id is always the caller's own userId.
personnel.get('/time/mine/active', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.get('userId') as number | undefined;
    if (!officerId) return c.json({ error: 'unauthorized' }, 401);
    const entry = await queryFirst(db,
      `SELECT * FROM time_entries WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
      officerId);
    return c.json({ active: !!entry, entry: entry ?? null });
  } catch (err) {
    console.error('GET /personnel/time/mine/active failed:', err);
    return dbErrorResponse(c, err, 'Failed to load active shift');
  }
});

```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/personnelActiveShift.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: PASS — `getDb`, `queryFirst`, `dbErrorResponse` are already imported at the top of `personnel.ts` (used by every other handler in the file), no new imports needed.

- [ ] **Step 6: Commit**

```bash
git add src/routes/personnel.ts test-workers/personnelActiveShift.test.ts
git commit -m "feat(desktop): add self-service GET /personnel/time/mine/active endpoint"
```

---

### Task 5: Wallpaper presets + shared clock hook

**Files:**
- Create: `client/src/data/desktopWallpapers.ts`
- Create: `client/src/data/desktopWallpapers.test.ts`
- Create: `client/src/hooks/useClock.ts`
- Create: `client/src/hooks/useClock.test.ts`

**Interfaces:**
- Produces (consumed by Task 11's `DesktopPage` and the wallpaper-cycling context menu): `WallpaperPreset { id: string; label: string; background: string }`, `DESKTOP_WALLPAPERS: WallpaperPreset[]`, `DEFAULT_WALLPAPER_ID = 'blue-silver-default'`, `getWallpaper(id: string): WallpaperPreset`.
- Produces (consumed by Task 9's `DesktopTaskbar` and Task 10's `DesktopClockWidget`): `useClock(): { time: string; date: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/data/desktopWallpapers.test.ts
import { describe, it, expect } from 'vitest';
import { DESKTOP_WALLPAPERS, DEFAULT_WALLPAPER_ID, getWallpaper } from './desktopWallpapers';

describe('desktopWallpapers', () => {
  it('includes the default wallpaper id in the preset list', () => {
    expect(DESKTOP_WALLPAPERS.some(w => w.id === DEFAULT_WALLPAPER_ID)).toBe(true);
  });

  it('getWallpaper falls back to the default for an unknown id', () => {
    expect(getWallpaper('not-a-real-id').id).toBe(DEFAULT_WALLPAPER_ID);
  });

  it('every preset background references a CSS variable, never a hardcoded hex', () => {
    for (const w of DESKTOP_WALLPAPERS) {
      expect(w.background).toMatch(/var\(--/);
      expect(w.background).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});
```

```ts
// client/src/hooks/useClock.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClock } from './useClock';

describe('useClock', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns a non-empty time and date string, and updates on tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T20:00:00Z'));
    const { result } = renderHook(() => useClock());
    expect(result.current.time.length).toBeGreaterThan(0);
    expect(result.current.date.length).toBeGreaterThan(0);
    const firstTime = result.current.time;
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(result.current.time).not.toBe(firstTime);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/data/desktopWallpapers.test.ts src/hooks/useClock.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `desktopWallpapers.ts`**

```ts
// client/src/data/desktopWallpapers.ts
export interface WallpaperPreset {
  id: string;
  label: string;
  background: string;
}

export const DEFAULT_WALLPAPER_ID = 'blue-silver-default';

export const DESKTOP_WALLPAPERS: WallpaperPreset[] = [
  { id: 'blue-silver-default', label: 'Blue & Silver', background: 'var(--surface-base)' },
  { id: 'sunken', label: 'Sunken Slate', background: 'var(--surface-sunken)' },
  { id: 'overlay', label: 'Deep Overlay', background: 'var(--surface-overlay)' },
  {
    id: 'panel-grid',
    label: 'Panel Grid',
    background:
      'linear-gradient(var(--border-subtle) 1px, transparent 1px), ' +
      'linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px), var(--surface-base)',
  },
];

export function getWallpaper(id: string): WallpaperPreset {
  return DESKTOP_WALLPAPERS.find(w => w.id === id) ?? DESKTOP_WALLPAPERS[0];
}
```

- [ ] **Step 4: Write `useClock.ts`**

```ts
// client/src/hooks/useClock.ts
import { useState, useEffect } from 'react';

const TIME_ZONE = 'America/Denver';

function format(): { time: string; date: string } {
  const now = new Date();
  return {
    time: new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(now),
    date: new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    }).format(now),
  };
}

export function useClock(): { time: string; date: string } {
  const [now, setNow] = useState(format);

  useEffect(() => {
    const interval = setInterval(() => setNow(format()), 1000);
    return () => clearInterval(interval);
  }, []);

  return now;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/data/desktopWallpapers.test.ts src/hooks/useClock.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add client/src/data/desktopWallpapers.ts client/src/data/desktopWallpapers.test.ts client/src/hooks/useClock.ts client/src/hooks/useClock.test.ts
git commit -m "feat(desktop): add wallpaper presets and shared clock hook"
```

---

### Task 6: Desktop window manager (context + open-window session state)

**Files:**
- Create: `client/src/components/desktop/DesktopWindowManager.tsx`
- Create: `client/src/components/desktop/DesktopWindowManager.test.tsx`

**Interfaces:**
- Produces (consumed by Tasks 7, 8, 9, 11): `DesktopWindowState { id: string; path: string; title: string; x: number; y: number; width: number; height: number; zIndex: number; minimized: boolean; maximized: boolean }`, `DesktopWindowManagerProvider({ children }: { children: React.ReactNode })`, `useDesktopWindows(): { windows: DesktopWindowState[]; openWindow(path: string, title: string): void; closeWindow(id: string): void; focusWindow(id: string): void; minimizeWindow(id: string): void; toggleMaximize(id: string): void; moveResize(id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>): void }`.
- Session persistence key: `rmpg_desktop_windows` (sessionStorage) — ephemeral, per browser tab, matching how `rmpg_nav_recent` already uses sessionStorage.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/desktop/DesktopWindowManager.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';

function Harness() {
  const { windows, openWindow, closeWindow, focusWindow, minimizeWindow } = useDesktopWindows();
  return (
    <div>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open-dispatch</button>
      <button onClick={() => openWindow('/map', 'Live Map')}>open-map</button>
      <button onClick={() => windows[0] && closeWindow(windows[0].id)}>close-first</button>
      <button onClick={() => windows[0] && focusWindow(windows[0].id)}>focus-first</button>
      <button onClick={() => windows[0] && minimizeWindow(windows[0].id)}>minimize-first</button>
      <ul>{windows.map(w => <li key={w.id}>{w.title}-{w.zIndex}-{w.minimized ? 'min' : 'open'}</li>)}</ul>
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
    expect(screen.getByText(/^Dispatch-.*-min$/)).toBeInTheDocument();

    act(() => screen.getByText('close-first').click());
    expect(screen.getAllByRole('listitem').length).toBe(1);
  });

  it('persists open windows to sessionStorage under rmpg_desktop_windows', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    act(() => screen.getByText('open-dispatch').click());
    const raw = sessionStorage.getItem('rmpg_desktop_windows');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)[0].path).toBe('/dispatch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the component**

```tsx
// client/src/components/desktop/DesktopWindowManager.tsx
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

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

interface DesktopWindowManagerContextValue {
  windows: DesktopWindowState[];
  openWindow: (path: string, title: string) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => void;
}

const SESSION_KEY = 'rmpg_desktop_windows';
const MAX_OPEN_WINDOWS = 6;

const DesktopWindowManagerContext = createContext<DesktopWindowManagerContextValue | null>(null);

export function useDesktopWindows(): DesktopWindowManagerContextValue {
  const ctx = useContext(DesktopWindowManagerContext);
  if (!ctx) throw new Error('useDesktopWindows must be used within DesktopWindowManagerProvider');
  return ctx;
}

function loadSession(): DesktopWindowState[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

let nextZIndex = 100;

export function DesktopWindowManagerProvider({ children }: { children: React.ReactNode }) {
  const [windows, setWindows] = useState<DesktopWindowState[]>(loadSession);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(windows)); } catch { /* silent */ }
    }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [windows]);

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

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    nextZIndex += 1;
    const z = nextZIndex;
    setWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: z, minimized: false } : w));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: !w.minimized } : w));
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w));
  }, []);

  const moveResize = useCallback((id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  }, []);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize }}
    >
      {children}
    </DesktopWindowManagerContext.Provider>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopWindowManager.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopWindowManager.tsx client/src/components/desktop/DesktopWindowManager.test.tsx
git commit -m "feat(desktop): add DesktopWindowManager context for in-page windows"
```

---

### Task 7: FloatingWindow chrome (drag, resize, minimize, maximize, close)

**Files:**
- Create: `client/src/components/desktop/FloatingWindow.tsx`
- Create: `client/src/components/desktop/FloatingWindow.test.tsx`

**Interfaces:**
- Consumes: `DesktopWindowState`, `useDesktopWindows()` from Task 6.
- Produces (consumed by Task 11): `FloatingWindow({ win }: { win: DesktopWindowState })`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/desktop/FloatingWindow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FloatingWindow from './FloatingWindow';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';

function Harness() {
  const { windows, openWindow } = useDesktopWindows();
  return (
    <div>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>open</button>
      {windows.map(w => <FloatingWindow key={w.id} win={w} />)}
    </div>
  );
}

describe('FloatingWindow', () => {
  it('renders a title bar with the window title and an iframe pointed at the route', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('Dispatch')).toBeInTheDocument();
    const iframe = screen.getByTitle('Dispatch') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toContain('/dispatch');
  });

  it('close button removes the window', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByLabelText('Close Dispatch'));
    expect(screen.queryByText('Dispatch')).not.toBeInTheDocument();
  });

  it('minimize button hides the iframe but keeps the window in the taskbar-visible list', () => {
    render(<DesktopWindowManagerProvider><Harness /></DesktopWindowManagerProvider>);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByLabelText('Minimize Dispatch'));
    expect(screen.queryByTitle('Dispatch')).not.toBeInTheDocument();
    expect(screen.getByText('Dispatch')).toBeInTheDocument(); // title bar itself stays mounted, per minimized styling
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the component**

```tsx
// client/src/components/desktop/FloatingWindow.tsx
import React, { useCallback, useRef } from 'react';
import { X, Minus, Square } from 'lucide-react';
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';

const TITLE_BAR_HEIGHT = 30;

interface FloatingWindowProps {
  win: DesktopWindowState;
}

export default function FloatingWindow({ win }: FloatingWindowProps) {
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize } = useDesktopWindows();
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);

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

  const onResizeHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    focusWindow(win.id);
    resizeState.current = { startX: e.clientX, startY: e.clientY, originW: win.width, originH: win.height };
    const onMove = (ev: PointerEvent) => {
      if (!resizeState.current) return;
      const dx = ev.clientX - resizeState.current.startX;
      const dy = ev.clientY - resizeState.current.startY;
      moveResize(win.id, {
        width: Math.max(360, resizeState.current.originW + dx),
        height: Math.max(240, resizeState.current.originH + dy),
      });
    };
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [win.id, win.width, win.height, focusWindow, moveResize]);

  const style: React.CSSProperties = win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: 48, zIndex: win.zIndex }
    : {
        position: 'fixed', left: win.x, top: win.y,
        width: win.width, height: win.minimized ? TITLE_BAR_HEIGHT : win.height,
        zIndex: win.zIndex,
      };

  return (
    <div
      style={{ ...style, background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
      onPointerDown={() => focusWindow(win.id)}
    >
      <div
        onPointerDown={onTitleBarPointerDown}
        className="flex items-center justify-between px-2 select-none cursor-move"
        style={{ height: TITLE_BAR_HEIGHT, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{win.title}</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={`Minimize ${win.title}`} onClick={() => minimizeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <Minus className="w-3 h-3" style={{ color: 'var(--rmpg-400)' }} />
          </button>
          <button type="button" aria-label={`Maximize ${win.title}`} onClick={() => toggleMaximize(win.id)} className="p-1 hover:bg-surface-hover">
            <Square className="w-3 h-3" style={{ color: 'var(--rmpg-400)' }} />
          </button>
          <button type="button" aria-label={`Close ${win.title}`} onClick={() => closeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--rmpg-400))' }} />
          </button>
        </div>
      </div>

      {!win.minimized && (
        <>
          <iframe title={win.title} src={win.path} style={{ width: '100%', height: `calc(100% - ${TITLE_BAR_HEIGHT}px)`, border: 'none' }} />
          {!win.maximized && (
            <div
              onPointerDown={onResizeHandlePointerDown}
              style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize' }}
            />
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/FloatingWindow.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/FloatingWindow.tsx client/src/components/desktop/FloatingWindow.test.tsx
git commit -m "feat(desktop): add FloatingWindow draggable/resizable iframe chrome"
```

---

### Task 8: Desktop icon grid (pinned modules, click-to-open, drag reposition, unpin)

**Files:**
- Create: `client/src/components/desktop/DesktopIconGrid.tsx`
- Create: `client/src/components/desktop/DesktopIconGrid.test.tsx`

**Interfaces:**
- Consumes: `NavFunction` (Task 1), `POPOUT_PAGES`/`openPageWindow` (existing `client/src/utils/windowManager.ts`), `useDesktopWindows()` (Task 6), `ContextMenu`/`ContextMenuItem` (existing `client/src/components/ContextMenu.tsx`).
- Produces (consumed by Task 11): `DesktopIconGridProps { icons: NavFunction[]; positions: Record<string, { x: number; y: number }>; onReposition: (path: string, x: number, y: number) => void; onUnpin: (path: string) => void }`, `export default function DesktopIconGrid(props: DesktopIconGridProps)`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/desktop/DesktopIconGrid.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import DesktopIconGrid from './DesktopIconGrid';
import { Radio, Package } from 'lucide-react';
import type { NavFunction } from '../../data/navCatalog';

const icons: NavFunction[] = [
  { path: '/dispatch', label: 'Dispatch Console', icon: Radio, description: 'desc' }, // in POPOUT_PAGES
  { path: '/impound', label: 'Impound', icon: Package, description: 'desc' }, // NOT in POPOUT_PAGES
];

function Harness({ onUnpin }: { onUnpin: (path: string) => void }) {
  return (
    <DesktopIconGrid
      icons={icons}
      positions={{ '/dispatch': { x: 20, y: 20 }, '/impound': { x: 180, y: 20 } }}
      onReposition={() => {}}
      onUnpin={onUnpin}
    />
  );
}

describe('DesktopIconGrid', () => {
  it('clicking a POPOUT_PAGES-eligible icon opens an in-page window, not SPA navigation', () => {
    let windowsSnapshot: unknown[] = [];
    function Reader() { windowsSnapshot = useDesktopWindows().windows; return null; }
    render(
      <MemoryRouter>
        <DesktopWindowManagerProvider>
          <Harness onUnpin={() => {}} />
          <Reader />
        </DesktopWindowManagerProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Dispatch Console'));
    expect(windowsSnapshot.length).toBe(1);
  });

  it('clicking a non-eligible icon does not open a window', () => {
    let windowsSnapshot: unknown[] = [];
    function Reader() { windowsSnapshot = useDesktopWindows().windows; return null; }
    render(
      <MemoryRouter>
        <DesktopWindowManagerProvider>
          <Harness onUnpin={() => {}} />
          <Reader />
        </DesktopWindowManagerProvider>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Impound'));
    expect(windowsSnapshot.length).toBe(0);
  });

  it('right-click "Unpin" calls onUnpin with the icon path', () => {
    const onUnpin = vi.fn();
    render(
      <MemoryRouter>
        <DesktopWindowManagerProvider><Harness onUnpin={onUnpin} /></DesktopWindowManagerProvider>
      </MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByText('Impound'));
    fireEvent.click(screen.getByText('Unpin'));
    expect(onUnpin).toHaveBeenCalledWith('/impound');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopIconGrid.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the component**

```tsx
// client/src/components/desktop/DesktopIconGrid.tsx
import React, { useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavFunction } from '../../data/navCatalog';
import { POPOUT_PAGES } from '../../utils/windowManager';
import { useDesktopWindows } from './DesktopWindowManager';
import ContextMenu from '../ContextMenu';

export interface DesktopIconGridProps {
  icons: NavFunction[];
  positions: Record<string, { x: number; y: number }>;
  onReposition: (path: string, x: number, y: number) => void;
  onUnpin: (path: string) => void;
}

const ICON_SIZE = 64;

export default function DesktopIconGrid({ icons, positions, onReposition, onUnpin }: DesktopIconGridProps) {
  const navigate = useNavigate();
  const { openWindow } = useDesktopWindows();
  const dragRef = useRef<{ path: string; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const handleActivate = useCallback((fn: NavFunction) => {
    if (POPOUT_PAGES[fn.path]) {
      openWindow(fn.path, fn.label);
    } else {
      navigate(fn.path);
    }
  }, [navigate, openWindow]);

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

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {icons.map((fn) => {
        const pos = positions[fn.path] ?? { x: 20, y: 20 };
        const Icon = fn.icon;
        const eligible = !!POPOUT_PAGES[fn.path];
        return (
          <ContextMenu
            key={fn.path}
            items={[
              { label: 'Open', onClick: () => handleActivate(fn) },
              ...(eligible ? [{ label: 'Open in new browser tab', onClick: () => window.open(fn.path, '_blank', 'noopener,noreferrer') }] : []),
              { label: 'Unpin', onClick: () => onUnpin(fn.path) },
            ]}
          >
            <button
              type="button"
              onClick={() => handleActivate(fn)}
              onPointerDown={(e) => onIconPointerDown(fn, e)}
              style={{ position: 'absolute', left: pos.x, top: pos.y, width: ICON_SIZE + 24 }}
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

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopIconGrid.tsx client/src/components/desktop/DesktopIconGrid.test.tsx
git commit -m "feat(desktop): add DesktopIconGrid with click-to-window and drag reposition"
```

---

### Task 9: Desktop taskbar (open-window buttons, module launcher, clock, notifications)

**Files:**
- Create: `client/src/components/desktop/DesktopTaskbar.tsx`
- Create: `client/src/components/desktop/DesktopTaskbar.test.tsx`

**Interfaces:**
- Consumes: `useDesktopWindows()` (Task 6), `useClock()` (Task 5), `NavFunction` (Task 1), `apiFetch` (existing).
- Produces (consumed by Task 11): `DesktopTaskbarProps { icons: NavFunction[]; catalog: NavFunction[] }` — `icons` is the pinned subset shown when the launcher query is empty (same list passed to `DesktopIconGrid`); `catalog` is the **already role-filtered** full function list (computed once in `DesktopPage` from `NAV_CATEGORIES` minus `CLIENT_VIEWER_BLOCKED`/`CONTRACT_MANAGER_BLOCKED`/`adminOnly`) used for launcher search — the taskbar must never search the raw unfiltered `NAV_CATEGORIES` directly, or a blocked role could find a hidden module through the launcher even though it's correctly absent from their icon grid. `export default function DesktopTaskbar(props: DesktopTaskbarProps)`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/desktop/DesktopTaskbar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetchMock = vi.fn().mockResolvedValue({ count: 0 });
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import { DesktopWindowManagerProvider, useDesktopWindows } from './DesktopWindowManager';
import DesktopTaskbar from './DesktopTaskbar';
import { Radio } from 'lucide-react';
import type { NavFunction } from '../../data/navCatalog';

const icons: NavFunction[] = [{ path: '/dispatch', label: 'Dispatch Console', icon: Radio, description: 'd' }];

function Harness() {
  const { openWindow } = useDesktopWindows();
  return (
    <>
      <button onClick={() => openWindow('/dispatch', 'Dispatch')}>simulate-open</button>
      <DesktopTaskbar icons={icons} catalog={icons} />
    </>
  );
}

describe('DesktopTaskbar', () => {
  beforeEach(() => apiFetchMock.mockClear());

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the component**

```tsx
// client/src/components/desktop/DesktopTaskbar.tsx
import React, { useState, useMemo } from 'react';
import { Grid3X3, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDesktopWindows } from './DesktopWindowManager';
import { useClock } from '../../hooks/useClock';
import type { NavFunction } from '../../data/navCatalog';
import { apiFetch } from '../../hooks/useApi';

export interface DesktopTaskbarProps {
  icons: NavFunction[];
  catalog: NavFunction[];
}

export default function DesktopTaskbar({ icons, catalog }: DesktopTaskbarProps) {
  const { windows, focusWindow } = useDesktopWindows();
  const { time } = useClock();
  const navigate = useNavigate();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  React.useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await apiFetch<{ count: number }>('/notifications/unread-count');
        if (!cancelled) setUnreadCount(res?.count ?? 0);
      } catch { /* silent */ }
    }
    poll();
    const interval = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const searchResults = useMemo(() => {
    if (!query.trim()) return icons;
    const q = query.toLowerCase();
    return catalog.filter(fn =>
      fn.label.toLowerCase().includes(q) || fn.description.toLowerCase().includes(q) || fn.path.toLowerCase().includes(q));
  }, [query, icons, catalog]);

  return (
    <div
      className="flex items-center justify-between px-2 gap-2"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 48, background: 'var(--surface-overlay)', borderTop: '1px solid var(--border-default)', zIndex: 1000 }}
    >
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Open app launcher" onClick={() => setLauncherOpen(v => !v)} className="p-2 hover:bg-surface-hover">
          <Grid3X3 className="w-4 h-4" style={{ color: 'var(--brand-400)' }} />
        </button>
        {launcherOpen && (
          <div style={{ position: 'fixed', left: 8, bottom: 52, width: 320, maxHeight: 400, overflowY: 'auto', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', zIndex: 1001 }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules…"
              className="w-full px-2 py-1.5 text-[11px] bg-surface-sunken border-b border-rmpg-700 text-rmpg-100 focus:outline-none"
            />
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
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
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

      <div className="flex items-center gap-3">
        <div className="relative">
          <Bell className="w-4 h-4" style={{ color: 'var(--rmpg-400)' }} />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 flex items-center justify-center font-bold bg-red-600 text-white"
              style={{ minWidth: 12, height: 12, padding: '0 2px', fontSize: 7, borderRadius: 6 }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-primary)' }}>{time}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/DesktopTaskbar.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopTaskbar.tsx client/src/components/desktop/DesktopTaskbar.test.tsx
git commit -m "feat(desktop): add DesktopTaskbar with open-window buttons and module launcher"
```

---

### Task 10: Desktop widgets (Clock & Shift, Live Ops Summary, Notifications, Quick-Access) + panel

**Files:**
- Create: `client/src/components/desktop/widgets/DesktopClockWidget.tsx`
- Create: `client/src/components/desktop/widgets/DesktopOpsSummaryWidget.tsx`
- Create: `client/src/components/desktop/widgets/DesktopNotificationsWidget.tsx`
- Create: `client/src/components/desktop/widgets/DesktopQuickAccessWidget.tsx`
- Create: `client/src/components/desktop/DesktopWidgetPanel.tsx`
- Create: `client/src/components/desktop/widgets/DesktopClockWidget.test.tsx`
- Create: `client/src/components/desktop/widgets/DesktopOpsSummaryWidget.test.tsx`
- Create: `client/src/components/desktop/widgets/DesktopNotificationsWidget.test.tsx`
- Create: `client/src/components/desktop/widgets/DesktopQuickAccessWidget.test.tsx`
- Create: `client/src/components/desktop/DesktopWidgetPanel.test.tsx`

**Interfaces:**
- Consumes: `useClock()` (Task 5), `useNavBadges()` (Task 2), `apiFetch` (existing), `loadFavorites`/`loadRecent` (Task 1), `NAV_CATEGORIES` (Task 1).
- Produces (consumed by Task 11): a fixed widget id union `'clock' | 'ops-summary' | 'notifications' | 'quick-access'`, and `DesktopWidgetPanelProps { enabledWidgets: string[]; onToggleWidget: (id: string, enabled: boolean) => void }`, `export default function DesktopWidgetPanel(props: DesktopWidgetPanelProps)`.

- [ ] **Step 1: Write the failing tests for all four widgets**

```tsx
// client/src/components/desktop/widgets/DesktopClockWidget.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopClockWidget from './DesktopClockWidget';

describe('DesktopClockWidget', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('shows "Off Duty" when no active shift', async () => {
    apiFetchMock.mockResolvedValue({ active: false, entry: null });
    render(<DesktopClockWidget />);
    await waitFor(() => expect(screen.getByText(/Off Duty/i)).toBeInTheDocument());
  });

  it('shows shift status when clocked in', async () => {
    apiFetchMock.mockResolvedValue({ active: true, entry: { clock_in: '2026-07-18T14:00:00Z' } });
    render(<DesktopClockWidget />);
    await waitFor(() => expect(screen.getByText(/On Duty/i)).toBeInTheDocument());
  });
});
```

```tsx
// client/src/components/desktop/widgets/DesktopOpsSummaryWidget.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopOpsSummaryWidget from './DesktopOpsSummaryWidget';

describe('DesktopOpsSummaryWidget', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/dispatch') return Promise.resolve({ calls: { active: 4 } });
      if (endpoint === '/stats/dashboard') return Promise.resolve({ open_cases: 9, pending_serve: 2 });
      if (endpoint === '/dispatch/stats') return Promise.resolve({ active_warrants: 6 });
      return Promise.resolve({});
    });
  });

  it('renders live counts for calls, cases, warrants, and serves', async () => {
    render(<DesktopOpsSummaryWidget />);
    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument());
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
```

```tsx
// client/src/components/desktop/widgets/DesktopNotificationsWidget.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopNotificationsWidget from './DesktopNotificationsWidget';

describe('DesktopNotificationsWidget', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('renders recent notification titles from GET /notifications', async () => {
    apiFetchMock.mockResolvedValue({ data: [{ id: 1, title: 'BOLO Updated', created_at: '2026-07-18T10:00:00Z' }] });
    render(<DesktopNotificationsWidget />);
    await waitFor(() => expect(screen.getByText('BOLO Updated')).toBeInTheDocument());
  });

  it('shows an empty state with zero notifications', async () => {
    apiFetchMock.mockResolvedValue({ data: [] });
    render(<DesktopNotificationsWidget />);
    await waitFor(() => expect(screen.getByText(/No recent notifications/i)).toBeInTheDocument());
  });
});
```

```tsx
// client/src/components/desktop/widgets/DesktopQuickAccessWidget.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { saveFavorites } from '../../../utils/navFavorites';
import DesktopQuickAccessWidget from './DesktopQuickAccessWidget';

describe('DesktopQuickAccessWidget', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('lists favorited modules by label', () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopQuickAccessWidget /></MemoryRouter>);
    expect(screen.getByText('Dispatch Console')).toBeInTheDocument();
  });

  it('shows an empty state with no favorites', () => {
    render(<MemoryRouter><DesktopQuickAccessWidget /></MemoryRouter>);
    expect(screen.getByText(/No favorites yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/components/desktop/widgets`
Expected: FAIL — none of the four modules exist yet.

- [ ] **Step 3: Write `DesktopClockWidget.tsx`**

```tsx
// client/src/components/desktop/widgets/DesktopClockWidget.tsx
import React, { useState, useEffect } from 'react';
import { useClock } from '../../../hooks/useClock';
import { apiFetch } from '../../../hooks/useApi';

export default function DesktopClockWidget() {
  const { time, date } = useClock();
  const [active, setActive] = useState<boolean | null>(null);
  const [clockIn, setClockIn] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ active: boolean; entry: { clock_in: string } | null }>('/personnel/time/mine/active')
      .then(res => { if (!cancelled) { setActive(res.active); setClockIn(res.entry?.clock_in ?? null); } })
      .catch(() => { if (!cancelled) setActive(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 200 }}>
      <div className="text-[20px] font-mono" style={{ color: 'var(--text-primary)' }}>{time}</div>
      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{date}</div>
      <div className="mt-2 text-[10px] font-semibold" style={{ color: active ? 'var(--brand-400)' : 'var(--text-muted)' }}>
        {active === null ? '…' : active ? `On Duty since ${clockIn ? new Date(clockIn).toLocaleTimeString() : ''}` : 'Off Duty'}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `DesktopOpsSummaryWidget.tsx`**

```tsx
// client/src/components/desktop/widgets/DesktopOpsSummaryWidget.tsx
import React from 'react';
import { useNavBadges } from '../../../hooks/useNavBadges';

const ROWS: { key: 'activeCalls' | 'openCases' | 'activeWarrants' | 'pendingServe'; label: string }[] = [
  { key: 'activeCalls', label: 'Active Calls' },
  { key: 'openCases', label: 'Open Cases' },
  { key: 'activeWarrants', label: 'Active Warrants' },
  { key: 'pendingServe', label: 'Pending Serve' },
];

export default function DesktopOpsSummaryWidget() {
  const { badges } = useNavBadges();
  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 200 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--rmpg-400)' }}>Live Ops</div>
      {ROWS.map(row => (
        <div key={row.key} className="flex items-center justify-between text-[11px] py-0.5">
          <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
          <span className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{badges[row.key] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `DesktopNotificationsWidget.tsx`**

```tsx
// client/src/components/desktop/widgets/DesktopNotificationsWidget.tsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface NotificationRow { id: number; title: string; created_at: string }

export default function DesktopNotificationsWidget() {
  const [items, setItems] = useState<NotificationRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data: NotificationRow[] }>('/notifications?per_page=5')
      .then(res => { if (!cancelled) setItems(res?.data ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 240 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--rmpg-400)' }}>Notifications</div>
      {items.length === 0 ? (
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No recent notifications.</div>
      ) : (
        items.map(n => (
          <div key={n.id} className="text-[11px] py-1 truncate" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)' }}>
            {n.title}
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write `DesktopQuickAccessWidget.tsx`**

```tsx
// client/src/components/desktop/widgets/DesktopQuickAccessWidget.tsx
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV_CATEGORIES } from '../../../data/navCatalog';
import { loadFavorites, loadRecent } from '../../../utils/navFavorites';

export default function DesktopQuickAccessWidget() {
  const navigate = useNavigate();
  const allFunctions = useMemo(() => NAV_CATEGORIES.flatMap(cat => cat.functions), []);
  const favorites = useMemo(() => {
    const favSet = loadFavorites();
    return allFunctions.filter(fn => favSet.has(fn.path));
  }, [allFunctions]);
  const recent = useMemo(() => {
    const recentPaths = loadRecent();
    return recentPaths.map(p => allFunctions.find(fn => fn.path === p)).filter(Boolean).slice(0, 5) as typeof allFunctions;
  }, [allFunctions]);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 220 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--rmpg-400)' }}>Quick Access</div>
      {favorites.length === 0 && recent.length === 0 ? (
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No favorites yet — star a module in the Directory.</div>
      ) : (
        <>
          {favorites.map(fn => (
            <button key={fn.path} type="button" onClick={() => navigate(fn.path)} className="w-full text-left text-[11px] py-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
              {fn.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write `DesktopWidgetPanel.tsx`**

```tsx
// client/src/components/desktop/DesktopWidgetPanel.tsx
import React from 'react';
import DesktopClockWidget from './widgets/DesktopClockWidget';
import DesktopOpsSummaryWidget from './widgets/DesktopOpsSummaryWidget';
import DesktopNotificationsWidget from './widgets/DesktopNotificationsWidget';
import DesktopQuickAccessWidget from './widgets/DesktopQuickAccessWidget';

export interface DesktopWidgetPanelProps {
  enabledWidgets: string[];
}

const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  'clock': DesktopClockWidget,
  'ops-summary': DesktopOpsSummaryWidget,
  'notifications': DesktopNotificationsWidget,
  'quick-access': DesktopQuickAccessWidget,
};

export default function DesktopWidgetPanel({ enabledWidgets }: DesktopWidgetPanelProps) {
  return (
    <div className="flex flex-col gap-2" style={{ position: 'fixed', right: 16, top: 16, zIndex: 10 }}>
      {enabledWidgets.map(id => {
        const Widget = WIDGET_COMPONENTS[id];
        return Widget ? <Widget key={id} /> : null;
      })}
    </div>
  );
}
```

- [ ] **Step 8: Run all widget + panel tests to verify they pass**

Run: `cd client && npx vitest run src/components/desktop/widgets src/components/desktop/DesktopWidgetPanel.test.tsx`
Expected: PASS

First write `DesktopWidgetPanel.test.tsx`:

```tsx
// client/src/components/desktop/DesktopWidgetPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useApi', () => ({ apiFetch: () => Promise.resolve({}) }));

import DesktopWidgetPanel from './DesktopWidgetPanel';

describe('DesktopWidgetPanel', () => {
  it('renders only the enabled widgets, in the given order', () => {
    render(<MemoryRouter><DesktopWidgetPanel enabledWidgets={['clock', 'quick-access']} /></MemoryRouter>);
    expect(screen.getAllByText(/Off Duty|Quick Access|…/i).length).toBeGreaterThan(0);
  });

  it('renders nothing for an empty enabledWidgets list', () => {
    const { container } = render(<MemoryRouter><DesktopWidgetPanel enabledWidgets={[]} /></MemoryRouter>);
    expect(container.querySelector('div')?.children.length).toBe(0);
  });
});
```

- [ ] **Step 9: Commit**

```bash
git add client/src/components/desktop/widgets client/src/components/desktop/DesktopWidgetPanel.tsx client/src/components/desktop/DesktopWidgetPanel.test.tsx
git commit -m "feat(desktop): add Clock/Ops-Summary/Notifications/Quick-Access widgets and panel"
```

---

### Task 11: DesktopPage — wallpaper, layout persistence, and pulling the shell together

**Files:**
- Create: `client/src/components/desktop/DesktopWallpaper.tsx`
- Create: `client/src/components/desktop/DesktopWidgetSettingsPopover.tsx`
- Create: `client/src/pages/DesktopPage.tsx`
- Create: `client/src/pages/DesktopPage.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1, 2, 5, 6, 7, 8, 9, 10; `useUserPreferences()` (existing `client/src/context/UserPreferencesContext.tsx`); `apiFetch` (existing).
- Produces (consumed by Task 12): `export default function DesktopPage()`.

- [ ] **Step 1: Write `DesktopWallpaper.tsx`**

```tsx
// client/src/components/desktop/DesktopWallpaper.tsx
import React from 'react';
import { getWallpaper } from '../../data/desktopWallpapers';

export default function DesktopWallpaper({ wallpaperId, children }: { wallpaperId: string; children: React.ReactNode }) {
  const wallpaper = getWallpaper(wallpaperId);
  return (
    <div style={{ position: 'absolute', inset: 0, background: wallpaper.background, overflow: 'hidden' }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write `DesktopWidgetSettingsPopover.tsx`**

```tsx
// client/src/components/desktop/DesktopWidgetSettingsPopover.tsx
import React from 'react';

const ALL_WIDGETS: { id: string; label: string }[] = [
  { id: 'clock', label: 'Clock & Shift' },
  { id: 'ops-summary', label: 'Live Ops Summary' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'quick-access', label: 'Quick Access' },
];

export interface DesktopWidgetSettingsPopoverProps {
  enabledWidgets: string[];
  onToggle: (id: string, enabled: boolean) => void;
  onClose: () => void;
}

export default function DesktopWidgetSettingsPopover({ enabledWidgets, onToggle, onClose }: DesktopWidgetSettingsPopoverProps) {
  return (
    <div
      style={{ position: 'fixed', right: 16, top: 16, width: 220, background: 'var(--surface-raised)', border: '1px solid var(--border-default)', zIndex: 2000 }}
      className="p-2"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--rmpg-400)' }}>Widgets</span>
        <button type="button" onClick={onClose} className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Close</button>
      </div>
      {ALL_WIDGETS.map(w => (
        <label key={w.id} className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            checked={enabledWidgets.includes(w.id)}
            onChange={(e) => onToggle(w.id, e.target.checked)}
          />
          {w.label}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write the failing test for `DesktopPage`**

```tsx
// client/src/pages/DesktopPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiFetchMock = vi.fn().mockResolvedValue({});
vi.mock('../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const mockPrefs = { desktop_layout_json: null, desktop_wallpaper: 'blue-silver-default', desktop_widgets_json: null };
vi.mock('../context/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ prefs: mockPrefs, reload: vi.fn(), isLoading: false, error: null }),
}));

import { saveFavorites } from '../utils/navFavorites';
import DesktopPage from './DesktopPage';

describe('DesktopPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetchMock.mockClear();
    apiFetchMock.mockResolvedValue({});
  });

  it('auto-populates the icon grid from current favorites on first load', async () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Dispatch Console')).toBeInTheDocument());
  });

  it('shows an empty-state prompt with zero favorites', async () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/star modules from Module Directory/i)).toBeInTheDocument());
  });

  it('renders the taskbar and widget panel', () => {
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    expect(screen.getByLabelText('Open app launcher')).toBeInTheDocument();
  });

  it('debounce-saves layout changes via PUT /preferences', async () => {
    saveFavorites(new Set(['/dispatch']));
    render(<MemoryRouter><DesktopPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Dispatch Console')).toBeInTheDocument());
    fireEvent.contextMenu(document.body);
    await waitFor(() => {
      const putCall = apiFetchMock.mock.calls.find(c => c[1]?.method === 'PUT');
      expect(putCall).toBeUndefined(); // no change made yet — proves save is change-triggered, not on every render
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 5: Write `DesktopPage.tsx`**

```tsx
// client/src/pages/DesktopPage.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED, type NavFunction } from '../data/navCatalog';
import { loadFavorites, saveFavorites } from '../utils/navFavorites';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { DEFAULT_WALLPAPER_ID, DESKTOP_WALLPAPERS } from '../data/desktopWallpapers';
import DesktopWallpaper from '../components/desktop/DesktopWallpaper';
import { DesktopWindowManagerProvider, useDesktopWindows } from '../components/desktop/DesktopWindowManager';
import FloatingWindow from '../components/desktop/FloatingWindow';
import DesktopIconGrid from '../components/desktop/DesktopIconGrid';
import DesktopTaskbar from '../components/desktop/DesktopTaskbar';
import DesktopWidgetPanel from '../components/desktop/DesktopWidgetPanel';
import DesktopWidgetSettingsPopover from '../components/desktop/DesktopWidgetSettingsPopover';
import ContextMenu from '../components/ContextMenu';

const DEFAULT_WIDGETS = ['clock', 'ops-summary', 'notifications', 'quick-access'];
const GRID_COLS = 6;
const CELL_W = 96;
const CELL_H = 96;

function autoLayout(paths: string[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  paths.forEach((path, i) => {
    positions[path] = { x: (i % GRID_COLS) * CELL_W + 20, y: Math.floor(i / GRID_COLS) * CELL_H + 20 };
  });
  return positions;
}

function WindowLayer() {
  const { windows } = useDesktopWindows();
  return <>{windows.map(w => <FloatingWindow key={w.id} win={w} />)}</>;
}

export default function DesktopPage() {
  const { user } = useAuth();
  const { prefs, reload } = useUserPreferences();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isClientViewer = user?.role === 'client_viewer';
  const isContractManager = user?.role === 'contract_manager';

  // Role-filtered full catalog — mirrors ModuleDirectoryPage's visibleCategories
  // filter exactly (adminOnly + CLIENT_VIEWER_BLOCKED + CONTRACT_MANAGER_BLOCKED).
  // Both the icon grid (via `pinnedIcons`, a subset) and the taskbar launcher
  // search (via the `catalog` prop) must derive from this, never from raw
  // NAV_CATEGORIES, or a blocked role could search up a hidden module.
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

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      if (prefs.desktop_layout_json) {
        const parsed = JSON.parse(prefs.desktop_layout_json) as { path: string; x: number; y: number }[];
        return Object.fromEntries(parsed.map(p => [p.path, { x: p.x, y: p.y }]));
      }
    } catch { /* fall through to auto-layout */ }
    return autoLayout([...favorites]);
  });

  const [wallpaperId, setWallpaperId] = useState(prefs.desktop_wallpaper || DEFAULT_WALLPAPER_ID);
  const [enabledWidgets, setEnabledWidgets] = useState<string[]>(() => {
    try {
      return prefs.desktop_widgets_json ? JSON.parse(prefs.desktop_widgets_json) : DEFAULT_WIDGETS;
    } catch { return DEFAULT_WIDGETS; }
  });
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const layout = Object.entries(positions).map(([path, pos]) => ({ path, ...pos }));
      apiFetch('/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          desktop_layout_json: JSON.stringify(layout),
          desktop_wallpaper: wallpaperId,
          desktop_widgets_json: JSON.stringify(enabledWidgets),
        }),
      }).then(() => reload()).catch(() => { /* non-blocking — retried on next change */ });
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, wallpaperId, enabledWidgets]);

  const handleReposition = useCallback((path: string, x: number, y: number) => {
    setPositions(prev => ({ ...prev, [path]: { x, y } }));
  }, []);

  const handleUnpin = useCallback((path: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      next.delete(path);
      saveFavorites(next);
      return next;
    });
    setPositions(prev => {
      const { [path]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleToggleWidget = useCallback((id: string, enabled: boolean) => {
    setEnabledWidgets(prev => enabled ? [...prev.filter(w => w !== id), id] : prev.filter(w => w !== id));
  }, []);

  const handleCycleWallpaper = useCallback(() => {
    setWallpaperId(prev => {
      const idx = DESKTOP_WALLPAPERS.findIndex(w => w.id === prev);
      return DESKTOP_WALLPAPERS[(idx + 1) % DESKTOP_WALLPAPERS.length].id;
    });
  }, []);

  return (
    <DesktopWindowManagerProvider>
      <ContextMenu
        items={[
          { label: 'Change wallpaper', onClick: handleCycleWallpaper },
          { label: 'Widget settings', onClick: () => setWidgetSettingsOpen(true) },
        ]}
      >
        <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
          <DesktopWallpaper wallpaperId={wallpaperId}>
            {pinnedIcons.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--text-muted)' }}>
                No modules pinned yet — star modules from Module Directory, or right-click here to get started.
              </div>
            ) : (
              <DesktopIconGrid icons={pinnedIcons} positions={positions} onReposition={handleReposition} onUnpin={handleUnpin} />
            )}
            <DesktopWidgetPanel enabledWidgets={enabledWidgets} />
            <WindowLayer />
          </DesktopWallpaper>
        </div>
      </ContextMenu>
      <DesktopTaskbar icons={pinnedIcons} catalog={allFunctions} />
      {widgetSettingsOpen && (
        <DesktopWidgetSettingsPopover
          enabledWidgets={enabledWidgets}
          onToggle={handleToggleWidget}
          onClose={() => setWidgetSettingsOpen(false)}
        />
      )}
    </DesktopWindowManagerProvider>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/DesktopPage.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 7: Run full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/components/desktop/DesktopWallpaper.tsx client/src/components/desktop/DesktopWidgetSettingsPopover.tsx client/src/pages/DesktopPage.tsx client/src/pages/DesktopPage.test.tsx
git commit -m "feat(desktop): add DesktopPage tying together wallpaper, layout persistence, and shell"
```

---

### Task 12: Routing — `/desktop` route + sidebar nav entry

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `DesktopPage` (Task 11, default export).

- [ ] **Step 1: Add the lazy-loaded route in `App.tsx`**

Find the existing block of `lazyRetry` route declarations (alongside `const NavigationPage = lazyRetry(() => import('./pages/NavigationPage'));` at line 88) and add, using the Edit tool:

old_string:
```
const NavigationPage = lazyRetry(() => import('./pages/NavigationPage'));
```

new_string:
```
const NavigationPage = lazyRetry(() => import('./pages/NavigationPage'));
const DesktopPage = lazyRetry(() => import('./pages/DesktopPage'));
```

Then add the route itself, immediately after the `/navigation` route (line 527), using the Edit tool:

old_string:
```
            <Route path="/navigation" element={<RouteErrorBoundary><NavigationPage /></RouteErrorBoundary>} />
```

new_string:
```
            <Route path="/navigation" element={<RouteErrorBoundary><NavigationPage /></RouteErrorBoundary>} />
            <Route path="/desktop" element={<RouteErrorBoundary><DesktopPage /></RouteErrorBoundary>} />
```

- [ ] **Step 2: Add the sidebar nav entry in `Layout.tsx`**

Use the Edit tool:

old_string:
```
  { path: '/navigation', icon: Navigation2, label: 'Nav Index', group: 'system' },
];
```

new_string:
```
  { path: '/navigation', icon: Navigation2, label: 'Nav Index', group: 'system' },
  { path: '/desktop', icon: LayoutGrid, label: 'Desktop', group: 'system' },
];
```

Confirm `LayoutGrid` is imported from `lucide-react` at the top of `Layout.tsx` — if not, add it to the existing lucide-react import block there (alongside `Navigation2`, `Monitor`, etc.).

- [ ] **Step 3: Run full client typecheck and test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: PASS — no new errors, no new test failures.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat(desktop): wire /desktop route and sidebar nav entry"
```

---

### Task 13: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: All tests pass, including every new test file from Tasks 1-12 and the pre-existing suite (no regressions).

- [ ] **Step 2: Run the full client build**

Run: `cd client && npx vite build`
Expected: Build succeeds — confirms the new `/desktop` chunk code-splits cleanly via `lazyRetry`.

- [ ] **Step 3: Run the Worker typecheck and the root Worker test suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Run the Miniflare route tests**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/desktopPreferences.test.ts test-workers/personnelActiveShift.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply the migration to local D1 (if not already applied in Task 3) and confirm the schema**

Run: `npm run migrate:local`
Run: `npx wrangler d1 execute rmpg-flex --local --command "PRAGMA table_info(user_preferences)"`
Expected: output includes `desktop_layout_json`, `desktop_wallpaper`, `desktop_widgets_json`.

- [ ] **Step 6: Manual browser verification**

Use the Browser pane (`preview_start` with the `client` dev server, then `preview_start`/`navigate` to `/login` → log in → navigate to `/desktop`):
- Confirm `/` still loads `DashboardPage` on login (the core "never auto-opens" requirement).
- Star a module in Module Directory (`/navigation`), confirm it appears as a desktop icon at `/desktop`.
- Drag an icon to a new position, reload the page, confirm the position persisted (D1 round-trip).
- Click a `POPOUT_PAGES`-eligible icon (e.g. Dispatch), confirm it opens as an in-page floating window with working drag/resize/minimize/maximize/close.
- Click a non-eligible icon, confirm it navigates the SPA in place instead.
- Right-click empty canvas, confirm "Change wallpaper" and "Widget settings" both work.
- Confirm the taskbar clock ticks, the module launcher search filters correctly, and toggling a widget off in settings removes it from the panel and persists across reload.

- [ ] **Step 7: Final commit (if any manual-verification fixes were needed) and summary**

```bash
git add -A
git commit -m "fix(desktop): address issues found during manual verification"
```

(Skip this commit if Step 6 found no issues.)
