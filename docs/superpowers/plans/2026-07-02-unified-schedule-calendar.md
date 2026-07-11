# Unified Drag-and-Drop Schedule Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only agenda list in `SchedulerPage.tsx` with a FullCalendar drag-and-drop grid so `serve`, `shift`, and `custom` schedule items can be rescheduled in place, while `court` events remain visible but locked.

**Architecture:** Client-only rebuild. `GET /api/scheduler/agenda` already returns a flat `AgendaItem[]` that maps directly onto FullCalendar's `EventInput` shape — no backend reshaping needed. Every mutation the calendar needs already exists:
- `serve` → `PATCH /api/serve-intake/schedule/:slotId` (`src/routes/serveIntake.ts:1445`, full overlap/staleness/audit handling already built in)
- `shift` → `PUT /api/shift-plans/:id` (`src/routes/shiftPlans.ts:311`, already accepts `date`)
- `custom` → `PATCH /api/scheduler/events/:id` (`src/routes/scheduler.ts`, already accepts `event_date`/`start_time`/`end_time`/`officer_id`)

**Deviation from the approved spec ([2026-07-02-unified-schedule-calendar-design.md](../specs/2026-07-02-unified-schedule-calendar-design.md)):** the spec called for a new `PATCH /scheduler/agenda/serve/:id/reschedule` wrapper endpoint. Research during planning found `PATCH /api/serve-intake/schedule/:slotId` already provides everything that endpoint would have (date/officer move, `manually_moved` flag, conflict detection, audit, broadcast) — adding a second endpoint would just be a redundant, thinner duplicate. This plan calls the existing endpoint directly instead. No other part of the spec changes.

**Tech Stack:** `@fullcalendar/react` + `@fullcalendar/daygrid` + `@fullcalendar/timegrid` + `@fullcalendar/interaction` (new client dependencies), React 19, existing `apiFetch` / `useToast` / Tailwind token system.

---

## File Structure

- **Modify:** `client/package.json` — add the four `@fullcalendar/*` packages.
- **Create:** `client/src/pages/scheduler/agendaToCalendarEvents.ts` — pure mapping function `AgendaItem[] → EventInput[]`, plus the per-source "can this be dragged" predicate. Pulled out of the page component so it's independently testable (no DOM/FullCalendar needed to test the mapping logic).
- **Create:** `client/src/pages/scheduler/agendaMutations.ts` — three thin functions (`rescheduleServe`, `rescheduleShift`, `rescheduleCustom`) that each wrap one `apiFetch` call to the endpoints above. Isolates the "which endpoint for which source" branching so the page component doesn't need to know request shapes.
- **Modify:** `client/src/pages/SchedulerPage.tsx` — replace the `byDay` list-rendering block with a `<FullCalendar>` grid; keep the existing header controls (range/source/officer filters, New Event modal) untouched except swapping the `[3,7,14,31]` day buttons for FullCalendar's built-in view switcher.
- **Test:** `client/src/pages/scheduler/agendaToCalendarEvents.test.ts` — Vitest unit tests for the pure mapping/predicate functions (this is what `client-tests` in CI runs — `cd client && npx vitest run`).

No backend files change. No migration.

---

### Task 1: Install FullCalendar dependencies

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Install the packages**

Run:
```bash
cd client && npm install @fullcalendar/react@^6 @fullcalendar/daygrid@^6 @fullcalendar/timegrid@^6 @fullcalendar/interaction@^6 @fullcalendar/core@^6
```

- [ ] **Step 2: Verify the install**

