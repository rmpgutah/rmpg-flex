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
      // new-date-ok: epoch math on a Z-suffixed ISO string, not a naive server timestamp
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
