# Process Service Auto-Scheduler — PR 2 (Dashboard Panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `ServeSchedulerPanel` to the Spillman dashboard — a week-timeline (default) / month-grid (toggle) view of upcoming attempt windows with drag-to-reschedule, realtime updates via existing `useLiveSync` + `broadcastAll`, and a new `PATCH /serve-intake/schedule/:slotId` endpoint guarded by stale + overlap detection.

**Architecture:** Pure helpers in `client/src/utils/schedulerView.ts` + `client/src/components/scheduler/dnd.ts` (no React, no DOM) → dumb React components that render whatever the helpers shape → `ServeSchedulerPanel` composes them, subscribes via `useLiveSync('serve-schedule', refetch)`, dispatches drag-end as `PATCH /schedule/:slotId`. Worker side mirrors PR 1's pattern: pure `slotOverlap()` + `isStaleUpdate()` helpers in `src/utils/serveScheduleEdit.ts`, the route is a thin wrapper that broadcasts via the existing `broadcastAll('data_changed', { module: 'serve-schedule', ... })` after a successful write.

**Tech Stack:** React 18 + TypeScript + Tailwind for the panel (CSS-variable-backed theme tokens — no hardcoded hex). HTML5 native drag-and-drop for the move gesture (no library). vitest + jsdom for component tests. Hono on the Worker side. D1 for persistence.

**Stacks on:** PR 1 (`claude/modest-faraday-90b9f8`). PR 2's branch (`claude/serve-scheduler-pr2-dashboard`) is based on PR 1's tip; the GitHub PR's base is `claude/modest-faraday-90b9f8`, not `main`. When PR 1 merges, GitHub auto-retargets PR 2 to main.

---

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `client/src/utils/schedulerView.ts` | Pure layout helpers: `groupByDay`, `groupByHour`, `computeChipBand`, `formatDayHeader`, `dayRangeFromAnchor` |
| Create | `client/src/utils/__tests__/schedulerView.test.ts` | Unit tests for the helpers |
| Create | `client/src/components/scheduler/dnd.ts` | Pure drag math: `snapToBand`, `bandFromMouseEvent`, `validateDrop` |
| Create | `client/src/components/scheduler/__tests__/dnd.test.ts` | Unit tests for drag math |
| Create | `client/src/components/scheduler/AttemptChip.tsx` | Dumb chip — renders recipient, time, priority badge, urgency color, manually-moved pin |
| Create | `client/src/components/scheduler/WeekTimeline.tsx` | 7-day horizontal timeline; chips positioned via CSS grid bands |
| Create | `client/src/components/scheduler/MonthGrid.tsx` | Month calendar; each cell shows up to 3 chips + overflow count |
| Create | `client/src/components/scheduler/ServeSchedulerPanel.tsx` | Top-level panel: wraps WeekTimeline / MonthGrid with toolbar, useLiveSync, drag handler |
| Modify | `client/src/pages/dashboard/dashboardViews.ts` | Add `'serveSchedule'` to `PanelId`, `PANEL_IDS`, `VIEW_PANELS.dispatch`, `VIEW_PANELS.admin` |
| Modify | `client/src/pages/DashboardPage.tsx` | Render `<ServeSchedulerPanel />` for the `serveSchedule` panel id |
| Modify | `client/public/sw.js` | Bump `CACHE_NAME` so users get the new bundle |
| Create | `src/utils/serveScheduleEdit.ts` | Pure helpers: `detectSlotOverlap`, `isStaleUpdate`, `normalizeWindow` |
| Create | `tests/serveScheduleEdit.test.ts` | Unit tests for the edit helpers |
| Modify | `src/routes/serveIntake.ts` | Add `PATCH /schedule/:slotId` route; broadcast `serve-schedule` events from attempts handler |

**Why these boundaries:** Pure helpers stay testable without React or D1. Components remain dumb (one render concern each). The panel composes via `useLiveSync` so realtime is free. The Worker route is a thin wrapper around pure helpers — same pattern that worked for PR 1's algorithm tasks.

---

## Task 1: Pure `schedulerView` helpers

**Files:**
- Create: `client/src/utils/schedulerView.ts`
- Test: `client/src/utils/__tests__/schedulerView.test.ts`

- [ ] **Step 1: Write the failing tests** — create `client/src/utils/__tests__/schedulerView.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  dayRangeFromAnchor,
  groupByDay,
  formatDayHeader,
  computeChipBand,
  type ScheduleSlot,
} from '../schedulerView';

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: 1, queue_id: 10, attempt_number: 1,
  scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30',
  window_label: 'evening', notify_at: '2026-06-21T15:00',
  recipient_name: 'J. Smith', recipient_address: '123 Main',
  recipient_city: 'SLC', recipient_state: 'UT',
  case_number: '240-1', priority: 'normal', deadline: null,
  status: 'pending', notified: 0, dismissed: 0,
  officer_id: null, manually_moved: 0, auto_replan_source: null,
  urgency_tier: 'standard',
  ...over,
});

describe('dayRangeFromAnchor', () => {
  it('returns 7 sequential YYYY-MM-DD strings starting at the anchor', () => {
    const days = dayRangeFromAnchor('2026-06-21', 7);
    expect(days).toEqual([
      '2026-06-21', '2026-06-22', '2026-06-23', '2026-06-24',
      '2026-06-25', '2026-06-26', '2026-06-27',
    ]);
  });

  it('handles month rollover', () => {
    const days = dayRangeFromAnchor('2026-06-29', 4);
    expect(days).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02']);
  });
});

describe('groupByDay', () => {
  it('groups slots by scheduled_date and keeps order within a day', () => {
    const a = slot({ id: 1, scheduled_date: '2026-06-21', window_start: '08:00' });
    const b = slot({ id: 2, scheduled_date: '2026-06-21', window_start: '17:00' });
    const c = slot({ id: 3, scheduled_date: '2026-06-22', window_start: '09:00' });
    const grouped = groupByDay([b, a, c]);
    expect(grouped.get('2026-06-21')?.map(s => s.id)).toEqual([1, 2]);
    expect(grouped.get('2026-06-22')?.map(s => s.id)).toEqual([3]);
  });

  it('returns an empty Map for an empty input', () => {
    expect(groupByDay([]).size).toBe(0);
  });
});

describe('formatDayHeader', () => {
  it('returns short weekday + day-of-month from a YYYY-MM-DD string', () => {
    // 2026-06-21 is a Sunday in any timezone (the date is fixed by the string).
    expect(formatDayHeader('2026-06-21')).toBe('Sun 21');
  });

  it('handles single-digit days', () => {
    expect(formatDayHeader('2026-06-07')).toBe('Sun 7');
  });
});

describe('computeChipBand', () => {
  it('maps an evening 17:00–20:30 window to row 7, span 2', () => {
    // 2-hour bands starting at 06:00:
    //   06–08 = row 1, 08–10 = row 2, 10–12 = row 3, 12–14 = row 4,
    //   14–16 = row 5, 16–18 = row 6, 18–20 = row 7, 20–22 = row 8, 22–24 = row 9.
    // Window 17:00–20:30 starts in row 6, spans into row 8 → row=6 span=3.
    const band = computeChipBand('17:00', '20:30');
    expect(band).toEqual({ rowStart: 6, rowSpan: 3 });
  });

  it('clamps a pre-dawn window 04:00–05:00 to row 1', () => {
    expect(computeChipBand('04:00', '05:00')).toEqual({ rowStart: 1, rowSpan: 1 });
  });

  it('clamps a midnight-spanning window to the last visible band', () => {
    expect(computeChipBand('23:00', '23:59')).toEqual({ rowStart: 9, rowSpan: 1 });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd client && npx vitest run src/utils/__tests__/schedulerView.test.ts`
