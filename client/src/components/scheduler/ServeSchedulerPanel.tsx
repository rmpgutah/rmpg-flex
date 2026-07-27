import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink, Navigation, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { useAuth } from '../../context/AuthContext';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import {
  describeConflicts,
  describeServeScheduleError,
  extractOverlapConflicts,
  type ScheduleConflict,
} from '../../utils/serveScheduleErrors';
import ConfirmDialog from '../ConfirmDialog';
import EditSlotModal from '../serve/EditSlotModal';
import WeekTimeline from './WeekTimeline';
import MonthGrid from './MonthGrid';
import type { OfficerOption } from './OfficerLaneTimeline';
import type { ScheduleSlot } from '../../utils/schedulerView';

const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

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

type SlotTarget = { date: string; window_start: string; window_end: string };

/** A drop the server rejected as an overlap, held while the operator decides. */
interface PendingOverlap {
  slot: ScheduleSlot;
  target: SlotTarget;
  conflicts: ScheduleConflict[];
}

export default function ServeSchedulerPanel() {
  const [view, setView] = useState<ViewMode>('week');
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [officers, setOfficers] = useState<OfficerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [editingSlot, setEditingSlot] = useState<ScheduleSlot | null>(null);
  const [pendingOverlap, setPendingOverlap] = useState<PendingOverlap | null>(null);
  const [forcing, setForcing] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');
  const { openMenu } = useContextMenu();

  const today = useMemo(todayDenver, []);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const include = 'tier';
      const range = view === 'week' ? 7 : 31;
      const [y, m, d] = today.split('-').map(Number);
      const startMs = Date.UTC(y, m - 1, d);
      const endDate = new Date(startMs + (range - 1) * 86_400_000) // new-date-ok: epoch-ms arithmetic, not a server string
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

  useEffect(() => {
    apiFetch<Array<{ id: number; name: string }>>('/serve-intake/officers')
      .then((rows) => setOfficers(rows.map((o) => ({ id: o.id, name: o.name }))))
      .catch(() => { /* Edit modal still opens; officer select shows empty */ });
  }, []);

  // The PATCH endpoint reads `scheduled_date`, not `date` — sending the raw
  // `target` object silently no-ops the date move (server falls back to the
  // slot's current date) while still returning 200, so the chip appears to move
  // until the next refetch snaps it back. Map the field name explicitly.
  //
  // `force` skips the server's overlap check (audited as
  // `serve_schedule.force_overlap`). Without it an overlap 409 is a dead end.
  const patchSlotMove = useCallback(async (
    slot: ScheduleSlot, target: SlotTarget, force: boolean,
  ) => {
    await apiFetch(`/serve-intake/schedule/${slot.id}${force ? '?force=1' : ''}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduled_date: target.date,
        window_start: target.window_start,
        window_end: target.window_end,
      }),
    });
  }, []);

  const handleSlotDrop = useCallback(async (slot: ScheduleSlot, target: SlotTarget) => {
    // Optimistic update.
    setSlots((prev) => prev.map((s) =>
      s.id === slot.id
        ? { ...s, scheduled_date: target.date, window_start: target.window_start, window_end: target.window_end, manually_moved: 1 }
        : s,
    ));
    try {
      await patchSlotMove(slot, target, false);
    } catch (e) {
      const conflicts = extractOverlapConflicts(e);
      if (conflicts) {
        // Leave the optimistic chip where it was dropped so the confirm has a
        // visible subject; cancelling refetches it back to its old band.
        setPendingOverlap({ slot, target, conflicts });
        return;
      }
      // Revert on failure. A transient strip, NOT setError — the panel's
      // render branches on `error` before the grid, so reusing it for a failed
      // drag would replace the whole timeline with a one-line message.
      refetch();
      setMoveError(describeServeScheduleError(e).message);
    }
  }, [patchSlotMove, refetch]);

  const handleConfirmForceMove = useCallback(async () => {
    if (!pendingOverlap) return;
    const { slot, target } = pendingOverlap;
    setForcing(true);
    try {
      await patchSlotMove(slot, target, true);
    } catch (e) {
      setMoveError(describeServeScheduleError(e).message);
    } finally {
      setForcing(false);
      setPendingOverlap(null);
      refetch();
    }
  }, [pendingOverlap, patchSlotMove, refetch]);

  const handleCancelForceMove = useCallback(() => {
    setPendingOverlap(null);
    refetch(); // undo the optimistic move still on screen
  }, [refetch]);

  // ── EditSlotModal: full manual edit (date, window, officer, label, notify) ─
  const handleSlotSave = useCallback(async (edited: ScheduleSlot) => {
    if (!editingSlot) return;
    await apiFetch(`/serve-intake/schedule/${editingSlot.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduled_date: edited.scheduled_date,
        window_start: edited.window_start,
        window_end: edited.window_end,
        officer_id: edited.officer_id,
        window_label: edited.window_label,
        notify_before_secs: edited.notify_before_secs,
      }),
    });
    refetch();
  }, [editingSlot, refetch]);

  const handleSlotContextMenu = useCallback((slot: ScheduleSlot, e: React.MouseEvent) => {
    if (!canManage) return;
    const items: ContextMenuItem[] = [
      { key: 'edit', label: 'Edit slot…', icon: <Pencil size={12} />, onClick: () => setEditingSlot(slot) },
    ];
    openMenu(e, items);
  }, [canManage, openMenu]);

  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      await apiFetch('/serve-intake/schedule/backfill', { method: 'POST' });
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backfill failed');
    } finally {
      setBackfilling(false);
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
        : !loading && slots.length === 0
        ? (
          <div className="p-4 flex flex-col items-center gap-2 text-center">
            <p className="text-[11px] text-rmpg-400">
              No scheduled attempt windows found for this period.
            </p>
            <p className="text-[10px] text-fg-muted">
              Jobs added manually or synced from ServeManager need their schedules generated.
            </p>
            <button
              type="button"
              onClick={handleBackfill}
              disabled={backfilling}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-brand-500/20 text-brand-200 border border-brand-500/40 rounded-[2px] hover:bg-brand-500/30 disabled:opacity-50 transition-colors"
            >
              {backfilling
                ? <><RefreshCw size={11} className="animate-spin" /> Generating…</>
                : <><Sparkles size={11} /> Generate Schedule</>}
            </button>
          </div>
        )
        : view === 'week'
        ? (
          <WeekTimeline
            anchorYmd={today}
            slots={slots}
            todayYmd={today}
            onSlotContextMenu={handleSlotContextMenu}
            onSlotDrop={handleSlotDrop}
          />
        )
        : (
          <MonthGrid
            anchorYmd={today}
            slots={slots}
            todayYmd={today}
            onSlotDrop={handleSlotDrop}
          />
        )
      }
      {moveError && (
        <div
          role="alert"
          className="flex items-center gap-2 px-2 py-1 border-t border-red-500/40 bg-red-900/20 text-[10px] text-red-200"
        >
          <span className="flex-1">{moveError}</span>
          <button
            type="button"
            onClick={() => setMoveError(null)}
            className="px-1 uppercase tracking-wide hover:text-red-100"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="px-2 py-1 border-t border-rmpg-700 text-[10px] text-rmpg-300 flex gap-3 items-center">
        <span>Today: <span className="text-rmpg-100 tabular-nums">{todayCount}</span></span>
        <span>
          Critical: <span className={`${criticalCount > 0 ? 'text-red-300' : 'text-rmpg-100'} tabular-nums`}>{criticalCount}</span>
          {criticalCount > 0 ? <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> : null}
        </span>
        <span>
          Unassigned: <span className="text-amber-400 tabular-nums">{slots.filter(s => s.officer_id == null).length}</span>
        </span>
        <a
          href="/serve-intake/scheduler"
          className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase text-brand-200 border border-brand-500/40 rounded-[2px] hover:bg-brand-500/20"
        >
          <Navigation size={8} /> Plan Route
        </a>
      </div>

      {editingSlot && (
        <EditSlotModal
          visible
          slot={editingSlot}
          officers={officers}
          onSave={handleSlotSave}
          onCancel={() => setEditingSlot(null)}
          onClose={() => setEditingSlot(null)}
        />
      )}

      <ConfirmDialog
        isOpen={pendingOverlap !== null}
        onClose={handleCancelForceMove}
        onConfirm={handleConfirmForceMove}
        title="Double-book this window?"
        message={pendingOverlap
          ? `${describeConflicts(pendingOverlap.conflicts)} Moving it here schedules both at once — the move is logged as a forced overlap.`
          : ''}
        confirmLabel="Move anyway"
        confirmVariant="warning"
        isLoading={forcing}
      />
    </div>
  );
}