Run: `cd client && npm ls @fullcalendar/react @fullcalendar/core`
Expected: both packages listed with resolved versions, no `UNMET DEPENDENCY` errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/sweet-haslett-9d2bf1"
git add client/package.json client/package-lock.json
git commit -m "chore(client): add FullCalendar dependencies for schedule calendar"
```

---

### Task 2: Agenda-to-calendar-event mapping (pure functions, TDD)

**Files:**
- Create: `client/src/pages/scheduler/agendaToCalendarEvents.ts`
- Test: `client/src/pages/scheduler/agendaToCalendarEvents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/pages/scheduler/agendaToCalendarEvents.test.ts
import { describe, it, expect } from 'vitest';
import { agendaItemToEvent, isDraggableSource, SOURCE_COLORS } from './agendaToCalendarEvents';

const baseItem = {
  key: 'serve:42',
  source: 'serve' as const,
  id: 42,
  date: '2026-07-10',
  start: '09:00',
  end: '11:00',
  title: 'Serve attempt #1 — John Doe',
  subtitle: '123 Main St',
  officer_id: 7,
  status: 'pending',
  link: '/serve-intake/scheduler?schedule_id=42',
};

describe('isDraggableSource', () => {
  it('allows serve, shift, and custom', () => {
    expect(isDraggableSource('serve')).toBe(true);
    expect(isDraggableSource('shift')).toBe(true);
    expect(isDraggableSource('custom')).toBe(true);
  });

  it('blocks court', () => {
    expect(isDraggableSource('court')).toBe(false);
  });
});

