# Serve Analytics Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a role-gated "Analytics" tab to `ServePage.tsx` that wires the already-built, zero-caller `src/routes/serveDashboard.ts` backend (11 of its 12 endpoints — `stale-attempts` is intentionally skipped as redundant) into a working supervisor-facing UI: daily counts, per-officer performance, success-rate breakdowns, workload with drill-down timeline, weekly trend, county breakdown, CSV/JSON export, and two bulk actions (reassign / status update).

**Architecture:** One new tab component (`client/src/pages/serve/AnalyticsTab.tsx`) added as an 8th `TABS` entry in `ServePage.tsx`, plus one new small modal component (`client/src/components/serve/AttemptTimelineModal.tsx`) for the per-job drill-down. No backend changes — all 11 routes are already live and correct. Follows the existing `PerformanceTab.tsx` per-section-fetch, per-section-error-state convention (no shared data layer, no new hooks).

**Tech Stack:** React 18 + TypeScript, existing `apiFetch`/`useAuth`/`useToast` client utilities, Tailwind theme tokens (no hardcoded hex, no `rounded-lg`), no new dependencies.

---

## File Structure

- **Modify:** `client/src/pages/ServePage.tsx` — add `'Analytics'` to `TABS`, add role-gated tab button + render branch, add lazy import.
- **Create:** `client/src/pages/serve/AnalyticsTab.tsx` — the tab body: range selector, 7 read panels, export button, bulk-actions panel.
- **Create:** `client/src/components/serve/AttemptTimelineModal.tsx` — modal showing one `serve_queue` job's full attempt/activity timeline, invoked from the workload panel's drill-down.

No existing file needs splitting — `PerformanceTab.tsx` (236 lines) is the established size/shape for a ServePage tab, and `AnalyticsTab.tsx` will be larger (8 panels) but stays a single cohesive "one page, one tab" unit consistent with that pattern. The timeline modal is pulled into its own file because it's reused conceptually across two future call-sites in the deferred `serveQueueEnhanced` work — giving it a clean boundary now avoids a copy-paste later.

## Type Reference (for all tasks below)

These interfaces describe the exact JSON shapes returned by `src/routes/serveDashboard.ts` (verified by reading the route file directly — do not guess field names, use these).

```typescript
// client/src/pages/serve/AnalyticsTab.tsx — top of file, alongside imports

interface DailySummary {
  date: string;
  total: number;
  pending: number;
  assigned: number;
  in_progress: number;
  served: number;
  failed: number;
  attempted: number;
  percentages: {
    pending: number; assigned: number; in_progress: number;
    served: number; failed: number; attempted: number;
  };
}

interface ServerPerformanceRow {
  officer_id: number;
  officer_name: string;
  total_attempts: number;
  successful_attempts: number;
  queues_served: number;
  success_rate: number;
  avg_attempts_per_serve: number;
  fastest_serve_hours: number | null;
}
interface ServerPerformanceResponse {
  period_days: number;
  servers: ServerPerformanceRow[];
}

interface SuccessByTypeRow {
  attempt_type: string;
  total: number;
  successful: number;
  failed: number;
  other: number;
  success_rate: number;
}
interface SuccessByTypeResponse {
  period_days: number;
  types: SuccessByTypeRow[];
}

interface TimeToServeResponse {
  period_days: number;
  sample_size: number;
  avg_days: number;
  median_days: number;
  p90_days: number;
}

interface WorkloadRow {
  officer_id: number;
  officer_name: string;
  assigned_count: number;
  overdue_count: number;
  todays_attempts: number;
  over_capacity: boolean;
}
interface WorkloadResponse {
  capacity_threshold: number;
  servers: WorkloadRow[];
  over_capacity_count: number;
}

interface WeeklyTrendRow {
  week_start: string;
  total_attempts: number;
  successful_attempts: number;
  queues_served: number;
  queues_created: number;
  success_rate: number;
}
interface WeeklyTrendResponse {
  period_weeks: number;
  weeks: WeeklyTrendRow[];
}

interface CountyRow {
  city: string;
  total: number;
  served: number;
  failed: number;
  pending: number;
  success_rate: number;
  avg_attempts: number;
}
interface CountyBreakdownResponse {
  period_days: number;
  regions: CountyRow[];
}

interface BulkReassignResponse {
  success: boolean;
  reassigned_count: number;
  reassigned_attempt_ids: number[];
  skipped_attempt_ids: number[];
  affected_queue_ids: number[];
}

interface BulkStatusResponse {
  success: boolean;
  updated_queue_count: number;
  affected_queue_ids: number[];
  status: string;
}
```

```typescript
// client/src/components/serve/AttemptTimelineModal.tsx — top of file

interface TimelineEntry {
  type: 'attempt' | 'activity';
  timestamp: string;
  data: any; // shape varies by type — rendered defensively, see Task 6
}
interface AttemptTimelineResponse {
  queue_id: number;
  queue: any; // full serve_queue row + officer_name — only a few fields are rendered
  total_attempts: number;
  total_activities: number;
  timeline: TimelineEntry[];
}
```

Existing types reused as-is (already defined in `client/src/types/index.ts`): `ServeJob` (has `.attempts?: ServeAttempt[]`), `ServeAttempt`.

---

### Task 1: Wire the "Analytics" tab shell into ServePage.tsx

**Files:**
- Modify: `client/src/pages/ServePage.tsx:21` (imports), `:52` (`TABS`), `:1471-1497` (tab button list), `:2042` (render branch)
- Create: `client/src/pages/serve/AnalyticsTab.tsx` (skeleton only — filled in by later tasks)

- [ ] **Step 1: Create the skeleton tab file**

```typescript
// client/src/pages/serve/AnalyticsTab.tsx
import { BarChart3 } from 'lucide-react';

export default function AnalyticsTab() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 size={14} className="text-brand-gold-500" />
        <span className="text-[11px] font-semibold text-rmpg-100 uppercase tracking-wider">Analytics</span>
      </div>
      <div className="text-[11px] text-rmpg-500 text-center py-6">Loading analytics…</div>
    </div>
  );
}
```

