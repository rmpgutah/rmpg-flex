# Intel Portal — Foundation (Tri-Pane Shell + Live Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/intel` from a flat search page into a tri-pane intelligence command center — a left rail + center `<Outlet/>` + a shared, collapsible right context panel — landing on a live Intelligence Dashboard backed by one new aggregate endpoint.

**Architecture:** `/intel` becomes a React Router **layout route** (`IntelPortalLayout`) nested inside the existing `<Layout />`. The rail navigates child routes; existing pages (Jail, Plate Log, Connections, Dossier, Reports, Quick-Capture, Recorder) are **adopted as children** (not rewritten). A single `IntelContext` carries the selected entity to the right panel (Dossier Peek ↔ Mini Graph). The dashboard reads `GET /api/intel/overview` (new) and polls every 20s. Sections not built yet (Search-supercharged, BOLO, Map, AI) route to a clearly-labeled placeholder until their own plans land.

**Tech Stack:** React 18 + TS + Vite + Tailwind (client); Hono on Cloudflare Workers + D1 (`query`/`queryFirst`/`execute`/`columnExists` from `src/utils/db.ts`); `apiFetch` from `client/src/hooks/useApi.ts`; Vitest + @testing-library/react + MemoryRouter (client tests).

**Testing posture (read first):** This repo has **no Worker test runner** (Miniflare vitest is deferred tech debt per CLAUDE.md). So:
- **Client** code (components, hooks, context) gets real TDD with Vitest.
- **Worker** endpoints are verified by `npm run typecheck` + a documented manual browser smoke + live-D1 SQL spot-checks via the Cloudflare D1 MCP (`d1_database_query` against `785de7ae-3e7a-4e01-93bb-d24ddd813f6b`). Do **not** invent a worker test file.

**Design tokens (every component):** pure-black `#000` base, `#0b0b0b` raised, `#d4a017` gold, `#888` gray, **zero blue**, borders `#232323`/`#3a3a3a`, **2px radius only** (never `rounded-lg`). Visual target: `.superpowers/brainstorm/63456-1781358420/content/portal-mock.html`.

---

## File Structure

**Create (client):**
- `client/src/pages/intel/intelTypes.ts` — shared `IntelHit` type + `recordPath()` (lifted from `IntelSearchPage.tsx`)
- `client/src/pages/intel/IntelContext.tsx` — selected-entity provider + `useIntelContext()` hook
- `client/src/pages/intel/useIntelOverview.ts` — 20s polling hook for `/api/intel/overview`
- `client/src/pages/intel/IntelPortalLayout.tsx` — tri-pane shell (rail + Outlet + context panel)
- `client/src/pages/intel/IntelRail.tsx` — left rail nav + badge counts
- `client/src/pages/intel/IntelContextPanel.tsx` — right docked panel (Dossier Peek ↔ Mini Graph)
- `client/src/pages/intel/IntelDashboard.tsx` — landing surface (tiles + widget grid)
- `client/src/pages/intel/IntelComingSoon.tsx` — labeled placeholder for not-yet-built sections
- `client/src/pages/intel/WatchlistSection.tsx`, `AlertsSection.tsx`, `ReviewQueues.tsx` — thin sections
- `client/src/pages/intel/widgets/{StatTiles,WatchlistActivityWidget,ActiveAlertsWidget,EscalationLeaderboardWidget,JailCrossHitsWidget,PlateSightingsWidget,ReviewQueuesWidget}.tsx`
- Tests under `client/src/pages/intel/__tests__/` and `client/src/pages/intel/widgets/__tests__/`

**Create (worker):**
- `src/utils/intelOverview.ts` — `buildOverview(db)` aggregate builder (each section try/catch-isolated)

**Modify:**
- `src/routes/intel.ts` — register `GET /overview`
- `client/src/pages/IntelSearchPage.tsx` — import `recordPath`/`IntelHit` from `intelTypes` and re-export (keeps `GlobalSearch` import working)
- `client/src/App.tsx:466-475` — convert `/intel` to a parent layout route with nested children
- `client/public/sw.js` — bump `CACHE_NAME`

---

## Task 1: Shared intel types (lift `recordPath` + `IntelHit`)

**Files:**
- Create: `client/src/pages/intel/intelTypes.ts`
- Modify: `client/src/pages/IntelSearchPage.tsx:14-37` (re-export from new module)
- Verify: `client/src/components/GlobalSearch.tsx` import still resolves

- [ ] **Step 1: Create the shared types module**

Create `client/src/pages/intel/intelTypes.ts`:

```ts
// Shared intel search types + pivot logic. Lifted out of IntelSearchPage so
// the portal (rail, dashboard, search) and GlobalSearch share one source of
// truth without importing a page component.

export interface IntelHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
}

export const TYPE_LABELS: Record<string, string> = {
  person: 'PERSONS', vehicle: 'VEHICLES', property: 'PROPERTIES', case: 'CASES',
  incident: 'INCIDENTS', call: 'CALLS FOR SERVICE', warrant: 'WARRANTS',
  citation: 'CITATIONS', field_interview: 'FIELD INTERVIEWS',
  trespass_order: 'TRESPASS ORDERS', evidence: 'EVIDENCE',
};

// Where a result row navigates on click — mirrors record-page routes.
export function recordPath(hit: { type: string; id: number }): string {
  switch (hit.type) {
    case 'person': return `/intel/person/${hit.id}`;
    case 'vehicle': return `/records?tab=vehicles&id=${hit.id}`;
    case 'warrant': return `/warrants?id=${hit.id}`;
    case 'case': return `/cases?id=${hit.id}`;
    default: return `/connections?type=${hit.type}&id=${hit.id}`;
  }
}
```

- [ ] **Step 2: Re-point `IntelSearchPage` at the shared module**

In `client/src/pages/IntelSearchPage.tsx`, delete the local `IntelHit` interface (lines 14-18), the `TYPE_LABELS` const (lines 20-25), and the `recordPath` function (lines 27-37). Replace with a re-export so existing importers (e.g. `GlobalSearch`) keep working:

```tsx
import { type IntelHit, TYPE_LABELS, recordPath } from './intel/intelTypes';
export { recordPath };
export type { IntelHit };
```

(Keep the rest of `IntelSearchPage.tsx` unchanged — it still serves `/intel/search` until Plan 2 replaces it.)

- [ ] **Step 3: Verify GlobalSearch still resolves**

Run: `cd client && grep -rn "recordPath" src/components/GlobalSearch.tsx`
Expected: an import of `recordPath` from `'../pages/IntelSearchPage'` (the re-export keeps it valid). If GlobalSearch imports it from a different path, leave that path working via the re-export.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (no missing-export errors).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/intelTypes.ts client/src/pages/IntelSearchPage.tsx
git commit -m "refactor(intel): lift IntelHit + recordPath into shared intelTypes"
```

---

## Task 2: `GET /api/intel/overview` aggregate endpoint

**Files:**
- Create: `src/utils/intelOverview.ts`
- Modify: `src/routes/intel.ts` (add route after `/health`, ~line 155)

- [ ] **Step 1: Write the aggregate builder**

Create `src/utils/intelOverview.ts`. Every section is independently try/caught and defaults to `[]`/`0`, mirroring the dossier endpoint's resilience so one bad table never blanks the dashboard:

```ts
// Intel dashboard aggregate. One round-trip for the command-center landing.
// Each section is isolated: a failing query yields its empty default, never
// a 500. SQL here is the STARTING POINT — verify column names against live D1
// (785de7ae) during implementation and adjust (see plan Step 3).
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst } from './db';

export interface IntelOverview {
  stats: { active_warrants: number; on_watchlist: number; gang_flagged: number };
  watchlist_activity: Array<{ entity_type: string; entity_id: number; label: string; event: string; when: string }>;
  alerts: Array<{ kind: string; person_id: number | null; label: string; detail: string; when: string }>;
  escalation_leaderboard: Array<{ person_id: number; label: string; score: number; trend: string }>;
  jail_cross_hits: Array<{ booking_id: number; name: string; person_id: number | null; booked_at: string; match: string }>;
  plate_sightings: Array<{ plate: string; state: string | null; flag: string | null; location_text: string | null; when: string }>;
  queues: { link_suggestions: number; resolution_pairs: number };
  bolos: { active: number; high_priority: number };
}

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