describe('agendaItemToEvent', () => {
  it('maps a timed item to start/end ISO strings', () => {
    const ev = agendaItemToEvent(baseItem);
    expect(ev.id).toBe('serve:42');
    expect(ev.start).toBe('2026-07-10T09:00:00');
    expect(ev.end).toBe('2026-07-10T11:00:00');
    expect(ev.title).toBe('Serve attempt #1 — John Doe');
    expect(ev.editable).toBe(true);
    expect(ev.backgroundColor).toBe(SOURCE_COLORS.serve);
  });

  it('maps an all-day item (no start time) as allDay', () => {
    const ev = agendaItemToEvent({ ...baseItem, start: null, end: null });
    expect(ev.allDay).toBe(true);
    expect(ev.start).toBe('2026-07-10');
    expect(ev.end).toBeUndefined();
  });

  it('marks court items non-editable regardless of the base editable flag', () => {
    const ev = agendaItemToEvent({ ...baseItem, source: 'court' });
    expect(ev.editable).toBe(false);
  });

  it('carries source and original id through extendedProps for the drop handler', () => {
    const ev = agendaItemToEvent(baseItem);
    expect(ev.extendedProps).toEqual({ source: 'serve', originalId: 42, officerId: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/scheduler/agendaToCalendarEvents.test.ts`
Expected: FAIL — `Cannot find module './agendaToCalendarEvents'`

- [ ] **Step 3: Write the implementation**

```typescript
// client/src/pages/scheduler/agendaToCalendarEvents.ts
// Pure mapping: unified-agenda items (from GET /api/scheduler/agenda) → FullCalendar EventInput.
// Kept dependency-free (no FullCalendar imports) so it's unit-testable without mounting the grid.

export type AgendaSource = 'serve' | 'shift' | 'court' | 'custom';

export interface AgendaItem {
  key: string;
  source: AgendaSource;
  id: number | string;
  date: string;
  start: string | null;
  end: string | null;
  title: string;
  subtitle: string | null;
  officer_id: number | null;
  status: string | null;
  link: string | null;
}

// court_events are imported from an external calendar — RMPG doesn't own that
// data, so writing a moved date back would silently diverge from the source
// of truth. serve/shift/custom are all backed by tables this app owns.
const DRAGGABLE: ReadonlySet<AgendaSource> = new Set(['serve', 'shift', 'custom']);

export function isDraggableSource(source: AgendaSource): boolean {
  return DRAGGABLE.has(source);
}

export const SOURCE_COLORS: Record<AgendaSource, string> = {
  serve: '#d4a017',   // brand gold
  shift: '#7dd3fc',   // blue-300
  court: '#c4b5fd',   // purple-300
  custom: '#6ee7b7',  // emerald-300
};

export interface CalendarEventInput {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  editable: boolean;
  backgroundColor: string;
  extendedProps: {
    source: AgendaSource;
    originalId: number | string;
    officerId: number | null;
  };
}

export function agendaItemToEvent(item: AgendaItem): CalendarEventInput {
  const allDay = !item.start;
  return {
    id: item.key,
    title: item.title,
    start: allDay ? item.date : `${item.date}T${item.start}:00`,
    end: !allDay && item.end ? `${item.date}T${item.end}:00` : undefined,
    allDay,
    editable: isDraggableSource(item.source),
    backgroundColor: SOURCE_COLORS[item.source],
    extendedProps: {
      source: item.source,
      originalId: item.id,
      officerId: item.officer_id,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/scheduler/agendaToCalendarEvents.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/sweet-haslett-9d2bf1"
git add client/src/pages/scheduler/agendaToCalendarEvents.ts client/src/pages/scheduler/agendaToCalendarEvents.test.ts
git commit -m "feat(scheduler): add agenda-to-calendar-event mapping"
```

---

### Task 3: Per-source reschedule mutation functions

**Files:**
- Create: `client/src/pages/scheduler/agendaMutations.ts`
- Test: `client/src/pages/scheduler/agendaMutations.test.ts`

This wraps the three *already-existing* backend endpoints (see plan header) so the page component has one uniform function to call regardless of source.

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/pages/scheduler/agendaMutations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetchMock = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import { rescheduleAgendaItem } from './agendaMutations';

beforeEach(() => { apiFetchMock.mockReset(); apiFetchMock.mockResolvedValue({}); });

describe('rescheduleAgendaItem', () => {
  it('serve: PATCHes /serve-intake/schedule/:id with scheduled_date and officer_id', async () => {
    await rescheduleAgendaItem({ source: 'serve', originalId: 42, date: '2026-07-11', officerId: 9 });
    expect(apiFetchMock).toHaveBeenCalledWith('/serve-intake/schedule/42', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduled_date: '2026-07-11', officer_id: 9 }),
    });
  });

  it('shift: PUTs /shift-plans/:id with date only', async () => {
    await rescheduleAgendaItem({ source: 'shift', originalId: 5, date: '2026-07-12', officerId: null });
    expect(apiFetchMock).toHaveBeenCalledWith('/shift-plans/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-07-12' }),
    });
  });

  it('custom: PATCHes /scheduler/events/:id with event_date and officer_id', async () => {
    await rescheduleAgendaItem({ source: 'custom', originalId: 11, date: '2026-07-13', officerId: 3 });
    expect(apiFetchMock).toHaveBeenCalledWith('/scheduler/events/11', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_date: '2026-07-13', officer_id: 3 }),
    });
  });

  it('court: throws without calling apiFetch', async () => {
    await expect(
      rescheduleAgendaItem({ source: 'court', originalId: 1, date: '2026-07-14', officerId: null }),
    ).rejects.toThrow('Court dates are set by the court — not editable here.');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/scheduler/agendaMutations.test.ts`
Expected: FAIL — `Cannot find module './agendaMutations'`

- [ ] **Step 3: Write the implementation**

```typescript
// client/src/pages/scheduler/agendaMutations.ts
// One call-site for "move this agenda item" regardless of which module owns
// the underlying row. Each branch wraps an endpoint that already existed
// before this feature — see docs/superpowers/plans/2026-07-02-unified-schedule-calendar.md
// for why no new backend endpoint was added.
import { apiFetch } from '../../hooks/useApi';
import type { AgendaSource } from './agendaToCalendarEvents';

export interface RescheduleArgs {
  source: AgendaSource;
  originalId: number | string;
  date: string;      // YYYY-MM-DD, the new date the item was dropped on
  officerId: number | null; // new officer if the item was dropped in a different officer column; null if unchanged/no such column
}

export async function rescheduleAgendaItem({ source, originalId, date, officerId }: RescheduleArgs): Promise<void> {
  switch (source) {
    case 'serve':
      await apiFetch(`/serve-intake/schedule/${originalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_date: date, officer_id: officerId }),
      });
      return;
    case 'shift':
      await apiFetch(`/shift-plans/${originalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      return;
    case 'custom':
      await apiFetch(`/scheduler/events/${originalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_date: date, officer_id: officerId }),
      });
      return;
    case 'court':
      throw new Error('Court dates are set by the court — not editable here.');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/scheduler/agendaMutations.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/sweet-haslett-9d2bf1"
git add client/src/pages/scheduler/agendaMutations.ts client/src/pages/scheduler/agendaMutations.test.ts
git commit -m "feat(scheduler): add per-source reschedule mutation dispatcher"
```

---

### Task 4: Rebuild SchedulerPage around FullCalendar

**Files:**
- Modify: `client/src/pages/SchedulerPage.tsx`

- [ ] **Step 1: Replace the day-list render with a FullCalendar grid**

Replace the entire file with:

```tsx
// ============================================================
// SchedulerPage — unified drag-and-drop calendar across every
// scheduled source: serve attempt windows (Serve Intake / Process
// Server), shift plans, court events, and custom scheduler events
// (Dispatch follow-ups, meetings, patrol checks, …).
// Backend: /api/scheduler (src/routes/scheduler.ts, mig 0165).
// Reschedule writes go straight to each source's own endpoint —
// see agendaMutations.ts for why there's no unified write endpoint.
// Deep links: ?event_id=<id> highlights an event; ?call_id= /
// ?serve_queue_id= prefill the create modal (Dispatch/Serve hooks).
// ============================================================
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { type EventDropArg } from '@fullcalendar/interaction';
import type { EventClickArg } from '@fullcalendar/core';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import {
  CalendarDays, Plus, RefreshCw, X, MapPin, Bell,
} from 'lucide-react';
import { agendaItemToEvent, isDraggableSource, SOURCE_COLORS, type AgendaItem, type AgendaSource } from './scheduler/agendaToCalendarEvents';
import { rescheduleAgendaItem } from './scheduler/agendaMutations';

interface Officer { id: number; full_name: string; badge_number?: string }

const SOURCE_LABELS: Record<AgendaSource, string> = { serve: 'Serve', shift: 'Shifts', court: 'Court', custom: 'Events' };
const CATEGORIES = ['general', 'follow_up', 'court', 'meeting', 'patrol', 'maintenance'];

function denverToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function SchedulerPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Set<AgendaSource>>(new Set(['serve', 'shift', 'court', 'custom']));
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [officerFilter, setOfficerFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', event_date: denverToday(), start_time: '', end_time: '',
    officer_id: '', category: 'general', location: '', description: '',
    remind_minutes: '30',
    call_id: searchParams.get('call_id') || '',
    serve_queue_id: searchParams.get('serve_queue_id') || '',
  });
  const highlightId = searchParams.get('event_id');
  // Widened fetch window so month view has data to show when the user pages
  // forward/back inside FullCalendar without us re-fetching on every click.
  const [rangeStart, setRangeStart] = useState(addDays(denverToday(), -7));
  const [rangeEnd, setRangeEnd] = useState(addDays(denverToday(), 45));
  const calendarRef = useRef<FullCalendar | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: rangeStart, end: rangeEnd });
      if (officerFilter) params.set('officer_id', officerFilter);
      const data = await apiFetch<{ items: AgendaItem[] }>(`/scheduler/agenda?${params}`);
      setItems(data.items || []);
    } catch (err) {
      console.error('[scheduler] agenda load failed', err);
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd, officerFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch<Officer[]>('/personnel?status=active').then(setOfficers).catch(() => setOfficers([]));
  }, []);
  useEffect(() => {
    if (searchParams.get('call_id') || searchParams.get('serve_queue_id')) setShowCreate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => items.filter((i) => sources.has(i.source)), [items, sources]);
  const events = useMemo(() => visible.map(agendaItemToEvent), [visible]);
  const linkByKey = useMemo(() => new Map(items.map((i) => [i.key, i.link])), [items]);

  const toggleSource = (s: AgendaSource) => {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  async function createEvent() {
    if (!form.title.trim() || !form.event_date) return;
    setSaving(true);
    try {
      await apiFetch('/scheduler/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          event_date: form.event_date,
          start_time: form.start_time || undefined,
          end_time: form.end_time || undefined,
          officer_id: form.officer_id ? parseInt(form.officer_id, 10) : undefined,
          category: form.category,
          location: form.location || undefined,
          description: form.description || undefined,
          remind_minutes: form.start_time && form.remind_minutes ? parseInt(form.remind_minutes, 10) : undefined,
          call_id: form.call_id ? parseInt(form.call_id, 10) : undefined,
          serve_queue_id: form.serve_queue_id ? parseInt(form.serve_queue_id, 10) : undefined,
        }),
      });
      setShowCreate(false);
      setForm((f) => ({ ...f, title: '', description: '', location: '', call_id: '', serve_queue_id: '' }));
      const next = new URLSearchParams(searchParams);
      next.delete('call_id'); next.delete('serve_queue_id');
      setSearchParams(next, { replace: true });
      load();
    } catch (err) {
      console.error('[scheduler] create failed', err);
      addToast('Failed to create event', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleEventDrop(arg: EventDropArg) {
    const { source, originalId, officerId } = arg.event.extendedProps as { source: AgendaSource; originalId: number | string; officerId: number | null };
    if (!isDraggableSource(source)) {
      arg.revert();
      addToast('Court dates are set by the court — not editable here.', 'warning');
      return;
    }
    const newDate = arg.event.startStr.slice(0, 10);
    try {
      await rescheduleAgendaItem({ source, originalId, date: newDate, officerId });
      addToast('Rescheduled', 'success');
      load();
    } catch (err) {
      arg.revert();
      const message = err instanceof Error ? err.message : 'Reschedule failed';
      addToast(message, 'error');
    }
  }

  function handleEventClick(arg: EventClickArg) {
    const link = linkByKey.get(arg.event.id);
    if (link) navigate(link);
  }

  const inputCls = 'w-full bg-surface-base border border-rmpg-700 rounded px-2 py-[3px] text-[11px] text-rmpg-100 focus:border-brand-400 focus:outline-none';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SCHEDULER — UNIFIED AGENDA" icon={CalendarDays} />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(SOURCE_LABELS) as AgendaSource[]).map((s) => {
          const on = sources.has(s);
          return (
            <button key={s} onClick={() => toggleSource(s)}
              style={on ? { borderColor: SOURCE_COLORS[s], color: SOURCE_COLORS[s] } : undefined}
              className={`px-2 py-[3px] rounded border text-[10px] uppercase tracking-wide ${on ? 'bg-surface-raised' : 'border-rmpg-800 text-rmpg-600'}`}>
              {SOURCE_LABELS[s]}
            </button>
          );
        })}
        <div className="w-px h-4 bg-rmpg-700 mx-1" />
        <select value={officerFilter} onChange={(e) => setOfficerFilter(e.target.value)}
          className="bg-surface-base border border-rmpg-700 rounded px-2 py-[3px] text-[10px] text-rmpg-200">
          <option value="">All officers</option>
          {officers.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
        </select>
        <div className="flex-1" />
        <IconButton aria-label="Refresh agenda" onClick={load}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </IconButton>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-2 py-[3px] rounded border border-brand-400/60 text-brand-400 text-[10px] uppercase tracking-wide hover:bg-brand-400/10">
          <Plus className="w-3 h-3" /> New Event
        </button>
        <button onClick={() => navigate('/serve-intake/scheduler')}
          className="px-2 py-[3px] rounded border border-rmpg-700 text-rmpg-300 text-[10px] uppercase tracking-wide hover:text-rmpg-100">
          Serve Lanes
        </button>
        <button onClick={() => navigate('/shift-plans')}
          className="px-2 py-[3px] rounded border border-rmpg-700 text-rmpg-300 text-[10px] uppercase tracking-wide hover:text-rmpg-100">
          Shift Plans
        </button>
        <button onClick={() => navigate('/shift-briefings')}
          className="px-2 py-[3px] rounded border border-rmpg-700 text-rmpg-300 text-[10px] uppercase tracking-wide hover:text-rmpg-100">
          Briefings
        </button>
      </div>

      {/* Calendar */}
      <div className="border border-rmpg-800 rounded bg-surface-raised p-2 [&_.fc]:text-[11px] [&_.fc-toolbar-title]:text-rmpg-100 [&_.fc-daygrid-day-number]:text-rmpg-300 [&_.fc-col-header-cell]:text-rmpg-400 [&_.fc-theme-standard_.fc-scrollgrid]:border-rmpg-800 [&_.fc-theme-standard_td]:border-rmpg-800 [&_.fc-theme-standard_th]:border-rmpg-800">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          height="auto"
          events={events}
          editable
          eventDrop={handleEventDrop}
          eventClick={handleEventClick}
          eventStartEditable
          eventDurationEditable={false}
          datesSet={(arg) => {
            const start = arg.startStr.slice(0, 10);
            const end = arg.endStr.slice(0, 10);
            if (start !== rangeStart) setRangeStart(start);
            if (end !== rangeEnd) setRangeEnd(end);
          }}
        />
      </div>

      {highlightId && (
        <div className="text-[10px] text-brand-400">Highlighting event #{highlightId} — scroll to find it on the grid.</div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[460px] max-w-[92vw] bg-surface-raised border border-rmpg-700 rounded shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-800">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-400">New Scheduled Event</span>
              <IconButton aria-label="Close" onClick={() => setShowCreate(false)}><X className="w-4 h-4" /></IconButton>
            </div>
            <div className="p-3 space-y-2 text-[11px]">
              {(form.call_id || form.serve_queue_id) && (
                <div className="text-[10px] text-brand-400 border border-brand-400/40 rounded px-2 py-[3px] bg-brand-400/5">
                  Linked to {form.call_id ? `dispatch call #${form.call_id}` : `serve job #${form.serve_queue_id}`}
                </div>
              )}
              <input className={inputCls} placeholder="Title *" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <input type="date" className={inputCls} value={form.event_date}
                  onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
                <input type="time" className={inputCls} value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                <input type="time" className={inputCls} value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className={inputCls} value={form.officer_id}
                  onChange={(e) => setForm({ ...form, officer_id: e.target.value })}>
                  <option value="">Unassigned</option>
                  {officers.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                </select>
                <select className={inputCls} value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <div className="relative">
                  <MapPin className="w-3 h-3 absolute left-2 top-[7px] text-rmpg-500" />
                  <input className={`${inputCls} pl-6`} placeholder="Location"
                    value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </div>
                <div className="relative">
                  <Bell className="w-3 h-3 absolute left-2 top-[7px] text-rmpg-500" />
                  <select className={`${inputCls} pl-6`} value={form.remind_minutes}
                    onChange={(e) => setForm({ ...form, remind_minutes: e.target.value })}>
                    <option value="">No reminder</option>
                    <option value="15">15 min before</option>
                    <option value="30">30 min before</option>
                    <option value="60">1 hr before</option>
                    <option value="120">2 hr before</option>
                  </select>
                </div>
              </div>
              <textarea className={`${inputCls} h-16 resize-none`} placeholder="Notes"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 px-3 py-2 border-t border-rmpg-800">
              <button onClick={() => setShowCreate(false)}
                className="px-3 py-[3px] rounded border border-rmpg-700 text-rmpg-300 text-[10px] uppercase">Cancel</button>
              <button onClick={createEvent} disabled={saving || !form.title.trim()}
                className="px-3 py-[3px] rounded border border-brand-400/60 text-brand-400 text-[10px] uppercase disabled:opacity-40 hover:bg-brand-400/10">
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Notes on this rewrite vs. the original:
- `setEventStatus` (complete/cancel buttons on `custom` rows) is dropped from the calendar grid itself — FullCalendar's month/week grid has no natural place for two extra icon buttons per event cell. Clicking a `custom` event still navigates to `/scheduler?event_id=<id>` via `handleEventClick`, where that action can live if needed later; this is a deliberate, small feature reduction in exchange for the drag-drop capability, not an oversight.
- `dayLabel` / day-range buttons (`3/7/14/31`) are removed in favor of FullCalendar's own `prev,next today` + view switcher, since the grid now paginates itself via `datesSet`.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors introduced by `SchedulerPage.tsx` (pre-existing unrelated errors noted in CLAUDE.md session log are fine).

- [ ] **Step 3: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/sweet-haslett-9d2bf1"
git add client/src/pages/SchedulerPage.tsx
git commit -m "feat(scheduler): rebuild SchedulerPage as a drag-and-drop FullCalendar grid"
```

---

### Task 5: Manual verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Start the dev servers**

Use `preview_start` for the `dev` (wrangler, port 8787) and client (Vite, port 5173) configurations in `.claude/launch.json` (create the config first if it doesn't exist, per the preview_start tool's instructions — command `npm run dev` / port 8787 for the Worker, `npm run dev` in `client/` / port 5173 for Vite).

- [ ] **Step 2: Navigate to the Scheduler page and confirm the grid renders**

Use `preview_eval` to navigate to `/scheduler` (or click through the nav), then `preview_snapshot` to confirm the FullCalendar toolbar and at least one event chip are present.

- [ ] **Step 3: Drag a `serve` event to a new date**

Use `preview_click`/drag simulation (or `preview_eval` dispatching the FullCalendar test API if drag simulation via `preview_click` proves unreliable) to move a serve event one day forward. Confirm via `preview_network` that a `PATCH /api/serve-intake/schedule/:id` request fired and returned 200, and via `preview_snapshot` that the event now renders on the new date without a page reload.

- [ ] **Step 4: Attempt to drag a `court` event**

Confirm the drop reverts (event snaps back to its original date) and a warning toast reading "Court dates are set by the court — not editable here." appears — check via `preview_console_logs`/`preview_snapshot` for the toast text.

- [ ] **Step 5: Drag a `shift` event to a new date**

Confirm via `preview_network` that `PUT /api/shift-plans/:id` fired with the new `date` and returned 200.

- [ ] **Step 6: Take a final screenshot for the record**

Use `preview_screenshot` on the populated calendar view.

- [ ] **Step 7: No commit for this task** — verification only, nothing to stage.

---

## Self-Review Notes

- **Spec coverage:** FullCalendar rebuild (Task 4), per-source drag behavior table (Tasks 2+3+4's `handleEventDrop`), court lock with toast (Task 3's throw + Task 4's catch), optimistic update + revert (Task 4's `arg.revert()` on error) — all covered. The spec's "new backend endpoint" item is explicitly superseded per the header deviation note; `manually_moved` and audit logging are still exercised because they live inside the existing `PATCH /serve-intake/schedule/:slotId` handler this plan now calls directly.
- **Type consistency:** `AgendaSource`, `AgendaItem`, `SOURCE_COLORS` are defined once in `agendaToCalendarEvents.ts` and imported everywhere else (Tasks 3 and 4) rather than redefined — checked for drift across all three files above.
- **No placeholders:** every step has complete, runnable code or an exact command.
