# Nav System — 10 Feature Upgrades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 10 independent feature upgrades to the driving-navigation subsystem (`/navigation` drive HUD, `/nav` trip management), each reusing existing infra (geofencing, `unit_trips` telemetry, the dispatch route optimizer, battery API) rather than duplicating it.

**Architecture:** No new subsystem — each task is a targeted extension of an existing file/table/endpoint. Tasks are grouped by dependency: Task 1 lands the one net-new migration; Tasks 2–10 are independent of each other and can be executed/reviewed in any order after Task 1.

**Tech Stack:** Hono + D1 (Worker), React + TypeScript + Vite (client), Mapbox GL JS, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-08-nav-10-feature-upgrades-design.md`](../specs/2026-07-08-nav-10-feature-upgrades-design.md)

---

## Task 1: `nav_favorites` migration + CRUD route (feature #4)

**Files:**
- Create: `migrations/0181_nav_favorites.sql`
- Create: `src/routes/navFavorites.ts`
- Modify: `src/index.ts` (mount the new route)
- Test: `tests/navFavorites.test.ts`

- [ ] **Step 1: Confirm the real next-free migration number**

`migrations/README.md` says next-free is `0174`, but `ls migrations | sort | tail` shows files through `0180` — the README is stale (a known drift pattern per this repo's CLAUDE.md). Run:

```bash
ls migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort -n | tail -3
```

Use the next integer after the highest result. This plan assumes `0181`; adjust every reference below if the real next-free number differs.

- [ ] **Step 2: Write the migration**

```sql
-- migrations/0181_nav_favorites.sql
CREATE TABLE IF NOT EXISTS nav_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_nav_favorites_user ON nav_favorites(user_id);
```

- [ ] **Step 3: Apply locally**

```bash
npm run migrate:local
```
Expected: no errors; `nav_favorites` table exists in the local D1 shard.

- [ ] **Step 4: Write the route file**

```ts
// src/routes/navFavorites.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const navFavorites = new Hono<Env>();

interface FavoriteRow {
  id: number;
  user_id: number;
  label: string;
  lat: number;
  lng: number;
  address: string | null;
  created_at: string;
}

// GET /nav/favorites — this user's saved destinations, newest first.
navFavorites.get('/', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const rows = await query<FavoriteRow>(db,
    'SELECT * FROM nav_favorites WHERE user_id = ? ORDER BY created_at DESC', userId);
  return c.json(rows);
});

// POST /nav/favorites — save a new favorite.
navFavorites.post('/', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ label: string; lat: number; lng: number; address?: string }>();
  if (!body.label || typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return c.json({ error: 'label, lat, lng are required' }, 400);
  }
  const result = await execute(db,
    'INSERT INTO nav_favorites (user_id, label, lat, lng, address) VALUES (?, ?, ?, ?, ?)',
    userId, body.label, body.lat, body.lng, body.address ?? null);
  return c.json({ success: true, id: result.meta.last_row_id });
});

// DELETE /nav/favorites/:id — remove a favorite (owner only).
navFavorites.delete('/:id', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  if (!id || isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst<{ user_id: number }>(db, 'SELECT user_id FROM nav_favorites WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Not authorized' }, 403);
  await execute(db, 'DELETE FROM nav_favorites WHERE id = ?', id);
  return c.json({ success: true });
});

