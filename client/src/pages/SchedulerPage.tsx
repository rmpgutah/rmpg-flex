// ============================================================
// SchedulerPage — unified agenda across every scheduled source:
//   serve attempt windows (Serve Intake / Process Server),
//   shift plans, court events, and custom scheduler events
//   (Dispatch follow-ups, meetings, patrol checks, …).
// Backend: /api/scheduler (src/routes/scheduler.ts, mig 0165).
// Deep links: ?event_id=<id> highlights an event; ?call_id= /
// ?serve_queue_id= prefill the create modal (Dispatch/Serve hooks).
// ============================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import {
  CalendarDays, Plus, RefreshCw, X, Check, Clock,
  Gavel, Users, FileText, MapPin, Bell,
} from 'lucide-react';

interface AgendaItem {
  key: string;
  source: 'serve' | 'shift' | 'court' | 'custom';
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

interface Officer { id: number; full_name: string; badge_number?: string }

const SOURCE_META: Record<AgendaItem['source'], { label: string; icon: typeof Clock; tone: string }> = {
  serve: { label: 'Serve', icon: FileText, tone: 'text-brand-400 border-brand-400/40' },
  shift: { label: 'Shifts', icon: Users, tone: 'text-blue-300 border-blue-400/40' },
  court: { label: 'Court', icon: Gavel, tone: 'text-purple-300 border-purple-400/40' },
  custom: { label: 'Events', icon: CalendarDays, tone: 'text-emerald-300 border-emerald-400/40' },
};

const CATEGORIES = ['general', 'follow_up', 'court', 'meeting', 'patrol', 'maintenance'];

function denverToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayLabel(date: string): string {
  const today = denverToday();
  if (date === today) return `TODAY — ${date}`;
  if (date === addDays(today, 1)) return `TOMORROW — ${date}`;
  const wd = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  return `${wd.toUpperCase()} — ${date}`;
}

export default function SchedulerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rangeDays, setRangeDays] = useState(7);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Set<AgendaItem['source']>>(new Set(['serve', 'shift', 'court', 'custom']));
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = denverToday();
      const end = addDays(start, rangeDays - 1);
      const params = new URLSearchParams({ start, end });
      if (officerFilter) params.set('officer_id', officerFilter);
      const data = await apiFetch<{ items: AgendaItem[] }>(`/scheduler/agenda?${params}`);
      setItems(data.items || []);
    } catch (err) {
      console.error('[scheduler] agenda load failed', err);
    } finally {
      setLoading(false);
    }
  }, [rangeDays, officerFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch<Officer[]>('/personnel?status=active').then(setOfficers).catch(() => setOfficers([]));
  }, []);
  useEffect(() => {
    // Dispatch/Serve deep-link: arriving with ?call_id= or ?serve_queue_id=
    // opens the create modal pre-linked.
    if (searchParams.get('call_id') || searchParams.get('serve_queue_id')) setShowCreate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => items.filter((i) => sources.has(i.source)), [items, sources]);
  const byDay = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const i of visible) {
      if (!m.has(i.date)) m.set(i.date, []);
      m.get(i.date)!.push(i);
    }
    return [...m.entries()];
  }, [visible]);

  const toggleSource = (s: AgendaItem['source']) => {
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
    } finally {
      setSaving(false);
    }
  }

  async function setEventStatus(id: number | string, status: 'completed' | 'cancelled') {
    try {
      await apiFetch(`/scheduler/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      load();
    } catch (err) {
      console.error('[scheduler] update failed', err);
    }
  }

  const inputCls = 'w-full bg-surface-base border border-rmpg-700 rounded px-2 py-[3px] text-[11px] text-rmpg-100 focus:border-brand-400 focus:outline-none';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SCHEDULER — UNIFIED AGENDA" icon={CalendarDays} />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {[3, 7, 14, 31].map((d) => (
          <button key={d} onClick={() => setRangeDays(d)}
            className={`px-2 py-[3px] rounded border text-[10px] uppercase tracking-wide ${rangeDays === d ? 'border-brand-400 text-brand-400 bg-brand-400/10' : 'border-rmpg-700 text-rmpg-400 hover:text-rmpg-200'}`}>
            {d === 3 ? '3 Days' : d === 7 ? 'Week' : d === 14 ? '2 Weeks' : 'Month'}
          </button>
        ))}
        <div className="w-px h-4 bg-rmpg-700 mx-1" />
        {(Object.keys(SOURCE_META) as AgendaItem['source'][]).map((s) => {
          const meta = SOURCE_META[s];
          const on = sources.has(s);
          return (
            <button key={s} onClick={() => toggleSource(s)}
              className={`px-2 py-[3px] rounded border text-[10px] uppercase tracking-wide ${on ? meta.tone + ' bg-surface-raised' : 'border-rmpg-800 text-rmpg-600'}`}>
              {meta.label}
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

      {/* Agenda */}
      {byDay.length === 0 && !loading && (
        <div className="text-center text-rmpg-500 text-[11px] py-12 border border-rmpg-800 rounded bg-surface-raised">
          Nothing scheduled in this range.
        </div>
      )}
      {byDay.map(([date, dayItems]) => (
        <div key={date} className="border border-rmpg-800 rounded bg-surface-raised">
          <div className="px-3 py-[3px] border-b border-rmpg-800 text-[9px] font-semibold uppercase tracking-wider text-rmpg-400">
            {dayLabel(date)} <span className="text-rmpg-600">· {dayItems.length}</span>
          </div>
          <div className="divide-y divide-rmpg-800/60">
            {dayItems.map((i) => {
              const meta = SOURCE_META[i.source];
              const Icon = meta.icon;
              const highlighted = i.source === 'custom' && String(i.id) === highlightId;
              return (
                <div key={i.key}
                  className={`flex items-center gap-3 px-3 py-[5px] text-[11px] ${highlighted ? 'bg-brand-400/10' : 'hover:bg-surface-base/60'}`}>
                  <span className={`flex items-center gap-1 w-16 shrink-0 ${meta.tone.split(' ')[0]}`}>
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[9px] uppercase">{meta.label}</span>
                  </span>
                  <span className="w-24 shrink-0 font-mono text-rmpg-300">
                    {i.start ?? '—'}{i.end ? `–${i.end}` : ''}
                  </span>
                  <button onClick={() => i.link && navigate(i.link)}
                    className="flex-1 text-left text-rmpg-100 hover:text-brand-400 truncate">
                    {i.title}
                    {i.subtitle && <span className="text-rmpg-500 ml-2">{i.subtitle}</span>}
                  </button>
                  {i.status && <span className="text-[9px] uppercase text-rmpg-500">{i.status}</span>}
                  {i.source === 'custom' && i.status === 'scheduled' && (
                    <span className="flex gap-1">
                      <IconButton aria-label="Mark completed" onClick={() => setEventStatus(i.id, 'completed')}>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      </IconButton>
                      <IconButton aria-label="Cancel event" onClick={() => setEventStatus(i.id, 'cancelled')}>
                        <X className="w-3.5 h-3.5 text-red-400" />
                      </IconButton>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

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
