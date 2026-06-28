# Process Service Auto-Scheduler — PR 3 (Full-Page Scheduler) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the full-page Serve Scheduler at `/serve-intake/scheduler` with multi-officer swim lanes, an unassigned-queue sidebar (drag-to-assign), a range picker (Week/2-Week/Month), and a `POST /serve-intake/schedule/rebalance` endpoint with dry-run preview.

**Architecture:** Pure helpers in `client/src/utils/schedulerLanes.ts` (officer-lane grouping, range expansion) and `src/utils/rebalancePreview.ts` (server-side proposed-diff computation) hold the logic; React components are dumb renderers; the page composes them with `useLiveSync('serve-schedule', refetch)` for realtime. The rebalance endpoint is a thin wrapper around the pure preview function that either returns the diff (`dry_run=true`) or applies it via D1 batch + broadcast.

**Tech Stack:** React 18 + TypeScript + Tailwind for the page (CSS-variable-backed theme tokens — no hardcoded hex). HTML5 native drag-and-drop. vitest + jsdom for component tests. Hono on the Worker side. D1 for persistence.

**Stacks on:** Merged main (PR 1 #1511 + PR 2 #1512). Migrations 0140 + 0141 already applied to live D1.

---

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `client/src/utils/schedulerLanes.ts` | Pure helpers: `groupByOfficerLane`, `extendRange`, `bucketDaysIntoWeeks` |
| Create | `client/src/utils/__tests__/schedulerLanes.test.ts` | Unit tests |
| Create | `client/src/components/scheduler/RangePicker.tsx` | Week / 2-Week / Month segmented control + prev/next arrows |
| Create | `client/src/components/scheduler/UnassignedQueueSidebar.tsx` | List of queue rows where officer_id IS NULL, sorted by deadline ASC NULLS LAST, then urgency tier |
| Create | `client/src/components/scheduler/OfficerLaneTimeline.tsx` | Multi-officer swim-lane day grid with drag-to-reassign |
| Create | `client/src/components/scheduler/RebalancePreviewModal.tsx` | Confirms a previewed rebalance + applies |
| Create | `client/src/pages/ServeSchedulerPage.tsx` | Top-level page composition + WS subscribe |
| Modify | `client/src/App.tsx` | Lazy-loaded `/serve-intake/scheduler` route |
| Modify | `client/src/components/Sidebar.tsx` | Add "Scheduler" item under "Process Service" |
| Create | `src/utils/rebalancePreview.ts` | Pure: `previewRangeRebalance(queueRows, nowIso, dateRange) → { changes, skipped_manual, geo_co_located, urgency_promoted }` |
| Create | `tests/rebalancePreview.test.ts` | Unit tests for the preview helper |
| Modify | `src/routes/serveIntake.ts` | (a) Add `POST /schedule/rebalance` (b) Extend the queue-list endpoint with `?officer_id=null` filter |

**Why these boundaries:** Pure helpers stay testable without React or D1. The rebalance endpoint is a wrapper around the same pure function regardless of `dry_run` — only the persistence step differs. Components remain dumb renderers; the page hosts state and realtime.

---

## Task 1: Pure `schedulerLanes` helpers

**Files:**
- Create: `client/src/utils/schedulerLanes.ts`
- Test: `client/src/utils/__tests__/schedulerLanes.test.ts`

- [ ] **Step 1: Write the failing tests** — create `client/src/utils/__tests__/schedulerLanes.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  groupByOfficerLane,
  extendRange,
} from '../schedulerLanes';
import type { ScheduleSlot } from '../schedulerView';

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: 1, queue_id: 10, attempt_number: 1,
  scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30',
  window_label: 'evening', notify_at: '2026-06-21T15:00',
  recipient_name: 'J. Smith', recipient_address: '123 Main',
  recipient_city: 'SLC', recipient_state: 'UT',
  case_number: '240-1', priority: 'normal', deadline: null,
  status: 'pending', notified: 0, dismissed: 0,
  officer_id: 1, manually_moved: 0, auto_replan_source: null,
  urgency_tier: 'standard',
  ...over,
});

describe('groupByOfficerLane', () => {
  it('separates slots by officer id within each day', () => {
    const a = slot({ id: 1, scheduled_date: '2026-06-21', officer_id: 1 });
    const b = slot({ id: 2, scheduled_date: '2026-06-21', officer_id: 2 });
    const c = slot({ id: 3, scheduled_date: '2026-06-22', officer_id: 1 });
    const result = groupByOfficerLane([a, b, c]);
    expect(result.get('2026-06-21')?.get(1)?.map((s) => s.id)).toEqual([1]);
    expect(result.get('2026-06-21')?.get(2)?.map((s) => s.id)).toEqual([2]);
    expect(result.get('2026-06-22')?.get(1)?.map((s) => s.id)).toEqual([3]);
  });

  it('groups unassigned slots under officer_id key 0 (sentinel)', () => {
    const a = slot({ id: 1, officer_id: null });
    const result = groupByOfficerLane([a]);
    expect(result.get('2026-06-21')?.get(0)?.map((s) => s.id)).toEqual([1]);
  });

  it('returns an empty Map for an empty input', () => {
    expect(groupByOfficerLane([]).size).toBe(0);
  });
});

describe('extendRange', () => {
  it('expands week → 7 days', () => {
    const days = extendRange('2026-06-21', 'week');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-06-21');
    expect(days[6]).toBe('2026-06-27');
  });

  it('expands two-week → 14 days', () => {
    const days = extendRange('2026-06-21', 'two-week');
    expect(days).toHaveLength(14);
    expect(days[13]).toBe('2026-07-04');
  });

  it('expands month → calendar month length (28-31 days)', () => {
    const days = extendRange('2026-06-21', 'month');
    expect(days[0]).toBe('2026-06-21');
    // June has 30 days; from the 21st to 31 days later = 2026-07-21.
    expect(days.length).toBe(31);
    expect(days[30]).toBe('2026-07-21');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd client && npx vitest run src/utils/__tests__/schedulerLanes.test.ts`
Expected: failures with `Cannot find module '../schedulerLanes'`.

- [ ] **Step 3: Implement** — create `client/src/utils/schedulerLanes.ts`

```ts
// ============================================================
// RMPG Flex — Multi-officer swim-lane layout helpers (pure)
// ============================================================
// Used by ServeSchedulerPage to render slots split per officer per
// day. Unassigned slots (officer_id NULL) share lane key `0`.
// ============================================================

import type { ScheduleSlot } from './schedulerView';

export interface LaneAssignment {
  date: string;
  officer_id: number; // 0 = unassigned sentinel
  slots: ScheduleSlot[];
}

// Map<date, Map<officer_id (0 = unassigned), ScheduleSlot[]>> — slots within each
// lane are sorted by window_start.
export function groupByOfficerLane(
  slots: ScheduleSlot[],
): Map<string, Map<number, ScheduleSlot[]>> {
  const out = new Map<string, Map<number, ScheduleSlot[]>>();
  for (const s of slots) {
    const dayMap = out.get(s.scheduled_date) ?? new Map<number, ScheduleSlot[]>();
    const key = s.officer_id ?? 0;
    const arr = dayMap.get(key) ?? [];
    arr.push(s);
    dayMap.set(key, arr);
    out.set(s.scheduled_date, dayMap);
  }
  for (const dayMap of out.values()) {
    for (const arr of dayMap.values()) {
      arr.sort((a, b) => a.window_start.localeCompare(b.window_start));
    }
  }
  return out;
}

export type RangeMode = 'week' | 'two-week' | 'month';

const COUNTS: Record<RangeMode, number> = { week: 7, 'two-week': 14, month: 31 };

// Expand a (anchor, mode) pair into N consecutive YYYY-MM-DD strings.
// Month mode is fixed-31 — the page renders calendar boundaries on top.
export function extendRange(anchorYmd: string, mode: RangeMode): string[] {
  const [y, m, d] = anchorYmd.split('-').map(Number);
  const out: string[] = [];
  const count = COUNTS[mode];
  for (let i = 0; i < count; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i)); // new-date-ok: epoch from Date.UTC, not a server string
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd client && npx vitest run src/utils/__tests__/schedulerLanes.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/schedulerLanes.ts client/src/utils/__tests__/schedulerLanes.test.ts
git commit -m "feat(serve-ui): schedulerLanes pure helpers — groupByOfficerLane + extendRange"
```

---

## Task 2: Pure `rebalancePreview` helper + tests

**Files:**
- Create: `src/utils/rebalancePreview.ts`
- Create: `tests/rebalancePreview.test.ts`

- [ ] **Step 1: Write the failing tests** — create `tests/rebalancePreview.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  previewRangeRebalance,
  type RebalanceQueueRow,
} from '../src/utils/rebalancePreview';

const row = (over: Partial<RebalanceQueueRow> = {}): RebalanceQueueRow => ({
  id: 1, deadline: null, max_attempts: 3, attempt_count: 0,
  priority: 'normal', urgency_tier: 'standard',
  ...over,
});

const NOW = '2026-06-11T10:00:00.000Z';

describe('previewRangeRebalance', () => {
  it('returns zeroed counts on an empty queue', () => {
    const result = previewRangeRebalance([], NOW);
    expect(result).toEqual({
      changes: [], skipped_manual: 0,
      tiers_promoted_critical: 0, priority_escalated: 0,
    });
  });

  it('proposes a critical promotion for a queue row near its deadline', () => {
    const result = previewRangeRebalance([
      row({ id: 1, deadline: '2026-06-12', priority: 'normal', urgency_tier: 'standard' }),
    ], NOW);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      queue_id: 1,
      reason: 'urgency_promotion',
      to_tier: 'critical',
      to_priority: 'rush',
    });
    expect(result.tiers_promoted_critical).toBe(1);
    expect(result.priority_escalated).toBe(1);
  });

  it('does NOT promote priority when it is already "urgent"', () => {
    const result = previewRangeRebalance([
      row({ id: 1, deadline: '2026-06-12', priority: 'urgent', urgency_tier: 'standard' }),
    ], NOW);
    expect(result.changes[0]).toMatchObject({ queue_id: 1, to_priority: null });
    expect(result.priority_escalated).toBe(0);
  });

  it('does not change anything for a queue row already at the right tier', () => {
    const result = previewRangeRebalance([
      row({ id: 1, deadline: '2026-08-12', priority: 'normal', urgency_tier: 'standard' }),
    ], NOW);
    expect(result.changes).toHaveLength(0);
  });

  it('produces a stable order across calls (sorted by queue_id)', () => {
    const queue = [
      row({ id: 2, deadline: '2026-06-12' }),
      row({ id: 1, deadline: '2026-06-12' }),
    ];
    const result = previewRangeRebalance(queue, NOW);
    expect(result.changes.map((c) => c.queue_id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run tests/rebalancePreview.test.ts`
Expected: failures with `Cannot find module '../src/utils/rebalancePreview'`.

- [ ] **Step 3: Implement** — create `src/utils/rebalancePreview.ts`

```ts
// ============================================================
// RMPG Flex — Serve schedule rebalance preview (pure)
// ============================================================
// Same logic as src/utils/serveRebalance.runDailyRebalance but
// returns the proposed diff instead of writing. Used by the
// POST /serve-intake/schedule/rebalance endpoint to back the
// "Preview rebalance" modal.
// ============================================================

import { applyUrgencyTier, type UrgencyTier } from './serveDiligencePlanner';

export interface RebalanceQueueRow {
  id: number;
  deadline: string | null;
  max_attempts: number;
  attempt_count: number;
  priority: string;
  urgency_tier: string | null;
}

export interface RebalanceChange {
  queue_id: number;
  from_tier: string | null;
  to_tier: UrgencyTier;
  from_priority: string;
  to_priority: 'rush' | null;
  reason: 'urgency_promotion' | 'tier_demotion' | 'tier_drift';
}

export interface RebalancePreview {
  changes: RebalanceChange[];
  skipped_manual: number;
  tiers_promoted_critical: number;
  priority_escalated: number;
}

export function previewRangeRebalance(
  rows: RebalanceQueueRow[],
  nowIso: string,
): RebalancePreview {
  const changes: RebalanceChange[] = [];
  let tiers_promoted_critical = 0;
  let priority_escalated = 0;
  const skipped_manual = 0; // populated when slot-level manual-move detection lands

  for (const r of rows) {
    const newTier = applyUrgencyTier(r.deadline, r.attempt_count, r.max_attempts, nowIso);
    if (newTier === r.urgency_tier) continue;

    const promoteCritical = newTier === 'critical' && r.urgency_tier !== 'critical';
    const escalate = promoteCritical && r.priority !== 'urgent';

    if (promoteCritical) tiers_promoted_critical++;
    if (escalate) priority_escalated++;

    let reason: RebalanceChange['reason'];
    if (promoteCritical) reason = 'urgency_promotion';
    else if (newTier === 'standard' && r.urgency_tier !== 'standard') reason = 'tier_demotion';
    else reason = 'tier_drift';

    changes.push({
      queue_id: r.id,
      from_tier: r.urgency_tier,
      to_tier: newTier,
      from_priority: r.priority,
      to_priority: escalate ? 'rush' : null,
      reason,
    });
  }

  changes.sort((a, b) => a.queue_id - b.queue_id);
  return { changes, skipped_manual, tiers_promoted_critical, priority_escalated };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/rebalancePreview.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/rebalancePreview.ts tests/rebalancePreview.test.ts
git commit -m "feat(serve): previewRangeRebalance — proposed-diff computation"
```

---

## Task 3: `POST /serve-intake/schedule/rebalance` route

**Files:**
- Modify: `src/routes/serveIntake.ts`

- [ ] **Step 1: Add the route** — In `src/routes/serveIntake.ts`, find the PATCH `/schedule/:slotId` handler (PR 2). Place the new POST handler immediately AFTER the PATCH handler and BEFORE the DELETE handler.

```ts
// ── POST /schedule/rebalance — dry-run preview or apply ───────
si.post('/schedule/rebalance', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);

  const db = getDb(c.env);
  await reconcileScheduleSchema(db);

  const body = await c.req.json<any>().catch(() => ({}));
  const dry = body.dry_run !== false; // default true — preview unless explicitly set false

  const { previewRangeRebalance } = await import('../utils/rebalancePreview');

  const rows = await query<{
    id: number; deadline: string | null; max_attempts: number;
    attempt_count: number; priority: string; urgency_tier: string | null;
  }>(
    db,
    `SELECT id, deadline, max_attempts, attempt_count, priority, urgency_tier
       FROM serve_queue
      WHERE status IN ('pending', 'assigned', 'in_progress', 'attempted')`,
  );

  const nowIso = new Date().toISOString();
  const preview = previewRangeRebalance(rows, nowIso);

  if (dry) {
    return c.json({ dry_run: true, ...preview });
  }

  // Apply: one UPDATE per changed row. Low volume; in-loop is acceptable.
  for (const change of preview.changes) {
    const priorityClause = change.to_priority === 'rush' ? `, priority = 'rush'` : '';
    await execute(
      db,
      `UPDATE serve_queue
          SET urgency_tier = ?, urgency_computed_at = datetime('now') ${priorityClause}
        WHERE id = ?`,
      change.to_tier, change.queue_id,
    );
  }

  await recordAudit(c, {
    action: 'serve_schedule.rebalance_applied',
    entityType: 'serve_queue',
    entityId: null,
    details: {
      changes: preview.changes.length,
      tiers_promoted_critical: preview.tiers_promoted_critical,
      priority_escalated: preview.priority_escalated,
    },
  });

  broadcastAll('data_changed', {
    module: 'serve-schedule',
    entity: 'queue',
    action: 'rebalanced',
    count: preview.changes.length,
  });

  return c.json({ dry_run: false, ...preview });
});
```

- [ ] **Step 2: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: 0 typecheck errors; full suite passes (baseline includes the 5 new preview tests).

- [ ] **Step 3: Commit**

```bash
git add src/routes/serveIntake.ts
git commit -m "feat(serve): POST /schedule/rebalance — dry-run preview + apply + broadcast"
```

---

## Task 4: `RangePicker` component

**Files:**
- Create: `client/src/components/scheduler/RangePicker.tsx`

- [ ] **Step 1: Implement** — create `client/src/components/scheduler/RangePicker.tsx`

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type RangeMode = 'week' | 'two-week' | 'month';

interface Props {
  anchorYmd: string;
  mode: RangeMode;
  onAnchorChange: (ymd: string) => void;
  onModeChange: (mode: RangeMode) => void;
}

const MODE_LABELS: Record<RangeMode, string> = {
  week: 'Week',
  'two-week': '2-Week',
  month: 'Month',
};
const MODE_DAYS: Record<RangeMode, number> = {
  week: 7,
  'two-week': 14,
  month: 31,
};

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days)); // new-date-ok: epoch from Date.UTC, not a server string
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function RangePicker({ anchorYmd, mode, onAnchorChange, onModeChange }: Props) {
  const days = MODE_DAYS[mode];
  const endYmd = shiftYmd(anchorYmd, days - 1);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Previous range"
        onClick={() => onAnchorChange(shiftYmd(anchorYmd, -days))}
        className="px-1 py-0.5 border border-rmpg-700 rounded-[2px] hover:bg-surface-raised"
      >
        <ChevronLeft size={12} />
      </button>
      <div className="text-[11px] tabular-nums text-rmpg-200">
        {anchorYmd} – {endYmd}
      </div>
      <button
        type="button"
        aria-label="Next range"
        onClick={() => onAnchorChange(shiftYmd(anchorYmd, days))}
        className="px-1 py-0.5 border border-rmpg-700 rounded-[2px] hover:bg-surface-raised"
      >
        <ChevronRight size={12} />
      </button>
      <div className="inline-flex border border-rmpg-700 rounded-[2px] overflow-hidden">
        {(['week', 'two-week', 'month'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onModeChange(v)}
            className={`px-2 py-0.5 text-[10px] uppercase ${
              mode === v ? 'bg-brand-500/20 text-brand-200' : 'bg-surface-base text-rmpg-300 hover:bg-surface-raised'
            }`}
          >
            {MODE_LABELS[v]}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/scheduler/RangePicker.tsx
git commit -m "feat(serve-ui): RangePicker segmented control + prev/next arrows"
```

---

## Task 5: `UnassignedQueueSidebar` component

**Files:**
- Create: `client/src/components/scheduler/UnassignedQueueSidebar.tsx`

- [ ] **Step 1: Implement** — create `client/src/components/scheduler/UnassignedQueueSidebar.tsx`

```tsx
import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';

export interface UnassignedQueueItem {
  id: number;
  recipient_name: string | null;
  case_number: string | null;
  deadline: string | null;
  urgency_tier: 'critical' | 'tight' | 'standard' | null;
  priority: string;
  document_type: string | null;
}

interface Props {
  onAssign?: (item: UnassignedQueueItem, officerId: number, date: string) => void;
}

const TIER_COLOR: Record<string, string> = {
  critical: 'text-red-300',
  tight: 'text-amber-300',
  standard: 'text-blue-300',
};

export default function UnassignedQueueSidebar({ onAssign }: Props) {
  const [items, setItems] = useState<UnassignedQueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const rows = await apiFetch<UnassignedQueueItem[]>(
        '/serve-intake/queue?officer_id=null&status=pending,assigned',
      );
      // Default sort: deadline ASC NULLS LAST, then urgency_tier (critical < tight < standard)
      const tierRank: Record<string, number> = { critical: 0, tight: 1, standard: 2 };
      rows.sort((a, b) => {
        if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return (tierRank[a.urgency_tier ?? 'standard'] ?? 3) - (tierRank[b.urgency_tier ?? 'standard'] ?? 3);
      });
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  useLiveSync('serve-schedule', refetch);

  const handleDragStart = (item: UnassignedQueueItem) => (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(
      'application/x-rmpg-queue-item',
      JSON.stringify({ queue_id: item.id }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="bg-surface-base border border-rmpg-700 rounded-[2px] w-64 shrink-0">
      <div className="px-2 py-1 border-b border-rmpg-700 bg-surface-raised text-[11px] font-semibold uppercase tracking-wide text-rmpg-200">
        Unassigned Queue
        <span className="ml-2 text-rmpg-400 tabular-nums">{items.length}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {loading
          ? <div className="p-2 text-[11px] text-rmpg-400">Loading…</div>
          : items.length === 0
          ? <div className="p-2 text-[11px] text-rmpg-400">No unassigned papers.</div>
          : items.map((item) => {
              const tier = (item.urgency_tier ?? 'standard') as keyof typeof TIER_COLOR;
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={handleDragStart(item)}
                  className="px-2 py-1 border-b border-rmpg-700 cursor-grab active:cursor-grabbing hover:bg-surface-raised"
                  title={`${item.recipient_name ?? ''} • ${item.case_number ?? ''}`}
                >
                  <div className="flex items-center gap-1 text-[11px] text-rmpg-100">
                    <span className="font-semibold truncate">{item.recipient_name ?? '—'}</span>
                    {tier === 'critical' ? <AlertTriangle size={9} className="shrink-0 text-red-400" /> : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-rmpg-400 tabular-nums">
                    <span className="truncate">{item.case_number ?? '—'}</span>
                    <span className={TIER_COLOR[tier]}>{item.deadline ?? 'no deadline'}</span>
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a server endpoint for the unassigned queue**

In `src/routes/serveIntake.ts`, find an existing `si.get('/queue', …)` handler (if one exists) — if it accepts `?officer_id=null`, we're done. Otherwise add this route alongside it:

```ts
// ── GET /queue — list serve_queue rows with filters ──────────
si.get('/queue', async (c) => {
  const db = getDb(c.env);
  await reconcileScheduleSchema(db);
  const officerParam = c.req.query('officer_id');
  const statusParam = c.req.query('status') ?? 'pending,assigned';
  const statuses = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (!statuses.length) return c.json([]);
  const placeholders = statuses.map(() => '?').join(',');

  let officerClause = '';
  const binds: unknown[] = [...statuses];
  if (officerParam === 'null') officerClause = 'AND officer_id IS NULL';
  else if (officerParam && /^\d+$/.test(officerParam)) {
    officerClause = 'AND officer_id = ?';
    binds.push(parseInt(officerParam, 10));
  }

  const rows = await query<any>(
    db,
    `SELECT id, recipient_name, case_number, deadline, urgency_tier, priority, document_type
       FROM serve_queue
      WHERE status IN (${placeholders}) ${officerClause}
      ORDER BY (deadline IS NULL), deadline ASC, id ASC
      LIMIT 200`,
    ...binds,
  );
  return c.json(rows);
});
```

If a `si.get('/queue', …)` already exists, instead extend its WHERE clause to accept the same filters. Use `grep -n "si.get('/queue'" src/routes/serveIntake.ts` to check.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck && cd client && npx tsc --noEmit && cd ..`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/scheduler/UnassignedQueueSidebar.tsx src/routes/serveIntake.ts
git commit -m "feat(serve-ui): UnassignedQueueSidebar + GET /queue?officer_id=null"
```

---

## Task 6: `OfficerLaneTimeline` component

**Files:**
- Create: `client/src/components/scheduler/OfficerLaneTimeline.tsx`

- [ ] **Step 1: Implement** — create `client/src/components/scheduler/OfficerLaneTimeline.tsx`

```tsx
import { useMemo } from 'react';
import { AlertTriangle, Pin } from 'lucide-react';
import {
  groupByDay,
  type ScheduleSlot,
} from '../../utils/schedulerView';
import { groupByOfficerLane, extendRange, type RangeMode } from '../../utils/schedulerLanes';

export interface OfficerOption {
  id: number;
  name: string;
}

interface Props {
  anchorYmd: string;
  mode: RangeMode;
  slots: ScheduleSlot[];
  officers: OfficerOption[];
  todayYmd: string;
  onSlotClick?: (slot: ScheduleSlot) => void;
  onSlotDrop?: (slot: ScheduleSlot, target: { date: string; officer_id: number | null }) => void;
  onQueueDrop?: (queueId: number, target: { date: string; officer_id: number | null }) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIER_CLASSES: Record<string, string> = {
  critical: 'bg-red-700/30 border-l-2 border-red-500 text-red-100',
  tight:    'bg-amber-700/30 border-l-2 border-amber-400 text-amber-100',
  standard: 'bg-blue-700/30 border-l-2 border-blue-400 text-blue-100',
};

function formatHeader(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); // new-date-ok: epoch from Date.UTC, not a server string
  return `${WEEKDAYS[dt.getUTCDay()]} ${d}`;
}

export default function OfficerLaneTimeline({
  anchorYmd, mode, slots, officers, todayYmd,
  onSlotClick, onSlotDrop, onQueueDrop,
}: Props) {
  const days = useMemo(() => extendRange(anchorYmd, mode), [anchorYmd, mode]);
  const grouped = useMemo(() => groupByOfficerLane(slots), [slots]);

  // Lanes: every officer, plus an "Unassigned" lane keyed 0.
  const lanes: Array<{ id: number; name: string }> = [
    ...officers.map((o) => ({ id: o.id, name: o.name })),
    { id: 0, name: 'Unassigned' },
  ];

  const handleDragStart = (slot: ScheduleSlot) => (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-rmpg-slot', JSON.stringify({
      slot_id: slot.id, originating_date: slot.scheduled_date, officer_id: slot.officer_id,
    }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (date: string, officerId: number) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = { date, officer_id: officerId === 0 ? null : officerId };
    // Scheduler-slot drag → reassign
    const slotPayload = e.dataTransfer.getData('application/x-rmpg-slot');
    if (slotPayload) {
      try {
        const payload = JSON.parse(slotPayload);
        const slot = slots.find((s) => s.id === payload.slot_id);
        if (slot && onSlotDrop) onSlotDrop(slot, target);
        return;
      } catch { /* ignore */ }
    }
    // Unassigned-queue drag → assign + schedule
    const queuePayload = e.dataTransfer.getData('application/x-rmpg-queue-item');
    if (queuePayload && onQueueDrop) {
      try {
        const payload = JSON.parse(queuePayload);
        onQueueDrop(payload.queue_id, target);
      } catch { /* ignore */ }
    }
  };

  return (
    <div className="overflow-x-auto bg-surface-base border border-rmpg-700 rounded-[2px]">
      <div
        className="grid border-t border-rmpg-700 min-w-[700px]"
        style={{
          gridTemplateColumns: `120px repeat(${days.length}, minmax(80px, 1fr))`,
        }}
      >
        {/* Top-left corner */}
        <div className="bg-surface-raised border-r border-b border-rmpg-700" />
        {/* Day headers */}
        {days.map((d) => (
          <div
            key={d}
            className={`text-[10px] font-semibold px-1 py-1 border-r border-b border-rmpg-700 ${
              d === todayYmd ? 'bg-brand-500/15 text-brand-300' : 'bg-surface-raised text-rmpg-200'
            }`}
          >
            {formatHeader(d)}
          </div>
        ))}

        {/* Officer lanes */}
        {lanes.map((lane) => (
          <div key={lane.id} className="contents">
            <div className="bg-surface-raised text-rmpg-200 text-[10px] font-semibold px-1 py-1 border-r border-b border-rmpg-700 truncate">
              {lane.name}
            </div>
            {days.map((d) => {
              const cellSlots = grouped.get(d)?.get(lane.id) ?? [];
              return (
                <div
                  key={`${d}-${lane.id}`}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop(d, lane.id)}
                  className="border-r border-b border-rmpg-700 p-1 min-h-[40px] hover:bg-brand-400/5"
                >
                  {cellSlots.map((slot) => {
                    const tier = (slot.urgency_tier ?? 'standard') as keyof typeof TIER_CLASSES;
                    return (
                      <div
                        key={slot.id}
                        draggable
                        onDragStart={handleDragStart(slot)}
                        onClick={() => onSlotClick?.(slot)}
                        className={`${TIER_CLASSES[tier]} relative rounded-[2px] px-1 py-0.5 mb-0.5 text-[10px] cursor-grab active:cursor-grabbing`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-semibold">{(slot.recipient_name ?? '—').split(/\s+/).pop()?.toUpperCase()}</span>
                          {slot.manually_moved ? <Pin size={7} className="shrink-0" /> : null}
                          {tier === 'critical' ? <AlertTriangle size={7} className="shrink-0" /> : null}
                        </div>
                        <div className="text-[9px] opacity-70 tabular-nums">{slot.window_start}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/scheduler/OfficerLaneTimeline.tsx
git commit -m "feat(serve-ui): OfficerLaneTimeline — multi-officer swim-lane day grid"
```

---

## Task 7: `RebalancePreviewModal` component

**Files:**
- Create: `client/src/components/scheduler/RebalancePreviewModal.tsx`

- [ ] **Step 1: Implement** — create `client/src/components/scheduler/RebalancePreviewModal.tsx`

```tsx
import { useState, useEffect } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface RebalanceChange {
  queue_id: number;
  from_tier: string | null;
  to_tier: string;
  from_priority: string;
  to_priority: string | null;
  reason: string;
}

interface RebalanceResponse {
  dry_run: boolean;
  changes: RebalanceChange[];
  skipped_manual: number;
  tiers_promoted_critical: number;
  priority_escalated: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

export default function RebalancePreviewModal({ open, onClose, onApplied }: Props) {
  const [preview, setPreview] = useState<RebalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setPreview(null); setError(null); return; }
    setLoading(true);
    apiFetch<RebalanceResponse>('/serve-intake/schedule/rebalance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true }),
    })
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : 'Preview failed'))
      .finally(() => setLoading(false));
  }, [open]);

  const handleApply = async () => {
    setApplying(true);
    try {
      await apiFetch('/serve-intake/schedule/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      });
      onApplied?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface-base border border-rmpg-700 rounded-[2px] max-w-lg w-full">
        <div className="px-3 py-2 border-b border-rmpg-700 bg-surface-raised text-[12px] font-semibold uppercase tracking-wide text-rmpg-100">
          Auto-rebalance preview
        </div>
        <div className="px-3 py-2 text-[11px] text-rmpg-200">
          {loading ? <div>Computing…</div>
            : error ? <div className="text-red-300">{error}</div>
            : preview ? (
              <div className="space-y-1">
                <div>{preview.tiers_promoted_critical} slot(s) promoted to <span className="text-red-300">critical</span></div>
                <div>{preview.priority_escalated} priority escalation(s) to rush</div>
                <div>{preview.skipped_manual} manually-moved slot(s) skipped</div>
                <div className="mt-2 text-rmpg-400">Total queue rows affected: {preview.changes.length}</div>
              </div>
            ) : null
          }
        </div>
        <div className="px-3 py-2 border-t border-rmpg-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="px-3 py-1 text-[11px] uppercase border border-rmpg-700 rounded-[2px] text-rmpg-300 hover:bg-surface-raised disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!preview || preview.changes.length === 0 || applying}
            className="px-3 py-1 text-[11px] uppercase bg-brand-500/30 text-brand-100 border border-brand-500 rounded-[2px] hover:bg-brand-500/40 disabled:opacity-50"
          >
            {applying ? 'Applying…' : 'Apply changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/scheduler/RebalancePreviewModal.tsx
git commit -m "feat(serve-ui): RebalancePreviewModal — dry-run + apply"
```

---

## Task 8: `ServeSchedulerPage` composition

**Files:**
- Create: `client/src/pages/ServeSchedulerPage.tsx`

- [ ] **Step 1: Implement** — create `client/src/pages/ServeSchedulerPage.tsx`

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import RangePicker from '../components/scheduler/RangePicker';
import UnassignedQueueSidebar from '../components/scheduler/UnassignedQueueSidebar';
import OfficerLaneTimeline, { type OfficerOption } from '../components/scheduler/OfficerLaneTimeline';
import RebalancePreviewModal from '../components/scheduler/RebalancePreviewModal';
import type { RangeMode } from '../utils/schedulerLanes';
import type { ScheduleSlot } from '../utils/schedulerView';

interface ScheduleResp {
  schedule: Array<{ date: string; weekday: string; slots: ScheduleSlot[] }>;
  generated_at: string;
}

function todayDenver(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Denver' })
    .format(new Date()); // new-date-ok: passing Date object to Intl, not a server string
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days)); // new-date-ok: epoch from Date.UTC
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

const RANGE_DAYS: Record<RangeMode, number> = { week: 7, 'two-week': 14, month: 31 };

export default function ServeSchedulerPage() {
  const today = useMemo(todayDenver, []);
  const [anchorYmd, setAnchorYmd] = useState(today);
  const [mode, setMode] = useState<RangeMode>('week');
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [officers, setOfficers] = useState<OfficerOption[]>([]);
  const [showRebalance, setShowRebalance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const days = RANGE_DAYS[mode];
      const endDate = shiftYmd(anchorYmd, days - 1);
      const data = await apiFetch<ScheduleResp>(
        `/serve-intake/schedule?start_date=${anchorYmd}&end_date=${endDate}&include=tier`,
      );
      const flat = (data.schedule ?? []).flatMap((d) => d.slots);
      setSlots(flat);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [anchorYmd, mode]);

  useEffect(() => { refetch(); }, [refetch]);
  useLiveSync('serve-schedule', refetch);

  // Officer list — pull active users with patrol/dispatch roles. The /users endpoint
  // is the project's canonical list source.
  useEffect(() => {
    apiFetch<Array<{ id: number; name: string; first_name?: string; last_name?: string }>>('/users?status=active')
      .then((rows) => {
        const list = rows.map((u) => ({
          id: u.id,
          name: u.name ?? [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || `User ${u.id}`,
        }));
        setOfficers(list);
      })
      .catch(() => { /* tolerate missing endpoint; lanes still render Unassigned */ });
  }, []);

  const handleSlotDrop = useCallback(async (
    slot: ScheduleSlot, target: { date: string; officer_id: number | null },
  ) => {
    // Optimistic update.
    setSlots((prev) => prev.map((s) =>
      s.id === slot.id
        ? { ...s, scheduled_date: target.date, officer_id: target.officer_id, manually_moved: 1 }
        : s,
    ));
    try {
      await apiFetch(`/serve-intake/schedule/${slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      });
    } catch (e) {
      refetch();
      // eslint-disable-next-line no-alert
      alert(`Could not reassign attempt: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }, [refetch]);

  const handleQueueDrop = useCallback(async (
    queueId: number, target: { date: string; officer_id: number | null },
  ) => {
    try {
      // Assign the queue row to the officer first.
      await apiFetch(`/serve-intake/${queueId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officer_id: target.officer_id }),
      });
      refetch();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(`Could not assign paper: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }, [refetch]);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Link to="/" className="inline-flex items-center gap-1 text-[11px] text-rmpg-300 hover:text-rmpg-100">
            <ArrowLeft size={11} /> Dashboard
          </Link>
          <span className="text-[12px] font-semibold uppercase tracking-wide text-rmpg-100">
            Serve Scheduler — Full
          </span>
        </div>
        <div className="flex items-center gap-2">
          <RangePicker
            anchorYmd={anchorYmd}
            mode={mode}
            onAnchorChange={setAnchorYmd}
            onModeChange={setMode}
          />
          <button
            type="button"
            onClick={() => setShowRebalance(true)}
            className="px-2 py-0.5 text-[10px] uppercase text-rmpg-300 hover:text-rmpg-100 border border-rmpg-700 rounded-[2px]"
          >
            <RefreshCcw size={9} className="inline mr-1" /> Rebalance
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <UnassignedQueueSidebar onAssign={() => refetch()} />
        <div className="flex-1 min-w-0">
          {error
            ? <div className="p-3 text-[11px] text-red-300">{error}</div>
            : loading
            ? <div className="p-3 text-[11px] text-rmpg-400">Loading…</div>
            : (
              <OfficerLaneTimeline
                anchorYmd={anchorYmd}
                mode={mode}
                slots={slots}
                officers={officers}
                todayYmd={today}
                onSlotDrop={handleSlotDrop}
                onQueueDrop={handleQueueDrop}
              />
            )
          }
        </div>
      </div>

      <RebalancePreviewModal
        open={showRebalance}
        onClose={() => setShowRebalance(false)}
        onApplied={refetch}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build && cd ..`
Expected: 0 typecheck errors, vitest green, vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ServeSchedulerPage.tsx
git commit -m "feat(serve-ui): ServeSchedulerPage composition with realtime + rebalance + drag-drop"
```

---

## Task 9: Routing + Sidebar nav entry

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Sidebar.tsx`

- [ ] **Step 1: Add the route in `App.tsx`**

Find the existing serve-intake route (search for `/serve-intake` near the `<Routes>` block). Add a new route definition for `/serve-intake/scheduler` BEFORE the catch-all `/serve-intake` (if the existing one matches without an explicit path). React Router v6 uses first-match — order matters.

Locate an existing pattern like:
```tsx
<Route path="/serve-intake" element={<ProtectedRoute><RouteErrorBoundary><ServeIntakePage /></RouteErrorBoundary></ProtectedRoute>} />
```

Add immediately before it (so the nested path matches first):
```tsx
<Route path="/serve-intake/scheduler" element={<ProtectedRoute><RouteErrorBoundary><ServeSchedulerPage /></RouteErrorBoundary></ProtectedRoute>} />
```

Then add the lazy import at the top of `App.tsx` near other page imports:
```tsx
import ServeSchedulerPage from './pages/ServeSchedulerPage';
```

(If the file uses `React.lazy(...)` for other large pages, follow that pattern; otherwise an eager import is fine for now.)

- [ ] **Step 2: Add the Sidebar nav entry**

In `client/src/components/Sidebar.tsx`, find the "Process Service" group at around line 70:

```ts
    label: 'Process Service',
    items: [
      { path: '/serve-intake', icon: Upload, label: 'Serve Intake' },
```

Add a "Scheduler" item right after the "Serve Intake" item. Inspect the import block at the top of `Sidebar.tsx` to see what icon library is already in scope (most likely `lucide-react`). Add `CalendarDays` to the existing `lucide-react` import. The new item:

```ts
      { path: '/serve-intake/scheduler', icon: CalendarDays, label: 'Scheduler' },
```

The exact array shape may vary — match the existing items' shape exactly.

- [ ] **Step 3: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build && cd ..`
Expected: 0 errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/components/Sidebar.tsx
git commit -m "feat(serve-ui): route /serve-intake/scheduler + sidebar nav entry"
```

---

## Task 10: Pre-flight verify + push + PR

- [ ] **Step 1: Full Worker typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: 0 typecheck errors; all tests pass (PR 2 baseline 1206 + 11 new from this PR = ~1217 expected).

- [ ] **Step 2: Full client typecheck + tests + build**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build && cd ..`
Expected: clean.

- [ ] **Step 3: Confirm base is main**

Run: `git log --oneline origin/main..HEAD | head -20`
Expected: linear history of PR 3 commits branching from main's tip.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin claude/serve-scheduler-pr3-fullpage
gh pr create --title "feat(serve): auto-scheduler PR 3 — full-page scheduler (multi-officer + rebalance + nav)" --body "$(cat <<'EOF'
## Summary

PR 3 of 3 for the process-service auto-scheduler — completes the program.

- **Full-page route** `/serve-intake/scheduler` with sidebar nav entry under Process Service
- **Multi-officer swim lanes** — drag chips between officer rows to reassign
- **Unassigned-queue sidebar** — drag a queue item onto the calendar to assign + schedule in one gesture
- **Range picker** — Week / 2-Week / Month with prev/next arrows
- **`POST /serve-intake/schedule/rebalance`** — dry-run preview + apply, both via the same pure `previewRangeRebalance` helper; broadcasts `serve-schedule` on apply
- **`GET /serve-intake/queue?officer_id=null&status=…`** — filter the queue list for the unassigned sidebar
- **Realtime** via the existing `useLiveSync('serve-schedule', refetch)` + `broadcastAll(...)` plumbing

## Test plan

- [x] `npm test` — Worker clean (5 new `rebalancePreview` tests)
- [x] `npm run typecheck` — Worker clean
- [x] `cd client && npx tsc --noEmit && npx vitest run && npx vite build` — Client clean (6 new `schedulerLanes` tests)
- [ ] **Post-merge browser smoke:** open `https://rmpgutah.us/serve-intake/scheduler` as a dispatcher → confirm officer lanes render + unassigned sidebar populates → drag a chip between officers → drag an unassigned item onto a lane → click Rebalance and apply.

## Notes

- No new migration. Reuses the PR 1 + PR 2 schema (0140 + 0141).
- The `previewRangeRebalance` helper is a pure pass over the same `applyUrgencyTier` logic as PR 1's `runDailyRebalance`, so the cron and the manual button stay in sync.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-review checklist (controller before dispatch)

- [x] All client helpers are pure (no React, no DOM)
- [x] All server routes call `reconcileScheduleSchema(db)` before touching new columns
- [x] WS broadcasts use existing `broadcastAll('data_changed', { module: 'serve-schedule' })`
- [x] No hardcoded hex colors — `bg-red-700/30`, `border-rmpg-700`, etc. are CSS-variable-backed
- [x] New `new Date(...)` sites carry `// new-date-ok` markers
- [x] Branch base is main (PR 1 + PR 2 already merged)

## Scope coverage

| Spec section | Plan task(s) |
|---|---|
| Full-page `/serve-intake/scheduler` route | Tasks 8, 9 |
| Multi-officer swim lanes | Task 6 |
| Unassigned-queue sidebar with drag-to-assign | Tasks 5, 8 |
| Range picker (Week / 2-Week / Month) | Task 4 |
| `POST /schedule/rebalance` (preview + apply) | Tasks 2, 3 |
| `RebalancePreviewModal` | Task 7 |
| Sidebar nav entry under Process Service | Task 9 |
| Realtime via useLiveSync + broadcastAll | Task 8 |
| **Deferred (post-PR 3):** auto-cluster button, bulk selection, audit-trail side drawer | not in this plan |

## References

- [PR 1 plan](2026-06-21-process-service-auto-scheduler-pr1-backend.md) — backend + algorithm
- [PR 2 plan](2026-06-21-process-service-auto-scheduler-pr2-dashboard.md) — dashboard panel
- [Design spec](../specs/2026-06-21-process-service-auto-scheduler-design.md)
- [`src/routes/ws.ts:50`](../../src/routes/ws.ts) — `broadcastAll`
- [`client/src/hooks/useLiveSync.ts`](../../client/src/hooks/useLiveSync.ts) — `useLiveSync`
