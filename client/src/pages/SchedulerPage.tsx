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
import { useNavigate, useSearchParams } from 'react-router';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DatesSetArg, EventClickArg, EventDropArg } from '@fullcalendar/core';
import { apiFetch } from '../hooks/useApi';
import { asArray } from '../utils/asArray';
import { useToast } from '../components/ToastProvider';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import {
  CalendarDays, Plus, RefreshCw, X, MapPin, Bell, Download, Search,
} from 'lucide-react';
import { agendaItemToEvent, isDraggableSource, SOURCE_COLORS, type AgendaItem, type AgendaSource } from './scheduler/agendaToCalendarEvents';
import { rescheduleAgendaItem } from './scheduler/agendaMutations';
import { toDisplayLabel } from '../utils/formatters';
import { agendaToCsv, downloadTextFile } from '../utils/rmsListExport';

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
  const [textQuery, setTextQuery] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
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
    setLoadError(null);
    try {
      const params = new URLSearchParams({ start: rangeStart, end: rangeEnd });
      if (officerFilter) params.set('officer_id', officerFilter);
      const data = await apiFetch<{ items: AgendaItem[] }>(`/scheduler/agenda?${params}`);
      setItems(data.items || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load agenda');
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd, officerFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch<Officer[]>('/personnel?status=active').then(d => setOfficers(asArray(d))).catch(() => setOfficers([]));
  }, []);
  useEffect(() => {
    if (searchParams.get('call_id') || searchParams.get('serve_queue_id')) setShowCreate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Deep-link (?event_id=): jump the calendar view to the matching custom
  // event's date once it's loaded. Doesn't visually ring/highlight the
  // event cell — that needs FullCalendar event-render hooks, out of scope here.
  useEffect(() => {
    if (!highlightId) return;
    const match = items.find((i) => i.source === 'custom' && String(i.id) === highlightId);
    if (match) calendarRef.current?.getApi().gotoDate(match.date);
  }, [highlightId, items]);

  const visible = useMemo(() => {
    const q = textQuery.trim().toLowerCase();
    return items.filter((i) => {
      if (!sources.has(i.source)) return false;
      if (!q) return true;
      return i.title.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q);
    });
  }, [items, sources, textQuery]);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if (e.key === 'Escape' && showCreate) { setShowCreate(false); return; }
      if (typing) return;
      if (e.key === 'n' || e.key === 'N') setShowCreate(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreate]);

  const inputCls = 'w-full bg-surface-base border border-rmpg-700 rounded px-2 py-[3px] text-[11px] text-rmpg-100 focus:border-brand-400 focus:outline-none';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SCHEDULER — UNIFIED AGENDA" icon={CalendarDays} />
      {loadError && (
        <div className="text-[11px] px-3 py-2 border border-red-700/40 bg-red-900/20 text-red-400 flex justify-between" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={load} className="underline">Retry</button>
        </div>
      )}
      {items.length > 0 && visible.length === 0 && (
        <div className="text-[11px] text-fg-muted">Filters hid every event. Clear search or re-enable a source.</div>
      )}

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
        <div className="relative">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-fg-muted" />
          <input value={textQuery} onChange={(e) => setTextQuery(e.target.value)} placeholder="Search titles…"
            aria-label="Search schedule titles"
            className="w-36 bg-surface-base border border-rmpg-700 rounded pl-6 pr-2 py-[3px] text-[10px] text-rmpg-100" />
        </div>
        <button type="button" disabled={visible.length === 0}
          onClick={() => downloadTextFile('scheduler-agenda.csv', agendaToCsv(visible))}
          className="flex items-center gap-1 px-2 py-[3px] rounded border border-rmpg-700 text-[10px] text-rmpg-200 disabled:opacity-40">
          <Download className="w-3 h-3" /> CSV
        </button>
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
          datesSet={(arg: DatesSetArg) => {
            const start = arg.startStr.slice(0, 10);
            const end = arg.endStr.slice(0, 10);
            if (start !== rangeStart) setRangeStart(start);
            if (end !== rangeEnd) setRangeEnd(end);
          }}
        />
      </div>

      {highlightId && (
        <div className="text-[10px] text-brand-400">Jumped to event #{highlightId}.</div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto p-4">
          <div className="w-[460px] max-w-[92vw] bg-surface-raised border border-rmpg-700 rounded shadow-xl my-auto">
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
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{toDisplayLabel(cat)}</option>)}
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