export default navFavorites;
```

- [ ] **Step 5: Mount the route**

In `src/index.ts`, find the existing `app.route('/api/nav', nav)` mount (or equivalent for `src/routes/nav.ts`) and add immediately after it:

```ts
import navFavorites from './routes/navFavorites';
// ...
app.route('/api/nav/favorites', navFavorites);
```

Ensure this line is placed after the existing `app.use('/api/nav', authMiddleware)` (or equivalent prefix) so favorites requires auth like the rest of `/api/nav/*`. Check `src/index.ts` for the exact existing auth-mount pattern for `/api/nav` before adding.

- [ ] **Step 6: Write the test**

```ts
// tests/navFavorites.test.ts
import { describe, it, expect } from 'vitest';
import navFavorites from '../src/routes/navFavorites';
import { Hono } from 'hono';

function appWithUser(userId: number, db: any) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('userId', userId); c.env = { DB: db }; await next(); });
  app.route('/', navFavorites);
  return app;
}

function fakeDb() {
  const rows: any[] = [];
  let nextId = 1;
  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async all() {
              if (sql.includes('SELECT * FROM nav_favorites')) {
                return { results: rows.filter(r => r.user_id === args[0]) };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes('SELECT user_id FROM nav_favorites')) {
                return rows.find(r => r.id === args[0]) ?? null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT')) {
                const row = { id: nextId++, user_id: args[0], label: args[1], lat: args[2], lng: args[3], address: args[4] };
                rows.push(row);
                return { meta: { last_row_id: row.id } };
              }
              if (sql.startsWith('DELETE')) {
                const idx = rows.findIndex(r => r.id === args[0]);
                if (idx >= 0) rows.splice(idx, 1);
                return { meta: {} };
              }
              return { meta: {} };
            },
          };
        },
      };
    },
  };
}

describe('nav favorites CRUD', () => {
  it('creates, lists, and deletes a favorite scoped to the owning user', async () => {
    const db = fakeDb();
    const app = appWithUser(7, db);

    const createRes = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ label: 'HQ', lat: 40.76, lng: -111.89 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.success).toBe(true);

    const listRes = await app.request('/');
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('HQ');

    const otherUserApp = appWithUser(99, db);
    const forbiddenDelete = await otherUserApp.request(`/${created.id}`, { method: 'DELETE' });
    expect(forbiddenDelete.status).toBe(403);

    const deleteRes = await app.request(`/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
  });
});
```

- [ ] **Step 7: Run the test**

```bash
npx vitest run tests/navFavorites.test.ts
```
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add migrations/0181_nav_favorites.sql src/routes/navFavorites.ts src/index.ts tests/navFavorites.test.ts
git commit -m "feat(nav): add nav_favorites table + CRUD route"
```

- [ ] **Step 9: Apply to live D1 after merge**

Per CLAUDE.md's migration process, after this lands on `main`:
```bash
scripts/apply-migration.sh 0181_nav_favorites.sql
```
Verify with `pragma_table_info('nav_favorites')` via `wrangler d1 execute rmpg-flex --remote --command "SELECT * FROM pragma_table_info('nav_favorites')"`.

---

## Task 2: Favorites UI on `/nav` (feature #4, client half)

**Files:**
- Modify: `client/src/pages/NavPage.tsx`
- Create: `client/src/hooks/useNavFavorites.ts`
- Test: `client/src/hooks/__tests__/useNavFavorites.test.ts`

**Depends on:** Task 1 (server route must exist).

- [ ] **Step 1: Write the hook**

```ts
// client/src/hooks/useNavFavorites.ts
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface NavFavorite {
  id: number;
  user_id: number;
  label: string;
  lat: number;
  lng: number;
  address: string | null;
  created_at: string;
}

export function useNavFavorites() {
  const [favorites, setFavorites] = useState<NavFavorite[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    apiFetch<NavFavorite[]>('/nav/favorites')
      .then(setFavorites)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  const save = useCallback(async (label: string, lat: number, lng: number, address?: string) => {
    await apiFetch('/nav/favorites', { method: 'POST', body: JSON.stringify({ label, lat, lng, address }) });
    reload();
  }, [reload]);

  const remove = useCallback(async (id: number) => {
    await apiFetch(`/nav/favorites/${id}`, { method: 'DELETE' });
    setFavorites(prev => prev.filter(f => f.id !== id));
  }, []);

  return { favorites, loading, save, remove, reload };
}
```

- [ ] **Step 2: Write a test for the hook's optimistic-delete behavior**

```ts
// client/src/hooks/__tests__/useNavFavorites.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNavFavorites } from '../useNavFavorites';
import * as api from '../useApi';

describe('useNavFavorites', () => {
  beforeEach(() => {
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string, opts?: any) => {
      if (path === '/nav/favorites' && (!opts || opts.method === undefined)) {
        return Promise.resolve([{ id: 1, user_id: 7, label: 'HQ', lat: 40.76, lng: -111.89, address: null, created_at: '' }]);
      }
      return Promise.resolve({ success: true });
    });
  });

  it('removes a favorite from local state immediately on delete', async () => {
    const { result } = renderHook(() => useNavFavorites());
    await waitFor(() => expect(result.current.favorites).toHaveLength(1));

    await act(async () => { await result.current.remove(1); });

    expect(result.current.favorites).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
cd client && npx vitest run src/hooks/__tests__/useNavFavorites.test.ts
```
Expected: PASS.

- [ ] **Step 4: Wire into `NavPage.tsx`**

Read `client/src/pages/NavPage.tsx` in full first (1015 lines — confirm current structure hasn't shifted since the design audit). Add a "Favorites" section using the same drawer/section visual pattern as the existing `NavSettingsPanel`/`TripsDrawer` triggers already on the page (look for how those are toggled — likely a button in the page's top toolbar that opens a side panel). Add:
- A star/save icon button next to any dropped pin or active trip's destination that calls `save(label, lat, lng, address)` (prompt or reuse an existing inline-label pattern already on the page for naming a dropped pin).
- A "Favorites" list section showing `favorites`, each row with a "Navigate" action (starts a trip to that lat/lng using the page's existing trip-start flow) and a delete (trash icon) action calling `remove(id)`.

- [ ] **Step 5: Manual verification**

Start the dev server and preview:
```bash
cd client && npm run dev
```
In the browser preview: drop a pin on `/nav`, save it as a favorite, confirm it appears in the Favorites list, confirm delete removes it. Take a screenshot for verification.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useNavFavorites.ts client/src/hooks/__tests__/useNavFavorites.test.ts client/src/pages/NavPage.tsx
git commit -m "feat(nav): saved/favorite destinations on /nav"
```

---

## Task 3: Export `useBattery` + `HudDeviceHealthBadge` (feature #9)

**Files:**
- Modify: `client/src/components/BatteryIndicator.tsx`
- Modify: `client/src/pages/navigation/hud/HudInstruments.tsx`
- Modify: `client/src/pages/NavigationPage.tsx`
- Test: `client/src/pages/navigation/hud/__tests__/HudDeviceHealthBadge.test.tsx`

- [ ] **Step 1: Export the existing battery hook**

In `client/src/components/BatteryIndicator.tsx`, change:
```ts
function useBattery(): BatteryState {
```
to:
```ts
export function useBattery(): BatteryState {
```
Also export the `BatteryState` interface (already defined in that file) by adding `export` to its declaration.

- [ ] **Step 2: Write the failing test for the badge**

```tsx
// client/src/pages/navigation/hud/__tests__/HudDeviceHealthBadge.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudDeviceHealthBadge } from '../HudInstruments';

describe('HudDeviceHealthBadge', () => {
  it('renders nothing when battery and GPS are healthy', () => {
    const { container } = render(
      <HudDeviceHealthBadge batteryLevel={80} batteryCharging={false} gpsAccuracy={20} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a low-battery warning below 20% unplugged', () => {
    render(<HudDeviceHealthBadge batteryLevel={15} batteryCharging={false} gpsAccuracy={20} />);
    expect(screen.getByText(/battery/i)).toBeInTheDocument();
  });

  it('does not warn on low battery while charging', () => {
    const { container } = render(
      <HudDeviceHealthBadge batteryLevel={15} batteryCharging={true} gpsAccuracy={20} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a GPS-degraded warning above the accuracy threshold', () => {
    render(<HudDeviceHealthBadge batteryLevel={80} batteryCharging={false} gpsAccuracy={600} />);
    expect(screen.getByText(/gps/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/navigation/hud/__tests__/HudDeviceHealthBadge.test.tsx
```
Expected: FAIL — `HudDeviceHealthBadge` is not exported from `HudInstruments.tsx`.

- [ ] **Step 4: Implement the badge**

Add to `client/src/pages/navigation/hud/HudInstruments.tsx` (near `HudParkedBadge`, following its "hidden unless there's something to say" pattern):

```tsx
const GPS_DEGRADED_M = 500;
const BATTERY_LOW_PCT = 20;

export function HudDeviceHealthBadge({
  batteryLevel, batteryCharging, gpsAccuracy,
}: { batteryLevel: number | null; batteryCharging: boolean; gpsAccuracy: number | null }) {
  const lowBattery = batteryLevel != null && batteryLevel < BATTERY_LOW_PCT && !batteryCharging;
  const gpsDegraded = gpsAccuracy != null && gpsAccuracy > GPS_DEGRADED_M;
  if (!lowBattery && !gpsDegraded) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {lowBattery && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide"
          style={{ color: '#ef4444', background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', borderRadius: 2 }}>
          Low battery {batteryLevel}%
        </div>
      )}
      {gpsDegraded && (
        <div className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide"
          style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid #f59e0b', borderRadius: 2 }}>
          GPS degraded ±{Math.round(gpsAccuracy!)}m
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/navigation/hud/__tests__/HudDeviceHealthBadge.test.tsx
```
Expected: PASS (4 tests).

- [ ] **Step 6: Wire into `NavigationPage.tsx`**

Import `useBattery` from `../components/BatteryIndicator` and `HudDeviceHealthBadge` from `./navigation/hud/HudInstruments` (both already partially imported in this file — add to existing import statements, don't duplicate). Call `const battery = useBattery();` near the page's other hook calls, and render `<HudDeviceHealthBadge batteryLevel={battery.supported ? battery.level : null} batteryCharging={battery.charging} gpsAccuracy={accuracy} />` in the HUD instrument cluster (`accuracy` already comes from `useGpsTracking`'s state — reuse the existing variable, don't refetch).

- [ ] **Step 7: Manual verification**

```bash
cd client && npm run dev
```
Open `/navigation` in the browser preview, confirm no badge renders under normal conditions (battery API may report `supported: false` on desktop — verify the badge stays absent in that case too, since `batteryLevel` would be `null`).

- [ ] **Step 8: Commit**

```bash
git add client/src/components/BatteryIndicator.tsx client/src/pages/navigation/hud/HudInstruments.tsx client/src/pages/NavigationPage.tsx client/src/pages/navigation/hud/__tests__/HudDeviceHealthBadge.test.tsx
git commit -m "feat(nav): device health warnings (battery + GPS) on drive HUD"
```

---

## Task 4: Configurable over-speed alerts (feature #3)

**Files:**
- Modify: `client/src/pages/navigation/NavSettingsPanel.tsx`
- Modify: `client/src/pages/navigation/hud/HudInstruments.tsx`
- Modify: `client/src/pages/NavigationPage.tsx`
- Test: `client/src/pages/navigation/hud/__tests__/overSpeedLogic.test.ts`

- [ ] **Step 1: Add the pure threshold/cooldown logic as a testable function**

Add to `client/src/pages/navigation/hud/useSpeedLimit.ts` (same file that already computes `limitMph`):

```ts
export const OVER_SPEED_COOLDOWN_MS = 60000;

/** Whether an over-speed alert should fire now, given the last time one fired.
 *  Pure function so it's cheaply testable without mocking timers/hooks. */