export async function buildOverview(db: D1Database): Promise<IntelOverview> {
  const ov: IntelOverview = {
    stats: { active_warrants: 0, on_watchlist: 0, gang_flagged: 0 },
    watchlist_activity: [], alerts: [], escalation_leaderboard: [],
    jail_cross_hits: [], plate_sightings: [],
    queues: { link_suggestions: 0, resolution_pairs: 0 },
    bolos: { active: 0, high_priority: 0 },
  };

  try {
    const r = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM warrants WHERE LOWER(COALESCE(status,'')) IN ('active','outstanding')`);
    ov.stats.active_warrants = n(r?.c);
  } catch (e: any) { console.error('[overview] warrants stat:', e?.message); }

  try {
    const r = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM intel_watchlist WHERE active = 1`);
    ov.stats.on_watchlist = n(r?.c);
  } catch (e: any) { console.error('[overview] watchlist stat:', e?.message); }

  try {
    const r = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM persons WHERE LOWER(COALESCE(flags,'')) LIKE '%gang%'`);
    ov.stats.gang_flagged = n(r?.c);
  } catch (e: any) { console.error('[overview] gang stat:', e?.message); }

  // Recent activity on watched entities (field_interviews / citations / calls).
  try {
    ov.watchlist_activity = (await query<any>(db,
      `SELECT w.entity_type, w.entity_id,
              COALESCE(p.first_name || ' ' || p.last_name, 'Entity #' || w.entity_id) AS label,
              'Watched activity' AS event, w.last_alert_at AS when_ts
         FROM intel_watchlist w
         LEFT JOIN persons p ON w.entity_type = 'person' AND p.id = w.entity_id
        WHERE w.active = 1 AND w.last_alert_at IS NOT NULL
        ORDER BY w.last_alert_at DESC LIMIT 8`)).map((r) => ({
      entity_type: r.entity_type, entity_id: n(r.entity_id), label: String(r.label),
      event: r.event, when: r.when_ts || '',
    }));
  } catch (e: any) { console.error('[overview] watchlist activity:', e?.message); }

  // Active alerts: active warrants joined to subject persons.
  try {
    ov.alerts = (await query<any>(db,
      `SELECT COALESCE(w.subject_person_id, w.person_id) AS pid,
              COALESCE(p.first_name || ' ' || p.last_name, w.subject_name, 'Unknown') AS label,
              COALESCE(w.charge_description, 'Warrant') AS detail,
              w.issued_date AS when_ts
         FROM warrants w
         LEFT JOIN persons p ON p.id = COALESCE(w.subject_person_id, w.person_id)
        WHERE LOWER(COALESCE(w.status,'')) IN ('active','outstanding')
        ORDER BY w.issued_date DESC LIMIT 8`)).map((r) => ({
      kind: 'warrant', person_id: r.pid ? n(r.pid) : null,
      label: String(r.label), detail: String(r.detail), when: r.when_ts || '',
    }));
  } catch (e: any) { console.error('[overview] alerts:', e?.message); }

  // Escalation leaderboard: 30-day event tempo per person across calls + incidents.
  try {
    ov.escalation_leaderboard = (await query<any>(db,
      `SELECT pid, label, COUNT(*) AS score FROM (
          SELECT cp.person_id AS pid,
                 (SELECT first_name || ' ' || last_name FROM persons WHERE id = cp.person_id) AS label
            FROM call_persons cp
            JOIN calls_for_service c ON c.id = cp.call_id
           WHERE c.created_at >= datetime('now','-30 days')
          UNION ALL
          SELECT ip.person_id AS pid,
                 (SELECT first_name || ' ' || last_name FROM persons WHERE id = ip.person_id) AS label
            FROM incident_persons ip
            JOIN incidents i ON i.id = ip.incident_id
           WHERE i.occurred_date >= date('now','-30 days')
       ) WHERE pid IS NOT NULL AND label IS NOT NULL
       GROUP BY pid, label ORDER BY score DESC LIMIT 8`)).map((r) => ({
      person_id: n(r.pid), label: String(r.label), score: n(r.score),
      trend: n(r.score) >= 3 ? 'rising' : 'flat',
    }));
  } catch (e: any) { console.error('[overview] escalation:', e?.message); }

  // Jail cross-hits today.
  try {
    ov.jail_cross_hits = (await query<any>(db,
      `SELECT id AS booking_id, COALESCE(name, full_name, 'Unknown') AS name,
              person_id, booked_at, CASE WHEN person_id IS NOT NULL THEN 'exact' ELSE 'possible' END AS match
         FROM jail_bookings
        WHERE booked_at >= datetime('now','-1 day')
        ORDER BY booked_at DESC LIMIT 6`)).map((r) => ({
      booking_id: n(r.booking_id), name: String(r.name),
      person_id: r.person_id ? n(r.person_id) : null, booked_at: r.booked_at || '', match: r.match,
    }));
  } catch (e: any) { console.error('[overview] jail cross-hits:', e?.message); }

  // Recent plate sightings.
  try {
    ov.plate_sightings = (await query<any>(db,
      `SELECT plate, state, location_text, created_at AS when_ts,
              CASE WHEN notes LIKE '%stolen%' THEN 'stolen' ELSE NULL END AS flag
         FROM vehicle_sightings ORDER BY created_at DESC LIMIT 6`)).map((r) => ({
      plate: String(r.plate || ''), state: r.state || null, flag: r.flag || null,
      location_text: r.location_text || null, when: r.when_ts || '',
    }));
  } catch (e: any) { console.error('[overview] sightings:', e?.message); }

  // Review queue counts.
  try {
    const a = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM intel_link_suggestions WHERE status = 'pending'`);
    ov.queues.link_suggestions = n(a?.c);
  } catch (e: any) { console.error('[overview] link queue:', e?.message); }
  try {
    const b = await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM entity_resolution_suggestions WHERE status = 'pending'`);
    ov.queues.resolution_pairs = n(b?.c);
  } catch (e: any) { console.error('[overview] resolution queue:', e?.message); }

  // BOLO counts (table arrives in Plan 3 — degrade to 0 until then).
  try {
    const r = await queryFirst<{ a: number; h: number }>(db,
      `SELECT COUNT(*) AS a,
              SUM(CASE WHEN priority IN ('critical','high') THEN 1 ELSE 0 END) AS h
         FROM bolos WHERE status = 'active'`);
    ov.bolos.active = n(r?.a); ov.bolos.high_priority = n(r?.h);
  } catch (e: any) { /* bolos table not yet created — silent, expected pre-Plan-3 */ }

  return ov;
}
```

- [ ] **Step 2: Register the route in `src/routes/intel.ts`**

Add the import at the top (with the other util imports, ~line 22):

```ts
import { buildOverview } from '../utils/intelOverview';
```

Add the route immediately after the `/health` route (after line 155):

```ts
// GET /overview — single-call dashboard aggregate (command-center landing).
intel.get('/overview', operational, async (c) => {
  return c.json(await buildOverview(getDb(c.env)));
});
```

- [ ] **Step 3: Verify the SQL against live D1 and fix column drift**

Use the Cloudflare D1 MCP (`d1_database_query`, database `785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) to confirm each table/column the builder references actually exists, and fix any mismatch in `intelOverview.ts`:

```sql
SELECT name FROM pragma_table_info('warrants')        WHERE name IN ('status','subject_person_id','person_id','charge_description','issued_date','subject_name');
SELECT name FROM pragma_table_info('intel_watchlist') WHERE name IN ('active','last_alert_at','entity_type','entity_id');
SELECT name FROM pragma_table_info('jail_bookings')   WHERE name IN ('name','full_name','person_id','booked_at');
SELECT name FROM pragma_table_info('vehicle_sightings') WHERE name IN ('plate','state','location_text','created_at','notes');
SELECT name FROM pragma_table_info('calls_for_service') WHERE name IN ('created_at');
SELECT name FROM pragma_table_info('incidents')        WHERE name IN ('occurred_date');
```
Adjust any column name that doesn't exist (e.g. if `jail_bookings` uses a different name column). Every section is try/caught, so a wrong column degrades to `[]` rather than 500 — but fix what you can confirm.

- [ ] **Step 4: Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/intelOverview.ts src/routes/intel.ts
git commit -m "feat(intel): /api/intel/overview dashboard aggregate endpoint"
```

---

## Task 3: `IntelContext` (selected-entity provider)

**Files:**
- Create: `client/src/pages/intel/IntelContext.tsx`
- Test: `client/src/pages/intel/__tests__/IntelContext.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/IntelContext.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { IntelProvider, useIntelContext } from '../IntelContext';

function Probe() {
  const { selected, selectEntity, panelMode, setPanelMode, panelCollapsed, togglePanel } = useIntelContext();
  return (
    <div>
      <div data-testid="sel">{selected ? `${selected.type}:${selected.id}:${selected.label}` : 'none'}</div>
      <div data-testid="mode">{panelMode}</div>
      <div data-testid="collapsed">{String(panelCollapsed)}</div>
      <button onClick={() => selectEntity('person', 42, 'HALE, Vincent')}>select</button>
      <button onClick={() => setPanelMode('graph')}>graph</button>
      <button onClick={togglePanel}>toggle</button>
    </div>
  );
}

describe('IntelContext', () => {
  it('selecting an entity sets it and forces dossier mode + expands panel', () => {
    render(<IntelProvider><Probe /></IntelProvider>);
    expect(screen.getByTestId('sel').textContent).toBe('none');
    fireEvent.click(screen.getByText('graph'));      // pre-set to graph
    fireEvent.click(screen.getByText('select'));     // selecting resets to dossier
    expect(screen.getByTestId('sel').textContent).toBe('person:42:HALE, Vincent');
    expect(screen.getByTestId('mode').textContent).toBe('dossier');
    expect(screen.getByTestId('collapsed').textContent).toBe('false');
  });

  it('togglePanel flips collapsed', () => {
    render(<IntelProvider><Probe /></IntelProvider>);
    const before = screen.getByTestId('collapsed').textContent;
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('collapsed').textContent).not.toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelContext.test.tsx`
Expected: FAIL — cannot find module `../IntelContext`.

- [ ] **Step 3: Implement the context**

Create `client/src/pages/intel/IntelContext.tsx`:

```tsx
// Shared selection state for the Intel Portal. The center surfaces call
// selectEntity(); the right context panel renders whatever is selected.
// This is the single seam between the three panes — surfaces never reach
// into the panel directly.
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface SelectedEntity { type: string; id: number; label: string }
export type PanelMode = 'dossier' | 'graph';

interface IntelContextValue {
  selected: SelectedEntity | null;
  selectEntity: (type: string, id: number, label: string) => void;
  panelMode: PanelMode;
  setPanelMode: (m: PanelMode) => void;
  panelCollapsed: boolean;
  togglePanel: () => void;
}

const Ctx = createContext<IntelContextValue | null>(null);
const COLLAPSE_KEY = 'rmpg-intel-panel-collapsed';

export function IntelProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('dossier');
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  const selectEntity = useCallback((type: string, id: number, label: string) => {
    setSelected({ type, id, label });
    setPanelMode('dossier');     // a fresh selection always opens the dossier peek
    setPanelCollapsed(false);    // …and expands the panel so it's visible
  }, []);

  const togglePanel = useCallback(() => {
    setPanelCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ selected, selectEntity, panelMode, setPanelMode, panelCollapsed, togglePanel }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIntelContext(): IntelContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIntelContext must be used within IntelProvider');
  return v;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelContext.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/IntelContext.tsx client/src/pages/intel/__tests__/IntelContext.test.tsx
git commit -m "feat(intel): IntelContext selected-entity provider for the portal"
```

---

## Task 4: `useIntelOverview` polling hook

**Files:**
- Create: `client/src/pages/intel/useIntelOverview.ts`
- Test: `client/src/pages/intel/__tests__/useIntelOverview.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/useIntelOverview.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useIntelOverview } from '../useIntelOverview';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    stats: { active_warrants: 11, on_watchlist: 7, gang_flagged: 4 },
    watchlist_activity: [], alerts: [], escalation_leaderboard: [],
    jail_cross_hits: [], plate_sightings: [],
    queues: { link_suggestions: 8, resolution_pairs: 4 },
    bolos: { active: 3, high_priority: 2 },
  })),
}));

describe('useIntelOverview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the overview payload', async () => {
    const { result } = renderHook(() => useIntelOverview());
    await waitFor(() => expect(result.current.data?.stats.active_warrants).toBe(11));
    expect(result.current.data?.queues.link_suggestions).toBe(8);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/useIntelOverview.test.tsx`
Expected: FAIL — cannot find module `../useIntelOverview`.

- [ ] **Step 3: Implement the hook**

Create `client/src/pages/intel/useIntelOverview.ts`:

```ts
// Polls /api/intel/overview every 20s. Pauses while the tab is hidden so a
// backgrounded command center doesn't hammer the Worker. (WebSocket is dead
// on the rewrite — polling is the live-data transport for now.)
import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

export interface IntelOverview {
  stats: { active_warrants: number; on_watchlist: number; gang_flagged: number };
  watchlist_activity: Array<{ entity_type: string; entity_id: number; label: string; event: string; when: string }>;
  alerts: Array<{ kind: string; person_id: number | null; label: string; detail: string; when: string }>;
  escalation_leaderboard: Array<{ person_id: number; label: string; score: number; trend: string }>;
  jail_cross_hits: Array<{ booking_id: number; name: string; person_id: number | null; booked_at: string; match: string }>;
  plate_sightings: Array<{ plate: string; state: string | null; flag: string | null; location_text: string | null; when: string }>;
  queues: { link_suggestions: number; resolution_pairs: number };
  bolos: { active: number; high_priority: number };
}

const POLL_MS = 20_000;

export function useIntelOverview() {
  const [data, setData] = useState<IntelOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = useCallback(() => {
    apiFetch<IntelOverview>('/intel/overview')
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e?.message || 'overview failed'));
  }, []);

  useEffect(() => {
    load();
    const start = () => { clearInterval(timer.current); timer.current = setInterval(load, POLL_MS); };
    const onVis = () => { if (document.visibilityState === 'visible') { load(); start(); } else clearInterval(timer.current); };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer.current); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  return { data, error, reload: load };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/useIntelOverview.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/useIntelOverview.ts client/src/pages/intel/__tests__/useIntelOverview.test.tsx
git commit -m "feat(intel): useIntelOverview 20s polling hook"
```

---

## Task 5: Dashboard widgets (pure presentational)

Widgets take data via props (no fetching) so they're trivially testable and reusable. Build the shared `StatTiles` + one representative tested widget here; the rest follow the identical pattern.

**Files:**
- Create: `client/src/pages/intel/widgets/StatTiles.tsx`
- Create: `client/src/pages/intel/widgets/EscalationLeaderboardWidget.tsx`
- Create: `client/src/pages/intel/widgets/ActiveAlertsWidget.tsx`
- Create: `client/src/pages/intel/widgets/WatchlistActivityWidget.tsx`
- Create: `client/src/pages/intel/widgets/JailCrossHitsWidget.tsx`
- Create: `client/src/pages/intel/widgets/PlateSightingsWidget.tsx`
- Create: `client/src/pages/intel/widgets/ReviewQueuesWidget.tsx`
- Test: `client/src/pages/intel/widgets/__tests__/widgets.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/widgets/__tests__/widgets.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import StatTiles from '../StatTiles';
import EscalationLeaderboardWidget from '../EscalationLeaderboardWidget';

describe('dashboard widgets', () => {
  it('StatTiles renders the three counts', () => {
    render(<StatTiles stats={{ active_warrants: 11, on_watchlist: 7, gang_flagged: 4 }} />);
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('Active Warrants')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('EscalationLeaderboardWidget lists rows and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<EscalationLeaderboardWidget rows={[
      { person_id: 5, label: 'HALE, Vincent', score: 9, trend: 'rising' },
    ]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('HALE, Vincent'));
    expect(onSelect).toHaveBeenCalledWith('person', 5, 'HALE, Vincent');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/intel/widgets/__tests__/widgets.test.tsx`
Expected: FAIL — cannot find `../StatTiles`.

- [ ] **Step 3: Implement the widgets**

Create `client/src/pages/intel/widgets/StatTiles.tsx`:

```tsx
import type { IntelOverview } from '../useIntelOverview';

const TILE = 'border border-[#1f1f1f] bg-[#070707] rounded-[2px] p-3 text-center';

export default function StatTiles({ stats }: { stats: IntelOverview['stats'] }) {
  const items = [
    { n: stats.active_warrants, l: 'Active Warrants', c: 'text-[#ff6b5e]' },
    { n: stats.on_watchlist, l: 'On Watchlist', c: 'text-[#d4a017]' },
    { n: stats.gang_flagged, l: 'Gang-Flagged', c: 'text-[#c07ff0]' },
  ];
  return (
    <div className="grid grid-cols-3 gap-[10px]">
      {items.map((it) => (
        <div key={it.l} className={TILE}>
          <div className={`font-mono text-[20px] font-bold ${it.c}`}>{it.n}</div>
          <div className="text-[8px] text-[#777] uppercase tracking-wide mt-[3px]">{it.l}</div>
        </div>
      ))}
    </div>
  );
}
```

Create a shared widget frame `client/src/pages/intel/widgets/WidgetFrame.tsx`:

```tsx
import type { ReactNode } from 'react';

export default function WidgetFrame({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="border border-[#1f1f1f] bg-[#070707] rounded-[2px]">
      <div className="flex items-center gap-[7px] px-[10px] py-[8px] border-b border-[#1a1a1a]">
        <span className="font-mono text-[9px] tracking-wide text-[#cfcfcf] uppercase font-bold">{title}</span>
        {note && <span className="ml-auto font-mono text-[9px] text-[#d4a017]">{note}</span>}
      </div>
      <div className="px-[10px] py-[8px]">{children}</div>
    </div>
  );
}
```

Create `client/src/pages/intel/widgets/EscalationLeaderboardWidget.tsx`:

```tsx
import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['escalation_leaderboard'][number];
const max = (rows: Row[]) => Math.max(1, ...rows.map((r) => r.score));

export default function EscalationLeaderboardWidget(
  { rows, onSelect }: { rows: Row[]; onSelect: (type: string, id: number, label: string) => void },
) {
  const m = max(rows);
  return (
    <WidgetFrame title="↗ Escalation Leaderboard" note="30d">
      {rows.length === 0 && <div className="text-[10px] text-[#555]">No recent escalation.</div>}
      {rows.map((r) => (
        <button key={r.person_id} onClick={() => onSelect('person', r.person_id, r.label)}
          className="w-full flex items-center gap-2 py-[5px] border-b border-[#131313] last:border-b-0 text-left">
          <span className="w-[96px] truncate text-[11px] text-[#e0e0e0]">{r.label}</span>
          <span className="flex-1 h-[7px] bg-[#141414] rounded-[1px] overflow-hidden">
            <span className="block h-full bg-gradient-to-r from-[#7a5a10] to-[#d4a017]"
              style={{ width: `${Math.round((r.score / m) * 100)}%` }} />
          </span>
          <span className="font-mono text-[9px] text-[#d4a017] w-[26px] text-right">{r.score}</span>
        </button>
      ))}
    </WidgetFrame>
  );
}
```

Create the remaining four widgets following the same `WidgetFrame` + clickable-row pattern. Each takes `{ rows, onSelect }` (except Plate Sightings, which has no person to select — render plain rows). Full code:

`ActiveAlertsWidget.tsx`:

```tsx
import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['alerts'][number];
const TAG: Record<string, string> = {
  warrant: 'bg-[#3a0d0a] text-[#ff6b5e]', officer_safety: 'bg-[#3a2a08] text-[#f0c050]',
  gang: 'bg-[#2a0d3a] text-[#c07ff0]', bolo: 'bg-[#3a0d0a] text-[#ff6b5e]',
};

export default function ActiveAlertsWidget(
  { rows, onSelect }: { rows: Row[]; onSelect: (type: string, id: number, label: string) => void },
) {
  return (
    <WidgetFrame title="▲ Active Alerts" note={String(rows.length)}>
      {rows.length === 0 && <div className="text-[10px] text-[#555]">No active alerts.</div>}
      {rows.map((r, i) => (
        <button key={i} disabled={!r.person_id} onClick={() => r.person_id && onSelect('person', r.person_id, r.label)}
          className="w-full flex items-center gap-2 py-[5px] border-b border-[#131313] last:border-b-0 text-left disabled:cursor-default">
          <span className={`font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] tracking-wide ${TAG[r.kind] || 'bg-[#222] text-[#aaa]'}`}>
            {r.kind.replace('_', ' ').toUpperCase()}
          </span>
          <span className="text-[11px] text-[#e8e8e8] flex-1 truncate">{r.label}</span>
          <span className="text-[10px] text-[#666] truncate max-w-[120px]">{r.detail}</span>
        </button>
      ))}
    </WidgetFrame>
  );
}
```

`WatchlistActivityWidget.tsx`:

```tsx
import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['watchlist_activity'][number];

export default function WatchlistActivityWidget(
  { rows, onSelect }: { rows: Row[]; onSelect: (type: string, id: number, label: string) => void },
) {
  return (
    <WidgetFrame title="⚑ Watchlist Activity" note="live">
      {rows.length === 0 && <div className="text-[10px] text-[#555]">No recent activity.</div>}
      {rows.map((r, i) => (
        <button key={i} onClick={() => onSelect(r.entity_type, r.entity_id, r.label)}
          className="w-full flex items-center gap-2 py-[5px] border-b border-[#131313] last:border-b-0 text-left">
          <span className="text-[11px] text-[#e8e8e8] flex-1 truncate">{r.label}</span>
          <span className="text-[10px] text-[#666] truncate max-w-[140px]">{r.event}</span>
        </button>
      ))}
    </WidgetFrame>
  );
}
```

`JailCrossHitsWidget.tsx`:

```tsx
import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['jail_cross_hits'][number];

export default function JailCrossHitsWidget(
  { rows, onSelect }: { rows: Row[]; onSelect: (type: string, id: number, label: string) => void },
) {
  return (
    <WidgetFrame title="⛓ Jail Cross-Hits" note="today">
      {rows.length === 0 && <div className="text-[10px] text-[#555]">No bookings today.</div>}
      {rows.map((r) => (
        <button key={r.booking_id} disabled={!r.person_id}
          onClick={() => r.person_id && onSelect('person', r.person_id, r.name)}
          className="w-full flex items-center gap-2 py-[5px] border-b border-[#131313] last:border-b-0 text-left disabled:cursor-default">
          {r.match === 'exact'
            ? <span className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-[#3a0d0a] text-[#ff6b5e]">MATCH</span>
            : <span className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-[#222] text-[#aaa]">POSS</span>}
          <span className="text-[11px] text-[#e8e8e8] flex-1 truncate">{r.name}</span>
          <span className="text-[10px] text-[#666]">{r.booked_at?.slice(11, 16)}</span>
        </button>
      ))}
    </WidgetFrame>
  );
}
```

`PlateSightingsWidget.tsx`:

```tsx
import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['plate_sightings'][number];

export default function PlateSightingsWidget({ rows }: { rows: Row[] }) {
  return (
    <WidgetFrame title="🚗 Plate Sightings" note="ticker">
      {rows.length === 0 && <div className="text-[10px] text-[#555]">No recent sightings.</div>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 py-[5px] border-b border-[#131313] last:border-b-0">
          <div className="flex-1">
            <div className="font-mono text-[11px] text-[#e8e8e8]">{r.state ? `${r.state} · ` : ''}{r.plate}</div>
            <div className="text-[10px] text-[#666]">{r.flag ? `${r.flag} · ` : ''}{r.location_text || '—'}</div>
          </div>
        </div>
      ))}
    </WidgetFrame>
  );
}
```

`ReviewQueuesWidget.tsx`:

```tsx
import { Link } from 'react-router-dom';
import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

export default function ReviewQueuesWidget({ queues }: { queues: IntelOverview['queues'] }) {
  const badge = (n: number) => (
    <span className="font-mono text-[9px] text-black bg-[#d4a017] rounded-[2px] px-[5px] py-[1px]">{n}</span>
  );
  return (
    <WidgetFrame title="⚐ Review Queues" note={String(queues.link_suggestions + queues.resolution_pairs)}>
      <Link to="/intel/queues" className="flex items-center gap-2 py-[5px] border-b border-[#131313]">
        <div className="flex-1"><div className="text-[11px] text-[#e8e8e8]">Narrative link suggestions</div>
          <div className="text-[10px] text-[#666]">person/vehicle mentions to confirm</div></div>
        {badge(queues.link_suggestions)}
      </Link>
      <Link to="/intel/queues" className="flex items-center gap-2 py-[5px]">
        <div className="flex-1"><div className="text-[11px] text-[#e8e8e8]">Duplicate-person review</div>
          <div className="text-[10px] text-[#666]">entity-resolution pairs</div></div>
        {badge(queues.resolution_pairs)}
      </Link>
    </WidgetFrame>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/intel/widgets/__tests__/widgets.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/widgets/
git commit -m "feat(intel): dashboard widgets (stat tiles + 6 live widgets)"
```

---

## Task 6: `IntelDashboard` (assemble the landing surface)

**Files:**
- Create: `client/src/pages/intel/IntelDashboard.tsx`
- Test: `client/src/pages/intel/__tests__/IntelDashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/IntelDashboard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelDashboard from '../IntelDashboard';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    stats: { active_warrants: 11, on_watchlist: 7, gang_flagged: 4 },
    watchlist_activity: [{ entity_type: 'person', entity_id: 1, label: 'DELGADO, Marcus', event: 'New FI', when: '' }],
    alerts: [{ kind: 'warrant', person_id: 2, label: 'HALE, Vincent', detail: 'Felony', when: '' }],
    escalation_leaderboard: [{ person_id: 2, label: 'HALE, Vincent', score: 9, trend: 'rising' }],
    jail_cross_hits: [], plate_sightings: [],
    queues: { link_suggestions: 8, resolution_pairs: 4 },
    bolos: { active: 3, high_priority: 2 },
  })),
}));

describe('IntelDashboard', () => {
  it('renders tiles and widgets from the overview', async () => {
    render(<MemoryRouter><IntelProvider><IntelDashboard /></IntelProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('11')).toBeInTheDocument());
    expect(screen.getByText('DELGADO, Marcus')).toBeInTheDocument();
    expect(screen.getAllByText('HALE, Vincent').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelDashboard.test.tsx`
Expected: FAIL — cannot find `../IntelDashboard`.

- [ ] **Step 3: Implement the dashboard**

Create `client/src/pages/intel/IntelDashboard.tsx`:

```tsx
// Intel command-center landing. One /api/intel/overview call → stat tiles +
// six live widgets. Rows pivot the right context panel via selectEntity.
import { useIntelOverview } from './useIntelOverview';
import { useIntelContext } from './IntelContext';
import StatTiles from './widgets/StatTiles';
import WatchlistActivityWidget from './widgets/WatchlistActivityWidget';
import ActiveAlertsWidget from './widgets/ActiveAlertsWidget';
import EscalationLeaderboardWidget from './widgets/EscalationLeaderboardWidget';
import JailCrossHitsWidget from './widgets/JailCrossHitsWidget';
import PlateSightingsWidget from './widgets/PlateSightingsWidget';
import ReviewQueuesWidget from './widgets/ReviewQueuesWidget';

const EMPTY = {
  stats: { active_warrants: 0, on_watchlist: 0, gang_flagged: 0 },
  watchlist_activity: [], alerts: [], escalation_leaderboard: [],
  jail_cross_hits: [], plate_sightings: [],
  queues: { link_suggestions: 0, resolution_pairs: 0 }, bolos: { active: 0, high_priority: 0 },
};

export default function IntelDashboard() {
  const { data, error } = useIntelOverview();
  const { selectEntity } = useIntelContext();
  const ov = data || EMPTY;

  return (
    <div className="p-3 space-y-[10px]">
      <div className="font-mono text-[10px] tracking-widest text-[#888] uppercase flex items-center gap-2">
        Intelligence Dashboard
        <span className="text-[8px] text-[#10b981] flex items-center gap-1">
          <span className="w-[5px] h-[5px] rounded-full bg-[#10b981] inline-block" />LIVE
        </span>
      </div>
      {error && <div className="text-[10px] text-[#ff6b5e]">Live data error: {error}</div>}

      <StatTiles stats={ov.stats} />

      <div className="grid grid-cols-2 gap-[10px]">
        <WatchlistActivityWidget rows={ov.watchlist_activity} onSelect={selectEntity} />
        <ActiveAlertsWidget rows={ov.alerts} onSelect={selectEntity} />
        <EscalationLeaderboardWidget rows={ov.escalation_leaderboard} onSelect={selectEntity} />
        <JailCrossHitsWidget rows={ov.jail_cross_hits} onSelect={selectEntity} />
        <PlateSightingsWidget rows={ov.plate_sightings} />
        <ReviewQueuesWidget queues={ov.queues} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelDashboard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/IntelDashboard.tsx client/src/pages/intel/__tests__/IntelDashboard.test.tsx
git commit -m "feat(intel): IntelDashboard landing surface"
```

---

## Task 7: `IntelContextPanel` (Dossier Peek ↔ Mini Graph)

**Files:**
- Create: `client/src/pages/intel/IntelContextPanel.tsx`
- Test: `client/src/pages/intel/__tests__/IntelContextPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/IntelContextPanel.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelContextPanel from '../IntelContextPanel';
import { IntelProvider, useIntelContext } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.includes('/dossier/person/')) return {
      person: { id: 2, first_name: 'Vincent', last_name: 'Hale' },
      flags: ['ACTIVE WARRANT'], timeline: [], associates: [],
      escalation: { recent: 7, baseline: 2, ratio: 3.5, trend: 'rising' }, watched: false,
    };
    return {};
  }),
}));
// Mini-graph child fetches its own data — stub it so the panel test stays unit-level.
vi.mock('../../../components/ConnectionsGraphPanel', () => ({ default: () => <div>graph-stub</div> }));

function Pick() {
  const { selectEntity } = useIntelContext();
  return <button onClick={() => selectEntity('person', 2, 'HALE, Vincent')}>pick</button>;
}

describe('IntelContextPanel', () => {
  it('shows empty hint, then a dossier peek after selection', async () => {
    render(<MemoryRouter><IntelProvider><Pick /><IntelContextPanel /></IntelProvider></MemoryRouter>);
    expect(screen.getByText(/select an entity/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('pick'));
    await waitFor(() => expect(screen.getByText(/Vincent Hale/)).toBeInTheDocument());
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelContextPanel.test.tsx`
Expected: FAIL — cannot find `../IntelContextPanel`.

- [ ] **Step 3: Implement the panel**

Create `client/src/pages/intel/IntelContextPanel.tsx`:

```tsx
// Right docked panel. Renders whatever is selected in IntelContext, flipping
// between a compact Dossier Peek and an embedded Mini Graph. Collapsible.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import ConnectionsGraphPanel from '../../components/ConnectionsGraphPanel';
import { useIntelContext } from './IntelContext';

const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', '0', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());

interface DossierLite {
  person: { id: number; first_name?: string; middle_name?: string; last_name?: string };
  flags?: string[];
  escalation?: { recent: number; baseline: number; ratio: number; trend: string } | null;
  timeline?: Array<{ kind: string; label?: string; description?: string; date?: string }>;
  associates?: Array<{ person_id?: number; id?: number; label?: string; name?: string; shared?: number; count?: number }>;
  watched?: boolean;
}

export default function IntelContextPanel() {
  const { selected, panelMode, setPanelMode, panelCollapsed, togglePanel } = useIntelContext();
  const [dossier, setDossier] = useState<DossierLite | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected || selected.type !== 'person' || panelMode !== 'dossier') { setDossier(null); return; }
    setLoading(true); setDossier(null);
    apiFetch<DossierLite>(`/intel/dossier/person/${selected.id}`)
      .then(setDossier).catch(() => setDossier(null)).finally(() => setLoading(false));
  }, [selected, panelMode]);

  if (panelCollapsed) {
    return (
      <aside className="w-[24px] bg-[#050505] border-l border-[#232323] flex items-start justify-center pt-2">
        <button aria-label="Expand context panel" onClick={togglePanel} className="text-[#888] text-[12px]">⟩</button>
      </aside>
    );
  }

  return (
    <aside className="w-[264px] bg-[#050505] border-l border-[#232323] flex flex-col">
      <div className="flex items-center px-[11px] py-[8px] border-b border-[#1f1f1f]">
        <span className="font-mono text-[9px] tracking-widest text-[#888] uppercase">◈ Context</span>
        {selected && (
          <div className="ml-2 flex gap-1">
            <button onClick={() => setPanelMode('dossier')}
              className={`text-[8px] font-mono px-[5px] py-[1px] rounded-[2px] border ${panelMode === 'dossier' ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#2a2a2a] text-[#777]'}`}>DOSSIER</button>
            <button onClick={() => setPanelMode('graph')}
              className={`text-[8px] font-mono px-[5px] py-[1px] rounded-[2px] border ${panelMode === 'graph' ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#2a2a2a] text-[#777]'}`}>GRAPH</button>
          </div>
        )}
        <button aria-label="Collapse context panel" onClick={togglePanel} className="ml-auto text-[#555] text-[12px]">⟨</button>
      </div>

      <div className="flex-1 overflow-y-auto px-[11px] py-[12px]">
        {!selected && <div className="text-[10px] text-[#555]">Select an entity from any list to peek its dossier.</div>}

        {selected && panelMode === 'graph' && (
          <ConnectionsGraphPanel personId={selected.id} personName={selected.label} />
        )}

        {selected && panelMode === 'dossier' && (
          <>
            {loading && <div className="text-[10px] text-[#777]">Loading dossier…</div>}
            {dossier && (() => {
              const p = dossier.person;
              const name = [p.first_name, p.middle_name, p.last_name].filter(real).join(' ') || selected.label;
              return (
                <div className="space-y-3">
                  <div>
                    <div className="text-[13px] text-white font-bold">{name}</div>
                    <div className="flex gap-1 flex-wrap mt-[6px]">
                      {(dossier.flags || []).map((f) => (
                        <span key={f} className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-[#3a0d0a] text-[#ff6b5e]">{f}</span>
                      ))}
                    </div>
                  </div>

                  {dossier.escalation && (
                    <div className="border border-[#5a3a10] bg-[#0a0603] rounded-[2px] px-[10px] py-[8px]">
                      <div className="text-[8px] text-[#d4a017] uppercase tracking-wider">Escalation Index</div>
                      <div className="font-mono text-[16px] text-[#f0c050] font-bold">
                        {Number(dossier.escalation.ratio || 0).toFixed(1)}
                        <span className="text-[9px] text-[#a07a20] ml-1">{dossier.escalation.trend}</span>
                      </div>
                      <div className="text-[9px] text-[#777]">{dossier.escalation.recent} recent vs {dossier.escalation.baseline} baseline</div>
                    </div>
                  )}

                  {(dossier.timeline || []).length > 0 && (
                    <div>
                      <div className="font-mono text-[8px] tracking-widest text-[#555] uppercase mb-[6px]">Recent Timeline</div>
                      {(dossier.timeline || []).slice(0, 5).map((t, i) => (
                        <div key={i} className="flex gap-[7px] py-[3px]">
                          <span className="w-[6px] h-[6px] rounded-full bg-[#d4a017] mt-[3px] shrink-0" />
                          <div>
                            <div className="text-[10px] text-[#bbb]"><b className="text-[#e8e8e8]">{t.kind}</b> {t.label || t.description || ''}</div>
                            <div className="font-mono text-[8px] text-[#555]">{t.date || ''}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-[6px] pt-1">
                    <Link to={`/intel/person/${p.id}`} className="flex-1 text-center font-mono text-[8px] tracking-wide text-[#d4a017] border border-[#3a3a3a] rounded-[2px] py-[6px] uppercase">Full Dossier</Link>
                    <button onClick={() => setPanelMode('graph')} className="flex-1 text-center font-mono text-[8px] tracking-wide text-[#d4a017] border border-[#3a3a3a] rounded-[2px] py-[6px] uppercase">Graph</button>
                  </div>
                </div>
              );
            })()}
            {!loading && !dossier && <div className="text-[10px] text-[#555]">No dossier for this entity.</div>}
          </>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelContextPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/IntelContextPanel.tsx client/src/pages/intel/__tests__/IntelContextPanel.test.tsx
git commit -m "feat(intel): right context panel (dossier peek + mini graph)"
```

---

## Task 8: `IntelRail` (left nav + badge counts)

**Files:**
- Create: `client/src/pages/intel/IntelRail.tsx`
- Test: `client/src/pages/intel/__tests__/IntelRail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/IntelRail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import IntelRail from '../IntelRail';

describe('IntelRail', () => {
  it('renders section links and badge counts', () => {
    render(<MemoryRouter initialEntries={['/intel']}>
      <IntelRail counts={{ watchlist: 7, bolos: 3, alerts: 5, queues: 12, aiOnline: false }} />
    </MemoryRouter>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('BOLO Board')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();   // watchlist badge
    expect(screen.getByText('OFFLINE')).toBeInTheDocument(); // AI badge
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelRail.test.tsx`
Expected: FAIL — cannot find `../IntelRail`.

- [ ] **Step 3: Implement the rail**

Create `client/src/pages/intel/IntelRail.tsx`:

```tsx
// Left rail nav for the Intel Portal. NavLink active state highlights the
// current section; badge counts come from the dashboard overview poll.
import { NavLink } from 'react-router-dom';

export interface RailCounts { watchlist: number; bolos: number; alerts: number; queues: number; aiOnline: boolean }

interface Item { to: string; label: string; icon: string; end?: boolean; badge?: number; badgeRed?: boolean; off?: boolean }

export default function IntelRail({ counts }: { counts: RailCounts }) {
  const groups: Array<{ title: string; items: Item[] }> = [
    { title: 'Workspace', items: [
      { to: '/intel', label: 'Dashboard', icon: '▦', end: true },
      { to: '/intel/search', label: 'Search', icon: '⌕' },
      { to: '/intel/connections', label: 'Connections', icon: '◈' },
    ]},
    { title: 'Watch & Alert', items: [
      { to: '/intel/watchlist', label: 'Watchlist', icon: '◉', badge: counts.watchlist },
      { to: '/intel/bolos', label: 'BOLO Board', icon: '⚑', badge: counts.bolos, badgeRed: true },
      { to: '/intel/alerts', label: 'Alerts', icon: '▲', badge: counts.alerts, badgeRed: true },
    ]},
    { title: 'Sources', items: [
      { to: '/intel/jail', label: 'Jail / Bookings', icon: '⛓' },
      { to: '/intel/plate-log', label: 'Plate Sightings', icon: '🚗' },
      { to: '/intel/queues', label: 'Review Queues', icon: '⚐', badge: counts.queues },
    ]},
    { title: 'Intelligence', items: [
      { to: '/intel/map', label: 'Map', icon: '◎' },
      { to: '/intel/ai', label: 'AI Analyst', icon: '✦', off: !counts.aiOnline },
      { to: '/intel/reports', label: 'Intel Products', icon: '▤' },
    ]},
  ];

  return (
    <nav className="w-[168px] bg-[#050505] border-r border-[#232323] py-2 overflow-y-auto shrink-0">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="font-mono text-[8px] tracking-widest text-[#444] px-[14px] pt-[10px] pb-[5px] uppercase">{g.title}</div>
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end}
              className={({ isActive }) =>
                `flex items-center gap-[9px] px-[14px] py-[7px] text-[12px] border-l-2 ${
                  isActive ? 'bg-[#0c0c0c] text-white border-[#d4a017]' : 'text-[#bdbdbd] border-transparent'}`}>
              <span className="w-[14px] text-center text-[#777]">{it.icon}</span>
              <span>{it.label}</span>
              {typeof it.badge === 'number' && it.badge > 0 && (
                <span className={`ml-auto font-mono text-[9px] rounded-[2px] px-[5px] ${it.badgeRed ? 'bg-[#dc2626] text-white' : 'bg-[#d4a017] text-black'}`}>{it.badge}</span>
              )}
              {it.off && <span className="ml-auto font-mono text-[7px] text-[#888] border border-[#333] rounded-[2px] px-[4px] tracking-wide">OFFLINE</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelRail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/IntelRail.tsx client/src/pages/intel/__tests__/IntelRail.test.tsx
git commit -m "feat(intel): left rail nav with live badge counts"
```

---

## Task 9: Thin sections + placeholder

**Files:**
- Create: `client/src/pages/intel/ReviewQueues.tsx`
- Create: `client/src/pages/intel/WatchlistSection.tsx`
- Create: `client/src/pages/intel/AlertsSection.tsx`
- Create: `client/src/pages/intel/IntelComingSoon.tsx`
- Test: `client/src/pages/intel/__tests__/ReviewQueues.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/ReviewQueues.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ReviewQueues from '../ReviewQueues';

// Both child panels fetch on mount; stub apiFetch to return empty arrays.
vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn(async () => []) }));

describe('ReviewQueues', () => {
  it('renders the section heading', () => {
    render(<ReviewQueues />);
    expect(screen.getByText(/Review Queues/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/ReviewQueues.test.tsx`
Expected: FAIL — cannot find `../ReviewQueues`.

- [ ] **Step 3: Implement the sections**

Create `client/src/pages/intel/ReviewQueues.tsx` (composes the two existing review strips):

```tsx
import ResolutionReviewPanel from '../../components/ResolutionReviewPanel';
import SuggestedLinksPanel from '../../components/SuggestedLinksPanel';

export default function ReviewQueues() {
  return (
    <div className="p-3 space-y-3">
      <div className="font-mono text-[10px] tracking-widest text-[#888] uppercase">Review Queues</div>
      <SuggestedLinksPanel />
      <ResolutionReviewPanel />
      <div className="text-[10px] text-[#555]">Confirm or dismiss suggested links and possible duplicate persons above. Empty queues hide themselves.</div>
    </div>
  );
}
```

Create `client/src/pages/intel/WatchlistSection.tsx`:

```tsx
// Thin watchlist list. Reuses the existing /intel/watchlist endpoint.
import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { useIntelContext } from './IntelContext';

interface Watch { entity_type: string; entity_id: number; reason: string; label?: string; created_at: string }

export default function WatchlistSection() {
  const [rows, setRows] = useState<Watch[]>([]);
  const { selectEntity } = useIntelContext();
  useEffect(() => { apiFetch<Watch[]>('/intel/watchlist').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])); }, []);
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[10px] tracking-widest text-[#888] uppercase">Watchlist ({rows.length})</div>
      {rows.length === 0 && <div className="text-[10px] text-[#555]">No active watches.</div>}
      {rows.map((w) => (
        <button key={`${w.entity_type}:${w.entity_id}`} onClick={() => selectEntity(w.entity_type, w.entity_id, w.label || `Entity #${w.entity_id}`)}
          className="w-full text-left flex items-center gap-2 bg-[#070707] border border-[#1f1f1f] rounded-[2px] px-2 py-[6px]">
          <span className="text-[11px] text-[#e8e8e8] flex-1 truncate">{w.label || `${w.entity_type} #${w.entity_id}`}</span>
          <span className="text-[10px] text-[#666] truncate max-w-[160px]">{w.reason}</span>
        </button>
      ))}
    </div>
  );
}
```

Create `client/src/pages/intel/AlertsSection.tsx`:

```tsx
// Intel alerts surface — reads the overview alert feed (warrants / officer
// safety / gang / BOLO). A focused, full-height view of the dashboard widget.
import { useIntelOverview } from './useIntelOverview';
import { useIntelContext } from './IntelContext';
import ActiveAlertsWidget from './widgets/ActiveAlertsWidget';

export default function AlertsSection() {
  const { data } = useIntelOverview();
  const { selectEntity } = useIntelContext();
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[10px] tracking-widest text-[#888] uppercase">Alerts</div>
      <ActiveAlertsWidget rows={data?.alerts || []} onSelect={selectEntity} />
    </div>
  );
}
```

Create `client/src/pages/intel/IntelComingSoon.tsx`:

```tsx
// Honest placeholder for portal sections whose own implementation plan hasn't
// landed yet. NOT a stub that fakes data — it states plainly what's coming.
export default function IntelComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="p-6">
      <div className="max-w-md border border-[#3a3a3a] border-l-[3px] border-l-[#d4a017] bg-[#070707] rounded-[2px] p-4">
        <div className="font-mono text-[9px] tracking-widest text-[#d4a017] uppercase">{phase}</div>
        <div className="text-[15px] text-white mt-1">{title}</div>
        <p className="text-[11px] text-[#888] mt-2 leading-relaxed">
          This section is part of the Intel Portal program and ships in its own plan. The portal shell, navigation,
          and right-hand context panel are live now; this surface activates when its build lands.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/ReviewQueues.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/ReviewQueues.tsx client/src/pages/intel/WatchlistSection.tsx client/src/pages/intel/AlertsSection.tsx client/src/pages/intel/IntelComingSoon.tsx client/src/pages/intel/__tests__/ReviewQueues.test.tsx
git commit -m "feat(intel): watchlist/alerts/queues sections + coming-soon placeholder"
```

---

## Task 10: `IntelPortalLayout` (the tri-pane shell)

**Files:**
- Create: `client/src/pages/intel/IntelPortalLayout.tsx`
- Test: `client/src/pages/intel/__tests__/IntelPortalLayout.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/IntelPortalLayout.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelPortalLayout from '../IntelPortalLayout';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    stats: { active_warrants: 1, on_watchlist: 2, gang_flagged: 0 },
    watchlist_activity: [], alerts: [], escalation_leaderboard: [],
    jail_cross_hits: [], plate_sightings: [],
    queues: { link_suggestions: 0, resolution_pairs: 0 }, bolos: { active: 0, high_priority: 0 },
  })),
}));

describe('IntelPortalLayout', () => {
  it('renders rail, child outlet, and context panel', async () => {
    render(
      <MemoryRouter initialEntries={['/intel/x']}>
        <Routes>
          <Route path="/intel" element={<IntelPortalLayout />}>
            <Route path="x" element={<div>child-surface</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument()); // rail
    expect(screen.getByText('child-surface')).toBeInTheDocument();                   // outlet
    expect(screen.getByText(/Select an entity/i)).toBeInTheDocument();               // context panel
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelPortalLayout.test.tsx`
Expected: FAIL — cannot find `../IntelPortalLayout`.

- [ ] **Step 3: Implement the layout**

Create `client/src/pages/intel/IntelPortalLayout.tsx`:

```tsx
// Tri-pane Intel Portal shell: left rail · center <Outlet/> · right context
// panel. Mounts IntelProvider so every child surface shares one selection
// and one panel. Rail badge counts piggyback on the dashboard overview poll.
import { Outlet } from 'react-router-dom';
import { IntelProvider } from './IntelContext';
import IntelRail from './IntelRail';
import IntelContextPanel from './IntelContextPanel';
import { useIntelOverview } from './useIntelOverview';

function PortalChrome() {
  const { data } = useIntelOverview();
  const counts = {
    watchlist: data?.stats.on_watchlist ?? 0,
    bolos: data?.bolos.active ?? 0,
    alerts: data?.alerts.length ?? 0,
    queues: (data?.queues.link_suggestions ?? 0) + (data?.queues.resolution_pairs ?? 0),
    aiOnline: false, // flips true in the AI Analyst plan once a provider is detected
  };
  return (
    <div className="flex h-[calc(100vh-var(--app-header-h,72px))] min-h-[480px] bg-black">
      <IntelRail counts={counts} />
      <main className="flex-1 overflow-y-auto min-w-0">
        <Outlet />
      </main>
      <IntelContextPanel />
    </div>
  );
}

export default function IntelPortalLayout() {
  return (
    <IntelProvider>
      <PortalChrome />
    </IntelProvider>
  );
}
```

> Note on height: `--app-header-h` may not be defined globally; the `calc()` falls back to `72px`. During the browser smoke (Task 12) confirm the portal fills the viewport under the global header without a double scrollbar; if the header height differs, set the fallback to match or use `h-full` if `Layout`'s outlet wrapper already constrains height.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/pages/intel/__tests__/IntelPortalLayout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/IntelPortalLayout.tsx client/src/pages/intel/__tests__/IntelPortalLayout.test.tsx
git commit -m "feat(intel): tri-pane IntelPortalLayout shell"
```

---

## Task 11: Wire nested routes in `App.tsx`

**Files:**
- Modify: `client/src/App.tsx` (lazy declarations near line 118; routes at 466-475)

- [ ] **Step 1: Add lazy imports for the new portal components**

Near the existing intel lazy declarations (after line 122, `PersonDossierPage`), add:

```tsx
const IntelPortalLayout = lazyRetry(() => import('./pages/intel/IntelPortalLayout'));
const IntelDashboard = lazyRetry(() => import('./pages/intel/IntelDashboard'));
const WatchlistSection = lazyRetry(() => import('./pages/intel/WatchlistSection'));
const AlertsSection = lazyRetry(() => import('./pages/intel/AlertsSection'));
const ReviewQueues = lazyRetry(() => import('./pages/intel/ReviewQueues'));
const IntelComingSoon = lazyRetry(() => import('./pages/intel/IntelComingSoon'));
```

- [ ] **Step 2: Replace the flat `/intel` routes with a nested layout route**

Replace `client/src/App.tsx:466-475` (the block from `<Route path="/intel" …IntelSearchPage…/>` through `<Route path="/intel/workbench" …/>`) with:

```tsx
            <Route path="/intel" element={<RouteErrorBoundary><IntelPortalLayout /></RouteErrorBoundary>}>
              <Route index element={<IntelDashboard />} />
              <Route path="search" element={<IntelSearchPage />} />
              <Route path="connections" element={<ConnectionsPage />} />
              <Route path="watchlist" element={<WatchlistSection />} />
              <Route path="bolos" element={<IntelComingSoon title="BOLO Board" phase="Phase · BOLO" />} />
              <Route path="alerts" element={<AlertsSection />} />
              <Route path="jail" element={<JailRecordsPage />} />
              <Route path="plate-log" element={<PlateLogPage />} />
              <Route path="queues" element={<ReviewQueues />} />
              <Route path="map" element={<IntelComingSoon title="Map / Geospatial Intel" phase="Phase · Map" />} />
              <Route path="ai" element={<IntelComingSoon title="AI Analyst" phase="Phase · AI (offline-gated)" />} />
              <Route path="reports" element={<IntelReportsPage />} />
              <Route path="reports/:id" element={<IntelReportDetailPage />} />
              <Route path="sources" element={<IntelSourcesPage />} />
              <Route path="quick-capture" element={<QuickCapturePage />} />
              <Route path="record" element={<InteractionRecorderPage />} />
              <Route path="person/:id" element={<PersonDossierPage />} />
              <Route path="workbench" element={<ConnectionsPage />} />
            </Route>
```

> All child `element`s render inside the portal's center `<Outlet/>`. `IntelSearchPage` stays as `/intel/search` (Plan 2 supercharges it). The `/connections` top-level route (line 465) is left intact as a standalone alias.

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: PASS. (If an adopted page like `JailRecordsPage` isn't already lazy-declared in App.tsx, it is — they were imported for the old flat routes; no new import needed beyond Step 1.)

- [ ] **Step 4: Build the client**

Run: `cd client && npx vite build`
Expected: PASS (bundles the new chunk).

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(intel): mount /intel as nested tri-pane portal routes"
```

---

## Task 12: Adopt-page chrome + browser smoke

Adopted pages (`JailRecordsPage`, `PlateLogPage`, `ConnectionsPage`, `IntelReportsPage`, etc.) currently render their own `PanelTitleBar` + outer `p-4` padding. Inside the portal they get a double-header. This task verifies behavior and trims only where it looks wrong.

**Files:**
- Possibly modify adopted pages (only the outer wrapper padding/title), case-by-case.

- [ ] **Step 1: Run the client dev server**

Run: `cd client && npm run dev` (Vite on 5173). In a separate shell run the Worker: `npm run dev` (wrangler on 8787).

- [ ] **Step 2: Smoke the portal in a browser**

Open `http://localhost:5173/intel`. Verify:
- Rail renders with all sections + badge counts; clicking each navigates within the shell (no full reload).
- Dashboard shows stat tiles + 6 widgets (data may be sparse locally — that's fine; widgets show their empty states).
- Clicking a dashboard person row opens the right panel Dossier Peek; the DOSSIER/GRAPH toggle works; collapse (⟨) and expand (⟩) work and survive a reload (localStorage).
- `/intel/jail`, `/intel/plate-log`, `/intel/connections`, `/intel/reports` render inside the center pane.
- `/intel/bolos`, `/intel/map`, `/intel/ai` show the clearly-labeled Coming-Soon placeholder.

- [ ] **Step 3: Trim double-chrome where needed**

For any adopted page that shows a redundant title bar or excessive top padding inside the shell, reduce the outer wrapper (e.g. change `p-4` → `p-3` or drop the duplicate `PanelTitleBar`). Make the **minimal** change; do not refactor the page. If a page looks fine, leave it.

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add client/src/pages/<adjusted-page>.tsx
git commit -m "fix(intel): trim adopted-page chrome inside the portal shell"
```

---

## Task 13: Service worker bump + full verification + push

**Files:**
- Modify: `client/public/sw.js` (`CACHE_NAME`)

- [ ] **Step 1: Bump the service-worker cache name**

In `client/public/sw.js`, find `CACHE_NAME` and increment its version (e.g. `rmpg-flex-vNNN` → `rmpg-flex-v<NNN+1>`).

Run: `cd client && grep -n "CACHE_NAME" public/sw.js`
Expected: shows the new, higher version.

- [ ] **Step 2: Full client verification**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: typecheck PASS, all vitest tests PASS (including the new intel tests), build PASS.

- [ ] **Step 3: Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit + push the branch**

```bash
git add client/public/sw.js
git commit -m "chore(intel): bump SW cache for Intel Portal foundation"
git push -u origin claude/hopeful-bhabha-b1ccce
```

> Per the repo's PR-flow rule, do NOT push to main. The branch push + `gh pr create` happens after the remaining plans (Search, BOLO, Map, AI) land on the same branch, OR open a draft PR now if shipping the foundation independently. Decide with the user.

---

## Self-Review

**Spec coverage (foundation portion of `2026-06-13-intel-portal-design.md`):**
- §2 tri-pane shell + nested routing → Tasks 10, 11 ✓
- §3 component architecture (IntelContext seam, adopted pages, widget files) → Tasks 3, 5, 9, 10, 11 ✓
- §4 dashboard + `/api/intel/overview` (3 tiles + 6 widgets, try/catch isolation, 20s poll) → Tasks 2, 4, 5, 6 ✓
- §6 right context panel (dossier peek + mini graph, collapsible, localStorage) → Tasks 3, 7 ✓
- §9 placeholder AI section offline-gated (rail badge + coming-soon) → Tasks 8, 9, 11 ✓
- §11 polling (visibility-paused 20s) → Task 4 ✓
- §13 design tokens → enforced in every component task ✓
- §16 SW bump + PR flow → Task 13 ✓
- BOLO/Map/AI/supercharged-search **deferred to their own plans** by design — represented here only as placeholders + rail entries. Not a gap.

**Placeholder scan:** No "TBD/TODO/handle appropriately" — every code step has complete code. The `IntelComingSoon` component is an intentional, labeled product placeholder, not a plan placeholder.

**Type consistency:** `IntelOverview` shape is identical in `src/utils/intelOverview.ts` (worker) and `client/src/pages/intel/useIntelOverview.ts` (client) and consumed unchanged by widgets/dashboard. `selectEntity(type, id, label)` signature is consistent across IntelContext, widgets, sections, and the panel. `RailCounts` matches what `PortalChrome` builds. `ConnectionsGraphPanel` is called with `{ personId, personName }` exactly as its `Props` define.

**Risk recheck:** worker SQL is verified against live D1 in Task 2 Step 3; adopted-page chrome is verified in Task 12; portal height fallback is flagged in Task 10's note.
