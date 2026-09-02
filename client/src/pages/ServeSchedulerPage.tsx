// ============================================================
// RMPG Flex — Serve Scheduler (Full swim-lane view)
// ============================================================
// Features:
//   • Officer swim-lane calendar (drag/drop reschedule + queue assign)
//   • Unassigned queue sidebar (drag source)
//   • Auto-rebalance preview modal (admin/manager/supervisor only)
//   • Deep-link: ?schedule_id=<id> — highlights + scrolls that slot
//   • N shortcut — opens Rebalance modal (canManage only)
//   • Esc cascade — closes Rebalance modal, then blurs focus
//   • Role gates: canManage (admin/manager/supervisor) for Rebalance
//   • 3-state empty: loading / empty-schedule / error
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpDown, Navigation, Pencil, RefreshCcw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useContextMenu } from '../context/ContextMenuContext';
import RangePicker from '../components/scheduler/RangePicker';
import UnassignedQueueSidebar from '../components/scheduler/UnassignedQueueSidebar';
import OfficerLaneTimeline, { type OfficerOption } from '../components/scheduler/OfficerLaneTimeline';
import RebalancePreviewModal from '../components/scheduler/RebalancePreviewModal';
import EditSlotModal from '../components/serve/EditSlotModal';
import ConfirmDialog from '../components/ConfirmDialog';
import type { RangeMode } from '../utils/schedulerLanes';
import type { ScheduleSlot } from '../utils/schedulerView';
import {
  describeConflicts,
  describeServeScheduleError,
  extractOverlapConflicts,
  type ScheduleConflict,
} from '../utils/serveScheduleErrors';
import { downloadTextFile, serveScheduleToCsv } from '../utils/rmsListExport';
import {
  runServeOptimizationV2,
  type ServeV2Result,
} from '../utils/mapboxOptimizationV2';

const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

interface ScheduleResp {
  schedule: Array<{ date: string; weekday: string; slots: ScheduleSlot[] }>;
  generated_at: string;
}

