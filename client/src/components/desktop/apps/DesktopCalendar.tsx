import React, { useState, useEffect } from 'react';
import { X, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { apiFetch } from '../../../hooks/useApi';
import { shiftsToCsv, downloadTextFile } from '../../../utils/rmsListExport';
import { copyToClipboard } from '../../../utils/contextMenuActions';

const W = 700;
const H = 500;

interface Shift {
  id: number;
  date: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  status?: string;
}

type ViewMode = 'month' | 'week';

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface DesktopCalendarProps {
  onClose: () => void;
}

export default function DesktopCalendar({ onClose }: DesktopCalendarProps) {
  const now = new Date();
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [view, setView] = useState<ViewMode>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(now); // new-date-ok: cloning local Date object, not a server string
    d.setDate(d.getDate() - d.getDay());
    return d;
  });
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadShifts = () => {
    setLoadError(null);
    apiFetch<Shift[]>('/schedules/my-schedule')
      .then(setShifts)
      .catch((err) => {
        setShifts([]);
        setLoadError(err instanceof Error ? err.message : 'Failed to load schedule');
      });
  };

  useEffect(() => { loadShifts(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shiftSet = new Set(shifts.map(s => s.date?.slice(0, 10)));

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else { setMonth(m => m - 1); } };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else { setMonth(m => m + 1); } };
  const prevWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; }); // new-date-ok: cloning Date object
  const nextWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; }); // new-date-ok: cloning Date object

  const selectedShifts = selected ? shifts.filter(s => s.date?.slice(0, 10) === selected) : [];

  const renderMonth = () => {
    const firstDay = new Date(year, month, 1).getDay(); // new-date-ok: local calendar math from integer y/m/d
    const daysInMonth = new Date(year, month + 1, 0).getDate(); // new-date-ok: local calendar math from integer y/m/d
    const todayStr = isoDate(now.getFullYear(), now.getMonth(), now.getDate());
    const cells: React.ReactNode[] = [];

    for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoDate(year, month, d);
      const isToday = iso === todayStr;
      const hasShift = shiftSet.has(iso);
      const isSel = iso === selected;
      cells.push(
        <div
          key={d}
          onClick={() => setSelected(isSel ? null : iso)}
          style={{
            padding: '4px 6px', minHeight: 52, borderRadius: 2, cursor: 'pointer',
            background: isSel ? 'var(--surface-sunken)' : 'var(--surface-base)',
            border: `1px solid ${isSel ? 'var(--desktop-shell-accent, var(--accent-silver-400))' : isToday ? 'var(--accent-silver-400)' : 'var(--border-default)'}`,
            position: 'relative',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--text-primary)' : 'var(--text-muted)' }}>{d}</span>
          {hasShift && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--desktop-shell-accent, var(--accent-silver-400))', position: 'absolute', top: 5, right: 5 }} />}
        </div>
      );
    }
    return cells;
  };

  const renderWeek = () => {
    const days: React.ReactNode[] = [];
    const todayStr = isoDate(now.getFullYear(), now.getMonth(), now.getDate());
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart); // new-date-ok: cloning Date object
      d.setDate(d.getDate() + i);
      const iso = isoDate(d.getFullYear(), d.getMonth(), d.getDate());
      const isToday = iso === todayStr;
      const dayShifts = shifts.filter(s => s.date?.slice(0, 10) === iso);
      days.push(
        <div key={i} onClick={() => setSelected(selected === iso ? null : iso)} style={{
          flex: 1, minHeight: 280, padding: 6, borderRadius: 2, cursor: 'pointer',
          background: selected === iso ? 'var(--surface-sunken)' : 'var(--surface-base)',
          border: `1px solid ${isToday ? 'var(--accent-silver-400)' : 'var(--border-default)'}`,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: isToday ? 700 : 400, marginBottom: 4 }}>
            {DAY_NAMES[d.getDay()]} {d.getDate()}
          </div>
          {dayShifts.map(s => (
            <div key={s.id} style={{ fontSize: 10, padding: '2px 4px', marginBottom: 2, borderRadius: 2, background: 'var(--desktop-shell-accent, var(--accent-silver-400))', color: 'var(--surface-sunken)' }}>
              {s.start_time ?? ''} {s.location ?? ''}
            </div>
          ))}
        </div>
      );
    }
    return days;
  };

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px var(--window-shadow)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <Calendar size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Schedule Calendar</span>
        <button aria-label="Close Calendar" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      {/* Nav bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <button aria-label="Previous" onClick={view === 'month' ? prevMonth : prevWeek} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1, textAlign: 'center' }}>
          {view === 'month'
            ? `${MONTH_NAMES[month]} ${year}`
            : `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()} – ${(() => { const e = new Date(weekStart); e.setDate(e.getDate() + 6); return e.getDate(); })()} ${weekStart.getFullYear()}` // new-date-ok: cloning Date object
          }
        </span>
        <button aria-label="Next" onClick={view === 'month' ? nextMonth : nextWeek} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => setView('month')}
          style={{ fontSize: 10, padding: '3px 10px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: view === 'month' ? 'var(--surface-sunken)' : 'none', color: 'var(--text-primary)' }}
        >Month</button>
        <button
          onClick={() => setView('week')}
          style={{ fontSize: 10, padding: '3px 10px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: view === 'week' ? 'var(--surface-sunken)' : 'none', color: 'var(--text-primary)' }}
        >Week</button>
        <button
          type="button"
          onClick={() => downloadTextFile('shifts.csv', shiftsToCsv(shifts))}
          disabled={shifts.length === 0}
          style={{ fontSize: 10, padding: '3px 10px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: 'none', color: 'var(--text-primary)' }}
        >CSV</button>
      </div>
      {loadError && (
        <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--sev-critical)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{loadError}</span>
          <button type="button" onClick={loadShifts} style={{ fontSize: 10, border: '1px solid var(--border-default)', background: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}>Retry</button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {view === 'month' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, padding: '6px 8px 0', flexShrink: 0 }}>
              {DAY_NAMES.map(d => <div key={d} style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', textAlign: 'center', padding: '2px 0' }}>{d}</div>)}
            </div>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, padding: '2px 8px 8px', overflowY: 'auto', alignContent: 'start' }}>
              {renderMonth()}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 2, padding: '6px 8px', flex: 1, overflow: 'auto' }}>
              {renderWeek()}
            </div>
          </>
        )}

        {/* Selected day detail */}
        {selected && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-default)', background: 'var(--surface-base)', flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{selected}</span>
            <button type="button" onClick={() => void copyToClipboard(selected)} style={{ fontSize: 9, marginLeft: 8, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>Copy date</button>
            {selectedShifts.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 12 }}>No scheduled shifts</span>
            ) : selectedShifts.map(s => (
              <span key={s.id} style={{ fontSize: 11, color: 'var(--text-primary)', marginLeft: 12 }}>
                {s.start_time ?? ''}{s.end_time ? ` – ${s.end_time}` : ''}{s.location ? ` · ${s.location}` : ''}{s.status ? ` (${s.status})` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
