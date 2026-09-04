// ============================================================
// RMPG Flex — Daily Activity Reports (DAR) Page
// ============================================================
// Structured shift reports with auto-populate from calls,
// incidents, citations, and patrol scans. Supports draft →
// submit → approve/return supervisor workflow.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { formatEnumValue } from '../utils/formatters';
import RichTextArea from '../components/RichTextArea';
import {
  ClipboardCheck, Search, Plus, User, X, Save, Loader2, CheckCircle,
  AlertTriangle, Send, RotateCcw, Zap, Calendar, RefreshCw, Eye, FileText,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { DailyActivityReport } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import ExportButton from '../components/ExportButton';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { apiFetch } from '../hooks/useApi';
import { parseTimestamp } from '../utils/dateUtils';
import { generateDarPdf } from '../utils/darPdf';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { darListToCsv, downloadTextFile } from '../utils/rmsListExport';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  submitted: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
  approved: 'bg-green-900/50 text-green-400 border-green-700/50',
  returned: 'bg-red-900/50 text-red-400 border-red-700/50',
  archived: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

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

export default function DailyActivityReportsPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  // canApprove: admin / manager / supervisor may approve or return submitted DARs.
  // canManage : admin-only unrestricted access (force-submit any status, override gates).
  const canApprove = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const canManage = user?.role === 'admin';

  // searchParams must be declared before filter state so the lazy
  // initialisers for ?officer_id= and ?date= can reference it.
  const [searchParams, setSearchParams] = useSearchParams();

  const [dars, setDars] = useState<DailyActivityReport[]>([]);
  const [selected, setSelected] = useState<DailyActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Filters — ?officer_id= and ?date= deep-links pre-seed these on mount
  // so a supervisor can link directly to one officer's reports for a date.
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterOfficerId, setFilterOfficerId] = useState<string>(() => searchParams.get('officer_id') ?? '');
  const [filterDate, setFilterDate] = useState<string>(() => searchParams.get('date') ?? '');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // New DAR form
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [newDarDate, setNewDarDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [newDarShiftStart, setNewDarShiftStart] = useState('');
  const [newDarShiftEnd, setNewDarShiftEnd] = useState('');
  const [autoPopulateData, setAutoPopulateData] = useState<any>(null);
  const [autoPopLoading, setAutoPopLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Edit mode for narrative + all text fields the PDF renders
  const [editing, setEditing] = useState(false);
  const [editNarrative, setEditNarrative] = useState('');
  const [editHighlights, setEditHighlights] = useState('');
  const [editIssues, setEditIssues] = useState('');
  const [editEquipment, setEditEquipment] = useState('');
  const [editRecommendations, setEditRecommendations] = useState('');

  // Supervisor "Return" review-notes ConfirmDialog state \u2014 replaces the
  // native window.prompt() that lived here (no a11y, no theming, no
  // multi-line). Mirrors the inline supervisor-notes pattern shipped on
  // Cases (#1604), Field Interviews (#1597), and Trespass Orders (#1610).
  const [returnNotesOpen, setReturnNotesOpen] = useState(false);
  const [returnNotes, setReturnNotes] = useState('');
  const [returningDar, setReturningDar] = useState(false);

  // Document title
  useEffect(() => { document.title = 'Daily Activity Reports \u2014 RMPG Flex'; }, []);

  // Document title
  useEffect(() => { document.title = 'Daily Activity Reports \u2014 RMPG Flex'; }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') { setCreateFormOpen(false); setSelected(null); }
      if (e.key === 'n' || e.key === 'N') { setCreateFormOpen(true); setAutoPopulateData(null); }
      if (e.key === 'r' || e.key === 'R') { fetchDars({ silent: true }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const fetchDars = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterOfficerId ? { officer_id: filterOfficerId } : {}),
        ...(filterDate ? { shift_date: filterDate } : {}),
      });
      const res = await apiFetch<{ data: DailyActivityReport[]; pagination: any }>(`/dar?${params}`);
      setDars(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) { setFetchError(err?.message || 'Failed to load data'); } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus, filterOfficerId, filterDate]);

  useEffect(() => { fetchDars(); }, [fetchDars]);
  useLiveSync('admin', () => fetchDars({ silent: true }));

  // Strip ?officer_id= and ?date= from the URL after seeding — same
  // single-fire pattern as ?dar_id=. Prevents stale filters surviving a
  // hard refresh or a copy-paste of the URL to another session.
  useEffect(() => {
    const hadOfficer = searchParams.has('officer_id');
    const hadDate = searchParams.has('date');
    if (hadOfficer || hadDate) {
      const next = new URLSearchParams(searchParams);
      next.delete('officer_id');
      next.delete('date');
      setSearchParams(next, { replace: true });
    }
  // Run once on mount only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── /daily-activity-reports?dar_id=<id> URL deep-link auto-select ──
  // Honors the Dashboard-emit / page-consume contract shipped across the
  // other audited pages (Cases, FI, Evidence, Trespass, Court Tracker).
  // Once `dars` hydrates, find by id and select; strip the query so a
  // refresh doesn't re-select. Direct-fetch fallback for ids not in the
  // current filter view (e.g. an approved DAR linked from a supervisor's
  // audit ticket while the filter is set to 'draft').
  const pendingDarIdRef = useRef<string | null>(searchParams.get('dar_id'));
  useEffect(() => {
    const target = pendingDarIdRef.current;
    if (!target || loading) return;
    pendingDarIdRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const hit = dars.find((d) => String(d.id) === String(target));
        if (hit) {
          if (!cancelled) { setSelected(hit); setEditing(false); }
        } else {
          const res = await apiFetch<{ data: DailyActivityReport }>(`/dar/${target}`);
          if (cancelled) return;
          if (res?.data && res.data.id != null) { setSelected(res.data); setEditing(false); }
          else addToast(`DAR ${target} not found`, 'warning');
        }
      } catch {
        if (!cancelled) addToast(`Failed to load DAR ${target}`, 'error');
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('dar_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dars, loading]);

  // Keyboard shortcuts:
  //   Escape — smart-cascade close (smallest-open-first). Previous version
  //            fired setCreateFormOpen(false) AND setSelected(null) on
  //            every Esc, which closed the supervisor's open review pane
  //            the moment they tried to dismiss the New-DAR modal sitting
  //            on top of it. Cascade preserves the layer underneath.
  //   N      — open a new DAR (mirrors Trespass / FI / Citations muscle
  //            memory). Suppressed while typing in an input / textarea /
  //            select / contenteditable so it doesn't fire mid-narrative.
  //   R      — silent refresh.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close-smallest-open-first. Each branch returns so a single Esc
        // doesn't blast multiple open layers in one keypress.
        if (returnNotesOpen) { setReturnNotesOpen(false); return; }
        if (createFormOpen) { setCreateFormOpen(false); setAutoPopulateData(null); return; }
        if (editing) { setEditing(false); return; }
        if (selected) { setSelected(null); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setCreateFormOpen(true);
        setAutoPopulateData(null);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        fetchDars({ silent: true });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnNotesOpen, createFormOpen, editing, selected]);

  const handleAutoPopulate = async () => {
    setAutoPopLoading(true);
    try {
      const res = await apiFetch<{ data: any }>('/dar/auto-populate', {
        method: 'POST',
        body: JSON.stringify({
          officer_id: user?.id,
          shift_date: newDarDate,
        }),
      });
      setAutoPopulateData(res.data);
      addToast('Activity data populated', 'success');
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setAutoPopLoading(false); }
  };

  const handleCreate = async () => {
    if (!newDarDate) { addToast('Shift date required', 'error'); return; }
    setSubmitting(true);
    try {
      const body: any = {
        shift_date: newDarDate,
        shift_start: newDarShiftStart || undefined,
        shift_end: newDarShiftEnd || undefined,
      };
      // Include auto-populated data if available
      if (autoPopulateData) {
        body.calls_handled = JSON.stringify(autoPopulateData.calls || []);
        body.incidents_created = JSON.stringify(autoPopulateData.incidents || []);
        body.citations_issued = JSON.stringify(autoPopulateData.citations || []);
        body.patrols_completed = JSON.stringify(autoPopulateData.patrols || []);
      }
      await apiFetch('/dar', { method: 'POST', body: JSON.stringify(body) });
      addToast('DAR created', 'success');
      setCreateFormOpen(false);
      setAutoPopulateData(null);
      fetchDars({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleSubmit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch(`/dar/${selected.id}/submit`, { method: 'PUT' });
      addToast('DAR submitted for review', 'success');
      const updated = await apiFetch<{ data: DailyActivityReport }>(`/dar/${selected.id}`);
      setSelected(updated.data);
      fetchDars({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleApprove = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/dar/${selected.id}/approve`, { method: 'PUT' });
      addToast('DAR approved', 'success');
      const updated = await apiFetch<{ data: DailyActivityReport }>(`/dar/${selected.id}`);
      setSelected(updated.data);
      fetchDars({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
  };

  const openReturnDialog = () => {
    if (!selected) return;
    setReturnNotes('');
    setReturnNotesOpen(true);
  };
  const handleReturn = async () => {
    if (!selected || !returnNotes.trim()) return;
    setReturningDar(true);
    try {
      await apiFetch(`/dar/${selected.id}/return`, { method: 'PUT', body: JSON.stringify({ review_notes: returnNotes.trim() }) });
      addToast('DAR returned for revision', 'success');
      const updated = await apiFetch<{ data: DailyActivityReport }>(`/dar/${selected.id}`);
      setSelected(updated.data);
      fetchDars({ silent: true });
      setReturnNotesOpen(false);
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setReturningDar(false); }
  };

  const handleSaveNarrative = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/dar/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          activities_narrative: editNarrative,
          notable_events: editHighlights,
          safety_concerns: editIssues,
          equipment_issues: editEquipment,
          recommendations: editRecommendations,
        }),
      });
      addToast('Narrative saved', 'success');
      setEditing(false);
      const updated = await apiFetch<{ data: DailyActivityReport }>(`/dar/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err.message, 'error'); }
  };

  const parseJson = (val: any) => {
    if (!val) return [];
    if (typeof val === 'string') try { return JSON.parse(val); } catch { return []; }
    return Array.isArray(val) ? val : [];
  };

  // ── Right-click context menu ──
  const buildDarMenu = (dar: DailyActivityReport): ContextMenuItem[] => [
    m.action('Open report', () => { setSelected(dar); setEditing(false); }, { icon: <Eye size={12} /> }),
    m.separator(),
    m.copy('Copy DAR number', dar.dar_number),
    m.copyId(dar.id),
  ];

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''} bg-surface-base`}>
      {fetchError && (
        <div className="absolute left-0 right-0 z-10 mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2 shadow-lg">
          <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
          <span className="flex-1">{fetchError}</span>
          <button type="button" onClick={() => void fetchDars()} className="ml-auto text-red-300 hover:text-red-100 text-[10px]">Retry</button>
        </div>
      )}
      {/* ── Left Panel ── */}
      <div className={`flex flex-col min-h-0 ${isMobile ? 'h-1/2' : 'w-[380px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Daily Activity Reports" icon={ClipboardCheck}>
          <button
            type="button"
            className="toolbar-btn print:hidden"
            disabled={dars.length === 0}
            onClick={() => downloadTextFile('daily-activity-reports.csv', darListToCsv(dars))}
            title="CSV of report number, shift date, status — no narrative"
          >CSV</button>
          <ExportButton exportUrl="/api/dar/export/csv" exportFilename="daily_activity_reports_export.csv" />
          <IconButton onClick={() => fetchDars({ silent: true })} className="toolbar-btn print:hidden" title="Refresh (R)" aria-label="Refresh">
            <RefreshCw style={{ width: 11, height: 11 }} />
          </IconButton>
          <button type="button" onClick={() => { setCreateFormOpen(true); setAutoPopulateData(null); }} className="toolbar-btn toolbar-btn-primary print:hidden">
            <Plus style={{ width: 11, height: 11 }} /> New
          </button>
          <span className="text-[9px] font-mono text-rmpg-500 bg-rmpg-800 px-1.5 py-0.5 rounded-sm">{totalCount}</span>
        </PanelTitleBar>

        {/* Filters */}
        <div className="flex gap-1.5 p-1.5 border-b border-rmpg-700 bg-surface-sunken">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
            <input id="ff-dailyactivityreportspage-0" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }} placeholder="Search DARs..." aria-label="Search DARs..." className="w-full pl-7 pr-2 py-1.5 text-xs bg-surface-base border border-rmpg-700 text-rmpg-100 placeholder-rmpg-500 focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 outline-none transition-colors" />
          </div>
          <select id="ff-dailyactivityreportspage-1" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} className="text-[10px] bg-surface-base border border-rmpg-700 text-rmpg-300 px-2 outline-none focus:border-brand-600 transition-colors">
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="returned">Returned</option>
          </select>
        </div>

        {/* DAR List */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark" role="list" aria-label="Daily activity reports">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading daily activity reports" /><span className="text-[10px] text-rmpg-500">Loading...</span></div>
          ) : dars.length === 0 ? (
            (() => {
              // Distinguish "no DARs in the system yet" (offer the New CTA)
              // from "filters hid them" (offer to clear). Same pattern shipped
              // on Trespass / Court Tracker — operators stopped panicking that
              // the data was gone once the page told them why.
              const filtered = !!(searchQuery || filterStatus);
              return (
                <div className="flex flex-col items-center justify-center py-16 text-rmpg-500" role="status">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                    <ClipboardCheck className="w-7 h-7 text-rmpg-600" />
                  </div>
                  {filtered ? (
                    <>
                      <p className="text-sm font-medium text-rmpg-400">No DARs match these filters</p>
                      <p className="text-[10px] text-rmpg-600 mt-1">Clear search and status to see all reports</p>
                      <button
                        type="button"
                        onClick={() => { setSearchQuery(''); setFilterStatus(''); setPage(1); }}
                        className="mt-3 toolbar-btn text-[10px]"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-rmpg-400">No DARs yet</p>
                      <p className="text-[10px] text-rmpg-600 mt-1">Press <kbd className="px-1 py-0.5 bg-surface-sunken border border-rmpg-700 text-rmpg-400 text-[9px] font-mono">N</kbd> or click + New to create one</p>
                    </>
                  )}
                </div>
              );
            })()
          ) : (
            dars.map(dar => (
              <button type="button"
                key={dar.id}
                role="listitem"
                onClick={() => { setSelected(dar); setEditing(false); }}
                onContextMenu={(e) => openMenu(e, buildDarMenu(dar))}
                className={`w-full text-left px-3 py-2.5 border-b border-rmpg-800 transition-all duration-150 ${
                  selected?.id === dar.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500 shadow-sm' : 'hover:bg-rmpg-800/40 hover:shadow-sm border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-rmpg-100">{dar.dar_number}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${STATUS_COLORS[dar.status] || ''}`}>
                    {formatEnumValue(dar.status)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <Calendar style={{ width: 9, height: 9 }} />
                  {dar.shift_date ? parseTimestamp(dar.shift_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'}
                  {dar.officer_name && (
                    <span className="flex items-center gap-1">
                      <User style={{ width: 9, height: 9 }} />
                      {dar.officer_name}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-sunken">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-[10px] text-rmpg-400 hover:text-rmpg-100 disabled:opacity-30 disabled:hover:text-rmpg-400 transition-colors inline-flex items-center gap-1">
              <ChevronLeft style={{ width: 11, height: 11 }} /> Prev
            </button>
            <span className="text-[9px] font-mono text-rmpg-500 tabular-nums">Page {page}/{totalPages}</span>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-[10px] text-rmpg-400 hover:text-rmpg-100 disabled:opacity-30 disabled:hover:text-rmpg-400 transition-colors inline-flex items-center gap-1">
              Next <ChevronRight style={{ width: 11, height: 11 }} />
            </button>
          </div>
        )}
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 min-h-0 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.dar_number} — ${selected.shift_date ? parseTimestamp(selected.shift_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : ''}`} icon={ClipboardCheck}>
              <button type="button" onClick={() => generateDarPdf(selected)} className="toolbar-btn print:hidden" title="Export client/court-ready PDF">
                <FileText style={{ width: 11, height: 11 }} /> PDF
              </button>
              {(selected.status === 'draft' || canManage) && (
                <button type="button" onClick={handleSubmit} disabled={submitting} className="toolbar-btn toolbar-btn-primary print:hidden disabled:opacity-50">
                  <Send style={{ width: 11, height: 11 }} /> Submit
                </button>
              )}
              {(canManage || (selected.status === 'submitted' && canApprove)) && (
                <>
                  <button type="button" onClick={handleApprove} className="toolbar-btn text-green-400 hover:text-green-300">
                    <CheckCircle style={{ width: 11, height: 11 }} /> Approve
                  </button>
                  <button type="button" onClick={openReturnDialog} className="toolbar-btn text-red-400 hover:text-red-300">
                    <RotateCcw style={{ width: 11, height: 11 }} /> Return
                  </button>
                </>
              )}
            </PanelTitleBar>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* Status + Info */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border font-bold ${STATUS_COLORS[selected.status] || ''}`}>
                  {formatEnumValue(selected.status)}
                </span>
                {selected.officer_name && (
                  <span className="text-[10px] px-2 py-1 border bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50">
                    {selected.officer_name}
                  </span>
                )}
              </div>

              {/* Return notes */}
              {selected.status === 'returned' && selected.review_notes && (
                <div className="panel-beveled p-3 border-l-2 border-l-red-500">
                  <div className="text-[9px] font-mono text-red-400 uppercase mb-1">Supervisor Notes (Returned)</div>
                  <div className="text-xs text-rmpg-300">{selected.review_notes}</div>
                </div>
              )}

              {/* Auto-populated counts */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Calls', parseJson(selected.calls_handled).length, 'text-rmpg-400'],
                  ['Incidents', parseJson(selected.incidents_created).length, 'text-red-400'],
                  ['Citations', parseJson(selected.citations_issued).length, 'text-amber-400'],
                  ['Patrols', parseJson(selected.patrols_completed).length, 'text-green-400'],
                ].map(([label, count, color]) => (
                  <div key={label as string} className="panel-beveled p-2.5 text-center hover:bg-surface-raised/30 transition-colors">
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider">{label}</div>
                    <div className={`text-lg font-bold font-mono tabular-nums ${color}`}>{count}</div>
                  </div>
                ))}
              </div>

              {/* Shift Info */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div><div className="text-[9px] font-mono text-rmpg-500">Shift Date</div><div className="text-xs text-rmpg-100">{selected.shift_date ? parseTimestamp(selected.shift_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'}</div></div>
                <div><div className="text-[9px] font-mono text-rmpg-500">Start</div><div className="text-xs text-rmpg-100">{selected.shift_start || '—'}</div></div>
                <div><div className="text-[9px] font-mono text-rmpg-500">End</div><div className="text-xs text-rmpg-100">{selected.shift_end || '—'}</div></div>
                <div><div className="text-[9px] font-mono text-rmpg-500">Total Hours</div><div className="text-xs font-bold text-brand-400">{(() => {
                  if (!selected.shift_start || !selected.shift_end) return '—';
                  const [sh, sm] = selected.shift_start.split(':').map(Number);
                  const [eh, em] = selected.shift_end.split(':').map(Number);
                  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return '—';
                  let diff = (eh * 60 + em) - (sh * 60 + sm);
                  if (diff < 0) diff += 24 * 60; // overnight shift
                  const hrs = Math.floor(diff / 60);
                  const mins = diff % 60;
                  return `${hrs}h ${mins > 0 ? `${mins}m` : ''}`;
                })()}</div></div>
              </div>

              {/* Narrative Section */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-mono text-rmpg-500 uppercase">Narrative / Summary</span>
                  {(selected.status === 'draft' || selected.status === 'returned') && (
                    <button type="button"
                      onClick={() => {
                        if (editing) handleSaveNarrative();
                        else {
                          setEditNarrative(selected.activities_narrative || '');
                          setEditHighlights(selected.notable_events || '');
                          setEditIssues(selected.safety_concerns || '');
                          setEditEquipment(selected.equipment_issues || '');
                          setEditRecommendations(selected.recommendations || '');
                          setEditing(true);
                        }
                      }}
                      className="toolbar-btn"
                    >
                      {editing ? <><Save style={{ width: 10, height: 10 }} /> Save</> : 'Edit'}
                    </button>
                  )}
                </div>
                {editing ? (
                  <div className="space-y-2">
                    <div>
                      <label htmlFor="dar-narrative" className="text-[9px] text-rmpg-500">Narrative</label>
                      <p className="text-[8px] text-rmpg-600 mb-0.5">Describe all activities during this shift</p>
                      <RichTextArea id="dar-narrative" value={editNarrative} onChange={e => setEditNarrative(e.target.value)} rows={5} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none resize-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors" />
                    </div>
                    <div>
                      <label htmlFor="dar-highlights" className="text-[9px] text-rmpg-500">Highlights</label>
                      <RichTextArea id="dar-highlights" value={editHighlights} onChange={e => setEditHighlights(e.target.value)} rows={2} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none resize-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors" />
                    </div>
                    <div>
                      <label htmlFor="dar-issues" className="text-[9px] text-rmpg-500">Issues Encountered</label>
                      <RichTextArea id="dar-issues" value={editIssues} onChange={e => setEditIssues(e.target.value)} rows={2} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none resize-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors" />
                    </div>
                    <div>
                      <label htmlFor="dar-equipment" className="text-[9px] text-rmpg-500">Equipment Issues</label>
                      <RichTextArea id="dar-equipment" value={editEquipment} onChange={e => setEditEquipment(e.target.value)} rows={2} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none resize-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors" />
                    </div>
                    <div>
                      <label htmlFor="dar-recommendations" className="text-[9px] text-rmpg-500">Recommendations</label>
                      <RichTextArea id="dar-recommendations" value={editRecommendations} onChange={e => setEditRecommendations(e.target.value)} rows={2} className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none resize-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors" />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-rmpg-300 whitespace-pre-wrap">
                    {selected.activities_narrative || 'No narrative yet — click Edit to add.'}
                    {selected.notable_events && (
                      <div className="mt-3 pt-2 border-t border-rmpg-700">
                        <span className="text-[9px] text-rmpg-500">Highlights: </span>{selected.notable_events}
                      </div>
                    )}
                    {selected.safety_concerns && (
                      <div className="mt-2">
                        <span className="text-[9px] text-rmpg-500">Issues: </span>{selected.safety_concerns}
                      </div>
                    )}
                    {selected.equipment_issues && (
                      <div className="mt-2">
                        <span className="text-[9px] text-rmpg-500">Equipment: </span>{selected.equipment_issues}
                      </div>
                    )}
                    {selected.recommendations && (
                      <div className="mt-2">
                        <span className="text-[9px] text-rmpg-500">Recommendations: </span>{selected.recommendations}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
                <ClipboardCheck className="w-7 h-7 text-rmpg-600" />
              </div>
              <div className="text-sm font-medium text-rmpg-400">Select a DAR to view details</div>
              <div className="text-[10px] text-rmpg-600 mt-1">or create a new one with the + New button</div>
            </div>
          </div>
        )}
      </div>

      {/* ── New DAR Modal ── */}
      {createFormOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true" onClick={() => setCreateFormOpen(false)}>
          <div className="panel-surface w-full max-w-md mx-4 shadow-xl my-auto" onClick={e => e.stopPropagation()}>
            <PanelTitleBar title="New Daily Activity Report" icon={Plus}>
              <IconButton onClick={() => setCreateFormOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="dar-shift-date" className="field-label">Shift Date *</label>
                <input id="dar-shift-date" type="date" value={newDarDate} onChange={e => setNewDarDate(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none min-h-[44px]" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="dar-shift-start" className="field-label">Shift Start</label>
                  <input id="dar-shift-start" type="time" value={newDarShiftStart} onChange={e => setNewDarShiftStart(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none min-h-[44px]" />
                </div>
                <div>
                  <label htmlFor="dar-shift-end" className="field-label">Shift End</label>
                  <input id="dar-shift-end" type="time" value={newDarShiftEnd} onChange={e => setNewDarShiftEnd(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none min-h-[44px]" />
                </div>
              </div>

              {/* Auto-populate button */}
              <button type="button" onClick={handleAutoPopulate} disabled={autoPopLoading} className="w-full toolbar-btn justify-center py-2">
                {autoPopLoading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Zap style={{ width: 12, height: 12 }} />}
                Auto-Populate from System Data
              </button>

              {autoPopulateData && (
                <div className="panel-beveled p-3 border-l-2 border-l-green-500">
                  <div className="text-[9px] font-mono text-green-400 mb-2 flex items-center gap-1">
                    <CheckCircle style={{ width: 10, height: 10 }} /> Shift Stats Auto-Populated
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Calls Handled', data: autoPopulateData.calls || [], color: 'text-rmpg-400' },
                      { label: 'Incidents Created', data: autoPopulateData.incidents || [], color: 'text-red-400' },
                      { label: 'Citations Issued', data: autoPopulateData.citations || [], color: 'text-amber-400' },
                      { label: 'Patrols Completed', data: autoPopulateData.patrols || [], color: 'text-green-400' },
                    ].map(item => (
                      <div key={item.label} className="panel-beveled p-2">
                        <div className="text-[8px] text-rmpg-500 uppercase">{item.label}</div>
                        <div className={`text-lg font-bold font-mono ${item.color}`}>{item.data.length}</div>
                      </div>
                    ))}
                  </div>
                  {autoPopulateData.miles_patrolled != null && (
                    <div className="mt-2 text-[10px] text-rmpg-300">
                      Miles Patrolled: <span className="text-rmpg-100 font-bold">{autoPopulateData.miles_patrolled || 0}</span>
                    </div>
                  )}
                  {autoPopulateData.arrests != null && (
                    <div className="text-[10px] text-rmpg-300">
                      Arrests: <span className="text-rmpg-100 font-bold">{(autoPopulateData.arrests || []).length}</span>
                    </div>
                  )}
                  <div className="text-[8px] text-rmpg-500 mt-1">Values can be edited after creation</div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setCreateFormOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleCreate} disabled={submitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create DAR
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Supervisor "Return for revision" — ConfirmDialog replaces the
          native window.prompt() that lived in handleReturn(). The native
          dialog had no a11y, no theming, no multi-line support, and gave
          the operator zero context on which DAR they were about to bounce
          back. Mirrors the pattern shipped on Cases (#1604), Trespass
          Orders (#1610), and Field Interviews (#1597). */}
      <ConfirmDialog
        isOpen={returnNotesOpen}
        onClose={() => (returningDar ? null : setReturnNotesOpen(false))}
        onConfirm={handleReturn}
        title="Return DAR for revision?"
        message="The officer will see your notes when they re-open the report. Required — keep it actionable (which section, what's missing, what to add) so they don't have to guess."
        details={selected ? (
          <>
            <div><span className="text-rmpg-500">DAR</span> <span className="font-mono text-rmpg-100">{selected.dar_number}</span></div>
            {selected.officer_name && (
              <div><span className="text-rmpg-500">Officer</span> <span className="text-rmpg-100">{selected.officer_name}</span></div>
            )}
            <div><span className="text-rmpg-500">Shift</span> <span className="text-rmpg-100">{selected.shift_date ? parseTimestamp(selected.shift_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'}</span></div>
            <div className="mt-2">
              <label htmlFor="dar-return-notes" className="text-[9px] font-mono text-rmpg-500 uppercase">Review Notes *</label>
              <textarea
                id="dar-return-notes"
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                rows={4}
                placeholder="e.g. Narrative is too thin — add the dispatch detail for call 24-12345 and the property check on the south fence."
                className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder-rmpg-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-500/30 transition-colors resize-none"
                autoFocus
              />
            </div>
          </>
        ) : undefined}
        confirmLabel={returningDar ? 'Returning…' : 'Return DAR'}
        confirmVariant="warning"
        isLoading={returningDar}
        confirmDisabled={!returnNotes.trim()}
      />
    </div>
  );
}
