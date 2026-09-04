import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import RichTextArea from '../components/RichTextArea';
import {
  Gavel, Plus, Search, Loader2, ChevronDown, ChevronLeft, ChevronRight, Calendar,
  User, FileText, Scale, X, AlertTriangle, CheckCircle, Clock, XCircle, Eye,
  Printer, ExternalLink, FolderOpen, CalendarClock,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useFormDraft } from '../hooks/useFormDraft';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { openCourtAppearancePdf } from '../utils/courtAppearancePdf';
import { toDisplayLabel } from '../utils/formatters';
import { courtDocketToCsv, downloadTextFile } from '../utils/rmsListExport';

// ============================================================
// Types
// ============================================================

interface CourtEvent {
  id: number;
  event_number: string;
  event_type: string;
  status: string;
  event_date: string;
  event_time: string | null;
  court_name: string | null;
  courtroom: string | null;
  judge_name: string | null;
  court_case_number: string | null;
  citation_id: number | null;
  incident_id: number | null;
  case_id: number | null;
  defendant_person_id: number | null;
  defendant_name: string | null;
  defendant_full_name: string | null;
  prosecutor: string | null;
  defense_attorney: string | null;
  officers_required: string | null;
  notes: string | null;
  outcome: string | null;
  sentence: string | null;
  fine_amount: number | null;
  // Detail-payload extras hydrated when the row is expanded — parsed JSON in
  // the single-record endpoint, missing on the list endpoint. The PDF helper
  // accepts these as stringified JSON, undefined, or already-parsed values.
  judge_notes?: string | null;
  bail_amount?: string | number | null;
  bond_status?: string | null;
  surety_info?: string | null;
  witnesses?: any;
  court_fees?: any;
  continuance_log?: any;
  officer_confirmations?: any;
  continuance_count?: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ============================================================
// Constants
// ============================================================

const EVENT_TYPES = [
  { value: 'arraignment', label: 'Arraignment' },
  { value: 'preliminary_hearing', label: 'Preliminary Hearing' },
  { value: 'trial', label: 'Trial' },
  { value: 'sentencing', label: 'Sentencing' },
  { value: 'motion_hearing', label: 'Motion Hearing' },
  { value: 'status_conference', label: 'Status Conference' },
  { value: 'plea_hearing', label: 'Plea Hearing' },
  { value: 'probation_hearing', label: 'Probation Hearing' },
  { value: 'appeal', label: 'Appeal' },
  { value: 'subpoena', label: 'Subpoena' },
  { value: 'other', label: 'Other' },
];

const STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'continued', label: 'Continued' },
  { value: 'completed', label: 'Completed' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'convicted', label: 'Convicted' },
];

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
  continued: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  completed: 'bg-green-900/50 text-green-400 border-green-700/50',
  dismissed: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  convicted: 'bg-red-900/50 text-red-400 border-red-700/50',
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  scheduled: Clock,
  continued: AlertTriangle,
  completed: CheckCircle,
  dismissed: XCircle,
  convicted: Scale,
};

const OUTCOMES = [
  { value: 'guilty', label: 'Guilty' },
  { value: 'not_guilty', label: 'Not Guilty' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'plea_deal', label: 'Plea Deal' },
  { value: 'continued', label: 'Continued' },
  { value: 'mistrial', label: 'Mistrial' },
  { value: 'deferred', label: 'Deferred' },
];

const EMPTY_CREATE = {
  event_type: '',
  event_date: '',
  event_time: '',
  court_name: '',
  courtroom: '',
  judge_name: '',
  court_case_number: '',
  defendant_name: '',
  prosecutor: '',
  defense_attorney: '',
  notes: '',
};
type CreateForm = typeof EMPTY_CREATE;

const EMPTY_OUTCOME = {
  outcome: '',
  sentence: '',
  fine_amount: '',
  notes: '',
};
type OutcomeForm = typeof EMPTY_OUTCOME;

function eventTypeLabel(val: string): string {
  return EVENT_TYPES.find(t => t.value === val)?.label || toDisplayLabel(val);
}

// ============================================================
// Component
// ============================================================