- [ ] **Step 2: Add the import in ServePage.tsx**

At `client/src/pages/ServePage.tsx:21`, right after the existing `PerformanceTab` import:

```typescript
import PerformanceTab from './serve/PerformanceTab';
import AnalyticsTab from './serve/AnalyticsTab';
```

- [ ] **Step 3: Add `'Analytics'` to the TABS const**

At `client/src/pages/ServePage.tsx:52`, change:

```typescript
const TABS = ['Queue', 'Route', 'Map', 'Stats', 'Assign', 'My Run', 'Performance'] as const;
```
to:
```typescript
const TABS = ['Queue', 'Route', 'Map', 'Stats', 'Assign', 'My Run', 'Performance', 'Analytics'] as const;
```

- [ ] **Step 4: Role-gate the tab button**

Find the tab-filtering logic around `client/src/pages/ServePage.tsx:1471-1474`:

```typescript
{TABS.filter(tab => {
  ...
  if (tab === 'Performance') return ['admin', 'manager', 'supervisor', 'officer'].includes(role);
  return true;
})
```

Add an `Analytics` case right after the `Performance` line (Analytics is stricter — no `officer` role, matching the backend's `DASHBOARD_ROLES` guard):

```typescript
{TABS.filter(tab => {
  ...
  if (tab === 'Performance') return ['admin', 'manager', 'supervisor', 'officer'].includes(role);
  if (tab === 'Analytics') return ['admin', 'manager', 'supervisor'].includes(role);
  return true;
})
```

- [ ] **Step 5: Add the tab icon mapping**

Find the icon-mapping ternary around `client/src/pages/ServePage.tsx:1484`:

```typescript
tab === 'Performance' ? BarChart3 :
```

Add directly after it (reuse the same `BarChart3` import already present in `ServePage.tsx` — do not add a duplicate import):

```typescript
tab === 'Performance' ? BarChart3 :
tab === 'Analytics' ? LineChart :
```

`LineChart` is a new lucide icon for this file — add it to the existing `lucide-react` import block at the top of `ServePage.tsx` (find the multi-line `import { ... } from 'lucide-react';` block starting at line 10 and add `LineChart` to the list).

- [ ] **Step 6: Add the render branch**

At `client/src/pages/ServePage.tsx:2042`, right after the existing Performance branch:

```typescript
{activeTab === 'Performance' && ['admin','manager','supervisor','officer'].includes(user?.role ?? '') && <PerformanceTab />}
{activeTab === 'Analytics' && ['admin','manager','supervisor'].includes(user?.role ?? '') && <AnalyticsTab />}
```

- [ ] **Step 7: Manual verification**

Run: `cd client && npm run dev` (or use the project's `preview_start` dev server tool)
Log in as an `admin`/`manager`/`supervisor` user, navigate to Serve page → confirm an "Analytics" tab appears and renders "Loading analytics…". Log in as (or switch role-check locally to simulate) `officer` → confirm the tab does NOT appear.

- [ ] **Step 8: Typecheck and commit**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

```bash
git add client/src/pages/ServePage.tsx client/src/pages/serve/AnalyticsTab.tsx
git commit -m "feat(serve): add role-gated Analytics tab shell to ServePage"
```

---

### Task 2: Daily summary panel + shared range selector

**Files:**
- Modify: `client/src/pages/serve/AnalyticsTab.tsx`

- [ ] **Step 1: Replace the skeleton with state, fetch logic, and the daily-summary panel**

```typescript
// client/src/pages/serve/AnalyticsTab.tsx
import { useState, useEffect, useCallback } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';

type RangeDays = 7 | 30 | 90;

interface DailySummary {
  date: string;
  total: number;
  pending: number;
  assigned: number;
  in_progress: number;
  served: number;
  failed: number;
  attempted: number;
  percentages: {
    pending: number; assigned: number; in_progress: number;
    served: number; failed: number; attempted: number;
  };
}

const STATUS_LABELS: Record<keyof DailySummary['percentages'], string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  served: 'Served',
  failed: 'Failed',
  attempted: 'Attempted',
};

const STATUS_COLORS: Record<keyof DailySummary['percentages'], string> = {
  pending: 'text-rmpg-300',
  assigned: 'text-brand-400',
  in_progress: 'text-amber-400',
  served: 'text-green-400',
  failed: 'text-red-400',
  attempted: 'text-purple-400',
};

export default function AnalyticsTab() {
  const { addToast } = useToast();
  const [range, setRange] = useState<RangeDays>(30);
  const [refreshKey, setRefreshKey] = useState(0);

  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyError, setDailyError] = useState<string | null>(null);

  const fetchDaily = useCallback(async () => {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const data = await apiFetch<DailySummary>('/serve-dashboard/daily-summary');
      setDaily(data);
    } catch (err: any) {
      setDailyError(err?.message || 'Failed to load daily summary');
    } finally {
      setDailyLoading(false);
    }
  }, []);

  useEffect(() => { fetchDaily(); }, [fetchDaily, refreshKey]);

  const refreshAll = () => setRefreshKey((k) => k + 1);

  return (
    <div className="p-4 space-y-4">
      {/* ── Header + shared range selector ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-brand-gold-500" />
          <span className="text-[11px] font-semibold text-rmpg-100 uppercase tracking-wider">Analytics</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-px text-[10px]">
            {([7, 30, 90] as RangeDays[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRange(d)}
                className={`px-2 py-0.5 rounded-[2px] transition-colors ${
                  range === d
                    ? 'bg-brand-gold-500/20 text-brand-gold-400 border border-brand-gold-500/30'
                    : 'text-rmpg-400 hover:text-rmpg-200 border border-transparent'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={refreshAll}
            className="p-1 text-rmpg-400 hover:text-rmpg-200 transition-colors"
            aria-label="Refresh analytics"
          >
            <RefreshCw size={12} className={dailyLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Daily summary ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-2">
        <div className="text-[9px] text-rmpg-500 uppercase font-semibold tracking-wider">
          Today {daily ? `· ${daily.date}` : ''}
        </div>
        {dailyError && <div className="text-[10px] text-red-400">{dailyError}</div>}
        {!dailyError && daily && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
            {(Object.keys(STATUS_LABELS) as Array<keyof DailySummary['percentages']>).map((key) => (
              <div key={key}>
                <div className={`text-xl font-bold tabular-nums font-mono ${STATUS_COLORS[key]}`}>
                  {daily[key]}
                </div>
                <div className="text-[9px] text-rmpg-400 mt-0.5">{STATUS_LABELS[key]}</div>
                <div className="text-[8px] text-rmpg-500">{daily.percentages[key]}%</div>
              </div>
            ))}
          </div>
        )}
        {!dailyError && !daily && !dailyLoading && (
          <div className="text-[11px] text-rmpg-500 text-center py-4">No data for today.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Reload the Analytics tab in the dev server preview. Confirm the six status counts render with matching percentages against a `SELECT COUNT(*) FROM serve_queue WHERE DATE(created_at) = DATE('now','localtime')` check on local D1 (`npm run migrate:local` environment, or inspect via `wrangler d1 execute --local`).

- [ ] **Step 3: Typecheck and commit**

Run: `cd client && npx tsc --noEmit`

```bash
git add client/src/pages/serve/AnalyticsTab.tsx
git commit -m "feat(serve): wire daily-summary panel + shared range selector in Analytics tab"
```

---

### Task 3: Server-performance, success-rate-by-type, county-breakdown panels

**Files:**
- Modify: `client/src/pages/serve/AnalyticsTab.tsx`

- [ ] **Step 1: Add the three response interfaces above the component** (insert after the `DailySummary`-related types from Task 2, before `export default function AnalyticsTab()`)

```typescript
interface ServerPerformanceRow {
  officer_id: number;
  officer_name: string;
  total_attempts: number;
  successful_attempts: number;
  queues_served: number;
  success_rate: number;
  avg_attempts_per_serve: number;
  fastest_serve_hours: number | null;
}
interface ServerPerformanceResponse {
  period_days: number;
  servers: ServerPerformanceRow[];
}

interface SuccessByTypeRow {
  attempt_type: string;
  total: number;
  successful: number;
  failed: number;
  other: number;
  success_rate: number;
}
interface SuccessByTypeResponse {
  period_days: number;
  types: SuccessByTypeRow[];
}

interface CountyRow {
  city: string;
  total: number;
  served: number;
  failed: number;
  pending: number;
  success_rate: number;
  avg_attempts: number;
}
interface CountyBreakdownResponse {
  period_days: number;
  regions: CountyRow[];
}

function rateColor(rate: number): string {
  return rate >= 80 ? 'text-green-400' : rate >= 60 ? 'text-amber-400' : 'text-red-400';
}
```

- [ ] **Step 2: Add state + fetch functions inside the component, right after the `daily`-related state block**

```typescript
  const [serverPerf, setServerPerf] = useState<ServerPerformanceResponse | null>(null);
  const [serverPerfError, setServerPerfError] = useState<string | null>(null);

  const [successByType, setSuccessByType] = useState<SuccessByTypeResponse | null>(null);
  const [successByTypeError, setSuccessByTypeError] = useState<string | null>(null);

  const [countyBreakdown, setCountyBreakdown] = useState<CountyBreakdownResponse | null>(null);
  const [countyError, setCountyError] = useState<string | null>(null);

  const fetchServerPerf = useCallback(async () => {
    setServerPerfError(null);
    try {
      const data = await apiFetch<ServerPerformanceResponse>(`/serve-dashboard/server-performance?days=${range}`);
      setServerPerf(data);
    } catch (err: any) {
      setServerPerfError(err?.message || 'Failed to load server performance');
    }
  }, [range]);

  const fetchSuccessByType = useCallback(async () => {
    setSuccessByTypeError(null);
    try {
      const data = await apiFetch<SuccessByTypeResponse>(`/serve-dashboard/success-rate-by-type?days=${range}`);
      setSuccessByType(data);
    } catch (err: any) {
      setSuccessByTypeError(err?.message || 'Failed to load success rates');
    }
  }, [range]);

  const fetchCountyBreakdown = useCallback(async () => {
    setCountyError(null);
    try {
      const data = await apiFetch<CountyBreakdownResponse>(`/serve-dashboard/county-breakdown?days=${range}`);
      setCountyBreakdown(data);
    } catch (err: any) {
      setCountyError(err?.message || 'Failed to load county breakdown');
    }
  }, [range]);

  useEffect(() => { fetchServerPerf(); }, [fetchServerPerf, refreshKey]);
  useEffect(() => { fetchSuccessByType(); }, [fetchSuccessByType, refreshKey]);
  useEffect(() => { fetchCountyBreakdown(); }, [fetchCountyBreakdown, refreshKey]);
```

- [ ] **Step 3: Render the three panels** — insert after the daily-summary panel's closing `</div>` from Task 2, before the component's final closing tags

```typescript
      {/* ── Server performance ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
        <div className="px-3 py-2 border-b border-rmpg-700">
          <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">
            Server Performance · {range}d
          </span>
        </div>
        {serverPerfError && <div className="text-[10px] text-red-400 px-3 py-2">{serverPerfError}</div>}
        {!serverPerfError && (serverPerf?.servers.length ?? 0) > 0 && (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-rmpg-800">
                <th className="text-left px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Officer</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Rate</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Avg Attempts</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Fastest (hrs)</th>
              </tr>
            </thead>
            <tbody>
              {serverPerf!.servers.map((s) => (
                <tr key={s.officer_id} className="border-b border-rmpg-800 last:border-0">
                  <td className="px-3 py-[2px] text-rmpg-200">{s.officer_name}</td>
                  <td className={`px-3 py-[2px] text-right tabular-nums font-mono font-semibold ${rateColor(s.success_rate)}`}>
                    {s.success_rate}%
                  </td>
                  <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{s.avg_attempts_per_serve}</td>
                  <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">
                    {s.fastest_serve_hours != null ? s.fastest_serve_hours.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!serverPerfError && (serverPerf?.servers.length ?? 0) === 0 && (
          <div className="text-[11px] text-rmpg-500 text-center py-4">No attempts in this period.</div>
        )}
      </div>

      {/* ── Success rate by type + county breakdown (side by side) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
          <div className="px-3 py-2 border-b border-rmpg-700">
            <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Success Rate by Type</span>
          </div>
          {successByTypeError && <div className="text-[10px] text-red-400 px-3 py-2">{successByTypeError}</div>}
          {!successByTypeError && (successByType?.types.length ?? 0) > 0 && (
            <table className="w-full text-[10px]">
              <tbody>
                {successByType!.types.map((t) => (
                  <tr key={t.attempt_type} className="border-b border-rmpg-800 last:border-0">
                    <td className="px-3 py-[2px] text-rmpg-200 capitalize">{t.attempt_type}</td>
                    <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{t.total}</td>
                    <td className={`px-3 py-[2px] text-right tabular-nums font-mono font-semibold ${rateColor(t.success_rate)}`}>
                      {t.success_rate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!successByTypeError && (successByType?.types.length ?? 0) === 0 && (
            <div className="text-[11px] text-rmpg-500 text-center py-4">No attempts in this period.</div>
          )}
        </div>

        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
          <div className="px-3 py-2 border-b border-rmpg-700">
            <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">By City</span>
          </div>
          {countyError && <div className="text-[10px] text-red-400 px-3 py-2">{countyError}</div>}
          {!countyError && (countyBreakdown?.regions.length ?? 0) > 0 && (
            <table className="w-full text-[10px]">
              <tbody>
                {countyBreakdown!.regions.map((r) => (
                  <tr key={r.city} className="border-b border-rmpg-800 last:border-0">
                    <td className="px-3 py-[2px] text-rmpg-200">{r.city}</td>
                    <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{r.total}</td>
                    <td className={`px-3 py-[2px] text-right tabular-nums font-mono font-semibold ${rateColor(r.success_rate)}`}>
                      {r.success_rate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!countyError && (countyBreakdown?.regions.length ?? 0) === 0 && (
            <div className="text-[11px] text-rmpg-500 text-center py-4">No jobs in this period.</div>
          )}
        </div>
      </div>
```

- [ ] **Step 4: Manual verification**

Reload the Analytics tab; toggle the 7d/30d/90d selector and confirm all three panels' numbers change together. Cross-check one row against a direct D1 query, e.g.:
`wrangler d1 execute rmpg-flex --local --command "SELECT COUNT(*) FROM serve_attempts WHERE attempt_at >= datetime('now','-30 days')"`

- [ ] **Step 5: Typecheck and commit**

Run: `cd client && npx tsc --noEmit`

```bash
git add client/src/pages/serve/AnalyticsTab.tsx
git commit -m "feat(serve): add server-performance, success-by-type, county-breakdown panels"
```

---

### Task 4: Time-to-serve + weekly-trend panels

**Files:**
- Modify: `client/src/pages/serve/AnalyticsTab.tsx`

- [ ] **Step 1: Add the two interfaces**

```typescript
interface TimeToServeResponse {
  period_days: number;
  sample_size: number;
  avg_days: number;
  median_days: number;
  p90_days: number;
}

interface WeeklyTrendRow {
  week_start: string;
  total_attempts: number;
  successful_attempts: number;
  queues_served: number;
  queues_created: number;
  success_rate: number;
}
interface WeeklyTrendResponse {
  period_weeks: number;
  weeks: WeeklyTrendRow[];
}
```

- [ ] **Step 2: Add state + fetch logic** — `time-to-serve` has its own independent range (default 90, matching the backend default) since it's a different unit than "activity in range":

```typescript
  const [ttsRange, setTtsRange] = useState<RangeDays>(90);
  const [timeToServe, setTimeToServe] = useState<TimeToServeResponse | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  const [weeklyTrend, setWeeklyTrend] = useState<WeeklyTrendResponse | null>(null);
  const [weeklyTrendError, setWeeklyTrendError] = useState<string | null>(null);

  const fetchTimeToServe = useCallback(async () => {
    setTtsError(null);
    try {
      const data = await apiFetch<TimeToServeResponse>(`/serve-dashboard/time-to-serve?days=${ttsRange}`);
      setTimeToServe(data);
    } catch (err: any) {
      setTtsError(err?.message || 'Failed to load time-to-serve');
    }
  }, [ttsRange]);

  const fetchWeeklyTrend = useCallback(async () => {
    setWeeklyTrendError(null);
    try {
      const data = await apiFetch<WeeklyTrendResponse>('/serve-dashboard/weekly-trend?weeks=12');
      setWeeklyTrend(data);
    } catch (err: any) {
      setWeeklyTrendError(err?.message || 'Failed to load weekly trend');
    }
  }, []);

  useEffect(() => { fetchTimeToServe(); }, [fetchTimeToServe, refreshKey]);
  useEffect(() => { fetchWeeklyTrend(); }, [fetchWeeklyTrend, refreshKey]);
```

- [ ] **Step 3: Render both panels** — insert after the success-rate/county grid from Task 3

```typescript
      {/* ── Time to serve ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Time to Serve</span>
          <div className="flex gap-px text-[10px]">
            {([7, 30, 90] as RangeDays[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setTtsRange(d)}
                className={`px-2 py-0.5 rounded-[2px] transition-colors ${
                  ttsRange === d
                    ? 'bg-brand-gold-500/20 text-brand-gold-400 border border-brand-gold-500/30'
                    : 'text-rmpg-400 hover:text-rmpg-200 border border-transparent'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {ttsError && <div className="text-[10px] text-red-400">{ttsError}</div>}
        {!ttsError && timeToServe && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-rmpg-100">{timeToServe.avg_days}</div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">Avg Days</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-rmpg-100">{timeToServe.median_days}</div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">Median Days</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-rmpg-100">{timeToServe.p90_days}</div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">P90 Days</div>
            </div>
          </div>
        )}
        {!ttsError && timeToServe && (
          <div className="text-[9px] text-rmpg-500 text-center">
            Based on {timeToServe.sample_size} successful serve(s) in the last {timeToServe.period_days} days
          </div>
        )}
      </div>

      {/* ── Weekly trend ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-1">
        <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Weekly Trend (12 weeks)</span>
        {weeklyTrendError && <div className="text-[10px] text-red-400">{weeklyTrendError}</div>}
        {!weeklyTrendError && (weeklyTrend?.weeks.length ?? 0) > 0 && (
          <div className="space-y-1 mt-2">
            {weeklyTrend!.weeks.map((w) => (
              <div key={w.week_start} className="flex items-center gap-2 text-[9px]">
                <span className="w-16 text-rmpg-400 tabular-nums shrink-0">{w.week_start}</span>
                <div className="flex-1 h-[6px] bg-rmpg-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${Math.min(w.success_rate, 100)}%` }}
                  />
                </div>
                <span className="w-10 text-right text-rmpg-300 tabular-nums shrink-0">{w.total_attempts}</span>
                <span className={`w-10 text-right tabular-nums shrink-0 font-semibold ${rateColor(w.success_rate)}`}>
                  {w.success_rate}%
                </span>
              </div>
            ))}
          </div>
        )}
        {!weeklyTrendError && (weeklyTrend?.weeks.length ?? 0) === 0 && (
          <div className="text-[11px] text-rmpg-500 text-center py-4">No activity in the last 12 weeks.</div>
        )}
      </div>
```

- [ ] **Step 4: Manual verification**

Reload the tab. Confirm the time-to-serve tiles change when toggling its own 7/30/90 selector independently of the shared one at the top. Confirm the weekly-trend bars render 12 rows (or fewer if there's less history) sorted oldest-to-newest.

- [ ] **Step 5: Typecheck and commit**

Run: `cd client && npx tsc --noEmit`

```bash
git add client/src/pages/serve/AnalyticsTab.tsx
git commit -m "feat(serve): add time-to-serve and weekly-trend panels"
```

---

### Task 5: Attempt timeline modal component

**Files:**
- Create: `client/src/components/serve/AttemptTimelineModal.tsx`

This is built as its own task/file before the workload panel (Task 6) wires it in, so Task 6 can focus purely on the workload table + drill-down trigger.

- [ ] **Step 1: Write the modal component**

```typescript
// client/src/components/serve/AttemptTimelineModal.tsx
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { parseTimestamp } from '../../utils/dateUtils';

interface TimelineEntry {
  type: 'attempt' | 'activity';
  timestamp: string;
  data: any;
}
interface AttemptTimelineResponse {
  queue_id: number;
  queue: any;
  total_attempts: number;
  total_activities: number;
  timeline: TimelineEntry[];
}

interface AttemptTimelineModalProps {
  queueId: number;
  onClose: () => void;
}

export default function AttemptTimelineModal({ queueId, onClose }: AttemptTimelineModalProps) {
  const [data, setData] = useState<AttemptTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<AttemptTimelineResponse>(`/serve-dashboard/attempt-timeline/${queueId}`);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  }, [queueId]);

  useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-base rounded panel-beveled shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Attempt timeline"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-rmpg-700/40">
          <h2 className="text-[11px] font-bold text-rmpg-100 uppercase tracking-wider">
            Timeline — {data?.queue?.recipient_name ?? `Job #${queueId}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[2px] text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-raised transition-colors"
            aria-label="Close timeline"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <div className="text-[11px] text-rmpg-500 text-center py-6">Loading…</div>}
          {error && <div className="text-[11px] text-red-400 text-center py-6">{error}</div>}
          {!loading && !error && data && data.timeline.length === 0 && (
            <div className="text-[11px] text-rmpg-500 text-center py-6">No activity recorded for this job.</div>
          )}
          {!loading && !error && data?.timeline.map((entry, i) => (
            <div key={i} className="border-b border-rmpg-800 last:border-0 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-rmpg-500 tabular-nums">
                  {parseTimestamp(entry.timestamp)?.toLocaleString() ?? entry.timestamp}
                </span>
                <span className={`text-[8px] uppercase font-semibold px-1.5 py-0.5 rounded-[2px] ${
                  entry.type === 'attempt' ? 'bg-brand-900/50 text-brand-400' : 'bg-rmpg-800 text-rmpg-400'
                }`}>
                  {entry.type}
                </span>
              </div>
              {entry.type === 'attempt' ? (
                <div className="text-[10px] text-rmpg-200 mt-1">
                  Attempt #{entry.data.attempt_number} by {entry.data.officer_name ?? 'Unknown'} — result: {entry.data.result}
                  {entry.data.notes && <div className="text-rmpg-400 mt-0.5">{entry.data.notes}</div>}
                </div>
              ) : (
                <div className="text-[10px] text-rmpg-200 mt-1">
                  {entry.data.action} by {entry.data.user_name ?? 'System'}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (the component isn't imported anywhere yet, so this only validates the file compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/serve/AttemptTimelineModal.tsx
git commit -m "feat(serve): add AttemptTimelineModal component"
```

---

### Task 6: Workload panel with officer-row expansion + timeline drill-down

**Files:**
- Modify: `client/src/pages/serve/AnalyticsTab.tsx`

- [ ] **Step 1: Add the import + interface**

At the top of `AnalyticsTab.tsx`, add:

```typescript
import AttemptTimelineModal from '../../components/serve/AttemptTimelineModal';
import type { ServeJob } from '../../types';
```

Add the interface alongside the others:

```typescript
interface WorkloadRow {
  officer_id: number;
  officer_name: string;
  assigned_count: number;
  overdue_count: number;
  todays_attempts: number;
  over_capacity: boolean;
}
interface WorkloadResponse {
  capacity_threshold: number;
  servers: WorkloadRow[];
  over_capacity_count: number;
}
```

- [ ] **Step 2: Add state + fetch logic** — inside the component, alongside the other state blocks:

```typescript
  const [workload, setWorkload] = useState<WorkloadResponse | null>(null);
  const [workloadError, setWorkloadError] = useState<string | null>(null);

  const [expandedOfficerId, setExpandedOfficerId] = useState<number | null>(null);
  const [officerJobs, setOfficerJobs] = useState<ServeJob[]>([]);
  const [officerJobsLoading, setOfficerJobsLoading] = useState(false);

  const [timelineQueueId, setTimelineQueueId] = useState<number | null>(null);

  const fetchWorkload = useCallback(async () => {
    setWorkloadError(null);
    try {
      const data = await apiFetch<WorkloadResponse>('/serve-dashboard/workload-distribution');
      setWorkload(data);
    } catch (err: any) {
      setWorkloadError(err?.message || 'Failed to load workload');
    }
  }, []);

  useEffect(() => { fetchWorkload(); }, [fetchWorkload, refreshKey]);

  const toggleOfficerExpand = useCallback(async (officerId: number) => {
    if (expandedOfficerId === officerId) {
      setExpandedOfficerId(null);
      setOfficerJobs([]);
      return;
    }
    setExpandedOfficerId(officerId);
    setOfficerJobsLoading(true);
    try {
      const jobs = await apiFetch<ServeJob[]>(`/process-server?officer_id=${officerId}`);
      setOfficerJobs(jobs ?? []);
    } catch {
      setOfficerJobs([]);
      addToast('Failed to load officer jobs', 'error');
    } finally {
      setOfficerJobsLoading(false);
    }
  }, [expandedOfficerId, addToast]);
```

- [ ] **Step 3: Render the workload panel** — insert after the weekly-trend panel from Task 4

```typescript
      {/* ── Workload distribution ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
        <div className="px-3 py-2 border-b border-rmpg-700 flex items-center justify-between">
          <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Workload Distribution</span>
          {workload && workload.over_capacity_count > 0 && (
            <span className="text-[9px] text-red-400 font-semibold">
              {workload.over_capacity_count} over capacity
            </span>
          )}
        </div>
        {workloadError && <div className="text-[10px] text-red-400 px-3 py-2">{workloadError}</div>}
        {!workloadError && (workload?.servers.length ?? 0) > 0 && (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-rmpg-800">
                <th className="text-left px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Officer</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Assigned</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Overdue</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Today</th>
              </tr>
            </thead>
            <tbody>
              {workload!.servers.map((s) => (
                <>
                  <tr
                    key={s.officer_id}
                    className={`border-b border-rmpg-800 cursor-pointer hover:bg-surface-base/60 ${s.over_capacity ? 'bg-red-950/20' : ''}`}
                    onClick={() => toggleOfficerExpand(s.officer_id)}
                  >
                    <td className="px-3 py-[2px] text-rmpg-200">{s.officer_name}</td>
                    <td className={`px-3 py-[2px] text-right tabular-nums font-semibold ${s.over_capacity ? 'text-red-400' : 'text-rmpg-300'}`}>
                      {s.assigned_count}
                    </td>
                    <td className="px-3 py-[2px] text-right text-amber-400 tabular-nums">{s.overdue_count}</td>
                    <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{s.todays_attempts}</td>
                  </tr>
                  {expandedOfficerId === s.officer_id && (
                    <tr key={`${s.officer_id}-expanded`}>
                      <td colSpan={4} className="p-0">
                        <OfficerJobsPanel
                          jobs={officerJobs}
                          loading={officerJobsLoading}
                          officerId={s.officer_id}
                          onOpenTimeline={setTimelineQueueId}
                          onBulkActionComplete={() => { fetchWorkload(); toggleOfficerExpand(s.officer_id); }}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
        {!workloadError && (workload?.servers.length ?? 0) === 0 && (
          <div className="text-[11px] text-rmpg-500 text-center py-4">No officers with active assignments.</div>
        )}
      </div>

      {timelineQueueId != null && (
        <AttemptTimelineModal queueId={timelineQueueId} onClose={() => setTimelineQueueId(null)} />
      )}
```

Note: `OfficerJobsPanel` is defined in Task 7 (the bulk-actions panel) — this task's manual verification step will show a TypeScript error for the missing component until Task 7 lands, which is expected and resolved by the next task. If executing tasks strictly in order via subagent-driven-development, skip the "manual verification" and "typecheck" steps for Task 6 and combine them with Task 7's verification instead — call this out explicitly to whoever runs Task 6 standalone.

- [ ] **Step 4: Commit (code only, verification deferred to Task 7)**

```bash
git add client/src/pages/serve/AnalyticsTab.tsx
git commit -m "feat(serve): add workload panel with officer-row expansion and timeline drill-down (depends on Task 7's OfficerJobsPanel)"
```

---

### Task 7: Bulk actions — OfficerJobsPanel component (reassign + status update)

**Files:**
- Modify: `client/src/pages/serve/AnalyticsTab.tsx` (add `OfficerJobsPanel` as a second component in the same file — it's a tightly-coupled child of `AnalyticsTab`, not reused elsewhere, so it doesn't warrant its own file per the "don't split just because a file feels big" guidance, but it IS split out from the workload table's JSX which already lives in Task 6 for readability)

- [ ] **Step 1: Add response interfaces** near the top of the file, alongside the others:

```typescript
interface BulkReassignResponse {
  success: boolean;
  reassigned_count: number;
  reassigned_attempt_ids: number[];
  skipped_attempt_ids: number[];
  affected_queue_ids: number[];
}

interface BulkStatusResponse {
  success: boolean;
  updated_queue_count: number;
  affected_queue_ids: number[];
  status: string;
}

const BULK_STATUS_OPTIONS = ['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled'] as const;
```

- [ ] **Step 2: Add the `OfficerJobsPanel` component** at the bottom of `AnalyticsTab.tsx`, below the default export (a named, non-default export in the same file, imported nowhere else — purely a local child component):

```typescript
interface OfficerJobsPanelProps {
  jobs: ServeJob[];
  loading: boolean;
  officerId: number;
  onOpenTimeline: (queueId: number) => void;
  onBulkActionComplete: () => void;
}

function OfficerJobsPanel({ jobs, loading, officerId, onOpenTimeline, onBulkActionComplete }: OfficerJobsPanelProps) {
  const { addToast } = useToast();
  const [selectedAttemptIds, setSelectedAttemptIds] = useState<Set<number>>(new Set());
  const [reassignTarget, setReassignTarget] = useState('');
  const [bulkStatus, setBulkStatus] = useState<typeof BULK_STATUS_OPTIONS[number]>('failed');
  const [submitting, setSubmitting] = useState(false);

  const allAttempts = jobs.flatMap((j) => (j.attempts ?? []).map((a) => ({ ...a, jobRecipient: j.recipient_name, jobId: j.id })));

  const toggleAttempt = (id: number) => {
    setSelectedAttemptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkReassign = async () => {
    const toServerId = parseInt(reassignTarget, 10);
    if (!toServerId || selectedAttemptIds.size === 0) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<BulkReassignResponse>('/serve-dashboard/bulk-reassign', {
        method: 'POST',
        body: JSON.stringify({
          fromServerId: officerId,
          toServerId,
          attemptIds: Array.from(selectedAttemptIds),
        }),
      });
      addToast(`Reassigned ${res.reassigned_count} attempt(s)`, 'success');
      setSelectedAttemptIds(new Set());
      onBulkActionComplete();
    } catch (err: any) {
      addToast(err?.message || 'Reassign failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkStatusUpdate = async () => {
    if (selectedAttemptIds.size === 0) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<BulkStatusResponse>('/serve-dashboard/bulk-status-update', {
        method: 'POST',
        body: JSON.stringify({
          attemptIds: Array.from(selectedAttemptIds),
          status: bulkStatus,
        }),
      });
      addToast(`Updated ${res.updated_queue_count} job(s) to "${res.status}"`, 'success');
      setSelectedAttemptIds(new Set());
      onBulkActionComplete();
    } catch (err: any) {
      addToast(err?.message || 'Status update failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-[10px] text-rmpg-500 text-center py-3 bg-surface-base/40">Loading jobs…</div>;
  }
  if (allAttempts.length === 0) {
    return <div className="text-[10px] text-rmpg-500 text-center py-3 bg-surface-base/40">No attempts recorded for this officer's assigned jobs.</div>;
  }

  return (
    <div className="bg-surface-base/40 border-t border-rmpg-800 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          placeholder="Reassign to officer ID"
          value={reassignTarget}
          onChange={(e) => setReassignTarget(e.target.value)}
          className="w-40 text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
        />
        <button
          type="button"
          disabled={submitting || selectedAttemptIds.size === 0 || !reassignTarget}
          onClick={handleBulkReassign}
          className="text-[10px] px-2 py-1 rounded-[2px] bg-brand-500/10 border border-brand-500/30 text-brand-400 hover:bg-brand-500/20 transition-colors disabled:opacity-40"
        >
          Reassign Selected ({selectedAttemptIds.size})
        </button>
        <select
          value={bulkStatus}
          onChange={(e) => setBulkStatus(e.target.value as typeof BULK_STATUS_OPTIONS[number])}
          className="text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
        >
          {BULK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          type="button"
          disabled={submitting || selectedAttemptIds.size === 0}
          onClick={handleBulkStatusUpdate}
          className="text-[10px] px-2 py-1 rounded-[2px] bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
        >
          Set Status Selected ({selectedAttemptIds.size})
        </button>
      </div>

      <table className="w-full text-[9px]">
        <thead>
          <tr className="border-b border-rmpg-800">
            <th className="w-6 px-2 py-[2px]" />
            <th className="text-left px-2 py-[2px] text-rmpg-500 font-semibold">Job</th>
            <th className="text-left px-2 py-[2px] text-rmpg-500 font-semibold">Attempt #</th>
            <th className="text-left px-2 py-[2px] text-rmpg-500 font-semibold">Result</th>
            <th className="text-left px-2 py-[2px] text-rmpg-500 font-semibold">Date</th>
            <th className="w-16 px-2 py-[2px]" />
          </tr>
        </thead>
        <tbody>
          {allAttempts.map((a) => (
            <tr key={a.id} className="border-b border-rmpg-800/60 last:border-0">
              <td className="px-2 py-[2px]">
                <input
                  type="checkbox"
                  checked={selectedAttemptIds.has(a.id)}
                  onChange={() => toggleAttempt(a.id)}
                  aria-label={`Select attempt ${a.id}`}
                />
              </td>
              <td className="px-2 py-[2px] text-rmpg-300">{a.jobRecipient}</td>
              <td className="px-2 py-[2px] text-rmpg-400 tabular-nums">{a.attempt_number}</td>
              <td className="px-2 py-[2px] text-rmpg-300">{a.result}</td>
              <td className="px-2 py-[2px] text-rmpg-500 tabular-nums">{a.attempt_at?.slice(0, 10)}</td>
              <td className="px-2 py-[2px] text-right">
                <button
                  type="button"
                  onClick={() => onOpenTimeline(a.jobId)}
                  className="text-brand-400 hover:text-brand-300 transition-colors"
                >
                  Timeline
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification (covers Task 6 + Task 7 together)**

Reload the Analytics tab. Click an officer row in the workload table → confirm it expands to show that officer's jobs' attempts as a checkbox list. Select one or more attempts, enter a valid officer ID in "Reassign to officer ID", click "Reassign Selected" → confirm a success toast with the returned count, and the workload table refreshes (assigned_count should shift). Repeat for "Set Status Selected" with a status like `failed` → confirm the toast and refresh. Click "Timeline" on a row → confirm the `AttemptTimelineModal` opens with that job's data.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (this resolves the `OfficerJobsPanel` reference left dangling by Task 6).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/serve/AnalyticsTab.tsx
git commit -m "feat(serve): add bulk-reassign and bulk-status-update via OfficerJobsPanel"
```

---

### Task 8: CSV/JSON export button

**Files:**
- Modify: `client/src/pages/serve/AnalyticsTab.tsx`

The export endpoint is `POST /serve-dashboard/export` returning either a raw CSV `Response` or `{count, data}` JSON — neither `apiFetch` (assumes JSON) nor the existing `downloadExport` helper in `ExportButton.tsx` (GET-only, no body) fit directly, so this task writes a small dedicated POST-blob-download function local to this file.

- [ ] **Step 1: Add the export state + handler** inside the component:

```typescript
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/serve-dashboard/export', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          status: exportStatus || undefined,
          startDate: exportStartDate || undefined,
          endDate: exportEndDate || undefined,
          format: 'csv',
        }),
      });
      if (!res.ok) throw new Error(`Export failed with status ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `serve_export_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      addToast('Export downloaded', 'success');
      setExportOpen(false);
    } catch (err: any) {
      addToast(err?.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };
```

- [ ] **Step 2: Add the export button + popover** — insert into the header row from Task 2, right after the refresh button:

```typescript
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              className="text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-300 hover:text-rmpg-100 transition-colors"
            >
              Export
            </button>
            {exportOpen && (
              <div className="absolute right-0 mt-1 z-10 w-56 bg-surface-base border border-rmpg-700 rounded-[2px] shadow-xl p-3 space-y-2">
                <select
                  value={exportStatus}
                  onChange={(e) => setExportStatus(e.target.value)}
                  className="w-full text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
                >
                  <option value="">All statuses</option>
                  {BULK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="w-full text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
                />
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="w-full text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
                />
                <button
                  type="button"
                  disabled={exporting}
                  onClick={handleExport}
                  className="w-full text-[10px] px-2 py-1 rounded-[2px] bg-brand-gold-500/10 border border-brand-gold-500/30 text-brand-gold-400 hover:bg-brand-gold-500/20 transition-colors disabled:opacity-40"
                >
                  {exporting ? 'Exporting…' : 'Download CSV'}
                </button>
              </div>
            )}
          </div>
```

Note: `BULK_STATUS_OPTIONS` is defined in Task 7 — this task depends on Task 7 having landed first.

- [ ] **Step 3: Manual verification**

Reload the Analytics tab, click "Export", optionally set a status/date filter, click "Download CSV" → confirm a `serve_export_YYYY-MM-DD.csv` file downloads and opens with the expected columns (id, status, priority, recipient_name, ... matching the `headers` array in `serveDashboard.ts:648-655`).

- [ ] **Step 4: Typecheck and commit**

Run: `cd client && npx tsc --noEmit`

```bash
git add client/src/pages/serve/AnalyticsTab.tsx
git commit -m "feat(serve): add CSV export with status/date filters to Analytics tab"
```

---

### Task 9: Final full-tab smoke test + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 new errors (pre-existing unrelated errors, if any, are out of scope — cross-check count against `main` before this branch).

- [ ] **Step 2: Full client test suite**

Run: `cd client && npx vitest run`
Expected: no new failures introduced by this change (existing pre-existing failures, if any, are unrelated per project convention).

- [ ] **Step 3: Worker typecheck (no backend changed, but confirms nothing else broke)**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Manual end-to-end pass in the dev server preview**

Walk through every panel once more end-to-end as an `admin`/`manager`/`supervisor` user: range selector, all 7 read panels, workload expand → bulk reassign → bulk status update → timeline modal, export. Then log in as `officer` and confirm the Analytics tab is absent.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(serve): wire Analytics tab into ServePage (serveDashboard.ts backend)" --body "$(cat <<'EOF'
## Summary
- Adds a role-gated "Analytics" tab to ServePage.tsx (admin/manager/supervisor only)
- Wires 11 of serveDashboard.ts's 12 endpoints (stale-attempts intentionally skipped — redundant with the existing diligence_gap sweep)
- Panels: daily summary, server performance, success-rate-by-type, county-breakdown, time-to-serve, weekly-trend, workload-distribution (with officer-row expansion + bulk-reassign/bulk-status-update), CSV export
- New AttemptTimelineModal component for per-job drill-down from the workload panel
- No backend changes — all routes were already live and verified correct in a prior audit round this session

## Test plan
- [ ] `cd client && npx tsc --noEmit` passes
- [ ] `cd client && npx vitest run` passes
- [ ] `npm run typecheck` passes
- [ ] Manual: Analytics tab renders for admin/manager/supervisor, hidden for officer
- [ ] Manual: all 7 read panels populate with live data
- [ ] Manual: workload row expand → select attempts → bulk reassign → toast + refresh
- [ ] Manual: workload row expand → select attempts → bulk status update → toast + refresh
- [ ] Manual: timeline modal opens and shows attempt/activity entries
- [ ] Manual: CSV export downloads with correct columns

Spec: docs/superpowers/specs/2026-07-05-serve-analytics-tab-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Follow the standing PR workflow**

Once CI runs, run `gh pr checks <N> --repo rmpgutah/rmpg-flex` and address any real failures or Gitar review comments per this session's established pattern (reply via `gh api` ending with `_🤖 Addressed by [Claude Code](https://claude.com/claude-code)_`, then resolve via GraphQL).
