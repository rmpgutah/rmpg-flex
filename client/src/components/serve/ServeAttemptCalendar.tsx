import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Bell, BellOff, ChevronRight, AlertTriangle, Clock } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface ScheduleSlot {
  id: number;
  queue_id: number;
  attempt_number: number;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  window_label: string;
  notify_at: string;
  notify_before_secs: number;
  notified: number;
  dismissed: number;
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  case_number: string | null;
  priority: string;
  deadline: string | null;
  status: string;
}

interface DayGroup {
  date: string;
  weekday: string;
  slots: ScheduleSlot[];
}

interface ScheduleResponse {
  schedule: DayGroup[];
  generated_at: string;
}

const PRIORITY_CLASS: Record<string, string> = {
  urgent: 'text-red-400 border-red-500',
  rush: 'text-orange-400 border-orange-400',
  normal: 'text-blue-300 border-blue-400',
  routine: 'text-rmpg-400 border-rmpg-500',
};

function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const ms = Date.parse(`${deadline}T23:59:59`) - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function notifyLabel(secs: number): string {
  if (secs < 3600) return `${Math.round(secs / 60)}m before`;
  return `${Math.round(secs / 3600)}h before`;
}

function urgencyTag(days: number | null): { label: string; cls: string } | null {
  if (days === null) return null;
  if (days < 0) return { label: 'PAST DUE', cls: 'bg-red-600 text-white' };
  if (days === 0) return { label: 'DUE TODAY', cls: 'bg-red-600 text-white' };
  if (days <= 3) return { label: `${days}d left`, cls: 'bg-orange-500 text-white' };
  if (days <= 7) return { label: `${days}d left`, cls: 'bg-yellow-600 text-white' };
  return null;
}

interface Props {
  onSelectQueue?: (queueId: number) => void;
}

export default function ServeAttemptCalendar({ onSelectQueue }: Props) {
  const [schedule, setSchedule] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<ScheduleResponse>('/serve-intake/schedule');
      setSchedule(data.schedule ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function dismissSlot(slotId: number) {
    setDismissing((s) => new Set(s).add(slotId));
    try {
      await apiFetch(`/serve-intake/schedule/${slotId}`, { method: 'DELETE' });
      setSchedule((prev) =>
        prev
          .map((day) => ({ ...day, slots: day.slots.filter((s) => s.id !== slotId) }))
          .filter((day) => day.slots.length > 0),
      );
    } catch {
      // non-fatal
    } finally {
      setDismissing((s) => { const n = new Set(s); n.delete(slotId); return n; });
    }
  }

  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-rmpg-400 text-xs py-6 px-4">
        <CalendarDays size={14} className="animate-pulse" />
        Loading attempt schedule…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-xs py-4 px-4">
        <AlertTriangle size={14} />
        {error}
        <button onClick={load} className="underline ml-1">Retry</button>
      </div>
    );
  }

  if (!schedule.length) {
    return (
      <div className="flex flex-col items-center gap-2 text-rmpg-500 text-xs py-8 px-4">
        <CalendarDays size={20} />
        <span>No upcoming attempt windows scheduled.</span>
        <span className="text-rmpg-600">Submit a serve intake packet to auto-generate attempt slots.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-brand-400 text-[11px] font-semibold uppercase tracking-wide">
          <CalendarDays size={13} />
          Attempt Schedule
        </div>
        <button onClick={load} className="text-rmpg-500 hover:text-rmpg-300 text-[10px] transition-colors">
          Refresh
        </button>
      </div>

      {schedule.map((day) => {
        const isToday = day.date === todayStr;
        return (
          <div key={day.date} className="rounded-sm border border-surface-border overflow-hidden">
            {/* Day header */}
            <div className={`flex items-center justify-between px-3 py-[5px] text-[10px] font-semibold uppercase tracking-wide
              ${isToday ? 'bg-brand-400/10 border-b border-brand-400/30 text-brand-300' : 'bg-surface-raised border-b border-surface-border text-rmpg-300'}`}>
              <span>{day.weekday} {day.date}</span>
              {isToday && <span className="text-brand-400 normal-case font-normal">Today</span>}
              <span className="text-rmpg-600 font-normal normal-case">{day.slots.length} window{day.slots.length > 1 ? 's' : ''}</span>
            </div>

            {/* Slots */}
            <div className="divide-y divide-surface-border bg-surface-base">
              {day.slots.map((slot) => {
                const days = daysUntil(slot.deadline);
                const tag = urgencyTag(days);
                const prioClass = PRIORITY_CLASS[slot.priority] ?? PRIORITY_CLASS.routine;
                const isDismissing = dismissing.has(slot.id);

                return (
                  <div key={slot.id} className="flex items-start gap-2 px-3 py-2 hover:bg-surface-raised/50 transition-colors">
                    {/* Window time */}
                    <div className="flex-shrink-0 text-center min-w-[52px]">
                      <div className="text-rmpg-200 text-[11px] font-mono font-semibold leading-tight">
                        {slot.window_start}
                      </div>
                      <div className="text-rmpg-500 text-[9px] font-mono">
                        –{slot.window_end}
                      </div>
                      <div className="text-rmpg-600 text-[9px] mt-0.5">
                        #{slot.attempt_number}
                      </div>
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => onSelectQueue?.(slot.queue_id)}
                          className="text-rmpg-100 text-[11px] font-medium truncate hover:text-brand-300 transition-colors text-left"
                        >
                          {slot.recipient_name || '(recipient)'}
                        </button>
                        {tag && (
                          <span className={`text-[9px] px-1 py-px rounded-sm font-semibold ${tag.cls}`}>
                            {tag.label}
                          </span>
                        )}
                        <span className={`text-[9px] border px-1 py-px rounded-sm ${prioClass}`}>
                          {(slot.priority || '').toUpperCase()}
                        </span>
                      </div>
                      <div className="text-rmpg-500 text-[10px] truncate mt-0.5">
                        {[slot.recipient_address, slot.recipient_city, slot.recipient_state].filter(Boolean).join(', ')}
                      </div>
                      {slot.case_number && (
                        <div className="text-rmpg-600 text-[10px] truncate">Case {slot.case_number}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`flex items-center gap-0.5 text-[9px] ${slot.notified ? 'text-green-500' : 'text-rmpg-500'}`}>
                          {slot.notified ? <Bell size={9} /> : <Clock size={9} />}
                          {slot.notified ? 'Notified' : `Alert ${notifyLabel(slot.notify_before_secs)}`}
                        </span>
                        {slot.window_label && (
                          <span className="text-rmpg-600 text-[9px] truncate">{slot.window_label}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {onSelectQueue && (
                        <button
                          onClick={() => onSelectQueue(slot.queue_id)}
                          className="text-rmpg-600 hover:text-brand-400 transition-colors p-0.5"
                          title="Open queue entry"
                        >
                          <ChevronRight size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => dismissSlot(slot.id)}
                        disabled={isDismissing}
                        className="text-rmpg-600 hover:text-red-400 transition-colors p-0.5"
                        title="Dismiss this window"
                      >
                        <BellOff size={11} className={isDismissing ? 'opacity-50' : ''} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