/** Pending action waiting for ConfirmDialog confirmation */
type PendingAction =
  | { type: 'dismiss'; slot: ScheduleSlot }
  | { type: 'unassign'; slot: ScheduleSlot }
  | {
      type: 'overlap';
      slot: ScheduleSlot;
      target: { date: string; officer_id: number | null };
      conflicts: ScheduleConflict[];
    };

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
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  // ── Deep-link: ?schedule_id=<id> — strip after capturing ──
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkSlotId = useRef<number | null>(null);
  useEffect(() => {
    const raw = searchParams.get('schedule_id');
    if (!raw) return;
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) deepLinkSlotId.current = parsed;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('schedule_id');
      return next;
    }, { replace: true });
  // Run once on mount — searchParams intentionally excluded to avoid loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [anchorYmd, setAnchorYmd] = useState(today);
  const [mode, setMode] = useState<RangeMode>('week');
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [officers, setOfficers] = useState<OfficerOption[]>([]);
  const [showRebalance, setShowRebalance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [editingSlot, setEditingSlot] = useState<ScheduleSlot | null>(null);
  const [v2Busy, setV2Busy] = useState(false);
  const [v2Progress, setV2Progress] = useState('');
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
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

  // Officer list for the swim-lane view.
  useEffect(() => {
    apiFetch<Array<{ id: number; name: string }>>('/serve-intake/officers')
      .then((rows) => setOfficers(rows.map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => { /* lanes still render Unassigned even on failure */ });
  }, []);

  // ── Keyboard shortcuts ──
  //   N — open Rebalance modal (canManage only, not while typing).
  //   Esc — close Rebalance first, then blur active element.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName ?? '';
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        e.stopPropagation();
        if (showRebalance) { setShowRebalance(false); return; }
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      if ((e.key === 'n' || e.key === 'N') && canManage && !isTyping && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowRebalance(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showRebalance, canManage]);

  // The PATCH endpoint reads `scheduled_date`, not `date` — sending the raw
  // `target` object silently no-ops the date move (server falls back to the
  // slot's current date) while still returning 200, so the chip appears to move
  // until the next refetch snaps it back. Map the field name explicitly.
  //
  // `force` skips the server's overlap check. The route has supported ?force=1
  // since the endpoint was written, but no client ever sent it — so an overlap
  // 409 was a dead end with no way to say "yes, double-book them".
  const patchSlotMove = useCallback(async (
    slot: ScheduleSlot, target: { date: string; officer_id: number | null }, force: boolean,
  ) => {
    await apiFetch(`/serve-intake/schedule/${slot.id}${force ? '?force=1' : ''}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduled_date: target.date, officer_id: target.officer_id }),
    });
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
      await patchSlotMove(slot, target, false);
    } catch (e) {
      const conflicts = extractOverlapConflicts(e);
      if (conflicts) {
        // Deliberately NOT refetching here: the optimistic chip stays in the
        // lane the operator dropped it in while they read the dialog, so the
        // question "double-book?" has a visible subject. Cancel reverts it.
        setPendingAction({ type: 'overlap', slot, target, conflicts });
        return;
      }
      refetch();
      // Toast instead of native alert — the swim-lane is drag-driven so a
      // modal would steal focus from the next drop the operator queued up.
      addToast(`Could not reassign attempt: ${describeServeScheduleError(e).message}`, 'error');
    }
  }, [patchSlotMove, refetch, addToast]);

  // ── ConfirmDialog: force an overlapping move (PATCH ?force=1) ──────────────
  // Audited server-side as `serve_schedule.force_overlap` rather than the
  // ordinary `serve_schedule.move`, so a deliberate double-book stays
  // distinguishable from a routine reschedule in the audit trail.
  const handleConfirmForceMove = useCallback(async (
    slot: ScheduleSlot, target: { date: string; officer_id: number | null },
  ) => {
    setConfirmLoading(true);
    try {
      await patchSlotMove(slot, target, true);
      addToast('Attempt moved — that officer is now double-booked for the window', 'warning');
    } catch (e) {
      addToast(`Could not move attempt: ${describeServeScheduleError(e).message}`, 'error');
    } finally {
      setConfirmLoading(false);
      setPendingAction(null);
      refetch();
    }
  }, [patchSlotMove, refetch, addToast]);

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

  // ── ConfirmDialog: dismiss slot (DELETE /schedule/:slotId) ─────────────────
  const handleConfirmDismiss = useCallback(async (slot: ScheduleSlot) => {
    setConfirmLoading(true);
    try {
      await apiFetch(`/serve-intake/schedule/${slot.id}`, { method: 'DELETE' });
      setSlots((prev) => prev.filter((s) => s.id !== slot.id));
      addToast('Slot dismissed', 'success');
      setPendingAction(null);
    } catch (e) {
      addToast(`Could not dismiss slot: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setConfirmLoading(false);
    }
  }, [addToast]);

  // ── ConfirmDialog: unassign slot (PATCH officer_id→null) ───────────────────
  const handleConfirmUnassign = useCallback(async (slot: ScheduleSlot) => {
    setConfirmLoading(true);
    try {
      await apiFetch(`/serve-intake/schedule/${slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officer_id: null }),
      });
      setSlots((prev) => prev.map((s) =>
        s.id === slot.id ? { ...s, officer_id: null } : s,
      ));
      addToast('Slot unassigned', 'success');
      setPendingAction(null);
    } catch (e) {
      addToast(`Could not unassign slot: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setConfirmLoading(false);
    }
  }, [addToast]);

  const handleConfirm = useCallback(() => {
    if (!pendingAction) return;
    if (pendingAction.type === 'dismiss') return void handleConfirmDismiss(pendingAction.slot);
    if (pendingAction.type === 'unassign') return void handleConfirmUnassign(pendingAction.slot);
    if (pendingAction.type === 'overlap') {
      return void handleConfirmForceMove(pendingAction.slot, pendingAction.target);
    }
  }, [pendingAction, handleConfirmDismiss, handleConfirmUnassign, handleConfirmForceMove]);

  // Cancelling an overlap prompt must undo the optimistic move that is still
  // on screen; the other two actions never touched local state.
  const handleCancelPending = useCallback(() => {
    if (pendingAction?.type === 'overlap') refetch();
    setPendingAction(null);
  }, [pendingAction, refetch]);

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

  // Right-click menu — dismiss/unassign already had handlers wired above
  // (handleConfirmDismiss/handleConfirmUnassign) but were never actually
  // reachable from the UI: nothing rendered ConfirmDialog or passed them to
  // OfficerLaneTimeline, so "Dismiss slot"/"Unassign officer" silently had no
  // way to trigger. Wiring them in here alongside the new Edit action.
  const handleSlotContextMenu = useCallback((slot: ScheduleSlot, e: React.MouseEvent) => {
    if (!canManage) return;
    openMenu(e, [
      { key: 'edit', label: 'Edit slot…', icon: <Pencil size={12} />, onClick: () => setEditingSlot(slot) },
      { key: 'sep', separator: true },
      ...(slot.officer_id != null
        ? [{ key: 'unassign', label: 'Unassign officer', onClick: () => setPendingAction({ type: 'unassign', slot }) }]
        : []),
      { key: 'dismiss', label: 'Dismiss slot', danger: true, onClick: () => setPendingAction({ type: 'dismiss', slot }) },
    ]);
  }, [canManage, openMenu]);

  // ── V2 Optimization: traffic-aware reroute from scheduler ──────────────────
  const handleOptimizeV2 = useCallback(async () => {
    const queueIds = slots.map((s) => s.queue_id).filter((id): id is number => id != null);
    if (queueIds.length < 2) {
      addToast('Need at least 2 scheduled stops to optimize', 'warning');
      return;
    }

    // Build shift window from the earliest/latest slot dates
    const dates = slots.map((s) => s.scheduled_date).sort();
    const shiftStart = dates[0];
    const shiftEnd = dates[dates.length - 1];

    // Find an officer to assign to (prefer the most-common officer in the schedule, or null)
    const officerCounts = new Map<number, number>();
    for (const s of slots) {
      if (s.officer_id != null) officerCounts.set(s.officer_id, (officerCounts.get(s.officer_id) ?? 0) + 1);
    }
    const topOfficer = [...officerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    setV2Busy(true);
    setV2Progress('Submitting to Mapbox Optimization V2…');
    try {
      const result: ServeV2Result | null = await runServeOptimizationV2({
        serve_queue_ids: queueIds,
        officer_unit_id: topOfficer ?? undefined,
        shift_start: `${shiftStart}T06:00:00.000Z`,
        shift_end: `${shiftEnd}T23:59:59.000Z`,
      });

      if (!result) {
        addToast('Optimization returned no solution — some stops may be unreachable', 'warning');
        return;
      }

      const count = result.orderedJobIds.length;
      const dropped = result.droppedJobIds.length;
      addToast(
        `V2 route optimized: ${count} stops${dropped > 0 ? `, ${dropped} dropped (unreachable)` : ''}`,
        dropped > 0 ? 'warning' : 'success',
      );
      refetch();
    } catch (e) {
      addToast(`V2 optimization failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setV2Busy(false);
      setV2Progress('');
    }
  }, [slots, refetch, addToast]);

  // ── Timeline area: loading / error / empty / data ─────────────────────────
  const renderTimeline = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-32 text-[11px] text-rmpg-400" role="status">
          Loading schedule…
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center justify-center h-32 text-[11px] text-red-300 gap-2" role="alert">
          <span>{error}</span>
          <button type="button" className="toolbar-btn" onClick={() => { void refetch(); }}>Retry</button>
        </div>
      );
    }
    if (slots.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-32 gap-1 text-[11px] text-rmpg-400">
          <span>No serve attempts scheduled for this window.</span>
          <span className="text-[10px]">Drag items from the queue{canManage ? ' or use Rebalance (N)' : ''} to populate lanes.</span>
        </div>
      );
    }
    return (
      <OfficerLaneTimeline
        anchorYmd={anchorYmd}
        mode={mode}
        slots={slots}
        officers={officers}
        todayYmd={today}
        highlightSlotId={deepLinkSlotId.current ?? undefined}
        onSlotContextMenu={canManage ? handleSlotContextMenu : undefined}
        onSlotDrop={canManage ? handleSlotDrop : undefined}
        onQueueDrop={canManage ? handleQueueDrop : undefined}
      />
    );
  };

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
          {canManage && (
            <button
              type="button"
              onClick={() => setShowRebalance(true)}
              title="Rebalance (N)"
              className="px-2 py-0.5 text-[10px] uppercase text-rmpg-300 hover:text-rmpg-100 border border-rmpg-700 rounded-[2px]"
            >
              <RefreshCcw size={9} className="inline mr-1" /> Rebalance
            </button>
          )}
          <button
            type="button"
            className="toolbar-btn"
            disabled={slots.length === 0}
            onClick={() => downloadTextFile('serve-schedule.csv', serveScheduleToCsv(slots.map((s) => ({
              job_number: s.case_number ?? String(s.id),
              status: s.status,
              court: s.window_label ?? '',
              hearing_date: s.scheduled_date,
            }))))}
          >CSV</button>
          {canManage && (
            <button
              type="button"
              className="toolbar-btn"
              disabled={slots.length < 2 || v2Busy}
              onClick={() => void handleOptimizeV2()}
              title="Optimize route order with live Mapbox traffic (V2)"
            >
              <ArrowUpDown size={9} className="inline mr-1" />
              {v2Busy ? v2Progress || 'Optimizing…' : 'Optimize V2'}
            </button>
          )}
        </div>
      </div>

      {slots.length > 0 && (
        <div className="flex items-center gap-3 px-2 py-1 mb-1 text-[10px] bg-surface-sunken/40 border border-rmpg-800/40 rounded-[2px]">
          <span className="text-rmpg-400">
            Total slots: <span className="text-rmpg-100 font-mono tabular-nums">{slots.length}</span>
          </span>
          <span className="text-rmpg-400">
            Today: <span className="text-rmpg-100 font-mono tabular-nums">{slots.filter(s => s.scheduled_date === today).length}</span>
          </span>
          <span className="text-rmpg-400">
            Critical: <span className={`font-mono tabular-nums ${slots.filter(s => (s as any).urgency_tier === 'critical').length > 0 ? 'text-red-300 animate-pulse' : 'text-rmpg-100'}`}>
              {slots.filter(s => (s as any).urgency_tier === 'critical').length}
            </span>
          </span>
          <span className="text-rmpg-400">
            Unassigned: <span className="text-amber-400 font-mono tabular-nums">{slots.filter(s => s.officer_id == null).length}</span>
          </span>
          <a
            href="/serve"
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase text-brand-200 border border-brand-500/40 rounded-[2px] hover:bg-brand-500/20"
          >
            Plan Route <Navigation size={9} className="inline" />
          </a>
          {v2Busy && (
            <span className="text-[10px] text-brand-300 animate-pulse font-mono">
              {v2Progress}
            </span>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <UnassignedQueueSidebar onAssign={(_item, _officerId, _date) => { refetch(); }} />
        <div className="flex-1 min-w-0">
          {renderTimeline()}
        </div>
      </div>

      {canManage && (
        <RebalancePreviewModal
          open={showRebalance}
          onClose={() => setShowRebalance(false)}
          onApplied={refetch}
        />
      )}

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
        isOpen={pendingAction !== null}
        onClose={handleCancelPending}
        onConfirm={handleConfirm}
        title={
          pendingAction?.type === 'dismiss' ? 'Dismiss slot?'
          : pendingAction?.type === 'overlap' ? 'Double-book this officer?'
          : 'Unassign officer?'
        }
        message={
          pendingAction?.type === 'dismiss'
            ? 'This removes the scheduled attempt window. It can be re-generated via backfill if needed.'
          : pendingAction?.type === 'overlap'
            ? `${describeConflicts(pendingAction.conflicts)} Moving it here schedules both at once — the move is logged as a forced overlap.`
            : 'The slot stays scheduled but no officer will be assigned.'
        }
        confirmLabel={
          pendingAction?.type === 'dismiss' ? 'Dismiss'
          : pendingAction?.type === 'overlap' ? 'Move anyway'
          : 'Unassign'
        }
        confirmVariant={pendingAction?.type === 'dismiss' ? 'danger' : 'warning'}
        isLoading={confirmLoading}
      />
    </div>
  );
}