Expected: failures with `Cannot find module '../schedulerView'`.

- [ ] **Step 3: Implement** — create `client/src/utils/schedulerView.ts`

```ts
// ============================================================
// RMPG Flex — ServeSchedulerPanel pure layout helpers
// ============================================================
// All functions are pure (no React, no DOM, no Date.now). The panel's
// dynamic state lives in component-local React state; these helpers
// just shape data for rendering.
//
// Band layout: the WeekTimeline panel renders 06:00–24:00 in 2-hour bands.
//   Row 1 = 06–08, Row 2 = 08–10, ..., Row 9 = 22–24.
//   Earlier hours snap to row 1; later hours clamp to row 9.
// ============================================================

export interface ScheduleSlot {
  id: number;
  queue_id: number;
  attempt_number: number;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  window_label: string | null;
  notify_at: string;
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  case_number: string | null;
  priority: string;
  deadline: string | null;
  status: string;
  notified: number;
  dismissed: number;
  officer_id: number | null;
  manually_moved: number;
  auto_replan_source: number | null;
  urgency_tier: 'critical' | 'tight' | 'standard' | null;
}

// 7-day rolling window starting at `anchorYmd`. Returns N consecutive
// YYYY-MM-DD strings; handles month + year rollover via Date math.
export function dayRangeFromAnchor(anchorYmd: string, count: number): string[] {
  const [y, m, d] = anchorYmd.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

// Group by scheduled_date AND sort each day's slots by window_start.
export function groupByDay(slots: ScheduleSlot[]): Map<string, ScheduleSlot[]> {
  const map = new Map<string, ScheduleSlot[]>();
  for (const s of slots) {
    const arr = map.get(s.scheduled_date) ?? [];
    arr.push(s);
    map.set(s.scheduled_date, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.window_start.localeCompare(b.window_start));
  }
  return map;
}

// "Sun 21" — short weekday + day number, no leading zero on day.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function formatDayHeader(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${d}`;
}

