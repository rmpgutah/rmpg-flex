import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';
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
  const { addToast } = useToast();

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

  // Esc — close the Rebalance preview when it's open. No N shortcut here;
  // the scheduler is a read/drag surface, not a creation surface.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showRebalance) {
        setShowRebalance(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showRebalance]);

  // Officer list for the swim-lane view.
  useEffect(() => {
    apiFetch<Array<{ id: number; name: string }>>('/serve-intake/officers')
      .then((rows) => setOfficers(rows.map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => { /* lanes still render Unassigned even on failure */ });
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
      // Toast instead of native alert — the swim-lane is drag-driven so a
      // modal would steal focus from the next drop the operator queued up.
      addToast(`Could not reassign attempt: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    }
  }, [refetch, addToast]);

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
      addToast(`Could not assign paper: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    }
  }, [refetch, addToast]);

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
        <UnassignedQueueSidebar onAssign={(_item, _officerId, _date) => { refetch(); }} />
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
