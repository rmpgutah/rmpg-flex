// ============================================================
// RMPG Flex — Shift Plans Page (v1128)
// Standalone shift planning management page. Officers/units are
// assigned to geographic areas (beats/zones) for each shift.
// Uses the useShiftPlanning() hook for all state/CRUD.
//
// v1053 audit pass (Page 36 of the full-app frontend sweep):
//   • URL deep-link contract — ?date= and ?plan_id= so a "open
//     this shift plan" link in a Slack message lands the
//     operator on the same date + selected plan, then the
//     params are stripped so a refresh doesn't re-trigger.
//   • Native `confirm()` calls (3 sites: delete plan, clear-all,
//     delete-active-plan) replaced with ConfirmDialog so the
//     operator sees what they're acting on, not a generic
//     window prompt.
//   • Esc smart-cascade — confirm dialogs close first, then the
//     create-plan form, then deselect the active plan. The
//     previous handler only closed the create form (modal
//     captives elsewhere relied on their own X buttons).
//   • `N` opens New Plan — typing-suppressed, mirrors the
//     Citations / Personnel / Process-Server / Fleet / Comms
//     contract from #1031 / #1040 / #1041 / #1044 / #1048.
//   • Court-ready / supervisor-briefing PDF (shiftPlanPdf.ts) —
//     replaces the "only export was admin CSV" gap. Pure-client,
//     same Arial + RMPG-gold idiom as the v1024–v1048 series.
//   • Unicode arrow chrome (◀ ▶ "◀ Back to Plans") replaced
//     with Lucide ChevronLeft / ChevronRight so the surfaces
//     match the rest of the app and don't depend on the OS
//     font for legibility.
//   • Privacy — the selected date and selected plan now persist
//     PER-USER (`rmpg_shift_plans_state_<user.id>`) so a
//     shared workstation doesn't leak "Lt. Smith was looking at
//     the night shift" to the next officer who logs in. The
//     PRIOR behavior (always start on today, no selection) was
//     fine for privacy but lost context across reloads.
//   • Hardcoded `rgba(...)` literals in PlanStatusBadge swapped
//     for theme tokens so the day/night palette swap applies.
//   • Empty-state distinction — "no plans on this date" still
//     shows the create-prompt; the existing single state was
//     fine since there's no filter that could hide a plan.
//   • Dead-code prune — `editingAssignment`, `assignOfficerIds`,
//     `assignUnitIds`, `assignNotes` state was declared and
//     never read. Pulled out (the assignment-edit modal lives
//     on the Map page's shift planning overlay).
// ============================================================

import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  Calendar, Plus, Trash2, Copy, Play, CheckCircle, Archive, Users, MapPin,
  ChevronRight, ChevronLeft, X, Shield, BarChart3, Save, AlertTriangle,
  ArrowRightLeft, TrendingUp, Eye, FileText, LayoutTemplate, CalendarRange,
} from 'lucide-react';
import { useShiftPlanning, SHIFT_TYPES } from '../hooks/useShiftPlanning';
import type { ShiftPlan, ShiftType, AreaAssignment } from '../hooks/useShiftPlanning';
import { useIsMobile } from '../hooks/useIsMobile';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import ConfirmDialog from '../components/ConfirmDialog';
import ExportButton from '../components/ExportButton';
import { apiFetch } from '../hooks/useApi';
import { localToday, dateToLocalYMD, safeDateTimeStr, parseTimestamp } from '../utils/dateUtils';
import { openShiftPlanPdf } from '../utils/shiftPlanPdf';
import { formatEnumValue } from '../utils/formatters';
import { downloadTextFile, shiftPlansToCsv } from '../utils/rmsListExport';

// ── Role gate ──────────────────────────────────────────────
const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

// ── Date helpers ───────────────────────────────────────────

function formatDate(dateStr: string) {
  const d = parseTimestamp(dateStr);
  return d.toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' });
}

function todayStr() {
  return localToday();
}

// ── Status badge helper ────────────────────────────────────
//
// v1053: pulled the hardcoded rgba() literals out so the day/night
// palette swap applies. Active stays green (the green-400 token is
// already palette-aware); archived/completed share the muted-gray
// surface used by other "terminal-state" pills across the app.
const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  draft:     { bg: 'var(--surface-sunken)',           text: 'var(--text-secondary)', border: 'var(--border-default)' },
  active:    { bg: 'rgba(var(--sev-ok-rgb),0.15)',     text: 'var(--sev-ok)',   border: 'rgba(var(--sev-ok-rgb),0.5)' },
  completed: { bg: 'var(--surface-sunken)',           text: 'var(--text-secondary)', border: 'var(--border-default)' },
  archived:  { bg: 'var(--surface-sunken)',           text: 'var(--text-muted)', border: 'var(--border-default)' },
};

function PlanStatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 transition-colors duration-150 inline-flex items-center"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: '2px' }}
      role="status"
    >
      {status}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function ShiftPlansPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const sp = useShiftPlanning();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const pendingDeepLinkPlanRef = useRef<string | null>(null);

  // Role gate — admin / manager / supervisor can create, edit, delete
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  // v1053 privacy — selected-date persists PER-USER. Storage is a thin
  // JSON blob ({ date, plan_id }) instead of two separate keys so the
  // pair stays atomic on reads. Same shape the deep-link consumer
  // expects, so the consume effect can hand the pair straight back to
  // setState without an intermediate.
  const stateKey = user?.id ? `rmpg_shift_plans_state_${user.id}` : 'rmpg_shift_plans_state';
  const readStoredState = (): { date?: string; plan_id?: string } => {
    try {
      const raw = localStorage.getItem(stateKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* ignore */ }
    return {};
  };
  const writeStoredState = (next: { date?: string; plan_id?: string }) => {
    try { localStorage.setItem(stateKey, JSON.stringify(next)); } catch { /* quota — ignore */ }
  };
  const initial = readStoredState();
  const [selectedDate, setSelectedDate] = useState<string>(initial.date || todayStr());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanShift, setNewPlanShift] = useState<ShiftType>('day');

  // Confirm dialog state (replaces 3 native confirm() prompts)
  const [deletePlanTarget, setDeletePlanTarget] = useState<ShiftPlan | null>(null);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);

  // ── Enhanced: Swap requests, overtime, staffing, conflicts, notifications, templates ──
  const [swapRequests, setSwapRequests] = useState<any[]>([]);
  const [allSwaps, setAllSwaps] = useState<any[]>([]);
  const [swapModalLoading, setSwapModalLoading] = useState(false);
  const [overtimeData, setOvertimeData] = useState<any>(null);
  const [staffingLevels, setStaffingLevels] = useState<any>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [shiftNotifs, setShiftNotifs] = useState<any[]>([]);
  const [overtimeLoading, setOvertimeLoading] = useState(true);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapActionPending, setSwapActionPending] = useState<number | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateAs, setSaveTemplateAs] = useState(false);
  const [applyTemplateEndDate, setApplyTemplateEndDate] = useState('');
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);

  // ── Deep-link consume ────────────────────────────────────
  //
  // ?date=YYYY-MM-DD       — land on this shift date
  // ?plan_id=<id>          — auto-select this plan once the hook hydrates.
  //
  // Params are stripped with setSearchParams({ replace: true }) so a
  // refresh doesn't re-trigger. Mirrors GangIntelPage / VictimServicesPage.
  useEffect(() => {
    const dateParam = searchParams.get('date');
    const planParam = searchParams.get('plan_id');
    let consumedAny = false;
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setSelectedDate(dateParam);
      consumedAny = true;
    }
    if (planParam) {
      // The plan may not be in state yet (server hydrate races) — the
      // separate watch effect below picks it up once it lands.
      sp.setActivePlanId(planParam);
      pendingDeepLinkPlanRef.current = planParam;
      consumedAny = true;
    }
    if (consumedAny) {
      const next = new URLSearchParams(searchParams);
      next.delete('date');
      next.delete('plan_id');
      setSearchParams(next, { replace: true });
    }
    // Stored prior plan_id — apply only if no deep-link plan was passed.
    if (!planParam && initial.plan_id && initial.plan_id !== sp.activePlanId) {
      sp.setActivePlanId(initial.plan_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch for the deep-link plan to hydrate and toast the result
  useEffect(() => {
    const pending = pendingDeepLinkPlanRef.current;
    if (!pending || sp.plans.length === 0) return;
    const found = sp.plans.find(p => p.id === pending);
    if (found) {
      addToast(`Shift plan "${found.name}" loaded`, 'success');
    } else {
      addToast('Shift plan not found', 'error');
    }
    pendingDeepLinkPlanRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.plans]);

  // Persist per-user state on every change
  useEffect(() => {
    writeStoredState({ date: selectedDate, plan_id: sp.activePlanId ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, sp.activePlanId]);

  useEffect(() => {
    let cancelled = false;
    // shiftPlans router mounted at /api (see src/routesConfig.ts)
    apiFetch('/shift-swaps?status=pending')
      .then(r => { if (!cancelled && Array.isArray(r)) setSwapRequests(r); })
      .catch((err: any) => { if (!cancelled) addToast(err?.message || 'Failed to load swap requests', 'error'); });
    apiFetch('/shift-notifications')
      .then((r: any) => { if (!cancelled && r?.notifications) setShiftNotifs(r.notifications); })
      .catch((err: any) => { if (!cancelled) addToast(err?.message || 'Failed to load shift notifications', 'error'); });
    return () => { cancelled = true; };
  }, [addToast]);

  const loadSwapModalData = () => {
    setSwapModalLoading(true);
    apiFetch('/shift-swaps')
      .then((r: any) => setAllSwaps(Array.isArray(r) ? r : []))
      .catch((err: any) => addToast(err?.message || 'Failed to load shift swaps', 'error'))
      .finally(() => setSwapModalLoading(false));
  };

  useEffect(() => {
    if (showSwapModal) loadSwapModalData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSwapModal]);

  useEffect(() => {
    let cancelled = false;
    setOvertimeLoading(true);
    let pending = 3;
    const done = () => { pending -= 1; if (pending === 0 && !cancelled) setOvertimeLoading(false); };
    apiFetch(`/staffing-levels?date=${selectedDate}`)
      .then((r: any) => { if (!cancelled && r) setStaffingLevels(r); })
      .catch((err: any) => { if (!cancelled) addToast(err?.message || 'Failed to load staffing levels', 'error'); })
      .finally(done);
    apiFetch(`/shift-plans/conflicts/${selectedDate}`)
      .then((r: any) => { if (!cancelled && r?.conflicts) setConflicts(r.conflicts); })
      .catch((err: any) => { if (!cancelled) addToast(err?.message || 'Failed to load conflicts', 'error'); })
      .finally(done);
    apiFetch(`/shift-overtime?week_start=${selectedDate}`)
      .then((r: any) => { if (!cancelled && r) setOvertimeData(r); })
      .catch((err: any) => { if (!cancelled) addToast(err?.message || 'Failed to load overtime data', 'error'); })
      .finally(done);
    return () => { cancelled = true; };
  }, [selectedDate, addToast]);

  // ── Computed ──
  const plansForDate = useMemo(() =>
    sp.plans.filter(p => p.date === selectedDate)
      .sort((a, b) => {
        const order = ['active', 'draft', 'completed', 'archived'];
        return order.indexOf(a.status) - order.indexOf(b.status);
      }),
    [sp.plans, selectedDate]
  );

  const stats = sp.getCoverageStats();

  // ── Date navigation ──
  const navigateDate = (delta: number) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(dateToLocalYMD(d));
  };

  // ── Create plan ──
  const handleCreate = () => {
    if (!newPlanName.trim()) return;
    sp.createPlan(newPlanName.trim(), selectedDate, newPlanShift);
    setNewPlanName('');
    setShowCreateForm(false);
  };

  // ── Duplicate plan ──
  const handleDuplicate = (planId: string) => {
    const nextDay = new Date(selectedDate + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    sp.duplicatePlan(planId, dateToLocalYMD(nextDay));
  };

  // ── Save to server ──
  const handleSave = async (planId: string) => {
    try {
      await sp.savePlanToServer(planId);
      addToast('Shift plan saved', 'success');
    } catch {
      addToast('Failed to save shift plan', 'error');
    }
  };

  // ── Swap actions ──
  const handleSwapRespond = async (swapId: number, accept: boolean) => {
    setSwapActionPending(swapId);
    try {
      await apiFetch(`/shift-swaps/${swapId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      addToast(accept ? 'Swap accepted' : 'Swap declined', 'success');
      loadSwapModalData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to respond to swap', 'error');
    } finally {
      setSwapActionPending(null);
    }
  };

  const handleSwapCancel = async (swapId: number) => {
    setSwapActionPending(swapId);
    try {
      await apiFetch(`/shift-swaps/${swapId}/cancel`, { method: 'POST' });
      addToast('Swap request cancelled', 'success');
      loadSwapModalData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to cancel swap', 'error');
    } finally {
      setSwapActionPending(null);
    }
  };

  const handleSwapReview = async (swapId: number, status: 'approved' | 'denied') => {
    setSwapActionPending(swapId);
    try {
      await apiFetch(`/shift-swaps/${swapId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      addToast(status === 'approved' ? 'Swap approved' : 'Swap denied', 'success');
      loadSwapModalData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to review swap', 'error');
    } finally {
      setSwapActionPending(null);
    }
  };

  // ── Court-ready supervisor briefing PDF (v1053) ──
  const handleExportPdf = (plan: ShiftPlan) => {
    try {
      openShiftPlanPdf({
        plan,
        stats: {
          assigned: plan.assignments.length,
          officers: new Set(plan.assignments.flatMap(a => a.officerIds)).size,
          units: new Set(plan.assignments.flatMap(a => a.unitIds)).size,
        },
        notifications: shiftNotifs,
        conflicts,
        preparedBy: user?.full_name || user?.username || undefined,
      });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to generate shift PDF', 'error');
    }
  };

  // ── Build a shift-plan row context menu ──
  const buildPlanMenu = (plan: ShiftPlan): ContextMenuItem[] => [
    m.action('Open plan', () => sp.setActivePlanId(plan.id), { icon: <Eye size={12} /> }),
    ...(canManage && plan.status === 'draft'
      ? [m.action('Activate', () => sp.updatePlanStatus(plan.id, 'active'), { icon: <Play size={12} /> })]
      : []),
    ...(canManage && plan.status === 'active'
      ? [m.action('Mark complete', () => sp.updatePlanStatus(plan.id, 'completed'), { icon: <CheckCircle size={12} /> })]
      : []),
    m.separator(),
    ...(canManage ? [m.action('Save to server', () => handleSave(plan.id), { icon: <Save size={12} /> })] : []),
    m.action('Briefing PDF', () => handleExportPdf(plan), { icon: <FileText size={12} /> }),
    ...(canManage ? [m.action('Duplicate to next day', () => handleDuplicate(plan.id), { icon: <Copy size={12} /> })] : []),
    m.copyId(plan.id),
    m.separator(),
    ...(canManage && plan.status !== 'archived'
      ? [m.action('Archive', () => sp.updatePlanStatus(plan.id, 'archived'), { icon: <Archive size={12} /> })]
      : []),
    ...(canManage ? [m.action('Delete', () => setDeletePlanTarget(plan), { icon: <Trash2 size={12} />, danger: true })] : []),
  ];

  // ── Build an area-assignment row context menu ──
  const buildAssignmentMenu = (a: AreaAssignment): ContextMenuItem[] => [
    m.copy('Copy area', a.label),
    m.copyId(a.id),
    ...(canManage ? [
      m.separator(),
      m.action('Remove assignment', () => sp.removeAssignment(a.id), { icon: <X size={12} />, danger: true }),
    ] : []),
  ];

  // Set document title
  useEffect(() => { document.title = 'Shift Plans — RMPG Flex'; }, []);

  // Keyboard shortcuts (v1053):
  //   Escape — smart-cascade (smallest-open-first). The previous
  //   handler closed only the create form, leaving any other modal
  //   state captive to its own close button. Order is: confirm
  //   dialogs (the most recent decision) → create form (mid-stack
  //   compose) → deselect plan (returns the panel to the empty state).
  //
  //   N → New Plan — typing-suppressed so a focused date input doesn't
  //   swallow the letter. Matches Citations / Personnel / Comms / Dash.
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (clearAllConfirm) { e.stopPropagation(); setClearAllConfirm(false); return; }
        if (deletePlanTarget) { e.stopPropagation(); setDeletePlanTarget(null); return; }
        if (showCreateForm) { e.stopPropagation(); setShowCreateForm(false); return; }
        if (sp.activePlanId) { e.stopPropagation(); sp.setActivePlanId(null); return; }
        return;
      }
      if ((e.key === 'n' || e.key === 'N')
          && canManage
          && !e.ctrlKey && !e.metaKey && !e.altKey
          && !isTypingTarget(e.target)) {
        e.preventDefault();
        setShowCreateForm(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canManage, clearAllConfirm, deletePlanTarget, showCreateForm, sp]);

  return (
    <div className="h-full flex flex-col bg-surface-base text-rmpg-100 overflow-hidden">
      {/* ── DATE SELECTOR BAR ─────────────────────────────── */}
      <div
        className={`${isMobile ? 'flex flex-col gap-2 px-3 py-2' : 'flex items-center justify-between px-4 py-2'} flex-shrink-0`}
        style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-3">
          <Calendar className="text-rmpg-500" style={{ width: 14, height: 14 }} />
          <button type="button"
            onClick={() => navigateDate(-1)}
            className="text-rmpg-400 hover:text-rmpg-100 px-1 py-0.5 hover:bg-rmpg-700/30 transition-colors flex items-center"
            aria-label="Previous day"
          >
            <ChevronLeft style={{ width: 12, height: 12 }} />
          </button>
          <input id="ff-shiftplanspage-0"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="Select shift date"
            className="bg-transparent text-rmpg-100 text-[11px] font-mono border border-rmpg-600 px-2 py-0.5 focus:border-rmpg-500 focus:outline-none focus:ring-1 focus:ring-rmpg-500/30 transition-colors"
          />
          <button type="button"
            onClick={() => navigateDate(1)}
            className="text-rmpg-400 hover:text-rmpg-100 px-1 py-0.5 hover:bg-rmpg-700/30 transition-colors flex items-center"
            aria-label="Next day"
          >
            <ChevronRight style={{ width: 12, height: 12 }} />
          </button>
          <span className="text-[11px] font-semibold text-rmpg-300">{formatDate(selectedDate)}</span>
          <button type="button"
            onClick={() => setSelectedDate(todayStr())}
            className="text-[9px] text-rmpg-400 hover:text-rmpg-300 uppercase font-bold tracking-wider px-1.5 py-0.5 hover:bg-surface-sunken/30 transition-colors border border-transparent hover:border-border-default/30"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Coverage stats */}
          {sp.activePlan && (
            <div className="flex items-center gap-3 text-[9px] text-rmpg-400 mr-4">
              <span className="flex items-center gap-1">
                <MapPin style={{ width: 9, height: 9 }} />
                {stats.assigned} Areas
              </span>
              <span className="flex items-center gap-1">
                <Users style={{ width: 9, height: 9 }} />
                {stats.officers} Officers
              </span>
              <span className="flex items-center gap-1">
                <Shield style={{ width: 9, height: 9 }} />
                {stats.units} Units
              </span>
            </div>
          )}

          {sp.activePlan && (
            <button type="button"
              onClick={() => handleExportPdf(sp.activePlan!)}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-rmpg-400 border border-rmpg-600 hover:text-rmpg-100 hover:border-rmpg-400 transition-colors"
              title="Court-ready briefing PDF for the selected plan"
            >
              <FileText style={{ width: 10, height: 10 }} />
              Briefing PDF
            </button>
          )}
          <button
            type="button"
            className="toolbar-btn"
            disabled={plansForDate.length === 0}
            onClick={() => downloadTextFile('shift-plans.csv', shiftPlansToCsv(plansForDate.map((p) => ({
              plan_date: p.date,
              shift: p.shiftType,
              status: p.status,
              district: p.name,
            }))))}
          >CSV</button>
          <ExportButton exportUrl="/api/shift-plans/export/csv" exportFilename="shift-plans.csv" />
          {canManage && (
            <button type="button"
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1 px-3 py-1 text-[9px] font-bold uppercase tracking-wider bg-surface-sunken/50 text-rmpg-400 border border-border-default/50 hover:bg-surface-raised/50 transition-colors"
              title="New shift plan (N)"
            >
              <Plus style={{ width: 10, height: 10 }} />
              New Plan
            </button>
          )}
        </div>
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT: Plan List ── */}
        <div className={`${isMobile ? (sp.activePlanId ? 'hidden' : 'w-full') : 'w-1/3'} flex flex-col border-r border-rmpg-700/50 overflow-hidden`}>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider px-3 py-2" style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-default)' }}>
            Plans for {formatDate(selectedDate)} ({plansForDate.length})
          </div>

          {/* Create form — only visible to admin/manager/supervisor */}
          {canManage && showCreateForm && (
            <div className="p-3 border-b border-rmpg-700/50" style={{ background: 'var(--surface-overlay)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-rmpg-400 uppercase">New Shift Plan</span>
                <button type="button" onClick={() => setShowCreateForm(false)} className="text-rmpg-500 hover:text-rmpg-100" aria-label="Close new-plan form">
                  <X style={{ width: 10, height: 10 }} />
                </button>
              </div>
              <input id="ff-shiftplanspage-1"
                type="text"
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                placeholder="Plan name..."
                className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-[10px] px-2 py-1.5 mb-2 focus:border-rmpg-500 focus:outline-none focus:ring-1 focus:ring-rmpg-500/30 transition-colors"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <div className="flex items-center gap-2 mb-2">
                {(Object.entries(SHIFT_TYPES) as [ShiftType, typeof SHIFT_TYPES[ShiftType]][]).map(([key, val]) => (
                  <button type="button"
                    key={key}
                    onClick={() => setNewPlanShift(key)}
                    className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                    style={{
                      background: newPlanShift === key ? val.color : 'transparent',
                      color: newPlanShift === key ? 'var(--surface-base)' : val.color,
                      border: `1px solid ${val.color}`,
                    }}
                  >
                    {val.label}
                  </button>
                ))}
              </div>
              <button type="button"
                onClick={handleCreate}
                disabled={!newPlanName.trim()}
                className="w-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider bg-surface-sunken/50 text-rmpg-400 border border-border-default/50 hover:bg-surface-raised/50 transition-colors disabled:opacity-40"
              >
                Create Plan
              </button>
            </div>
          )}

          {/* Plan cards */}
          <div className="flex-1 overflow-auto">
            {plansForDate.length === 0 ? (
              <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                    <Calendar className="w-6 h-6 text-rmpg-600" />
                  </div>
                  <p className="text-rmpg-400 font-medium">No shift plans for this date</p>
                  {canManage && (
                    <button type="button"
                      onClick={() => setShowCreateForm(true)}
                      className="text-rmpg-400 hover:text-rmpg-300 text-[10px] mt-2 hover:underline"
                    >
                      + Create one
                    </button>
                  )}
                </div>
              </div>
            ) : (
              plansForDate.map(plan => {
                const shiftConfig = SHIFT_TYPES[plan.shiftType];
                const isSelected = sp.activePlanId === plan.id;
                return (
                  <div
                    key={plan.id}
                    onClick={() => sp.setActivePlanId(plan.id)}
                    onContextMenu={(e) => openMenu(e, buildPlanMenu(plan))}
                    className="px-3 py-2.5 cursor-pointer transition-all duration-150 border-b border-rmpg-800/50 hover:brightness-110"
                    style={{
                      background: isSelected ? 'var(--surface-raised)' : 'transparent',
                      borderLeft: `3px solid ${shiftConfig?.color || 'var(--border-default)'}`,
                    }}
                    role="button"
                    tabIndex={0}
                    aria-selected={isSelected}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') sp.setActivePlanId(plan.id); }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-rmpg-100">{plan.name}</span>
                        <PlanStatusBadge status={plan.status} />
                      </div>
                      {isSelected && <ChevronRight style={{ width: 10, height: 10 }} className="text-rmpg-500" />}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-rmpg-400">
                      <span style={{ color: shiftConfig?.color }}>{shiftConfig?.label}</span>
                      <span>{shiftConfig?.defaultStart} – {shiftConfig?.defaultEnd}</span>
                      <span>{plan.assignments.length} assignments</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── CENTER + RIGHT: Plan Detail & Assignments ── */}
        <div className={`${isMobile ? (sp.activePlanId ? 'w-full' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden`}>
          {sp.activePlan ? (
            <>
              {/* Plan header with actions */}
              <div
                className={`${isMobile ? 'flex flex-col gap-2 px-3 py-2' : 'flex items-center justify-between px-4 py-2'} flex-shrink-0`}
                style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-default)' }}
              >
                <div>
                  {isMobile && (
                    <button type="button"
                      onClick={() => sp.setActivePlanId(null)}
                      className="text-rmpg-400 hover:text-rmpg-100 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"
                    >
                      <ChevronLeft style={{ width: 10, height: 10 }} /> Back to Plans
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-rmpg-100">{sp.activePlan.name}</span>
                    <PlanStatusBadge status={sp.activePlan.status} />
                    <span className="text-[9px] text-rmpg-500">
                      {SHIFT_TYPES[sp.activePlan.shiftType]?.label}
                    </span>
                  </div>
                  <div className="text-[9px] text-rmpg-500 mt-0.5">
                    Updated {safeDateTimeStr(sp.activePlan.updatedAt)}
                  </div>
                </div>

                <div className={`flex items-center gap-1 tab-scroll ${isMobile ? 'overflow-x-auto' : ''}`}>
                  {canManage && sp.activePlan.status === 'draft' && (
                    <button type="button"
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'active')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50"
                    >
                      <Play style={{ width: 9, height: 9 }} /> Activate
                    </button>
                  )}
                  {canManage && sp.activePlan.status === 'active' && (
                    <button type="button"
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'completed')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-surface-sunken/50 text-rmpg-400 border border-border-default/50 hover:bg-surface-raised/50"
                    >
                      <CheckCircle style={{ width: 9, height: 9 }} /> Complete
                    </button>
                  )}
                  {canManage && (
                    <button type="button"
                      onClick={() => handleSave(sp.activePlan!.id)}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-brand-900/50 text-brand-400 border border-brand-700/50 hover:bg-brand-800/50"
                      title="Save to server"
                    >
                      <Save style={{ width: 9, height: 9 }} /> Save
                    </button>
                  )}
                  <button type="button"
                    onClick={() => handleExportPdf(sp.activePlan!)}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-400 border border-rmpg-600 hover:text-rmpg-100 hover:border-rmpg-400"
                    title="Court-ready briefing PDF"
                  >
                    <FileText style={{ width: 9, height: 9 }} /> PDF
                  </button>
                  {canManage && (
                    <button type="button"
                      onClick={() => handleDuplicate(sp.activePlan!.id)}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-400 border border-rmpg-600 hover:text-rmpg-100 hover:border-rmpg-400"
                      title="Duplicate for next day"
                    >
                      <Copy style={{ width: 9, height: 9 }} /> Duplicate
                    </button>
                  )}
                  {canManage && sp.activePlan.status !== 'archived' && (
                    <button type="button"
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'archived')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-500 border border-rmpg-600 hover:text-amber-400 hover:border-amber-600"
                      title="Archive"
                    >
                      <Archive style={{ width: 9, height: 9 }} />
                    </button>
                  )}
                  {canManage && (
                    <button type="button"
                      onClick={() => setDeletePlanTarget(sp.activePlan!)}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-500 border border-rmpg-600 hover:text-red-400 hover:border-red-600"
                      title="Delete"
                    >
                      <Trash2 style={{ width: 9, height: 9 }} />
                    </button>
                  )}
                </div>
              </div>

              {/* Assignments table */}
              <div className="flex-1 overflow-auto">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider px-4 py-2 flex items-center justify-between"
                  style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-default)' }}
                >
                  <span>Area Assignments ({sp.activePlan.assignments.length})</span>
                  {canManage && sp.activePlan.assignments.length > 0 && (
                    <button type="button"
                      onClick={() => setClearAllConfirm(true)}
                      className="text-red-500 hover:text-red-400"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {sp.activePlan.assignments.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-rmpg-500 text-[10px]">
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                        <MapPin className="w-6 h-6 text-rmpg-600" />
                      </div>
                      <p className="text-rmpg-400 font-medium">No area assignments yet</p>
                      <p className="text-[9px] text-rmpg-600 mt-1">Use the Map page's shift planning overlay to select areas</p>
                    </div>
                  </div>
                ) : (
                  <div className={isMobile ? 'overflow-x-auto' : ''}>
                  <table className="w-full text-[10px]" role="table">
                    <thead className="sticky top-0 z-10">
                      <tr style={{ background: 'var(--surface-sunken)' }} className="text-rmpg-500 text-[9px] uppercase tracking-wider">
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Area</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Layer</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Officers</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Units</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Hours</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Notes</th>
                        <th className="text-right px-4 py-2 font-bold whitespace-nowrap" scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sp.activePlan.assignments.map((a) => (
                        <tr
                          key={a.id}
                          onContextMenu={(e) => openMenu(e, buildAssignmentMenu(a))}
                          className="border-b border-rmpg-700/30 hover:bg-surface-raised/30 transition-colors"
                        >
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              <MapPin style={{ width: 9, height: 9, color: a.color || 'var(--text-secondary)' }} />
                              <span className="font-semibold text-rmpg-100">{a.label}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-rmpg-400 capitalize">{a.layerId}</td>
                          <td className="px-4 py-2">
                            {a.officerNames.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {a.officerNames.map((name) => (
                                  <span key={name} className="text-[9px] font-mono px-1 py-px bg-surface-sunken/30 text-rmpg-400 border border-border-subtle/50">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-rmpg-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {a.unitCallSigns.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {a.unitCallSigns.map((cs) => (
                                  <span key={cs} className="text-[9px] font-mono px-1 py-px bg-green-900/30 text-green-400 border border-green-800/50">
                                    {cs}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-rmpg-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-rmpg-400 font-mono">
                            {a.shiftStart && a.shiftEnd ? `${a.shiftStart}–${a.shiftEnd}` : '—'}
                          </td>
                          <td className="px-4 py-2 text-rmpg-400 truncate max-w-[120px]">{a.notes || '—'}</td>
                          <td className="px-4 py-2 text-right">
                            {canManage && (
                              <button type="button"
                                onClick={() => sp.removeAssignment(a.id)}
                                className="text-rmpg-600 hover:text-red-400 transition-colors"
                                aria-label="Remove assignment"
                                title="Remove assignment"
                              >
                                <X style={{ width: 10, height: 10 }} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}

                {/* Summary panel */}
                {sp.activePlan.assignments.length > 0 && (
                  <div className="px-4 py-3" style={{ background: 'var(--surface-overlay)', borderTop: '1px solid var(--border-default)' }}>
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">Coverage Summary</div>
                    <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-4`}>
                      <div className="p-2.5" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: '2px' }}>
                        <div className="text-[18px] font-black text-rmpg-400 font-mono tabular-nums">{stats.assigned}</div>
                        <div className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold mt-0.5">Areas Covered</div>
                      </div>
                      <div className="p-2.5" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: '2px' }}>
                        <div className="text-[18px] font-black text-green-400 font-mono tabular-nums">{stats.officers}</div>
                        <div className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold mt-0.5">Officers Assigned</div>
                      </div>
                      <div className="p-2.5" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: '2px' }}>
                        <div className="text-[18px] font-black text-purple-400 font-mono tabular-nums">{stats.units}</div>
                        <div className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold mt-0.5">Units Deployed</div>
                      </div>
                      <div className="p-2.5" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: '2px' }}>
                        <div className="text-[18px] font-black text-amber-400 font-mono">
                          {SHIFT_TYPES[sp.activePlan.shiftType]?.defaultStart}
                        </div>
                        <div className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold mt-0.5">Shift Start</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-rmpg-500">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                  <BarChart3 className="w-7 h-7 text-rmpg-600" />
                </div>
                <p className="text-sm font-medium text-rmpg-400">Select a shift plan to view details</p>
                <p className="text-[10px] text-rmpg-600 mt-1">or create a new plan for {formatDate(selectedDate)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Enhanced Panels: Notifications, Staffing, Conflicts, OT, Swaps ── */}
      <div className="flex-shrink-0 border-t border-rmpg-700 bg-surface-sunken p-3 space-y-2 max-h-[240px] overflow-y-auto">
        {/* Shift Notifications */}
        {shiftNotifs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {shiftNotifs.slice(0, 6).map((n: any, i: number) => (
              <span key={i} className={`text-[9px] px-2 py-0.5 rounded ${n.severity === 'critical' ? 'bg-red-900/30 text-red-400' : n.severity === 'warning' ? 'bg-amber-900/30 text-amber-400' : 'bg-surface-sunken/30 text-rmpg-400'}`}>
                {n.message}
              </span>
            ))}
          </div>
        )}

        {overtimeLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" aria-busy="true" aria-label="Loading shift metrics">
            {[1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="h-[52px] bg-surface-raised animate-pulse"
                style={{ borderRadius: '2px', border: '1px solid var(--border-subtle)' }}
              />
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {/* Staffing Levels */}
          {staffingLevels?.levels?.map((level: any) => (
            <div key={level.shift_type || level.plan_id} className={`p-2 rounded border text-center ${level.is_understaffed ? 'bg-red-900/20 border-red-800/30' : 'bg-surface-base border-rmpg-700'}`}>
              <div className="text-[8px] text-rmpg-500 uppercase">{level.shift_type} shift</div>
              <div className={`text-sm font-bold font-mono ${level.is_understaffed ? 'text-red-400' : 'text-green-400'}`}>
                {level.staff_count}/{level.min_required}
              </div>
              <div className={`text-[8px] ${level.is_understaffed ? 'text-red-400' : 'text-green-400'}`}>{formatEnumValue(level.staffing_status)}</div>
            </div>
          ))}

          {/* Conflicts for today */}
          {conflicts.length > 0 && (
            <div className="p-2 rounded border bg-amber-900/20 border-amber-800/30 text-center">
              <AlertTriangle className="w-3 h-3 text-amber-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold font-mono text-amber-400">{conflicts.length}</div>
              <div className="text-[8px] text-amber-400">Conflicts</div>
            </div>
          )}

          {/* Pending Swap Requests */}
          {swapRequests.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSwapModal(true)}
              className="p-2 rounded border bg-surface-sunken/20 border-border-subtle/30 text-center hover:bg-surface-raised/30 transition-colors"
            >
              <ArrowRightLeft className="w-3 h-3 text-rmpg-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold font-mono text-rmpg-400">{swapRequests.length}</div>
              <div className="text-[8px] text-rmpg-400">Swap Requests</div>
            </button>
          )}

          {/* Weekly Overtime */}
          {overtimeData?.officers?.filter((o: any) => o.is_overtime).length > 0 && (
            <div className="p-2 rounded border bg-amber-900/20 border-amber-800/30 text-center">
              <TrendingUp className="w-3 h-3 text-amber-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold font-mono text-amber-400">
                {overtimeData.officers.filter((o: any) => o.is_overtime).length}
              </div>
              <div className="text-[8px] text-amber-400">In OT This Week</div>
            </div>
          )}
        </div>
        )}

        {/* Conflict Details */}
        {conflicts.length > 0 && (
          <div className="space-y-0.5">
            {conflicts.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 bg-amber-900/20 rounded text-[9px] text-amber-400">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="font-bold">{c.officer_name}</span>
                <span>assigned to {c.shift_count} shifts</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Template Modal ── */}
      {showTemplateModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tmpl-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowTemplateModal(false)}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 rounded-sm w-[480px] max-w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
              <h2 id="tmpl-title" className="text-sm font-semibold text-rmpg-100 flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4 text-brand-400" />
                Shift Plan Templates
              </h2>
              <button type="button" onClick={() => setShowTemplateModal(false)} className="text-rmpg-400 hover:text-rmpg-100 p-1" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {saveTemplateAs && (
                <div className="p-3 bg-surface-sunken border border-rmpg-700 rounded-sm space-y-2">
                  <div className="text-[10px] text-rmpg-400 font-bold uppercase">Save current plan as template</div>
                  <input
                    type="text"
                    value={saveTemplateName}
                    onChange={(e) => setSaveTemplateName(e.target.value)}
                    placeholder="Template name..."
                    className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && saveTemplateName.trim() && sp.activePlan) {
                        apiFetch('/shift-plans/templates', {
                          method: 'POST',
                          body: JSON.stringify({
                            name: saveTemplateName.trim(),
                            shift_type: sp.activePlan.shiftType,
                            pattern_json: JSON.stringify(sp.activePlan.assignments.map(a => ({
                              label: a.label,
                              layerId: a.layerId,
                              officerIds: a.officerIds,
                              unitIds: a.unitIds,
                              shiftStart: a.shiftStart,
                              shiftEnd: a.shiftEnd,
                              notes: a.notes,
                              color: a.color,
                            }))),
                          }),
                        })
                          .then(() => {
                            setSaveTemplateAs(false);
                            setSaveTemplateName('');
                            setTemplateLoading(true);
                            apiFetch<any>('/shift-plans/templates').then(r => setTemplates(Array.isArray(r) ? r : r?.data ?? [])).catch(() => setTemplates([])).finally(() => setTemplateLoading(false));
                            addToast('Template saved', 'success');
                          })
                          .catch((err: any) => addToast(err?.message || 'Failed to save template', 'error'));
                      }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (saveTemplateName.trim() && sp.activePlan) {
                          apiFetch('/shift-plans/templates', {
                            method: 'POST',
                            body: JSON.stringify({
                              name: saveTemplateName.trim(),
                              shift_type: sp.activePlan.shiftType,
                              pattern_json: JSON.stringify(sp.activePlan.assignments.map(a => ({
                                label: a.label,
                                layerId: a.layerId,
                                officerIds: a.officerIds,
                                unitIds: a.unitIds,
                                shiftStart: a.shiftStart,
                                shiftEnd: a.shiftEnd,
                                notes: a.notes,
                                color: a.color,
                              }))),
                            }),
                          })
                            .then(() => {
                              setSaveTemplateAs(false);
                              setSaveTemplateName('');
                              setTemplateLoading(true);
                              apiFetch<any>('/shift-plans/templates').then(r => setTemplates(Array.isArray(r) ? r : r?.data ?? [])).catch(() => setTemplates([])).finally(() => setTemplateLoading(false));
                              addToast('Template saved', 'success');
                            })
                            .catch((err: any) => addToast(err?.message || 'Failed to save template', 'error'));
                        }
                      }}
                      className="px-2 py-1 text-[10px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSaveTemplateAs(false); setSaveTemplateName(''); }}
                      className="px-2 py-1 text-[10px] border border-rmpg-700 rounded-sm text-rmpg-400"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {templateLoading ? (
                <div className="text-xs text-rmpg-400 py-4 text-center">Loading templates…</div>
              ) : templates.length === 0 ? (
                <div className="text-xs text-rmpg-500 py-4 text-center">
                  <LayoutTemplate className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                  No templates saved yet.
                  {sp.activePlan && sp.activePlan.assignments.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSaveTemplateAs(true); setSaveTemplateName(sp.activePlan!.name + ' Template'); }}
                      className="block mx-auto mt-2 px-2 py-1 text-[10px] bg-surface-sunken text-rmpg-400 border border-rmpg-700 rounded-sm hover:bg-surface-raised"
                    >
                      Save current plan as template
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {sp.activePlan && sp.activePlan.assignments.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSaveTemplateAs(true); setSaveTemplateName(sp.activePlan!.name + ' Template'); }}
                      className="w-full px-2 py-1.5 text-[10px] bg-surface-sunken text-rmpg-400 border border-rmpg-700 rounded-sm hover:bg-surface-raised flex items-center gap-1 justify-center"
                    >
                      <Save className="w-3 h-3" /> Save current plan as template
                    </button>
                  )}
                  {templates.map((t: any) => (
                    <div key={t.id} className="p-2.5 bg-surface-base border border-rmpg-700 rounded-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[11px] font-semibold text-rmpg-100">{t.name}</div>
                          <div className="text-[9px] text-fg-secondary mt-0.5">
                            {t.shift_type} · {(typeof t.pattern_json === 'string' ? JSON.parse(t.pattern_json) : t.pattern_json || []).length} slots
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {!applyingTemplate || applyingTemplate !== String(t.id) ? (
                            <button
                              type="button"
                              onClick={() => {
                                const endDate = prompt('Apply to date range. Enter end date (YYYY-MM-DD):', selectedDate);
                                if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return;
                                setApplyingTemplate(String(t.id));
                                apiFetch(`/shift-plans/apply-template/${t.id}`, {
                                  method: 'POST',
                                  body: JSON.stringify({ start_date: selectedDate, end_date: endDate }),
                                })
                                  .then(() => {
                                    addToast('Template applied — refresh to see new plans', 'success');
                                  })
                                  .catch((err: any) => addToast(err?.message || 'Failed to apply template', 'error'))
                                  .finally(() => setApplyingTemplate(null));
                              }}
                              className="px-1.5 py-0.5 text-[9px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
                              title="Apply template to date range"
                            >
                              <CalendarRange className="w-3 h-3" />
                            </button>
                          ) : (
                            <span className="text-[9px] text-rmpg-400">Applying…</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Swap Requests Modal ── */}
      {showSwapModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="swap-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowSwapModal(false)}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 rounded-sm w-[560px] max-w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
              <h2 id="swap-title" className="text-sm font-semibold text-rmpg-100 flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-brand-400" />
                Shift Swap Requests
              </h2>
              <button type="button" onClick={() => setShowSwapModal(false)} className="text-fg-secondary hover:text-rmpg-100 p-1" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {swapModalLoading ? (
                <div className="text-xs text-fg-secondary py-4 text-center">Loading…</div>
              ) : allSwaps.filter((s: any) => ['pending', 'pending_supervisor'].includes(s.status)).length === 0 ? (
                <div className="text-xs text-fg-muted py-4 text-center">No open swap requests.</div>
              ) : (
                allSwaps
                  .filter((s: any) => ['pending', 'pending_supervisor'].includes(s.status))
                  .map((s: any) => {
                    const isTarget = s.target_id === user?.id && s.status === 'pending';
                    const isApprover = canManage && (s.status === 'pending_supervisor' || (s.status === 'pending' && !s.target_id));
                    const isRequester = s.requester_id === user?.id;
                    const isCancellable = isRequester && ['pending', 'pending_supervisor'].includes(s.status);
                    const busy = swapActionPending === s.id;
                    return (
                      <div key={s.id} className="p-2.5 bg-surface-base border border-rmpg-700 rounded-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] font-semibold text-rmpg-100">
                              {s.requester_name ?? `Officer #${s.requester_id}`} — {s.shift_date}
                            </div>
                            <div className="text-[9px] text-fg-secondary mt-0.5">
                              {s.target_name ? `to ${s.target_name}` : 'Open swap'} · {formatEnumValue(s.status)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {isTarget && (
                              <>
                                <button type="button" disabled={busy} onClick={() => handleSwapRespond(s.id, true)}
                                  className="px-2 py-1 text-[9px] bg-green-900/50 text-green-400 border border-green-700/50 rounded-sm hover:bg-green-800/50 disabled:opacity-40">
                                  Accept
                                </button>
                                <button type="button" disabled={busy} onClick={() => handleSwapRespond(s.id, false)}
                                  className="px-2 py-1 text-[9px] text-fg-muted border border-rmpg-600 rounded-sm hover:text-red-400 hover:border-red-600 disabled:opacity-40">
                                  Decline
                                </button>
                              </>
                            )}
                            {isApprover && (
                              <>
                                <button type="button" disabled={busy} onClick={() => handleSwapReview(s.id, 'approved')}
                                  className="px-2 py-1 text-[9px] bg-green-900/50 text-green-400 border border-green-700/50 rounded-sm hover:bg-green-800/50 disabled:opacity-40">
                                  Approve
                                </button>
                                <button type="button" disabled={busy} onClick={() => handleSwapReview(s.id, 'denied')}
                                  className="px-2 py-1 text-[9px] text-fg-muted border border-rmpg-600 rounded-sm hover:text-red-400 hover:border-red-600 disabled:opacity-40">
                                  Deny
                                </button>
                              </>
                            )}
                            {isCancellable && !isApprover && (
                              <button type="button" disabled={busy} onClick={() => handleSwapCancel(s.id)}
                                className="px-2 py-1 text-[9px] text-fg-muted border border-rmpg-600 rounded-sm hover:text-red-400 hover:border-red-600 disabled:opacity-40">
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Confirm dialogs (v1053 — replace 3 native confirm() prompts) ── */}
      <ConfirmDialog
        isOpen={!!deletePlanTarget}
        onClose={() => setDeletePlanTarget(null)}
        onConfirm={() => {
          if (deletePlanTarget) sp.deletePlan(deletePlanTarget.id);
          setDeletePlanTarget(null);
        }}
        title="Delete shift plan"
        message="This removes the shift plan from your workstation. Any unsaved area assignments are lost."
        details={deletePlanTarget && (
          <>
            <div>{deletePlanTarget.name}</div>
            <div>
              {formatDate(deletePlanTarget.date)}
              {' · '}
              {SHIFT_TYPES[deletePlanTarget.shiftType]?.label}
              {' · '}
              {deletePlanTarget.assignments.length} assignment
              {deletePlanTarget.assignments.length === 1 ? '' : 's'}
            </div>
          </>
        )}
        confirmLabel="Delete plan"
        confirmVariant="danger"
      />

      <ConfirmDialog
        isOpen={clearAllConfirm}
        onClose={() => setClearAllConfirm(false)}
        onConfirm={() => {
          sp.removeAllAssignments();
          setClearAllConfirm(false);
        }}
        title="Remove all assignments"
        message="This clears every area assignment from this shift plan. Officers and units will need to be reassigned before the plan is briefed."
        details={sp.activePlan && (
          <>
            <div>{sp.activePlan.name}</div>
            <div>
              {sp.activePlan.assignments.length} assignment
              {sp.activePlan.assignments.length === 1 ? '' : 's'}
              {' · '}
              {stats.officers} officer{stats.officers === 1 ? '' : 's'}
              {' · '}
              {stats.units} unit{stats.units === 1 ? '' : 's'}
            </div>
          </>
        )}
        confirmLabel="Remove all"
        confirmVariant="danger"
      />
    </div>
  );
}