// Map an HH:MM window to a 2-hour band row + row span.
// Row 1 = 06–08, row 9 = 22–24. Pre-dawn snaps to row 1; post-midnight clamps to row 9.
export function computeChipBand(
  windowStart: string,
  windowEnd: string,
): { rowStart: number; rowSpan: number } {
  const startH = parseInt(windowStart.split(':')[0], 10);
  const endH = parseInt(windowEnd.split(':')[0], 10);
  const endM = parseInt(windowEnd.split(':')[1] ?? '0', 10);

  const rowStart = Math.max(1, Math.min(9, Math.floor((startH - 6) / 2) + 1));
  // End row uses ceiling so a 20:30 end lands in row 8 (18–20 + spill into 20–22).
  const endBucket = Math.max(1, Math.min(9,
    Math.ceil((endH * 60 + endM - 6 * 60) / 120),
  ));
  const rowSpan = Math.max(1, endBucket - rowStart + 1);
  return { rowStart, rowSpan };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd client && npx vitest run src/utils/__tests__/schedulerView.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/schedulerView.ts client/src/utils/__tests__/schedulerView.test.ts
git commit -m "feat(serve-ui): schedulerView pure layout helpers + tests"
```

---

## Task 2: Pure `dnd` drag math

**Files:**
- Create: `client/src/components/scheduler/dnd.ts`
- Test: `client/src/components/scheduler/__tests__/dnd.test.ts`

- [ ] **Step 1: Write the failing tests** — create `client/src/components/scheduler/__tests__/dnd.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { snapToBand, validateDrop, type DragPayload } from '../dnd';

describe('snapToBand', () => {
  it('returns HH:MM window-start for the target band', () => {
    // Row 1 → 06:00, Row 2 → 08:00, ..., Row 9 → 22:00.
    expect(snapToBand(1)).toEqual({ window_start: '06:00', window_end: '08:00' });
    expect(snapToBand(6)).toEqual({ window_start: '16:00', window_end: '18:00' });
    expect(snapToBand(9)).toEqual({ window_start: '22:00', window_end: '23:59' });
  });

  it('clamps an out-of-range row to row 1', () => {
    expect(snapToBand(0)).toEqual({ window_start: '06:00', window_end: '08:00' });
    expect(snapToBand(-3)).toEqual({ window_start: '06:00', window_end: '08:00' });
  });

  it('clamps a row past 9 to row 9', () => {
    expect(snapToBand(10)).toEqual({ window_start: '22:00', window_end: '23:59' });
    expect(snapToBand(99)).toEqual({ window_start: '22:00', window_end: '23:59' });
  });
});

describe('validateDrop', () => {
  const drag: DragPayload = { slot_id: 42, originating_date: '2026-06-21', officer_id: 1 };

  it('rejects a drop on the same band the chip came from', () => {
    expect(validateDrop(drag, { date: '2026-06-21', row: 6 }, { row: 6 })).toEqual({
      ok: false, reason: 'no-op',
    });
  });

  it('accepts a drop on a different day', () => {
    expect(validateDrop(drag, { date: '2026-06-22', row: 6 }, { row: 6 })).toEqual({
      ok: true,
    });
  });

  it('accepts a drop on a different band of the same day', () => {
    expect(validateDrop(drag, { date: '2026-06-21', row: 7 }, { row: 6 })).toEqual({
      ok: true,
    });
  });

  it('rejects a drop with no payload', () => {
    expect(validateDrop(null, { date: '2026-06-21', row: 6 }, { row: 6 })).toEqual({
      ok: false, reason: 'no-payload',
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd client && npx vitest run src/components/scheduler/__tests__/dnd.test.ts`
Expected: failures with `Cannot find module '../dnd'`.

- [ ] **Step 3: Implement** — create `client/src/components/scheduler/dnd.ts`

```ts
// ============================================================
// RMPG Flex — Scheduler drag math (pure, no React, no DOM)
// ============================================================
// Bands are 2-hour rows mapping 06:00–24:00 onto rows 1–9 of the
// WeekTimeline CSS grid. snapToBand inverts the band index back to
// an HH:MM window pair the API expects.
// ============================================================

export interface DragPayload {
  slot_id: number;
  originating_date: string;
  officer_id: number | null;
}

export interface DropTarget {
  date: string;
  row: number;
}

export interface DropOrigin {
  row: number;
}

export type DropValidation =
  | { ok: true }
  | { ok: false; reason: 'no-op' | 'no-payload' };

// Row → (window_start, window_end). Row 9 is special-cased to 22:00–23:59
// because the schema's TEXT comparison treats 24:00 as undefined.
export function snapToBand(row: number): { window_start: string; window_end: string } {
  const clamped = Math.max(1, Math.min(9, row));
  if (clamped === 9) return { window_start: '22:00', window_end: '23:59' };
  const startH = 6 + (clamped - 1) * 2;
  const endH = startH + 2;
  return {
    window_start: `${String(startH).padStart(2, '0')}:00`,
    window_end: `${String(endH).padStart(2, '0')}:00`,
  };
}

export function validateDrop(
  payload: DragPayload | null,
  target: DropTarget,
  origin: DropOrigin,
): DropValidation {
  if (!payload) return { ok: false, reason: 'no-payload' };
  if (payload.originating_date === target.date && origin.row === target.row) {
    return { ok: false, reason: 'no-op' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd client && npx vitest run src/components/scheduler/__tests__/dnd.test.ts`
Expected: 7 PASS (snapToBand 3 + validateDrop 4).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/scheduler/dnd.ts client/src/components/scheduler/__tests__/dnd.test.ts
git commit -m "feat(serve-ui): scheduler dnd pure helpers + tests"
```

---

## Task 3: `AttemptChip` component

**Files:**
- Create: `client/src/components/scheduler/AttemptChip.tsx`

- [ ] **Step 1: Implement** — create `client/src/components/scheduler/AttemptChip.tsx`

```tsx
import { Pin, AlertTriangle } from 'lucide-react';
import type { ScheduleSlot } from '../../utils/schedulerView';

interface Props {
  slot: ScheduleSlot;
  onClick?: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
}

const TIER_CLASSES: Record<string, string> = {
  critical: 'bg-red-700/30 border-l-2 border-red-500 text-red-100',
  tight:    'bg-amber-700/30 border-l-2 border-amber-400 text-amber-100',
  standard: 'bg-blue-700/30 border-l-2 border-blue-400 text-blue-100',
};

function surnameOf(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? name).toUpperCase();
}

export default function AttemptChip({ slot, onClick, onDragStart }: Props) {
  const tier = (slot.urgency_tier ?? 'standard') as keyof typeof TIER_CLASSES;
  const cls = TIER_CLASSES[tier];
  const surname = surnameOf(slot.recipient_name);
  const time = `${slot.window_start}–${slot.window_end}`;

  return (
    <div
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      className={`${cls} relative h-full w-full overflow-hidden rounded-[2px] px-1 py-0.5 text-[10px] leading-tight cursor-grab active:cursor-grabbing`}
      title={`${slot.recipient_name ?? ''} • ${slot.case_number ?? ''} • ${time}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="truncate font-semibold">{surname}</span>
        {slot.manually_moved ? <Pin size={8} className="shrink-0 mt-0.5" /> : null}
        {tier === 'critical' ? <AlertTriangle size={8} className="shrink-0 mt-0.5" /> : null}
      </div>
      <div className="text-[9px] opacity-80 tabular-nums">{time}</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/scheduler/AttemptChip.tsx
git commit -m "feat(serve-ui): AttemptChip — tier color + manually-moved pin + drag handle"
```

---

## Task 4: `WeekTimeline` component

**Files:**
- Create: `client/src/components/scheduler/WeekTimeline.tsx`

- [ ] **Step 1: Implement** — create `client/src/components/scheduler/WeekTimeline.tsx`

```tsx
import { useMemo } from 'react';
import AttemptChip from './AttemptChip';
import {
  dayRangeFromAnchor,
  groupByDay,
  formatDayHeader,
  computeChipBand,
  type ScheduleSlot,
} from '../../utils/schedulerView';
import { snapToBand, type DragPayload } from './dnd';

interface Props {
  anchorYmd: string;             // first day of the visible window (YYYY-MM-DD)
  slots: ScheduleSlot[];
  todayYmd: string;              // for highlighting the Today column
  onSlotClick?: (slot: ScheduleSlot) => void;
  onSlotDrop?: (slot: ScheduleSlot, target: { date: string; window_start: string; window_end: string }) => void;
}

const HOUR_BANDS = ['06–08', '08–10', '10–12', '12–14', '14–16', '16–18', '18–20', '20–22', '22+'];

export default function WeekTimeline({
  anchorYmd, slots, todayYmd, onSlotClick, onSlotDrop,
}: Props) {
  const days = useMemo(() => dayRangeFromAnchor(anchorYmd, 7), [anchorYmd]);
  const grouped = useMemo(() => groupByDay(slots), [slots]);

  const handleDragStart = (slot: ScheduleSlot) => (e: React.DragEvent<HTMLDivElement>) => {
    const payload: DragPayload = {
      slot_id: slot.id,
      originating_date: slot.scheduled_date,
      officer_id: slot.officer_id,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (date: string, row: number) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!onSlotDrop) return;
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const payload = JSON.parse(raw) as DragPayload;
      const slot = slots.find((s) => s.id === payload.slot_id);
      if (!slot) return;
      const window = snapToBand(row);
      onSlotDrop(slot, { date, ...window });
    } catch { /* ignore malformed drag payload */ }
  };

  return (
    <div className="overflow-x-auto">
      <div
        className="grid border-t border-rmpg-700 min-w-[700px]"
        style={{
          gridTemplateColumns: `48px repeat(7, minmax(80px, 1fr))`,
          gridTemplateRows: `26px repeat(9, 32px)`,
        }}
      >
        {/* Top-left corner */}
        <div className="bg-surface-raised border-r border-rmpg-700" />

        {/* Day headers */}
        {days.map((d) => (
          <div
            key={d}
            className={`text-[10px] font-semibold px-1 py-1 border-r border-rmpg-700 ${
              d === todayYmd ? 'bg-brand-500/15 text-brand-300' : 'bg-surface-raised text-rmpg-200'
            }`}
          >
            {formatDayHeader(d)}
          </div>
        ))}

        {/* Hour labels + drop targets */}
        {HOUR_BANDS.map((label, idx) => (
          <div key={`row-${idx}`} className="contents">
            <div className="text-[9px] text-rmpg-400 px-1 pt-0.5 border-r border-t border-rmpg-700 tabular-nums">
              {label}
            </div>
            {days.map((d) => (
              <div
                key={`${d}-${idx}`}
                className="border-r border-t border-rmpg-700 relative hover:bg-brand-400/5"
                onDragOver={handleDragOver}
                onDrop={handleDrop(d, idx + 1)}
              />
            ))}
          </div>
        ))}

        {/* Chips overlaid via grid-row positioning */}
        {days.map((d, dayIdx) => {
          const daySlots = grouped.get(d) ?? [];
          return daySlots.map((slot) => {
            const band = computeChipBand(slot.window_start, slot.window_end);
            return (
              <div
                key={slot.id}
                className="z-10 px-0.5 py-0.5"
                style={{
                  gridColumn: `${dayIdx + 2}`,
                  gridRow: `${band.rowStart + 1} / span ${band.rowSpan}`,
                }}
              >
                <AttemptChip
                  slot={slot}
                  onClick={() => onSlotClick?.(slot)}
                  onDragStart={handleDragStart(slot)}
                />
              </div>
            );
          });
        })}
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
git add client/src/components/scheduler/WeekTimeline.tsx
git commit -m "feat(serve-ui): WeekTimeline 7-day grid with chip drag-drop"
```

---

## Task 5: `MonthGrid` component

**Files:**
- Create: `client/src/components/scheduler/MonthGrid.tsx`

- [ ] **Step 1: Implement** — create `client/src/components/scheduler/MonthGrid.tsx`

```tsx
import { useMemo } from 'react';
import { groupByDay, type ScheduleSlot } from '../../utils/schedulerView';

interface Props {
  anchorYmd: string;             // any date in the month to display
  slots: ScheduleSlot[];
  todayYmd: string;
  onDayClick?: (ymd: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Build the visible month grid: leading blank cells from prior month so the
// first row starts on Sunday, then every day of the month, then trailing
// blanks if needed to fill the last row.
function monthCells(anchorYmd: string): Array<{ ymd: string | null; inMonth: boolean }> {
  const [y, m] = anchorYmd.split('-').map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const firstWeekday = firstOfMonth.getUTCDay();
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<{ ymd: string | null; inMonth: boolean }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ ymd: null, inMonth: false });
  for (let d = 1; d <= lastOfMonth; d++) {
    const dd = String(d).padStart(2, '0');
    cells.push({ ymd: `${y}-${String(m).padStart(2, '0')}-${dd}`, inMonth: true });
  }
  while (cells.length % 7 !== 0) cells.push({ ymd: null, inMonth: false });
  return cells;
}

const TIER_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  tight: 'bg-amber-400',
  standard: 'bg-blue-400',
};

export default function MonthGrid({ anchorYmd, slots, todayYmd, onDayClick }: Props) {
  const cells = useMemo(() => monthCells(anchorYmd), [anchorYmd]);
  const grouped = useMemo(() => groupByDay(slots), [slots]);

  return (
    <div>
      <div className="grid grid-cols-7 border-t border-rmpg-700">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="text-[10px] font-semibold py-1 px-1 bg-surface-raised text-rmpg-200 border-r border-rmpg-700"
          >
            {w}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell.inMonth) {
            return (
              <div
                key={`blank-${i}`}
                className="aspect-square border-r border-t border-rmpg-700 bg-surface-base/40"
              />
            );
          }
          const daySlots = grouped.get(cell.ymd!) ?? [];
          const isToday = cell.ymd === todayYmd;
          const tierCounts = daySlots.reduce<Record<string, number>>((acc, s) => {
            const t = s.urgency_tier ?? 'standard';
            acc[t] = (acc[t] ?? 0) + 1;
            return acc;
          }, {});
          return (
            <button
              key={cell.ymd}
              type="button"
              onClick={() => onDayClick?.(cell.ymd!)}
              className={`aspect-square border-r border-t border-rmpg-700 p-1 text-left hover:bg-brand-400/5 ${
                isToday ? 'ring-1 ring-inset ring-brand-400 bg-brand-500/10' : ''
              }`}
            >
              <div className="text-[10px] font-semibold text-rmpg-200">
                {parseInt(cell.ymd!.slice(8), 10)}
              </div>
              <div className="mt-1 flex flex-wrap gap-0.5">
                {(['critical', 'tight', 'standard'] as const).map((t) =>
                  tierCounts[t]
                    ? (
                      <span
                        key={t}
                        className={`inline-flex items-center gap-0.5 rounded-[2px] px-1 text-[9px] font-semibold text-white ${TIER_DOT[t]}`}
                      >
                        <span className="w-1 h-1 rounded-full bg-white/80" />
                        {tierCounts[t]}
                      </span>
                    ) : null,
                )}
              </div>
            </button>
          );
        })}
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
git add client/src/components/scheduler/MonthGrid.tsx
git commit -m "feat(serve-ui): MonthGrid calendar with per-tier counts per day"
```

---

## Task 6: `serveScheduleEdit` pure helpers + `PATCH /schedule/:slotId` route

**Files:**
- Create: `src/utils/serveScheduleEdit.ts`
- Create: `tests/serveScheduleEdit.test.ts`
- Modify: `src/routes/serveIntake.ts`

- [ ] **Step 1: Write the failing tests** — create `tests/serveScheduleEdit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  detectSlotOverlap,
  isStaleUpdate,
  normalizeWindow,
  type SlotRow,
} from '../src/utils/serveScheduleEdit';

const row = (over: Partial<SlotRow> = {}): SlotRow => ({
  id: 1, queue_id: 10, officer_id: 1,
  scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30',
  updated_at: '2026-06-21T12:00:00',
  ...over,
});

describe('detectSlotOverlap', () => {
  it('returns empty array when no other slots share the (officer, date)', () => {
    const candidate = { officer_id: 1, scheduled_date: '2026-06-22', window_start: '08:00', window_end: '10:00' };
    expect(detectSlotOverlap([row()], candidate, /* selfId */ 1)).toEqual([]);
  });

  it('returns the conflict when proposed window overlaps an existing one on the same officer + date', () => {
    const existing = row({ id: 5, window_start: '15:00', window_end: '17:30' });
    const candidate = { officer_id: 1, scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30' };
    expect(detectSlotOverlap([existing], candidate, /* selfId */ 99).map((r) => r.id)).toEqual([5]);
  });

  it('does NOT flag the slot being edited as a conflict with itself', () => {
    const existing = row({ id: 5, window_start: '17:00', window_end: '20:30' });
    const candidate = { officer_id: 1, scheduled_date: '2026-06-21', window_start: '17:00', window_end: '20:30' };
    expect(detectSlotOverlap([existing], candidate, /* selfId */ 5)).toEqual([]);
  });

  it('treats edge-touching windows (end == next start) as NON-overlapping', () => {
    const existing = row({ id: 5, window_start: '15:00', window_end: '17:00' });
    const candidate = { officer_id: 1, scheduled_date: '2026-06-21', window_start: '17:00', window_end: '19:00' };
    expect(detectSlotOverlap([existing], candidate, /* selfId */ 99)).toEqual([]);
  });
});

describe('isStaleUpdate', () => {
  it('returns false when the provided timestamp matches the row\'s updated_at', () => {
    expect(isStaleUpdate('2026-06-21T12:00:00', '2026-06-21T12:00:00')).toBe(false);
  });

  it('returns true when the row was updated after the client read it', () => {
    expect(isStaleUpdate('2026-06-21T12:00:00', '2026-06-21T12:30:00')).toBe(true);
  });

  it('returns false when the client did NOT send an If-Unmodified-Since header', () => {
    expect(isStaleUpdate(null, '2026-06-21T12:00:00')).toBe(false);
  });
});

describe('normalizeWindow', () => {
  it('returns HH:MM strings unchanged when already in 24-h format', () => {
    expect(normalizeWindow('14:00', '16:30')).toEqual({ window_start: '14:00', window_end: '16:30' });
  });

  it('pads single-digit hours', () => {
    expect(normalizeWindow('9:00', '11:30')).toEqual({ window_start: '09:00', window_end: '11:30' });
  });

  it('rejects malformed input by throwing', () => {
    expect(() => normalizeWindow('hello', '14:00')).toThrow(/invalid window/i);
    expect(() => normalizeWindow('14:00', '99:99')).toThrow(/invalid window/i);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run tests/serveScheduleEdit.test.ts`
Expected: failures with `Cannot find module '../src/utils/serveScheduleEdit'`.

- [ ] **Step 3: Implement** — create `src/utils/serveScheduleEdit.ts`

```ts
// ============================================================
// RMPG Flex — Serve schedule slot edit helpers (pure)
// ============================================================
// Used by PATCH /serve-intake/schedule/:slotId. The route reads
// existing slots from D1 and asks these helpers whether a proposed
// edit collides with another slot or against a stale read.
// ============================================================

export interface SlotRow {
  id: number;
  queue_id: number;
  officer_id: number | null;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  updated_at: string;
}

export interface CandidateSlot {
  officer_id: number | null;
  scheduled_date: string;
  window_start: string;
  window_end: string;
}

// Open-interval overlap: A end <= B start means edge-touching, no overlap.
// Returns the existing rows that would collide with the candidate.
export function detectSlotOverlap(
  existing: SlotRow[],
  candidate: CandidateSlot,
  selfId: number,
): SlotRow[] {
  return existing.filter((s) => {
    if (s.id === selfId) return false;
    if (s.officer_id !== candidate.officer_id) return false;
    if (s.scheduled_date !== candidate.scheduled_date) return false;
    return !(s.window_end <= candidate.window_start || s.window_start >= candidate.window_end);
  });
}

// Optimistic concurrency check. When the client sends If-Unmodified-Since,
// we compare against the DB's current updated_at; mismatch means another
// dispatcher already moved this slot — surface a 409 so the client can refetch.
export function isStaleUpdate(
  clientUnmodifiedSince: string | null,
  currentUpdatedAt: string,
): boolean {
  if (!clientUnmodifiedSince) return false;
  return clientUnmodifiedSince !== currentUpdatedAt;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

// Pads single-digit hours and validates the window. Throws on malformed input.
export function normalizeWindow(
  start: string, end: string,
): { window_start: string; window_end: string } {
  const padded = (s: string) => {
    const m = HHMM.exec(s);
    if (!m) throw new Error(`invalid window time: ${s}`);
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error(`invalid window time: ${s}`);
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  return { window_start: padded(start), window_end: padded(end) };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/serveScheduleEdit.test.ts`
Expected: 10 PASS.

- [ ] **Step 5: Add the route** — append to `src/routes/serveIntake.ts` (BEFORE `export default si;`)

Find an existing `si.delete('/schedule/:slotId', …)` handler (around line 1122) — it's already in the file. Place the new `PATCH` handler right above it.

```ts
// ── PATCH /schedule/:slotId — manual reschedule (drag-drop or full-page edit) ─
si.patch('/schedule/:slotId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);

  const slotId = parseInt(c.req.param('slotId'), 10);
  if (isNaN(slotId)) return c.json({ error: 'Invalid slot id' }, 400);

  const db = getDb(c.env);
  await reconcileScheduleSchema(db);

  const body = await c.req.json<any>().catch(() => ({}));
  const force = c.req.query('force') === '1';
  const userId = (c.get('userId') as number | undefined) ?? null;
  const ifUnmodifiedSince = c.req.header('If-Unmodified-Since') ?? body.if_unmodified_since ?? null;

  const { detectSlotOverlap, isStaleUpdate, normalizeWindow } = await import('../utils/serveScheduleEdit');

  // Read the slot being edited.
  const current = await queryFirst<{
    id: number; queue_id: number; officer_id: number | null;
    scheduled_date: string; window_start: string; window_end: string;
    updated_at: string;
  }>(
    db,
    `SELECT id, queue_id, officer_id, scheduled_date, window_start, window_end, updated_at
       FROM serve_attempt_schedules WHERE id = ?`,
    slotId,
  );
  if (!current) return c.json({ error: 'Not found' }, 404);

  if (isStaleUpdate(ifUnmodifiedSince, current.updated_at)) {
    return c.json({ error: 'stale', current }, 409);
  }

  // Build the candidate window from body + current row defaults.
  let candidateWindow: { window_start: string; window_end: string };
  try {
    candidateWindow = normalizeWindow(
      String(body.window_start ?? current.window_start),
      String(body.window_end ?? current.window_end),
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const candidateDate = typeof body.scheduled_date === 'string' && body.scheduled_date
    ? body.scheduled_date
    : current.scheduled_date;
  const candidateOfficer = body.officer_id === undefined ? current.officer_id : body.officer_id;

  if (!force) {
    // Pull all other slots on the candidate (officer, date) for overlap detection.
    const peers = await query<{
      id: number; queue_id: number; officer_id: number | null;
      scheduled_date: string; window_start: string; window_end: string;
      updated_at: string;
    }>(
      db,
      `SELECT id, queue_id, officer_id, scheduled_date, window_start, window_end, updated_at
         FROM serve_attempt_schedules
        WHERE scheduled_date = ? AND officer_id IS ?`,
      candidateDate, candidateOfficer,
    );
    const conflicts = detectSlotOverlap(
      peers,
      { officer_id: candidateOfficer, scheduled_date: candidateDate, ...candidateWindow },
      slotId,
    );
    if (conflicts.length) {
      return c.json({ error: 'overlap', conflicts }, 409);
    }
  }

  // Apply the update.
  await execute(
    db,
    `UPDATE serve_attempt_schedules
        SET scheduled_date = ?, window_start = ?, window_end = ?,
            officer_id = ?, manually_moved = 1, moved_by_user_id = ?,
            moved_at = datetime('now'), notified = 0
      WHERE id = ?`,
    candidateDate, candidateWindow.window_start, candidateWindow.window_end,
    candidateOfficer, userId, slotId,
  );

  // If the officer changed, propagate to serve_queue so future attempts route correctly.
  if (candidateOfficer !== current.officer_id) {
    await execute(
      db,
      `UPDATE serve_queue SET officer_id = ? WHERE id = ?`,
      candidateOfficer, current.queue_id,
    );
  }

  // Audit (force = supervisor flag for visibility).
  await recordAudit(c, {
    action: force ? 'serve_schedule.force_overlap' : 'serve_schedule.move',
    entityType: 'serve_schedule_slot',
    entityId: slotId,
    details: {
      from: { scheduled_date: current.scheduled_date, window: `${current.window_start}-${current.window_end}`, officer_id: current.officer_id },
      to: { scheduled_date: candidateDate, window: `${candidateWindow.window_start}-${candidateWindow.window_end}`, officer_id: candidateOfficer },
      reason: typeof body.reason === 'string' ? body.reason : null,
    },
  });

  // Broadcast — clients refetch via useLiveSync.
  broadcastAll('data_changed', {
    module: 'serve-schedule',
    entity: 'slot',
    action: 'updated',
    slot_id: slotId,
    queue_id: current.queue_id,
  });

  const updated = await queryFirst(
    db,
    `SELECT id, queue_id, attempt_number, scheduled_date, window_start, window_end,
            window_label, notify_at, notify_before_secs, notified, dismissed,
            officer_id, manually_moved, moved_by_user_id, moved_at,
            auto_replan_source, updated_at
       FROM serve_attempt_schedules WHERE id = ?`,
    slotId,
  );

  return c.json({ slot: updated });
});
```

Make sure these imports exist at the top of `src/routes/serveIntake.ts` — add if missing:

```ts
import { broadcastAll } from './ws';
import { recordAudit } from '../utils/auditLog';
```

- [ ] **Step 6: Add `serve_attempt_schedules.updated_at` to the migration reconciler**

The `serve_attempt_schedules` table from migration `0130` does NOT have an `updated_at` column. The PATCH handler reads it. Two options: (a) ALTER TABLE in this PR, (b) read a constructed `updated_at` via COALESCE.

Take option (a) — append to `reconcileScheduleSchema` in `src/routes/serveIntake.ts`:

```ts
// PR 2: updated_at for optimistic concurrency on PATCH /schedule/:slotId
for (const [name, type] of [
  ['updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))"],
] as const) {
  try {
    if (!(await columnExists(db, 'serve_attempt_schedules', name))) {
      await execute(db, `ALTER TABLE serve_attempt_schedules ADD COLUMN ${name} ${type}`);
    }
  } catch (err) { console.warn(`[serve-intake] reconcile ${name} failed:`, err); }
}
```

Also add a `0141_serve_attempt_schedules_updated_at.sql` migration:

```sql
-- migrations/0141_serve_attempt_schedules_updated_at.sql
ALTER TABLE serve_attempt_schedules
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
```

- [ ] **Step 7: Typecheck + tests**

Run: `npm run typecheck && npx vitest run tests/serveScheduleEdit.test.ts`
Expected: 0 typecheck errors, 10 vitest passing.

- [ ] **Step 8: Commit**

```bash
git add src/utils/serveScheduleEdit.ts tests/serveScheduleEdit.test.ts src/routes/serveIntake.ts migrations/0141_serve_attempt_schedules_updated_at.sql
git commit -m "feat(serve): PATCH /schedule/:slotId — stale + overlap guards + WS broadcast"
```

---

## Task 7: WS broadcast hook in `POST /attempts` and intake commit

**Files:**
- Modify: `src/routes/serveIntake.ts`
- Modify: `src/utils/serveIntakeRecords.ts`

PR 1 wrote new schedule slots but did NOT broadcast them. The panel needs a `serve-schedule` event whenever any slot is created/changed so `useLiveSync` triggers a refetch.

- [ ] **Step 1: Add broadcast after the auto-replan slot insert**

In `src/routes/serveIntake.ts`, find the `POST /:id/attempts` handler. After the `replanSummary` is built (the block where `auto_replan_source` is stamped), add:

```ts
if (replanSummary) {
  broadcastAll('data_changed', {
    module: 'serve-schedule',
    entity: 'slot',
    action: 'created',
    slot_id: replanSummary.slot_id,
    queue_id: id,
  });
}
```

- [ ] **Step 2: Add broadcast after `persistAttemptSchedule` in `commitIntake`**

In `src/utils/serveIntakeRecords.ts`, find the existing `persistAttemptSchedule(db, queueId, attemptPlan, nowIso).catch(...)` call (around line 938).

Wrap it to broadcast on success. Since `commitIntake` is a utility (no `c: Context` available), the existing call signature can't reach `broadcastAll` directly. Instead, return a `scheduledSlotIds` field from the function (or skip the broadcast there and rely on the panel's initial fetch).

**Decision:** the panel fetches on mount via `useLiveSync` debounce, and `commitIntake` is typically followed by a route-level response. The initial render after intake commit will pick up the new slots via the route's existing response shape. Skip the broadcast at intake commit — the user-visible flow is "click submit → page navigates → panel mounts fresh." Add a comment to that effect:

In `src/utils/serveIntakeRecords.ts`, just above the `persistAttemptSchedule` call:

```ts
// NB: no broadcastAll here — the route that calls commitIntake responds
// with the new queue_id, and the client navigates to a fresh view that
// fetches via useLiveSync on mount. The PATCH route + replan hook DO
// broadcast because those happen without a page navigation.
```

- [ ] **Step 3: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: 0 typecheck errors; full suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/routes/serveIntake.ts src/utils/serveIntakeRecords.ts
git commit -m "feat(serve): broadcast serve-schedule events on auto-replan slot creation"
```

---

## Task 8: `ServeSchedulerPanel` composition + drag-drop wiring

**Files:**
- Create: `client/src/components/scheduler/ServeSchedulerPanel.tsx`

- [ ] **Step 1: Implement** — create `client/src/components/scheduler/ServeSchedulerPanel.tsx`

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import WeekTimeline from './WeekTimeline';
import MonthGrid from './MonthGrid';
import type { ScheduleSlot } from '../../utils/schedulerView';

interface ScheduleResp {
  schedule: Array<{ date: string; weekday: string; slots: ScheduleSlot[] }>;
  generated_at: string;
}

function todayDenver(): string {
  // YYYY-MM-DD in Denver local — uses sv-SE locale which gives ISO date format.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Denver' })
    .format(new Date());
}

type ViewMode = 'week' | 'month';

export default function ServeSchedulerPanel() {
  const [view, setView] = useState<ViewMode>('week');
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(todayDenver, []);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const include = 'tier';
      const range = view === 'week' ? 7 : 31;
      const endDate = new Date(Date.parse(`${today}T12:00:00Z`) + (range - 1) * 86_400_000)
        .toISOString().slice(0, 10);
      const data = await apiFetch<ScheduleResp>(
        `/serve-intake/schedule?start_date=${today}&end_date=${endDate}&include=${include}`,
      );
      const flat = (data.schedule ?? []).flatMap((d) => d.slots);
      setSlots(flat);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [view, today]);

  useEffect(() => { refetch(); }, [refetch]);
  useLiveSync('serve-schedule', refetch);

  const handleSlotDrop = useCallback(async (
    slot: ScheduleSlot,
    target: { date: string; window_start: string; window_end: string },
  ) => {
    // Optimistic update.
    setSlots((prev) => prev.map((s) =>
      s.id === slot.id
        ? { ...s, scheduled_date: target.date, window_start: target.window_start, window_end: target.window_end, manually_moved: 1 }
        : s,
    ));
    try {
      await apiFetch(`/serve-intake/schedule/${slot.id}`, {
        method: 'PATCH',
        body: JSON.stringify(target),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      // Revert on failure.
      refetch();
      // Best-effort toast — `alert` is the project's existing fallback.
      // eslint-disable-next-line no-alert
      alert(`Could not move attempt: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }, [refetch]);

  const todayCount = slots.filter((s) => s.scheduled_date === today).length;
  const criticalCount = slots.filter((s) => s.urgency_tier === 'critical').length;

  return (
    <div className="bg-surface-base border border-rmpg-700 rounded-[2px]">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-rmpg-700 bg-surface-raised">
        <div className="flex items-center gap-1 text-rmpg-200 text-[11px] font-semibold uppercase tracking-wide">
          <CalendarDays size={11} />
          Serve Scheduler
        </div>
        <div className="flex items-center gap-1">
          <div className="inline-flex border border-rmpg-700 rounded-[2px] overflow-hidden">
            {(['week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-2 py-0.5 text-[10px] uppercase ${
                  view === v ? 'bg-brand-500/20 text-brand-200' : 'bg-surface-base text-rmpg-300 hover:bg-surface-raised'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <a
            href="/serve-intake/scheduler"
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase text-rmpg-300 hover:text-rmpg-100 border border-rmpg-700 rounded-[2px]"
          >
            Open scheduler <ExternalLink size={9} />
          </a>
        </div>
      </div>
      {error
        ? <div className="p-3 text-[11px] text-red-300">{error}</div>
        : loading
        ? <div className="p-3 text-[11px] text-rmpg-400">Loading…</div>
        : view === 'week'
        ? (
          <WeekTimeline
            anchorYmd={today}
            slots={slots}
            todayYmd={today}
            onSlotDrop={handleSlotDrop}
          />
        )
        : (
          <MonthGrid
            anchorYmd={today}
            slots={slots}
            todayYmd={today}
          />
        )
      }
      <div className="px-2 py-1 border-t border-rmpg-700 text-[10px] text-rmpg-300 flex gap-3">
        <span>Today: <span className="text-rmpg-100 tabular-nums">{todayCount}</span></span>
        <span>
          Critical: <span className={`${criticalCount > 0 ? 'text-red-300' : 'text-rmpg-100'} tabular-nums`}>{criticalCount}</span>
          {criticalCount > 0 ? <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> : null}
        </span>
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
git add client/src/components/scheduler/ServeSchedulerPanel.tsx
git commit -m "feat(serve-ui): ServeSchedulerPanel composition with realtime + drag-drop"
```

---

## Task 9: Dashboard wiring + service worker bump

**Files:**
- Modify: `client/src/pages/dashboard/dashboardViews.ts`
- Modify: `client/src/pages/DashboardPage.tsx`
- Modify: `client/public/sw.js`

- [ ] **Step 1: Add `serveSchedule` to the dashboard view config**

In `client/src/pages/dashboard/dashboardViews.ts`, find:

```ts
export type PanelId =
  | 'activeCalls' | 'recentActivity' | 'activeUnits' | 'activeBolos'
  | 'statusSummary' | 'shiftStatus' | 'weather' | 'alertsReminders'
  | 'officerActivity' | 'callsNearMe' | 'myActivity'
  | 'callAnalytics' | 'adminExtras';
```

Change to:

```ts
export type PanelId =
  | 'activeCalls' | 'recentActivity' | 'activeUnits' | 'activeBolos'
  | 'statusSummary' | 'shiftStatus' | 'weather' | 'alertsReminders'
  | 'officerActivity' | 'callsNearMe' | 'myActivity'
  | 'callAnalytics' | 'adminExtras' | 'serveSchedule';
```

Find:

```ts
export const PANEL_IDS: readonly PanelId[] = [
  'activeCalls', 'recentActivity', 'activeUnits', 'activeBolos',
  'statusSummary', 'shiftStatus', 'weather', 'alertsReminders',
  'officerActivity', 'callsNearMe', 'myActivity',
  'callAnalytics', 'adminExtras',
];
```

Add `'serveSchedule'` to the end of the array.

Find:

```ts
export const VIEW_PANELS: Record<DashboardView, PanelId[]> = {
  dispatch: ['activeCalls', 'callAnalytics', 'activeUnits', 'activeBolos', 'recentActivity', 'shiftStatus', 'weather'],
  patrol: ['shiftStatus', 'activeBolos', 'callsNearMe', 'myActivity', 'weather'],
  admin: [
    'statusSummary', 'activeCalls', 'callAnalytics', 'activeUnits', 'activeBolos',
    'recentActivity', 'adminExtras', 'officerActivity', 'alertsReminders', 'shiftStatus', 'weather',
  ],
};
```

Add `'serveSchedule'` to the `dispatch` array (after `'recentActivity'`) and to the `admin` array (after `'recentActivity'`). DO NOT add to `patrol`.

- [ ] **Step 2: Render the panel in `DashboardPage`**

In `client/src/pages/DashboardPage.tsx`, find where other panels render — look for `case 'callAnalytics':` or similar `switch (id) { ... }` patterns or per-id conditional rendering blocks.

If the page uses a `switch (id)` pattern, add:

```tsx
case 'serveSchedule':
  return <ServeSchedulerPanel key="serveSchedule" />;
```

If the page uses per-id conditionals, add an equivalent block.

Also add the import at the top of the file:

```ts
import ServeSchedulerPanel from '../components/scheduler/ServeSchedulerPanel';
```

- [ ] **Step 3: Bump the service worker cache name**

In `client/public/sw.js`, find `const CACHE_NAME = 'rmpg-flex-vNNN';` (or similar). Increment the number by 1 — find the current value first:

```bash
grep -n "CACHE_NAME" client/public/sw.js
```

Then replace whatever current `vNNN` to `vNNN+1`. (Use whatever the actual current version is. The codebase tracks this manually per CLAUDE.md gotcha #6.)

- [ ] **Step 4: Typecheck + tests + build**

Run:
```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build && cd ..
```
Expected: 0 typecheck errors, all client tests pass, vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dashboard/dashboardViews.ts client/src/pages/DashboardPage.tsx client/public/sw.js
git commit -m "feat(serve-ui): mount ServeSchedulerPanel on dispatch + admin dashboards + SW bump"
```

---

## Task 10: Pre-flight verify + push + PR (stacked on PR 1)

- [ ] **Step 1: Full Worker typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: 0 typecheck errors; all tests pass (baseline 1195 + the 10+ new tests from PR 2 = ~1205 expected).

- [ ] **Step 2: Full client typecheck + tests + build**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build && cd ..`
Expected: 0 typecheck errors; vitest green; vite build succeeds.

- [ ] **Step 3: Confirm PR 1 is still the base**

Run: `git log --oneline --graph claude/modest-faraday-90b9f8..HEAD | head -20`
Expected: clean linear history of PR 2 commits, branching from PR 1's tip.

- [ ] **Step 4: Push and open PR with the right base**

```bash
git push -u origin claude/serve-scheduler-pr2-dashboard
gh pr create \
  --base claude/modest-faraday-90b9f8 \
  --title "feat(serve): auto-scheduler PR 2 — dashboard panel (week timeline + drag-drop + realtime)" \
  --body "$(cat <<'EOF'
## Summary

PR 2 of 3 for the process-service auto-scheduler. Adds the `ServeSchedulerPanel` to the Spillman dashboard with:

- **Week timeline (default)** — 7-day horizontal grid, 2-hour bands, drag-to-reschedule
- **Month grid** — calendar view with per-tier counts per day
- **Realtime updates** — `useLiveSync('serve-schedule', refetch)` triggers refetch on any slot change broadcast from another client
- **`PATCH /serve-intake/schedule/:slotId`** — stale check (`If-Unmodified-Since`), overlap detection, `?force=1` override, audit log via `recordAudit()`, broadcast via `broadcastAll('data_changed', { module: 'serve-schedule' })`
- **Migration `0141_serve_attempt_schedules_updated_at.sql`** — adds the `updated_at` column needed for optimistic concurrency
- **Boot-time reconcile** extended to cover `updated_at`

⚠️ **Stacked on [PR #1511](https://github.com/rmpgutah/rmpg-flex/pull/1511).** Merge PR 1 first; GitHub auto-retargets this PR to main.

## What's deferred to PR 3

- Full-page `/serve-intake/scheduler` (multi-officer swim lanes, unassigned-queue sidebar)
- `POST /serve-intake/schedule/rebalance` on-demand batch
- Bulk selection, auto-cluster nearby, audit trail drawer

## Test plan

- [x] `npm test` — Worker clean (10 new tests for `serveScheduleEdit` helpers)
- [x] `npm run typecheck` — Worker clean
- [x] `cd client && npx tsc --noEmit && npx vitest run && npx vite build` — Client clean (7 schedulerView + 7 dnd tests)
- [ ] **Post-merge:** apply `migrations/0141_serve_attempt_schedules_updated_at.sql` directly to live D1 `rmpg-flex` (\`785de7ae-…\`) via the Cloudflare API; verify with `pragma_table_info('serve_attempt_schedules')`.
- [ ] **Post-merge browser smoke:** open `https://rmpgutah.us` as a dispatcher, see panel in the dashboard, drag a chip to a different band, verify the slot persists across page reload, verify another open browser tab updates in real time.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 5: Self-review checklist**

After the PR opens, manually:
- Apply `migrations/0141_*.sql` directly to live D1 once both PR 1 and PR 2 land.
- Confirm `[serve-rebalance]` log line at next 10:00 UTC tick (validates PR 1's cron is healthy).
- Browser-smoke the dashboard panel — drag, drop, realtime sync via two tabs.

---

## Self-review checklist (controller before dispatch)

- [x] All UI helpers are pure (no React, no DOM, no Date.now inside)
- [x] All routes call `reconcileScheduleSchema(db)` before touching new columns
- [x] WS broadcasts use the existing `broadcastAll('data_changed', { module: ... })` shape — no new pubsub layer
- [x] No hardcoded hex colors — `bg-blue-700/30`, `border-rmpg-700`, etc. are all CSS-variable-backed
- [x] Service worker cache name will be bumped (Task 9 Step 3)
- [x] Stacked PR base is `claude/modest-faraday-90b9f8`, not `main`

## Scope coverage

| Spec section | Plan task(s) |
|---|---|
| `ServeSchedulerPanel` on dashboard (week-timeline default) | Tasks 4, 8, 9 |
| Month grid toggle | Tasks 5, 8 |
| Drag-to-reschedule | Tasks 2, 4, 8 |
| `PATCH /serve-intake/schedule/:slotId` (stale + overlap + force) | Task 6 |
| WS broadcast on slot changes | Tasks 6, 7 |
| Dashboard view config delta | Task 9 |
| **Deferred to PR 3** (full-page scheduler, batch rebalance endpoint) | future plan |

## References

- [PR 1 implementation plan](2026-06-21-process-service-auto-scheduler-pr1-backend.md)
- [Design spec](../specs/2026-06-21-process-service-auto-scheduler-design.md)
- [`src/routes/ws.ts:50`](../../src/routes/ws.ts) — `broadcastAll`
- [`client/src/hooks/useLiveSync.ts`](../../client/src/hooks/useLiveSync.ts) — `useLiveSync`