export function shouldFireOverSpeedAlert(
  speedMph: number,
  limitMph: number | null,
  thresholdMph: number,
  lastFiredAt: number | null,
  nowMs: number,
): boolean {
  if (limitMph == null) return false;
  if (speedMph < limitMph + thresholdMph) return false;
  if (lastFiredAt != null && nowMs - lastFiredAt < OVER_SPEED_COOLDOWN_MS) return false;
  return true;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// client/src/pages/navigation/hud/__tests__/overSpeedLogic.test.ts
import { describe, it, expect } from 'vitest';
import { shouldFireOverSpeedAlert, OVER_SPEED_COOLDOWN_MS } from '../useSpeedLimit';

describe('shouldFireOverSpeedAlert', () => {
  it('does not fire when speed is under the limit + threshold', () => {
    expect(shouldFireOverSpeedAlert(40, 35, 10, null, 0)).toBe(false);
  });

  it('fires when speed exceeds limit + threshold and no prior alert', () => {
    expect(shouldFireOverSpeedAlert(50, 35, 10, null, 0)).toBe(true);
  });

  it('does not fire again inside the cooldown window', () => {
    expect(shouldFireOverSpeedAlert(50, 35, 10, 1000, 1000 + OVER_SPEED_COOLDOWN_MS - 1)).toBe(false);
  });

  it('fires again once the cooldown has elapsed', () => {
    expect(shouldFireOverSpeedAlert(50, 35, 10, 1000, 1000 + OVER_SPEED_COOLDOWN_MS + 1)).toBe(true);
  });

  it('never fires when the posted limit is unknown', () => {
    expect(shouldFireOverSpeedAlert(90, null, 10, null, 0)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/navigation/hud/__tests__/overSpeedLogic.test.ts
```
Expected: FAIL — `shouldFireOverSpeedAlert` not exported.

- [ ] **Step 4: Implement (already written in Step 1) and confirm it passes**

```bash
cd client && npx vitest run src/pages/navigation/hud/__tests__/overSpeedLogic.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Add the threshold setting to `NavPrefs`**

In `client/src/pages/navigation/NavSettingsPanel.tsx`, add to the `NavPrefs` interface:
```ts
overSpeedThresholdMph: number; // 0 disables the alert
```
Add to `DEFAULT_NAV_PREFS`:
```ts
overSpeedThresholdMph: 10,
```
Add a `<Slider label="Over-speed alert (mph over limit)" value={prefs.overSpeedThresholdMph} onChange={(v) => setPref('overSpeedThresholdMph', v)} min={0} max={30} />` control next to the existing `Brightness` slider (check the `Slider` component's actual prop names in this file before matching — it's already used twice in this file).

- [ ] **Step 6: Add `HudOverSpeedBanner`**

In `HudInstruments.tsx`, near `HudArrivedBanner`:
```tsx
export function HudOverSpeedBanner({ limitMph }: { limitMph: number }) {
  return (
    <div className="flex items-center justify-center gap-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide animate-pulse"
      style={{ color: '#fff', background: '#ef4444', borderRadius: 2 }}>
      Over limit — posted {limitMph} mph
    </div>
  );
}
```

- [ ] **Step 7: Wire into `NavigationPage.tsx`**

Add local state `const [lastOverSpeedAt, setLastOverSpeedAt] = useState<number | null>(null);` near the page's other speed-related state. In the render-tick effect that already reads live speed (find the existing speed-derivation logic — it computes the value fed to `HudSpeedGauge`), call `shouldFireOverSpeedAlert(speedMph, limitMph, prefs.overSpeedThresholdMph, lastOverSpeedAt, Date.now())`; when true, call `setLastOverSpeedAt(Date.now())`, optionally `playNavTone(...)` (reuse the existing tone player already imported in this file), and set a boolean to render `<HudOverSpeedBanner limitMph={limitMph} />`.

- [ ] **Step 8: Manual verification**

```bash
cd client && npm run dev
```
Open `/navigation`, open settings, confirm the new slider persists via `NavSettingsPanel`'s existing save mechanism (localStorage key `rmpg_nav_prefs`).

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/navigation/hud/useSpeedLimit.ts client/src/pages/navigation/NavSettingsPanel.tsx client/src/pages/navigation/hud/HudInstruments.tsx client/src/pages/NavigationPage.tsx client/src/pages/navigation/hud/__tests__/overSpeedLogic.test.ts
git commit -m "feat(nav): configurable over-speed alert threshold"
```

---

## Task 5: Always-on district/beat boundary overlay toggle (feature #8)

**Files:**
- Modify: `client/src/pages/NavigationPage.tsx`
- Modify: `client/src/pages/navigation/hud/HudInstruments.tsx`

- [ ] **Step 1: Read the existing district layer setup on the main map**

Find where the main dispatch map (not this file) adds the `getTaggedBeats()` layer — search for its usage:
```bash
grep -rn "getTaggedBeats" client/src/pages/map
```
Note the exact `map.addSource`/`map.addLayer` call shape (fill color expression via `getZoneColor`/`getSectorColor`) so `NavigationPage.tsx` mirrors it exactly rather than reinventing styling.

- [ ] **Step 2: Add the layer to `NavigationPage.tsx`'s map, default hidden**

In the map's `style.load` handler (already present in this file per the earlier audit — search for `whenStyleReady`), add:
```ts
import { getTaggedBeats } from './map/utils/districtGeoData';
// ...
getTaggedBeats().then((beats) => {
  if (!map.current) return;
  if (!map.current.getSource('nav-district-src')) {
    map.current.addSource('nav-district-src', { type: 'geojson', data: beats });
    map.current.addLayer({
      id: 'nav-district-layer',
      type: 'fill',
      source: 'nav-district-src',
      paint: { 'fill-color': ['get', 'zone_color'], 'fill-opacity': 0.12 },
      layout: { visibility: 'none' },
    });
    map.current.addLayer({
      id: 'nav-district-line',
      type: 'line',
      source: 'nav-district-src',
      paint: { 'line-color': ['get', 'zone_color'], 'line-width': 1 },
      layout: { visibility: 'none' },
    });
  }
});
```
Adjust `zone_color` to whatever property name the Step 1 grep confirms `getTaggedBeats()` bakes onto each feature (the design spec references `getZoneColor`/`getSectorColor` — confirm exact property naming from the source file, `pages/map/utils/districtGeoData.ts`, rather than guessing).

- [ ] **Step 3: Add a toggle to `HudMapControls`**

`HudMapControls` in `HudInstruments.tsx` already renders a cluster of map toggle buttons (per the earlier audit) — read its current prop signature and add a new `showDistricts`/`onToggleDistricts` prop pair following the exact same pattern as its existing toggles (e.g. satellite/dark style toggle).

- [ ] **Step 4: Wire the toggle to layer visibility**

In `NavigationPage.tsx`, add `const [showDistricts, setShowDistricts] = useState(false);` and an effect:
```ts
useEffect(() => {
  if (!map.current) return;
  const vis = showDistricts ? 'visible' : 'none';
  if (map.current.getLayer('nav-district-layer')) map.current.setLayoutProperty('nav-district-layer', 'visibility', vis);
  if (map.current.getLayer('nav-district-line')) map.current.setLayoutProperty('nav-district-line', 'visibility', vis);
}, [showDistricts]);
```

- [ ] **Step 5: Manual verification**

```bash
cd client && npm run dev
```
Open `/navigation`, toggle districts on, confirm beat boundaries render over the drive map without a frame-rate drop (watch for stutter on pan/zoom — if present, reduce `fill-opacity` or drop the fill layer and keep only the outline).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/NavigationPage.tsx client/src/pages/navigation/hud/HudInstruments.tsx
git commit -m "feat(nav): toggleable district/beat overlay on drive HUD"
```

---

## Task 6: Station geofence auto pause/resume (feature #10)

**Files:**
- Modify: `client/src/context/NavTripContext.tsx`
- Modify: `src/routes/nav.ts`
- Test: `client/src/context/__tests__/stationPauseLogic.test.ts`

- [ ] **Step 1: Confirm the admin UI supports `zone_type` tagging**

```bash
grep -rn "zone_type" client/src --include="*.tsx" | grep -i geofence
```
If an admin geofence-zone editor exists and already has a `zone_type` select, confirm `'station'` can be entered (the DB CHECK constraint currently allows `'exclusion','inclusion','alert','patrol_required'` only — a `'station'` value needs the CHECK constraint widened via a new migration, or reuse `'inclusion'` with a `description` convention like `"STATION:"` prefix if changing the CHECK is out of scope for this task). Pick the CHECK-constraint-widening approach for correctness (a fifth valid value, not a naming hack):

```sql
-- migrations/0182_geofence_zone_type_station.sql
-- SQLite can't ALTER a CHECK constraint in place; the boot reconciler pattern
-- (see CLAUDE.md) tolerates a missing constraint update — this migration only
-- documents the new allowed value for zones created going forward. No DDL
-- change is required if new rows simply insert 'station' and existing rows
-- are untouched, UNLESS the live table's CHECK constraint actually rejects
-- unlisted values (SQLite enforces CHECK on INSERT). Verify by testing an
-- insert against local D1 before assuming this migration is unnecessary.
```
Run against local D1 first: `INSERT INTO geofence_zones (zone_name, zone_type, geojson_data) VALUES ('test', 'station', '{}');` via `wrangler d1 execute --local`. If it fails with a CHECK violation, write a real migration that recreates the table with the widened CHECK (SQLite table-recreate pattern — copy data, drop, recreate, reinsert) rather than the placeholder comment above.

- [ ] **Step 2: Write the pure pause/resume decision logic**

```ts
// client/src/context/stationPauseLogic.ts
export interface GeofenceAlertPayload {
  unitId: number;
  zoneId: number;
  zoneType: string;
  eventType: 'enter' | 'exit' | 'transfer';
}

/** Whether a geofence_alert event should pause or resume active trip tracking. */
export function stationPauseAction(payload: GeofenceAlertPayload): 'pause' | 'resume' | null {
  if (payload.zoneType !== 'station') return null;
  if (payload.eventType === 'enter') return 'pause';
  if (payload.eventType === 'exit') return 'resume';
  return null;
}
```

- [ ] **Step 3: Write the failing test**

```ts
// client/src/context/__tests__/stationPauseLogic.test.ts
import { describe, it, expect } from 'vitest';
import { stationPauseAction } from '../stationPauseLogic';

describe('stationPauseAction', () => {
  it('pauses on entering a station zone', () => {
    expect(stationPauseAction({ unitId: 1, zoneId: 5, zoneType: 'station', eventType: 'enter' })).toBe('pause');
  });
  it('resumes on exiting a station zone', () => {
    expect(stationPauseAction({ unitId: 1, zoneId: 5, zoneType: 'station', eventType: 'exit' })).toBe('resume');
  });
  it('ignores non-station zones', () => {
    expect(stationPauseAction({ unitId: 1, zoneId: 5, zoneType: 'exclusion', eventType: 'enter' })).toBe(null);
  });
  it('ignores transfer events', () => {
    expect(stationPauseAction({ unitId: 1, zoneId: 5, zoneType: 'station', eventType: 'transfer' })).toBe(null);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd client && npx vitest run src/context/__tests__/stationPauseLogic.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Add a pause endpoint to `src/routes/nav.ts`**

Near the existing `PUT /trip/:id/update` handler, add:
```ts
// PUT /nav/trip/:id/pause — freeze distance/duration accrual (station geofence).
nav.put('/trip/:id/pause', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const tripId = Number(c.req.param('id'));
  if (!tripId || isNaN(tripId)) return c.json({ error: 'Invalid trip id' }, 400);
  const trip = await queryFirst<{ officer_id: number; status: string }>(db,
    'SELECT officer_id, status FROM nav_trip_log WHERE id = ?', tripId);
  if (!trip) return c.json({ error: 'Trip not found' }, 404);
  if (trip.officer_id !== userId) return c.json({ error: 'Not authorized' }, 403);
  await execute(db, `UPDATE nav_trip_log SET status = 'paused', updated_at = datetime('now','localtime') WHERE id = ?`, tripId);
  return c.json({ success: true });
});

// PUT /nav/trip/:id/resume — resume accrual after a station pause.
nav.put('/trip/:id/resume', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const tripId = Number(c.req.param('id'));
  if (!tripId || isNaN(tripId)) return c.json({ error: 'Invalid trip id' }, 400);
  const trip = await queryFirst<{ officer_id: number; status: string }>(db,
    'SELECT officer_id, status FROM nav_trip_log WHERE id = ?', tripId);
  if (!trip) return c.json({ error: 'Trip not found' }, 404);
  if (trip.officer_id !== userId) return c.json({ error: 'Not authorized' }, 403);
  if (trip.status !== 'paused') return c.json({ error: `Trip is ${trip.status}, not paused` }, 400);
  await execute(db, `UPDATE nav_trip_log SET status = 'active', updated_at = datetime('now','localtime') WHERE id = ?`, tripId);
  return c.json({ success: true });
});
```
Confirm `status` elsewhere in `nav.ts` is treated as a free-form TEXT column (not a CHECK-constrained enum) before adding `'paused'` as a new value — grep `CREATE TABLE.*nav_trip_log` in `migrations/0064_nav_trip_log.sql` to check for a CHECK constraint; if one exists and excludes `'paused'`, this needs its own migration following the same table-recreate pattern noted in Step 1.

- [ ] **Step 6: Wire into `NavTripContext.tsx`**

Find the existing websocket subscription in `WebSocketContext.tsx` (or wherever `geofence_alert` is currently consumed, if anywhere) — if nothing currently subscribes to it client-side, add a subscription inside `NavTripProvider` (in `NavTripContext.tsx`):
```ts
useEffect(() => {
  const handler = (payload: GeofenceAlertPayload) => {
    const action = stationPauseAction(payload);
    if (!action || !detection.activeTripId) return;
    apiFetch(`/nav/trip/${detection.activeTripId}/${action}`, { method: 'PUT' }).catch(console.error);
  };
  // subscribe via the app's existing websocket event bus — match its exact
  // subscribe/unsubscribe API (check WebSocketContext.tsx for the pattern
  // used elsewhere, e.g. for 'geofence:alert' or similar dispatch events).
}, [detection.activeTripId]);
```
Read `client/src/context/WebSocketContext.tsx` in full before finishing this step — it's referenced in the design audit as already carrying `'geofence_alert'`/`'geofence:alert'` event types, so match its real subscribe API exactly rather than guessing.

- [ ] **Step 7: Manual verification**

Not testable live without a real GPS-based zone crossing. Instead, verify by triggering the websocket event manually in the browser console during a dev session (`window.dispatchEvent` or whatever the real bus uses) and confirming the trip's status flips to `paused`/`active` via a `GET /nav/trip/current` check in the network tab.

- [ ] **Step 8: Commit**

```bash
git add client/src/context/NavTripContext.tsx client/src/context/stationPauseLogic.ts client/src/context/__tests__/stationPauseLogic.test.ts src/routes/nav.ts
git commit -m "feat(nav): auto pause/resume trip tracking at station geofence"
```

---

## Task 7: Trip replay (feature #7)

**Files:**
- Modify: `client/src/pages/navigation/MovementReportDrawer.tsx`
- Create: `client/src/pages/navigation/tripReplay.ts`
- Test: `client/src/pages/navigation/__tests__/tripReplay.test.ts`

- [ ] **Step 1: Write the pure replay-step logic**

```ts
// client/src/pages/navigation/tripReplay.ts
export interface ReplayPoint {
  lat: number;
  lng: number;
  time: string; // ISO
  speed: number | null;
  heading: number | null;
}

/** Given elapsed playback ms and a speed multiplier, find which point index
 *  the replay should currently be showing (points are chronological). */
export function replayIndexAt(points: ReplayPoint[], elapsedMs: number, speedMultiplier: number): number {
  if (points.length === 0) return 0;
  const startMs = new Date(points[0].time).getTime();
  const targetMs = startMs + elapsedMs * speedMultiplier;
  let idx = 0;
  for (let i = 0; i < points.length; i++) {
    if (new Date(points[i].time).getTime() <= targetMs) idx = i;
    else break;
  }
  return idx;
}

export function replayDurationMs(points: ReplayPoint[]): number {
  if (points.length < 2) return 0;
  return new Date(points[points.length - 1].time).getTime() - new Date(points[0].time).getTime();
}
```

- [ ] **Step 2: Write the failing test**

```ts
// client/src/pages/navigation/__tests__/tripReplay.test.ts
import { describe, it, expect } from 'vitest';
import { replayIndexAt, replayDurationMs, type ReplayPoint } from '../tripReplay';

const points: ReplayPoint[] = [
  { lat: 40.76, lng: -111.89, time: '2026-07-08T10:00:00Z', speed: 0, heading: 0 },
  { lat: 40.761, lng: -111.891, time: '2026-07-08T10:00:10Z', speed: 20, heading: 90 },
  { lat: 40.762, lng: -111.892, time: '2026-07-08T10:00:20Z', speed: 25, heading: 90 },
];

describe('replayIndexAt', () => {
  it('returns index 0 at elapsed 0', () => {
    expect(replayIndexAt(points, 0, 1)).toBe(0);
  });
  it('advances to the matching point at real-time speed', () => {
    expect(replayIndexAt(points, 10000, 1)).toBe(1);
  });
  it('advances faster under a speed multiplier', () => {
    expect(replayIndexAt(points, 5000, 2)).toBe(1);
  });
  it('clamps at the last point past the end', () => {
    expect(replayIndexAt(points, 999999, 1)).toBe(2);
  });
  it('returns 0 for an empty point list', () => {
    expect(replayIndexAt([], 5000, 1)).toBe(0);
  });
});

describe('replayDurationMs', () => {
  it('computes total elapsed time across the points', () => {
    expect(replayDurationMs(points)).toBe(20000);
  });
  it('returns 0 for fewer than 2 points', () => {
    expect(replayDurationMs([points[0]])).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd client && npx vitest run src/pages/navigation/__tests__/tripReplay.test.ts
```
Expected: FAIL — module doesn't exist yet (write Step 1's file first, then this step is really "verify PASS" — reorder in practice: create `tripReplay.ts` from Step 1, then run the test once to confirm PASS, since the logic was written inline above).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/navigation/__tests__/tripReplay.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 5: Add replay controls to `MovementReportDrawer.tsx`**

Read the file in full first (248 lines per the earlier audit) to find where `TripDetail.points`/`FixPoint[]` is currently rendered statically. Add local state:
```ts
const [playing, setPlaying] = useState(false);
const [elapsedMs, setElapsedMs] = useState(0);
const [speedMultiplier, setSpeedMultiplier] = useState(4);
const rafRef = useRef<number | null>(null);
const lastFrameRef = useRef<number | null>(null);

useEffect(() => {
  if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
  const tick = (now: number) => {
    if (lastFrameRef.current != null) {
      setElapsedMs((prev) => {
        const next = prev + (now - lastFrameRef.current!);
        const duration = replayDurationMs(points);
        if (next >= duration) { setPlaying(false); return duration; }
        return next;
      });
    }
    lastFrameRef.current = now;
    rafRef.current = requestAnimationFrame(tick);
  };
  rafRef.current = requestAnimationFrame(tick);
  return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastFrameRef.current = null; };
}, [playing, points]);

const replayIdx = replayIndexAt(points, elapsedMs, speedMultiplier);
```
Render a play/pause button, a scrub `<input type="range">` bound to `elapsedMs`/`replayDurationMs(points)`, a speed-multiplier select (1x/2x/4x/8x), and move the existing position marker on the map (if `MovementReportDrawer` already renders a map — confirm during this step; if it currently only shows tabular/chart data with no map, add a small Mapbox instance using the new `useNavMapInstance` hook from the separate consolidation plan if that's landed by this point, otherwise a minimal inline `new mapboxgl.Map(...)` scoped to this drawer) to `points[replayIdx]`.

- [ ] **Step 6: Manual verification**

```bash
cd client && npm run dev
```
Open `/navigation`, open TripsDrawer, select a completed trip, open its movement report, press play, confirm the scrub position advances and the marker (if a map is present) moves along the route.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/navigation/tripReplay.ts client/src/pages/navigation/__tests__/tripReplay.test.ts client/src/pages/navigation/MovementReportDrawer.tsx
git commit -m "feat(nav): trip replay playback in movement report"
```

---

## Task 8: Driving score trend endpoint + view (feature #6)

**Files:**
- Modify: `src/routes/dispatch/trips.ts`
- Create: `client/src/pages/navigation/drivingScore.ts`
- Modify: `client/src/pages/NavPage.tsx`
- Test: `client/src/pages/navigation/__tests__/drivingScore.test.ts`

- [ ] **Step 1: Write the pure scoring function (mirrors `HudDrivingScore`'s color thresholds)**

```ts
// client/src/pages/navigation/drivingScore.ts
export interface HarshCounts {
  harsh_accel_count: number;
  harsh_brake_count: number;
  harsh_corner_count: number;
}

/** 100 minus a per-event penalty, floored at 0. Matches HudInstruments.tsx's
 *  HudDrivingScore color thresholds: 0-1 events = good, 2-5 = caution, 6+ = bad. */
export function tripDrivingScore(counts: HarshCounts): number {
  const total = counts.harsh_accel_count + counts.harsh_brake_count + counts.harsh_corner_count;
  return Math.max(0, 100 - total * 8);
}
```

- [ ] **Step 2: Write the failing test**

```ts
// client/src/pages/navigation/__tests__/drivingScore.test.ts
import { describe, it, expect } from 'vitest';
import { tripDrivingScore } from '../drivingScore';

describe('tripDrivingScore', () => {
  it('scores 100 for a clean trip', () => {
    expect(tripDrivingScore({ harsh_accel_count: 0, harsh_brake_count: 0, harsh_corner_count: 0 })).toBe(100);
  });
  it('deducts per harsh event across all three categories', () => {
    expect(tripDrivingScore({ harsh_accel_count: 1, harsh_brake_count: 1, harsh_corner_count: 1 })).toBe(76);
  });
  it('floors at 0 for very harsh trips', () => {
    expect(tripDrivingScore({ harsh_accel_count: 10, harsh_brake_count: 10, harsh_corner_count: 10 })).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd client && npx vitest run src/pages/navigation/__tests__/drivingScore.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 4: Add a trend endpoint to `src/routes/dispatch/trips.ts`**

Near the existing `GET /trips` handler, add:
```ts
// GET /trips/score-trend?unit_id=&officer_id=&limit=20 — recent trips' harsh-event
// counts for a driving-score trend chart. Read-only, no new scoring persisted.
trips.get('/score-trend', async (c) => {
  const db = getDb(c.env);
  const unitId = c.req.query('unit_id');
  const officerId = c.req.query('officer_id');
  const limit = Math.min(Number(c.req.query('limit')) || 20, 100);
  if (!unitId && !officerId) return c.json({ error: 'unit_id or officer_id is required' }, 400);
  const where: string[] = ["status = 'closed'"];
  const params: (string | number)[] = [];
  if (unitId) { where.push('unit_id = ?'); params.push(unitId); }
  if (officerId) { where.push('officer_id = ?'); params.push(officerId); }
  const rows = await query<{ id: number; start_time: string; harsh_accel_count: number; harsh_brake_count: number; harsh_corner_count: number }>(
    db,
    `SELECT id, start_time, harsh_accel_count, harsh_brake_count, harsh_corner_count
     FROM unit_trips WHERE ${where.join(' AND ')} ORDER BY start_time DESC LIMIT ?`,
    ...params, limit);
  return c.json(rows);
});
```
Read `src/routes/dispatch/trips.ts` in full first to match its existing `query`/`queryFirst` import style and error-handling wrapper pattern exactly (the existing handlers in this file use a specific try/catch shape — mirror it rather than introducing a new one).

- [ ] **Step 5: Build the trend view in `NavPage.tsx`**

Add a "Driving Score" section (drawer or inline panel, matching the page's existing section pattern) that fetches `/dispatch/trips/score-trend?unit_id=...` (or `officer_id`, whichever this officer's context provides — check how `NavPage.tsx` currently resolves the active unit/officer for its other calls), maps each row through `tripDrivingScore()`, and renders a line chart (oldest to newest, left to right) using this repo's `dataviz` skill conventions for chart styling — invoke the `dataviz` skill before writing the chart JSX to confirm current color/axis conventions rather than assuming.

- [ ] **Step 6: Manual verification**

```bash
cd client && npm run dev
```
Open `/nav`, open the new Driving Score section, confirm it renders a trend line for a unit/officer with trip history (seed test data locally if none exists).

- [ ] **Step 7: Commit**

```bash
git add src/routes/dispatch/trips.ts client/src/pages/navigation/drivingScore.ts client/src/pages/navigation/__tests__/drivingScore.test.ts client/src/pages/NavPage.tsx
git commit -m "feat(nav): driving score trend view backed by existing unit_trips telemetry"
```

---

## Task 9: Exclusion-zone-aware routing (feature #5)

**Files:**
- Modify: `src/routes/mapbox.ts` (or wherever the Directions proxy request is actually built — confirm exact file via Step 1)
- Test: `tests/navExclusionZones.test.ts`

- [ ] **Step 1: Locate the exact Directions-request-building code**

```bash
grep -n "directions\|Directions" src/routes/mapbox.ts | head -20
```
Confirm whether `src/routes/mapbox.ts` or `src/routes/dispatch/routing.ts` is the file that actually issues the outbound Mapbox Directions API call consumed by live turn-by-turn on `/navigation` (the design audit referenced "the Mapbox proxy work from #2681" — find that PR's changed files if grep is ambiguous: `git show 7ba27acef2 --stat`).

- [ ] **Step 2: Write the pure exclusion-check logic**

```ts
// src/utils/navExclusionZones.ts
export interface ExclusionZone {
  id: number;
  geojsonData: string; // raw geojson_data column value
}

export interface LngLat { lng: number; lat: number; }

/** Ray-cast point-in-polygon test. Mirrors the existing server geofence
 *  ray-cast in src/utils/geofence.ts — reuse that implementation if it
 *  exports a standalone pointInPolygon helper rather than duplicating the
 *  algorithm here (check before writing this from scratch). */
export function routeCrossesExclusionZone(routeCoords: LngLat[], zones: ExclusionZone[]): boolean {
  for (const zone of zones) {
    let polygon: number[][];
    try {
      const parsed = JSON.parse(zone.geojsonData);
      polygon = parsed.type === 'Polygon' ? parsed.coordinates[0] : parsed.geometry?.coordinates?.[0];
    } catch { continue; }
    if (!polygon) continue;
    for (const point of routeCoords) {
      if (pointInPolygon(point, polygon)) return true;
    }
  }
  return false;
}

function pointInPolygon(point: LngLat, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > point.lat) !== (yj > point.lat))
      && (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
```
Before finalizing, run `grep -n "pointInPolygon\|rayCast" src/utils/geofence.ts` — if an equivalent already exists there, import and reuse it instead of the local `pointInPolygon` above (this task's whole premise is not re-duplicating existing logic; the earlier consolidation spec's #2 dead-code finding is exactly this mistake).

- [ ] **Step 3: Write the failing test**

```ts
// tests/navExclusionZones.test.ts
import { describe, it, expect } from 'vitest';
import { routeCrossesExclusionZone } from '../src/utils/navExclusionZones';

const squareZone = {
  id: 1,
  geojsonData: JSON.stringify({
    type: 'Polygon',
    coordinates: [[[-111.90, 40.75], [-111.88, 40.75], [-111.88, 40.77], [-111.90, 40.77], [-111.90, 40.75]]],
  }),
};

describe('routeCrossesExclusionZone', () => {
  it('detects a route point inside the exclusion polygon', () => {
    const route = [{ lng: -111.89, lat: 40.76 }];
    expect(routeCrossesExclusionZone(route, [squareZone])).toBe(true);
  });
  it('returns false when no route point falls inside any zone', () => {
    const route = [{ lng: -111.80, lat: 40.60 }];
    expect(routeCrossesExclusionZone(route, [squareZone])).toBe(false);
  });
  it('returns false with no zones', () => {
    const route = [{ lng: -111.89, lat: 40.76 }];
    expect(routeCrossesExclusionZone(route, [])).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/navExclusionZones.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into the Directions proxy**

In the file identified by Step 1, before returning a route to the client: fetch active exclusion zones (`SELECT id, geojson_data FROM geofence_zones WHERE is_active = 1 AND zone_type = 'exclusion'`), decode the returned route's polyline/geometry into `LngLat[]` (Mapbox Directions responses include `geometry.coordinates` when `geometries=geojson` is requested — confirm the existing request already asks for that format, or add it), call `routeCrossesExclusionZone`, and if true, append `{ excludedZoneWarning: true }` to the JSON response (client-side rendering of that flag is out of scope for this task per the design spec — "no client change needed beyond surfacing... in the guidance summary" is a nice-to-have, not required for this task to be complete; the routing decision/flag is the actual deliverable).

- [ ] **Step 6: Manual verification**

Create a test exclusion zone via the existing geofence admin UI covering a small area on a route you can request locally; confirm the proxy response includes `excludedZoneWarning: true` when routing through it (check via browser network tab or a manual `curl` against the local Worker dev server).

- [ ] **Step 7: Commit**

```bash
git add src/utils/navExclusionZones.ts tests/navExclusionZones.test.ts src/routes/mapbox.ts
git commit -m "feat(nav): flag routes crossing an active exclusion geofence zone"
```

---

## Task 10: Multi-stop routing (feature #1)

**Files:**
- Modify: `client/src/hooks/useNavGuidanceEngine.ts`
- Modify: `client/src/context/NavTripContext.tsx`
- Modify: `client/src/pages/NavigationPage.tsx`
- Test: `client/src/hooks/__tests__/waypointAdvance.test.ts`

**Do this task last** — it's the highest-risk change (central guidance engine), per the spec's build-order guidance.

- [ ] **Step 1: Read the full existing engine first**

```bash
wc -l client/src/hooks/useNavGuidanceEngine.ts
```
Read it in full (not partial) before editing — this plan cannot safely predict every internal detail of the arrival-detection radius/reroute logic already in place, and Task 10 must extend it without breaking the existing single-destination path (the majority of trips will never use waypoints).

- [ ] **Step 2: Write the pure leg-advance logic**

```ts
// client/src/hooks/waypointAdvance.ts
export interface NavWaypoint {
  id: number | string;
  lat: number;
  lng: number;
  label: string;
  completed: boolean;
}

const ARRIVAL_RADIUS_M = 60; // match the engine's existing single-destination arrival radius — confirm exact value in useNavGuidanceEngine.ts and use the same constant rather than a new one

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Index of the next incomplete waypoint, or null if all are done. */
export function nextWaypointIndex(waypoints: NavWaypoint[]): number | null {
  const idx = waypoints.findIndex(w => !w.completed);
  return idx === -1 ? null : idx;
}

/** Whether the current position has arrived at the active waypoint. */
export function hasArrivedAtWaypoint(waypoints: NavWaypoint[], lat: number, lng: number): boolean {
  const idx = nextWaypointIndex(waypoints);
  if (idx === null) return false;
  return haversineMeters(lat, lng, waypoints[idx].lat, waypoints[idx].lng) <= ARRIVAL_RADIUS_M;
}

/** Mark the active waypoint completed, returning a new array (immutable). */
export function advanceWaypoint(waypoints: NavWaypoint[]): NavWaypoint[] {
  const idx = nextWaypointIndex(waypoints);
  if (idx === null) return waypoints;
  return waypoints.map((w, i) => (i === idx ? { ...w, completed: true } : w));
}
```

- [ ] **Step 3: Write the failing test**

```ts
// client/src/hooks/__tests__/waypointAdvance.test.ts
import { describe, it, expect } from 'vitest';
import { nextWaypointIndex, hasArrivedAtWaypoint, advanceWaypoint, type NavWaypoint } from '../waypointAdvance';

const waypoints: NavWaypoint[] = [
  { id: 1, lat: 40.76, lng: -111.89, label: 'Stop 1', completed: false },
  { id: 2, lat: 40.77, lng: -111.90, label: 'Stop 2', completed: false },
];

describe('waypoint advance logic', () => {
  it('returns the first incomplete waypoint index', () => {
    expect(nextWaypointIndex(waypoints)).toBe(0);
  });
  it('returns null when all waypoints are completed', () => {
    const done = waypoints.map(w => ({ ...w, completed: true }));
    expect(nextWaypointIndex(done)).toBe(null);
  });
  it('detects arrival within the radius', () => {
    expect(hasArrivedAtWaypoint(waypoints, 40.76, -111.89)).toBe(true);
  });
  it('does not detect arrival when far away', () => {
    expect(hasArrivedAtWaypoint(waypoints, 41.0, -112.0)).toBe(false);
  });
  it('advances to the next waypoint immutably', () => {
    const advanced = advanceWaypoint(waypoints);
    expect(advanced[0].completed).toBe(true);
    expect(advanced[1].completed).toBe(false);
    expect(waypoints[0].completed).toBe(false); // original untouched
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd client && npx vitest run src/hooks/__tests__/waypointAdvance.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Extend `useNavGuidanceEngine.ts`**

Add `waypoints: NavWaypoint[]` state alongside the existing `destination`/`activeRoute` state (read Step 1's full file first to place this consistently with existing patterns). Add a `startMultiStop(waypoints: NavWaypoint[])` function that sets the waypoint list and calls the engine's existing single-destination `begin(...)`-style function (found in Step 1's read) targeting `waypoints[0]`. In the engine's existing position-update effect (where it currently checks arrival for the single destination), add: when waypoints are active, call `hasArrivedAtWaypoint`; on true, call `advanceWaypoint`, and if `nextWaypointIndex` of the result is non-null, re-`begin(...)` to the new active waypoint; if null, treat as final arrival (reuse whatever the engine already does on single-destination arrival).

- [ ] **Step 6: Load a saved dispatch route into the engine**

In `NavTripContext.tsx`, add a function `loadUnitRoute(unitId: string)` that calls `apiFetch<SavedRoute[]>('/dispatch/routing/unit/' + unitId)` (existing endpoint from `RouteBuilderPage.tsx`'s backing route), takes the most recent `active` row, maps its `optimized_order_json` waypoints into `NavWaypoint[]`, and calls `guidance.startMultiStop(...)`. Expose this from the context value.

- [ ] **Step 7: Add the "stop N of M" indicator to `NavigationPage.tsx`**

Near the existing maneuver banner/progress bar, render (only when `guidance.waypoints.length > 0`):
```tsx
{guidance.waypoints.length > 0 && (
  <div className="text-[9px] font-mono uppercase tracking-wide text-rmpg-400">
    Stop {(guidance.waypoints.findIndex(w => !w.completed) ?? guidance.waypoints.length) + 1} of {guidance.waypoints.length}
  </div>
)}
```

- [ ] **Step 8: Manual verification**

```bash
cd client && npm run dev
```
On `/route-builder`, build and save a multi-stop route for a test unit. On `/navigation` for that unit, confirm the engine loads the saved route, shows "Stop 1 of N", and advances on simulated arrival (spoof GPS position via browser devtools geolocation override to the first waypoint's coordinates).

- [ ] **Step 9: Commit**

```bash
git add client/src/hooks/waypointAdvance.ts client/src/hooks/__tests__/waypointAdvance.test.ts client/src/hooks/useNavGuidanceEngine.ts client/src/context/NavTripContext.tsx client/src/pages/NavigationPage.tsx
git commit -m "feat(nav): multi-stop routing consuming saved dispatch routes"
```

---

## Task 11: Offline/cached basemap fallback (feature #2)

**Files:**
- Create: `client/src/hooks/useCachedBasemap.ts`
- Modify: `client/src/pages/NavigationPage.tsx`
- Test: `client/src/hooks/__tests__/tileFailureDetection.test.ts`

**Do this task last, alongside Task 10** — it's the other highest-risk change (map bootstrap), per the spec's build-order guidance.

- [ ] **Step 1: Write the pure failure-detection logic**

```ts
// client/src/hooks/tileFailureDetection.ts
/** Tracks consecutive tile-load error timestamps and decides when the map
 *  should be considered "degraded" (fallback backdrop should show). */
export class TileFailureTracker {
  private firstErrorAt: number | null = null;
  constructor(private readonly degradedAfterMs: number = 5000) {}

  recordError(nowMs: number): void {
    if (this.firstErrorAt === null) this.firstErrorAt = nowMs;
  }

  recordSuccess(): void {
    this.firstErrorAt = null;
  }

  isDegraded(nowMs: number): boolean {
    if (this.firstErrorAt === null) return false;
    return nowMs - this.firstErrorAt >= this.degradedAfterMs;
  }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// client/src/hooks/__tests__/tileFailureDetection.test.ts
import { describe, it, expect } from 'vitest';
import { TileFailureTracker } from '../tileFailureDetection';

describe('TileFailureTracker', () => {
  it('is not degraded before any error', () => {
    const t = new TileFailureTracker(5000);
    expect(t.isDegraded(0)).toBe(false);
  });
  it('is not degraded immediately after one error', () => {
    const t = new TileFailureTracker(5000);
    t.recordError(1000);
    expect(t.isDegraded(1500)).toBe(false);
  });
  it('becomes degraded after errors persist past the threshold', () => {
    const t = new TileFailureTracker(5000);
    t.recordError(1000);
    expect(t.isDegraded(6001)).toBe(true);
  });
  it('recovers on a recorded success', () => {
    const t = new TileFailureTracker(5000);
    t.recordError(1000);
    t.recordSuccess();
    expect(t.isDegraded(10000)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd client && npx vitest run src/hooks/__tests__/tileFailureDetection.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 4: Build the fallback layer hook**

```ts
// client/src/hooks/useCachedBasemap.ts
import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { TileFailureTracker } from './tileFailureDetection';
import { getTaggedBeats } from '../pages/map/utils/districtGeoData';

/** Shows a flat schematic district-outline backdrop when the live map's
 *  tiles have been failing to load for several seconds — degrades the
 *  "blank screen" case rather than providing a true offline basemap
 *  (Mapbox vector tiles aren't cacheable to disk under the current license). */
export function useCachedBasemap(map: mapboxgl.Map | null) {
  const [degraded, setDegraded] = useState(false);
  const trackerRef = useRef(new TileFailureTracker());

  useEffect(() => {
    if (!map) return;
    const onError = () => {
      trackerRef.current.recordError(Date.now());
      setDegraded(trackerRef.current.isDegraded(Date.now()));
    };
    const onSourceData = (e: mapboxgl.MapSourceDataEvent) => {
      if (e.isSourceLoaded) {
        trackerRef.current.recordSuccess();
        setDegraded(false);
      }
    };
    map.on('error', onError);
    map.on('sourcedata', onSourceData);
    return () => {
      map.off('error', onError);
      map.off('sourcedata', onSourceData);
    };
  }, [map]);

  return { degraded, districtFallback: degraded ? getTaggedBeats() : null };
}
```

- [ ] **Step 5: Wire into `NavigationPage.tsx`**

Call `const { degraded, districtFallback } = useCachedBasemap(map.current);` near the page's other map-related hooks. Render a schematic backdrop overlay (a fixed-position `<div>` with a subdued district-outline SVG or a reused district-layer render, per the spec — reuse Task 5's district layer/loader if that task landed first, rendering it at full opacity as the fallback rather than the toggleable low-opacity overlay) when `degraded` is true, positioned behind the HUD instruments so live position/speed/heading readouts stay visible even with a blank/broken basemap underneath.

- [ ] **Step 6: Manual verification**

Simulate tile failure in devtools (Network tab → block requests matching `api.mapbox.com`), confirm the degraded backdrop appears after ~5s and the HUD instruments remain fully functional throughout.

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/tileFailureDetection.ts client/src/hooks/__tests__/tileFailureDetection.test.ts client/src/hooks/useCachedBasemap.ts client/src/pages/NavigationPage.tsx
git commit -m "feat(nav): degrade gracefully to schematic backdrop on sustained tile failure"
```

---

## Self-Review Notes

- **Spec coverage:** All 10 features from the corrected spec map 1:1 to Tasks 1–2 (#4), 3 (#9), 4 (#3), 5 (#8), 6 (#10), 7 (#7), 8 (#6), 9 (#5), 10 (#1), 11 (#2).
- **Migration number:** Task 1 Step 1 self-corrects the stale `migrations/README.md` number at execution time rather than hardcoding a number that may drift further before this plan runs.
- **Investigative steps** (e.g. Task 6 Step 1, Task 9 Step 1, Task 10 Step 1) are intentional — three separate corrections were needed while drafting this very plan after discoveries mid-design (dead `useNavGuidance.ts`, the `unit_trips`/`nav_trip_log` split, the existing route optimizer). Each task tells the implementer exactly what to check and what decision to make based on the result, rather than assuming untested facts about a codebase this large.
- **Risk ordering:** Tasks 10 and 11 are explicitly last, matching the spec's build-order guidance — both touch the safety-critical live map/guidance-engine path.

