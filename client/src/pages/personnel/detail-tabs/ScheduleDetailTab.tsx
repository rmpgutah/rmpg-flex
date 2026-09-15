// ============================================================
// RMPG Flex — Officer Schedule Detail Tab
// ============================================================

import { useMemo } from 'react';
import { Calendar, Plus, Trash2, MapPin, Sun, Moon, Clock, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Schedule } from '../../../types';
import { parseTimestamp } from '../../../utils/dateUtils';
import { toDisplayLabel } from '../../../utils/formatters';

interface Props {
  schedules: Schedule[];
  onAddSchedule: () => void;
  onDeleteSchedule: (scheduleId: string) => void;
}

const STATUS_BADGE: Record<string, string> = {
  completed:  'bg-green-900/50 text-green-400 border border-green-700/50',
  cancelled:  'bg-red-900/50 text-red-400 border border-red-700/50',
  confirmed:  'bg-surface-sunken/50 text-rmpg-400 border border-border-default/50',
  no_show:    'bg-red-900/50 text-red-400 border border-red-700/50',
  scheduled:  'bg-brand-900/40 text-brand-300 border border-brand-700/40',
  active:     'bg-green-900/50 text-green-400 border border-green-700/50',
};

function getDenverHour(dateStr: string): number {
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  return h === 24 ? 0 : h;
}

function isNightShift(shiftStart: string): boolean {
  if (!shiftStart) return false;
  const hour = getDenverHour(shiftStart);
  return hour >= 18 || hour < 6;
}

