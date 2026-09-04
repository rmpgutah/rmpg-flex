// ============================================================
// Use of Force Reports — court / IA / state-DOJ workspace.
// Page 44 of the full-app frontend pass. UoF is among the
// highest-stakes records in the system: court-admissible,
// IA-reviewable, and Utah-POST state-DOJ-reportable.
//
// What this page now does (audited in v1127):
//   • Deep-links — ?uof_id= jumps to a specific report (with a
//     /:id direct-fetch fallback when it's outside the current
//     page slice); ?incident_id= + ?subject_id= pre-filter the
//     list to that incident / person and pre-fill the form when
//     the operator opens "New".
//   • Court-ready PDF — useOfForceReportPdf with linked BWC +
//     dashcam clips (fetched from /:id/footage which joins
//     footage_evidence_links populated by autoPreserve).
//   • Esc smart-cascade — closes the create modal → review
//     confirm dialog → clears the deep-link → clears the
//     selection (and ignores typing surfaces).
//   • N shortcut — opens the New Report modal from anywhere
//     on the page that isn't a typing surface.
//   • Per-user form draft — survives accidental navigation /
//     refresh via useFormDraft (24h TTL).
//   • ConfirmDialog — Approve / Return route through the
//     shared dialog instead of an immediate mutation, so the
//     supervisor can add notes and back out.
//   • Theme tokens — STATUS_COLORS now resolve to CSS
//     variables that re-theme between night and day.
//   • Empty-state distinction — loading vs error vs zero-rows
//     each render their own surface.
//
// Server contract:
//   GET    /use-of-force?page&per_page&status&search    list+pagination
//   GET    /use-of-force/stats                          counters
//   GET    /use-of-force/:id                            single (deep-link)
//   GET    /use-of-force/:id/footage                    {flexcam,bodycam}
//   POST   /use-of-force                                create
//   PUT    /use-of-force/:id/review                     supervisor decision
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Shield, Plus, Search, Loader2, CheckCircle, XCircle, Eye, Printer, FileText, Video, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router';
import PanelTitleBar from '../components/PanelTitleBar';
import SplitPanel from '../components/SplitPanel';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { toDisplayLabel, formatLabel } from '../utils/formatters';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useToast } from '../components/ToastProvider';
import useFormDraft from '../hooks/useFormDraft';