export default function CourtRecordsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  // ── Data state ──
  const [events, setEvents] = useState<CourtEvent[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Filter state ──
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // ── UI state ──
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOutcomeModal, setShowOutcomeModal] = useState<number | null>(null);
  const [showOutcomeConfirm, setShowOutcomeConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hydrated single-event payload (parsed JSON columns) for the expanded row —
  // the list endpoint returns the bare row; the detail endpoint parses witnesses
  // / officer_confirmations / continuance_log / court_fees and includes
  // judge_notes / bail_*. Required to render the court-ready PDF accurately.
  const [hydratedDetail, setHydratedDetail] = useState<CourtEvent | null>(null);

  // ── Create form state (per-user localStorage draft — bare key would leak a
  // half-typed prosecutor name / judge notes between operators on a shared MDT,
  // matching the EquipmentFormModal / ArrestFormModal / CourtTrackerPage drafts) ──
  const createStorageKey = user?.id ? `rmpg_court_records_create_${user.id}` : 'rmpg_court_records_create_anon';
  const {
    form: formData,
    setForm: setFormData,
    clearDraft: clearCreateDraft,
  } = useFormDraft<CreateForm>({
    storageKey: createStorageKey,
    defaultValue: EMPTY_CREATE,
    isActive: showCreateModal,
  });

  // ── Outcome form state (also per-user — operator A's draft sentence/fine
  // would otherwise leak to operator B; previously the prior outcome's draft
  // also leaked between different events for the same operator) ──
  const outcomeStorageKey = user?.id
    ? `rmpg_court_records_outcome_${user.id}_${showOutcomeModal ?? 'none'}`
    : `rmpg_court_records_outcome_anon_${showOutcomeModal ?? 'none'}`;
  const {
    form: outcomeData,
    setForm: setOutcomeData,
    clearDraft: clearOutcomeDraft,
  } = useFormDraft<OutcomeForm>({
    storageKey: outcomeStorageKey,
    defaultValue: EMPTY_OUTCOME,
    isActive: showOutcomeModal !== null,
  });

  // ── Fetch events ──
  const fetchEvents = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('event_type', typeFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (searchTerm) params.set('search', searchTerm);

      const res = await apiFetch<{ data: CourtEvent[]; pagination: Pagination }>(
        `/court/events?${params.toString()}`
      );
      setEvents(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load court events');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, dateFrom, dateTo, searchTerm]);

  useEffect(() => {
    fetchEvents(1);
  }, [fetchEvents]);

  // ── Search on Enter ──
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setSearchTerm(searchInput);
    }
  };

  // ── Create event ──
  const handleCreate = async () => {
    if (!formData.event_type || !formData.event_date) return;
    setSaving(true);
    try {
      await apiFetch('/court/events', {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      setShowCreateModal(false);
      clearCreateDraft();
      setFormData(EMPTY_CREATE);
      fetchEvents(pagination.page);
      addToast('Court event created', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create court event');
    } finally {
      setSaving(false);
    }
  };

  // ── Record outcome (ConfirmDialog-gated — finalizing an outcome legally
  // closes the matter; an accidental "Plea Deal" save changes the docket
  // record without a clear undo path. Sequence: form → review dialog → write) ──
  const handleOutcome = async () => {
    if (!outcomeData.outcome || showOutcomeModal === null) return;
    setSaving(true);
    try {
      await apiFetch(`/court/events/${showOutcomeModal}/outcome`, {
        method: 'PUT',
        body: JSON.stringify({
          ...outcomeData,
          fine_amount: outcomeData.fine_amount ? parseFloat(outcomeData.fine_amount) : null,
        }),
      });
      const closedId = showOutcomeModal;
      setShowOutcomeConfirm(false);
      setShowOutcomeModal(null);
      clearOutcomeDraft();
      setOutcomeData(EMPTY_OUTCOME);
      fetchEvents(pagination.page);
      // Re-hydrate the detail panel so the operator sees the saved outcome
      // without having to collapse + re-expand.
      if (expandedId === closedId) hydrateDetail(closedId);
      addToast('Outcome recorded', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record outcome');
    } finally {
      setSaving(false);
    }
  };

  // ── Hydrate single-event detail (parsed JSON columns) for the expanded row ──
  const hydrateDetail = useCallback(async (id: number) => {
    try {
      const detail = await apiFetch<CourtEvent>(`/court/events/${id}`);
      // The detail endpoint already parses witnesses / officer_confirmations /
      // continuance_log / court_fees / documents JSON columns server-side.
      setHydratedDetail(detail);
    } catch {
      // Silent — the row snapshot from the list is good enough to render.
    }
  }, []);

  // ── Toggle row expand ──
  const toggleExpand = useCallback((id: number) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      if (next != null) hydrateDetail(next);
      else setHydratedDetail(null);
      return next;
    });
  }, [hydrateDetail]);

  // ── Print court-ready PDF (reuses the courtAppearancePdf renderer that
  // CourtTrackerPage already uses — Arial + gold banner court-room sheet
  // with parties, judge, witnesses, fees, bail, continuances, outcome,
  // signature line). Operator-attribution footer pulled from logged-in user. ──
  const printPdf = useCallback((ev: CourtEvent) => {
    try {
      const detail = hydratedDetail?.id === ev.id ? hydratedDetail : ev;
      const preparedBy = user
        ? [
            user.full_name ||
              `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
              user.email,
            user.badge_number ? `#${user.badge_number}` : '',
          ].filter(Boolean).join(' ')
        : undefined;
      openCourtAppearancePdf({
        id: detail.id,
        event_number: detail.event_number,
        event_type: detail.event_type,
        status: detail.status,
        event_date: detail.event_date,
        event_time: detail.event_time ?? undefined,
        court_name: detail.court_name ?? undefined,
        courtroom: detail.courtroom ?? undefined,
        judge_name: detail.judge_name ?? undefined,
        court_case_number: detail.court_case_number ?? undefined,
        defendant_name: detail.defendant_full_name || detail.defendant_name || undefined,
        prosecutor: detail.prosecutor ?? undefined,
        defense_attorney: detail.defense_attorney ?? undefined,
        outcome: detail.outcome,
        sentence: detail.sentence,
        fine_amount: detail.fine_amount,
        notes: detail.notes,
        judge_notes: detail.judge_notes ?? undefined,
        bail_amount: detail.bail_amount ?? undefined,
        bond_status: detail.bond_status ?? undefined,
        surety_info: detail.surety_info ?? undefined,
        witnesses: typeof detail.witnesses === 'string' ? detail.witnesses : JSON.stringify(detail.witnesses ?? []),
        court_fees: typeof detail.court_fees === 'string' ? detail.court_fees : JSON.stringify(detail.court_fees ?? {}),
        continuance_log: typeof detail.continuance_log === 'string' ? detail.continuance_log : JSON.stringify(detail.continuance_log ?? []),
        officers_required: typeof detail.officers_required === 'string' ? detail.officers_required : JSON.stringify(detail.officers_required ?? []),
        officer_confirmations: typeof detail.officer_confirmations === 'string' ? detail.officer_confirmations : JSON.stringify(detail.officer_confirmations ?? {}),
        continuance_count: detail.continuance_count,
        preparedBy,
      });
    } catch (err) {
      addToast(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Failed to generate court PDF', 'error');
    }
  }, [hydratedDetail, user, addToast]);

  // ── Cross-link helpers (Court Records ↔ Court Tracker on the same case) ──
  const openCourtTrackerForEvent = useCallback((ev: CourtEvent) => {
    navigate(`/court?event_id=${ev.id}`);
  }, [navigate]);
  const openCaseForEvent = useCallback((ev: CourtEvent) => {
    if (!ev.case_id) return;
    navigate(`/cases?case_id=${ev.case_id}`);
  }, [navigate]);

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const buildEventMenu = (ev: CourtEvent): ContextMenuItem[] => {
    const displayName = ev.defendant_full_name || ev.defendant_name || '';
    return [
      m.action(expandedId === ev.id ? 'Collapse' : 'Expand details', () => toggleExpand(ev.id), { icon: <Eye size={12} /> }),
      m.action('Print court-ready PDF', () => printPdf(ev), { icon: <Printer size={12} /> }),
      m.separator(),
      m.copy('Copy event #', ev.event_number),
      m.copyId(ev.id),
      ...(displayName ? [m.copy('Copy defendant', displayName, <User size={12} />)] : []),
      ...(ev.court_case_number ? [m.copy('Copy case #', ev.court_case_number, <FileText size={12} />)] : []),
      m.separator(),
      ...(ev.case_id ? [m.action('Open linked case', () => openCaseForEvent(ev), { icon: <FolderOpen size={12} /> })] : []),
      m.action('Open in Court Tracker', () => openCourtTrackerForEvent(ev), { icon: <CalendarClock size={12} /> }),
      ...(ev.status === 'scheduled' && !ev.outcome
        ? [
            m.separator(),
            m.action('Record outcome', () => { setOutcomeData({ outcome: '', sentence: '', fine_amount: '', notes: ev.notes || '' }); setShowOutcomeModal(ev.id); }, { icon: <Scale size={12} /> }),
          ]
        : []),
    ];
  };

  // ── URL deep-link contract ──
  // Accepted query params (consumed once and stripped, replace:true so a refresh
  // doesn't re-pin):
  //   ?event_id=<n>          — auto-expand the row (direct-fetch fallback when
  //                            the id isn't in the current paged view, e.g.
  //                            linked from a notification several pages deep)
  //   ?court_event_id=<n>    — same as event_id (matches Court Tracker contract
  //                            so deep links work across both pages)
  //   ?case_id=<n>           — preselect the search to that case # if resolvable
  //   ?docket=<str>          — seeds the search box with the court case # /
  //                            event # / defendant string (free-text docket
  //                            lookup as required by court-records ops)
  //   ?status=<scheduled|…>  — preselect status filter
  //   ?type=<arraignment|…>  — preselect event-type filter
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingEventIdRef = useRef<string | null>(
    searchParams.get('event_id') || searchParams.get('court_event_id')
  );
  const pendingCaseIdRef = useRef<string | null>(searchParams.get('case_id'));
  const pendingDocketRef = useRef<string | null>(searchParams.get('docket'));
  const pendingStatusRef = useRef<string | null>(searchParams.get('status'));
  const pendingTypeRef = useRef<string | null>(searchParams.get('type'));

  // Preselect filters BEFORE the first fetchEvents settles so the request
  // already hits the filtered server view (avoids a flash of unfiltered data).
  useEffect(() => {
    let touched = false;
    const docket = pendingDocketRef.current;
    if (docket) {
      pendingDocketRef.current = null;
      setSearchTerm(docket);
      setSearchInput(docket);
      touched = true;
    }
    const status = pendingStatusRef.current;
    if (status && STATUSES.some(s => s.value === status)) {
      pendingStatusRef.current = null;
      setStatusFilter(status);
      touched = true;
    } else if (status) {
      pendingStatusRef.current = null;
    }
    const t = pendingTypeRef.current;
    if (t && EVENT_TYPES.some(e => e.value === t)) {
      pendingTypeRef.current = null;
      setTypeFilter(t);
      touched = true;
    } else if (t) {
      pendingTypeRef.current = null;
    }
    const caseId = pendingCaseIdRef.current;
    if (caseId) {
      pendingCaseIdRef.current = null;
      // Seed the search with the case # the cases endpoint returns — best
      // effort; if /cases/:id fails (or the case has no court_case_number)
      // we silently fall back so the page isn't blocked.
      (async () => {
        try {
          const c = await apiFetch<{ case_number?: string; court_case_number?: string }>(`/cases/${caseId}`);
          const seed = c?.court_case_number || c?.case_number;
          if (seed) {
            setSearchTerm(seed);
            setSearchInput(seed);
          }
        } catch { /* silent */ }
      })();
      touched = true;
    }
    if (touched) {
      const next = new URLSearchParams(searchParams);
      for (const key of ['docket', 'status', 'type', 'case_id']) next.delete(key);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply ?event_id= once the events list has hydrated (with a direct-fetch
  // fallback when the id isn't in the current paged/filtered view).
  useEffect(() => {
    const target = pendingEventIdRef.current;
    if (!target || loading) return;
    pendingEventIdRef.current = null;
    const numericId = Number(target);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      addToast(`Invalid event id: ${target}`, 'error');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const hit = events.find((r) => r.id === numericId);
        if (hit) {
          if (!cancelled) {
            setExpandedId(numericId);
            hydrateDetail(numericId);
          }
        } else {
          const fresh = await apiFetch<CourtEvent>(`/court/events/${numericId}`);
          if (cancelled) return;
          if (fresh && fresh.id != null) {
            // Prepend so the operator sees it without a scroll hunt.
            setEvents(prev => [fresh, ...prev.filter(e => e.id !== fresh.id)]);
            setExpandedId(numericId);
            setHydratedDetail(fresh);
          } else {
            addToast(`Court event ${numericId} not found`, 'warning');
          }
        }
      } catch {
        if (!cancelled) addToast(`Failed to load court event ${numericId}`, 'error');
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('event_id');
          next.delete('court_event_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, loading]);

  // ── Filter-active sentinel ──
  const hasFiltersActive = useMemo(
    () => Boolean(statusFilter || typeFilter || dateFrom || dateTo || searchTerm),
    [statusFilter, typeFilter, dateFrom, dateTo, searchTerm]
  );
  const clearFilters = useCallback(() => {
    setStatusFilter('');
    setTypeFilter('');
    setDateFrom('');
    setDateTo('');
    setSearchTerm('');
    setSearchInput('');
  }, []);

  // ── Document title: reflect the expanded event so a tab switcher
  // can tell two court-record panels apart ──
  useEffect(() => {
    const expanded = events.find(e => e.id === expandedId);
    const tag = expanded?.event_number
      ? `${expanded.event_number} — Court Records`
      : 'Court Records — RMPG Flex';
    document.title = tag;
  }, [expandedId, events]);

  // ── Keyboard shortcuts ──
  //   Esc — smart-cascade: dismiss highest-priority open layer first
  //         (outcome confirm → outcome modal → create modal → expanded
  //          row → error banner → filters). Each branch returns so a
  //          single Esc doesn't collapse multiple layers.
  //   N   — open New Event modal (matches the Trespass / Field Interview /
  //         Equipment / Notifications / Arrests muscle memory).
  // Typing-suppressed for both.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showOutcomeConfirm) { setShowOutcomeConfirm(false); return; }
        if (showOutcomeModal !== null) { setShowOutcomeModal(null); return; }
        if (showCreateModal) { setShowCreateModal(false); return; }
        if (expandedId !== null) { setExpandedId(null); setHydratedDetail(null); return; }
        if (error) { setError(null); return; }
        if (hasFiltersActive) { clearFilters(); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (showCreateModal || showOutcomeModal !== null || showOutcomeConfirm) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setShowCreateModal(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showOutcomeConfirm, showOutcomeModal, showCreateModal, expandedId, error, hasFiltersActive, clearFilters]);

  return (
    <div className="app-grid-bg h-full flex flex-col overflow-hidden">
      {/* ── Header Panel ── */}
      <PanelTitleBar title="COURT RECORDS" icon={Gavel} statusLed="green" ledPulse>
        <button type="button"
          onClick={() => setShowCreateModal(true)}
          className="toolbar-btn toolbar-btn-primary text-[10px]"
          title="New Court Event (N)"
        >
          <Plus className="w-3 h-3" /> New Event
        </button>
        <button
          type="button"
          className="toolbar-btn text-[10px]"
          disabled={events.length === 0}
          onClick={() => downloadTextFile('court-docket.csv', courtDocketToCsv(events))}
          title="CSV of docket number, type, court — no defendant names"
        >CSV</button>
      </PanelTitleBar>

      {/* ── Filters Bar ── */}
      <div className="card-glass mx-2 mt-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-[280px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
            <input id="ff-courtrecordspage-0"
              type="text"
              placeholder="Search docket #, defendant, court..." aria-label="Search docket, defendant, court"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onBlur={() => setSearchTerm(searchInput)}
              className="w-full pl-7 pr-2 py-1 bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
            />
          </div>

          {/* Status filter */}
          <select id="ff-courtrecordspage-1"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
            aria-label="Filter by status"
          >
            <option value="">All Statuses</option>
            {STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {/* Type filter */}
          <select id="ff-courtrecordspage-2"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
            aria-label="Filter by event type"
          >
            <option value="">All Types</option>
            {EVENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {/* Date range */}
          <div className="flex items-center gap-1">
            <input id="ff-courtrecordspage-3"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
              aria-label="From date"
            />
            <span className="text-[9px] text-rmpg-500">to</span>
            <input id="ff-courtrecordspage-4"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
              aria-label="To date"
            />
          </div>

          {/* Clear filters */}
          {hasFiltersActive && (
            <button type="button"
              onClick={clearFilters}
              className="toolbar-btn text-[9px] text-rmpg-400 hover:text-rmpg-100"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}

          {/* Result count */}
          <span className="ml-auto text-[9px] text-rmpg-500 font-mono">
            {pagination.total} record{pagination.total !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="mx-2 mt-1 px-3 py-1.5 bg-red-900/30 border border-red-700/50 text-red-400 text-[10px] flex items-center gap-2">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          {error}
          <button type="button" onClick={() => void fetchEvents(pagination.page)} className="ml-auto text-red-300 hover:text-red-100" aria-label="Retry">
            Retry
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent mx-2 mt-2 mb-2 card-glass">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-rmpg-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading court records...
          </div>
        ) : events.length === 0 ? (
          /* Empty-state distinction — collapsing "no records" and "filters
             hiding everything" into one ambiguous string was the audit's
             most common UX find. Filter-empty state shows the unfiltered
             total + Clear button; no-data state shows the create CTA + N hint. */
          hasFiltersActive ? (
            <EmptyState
              icon={Search}
              title="No Records Match These Filters"
              description={`No court events match the current filters. Total records: ${pagination.total === 0 ? 'unknown' : pagination.total}.`}
              action={{ label: 'Clear Filters', onClick: clearFilters }}
            />
          ) : (
            <EmptyState
              icon={Gavel}
              title="No Court Records Yet"
              description="No court events have been recorded. Press N or click New Event to create the first."
              action={{ label: 'Create Court Event', onClick: () => setShowCreateModal(true) }}
            />
          )
        ) : (
          <>
            {/* Table header */}
            <div className="sticky top-0 z-10 grid grid-cols-[100px_1fr_110px_130px_120px_90px_1fr] gap-px bg-surface-sunken border-b border-rmpg-700 text-[9px] font-bold text-rmpg-400 uppercase tracking-widest">
              <div className="px-2 py-1.5 bg-surface-base">Event #</div>
              <div className="px-2 py-1.5 bg-surface-base">Defendant</div>
              <div className="px-2 py-1.5 bg-surface-base">Court Date</div>
              <div className="px-2 py-1.5 bg-surface-base">Event Type</div>
              <div className="px-2 py-1.5 bg-surface-base">Judge</div>
              <div className="px-2 py-1.5 bg-surface-base">Status</div>
              <div className="px-2 py-1.5 bg-surface-base">Court / Case #</div>
            </div>

            {/* Table rows */}
            {events.map(ev => {
              const isExpanded = expandedId === ev.id;
              const StatusIcon = STATUS_ICONS[ev.status] || Clock;
              const displayName = ev.defendant_full_name || ev.defendant_name || '--';

              return (
                <React.Fragment key={ev.id}>
                  {/* Row */}
                  <div
                    onClick={() => toggleExpand(ev.id)}
                    onContextMenu={(e) => openMenu(e, buildEventMenu(ev))}
                    className={`grid grid-cols-[100px_1fr_110px_130px_120px_90px_1fr] gap-px cursor-pointer transition-colors border-b border-rmpg-700/50 ${
                      isExpanded ? 'bg-surface-raised' : 'bg-surface-base hover:bg-surface-raised/60'
                    }`}
                  >
                    <div className="px-2 py-1.5 text-[10px] font-mono text-brand-blue truncate flex items-center gap-1">
                      <ChevronDown className={`w-3 h-3 text-rmpg-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                      {ev.event_number}
                    </div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-100 truncate">{displayName}</div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 font-mono">
                      {ev.event_date ? formatDate(ev.event_date) : '--'}
                      {ev.event_time && <span className="text-rmpg-500 ml-1">{ev.event_time}</span>}
                    </div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 truncate">{eventTypeLabel(ev.event_type)}</div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-300 truncate">{ev.judge_name || '--'}</div>
                    <div className="px-2 py-1.5">
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${STATUS_COLORS[ev.status] || 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'}`}>
                        <StatusIcon className="w-2.5 h-2.5" />
                        {ev.status?.toUpperCase()}
                      </span>
                    </div>
                    <div className="px-2 py-1.5 text-[10px] text-rmpg-400 truncate">
                      {ev.court_name || '--'}
                      {ev.court_case_number && <span className="text-rmpg-500 ml-1">({ev.court_case_number})</span>}
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="bg-surface-sunken border-b border-rmpg-700 px-4 py-3 animate-fadeIn">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Column 1: Event Details */}
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-bold text-brand-gold-500 uppercase tracking-widest flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> Event Details
                          </h4>
                          <div className="space-y-1 text-[10px]">
                            <DetailRow label="Event #" value={ev.event_number} mono />
                            <DetailRow label="Type" value={eventTypeLabel(ev.event_type)} />
                            <DetailRow label="Date" value={ev.event_date ? formatDate(ev.event_date) : null} />
                            <DetailRow label="Time" value={ev.event_time} />
                            <DetailRow label="Court" value={ev.court_name} />
                            <DetailRow label="Courtroom" value={ev.courtroom} />
                            <DetailRow label="Judge" value={ev.judge_name} />
                            <DetailRow label="Case #" value={ev.court_case_number} mono />
                            <DetailRow label="Status" value={ev.status?.toUpperCase()} />
                          </div>
                        </div>

                        {/* Column 2: Parties & References */}
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-bold text-brand-gold-500 uppercase tracking-widest flex items-center gap-1">
                            <User className="w-3 h-3" /> Parties & References
                          </h4>
                          <div className="space-y-1 text-[10px]">
                            <DetailRow label="Defendant" value={displayName} />
                            <DetailRow label="Prosecutor" value={typeof ev.prosecutor === 'string' ? ev.prosecutor : null} />
                            <DetailRow label="Defense Atty" value={ev.defense_attorney} />
                            {ev.incident_id && <DetailRow label="Incident ID" value={`#${ev.incident_id}`} mono />}
                            {ev.case_id && <DetailRow label="Case ID" value={`#${ev.case_id}`} mono />}
                            {ev.citation_id && <DetailRow label="Citation ID" value={`#${ev.citation_id}`} mono />}
                          </div>

                          {/* Outcome section */}
                          {ev.outcome && (
                            <div className="mt-3 pt-2 border-t border-rmpg-700">
                              <h4 className="text-[10px] font-bold text-brand-gold-500 uppercase tracking-widest flex items-center gap-1 mb-1">
                                <Scale className="w-3 h-3" /> Outcome
                              </h4>
                              <div className="space-y-1 text-[10px]">
                                <DetailRow label="Outcome" value={toDisplayLabel(ev.outcome).toUpperCase()} />
                                <DetailRow label="Sentence" value={ev.sentence} />
                                {ev.fine_amount != null && (
                                  <DetailRow label="Fine" value={`$${Number(ev.fine_amount).toFixed(2)}`} mono />
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Column 3: Notes & Actions */}
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-bold text-brand-gold-500 uppercase tracking-widest flex items-center gap-1">
                            <FileText className="w-3 h-3" /> Notes
                          </h4>
                          {ev.notes ? (
                            <p className="text-[10px] text-rmpg-300 bg-surface-base border border-rmpg-700 p-2 whitespace-pre-wrap max-h-32 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
                              {ev.notes}
                            </p>
                          ) : (
                            <p className="text-[10px] text-rmpg-500 italic">No notes recorded</p>
                          )}

                          <div className="text-[9px] text-rmpg-500 space-y-0.5 mt-2">
                            <div>Created: {formatDateTime(ev.created_at)}</div>
                            <div>Updated: {formatDateTime(ev.updated_at)}</div>
                          </div>

                          {/* Action buttons — court-ready PDF, cross-link, outcome */}
                          <div className="flex flex-wrap items-center gap-1 mt-2">
                            <button type="button"
                              onClick={e => { e.stopPropagation(); printPdf(ev); }}
                              className="toolbar-btn text-[9px]"
                              title="Print court-ready PDF"
                            >
                              <Printer className="w-3 h-3" /> Court PDF
                            </button>
                            <button type="button"
                              onClick={e => { e.stopPropagation(); openCourtTrackerForEvent(ev); }}
                              className="toolbar-btn text-[9px]"
                              title="Open this event in the Court Tracker (upcoming dates view)"
                            >
                              <CalendarClock className="w-3 h-3" /> Tracker
                            </button>
                            {ev.case_id && (
                              <button type="button"
                                onClick={e => { e.stopPropagation(); openCaseForEvent(ev); }}
                                className="toolbar-btn text-[9px]"
                                title="Open linked case"
                              >
                                <ExternalLink className="w-3 h-3" /> Case #{ev.case_id}
                              </button>
                            )}
                            {ev.status === 'scheduled' && !ev.outcome && (
                              <button type="button"
                                onClick={e => { e.stopPropagation(); setOutcomeData({ outcome: '', sentence: '', fine_amount: '', notes: ev.notes || '' }); setShowOutcomeModal(ev.id); }}
                                className="toolbar-btn toolbar-btn-primary text-[9px]"
                              >
                                <Scale className="w-3 h-3" /> Record Outcome
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      {/* ── Pagination ── */}
      {pagination.totalPages > 1 && (
        <div className="mx-2 mb-2 card-glass px-3 py-1.5 flex items-center justify-between">
          <button type="button"
            onClick={() => fetchEvents(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="toolbar-btn text-[9px] disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-3 h-3" /> Previous
          </button>
          <span className="text-[9px] text-rmpg-400 font-mono">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <button type="button"
            onClick={() => fetchEvents(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="toolbar-btn text-[9px] disabled:opacity-30"
            aria-label="Next page"
          >
            Next <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Create Court Event Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="New Court Event" onClick={() => setShowCreateModal(false)}>
          <div
            className="bg-surface-base border border-rmpg-700 w-full max-w-lg mx-4 shadow-md animate-fadeIn"
            onClick={e => e.stopPropagation()}
          >
            <PanelTitleBar title="NEW COURT EVENT" icon={Plus}>
              <button type="button" onClick={() => setShowCreateModal(false)} className="toolbar-btn text-[10px]" aria-label="Close">
                <X className="w-3 h-3" />
              </button>
            </PanelTitleBar>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
              {/* Event type + date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-courtrecordspage-5" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Event Type *</label>
                  <select id="ff-courtrecordspage-5"
                    value={formData.event_type}
                    onChange={e => setFormData(p => ({ ...p, event_type: e.target.value }))}
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  >
                    <option value="">Select type...</option>
                    {EVENT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-courtrecordspage-6" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Event Date *</label>
                  <input id="ff-courtrecordspage-6"
                    type="date"
                    value={formData.event_date}
                    onChange={e => setFormData(p => ({ ...p, event_date: e.target.value }))}
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
              </div>

              {/* Time + courtroom */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-courtrecordspage-7" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Event Time</label>
                  <input id="ff-courtrecordspage-7"
                    type="time"
                    value={formData.event_time}
                    onChange={e => setFormData(p => ({ ...p, event_time: e.target.value }))}
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="ff-courtrecordspage-8" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Courtroom</label>
                  <input id="ff-courtrecordspage-8"
                    type="text"
                    value={formData.courtroom}
                    onChange={e => setFormData(p => ({ ...p, courtroom: e.target.value }))}
                    placeholder="e.g., Room 304"
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
              </div>

              {/* Court name + judge */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-courtrecordspage-9" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Court Name</label>
                  <input id="ff-courtrecordspage-9"
                    type="text"
                    value={formData.court_name}
                    onChange={e => setFormData(p => ({ ...p, court_name: e.target.value }))}
                    placeholder="e.g., 3rd District Court"
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="ff-courtrecordspage-10" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Judge</label>
                  <input id="ff-courtrecordspage-10"
                    type="text"
                    value={formData.judge_name}
                    onChange={e => setFormData(p => ({ ...p, judge_name: e.target.value }))}
                    placeholder="Judge name"
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
              </div>

              {/* Case # + defendant */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-courtrecordspage-11" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Court Case #</label>
                  <input id="ff-courtrecordspage-11"
                    type="text"
                    value={formData.court_case_number}
                    onChange={e => setFormData(p => ({ ...p, court_case_number: e.target.value }))}
                    placeholder="Case number"
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="ff-courtrecordspage-12" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Defendant Name</label>
                  <input id="ff-courtrecordspage-12"
                    type="text"
                    value={formData.defendant_name}
                    onChange={e => setFormData(p => ({ ...p, defendant_name: e.target.value }))}
                    placeholder="Defendant name"
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
              </div>

              {/* Prosecutor + defense attorney */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-courtrecordspage-13" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Prosecutor</label>
                  <input id="ff-courtrecordspage-13"
                    type="text"
                    value={formData.prosecutor}
                    onChange={e => setFormData(p => ({ ...p, prosecutor: e.target.value }))}
                    placeholder="Prosecutor name"
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="ff-courtrecordspage-14" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Defense Attorney</label>
                  <input id="ff-courtrecordspage-14"
                    type="text"
                    value={formData.defense_attorney}
                    onChange={e => setFormData(p => ({ ...p, defense_attorney: e.target.value }))}
                    placeholder="Defense attorney name"
                    className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Notes</label>
                <RichTextArea
                  value={formData.notes}
                  onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  placeholder="Additional notes..."
                  className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none resize-none"
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setShowCreateModal(false)} className="toolbar-btn text-[10px]">Cancel</button>
                <button type="button"
                  onClick={handleCreate}
                  disabled={!formData.event_type || !formData.event_date || saving}
                  className="toolbar-btn toolbar-btn-primary text-[10px] disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Plus className="w-3 h-3" />}
                  Create Event
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Outcome Modal ── */}
      {showOutcomeModal !== null && (
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Record Outcome" onClick={() => setShowOutcomeModal(null)}>
          <div
            className="bg-surface-base border border-rmpg-700 w-full max-w-md mx-4 shadow-md animate-fadeIn my-auto"
            onClick={e => e.stopPropagation()}
          >
            <PanelTitleBar title="RECORD OUTCOME" icon={Scale}>
              <button type="button" onClick={() => setShowOutcomeModal(null)} className="toolbar-btn text-[10px]" aria-label="Close">
                <X className="w-3 h-3" />
              </button>
            </PanelTitleBar>

            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-courtrecordspage-15" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Outcome *</label>
                <select id="ff-courtrecordspage-15"
                  value={outcomeData.outcome}
                  onChange={e => setOutcomeData(p => ({ ...p, outcome: e.target.value }))}
                  className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                >
                  <option value="">Select outcome...</option>
                  {OUTCOMES.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ff-courtrecordspage-16" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Sentence</label>
                <input id="ff-courtrecordspage-16"
                  type="text"
                  value={outcomeData.sentence}
                  onChange={e => setOutcomeData(p => ({ ...p, sentence: e.target.value }))}
                  placeholder="e.g., 30 days jail, 1 year probation"
                  className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="ff-courtrecordspage-17" className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Fine Amount ($)</label>
                <input id="ff-courtrecordspage-17"
                  type="number"
                  step="0.01"
                  value={outcomeData.fine_amount}
                  onChange={e => setOutcomeData(p => ({ ...p, fine_amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[9px] text-rmpg-400 font-bold uppercase mb-0.5">Notes</label>
                <RichTextArea
                  value={outcomeData.notes}
                  onChange={e => setOutcomeData(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  placeholder="Additional outcome notes..."
                  className="w-full bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-100 px-2 py-1.5 placeholder-rmpg-500 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/30 focus:outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setShowOutcomeModal(null)} className="toolbar-btn text-[10px]">Cancel</button>
                <button type="button"
                  onClick={() => setShowOutcomeConfirm(true)}
                  disabled={!outcomeData.outcome || saving}
                  className="toolbar-btn toolbar-btn-primary text-[10px] disabled:opacity-40"
                >
                  <CheckCircle className="w-3 h-3" />
                  Save Outcome
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Outcome confirmation — recording an outcome legally closes the
          docket entry and writes status='completed' on the row; the previous
          "Save Outcome" was a single-click submit. ConfirmDialog gives the
          operator a chance to verify the parties + selection before commit. */}
      <ConfirmDialog
        isOpen={showOutcomeConfirm && showOutcomeModal !== null}
        onClose={() => setShowOutcomeConfirm(false)}
        onConfirm={handleOutcome}
        title="Record Court Outcome"
        message="Recording this outcome will close the docket entry. This action is logged and cannot be silently reversed. Confirm the entries below before saving."
        details={(() => {
          if (showOutcomeModal === null) return null;
          const ev = events.find(e => e.id === showOutcomeModal);
          if (!ev) return null;
          const outcomeLabel = OUTCOMES.find(o => o.value === outcomeData.outcome)?.label || outcomeData.outcome;
          return (
            <div className="space-y-0.5">
              <div><span className="text-rmpg-500">Event #:</span> <span className="font-mono text-rmpg-200">{ev.event_number}</span></div>
              <div><span className="text-rmpg-500">Defendant:</span> <span className="font-bold text-rmpg-100">{ev.defendant_full_name || ev.defendant_name || '—'}</span></div>
              {ev.court_case_number && (
                <div><span className="text-rmpg-500">Case #:</span> <span className="font-mono text-rmpg-200">{ev.court_case_number}</span></div>
              )}
              <div><span className="text-rmpg-500">Outcome:</span> <span className="font-bold text-rmpg-100">{outcomeLabel}</span></div>
              {outcomeData.sentence && (
                <div><span className="text-rmpg-500">Sentence:</span> <span className="text-rmpg-200">{outcomeData.sentence}</span></div>
              )}
              {outcomeData.fine_amount && (
                <div><span className="text-rmpg-500">Fine:</span> <span className="font-mono text-rmpg-200">${Number(outcomeData.fine_amount).toFixed(2)}</span></div>
              )}
            </div>
          );
        })()}
        confirmLabel="Record Outcome"
        cancelLabel="Cancel"
        confirmVariant="warning"
        isLoading={saving}
      />
    </div>
  );
}

// ============================================================
// Detail Row Helper
// ============================================================

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-rmpg-500 w-20 flex-shrink-0">{label}:</span>
      <span className={`text-rmpg-100 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