function formatShiftStart(shiftStart: string): string {
  if (!shiftStart) return '-';
  return parseTimestamp(shiftStart).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatShiftTime(dateStr: string): string {
  if (!dateStr) return '-';
  return parseTimestamp(dateStr).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatShiftDate(dateStr: string): string {
  if (!dateStr) return '-';
  return parseTimestamp(dateStr).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function shiftDurationHrs(start: string, end: string): string {
  if (!start || !end) return '';
  const ms = parseTimestamp(end).getTime() - parseTimestamp(start).getTime();
  if (ms <= 0) return '';
  const hrs = ms / 3600000;
  return `${hrs % 1 === 0 ? hrs.toFixed(0) : hrs.toFixed(1)} hr`;
}

function nowDenver(): Date {
  return new Date();
}

export default function ScheduleDetailTab({ schedules, onAddSchedule, onDeleteSchedule }: Props) {
  const now = nowDenver();

  const { active, upcoming, past } = useMemo(() => {
    const a: Schedule[] = [];
    const u: Schedule[] = [];
    const p: Schedule[] = [];
    for (const s of schedules) {
      const start = s.shift_start ? parseTimestamp(s.shift_start).getTime() : 0;
      const end   = s.shift_end   ? parseTimestamp(s.shift_end).getTime()   : start + 1;
      const n = now.getTime();
      if (start <= n && n < end) {
        a.push(s);
      } else if (start > n) {
        u.push(s);
      } else {
        p.push(s);
      }
    }
    u.sort((x, y) => parseTimestamp(x.shift_start).getTime() - parseTimestamp(y.shift_start).getTime());
    p.sort((x, y) => parseTimestamp(y.shift_start).getTime() - parseTimestamp(x.shift_start).getTime());
    return { active: a, upcoming: u, past: p };
  }, [schedules]);

  const nextShift = upcoming[0];
  const hoursUntilNext = nextShift
    ? Math.max(0, (parseTimestamp(nextShift.shift_start).getTime() - now.getTime()) / 3600000)
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5">
          <Calendar className="w-3 h-3" />
          Schedules
          <span className="text-rmpg-600 font-normal">({schedules.length})</span>
        </h3>
        <button
          type="button"
          onClick={onAddSchedule}
          className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
        >
          <Plus className="w-3 h-3" />
          Add Schedule
        </button>
      </div>

      {/* Summary stats */}
      {schedules.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="panel-beveled p-2 text-center bg-surface-base">
            <p className="text-lg font-bold font-mono text-rmpg-100">{active.length}</p>
            <p className="text-[9px] text-rmpg-500 uppercase tracking-wider">Active Now</p>
          </div>
          <div className="panel-beveled p-2 text-center bg-surface-base">
            <p className="text-lg font-bold font-mono text-brand-300">{upcoming.length}</p>
            <p className="text-[9px] text-rmpg-500 uppercase tracking-wider">Upcoming</p>
          </div>
          <div className="panel-beveled p-2 text-center bg-surface-base">
            <p className="text-lg font-bold font-mono text-rmpg-400">{past.length}</p>
            <p className="text-[9px] text-rmpg-500 uppercase tracking-wider">Past</p>
          </div>
        </div>
      )}

      {/* Next shift notice */}
      {nextShift && hoursUntilNext != null && (
        <div className="flex items-center gap-2 p-2 rounded-sm bg-brand-950/30 border border-brand-800/40">
          <ChevronRight className="w-3.5 h-3.5 text-brand-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-brand-300 font-semibold">
              Next shift in {hoursUntilNext < 1
                ? `${Math.round(hoursUntilNext * 60)} min`
                : `${hoursUntilNext.toFixed(1)} hrs`}
            </p>
            <p className="text-[10px] text-rmpg-400 truncate">{formatShiftStart(nextShift.shift_start)}</p>
          </div>
        </div>
      )}

      {/* Active shifts */}
      {active.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-green-400 flex items-center gap-1">
            <span className="led-dot led-green" />
            Active Now
          </p>
          {active.map((sched) => (
            <ShiftCard key={sched.id} sched={sched} onDelete={onDeleteSchedule} highlight="active" />
          ))}
        </div>
      )}

      {/* Upcoming shifts */}
      {upcoming.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-brand-400">Upcoming</p>
          {upcoming.map((sched) => (
            <ShiftCard key={sched.id} sched={sched} onDelete={onDeleteSchedule} highlight="upcoming" />
          ))}
        </div>
      )}

      {/* Past shifts */}
      {past.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-rmpg-500">Past</p>
          {past.map((sched) => (
            <ShiftCard key={sched.id} sched={sched} onDelete={onDeleteSchedule} highlight="past" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {schedules.length === 0 && (
        <div className="panel-beveled p-10 text-center bg-surface-base" role="status">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <Calendar className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">No schedules on file</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Click "Add Schedule" to assign shifts</p>
        </div>
      )}
    </div>
  );
}

interface ShiftCardProps {
  sched: Schedule;
  onDelete: (id: string) => void;
  highlight: 'active' | 'upcoming' | 'past';
}

function ShiftCard({ sched, onDelete, highlight }: ShiftCardProps) {
  const night = isNightShift(sched.shift_start);
  const statusClass = STATUS_BADGE[sched.status] ?? 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600';
  const duration = shiftDurationHrs(sched.shift_start, sched.shift_end);

  const accentColor =
    highlight === 'active'
      ? 'border-t-green-500'
      : highlight === 'upcoming'
      ? night ? 'border-t-purple-500' : 'border-t-brand-500'
      : 'border-t-rmpg-700';

  return (
    <div
      className={`panel-beveled p-3 bg-surface-base border-t-2 ${accentColor} ${
        highlight === 'past' ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Day label row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 ${
                night
                  ? 'bg-purple-900/40 text-purple-300'
                  : 'bg-brand-900/40 text-brand-300'
              }`}
            >
              {night ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
              {night ? 'NIGHT' : 'DAY'}
            </span>
            {highlight === 'active' && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 bg-green-900/40 text-green-300 animate-pulse">
                ● ON SHIFT
              </span>
            )}
          </div>

          {/* Date row */}
          <p className="text-[10px] text-rmpg-300">{formatShiftDate(sched.shift_start)}</p>

          {/* Time range + duration */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-rmpg-100 font-mono">
              {formatShiftTime(sched.shift_start)}
              <span className="text-rmpg-500 mx-1">—</span>
              {formatShiftTime(sched.shift_end)}
            </span>
            {duration && (
              <span className="flex items-center gap-0.5 text-[9px] text-rmpg-500">
                <Clock className="w-2.5 h-2.5" />
                {duration}
              </span>
            )}
          </div>

          {/* Status + property */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 font-bold uppercase ${statusClass}`}>
              {toDisplayLabel(sched.status).toUpperCase()}
            </span>
            {sched.property_name && (
              <span className="flex items-center gap-1 text-[10px] text-rmpg-400">
                <MapPin className="w-2.5 h-2.5 text-rmpg-500" />
                {sched.property_name}
              </span>
            )}
          </div>

          {sched.notes && (
            <p className="text-[10px] text-rmpg-500 italic">{sched.notes}</p>
          )}
        </div>

        {/* Delete — only for future scheduled shifts */}
        {sched.status === 'scheduled' && highlight === 'upcoming' && (
          <button
            type="button"
            onClick={() => onDelete(sched.id)}
            className="toolbar-btn toolbar-btn-danger flex-shrink-0"
            title="Delete schedule"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