import RichTextArea from '../components/RichTextArea';
import PersonPicker from '../components/PersonPicker';
import IncidentPickerInline from '../components/IncidentPickerInline';
import { openUseOfForceReportPdf,
  type LinkedFootageEntry,
  type UofReportForPdf,
} from '../utils/useOfForceReportPdf';
import { useSlashFocus } from '../hooks/useSlashFocus';
import { uofReportsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface UofReport {
  id: number; incident_id?: number; officer_id: number; subject_person_id?: number;
  force_type: string; force_level?: string; justification?: string;
  subject_injuries?: string; officer_injuries?: string;
  de_escalation_attempted: number; de_escalation_details?: string;
  weapons_used?: string; body_camera_active: number; witness_officers?: string;
  status: string; reviewed_by?: number; reviewed_at?: string; narrative?: string;
  review_notes?: string;
  created_at: string; updated_at: string;
  officer_name?: string; officer_badge?: string;
  subject_first_name?: string; subject_last_name?: string; subject_dob?: string;
  incident_number?: string; incident_type?: string; reviewer_name?: string;
}

interface Stats { total: number; pending_review: number; reviewed: number; this_month: number; by_type: any[]; by_level: any[]; }

interface FootageBundle {
  flexcam: Array<{
    id: number; title?: string | null; classification?: string | null; status?: string | null;
    evidence_locked?: number | null; evidence_number?: string | null;
    from_ts?: number | null; to_ts?: number | null; reason?: string | null; created_at?: string;
  }>;
  bodycam: Array<{
    id: number; title?: string | null; classification?: string | null; retention_status?: string | null;
    recorded_at?: string | null; duration_seconds?: number | null; file_size?: number | null;
    officer_name?: string | null; case_number?: string | null; created_at?: string;
  }>;
}

const FORCE_TYPES = ['verbal_command', 'physical_control', 'takedown', 'restraint', 'oc_spray', 'taser', 'baton', 'k9', 'less_lethal', 'firearm', 'vehicle', 'other'];
const FORCE_LEVELS = ['Level 1 - Cooperative', 'Level 2 - Resistive', 'Level 3 - Assaultive', 'Level 4 - Life Threatening'];

// Role gates — separate from isSuper (supervisor review).
// Officers file UoF reports; only admin/manager may purge records.
const CAN_CREATE_ROLES = new Set(['admin', 'manager', 'supervisor', 'officer']);
const CAN_DELETE_ROLES = new Set(['admin', 'manager']);

// Status colour tokens — CSS variables so the chip re-themes between
// night (steel-blue) and day (light-grey). Pre-v1061 these were hard
// hex (var(--text-secondary) / var(--sev-ok) / var(--sev-warn)), which broke the day theme.
// Resolves via Tailwind's text-* / bg-* utilities at runtime.
type StatusTone = 'neutral' | 'warning' | 'success';
const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  submitted: 'warning',
  reviewed: 'success',
  returned: 'warning',
};
const TONE_CLASSES: Record<StatusTone, { swatch: string; text: string; border: string }> = {
  neutral: { swatch: 'bg-rmpg-500', text: 'text-rmpg-300', border: 'border-rmpg-500/60' },
  warning: { swatch: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/60' },
  success: { swatch: 'bg-green-500', text: 'text-green-400', border: 'border-green-500/60' },
};
const toneFor = (status: string | undefined): StatusTone => STATUS_TONE[String(status || '').toLowerCase()] || 'neutral';

interface UofForm {
  incident_id: string;
  subject_person_id: string;
  force_type: string;
  force_level: string;
  justification: string;
  subject_injuries: string;
  officer_injuries: string;
  de_escalation_attempted: boolean;
  de_escalation_details: string;
  weapons_used: string;
  body_camera_active: boolean;
  witness_officers: string;
  narrative: string;
}

const EMPTY_FORM: UofForm = {
  incident_id: '', subject_person_id: '', force_type: '', force_level: '',
  justification: '', subject_injuries: '', officer_injuries: '',
  de_escalation_attempted: false, de_escalation_details: '',
  weapons_used: '', body_camera_active: true, witness_officers: '',
  narrative: '',
};

export default function UseOfForcePage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [reports, setReports] = useState<UofReport[]>([]);
  const [selected, setSelected] = useState<UofReport | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [footage, setFootage] = useState<FootageBundle | null>(null);
  const [footageLoading, setFootageLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterIncidentId, setFilterIncidentId] = useState<string>('');
  const [filterSubjectId, setFilterSubjectId] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewDialog, setReviewDialog] = useState<{ report: UofReport; decision: 'approved' | 'returned' } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UofReport | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const isSuper = ['admin', 'manager', 'supervisor'].includes((user as any)?.role || '');
  const canCreate = CAN_CREATE_ROLES.has((user as any)?.role ?? '');
  const canDelete = CAN_DELETE_ROLES.has((user as any)?.role ?? '');

  // ── Per-user form draft (24h TTL, scoped to the operator) ──
  // UoF reports are long-form — losing a tab mid-narrative was a real
  // operator complaint. Key is per-user so two officers sharing a
  // workstation don't see each other's draft.
  const draftKey = `rmpg_uof_form_${(user as any)?.id ?? 'anon'}`;
  const {
    form,
    setForm,
    wasRestored: draftRestored,
    clearDraft,
    signalSaved,
  } = useFormDraft<UofForm>({
    storageKey: draftKey,
    defaultValue: EMPTY_FORM,
    isActive: showForm,
  });

  // ── URL deep-link contract ──────────────────────────────────────
  // Accepted on mount (all optional, all stripped after consumption):
  //   ?uof_id=<n>        Open this report. If it's not on the current
  //                      page slice, falls back to GET /use-of-force/:id
  //                      and shows a toast if 404. Always selects, never
  //                      blocks the list render.
  //   ?incident_id=<n>   Pre-fill the form's linked incident AND filter
  //                      the list to that incident's reports (server-
  //                      side via the `search` param — UoF doesn't have
  //                      an incident_id filter today, so we put the
  //                      incident number into search; falls back to the
  //                      raw id when no number is resolvable here).
  //   ?subject_id=<n>    Same pattern for subject_person_id — pre-fills
  //                      the form's subject picker AND records the id
  //                      so the operator can drill in from a person
  //                      record without re-picking.
  // Mirroring back into the URL is intentional for uof_id ONLY — the
  // filters can be heavy and a stale browser-history entry shouldn't
  // silently re-trigger them.
  const pendingUofIdRef = useRef<string | null>(searchParams.get('uof_id'));
  const initialIncidentId = searchParams.get('incident_id') || '';
  const initialSubjectId = searchParams.get('subject_id') || '';

  // Consume deep-link query params on mount — keep them for first paint
  // so initial filter state resolves, then strip so refresh doesn't
  // re-apply over operator edits.
  useEffect(() => {
    if (initialIncidentId) setFilterIncidentId(initialIncidentId);
    if (initialSubjectId) setFilterSubjectId(initialSubjectId);
    // Pre-fill the form scaffolding so opening "New" lands on the
    // pre-deep-linked entities. We only set non-empty fields so we
    // don't blow away a restored draft.
    if (initialIncidentId || initialSubjectId) {
      setForm((f) => ({
        ...f,
        incident_id: initialIncidentId || f.incident_id,
        subject_person_id: initialSubjectId || f.subject_person_id,
      }));
    }
    const consume = ['incident_id', 'subject_id'];
    let dirty = false;
    const next = new URLSearchParams(searchParams);
    for (const key of consume) {
      if (next.has(key)) { next.delete(key); dirty = true; }
    }
    if (dirty) setSearchParams(next, { replace: true });
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchReports = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: '50',
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(searchQuery ? { search: searchQuery } : {}),
      });
      const res = await apiFetch<{ data: UofReport[]; pagination: any }>(`/use-of-force?${params}`);
      let list = res.data || [];
      // Client-side narrowing for the two deep-link filters — the
      // server doesn't support either as a first-class query, so we
      // post-filter here. Both are pre-stripped from the URL so this
      // only fires when the operator landed via a deep-link.
      if (filterIncidentId) list = list.filter((r) => String(r.incident_id) === filterIncidentId);
      if (filterSubjectId) list = list.filter((r) => String(r.subject_person_id) === filterSubjectId);
      setReports(list);
      setTotalPages(res.pagination?.totalPages || 1);
    } catch (err: any) {
      setError(err?.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, searchQuery, filterIncidentId, filterSubjectId]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await apiFetch<Stats>('/use-of-force/stats');
      setStats(s);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { fetchReports(); fetchStats(); }, [fetchReports, fetchStats]);

  // ── Direct-fetch fallback for ?uof_id= deep-links ─────────────
  // If the target report is in the loaded slice we select it. Otherwise
  // we hit GET /:id and select that record without disturbing the list.
  useEffect(() => {
    const want = pendingUofIdRef.current;
    if (!want || loading) return;
    const wantNum = parseInt(want, 10);
    if (!Number.isFinite(wantNum)) { pendingUofIdRef.current = null; return; }
    const hit = reports.find((r) => r.id === wantNum);
    if (hit) {
      setSelected(hit);
      pendingUofIdRef.current = null;
      const next = new URLSearchParams(searchParams);
      next.delete('uof_id');
      setSearchParams(next, { replace: true });
      return;
    }
    if (reports.length === 0) return; // wait one more cycle
    // Not in slice — direct fetch.
    let cancelled = false;
    (async () => {
      try {
        const row = await apiFetch<UofReport>(`/use-of-force/${wantNum}`);
        if (cancelled) return;
        setSelected(row);
      } catch (e) {
        if ((e as { status?: number }).status === 404) {
          addToast(`UoF report #${wantNum} not found`, 'warning');
        } else {
          addToast(`Failed to load UoF #${wantNum}`, 'error');
        }
      } finally {
        if (!cancelled) {
          pendingUofIdRef.current = null;
          const next = new URLSearchParams(searchParams);
          next.delete('uof_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, loading]);

  // ── Hydrate linked footage when a report is selected ──────────
  // Best-effort — footage may not exist (UoF without BWC linkage, or
  // dashcam preserve still queued); the panel renders a "No footage
  // linked" stub rather than blanking out.
  useEffect(() => {
    if (!selected) { setFootage(null); return; }
    let cancelled = false;
    setFootageLoading(true);
    apiFetch<FootageBundle>(`/use-of-force/${selected.id}/footage`)
      .then((res) => { if (!cancelled) setFootage(res); })
      .catch(() => { if (!cancelled) setFootage({ flexcam: [], bodycam: [] }); })
      .finally(() => { if (!cancelled) setFootageLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  // ── Form submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.force_type) return;
    setSubmitting(true);
    try {
      const body = {
        ...form,
        incident_id: form.incident_id ? parseInt(form.incident_id, 10) : null,
        subject_person_id: form.subject_person_id ? parseInt(form.subject_person_id, 10) : null,
        witness_officers: form.witness_officers
          ? form.witness_officers.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
      };
      await apiFetch('/use-of-force', { method: 'POST', body: JSON.stringify(body) });
      signalSaved();           // clear draft from storage but don't blank state
      setShowForm(false);
      // Defer the reset so the modal close animation doesn't show empty fields.
      setTimeout(() => clearDraft(), 250);
      addToast('Report submitted', 'success');
      await fetchReports({ silent: true });
      fetchStats();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Supervisor review (routed through ConfirmDialog) ──
  const openReviewDialog = (decision: 'approved' | 'returned', report?: UofReport) => {
    const target = report || selected;
    if (!target) return;
    setReviewNotes('');
    setReviewDialog({ report: target, decision });
  };

  const confirmReview = async () => {
    if (!reviewDialog) return;
    setReviewBusy(true);
    try {
      await apiFetch(`/use-of-force/${reviewDialog.report.id}/review`, {
        method: 'PUT',
        body: JSON.stringify({ decision: reviewDialog.decision, notes: reviewNotes || undefined }),
      });
      addToast(
        reviewDialog.decision === 'approved' ? 'Report approved' : 'Report returned for revision',
        reviewDialog.decision === 'approved' ? 'success' : 'warning',
      );
      setReviewDialog(null);
      setReviewNotes('');
      await fetchReports({ silent: true });
      fetchStats();
      // Re-fetch the selected row so the panel shows the new status.
      if (selected?.id === reviewDialog.report.id) {
        try {
          const fresh = await apiFetch<UofReport>(`/use-of-force/${reviewDialog.report.id}`);
          setSelected(fresh);
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Review failed', 'error');
    } finally {
      setReviewBusy(false);
    }
  };

  // ── Delete report (admin/manager only) ──
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/use-of-force/${deleteTarget.id}`, { method: 'DELETE' });
      addToast(`UoF report #${deleteTarget.id} deleted`, 'success');
      if (selected?.id === deleteTarget.id) setSelected(null);
      setDeleteTarget(null);
      await fetchReports({ silent: true });
      fetchStats();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── PDF export ──
  // Court-ready Use-of-Force report with linked BWC + dashcam clips.
  // Footage is already in state if the operator opened the detail
  // panel; otherwise we fetch it on demand so a right-click "Print"
  // from the list still includes the linked clips.
  const printReport = useCallback(async (r: UofReport) => {
    let bundle = (selected?.id === r.id) ? footage : null;
    if (!bundle) {
      try {
        bundle = await apiFetch<FootageBundle>(`/use-of-force/${r.id}/footage`);
      } catch {
        bundle = { flexcam: [], bodycam: [] };
      }
    }
    const linked: LinkedFootageEntry[] = [
      ...(bundle?.bodycam ?? []).map((b) => ({
        kind: 'bwc' as const,
        id: b.id,
        title: b.title,
        recorded_at: b.recorded_at,
        duration_seconds: b.duration_seconds,
        classification: b.classification,
        evidence_locked: /hold|preserve|court|ia/i.test(String(b.retention_status || '')) ? 1 : 0,
        evidence_number: b.case_number,
      })),
      ...(bundle?.flexcam ?? []).map((f) => ({
        kind: 'dashcam' as const,
        id: f.id,
        title: f.title,
        recorded_at: f.created_at,
        duration_seconds: f.from_ts != null && f.to_ts != null ? Math.max(0, Math.round((f.to_ts - f.from_ts) / 1000)) : null,
        classification: f.classification,
        evidence_locked: f.evidence_locked ? 1 : 0,
        evidence_number: f.evidence_number,
      })),
    ];
    const reportShape: UofReportForPdf = { ...r };
    openUseOfForceReportPdf({
      report: reportShape,
      linkedFootage: linked,
      preparedBy: (user as any)?.full_name || (user as any)?.username || '',
    });
  }, [selected, footage, user]);

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const buildReportMenu = (r: UofReport): ContextMenuItem[] => {
    const officer = r.officer_name || '';
    const subject = [r.subject_first_name, r.subject_last_name].filter(Boolean).join(' ');
    return [
      m.action('Open report', () => setSelected(r), { icon: <Eye size={12} /> }),
      m.action('Print court-ready PDF', () => printReport(r), { icon: <Printer size={12} /> }),
      m.separator(),
      ...(officer ? [m.copy('Copy officer', officer)] : []),
      ...(subject ? [m.copy('Copy subject', subject)] : []),
      m.copyId(r.id),
      ...(isSuper && r.status === 'submitted' ? [
        m.separator(),
        m.action('Approve…', () => openReviewDialog('approved', r), { icon: <CheckCircle size={12} /> }),
        m.action('Return…', () => openReviewDialog('returned', r), { icon: <XCircle size={12} />, danger: true }),
      ] : []),
      ...(canDelete ? [
        m.separator(),
        m.action('Delete report…', () => setDeleteTarget(r), { icon: <Trash2 size={12} />, danger: true }),
      ] : []),
    ];
  };

  // ── Esc smart-cascade ──
  // Closes the newest dismissable surface first. Ignored while a typing
  // surface is focused — browsers already map Esc → blur there.
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTyping(e.target)) return;
      // 1) Create modal open
      if (showForm) { e.stopPropagation(); setShowForm(false); return; }
      // 2) Review confirm dialog open (ConfirmDialog handles its own Esc,
      //    but covering it here keeps the order explicit when nested).
      if (reviewDialog) { e.stopPropagation(); setReviewDialog(null); setReviewNotes(''); return; }
      // 3) Error banner
      if (error) { e.stopPropagation(); setError(''); return; }
      // 4) Detail panel selected
      if (selected) { e.stopPropagation(); setSelected(null); return; }
      // 5) Active filters
      if (filterStatus || searchQuery || filterIncidentId || filterSubjectId) {
        e.stopPropagation();
        setFilterStatus(''); setSearchQuery(''); setFilterIncidentId(''); setFilterSubjectId('');
        setPage(1);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showForm, reviewDialog, deleteTarget, error, selected, filterStatus, searchQuery, filterIncidentId, filterSubjectId]);

  // ── N shortcut: New Report ──
  // Mirrors Records / Citations / Incidents — pressing N anywhere
  // outside a typing surface opens the create modal. Skipped if a
  // dialog is already open so we don't stack modals.
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (showForm || reviewDialog || deleteTarget) return;
      if (!canCreate) return;
      e.preventDefault();
      setShowForm(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showForm, reviewDialog, deleteTarget, canCreate]);

  // Surface "draft restored" toast once.
  const restoredToastShown = useRef(false);
  useEffect(() => {
    if (draftRestored && showForm && !restoredToastShown.current) {
      restoredToastShown.current = true;
      addToast('Draft restored from your previous session', 'info');
    }
  }, [draftRestored, showForm, addToast]);

  const linkedFootageCount = useMemo(() => {
    if (!footage) return 0;
    return (footage.flexcam?.length || 0) + (footage.bodycam?.length || 0);
  }, [footage]);

  // ── List Panel ──────────────────────────────────────
  const listContent = (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      {stats && (
        <div className="flex gap-3 px-3 py-2 border-b border-rmpg-700 bg-surface-sunken">
          {[
            { label: 'Total', value: stats.total, tone: 'neutral' as StatusTone },
            { label: 'Pending', value: stats.pending_review, tone: 'warning' as StatusTone },
            { label: 'Reviewed', value: stats.reviewed, tone: 'success' as StatusTone },
            { label: 'This Month', value: stats.this_month, tone: 'neutral' as StatusTone },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className={`text-lg font-bold font-mono ${TONE_CLASSES[s.tone].text}`}>{s.value}</div>
              <div className="text-[8px] text-rmpg-500 uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Deep-link filter chips */}
      {(filterIncidentId || filterSubjectId) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-rmpg-700 bg-surface-sunken text-[10px]">
          <span className="text-rmpg-500 uppercase">Deep-link filter:</span>
          {filterIncidentId && (
            <span className="px-2 py-0.5 border border-brand-500/60 text-brand-400">
              Incident #{filterIncidentId}
              <button
                type="button"
                aria-label="Clear incident filter"
                className="ml-1.5 hover:text-rmpg-100"
                onClick={() => setFilterIncidentId('')}
              >×</button>
            </span>
          )}
          {filterSubjectId && (
            <span className="px-2 py-0.5 border border-brand-500/60 text-brand-400">
              Subject #{filterSubjectId}
              <button
                type="button"
                aria-label="Clear subject filter"
                className="ml-1.5 hover:text-rmpg-100"
                onClick={() => setFilterSubjectId('')}
              >×</button>
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 px-3 py-2 border-b border-rmpg-700">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            id="ff-useofforcepage-0"
            ref={searchRef}
            className="input-dark text-[10px] pl-7 w-full py-[3px]"
            placeholder="Search... (/)"
            aria-label="Search use-of-force reports"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
        <select
          id="ff-useofforcepage-1"
          className="input-dark text-[10px] py-[3px] w-24"
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
        >
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="reviewed">Reviewed</option>
          <option value="returned">Returned</option>
        </select>
        {canCreate && (
          <button
            type="button"
            className="toolbar-btn toolbar-btn-primary text-[9px]"
            onClick={() => setShowForm(true)}
            title="New report (N)"
            style={{ padding: '2px 8px' }}
          >
            <Plus className="w-3 h-3" /> New
          </button>
        )}
      </div>

      {/* List — three distinct empty states */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-rmpg-400" />
            <span className="ml-2 text-[10px] text-rmpg-500 uppercase">Loading reports…</span>
          </div>
        )}
        {!loading && error && (
          <EmptyState
            icon={Shield}
            title="Failed to load"
            description={error}
          />
        )}
        {!loading && !error && reports.length === 0 && (
          <EmptyState
            icon={Shield}
            title={(filterStatus || searchQuery || filterIncidentId || filterSubjectId) ? 'No matching reports' : 'No reports filed'}
            description={
              (filterStatus || searchQuery || filterIncidentId || filterSubjectId)
                ? 'Try clearing filters or widening the search.'
                : 'When officers file a use-of-force report it will appear here.'
            }
          />
        )}
        {!loading && !error && reports.map((r) => {
          const tone = TONE_CLASSES[toneFor(r.status)];
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(r)}
              onContextMenu={(e) => openMenu(e, buildReportMenu(r))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelected(r);
                }
              }}
              className={`px-3 py-2 border-b border-rmpg-800 cursor-pointer transition-colors ${selected?.id === r.id ? 'bg-surface-raised border-l-2 border-l-red-500' : 'hover:bg-surface-raised'}`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 flex-shrink-0 ${tone.swatch}`} style={{ borderRadius: '1px' }} />
                <span className="text-[10px] font-bold text-rmpg-100 uppercase">{toDisplayLabel(r.force_type || '')}</span>
                <span className="ml-auto text-[9px] text-rmpg-500">{formatDate(r.created_at)}</span>
              </div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">
                Officer: {r.officer_name || 'Unknown'} {r.force_level && `• ${r.force_level}`}
              </div>
              {r.subject_first_name && (
                <div className="text-[9px] text-rmpg-500">Subject: {r.subject_first_name} {r.subject_last_name}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 border-t border-rmpg-700 text-[9px] text-rmpg-400">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="toolbar-btn text-[9px]"
            style={{ padding: '1px 6px' }}
          >&larr;</button>
          <span>{page}/{totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="toolbar-btn text-[9px]"
            style={{ padding: '1px 6px' }}
          >&rarr;</button>
        </div>
      )}
    </div>
  );

  // ── Detail Panel ────────────────────────────────────
  const detailContent = selected ? (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 ${TONE_CLASSES[toneFor(selected.status)].swatch}`} style={{ borderRadius: '1px' }} />
        <h2 className="text-sm font-bold text-rmpg-100 uppercase">{toDisplayLabel(selected.force_type || '')} — UoF #{selected.id}</h2>
        <span className={`ml-auto text-[9px] font-bold uppercase px-2 py-0.5 border ${TONE_CLASSES[toneFor(selected.status)].text} ${TONE_CLASSES[toneFor(selected.status)].border}`}>
          {formatLabel(selected.status)}
        </span>
        <button
          type="button"
          className="toolbar-btn text-[9px]"
          onClick={() => printReport(selected)}
          title="Court-ready PDF"
          style={{ padding: '2px 8px' }}
        >
          <Printer className="w-3 h-3" /> PDF
        </button>
      </div>

      {/* Officer & Subject */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="text-[9px] text-rmpg-500 uppercase font-bold">Reporting Officer</div>
          <div className="text-xs text-rmpg-100">{selected.officer_name || 'Unknown'}</div>
          {selected.officer_badge && <div className="text-[9px] text-rmpg-400">Badge: {selected.officer_badge}</div>}
        </div>
        <div className="space-y-1">
          <div className="text-[9px] text-rmpg-500 uppercase font-bold">Subject</div>
          {selected.subject_first_name ? (
            <div className="text-xs text-rmpg-100">{selected.subject_first_name} {selected.subject_last_name}</div>
          ) : <div className="text-xs text-rmpg-400">Not linked</div>}
        </div>
      </div>

      {/* Force Details */}
      <div className="border border-rmpg-700 bg-surface-sunken p-3 space-y-2">
        <div className="text-[9px] text-red-400 uppercase font-bold">Force Details</div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><span className="text-rmpg-500 text-[9px]">Type:</span> <span className="text-rmpg-100 capitalize">{toDisplayLabel(selected.force_type || '')}</span></div>
          <div><span className="text-rmpg-500 text-[9px]">Level:</span> <span className="text-rmpg-100">{selected.force_level || '—'}</span></div>
          <div><span className="text-rmpg-500 text-[9px]">Weapons Used:</span> <span className="text-rmpg-100">{selected.weapons_used || 'None'}</span></div>
          <div><span className="text-rmpg-500 text-[9px]">Body Camera:</span> <span className={selected.body_camera_active ? 'text-green-400' : 'text-red-400'}>{selected.body_camera_active ? 'Active' : 'Inactive'}</span></div>
          <div><span className="text-rmpg-500 text-[9px]">De-escalation:</span> <span className={selected.de_escalation_attempted ? 'text-green-400' : 'text-amber-400'}>{selected.de_escalation_attempted ? 'Yes' : 'No'}</span></div>
          {selected.incident_number && <div><span className="text-rmpg-500 text-[9px]">Incident:</span> <span className="text-brand-400">{selected.incident_number}</span></div>}
        </div>
      </div>

      {/* Witness officers */}
      {selected.witness_officers && (
        <div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold mb-1">Witness Officers</div>
          <p className="text-xs text-rmpg-200">{
            // Stored as JSON array or comma-string; render either as a comma list.
            (() => {
              try {
                const arr = JSON.parse(selected.witness_officers);
                if (Array.isArray(arr)) return arr.join(', ') || '—';
              } catch { /* fall through */ }
              return selected.witness_officers;
            })()
          }</p>
        </div>
      )}

      {/* Injuries */}
      {(selected.subject_injuries || selected.officer_injuries) && (
        <div className="border border-red-700/30 bg-red-900/10 p-3 space-y-2">
          <div className="text-[9px] text-red-400 uppercase font-bold">Injuries — medical follow-up required</div>
          {selected.subject_injuries && <div className="text-xs"><span className="text-rmpg-400">Subject:</span> <span className="text-rmpg-100">{selected.subject_injuries}</span></div>}
          {selected.officer_injuries && <div className="text-xs"><span className="text-rmpg-400">Officer:</span> <span className="text-rmpg-100">{selected.officer_injuries}</span></div>}
        </div>
      )}

      {/* Justification */}
      {selected.justification && (
        <div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold mb-1">Justification</div>
          <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selected.justification}</p>
        </div>
      )}

      {/* De-escalation details */}
      {selected.de_escalation_attempted && selected.de_escalation_details && (
        <div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold mb-1">De-escalation Details</div>
          <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selected.de_escalation_details}</p>
        </div>
      )}

      {/* Narrative */}
      {selected.narrative && (
        <div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold mb-1">Narrative</div>
          <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selected.narrative}</p>
        </div>
      )}

      {/* Linked footage */}
      <div className="border border-rmpg-700 bg-surface-sunken p-3 space-y-2">
        <div className="text-[9px] text-brand-400 uppercase font-bold flex items-center gap-1">
          <Video className="w-3 h-3" /> Linked Footage {linkedFootageCount > 0 && `(${linkedFootageCount})`}
        </div>
        {footageLoading && (
          <div className="text-xs text-rmpg-400 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Resolving BWC + dashcam links…
          </div>
        )}
        {!footageLoading && linkedFootageCount === 0 && (
          <div className="text-xs text-rmpg-500 italic">No footage linked to this report.</div>
        )}
        {!footageLoading && footage && footage.bodycam.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] text-rmpg-500 uppercase">Body-Worn Camera</div>
            {footage.bodycam.map((b) => (
              <div key={`bwc-${b.id}`} className="text-xs text-rmpg-200 flex items-center gap-2">
                <FileText className="w-3 h-3 text-rmpg-400" />
                <span>BWC-{b.id}{b.title ? ` — ${b.title}` : ''}</span>
                {b.recorded_at && <span className="text-[9px] text-rmpg-500">{formatDateTime(b.recorded_at)}</span>}
              </div>
            ))}
          </div>
        )}
        {!footageLoading && footage && footage.flexcam.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] text-rmpg-500 uppercase">Dashcam (FlexCam)</div>
            {footage.flexcam.map((f) => (
              <div key={`fc-${f.id}`} className="text-xs text-rmpg-200 flex items-center gap-2">
                <Video className="w-3 h-3 text-rmpg-400" />
                <span>FC-{f.id}{f.title ? ` — ${f.title}` : ''}</span>
                {f.evidence_locked ? <span className="text-[9px] text-amber-400 uppercase">Locked</span> : null}
                {f.evidence_number && <span className="text-[9px] text-rmpg-500">{f.evidence_number}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review Section */}
      {selected.reviewed_by && (
        <div className="border border-green-700/30 bg-green-900/10 p-3 space-y-1">
          <div className="text-[9px] text-green-400 uppercase font-bold">Supervisor Review</div>
          <div className="text-xs text-rmpg-200">Reviewed by {selected.reviewer_name} on {formatDateTime(selected.reviewed_at || '')}</div>
          {selected.review_notes && (
            <div className="text-xs text-rmpg-300 italic whitespace-pre-wrap">"{selected.review_notes}"</div>
          )}
        </div>
      )}

      {/* Actions */}
      {(isSuper && selected.status === 'submitted') || canDelete ? (
        <div className="flex gap-2 pt-2 border-t border-rmpg-700">
          {isSuper && selected.status === 'submitted' && (
            <>
              <button
                type="button"
                className="toolbar-btn text-green-400 text-[9px]"
                onClick={() => openReviewDialog('approved')}
                style={{ padding: '4px 12px' }}
              >
                <CheckCircle className="w-3 h-3" /> Approve…
              </button>
              <button
                type="button"
                className="toolbar-btn text-amber-400 text-[9px]"
                onClick={() => openReviewDialog('returned')}
                style={{ padding: '4px 12px' }}
              >
                <XCircle className="w-3 h-3" /> Return…
              </button>
            </>
          )}
          {canDelete && (
            <button
              type="button"
              className="toolbar-btn text-red-400 text-[9px] ml-auto"
              onClick={() => setDeleteTarget(selected)}
              style={{ padding: '4px 12px' }}
              title="Permanently delete this report"
            >
              <Trash2 className="w-3 h-3" /> Delete…
            </button>
          )}
        </div>
      ) : null}

      <div className="text-[8px] text-rmpg-600 pt-2">Created: {formatDateTime(selected.created_at)} | Updated: {formatDateTime(selected.updated_at)}</div>
    </div>
  ) : (
    <EmptyState icon={Shield} title="Select a Report" description="Click a use of force report to view details" />
  );

  return (
    <div className="p-4 space-y-3 h-full flex flex-col">
      <PanelTitleBar title="USE OF FORCE REPORTS" icon={Shield}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={reports.length === 0}
          onClick={() => downloadTextFile('use-of-force.csv', uofReportsToCsv(reports.map((r) => ({
            id: r.id,
            incident_number: r.incident_number,
            force_type: r.force_type,
            force_level: r.force_level,
            status: r.status,
            created_at: r.created_at,
          }))))}
        >CSV</button>
      </PanelTitleBar>

      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {error}{' '}
          <button type="button" className="toolbar-btn ml-2" onClick={() => { void fetchReports(); }}>Retry</button>
          <button type="button" className="ml-2 underline" onClick={() => setError('')}>dismiss</button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <SplitPanel left={listContent} right={detailContent} />
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowForm(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl mx-4 shadow-md panel-beveled" style={{ background: 'var(--surface-sunken)' }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-title-bar">
              <div className="flex items-center gap-2">
                <Shield className="title-icon" />
                <span>NEW USE OF FORCE REPORT</span>
              </div>
            </div>
            {draftRestored && (
              <div className="px-5 py-1.5 bg-amber-900/20 border-b border-amber-700/40 text-[10px] text-amber-300">
                Draft from your previous session restored. <button type="button" className="underline ml-2" onClick={() => clearDraft()}>Discard</button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ff-useofforcepage-2" className="text-[10px] text-rmpg-400 uppercase font-semibold">Force Type <span className="text-red-400">*</span></label>
                  <select id="ff-useofforcepage-2" className="select-dark text-xs w-full mt-1" value={form.force_type} onChange={(e) => setForm((f) => ({ ...f, force_type: e.target.value }))} required>
                    <option value="">-- Select --</option>
                    {FORCE_TYPES.map((t) => <option key={t} value={t}>{toDisplayLabel(t).toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-useofforcepage-3" className="text-[10px] text-rmpg-400 uppercase font-semibold">Force Level</label>
                  <select id="ff-useofforcepage-3" className="select-dark text-xs w-full mt-1" value={form.force_level} onChange={(e) => setForm((f) => ({ ...f, force_level: e.target.value }))}>
                    <option value="">-- Select --</option>
                    {FORCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Linked Incident</label>
                  <IncidentPickerInline
                    id="ff-useofforcepage-4"
                    value={form.incident_id ? Number(form.incident_id) : null}
                    onChange={(id) => setForm((f) => ({ ...f, incident_id: id ? String(id) : '' }))}
                    placeholder="Optional — search incident # / type / location…"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Subject</label>
                  <PersonPicker
                    id="ff-useofforcepage-5"
                    value={form.subject_person_id ? Number(form.subject_person_id) : null}
                    onChange={(id) => setForm((f) => ({ ...f, subject_person_id: id ? String(id) : '' }))}
                    placeholder="Optional — search subject by name…"
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Justification</label>
                <RichTextArea className="input-dark text-xs w-full mt-1" rows={3} value={form.justification} onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))} placeholder="Legal justification for use of force..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ff-useofforcepage-6" className="text-[10px] text-rmpg-400 uppercase font-semibold">Subject Injuries</label>
                  <input id="ff-useofforcepage-6" className="input-dark text-xs w-full mt-1" value={form.subject_injuries} onChange={(e) => setForm((f) => ({ ...f, subject_injuries: e.target.value }))} placeholder="None, or describe" />
                </div>
                <div>
                  <label htmlFor="ff-useofforcepage-7" className="text-[10px] text-rmpg-400 uppercase font-semibold">Officer Injuries</label>
                  <input id="ff-useofforcepage-7" className="input-dark text-xs w-full mt-1" value={form.officer_injuries} onChange={(e) => setForm((f) => ({ ...f, officer_injuries: e.target.value }))} placeholder="None, or describe" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ff-useofforcepage-8" className="text-[10px] text-rmpg-400 uppercase font-semibold">Weapons Used</label>
                  <input id="ff-useofforcepage-8" className="input-dark text-xs w-full mt-1" value={form.weapons_used} onChange={(e) => setForm((f) => ({ ...f, weapons_used: e.target.value }))} placeholder="None, taser, firearm, etc." />
                </div>
                <div>
                  <label htmlFor="ff-useofforcepage-9" className="text-[10px] text-rmpg-400 uppercase font-semibold">Witness Officers</label>
                  <input id="ff-useofforcepage-9" className="input-dark text-xs w-full mt-1" value={form.witness_officers} onChange={(e) => setForm((f) => ({ ...f, witness_officers: e.target.value }))} placeholder="Comma-separated names" />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
                  <input id="ff-useofforcepage-10" type="checkbox" checked={form.de_escalation_attempted} onChange={(e) => setForm((f) => ({ ...f, de_escalation_attempted: e.target.checked }))} className="w-4 h-4" />
                  De-escalation Attempted
                </label>
                <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
                  <input id="ff-useofforcepage-11" type="checkbox" checked={form.body_camera_active} onChange={(e) => setForm((f) => ({ ...f, body_camera_active: e.target.checked }))} className="w-4 h-4" />
                  Body Camera Active
                </label>
              </div>
              {form.de_escalation_attempted && (
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">De-escalation Details</label>
                  <RichTextArea className="input-dark text-xs w-full mt-1" rows={2} value={form.de_escalation_details} onChange={(e) => setForm((f) => ({ ...f, de_escalation_details: e.target.value }))} />
                </div>
              )}
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Narrative</label>
                <RichTextArea className="input-dark text-xs w-full mt-1" rows={4} value={form.narrative} onChange={(e) => setForm((f) => ({ ...f, narrative: e.target.value }))} placeholder="Detailed account of the incident..." />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-rmpg-700">
                <button type="button" onClick={() => setShowForm(false)} className="toolbar-btn" style={{ padding: '4px 12px' }}>Cancel</button>
                <button type="submit" className="toolbar-btn toolbar-btn-primary" disabled={submitting || !form.force_type} style={{ padding: '4px 12px' }}>
                  {submitting && <Loader2 className="w-3 h-3 animate-spin" />} Submit Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supervisor review confirm */}
      <ConfirmDialog
        isOpen={reviewDialog != null}
        onClose={() => { setReviewDialog(null); setReviewNotes(''); }}
        onConfirm={confirmReview}
        title={reviewDialog?.decision === 'approved' ? 'Approve Use of Force Report' : 'Return for Revision'}
        message={
          reviewDialog?.decision === 'approved'
            ? 'Approving marks this report as reviewed and admissible. This action is logged to the audit trail and signed with your user id.'
            : 'Returning sends the report back to the officer for revision. Add a note explaining what needs to change.'
        }
        details={reviewDialog ? (
          <div className="space-y-2 mt-2">
            <div className="text-xs">
              UoF #{reviewDialog.report.id} — {toDisplayLabel(reviewDialog.report.force_type || '')}
              {reviewDialog.report.officer_name ? ` by ${reviewDialog.report.officer_name}` : ''}
            </div>
            <label className="block text-[10px] text-rmpg-400 uppercase font-semibold">
              Review Notes {reviewDialog.decision === 'returned' && <span className="text-amber-400">(recommended)</span>}
            </label>
            <textarea
              className="input-dark text-xs w-full"
              rows={3}
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder={reviewDialog.decision === 'approved' ? 'Optional — e.g. "Reviewed; force was within policy."' : 'Why is this being returned?'}
            />
          </div>
        ) : undefined}
        confirmLabel={reviewDialog?.decision === 'approved' ? 'Approve' : 'Return'}
        confirmVariant={reviewDialog?.decision === 'approved' ? 'default' : 'warning'}
        isLoading={reviewBusy}
      />

      {/* Delete report confirm (admin/manager only) */}
      <ConfirmDialog
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Use of Force Report"
        message="This permanently removes the report and all linked review records from the system. This action is irreversible and will be logged to the audit trail."
        details={deleteTarget ? (
          <div className="text-xs mt-2">
            UoF #{deleteTarget.id} — {toDisplayLabel(deleteTarget.force_type || '')}
            {deleteTarget.officer_name ? ` by ${deleteTarget.officer_name}` : ''}
          </div>
        ) : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteBusy}
      />
    </div>
  );
}
