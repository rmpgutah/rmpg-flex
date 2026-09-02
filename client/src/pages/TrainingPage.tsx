// ============================================================
// RMPG Flex — Training Management System
// Unified training dashboard: compliance, records, requirements,
// and document management.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import RichTextArea from '../components/RichTextArea';
import {
  GraduationCap, Plus, Search, CheckCircle, AlertTriangle, Clock, BookOpen,
  Loader2, X, Edit2, Trash2, Archive, Users, Shield, Calendar, BarChart3, Target,
  FileText, ChevronRight, RefreshCw, Printer, FilterX,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { formatDate, parseTimestamp } from '../utils/dateUtils';
import { openTrainingCertificatePdf } from '../utils/trainingCertificatePdf';
import type {
  TrainingRecord, TrainingRequirement, TrainingCategory, TrainingStatus,
} from '../types';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { useSlashFocus } from '../hooks/useSlashFocus';
import { trainingRecordsToCsv, downloadTextFile } from '../utils/rmsListExport';

// ── Constants ──────────────────────────────────────────────
const CATEGORIES: TrainingCategory[] = [
  'firearms', 'defensive_tactics', 'first_aid', 'legal',
  'communication', 'driving', 'technology', 'leadership', 'compliance', 'other',
];

const CATEGORY_COLORS: Record<string, string> = {
  firearms: 'bg-red-900/40 text-red-400 border-red-700/50',
  defensive_tactics: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  first_aid: 'bg-green-900/40 text-green-400 border-green-700/50',
  legal: 'bg-purple-900/40 text-purple-400 border-purple-700/50',
  communication: 'bg-surface-sunken/40 text-rmpg-400 border-border-default/50',
  driving: 'bg-surface-sunken/40 text-rmpg-400 border-border-default/50',
  technology: 'bg-surface-sunken/40 text-rmpg-400 border-border-default/50',
  leadership: 'bg-brand-900/40 text-brand-400 border-brand-700/50',
  compliance: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  other: 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  completed: { bg: 'bg-green-900/50', text: 'text-green-400', border: 'border-green-700/50' },
  in_progress: { bg: 'bg-surface-sunken/50', text: 'text-rmpg-400', border: 'border-border-default/50' },
  scheduled: { bg: 'bg-amber-900/50', text: 'text-amber-400', border: 'border-amber-700/50' },
  overdue: { bg: 'bg-red-900/50', text: 'text-red-400', border: 'border-red-700/50' },
  expired: { bg: 'bg-red-900/50', text: 'text-red-400', border: 'border-red-700/50' },
};

const ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];

type Tab = 'dashboard' | 'records' | 'requirements' | 'calendar';
const VALID_TABS: Tab[] = ['dashboard', 'records', 'requirements', 'calendar'];
const isValidTab = (s: string | null | undefined): s is Tab =>
  !!s && (VALID_TABS as string[]).includes(s);

interface Officer {
  id: string;
  full_name: string;
  badge_number?: string;
  role: string;
  status?: string;
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

export default function TrainingPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
  // (Was: isGodMode — unused; removed in v1054 audit. Admin role gates the
  // existing isAdmin path. Recovering it would require a follow-up PR for
  // an actual god-mode surface; the variable was previously dead.)

  // ── URL deep-link contract (v1239) ────────────────────
  //   /training?tab=<tab>            — switches the active tab on mount
  //   /training?cert_id=<id>         — open the matching training record for edit
  //   /training?session_id=<id>      — alias for cert_id (same record modal)
  //   /training?officer_id=<id>      — pre-filter Records tab to one officer
  //   /training?course_id=<reqId>    — open the matching requirement for edit
  //   /training?status=expiring_soon — pre-filter Records tab to expiring certs
  // Cross-page links from personnel detail / dashboard / N-day alert can
  // hand a supervisor straight to the right row without round-tripping.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<Tab>(isValidTab(urlTab) ? urlTab : 'dashboard');
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Modal state
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [editRecord, setEditRecord] = useState<TrainingRecord | null>(null);
  const [showRequirementModal, setShowRequirementModal] = useState(false);
  const [editRequirement, setEditRequirement] = useState<TrainingRequirement | null>(null);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkCourseName, setBulkCourseName] = useState('');
  const [bulkCategory, setBulkCategory] = useState<string>('other');
  const [bulkProvider, setBulkProvider] = useState('');
  const [bulkHours, setBulkHours] = useState('0');
  const [bulkOfficerIds, setBulkOfficerIds] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);

  // ConfirmDialog state (v1054) — replaces window.confirm() for the two
  // destructive flows. The native confirm() can't be themed, can't be
  // Esc-cascaded, and tanks the dashcam HUD on iPad — same finding as the
  // page-1…36 native-dialog kills (sw.js v1024–v1048).
  const [recordToDelete, setRecordToDelete] = useState<TrainingRecord | null>(null);
  const [requirementToDelete, setRequirementToDelete] = useState<TrainingRequirement | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Officer pre-filter, externally driven by ?officer_id=<id> deep-link
  // (and by the Records tab's own picker). Lifted so the deep-link side-
  // effect below can write it before RecordsTab mounts.
  const [officerFilter, setOfficerFilter] = useState<string>('all');
  // Status pre-filter, externally driven by ?status=<status> deep-link.
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchData = useCallback(async () => {
    setFetchError('');
    try {
      setLoading(true);
      const [recs, reqs, users] = await Promise.all([
        apiFetch<TrainingRecord[]>('/personnel/training'),
        apiFetch<TrainingRequirement[]>('/personnel/training-requirements'),
        apiFetch<Officer[]>('/personnel').catch(() => [] as Officer[]),
      ]);
      if (!mountedRef.current) return;
      setRecords(recs || []);
      // Normalize required_for_roles — DB stores as JSON string, UI expects array
      setRequirements((reqs || []).map(r => ({
        ...r,
        required_for_roles: Array.isArray(r.required_for_roles) ? r.required_for_roles
          : (() => { try { return JSON.parse(r.required_for_roles as any || '[]'); } catch { return []; } })(),
      })));
      setOfficers((users || []).filter(u => u.status === 'active'));
    } catch (err: any) {
      console.error('Failed to load training data:', err);
      if (mountedRef.current) setFetchError(err?.message || 'Failed to load data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('training', fetchData);

  // v1054: was `apiFetch('/personnel/training-completion')` fetched on every
  // records change and stored into `trainingCompletion` state that nothing
  // ever read. Audit removed the dead state + dead fetch — it ran for free
  // on every poll tick and on every CRUD because /personnel/training is
  // useLiveSync-driven. The dashboard derives the same numbers (`stats`)
  // from records + requirements in-page already.

  const handleBulkAssign = async () => {
    if (!bulkCourseName || bulkOfficerIds.length === 0) return;
    setBulkSaving(true);
    try {
      await apiFetch('/personnel/training-bulk-assign', {
        method: 'POST',
        body: JSON.stringify({
          officer_ids: bulkOfficerIds,
          course_name: bulkCourseName,
          category: bulkCategory,
          provider: bulkProvider || undefined,
          hours: parseFloat(bulkHours) || 0,
        }),
      });
      setShowBulkAssign(false);
      setBulkCourseName('');
      setBulkOfficerIds([]);
      fetchData();
    } catch (err) {
      console.error('Bulk assign error:', err);
    } finally {
      setBulkSaving(false);
    }
  };

  // ── Record CRUD ──────────────────────────────────────
  const handleSaveRecord = async (data: Partial<TrainingRecord>) => {
    try {
      if (editRecord) {
        await apiFetch(`/personnel/training/${editRecord.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await apiFetch('/personnel/training', { method: 'POST', body: JSON.stringify(data) });
      }
      setShowRecordModal(false);
      setEditRecord(null);
      fetchData();
    } catch (err: any) {
      console.error('Save record error:', err);
      addToast(err?.message || 'Failed to save training record', 'error');
    }
  };

  // v1054: kill window.confirm() — open ConfirmDialog with row context
  // (officer, course, completion date) so a misclick can't quietly destroy
  // a court-discoverable training record. Performed-on-confirm by the
  // dialog's onConfirm wiring below.
  const requestDeleteRecord = (record: TrainingRecord) => {
    setRecordToDelete(record);
  };
  const confirmDeleteRecord = async () => {
    if (!recordToDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/personnel/training/${recordToDelete.id}`, { method: 'DELETE' });
      setRecordToDelete(null);
      fetchData();
    } catch (err: any) {
      console.error('Delete record error:', err);
      addToast(err?.message || 'Failed to delete record', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ── Requirement CRUD ─────────────────────────────────
  const handleSaveRequirement = async (data: Partial<TrainingRequirement>) => {
    try {
      if (editRequirement) {
        await apiFetch(`/personnel/training-requirements/${editRequirement.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await apiFetch('/personnel/training-requirements', { method: 'POST', body: JSON.stringify(data) });
      }
      setShowRequirementModal(false);
      setEditRequirement(null);
      fetchData();
    } catch (err: any) {
      console.error('Save requirement error:', err);
      addToast(err?.message || 'Failed to save requirement', 'error');
    }
  };

  const requestDeleteRequirement = (req: TrainingRequirement) => {
    setRequirementToDelete(req);
  };
  const confirmDeleteRequirement = async () => {
    if (!requirementToDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/personnel/training-requirements/${requirementToDelete.id}`, { method: 'DELETE' });
      setRequirementToDelete(null);
      fetchData();
    } catch (err: any) {
      console.error('Delete requirement error:', err);
      addToast(err?.message || 'Failed to delete requirement', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { key: 'records', label: 'Records', icon: FileText },
    { key: 'requirements', label: 'Requirements', icon: Target },
    { key: 'calendar', label: 'Calendar', icon: Calendar },
  ];

  // Set document title
  useEffect(() => { document.title = 'Training Management \u2014 RMPG Flex'; }, []);

  // v1054: Keyboard shortcuts \u2014
  //   Escape \u2014 smart-cascade close (smallest-open-first). The previous
  //            implementation only cleared the Record modal, so the
  //            Requirement modal, the Bulk Assign modal, and the two new
  //            confirm dialogs were all blind to Esc.
  //   N      \u2014 open the New Training Record modal (admin/manager tier;
  //            mirrors the New-X binding on Dispatch / FI / Patrol /
  //            Evidence / Dash Cameras). Suppressed while typing into any
  //            input / textarea / select / contenteditable.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close-smallest-open-first cascade. Each branch returns after
        // closing so a single Esc doesn't blast multiple layers at once.
        if (recordToDelete) { setRecordToDelete(null); return; }
        if (requirementToDelete) { setRequirementToDelete(null); return; }
        if (showBulkAssign) { setShowBulkAssign(false); return; }
        if (showRequirementModal) { setShowRequirementModal(false); setEditRequirement(null); return; }
        if (showRecordModal) { setShowRecordModal(false); setEditRecord(null); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if ((e.key === 'n' || e.key === 'N') && isAdmin) {
        e.preventDefault();
        setEditRecord(null);
        setShowRecordModal(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [recordToDelete, requirementToDelete, showBulkAssign, showRequirementModal, showRecordModal, isAdmin]);

  // v1054: keep the URL tab in sync when the user clicks a tab (so a
  // refresh / browser-back / paste-into-MDT lands on the same view).
  const handleTabClick = useCallback((tab: Tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // v1239: ?cert_id=<id> / ?session_id=<id> / ?course_id=<reqId> /
  // ?officer_id=<id> / ?status=<status> deep-link auto-resolve.
  // ?session_id is an alias for ?cert_id — both open the matching training
  // record in the edit modal. One-shot per page load; each param is stripped
  // from the URL after applying so a follow-up refresh doesn't reopen the
  // modal. Falls through gracefully when the target id isn't in the current
  // dataset (records returns up to ~1k rows so this is almost always a hit).
  const pendingCertIdRef = useRef<string | null>(
    searchParams.get('cert_id') ?? searchParams.get('session_id')
  );
  const pendingCourseIdRef = useRef<string | null>(searchParams.get('course_id'));
  const pendingOfficerIdRef = useRef<string | null>(searchParams.get('officer_id'));
  const pendingStatusRef = useRef<string | null>(searchParams.get('status'));
  useEffect(() => {
    if (loading) return;
    const next = new URLSearchParams(searchParams);
    let touched = false;
    const certId = pendingCertIdRef.current;
    if (certId) {
      pendingCertIdRef.current = null;
      const hit = records.find(r => String(r.id) === String(certId));
      if (hit) {
        setEditRecord(hit);
        setShowRecordModal(true);
        if (activeTab === 'dashboard') setActiveTab('records');
      } else {
        addToast(`Training record ${certId} not found`, 'warning');
      }
      next.delete('cert_id');
      next.delete('session_id');
      touched = true;
    }
    const courseId = pendingCourseIdRef.current;
    if (courseId) {
      pendingCourseIdRef.current = null;
      const hit = requirements.find(r => String(r.id) === String(courseId));
      if (hit) {
        setEditRequirement(hit);
        setShowRequirementModal(true);
        if (activeTab !== 'requirements') setActiveTab('requirements');
      } else {
        addToast(`Training requirement ${courseId} not found`, 'warning');
      }
      next.delete('course_id'); touched = true;
    }
    const officerId = pendingOfficerIdRef.current;
    if (officerId) {
      pendingOfficerIdRef.current = null;
      const hit = officers.find(o => String(o.id) === String(officerId));
      if (hit) {
        setOfficerFilter(String(officerId));
        if (activeTab === 'dashboard' || activeTab === 'calendar') setActiveTab('records');
      } else {
        addToast(`Officer ${officerId} not found`, 'warning');
      }
      next.delete('officer_id'); touched = true;
    }
    const statusParam = pendingStatusRef.current;
    if (statusParam) {
      pendingStatusRef.current = null;
      const allowed = ['completed', 'in_progress', 'scheduled', 'overdue', 'expired', 'expiring_soon'];
      if (allowed.includes(statusParam)) {
        setStatusFilter(statusParam);
        if (activeTab === 'dashboard' || activeTab === 'calendar') setActiveTab('records');
      }
      next.delete('status'); touched = true;
    }
    if (touched) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, records, requirements, officers]);

  return (
    <div className="flex flex-col h-full bg-surface-sunken">
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{fetchError}</span>
          <button type="button" className="toolbar-btn" onClick={() => { void fetchData(); }}>Retry</button>
          <IconButton onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300" aria-label="Dismiss error">
            <X className="w-3 h-3" />
          </IconButton>
        </div>
      )}
      {/* Header */}
      <div className="panel-beveled border-b border-rmpg-700 p-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-brand-400" />
          <h1 className="text-sm font-bold text-rmpg-100 uppercase tracking-wider">
            Training Management
          </h1>
          <span className="text-[9px] text-rmpg-500 font-mono ml-2">
            {records.length} records | {requirements.length} requirements
          </span>
        </div>
        <div className="flex items-center gap-2">
          <IconButton onClick={fetchData} className="toolbar-btn p-1.5" title="Refresh" aria-label="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </IconButton>
          {isAdmin && (
            <>
              <button type="button"
                onClick={() => setShowBulkAssign(true)}
                className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1"
              >
                <Users className="w-3 h-3" />
                Bulk Assign
              </button>
              <button type="button"
                onClick={() => { setEditRecord(null); setShowRecordModal(true); }}
                className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add Record
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="panel-inset mx-3 mt-3 p-1 flex items-center gap-1 flex-shrink-0" role="tablist" aria-label="Training management tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button type="button"
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => handleTabClick(key)}
            className={`text-[10px] px-3 py-1.5 flex items-center gap-1.5 transition-colors duration-150 ${
              activeTab === key ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'
            }`}
          >
            <Icon className="w-3 h-3" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark" role="tabpanel">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" />
            <span className="ml-2 text-xs text-rmpg-400">Loading training data...</span>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardTab records={records} requirements={requirements} officers={officers} />
            )}
            {activeTab === 'records' && (
              <RecordsTab
                records={records}
                requirements={requirements}
                officers={officers}
                isAdmin={isAdmin}
                onEdit={(r) => { setEditRecord(r); setShowRecordModal(true); }}
                onDelete={requestDeleteRecord}
                onPrint={(r) => {
                  const req = requirements.find(q => q.course_name === r.course_name) || null;
                  openTrainingCertificatePdf({
                    record: r,
                    requirement: req,
                    preparedBy: user?.full_name || user?.username,
                  });
                }}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                officerFilter={officerFilter}
                setOfficerFilter={setOfficerFilter}
                onAdd={isAdmin ? () => { setEditRecord(null); setShowRecordModal(true); } : undefined}
              />
            )}
            {activeTab === 'requirements' && (
              <RequirementsTab
                requirements={requirements}
                records={records}
                officers={officers}
                isAdmin={isAdmin}
                onAdd={() => { setEditRequirement(null); setShowRequirementModal(true); }}
                onEdit={(r) => { setEditRequirement(r); setShowRequirementModal(true); }}
                onDelete={requestDeleteRequirement}
              />
            )}
            {activeTab === 'calendar' && (
              <CalendarTab records={records} requirements={requirements} />
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showRecordModal && (
        <RecordModal
          record={editRecord}
          officers={officers}
          requirements={requirements}
          onSave={handleSaveRecord}
          onClose={() => { setShowRecordModal(false); setEditRecord(null); }}
        />
      )}
      {showRequirementModal && (
        <RequirementModal
          requirement={editRequirement}
          onSave={handleSaveRequirement}
          onClose={() => { setShowRequirementModal(false); setEditRequirement(null); }}
        />
      )}

      {/* v1054: Delete-record confirm — replaces native window.confirm.
          Includes officer + course + completion-date context so a misclick
          on a similar-named row can't quietly destroy a court-discoverable
          training certificate. */}
      <ConfirmDialog
        isOpen={recordToDelete !== null}
        onClose={() => setRecordToDelete(null)}
        onConfirm={confirmDeleteRecord}
        title="Delete training record?"
        message="This permanently removes a training / qualification record. Discovery requests rely on these rows — destruction cannot be undone."
        details={
          recordToDelete && (
            <div className="space-y-0.5">
              <div className="font-medium text-rmpg-100">{recordToDelete.course_name}</div>
              <div>Officer: {recordToDelete.officer_name || '—'}</div>
              {recordToDelete.completed_date && (
                <div className="text-rmpg-500">Completed {formatDate(recordToDelete.completed_date)}</div>
              )}
              {recordToDelete.expiry_date && (
                <div className="text-rmpg-500">Expires {formatDate(recordToDelete.expiry_date)}</div>
              )}
              {recordToDelete.certificate_number && (
                <div className="text-rmpg-500">Cert #{recordToDelete.certificate_number}</div>
              )}
              <div className="text-rmpg-500">Status: {toDisplayLabel(String(recordToDelete.status))}</div>
            </div>
          )
        }
        confirmLabel="Delete record"
        confirmVariant="danger"
        isLoading={deleting}
      />

      {/* v1054: Delete-requirement confirm. */}
      <ConfirmDialog
        isOpen={requirementToDelete !== null}
        onClose={() => setRequirementToDelete(null)}
        onConfirm={confirmDeleteRequirement}
        title="Delete training requirement?"
        message="This removes a course requirement from the catalog. Any existing training records for this course remain intact, but the compliance dashboard will no longer flag missing officers."
        details={
          requirementToDelete && (
            <div className="space-y-0.5">
              <div className="font-medium text-rmpg-100">{requirementToDelete.course_name}</div>
              <div>Category: {toDisplayLabel(String(requirementToDelete.category))}</div>
              {requirementToDelete.is_mandatory ? (
                <div className="text-red-400">Mandatory — deleting drops the compliance gate</div>
              ) : (
                <div className="text-rmpg-500">Non-mandatory</div>
              )}
              {requirementToDelete.minimum_hours ? (
                <div className="text-rmpg-500">Minimum {requirementToDelete.minimum_hours}h</div>
              ) : null}
            </div>
          )
        }
        confirmLabel="Delete requirement"
        confirmVariant="danger"
        isLoading={deleting}
      />

      {/* Bulk Assignment Modal */}
      {showBulkAssign && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowBulkAssign(false)}>
          <div className="bg-surface-base border border-rmpg-700 rounded-sm w-full max-w-lg p-4 space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-rmpg-100 uppercase flex items-center gap-2">
                <Users className="w-4 h-4 text-brand-400" /> Bulk Training Assignment
              </h2>
              <IconButton onClick={() => setShowBulkAssign(false)} className="text-rmpg-500 hover:text-rmpg-300" aria-label="Close bulk assign">
                <X className="w-4 h-4" />
              </IconButton>
            </div>
            <div className="space-y-2">
              <div>
                <label htmlFor="ff-trainingpage-0" className="text-[9px] text-rmpg-400 uppercase font-bold">Course Name</label>
                <input id="ff-trainingpage-0" type="text" value={bulkCourseName} onChange={e => setBulkCourseName(e.target.value)}
                  className="input-dark w-full mt-1 text-xs" placeholder="e.g. Annual Firearms Qualification" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="ff-trainingpage-1" className="text-[9px] text-rmpg-400 uppercase font-bold">Category</label>
                  <select id="ff-trainingpage-1" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)} className="input-dark w-full mt-1 text-xs">
                    {CATEGORIES.map(c => <option key={c} value={c}>{toDisplayLabel(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-trainingpage-2" className="text-[9px] text-rmpg-400 uppercase font-bold">Hours</label>
                  <input id="ff-trainingpage-2" type="number" value={bulkHours} onChange={e => setBulkHours(e.target.value)}
                    className="input-dark w-full mt-1 text-xs" />
                </div>
              </div>
              <div>
                <label htmlFor="ff-trainingpage-3" className="text-[9px] text-rmpg-400 uppercase font-bold">Provider</label>
                <input id="ff-trainingpage-3" type="text" value={bulkProvider} onChange={e => setBulkProvider(e.target.value)}
                  className="input-dark w-full mt-1 text-xs" placeholder="Optional" />
              </div>
              <div>
                <label htmlFor="ff-trainingpage-5" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Select Officers ({bulkOfficerIds.length} selected)
                  <button type="button" className="ml-2 text-brand-400 hover:text-brand-300"
                    onClick={() => setBulkOfficerIds(bulkOfficerIds.length === officers.length ? [] : officers.map(o => o.id))}>
                    {bulkOfficerIds.length === officers.length ? 'Deselect All' : 'Select All'}
                  </button>
                </label>
                <div className="max-h-[150px] overflow-y-auto mt-1 border border-rmpg-700 rounded-sm bg-surface-sunken p-1 space-y-0.5">
                  {officers.map(o => (
                    <label key={o.id} htmlFor={`ff-bulk-officer-${o.id}`} className="flex items-center gap-2 px-2 py-1 text-[10px] text-rmpg-200 hover:bg-rmpg-700/50 cursor-pointer">
                      <input id={`ff-bulk-officer-${o.id}`} type="checkbox"
                        checked={bulkOfficerIds.includes(o.id)}
                        onChange={e => setBulkOfficerIds(e.target.checked ? [...bulkOfficerIds, o.id] : bulkOfficerIds.filter(id => id !== o.id))}
                        className="w-3 h-3" />
                      {o.full_name} {o.badge_number ? `(#${o.badge_number})` : ''}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowBulkAssign(false)} className="toolbar-btn text-[10px] px-3 py-1.5">Cancel</button>
              <button type="button" onClick={handleBulkAssign} disabled={bulkSaving || !bulkCourseName || bulkOfficerIds.length === 0}
                className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1.5 disabled:opacity-50">
                {bulkSaving ? 'Assigning...' : `Assign to ${bulkOfficerIds.length} Officer(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DASHBOARD TAB ──────────────────────────────────────────
function DashboardTab({ records, requirements, officers }: {
  records: TrainingRecord[];
  requirements: TrainingRequirement[];
  officers: Officer[];
}) {
  const stats = useMemo(() => {
    const completed = records.filter(r => r.status === 'completed').length;
    const inProgress = records.filter(r => r.status === 'in_progress').length;
    const scheduled = records.filter(r => r.status === 'scheduled').length;
    const overdue = records.filter(r => r.status === 'overdue' || r.status === 'expired').length;
    const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);

    // Expiring within 30 days
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 86400000);
    const expiringSoon = records.filter(r => {
      if (!r.expiry_date) return false;
      const exp = parseTimestamp(r.expiry_date);
      return exp > now && exp < thirtyDays;
    }).length;

    // Per-officer compliance
    const mandatoryReqs = requirements.filter(r => r.is_mandatory);
    const officerCompliance = officers
      .filter(o => ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'].includes(o.role))
      .map(officer => {
        const officerRecs = records.filter(r => r.officer_id === officer.id);
        const completedCourses = new Set(
          officerRecs.filter(r => r.status === 'completed').map(r => r.course_name)
        );
        const requiredForRole = mandatoryReqs.filter(req =>
          req.required_for_roles.includes(officer.role)
        );
        const met = requiredForRole.filter(req => completedCourses.has(req.course_name)).length;
        const total = requiredForRole.length;
        return {
          ...officer,
          met,
          total,
          overdue: total - met,
          compliance: total > 0 ? Math.round((met / total) * 100) : 100,
        };
      })
      .sort((a, b) => a.compliance - b.compliance);

    const avgCompliance = officerCompliance.length > 0
      ? Math.round(officerCompliance.reduce((s, o) => s + o.compliance, 0) / officerCompliance.length)
      : 100;

    // Category breakdown
    const byCategory = CATEGORIES.map(cat => ({
      category: cat,
      total: records.filter(r => r.category === cat).length,
      completed: records.filter(r => r.category === cat && r.status === 'completed').length,
    })).filter(c => c.total > 0);

    const overduePersonnel = officerCompliance.filter(o => o.overdue > 0);
    const overduePercent = officerCompliance.length > 0
      ? Math.round((overduePersonnel.length / officerCompliance.length) * 100) : 0;

    return { completed, inProgress, scheduled, overdue, totalHours, expiringSoon, officerCompliance, avgCompliance, byCategory, overduePersonnel, overduePercent };
  }, [records, requirements, officers]);

  return (
    <div className="p-4 space-y-4">
      {/* Compliance Summary Banner */}
      <div className="panel-beveled p-3 border-l-2 border-l-brand-500" role="region" aria-label="Compliance summary">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="w-3.5 h-3.5 text-brand-400" aria-hidden="true" />
          <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Compliance Summary</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center" role="group" aria-label="Compliance metrics">
          <div>
            <p className="text-lg font-bold font-mono text-brand-300">{officers.length}</p>
            <p className="text-[8px] uppercase font-bold text-rmpg-500">Total Personnel</p>
          </div>
          <div>
            <p className={`text-lg font-bold font-mono ${stats.overduePersonnel.length > 0 ? 'text-red-400' : 'text-green-400'}`}>{stats.overduePersonnel.length}</p>
            <p className="text-[8px] uppercase font-bold text-rmpg-500">Overdue Personnel ({stats.overduePercent}%)</p>
          </div>
          <div>
            <p className="text-lg font-bold font-mono text-orange-400">{stats.expiringSoon}</p>
            <p className="text-[8px] uppercase font-bold text-rmpg-500">Certs Expiring (30d)</p>
          </div>
          <div>
            <p className={`text-lg font-bold font-mono ${stats.avgCompliance >= 90 ? 'text-green-400' : stats.avgCompliance >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{stats.avgCompliance}%</p>
            <p className="text-[8px] uppercase font-bold text-rmpg-500">Avg Compliance</p>
          </div>
        </div>
      </div>

      {/* Summary Cards — v1054 theme sweep: hex literals lifted to
          Tailwind semantic-color tokens (text-brand-*, text-red-*, etc.)
          so day/night themes re-color the numbers without code changes. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        <StatCard value={records.length} label="Total Records" tone="brand" />
        <StatCard value={stats.completed} label="Completed" tone="green" />
        <StatCard value={stats.inProgress} label="In Progress" tone="neutral" />
        <StatCard value={stats.scheduled} label="Scheduled" tone="amber" />
        <StatCard value={stats.overdue} label="Overdue" tone="red" />
        <StatCard value={stats.expiringSoon} label="Expiring (30d)" tone="orange" />
        <StatCard value={`${stats.totalHours}h`} label="Total Hours" tone="purple" />
      </div>

      {/* Compliance Rate — v1054: severity color via semantic Tailwind
          tokens. Background of the progress bar comes from the same green/
          amber/red bg-* class instead of inline hex. */}
      <div className="panel-beveled p-3">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-brand-400" />
          <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Organization Compliance</span>
          <span className={`ml-auto text-lg font-black font-mono ${
            stats.avgCompliance >= 90 ? 'text-green-400' : stats.avgCompliance >= 70 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {stats.avgCompliance}%
          </span>
        </div>
        <div className="h-2 bg-rmpg-700 rounded-sm overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              stats.avgCompliance >= 90 ? 'bg-green-500' : stats.avgCompliance >= 70 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${stats.avgCompliance}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Breakdown */}
        <div className="panel-beveled p-3">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">By Category</span>
          </div>
          <div className="space-y-2">
            {stats.byCategory.map(cat => {
              const pct = cat.total > 0 ? Math.round((cat.completed / cat.total) * 100) : 0;
              return (
                <div key={cat.category} className="flex items-center gap-3">
                  <span className={`w-24 text-[10px] font-bold uppercase border px-1.5 py-0.5 ${CATEGORY_COLORS[cat.category]}`}>
                    {toDisplayLabel(cat.category).toUpperCase()}
                  </span>
                  <div className="flex-1 h-1.5 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-rmpg-300 w-16 text-right">
                    {cat.completed}/{cat.total}
                  </span>
                </div>
              );
            })}
            {stats.byCategory.length === 0 && (
              <p className="text-[11px] text-rmpg-500 text-center py-4">No training records yet.</p>
            )}
          </div>
        </div>

        {/* Officer Compliance Rankings */}
        <div className="panel-beveled p-3">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Officer Compliance</span>
          </div>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {stats.officerCompliance.map(o => (
              <div key={o.id} className="flex items-center gap-2 py-1 border-b border-rmpg-700/30">
                <span className="text-[11px] text-rmpg-100 min-w-0 flex-1 truncate">{o.full_name}</span>
                {o.badge_number && (
                  <span className="text-[9px] font-mono text-rmpg-500">{o.badge_number}</span>
                )}
                <div className="w-16 h-1 bg-rmpg-700 rounded-sm overflow-hidden">
                  <div
                    className={`h-full ${
                      o.compliance >= 90 ? 'bg-green-500' : o.compliance >= 70 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${o.compliance}%` }}
                  />
                </div>
                <span className={`text-[10px] font-mono w-10 text-right ${
                  o.compliance >= 90 ? 'text-green-400' : o.compliance >= 70 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {o.compliance}%
                </span>
              </div>
            ))}
            {stats.officerCompliance.length === 0 && (
              <p className="text-[11px] text-rmpg-500 text-center py-4">No active officers found.</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent overdue / expiring alerts */}
      {(stats.overdue > 0 || stats.expiringSoon > 0) && (
        <div className="panel-beveled p-3 border-l-2 border-l-red-500">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[9px] text-red-400 uppercase font-bold tracking-wider">Attention Required</span>
          </div>
          <div className="space-y-1">
            {records
              .filter(r => r.status === 'overdue' || r.status === 'expired')
              .slice(0, 8)
              .map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[11px]">
                  <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                  <span className="text-rmpg-100">{r.officer_name}</span>
                  <span className="text-rmpg-500">—</span>
                  <span className="text-rmpg-300">{r.course_name}</span>
                  <span className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 ${STATUS_COLORS[r.status].bg} ${STATUS_COLORS[r.status].text} border ${STATUS_COLORS[r.status].border}`}>
                    {toDisplayLabel(String(r.status)).toUpperCase()}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Overdue Personnel Detail */}
      {stats.overduePersonnel.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[9px] text-red-400 uppercase font-bold tracking-wider">
              Overdue Personnel ({stats.overduePersonnel.length})
            </span>
          </div>
          <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
            {stats.overduePersonnel.map(o => (
              <div key={o.id} className="flex items-center gap-2 py-1 px-2 border border-rmpg-700/50 bg-red-900/5">
                <span className="text-[11px] text-rmpg-100 font-medium w-32 truncate">{o.full_name}</span>
                {o.badge_number && <span className="text-[9px] font-mono text-rmpg-500">{o.badge_number}</span>}
                <span className="text-[9px] text-red-400 font-bold">{o.overdue} missing</span>
                <span className={`ml-auto text-[9px] font-mono ${
                  o.compliance >= 90 ? 'text-green-400' : o.compliance >= 70 ? 'text-amber-400' : 'text-red-400'
                }`}>{o.compliance}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 18: Training Materials Library */}
      <TrainingMaterialsPanel />

      {/* Feature 20: Mandatory Training Alerts */}
      <MandatoryTrainingAlerts />
    </div>
  );
}

// ── Feature 18: Training Materials Library Component ──
function TrainingMaterialsPanel() {
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: any[] }>('/personnel/training-materials');
      setMaterials(res.data || []);
    } catch { setMaterials([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (expanded) fetchMaterials(); }, [expanded]);

  return (
    <div className="panel-beveled p-3">
      <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }} className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Training Materials Library</span>
        </div>
        <ChevronRight className={`w-3 h-3 text-rmpg-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>
      {expanded && (
        <div className="mt-2">
          {loading ? (
            <div className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-400 mx-auto" role="status" aria-label="Loading" /></div>
          ) : materials.length === 0 ? (
            <p className="text-[11px] text-rmpg-500 text-center py-4">No training materials uploaded yet.</p>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {materials.map((m: any) => (
                <div key={m.id} className="flex items-center gap-2 py-1 px-2 border border-rmpg-700/30 bg-surface-sunken">
                  <FileText className="w-3 h-3 text-brand-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-rmpg-100 truncate">{m.title}</div>
                    {m.description && <div className="text-[9px] text-rmpg-500 truncate">{m.description}</div>}
                  </div>
                  <span className={`text-[8px] uppercase border px-1.5 py-0.5 ${CATEGORY_COLORS[m.category] || CATEGORY_COLORS.other}`}>
                    {formatEnumValue(m.category)}
                  </span>
                  {m.file_url && (
                    <a href={m.file_url} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300">
                      <Archive className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Feature 20: Mandatory Training Alerts ──
function MandatoryTrainingAlerts() {
  const [alerts, setAlerts] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/personnel/training-alerts');
      setAlerts(res);
    } catch { setAlerts(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (expanded) fetchAlerts(); }, [expanded]);

  return (
    <div className="panel-beveled p-3 border-l-2 border-l-amber-500">
      <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }} className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[9px] text-amber-400 uppercase font-bold tracking-wider">
            Mandatory Training Alerts {alerts ? `(${alerts.total_alerts})` : ''}
          </span>
        </div>
        <ChevronRight className={`w-3 h-3 text-rmpg-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>
      {expanded && (
        <div className="mt-2">
          {loading ? (
            <div className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-400 mx-auto" role="status" aria-label="Loading" /></div>
          ) : !alerts || alerts.total_alerts === 0 ? (
            <p className="text-[11px] text-green-400 text-center py-4">All officers are current on mandatory training!</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="bg-red-900/20 border border-red-700/30 p-1.5 rounded-sm">
                  <div className="font-bold text-red-400">{alerts.expired}</div>
                  <div className="text-rmpg-400">Expired</div>
                </div>
                <div className="bg-amber-900/20 border border-amber-700/30 p-1.5 rounded-sm">
                  <div className="font-bold text-amber-400">{alerts.expiring_soon}</div>
                  <div className="text-rmpg-400">Expiring Soon</div>
                </div>
                <div className="bg-rmpg-800/20 border border-rmpg-700/30 p-1.5 rounded-sm">
                  <div className="font-bold text-rmpg-300">{alerts.never_completed}</div>
                  <div className="text-rmpg-400">Never Completed</div>
                </div>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-1">
                {alerts.alerts.slice(0, 20).map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      a.alert_type === 'expired' ? 'bg-red-500' : a.alert_type === 'expiring_soon' ? 'bg-amber-500' : 'bg-rmpg-500'
                    }`} />
                    <span className="text-rmpg-200 w-28 truncate">{a.officer_name}</span>
                    <span className="text-rmpg-400 min-w-0 flex-1 truncate">{a.course_name}</span>
                    <span className={`text-[9px] font-bold ${
                      a.alert_type === 'expired' ? 'text-red-400' : a.alert_type === 'expiring_soon' ? 'text-amber-400' : 'text-rmpg-500'
                    }`}>
                      {a.alert_type === 'expired' ? `${a.days_overdue}d overdue` :
                       a.alert_type === 'expiring_soon' ? `${Math.abs(a.days_overdue)}d left` :
                       'Never done'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// v1054: rewritten to use semantic-color Tailwind tokens (text-brand-*,
// border-red-*, etc.) instead of inline hex literals — re-themes between
// night and day with zero code changes. The previous prop shape ({ color,
// borderColor }) baked in a single hex per card.
type StatTone = 'brand' | 'green' | 'amber' | 'red' | 'orange' | 'purple' | 'neutral';

const STAT_TONE: Record<StatTone, { text: string; label: string; border: string }> = {
  brand:   { text: 'text-brand-400',   label: 'text-brand-500/80',   border: 'border-t-brand-600' },
  green:   { text: 'text-green-400',   label: 'text-green-500/80',   border: 'border-t-green-700' },
  amber:   { text: 'text-amber-400',   label: 'text-amber-500/80',   border: 'border-t-amber-700' },
  red:     { text: 'text-red-400',     label: 'text-red-500/80',     border: 'border-t-red-700' },
  orange:  { text: 'text-orange-400',  label: 'text-orange-500/80',  border: 'border-t-orange-700' },
  purple:  { text: 'text-purple-400',  label: 'text-purple-500/80',  border: 'border-t-purple-700' },
  neutral: { text: 'text-rmpg-300',    label: 'text-rmpg-500',       border: 'border-t-rmpg-600' },
};

function StatCard({ value, label, tone = 'brand' }: { value: string | number; label: string; tone?: StatTone }) {
  const t = STAT_TONE[tone];
  return (
    <div className={`panel-beveled p-2.5 text-center border-t-2 ${t.border}`}>
      <p className={`text-lg font-bold font-mono ${t.text}`}>{value}</p>
      <p className={`text-[8px] uppercase font-bold tracking-wider ${t.label}`}>{label}</p>
    </div>
  );
}

// ── RECORDS TAB ────────────────────────────────────────────
function RecordsTab({
  records, requirements, officers, isAdmin, onEdit, onDelete, onPrint,
  statusFilter, setStatusFilter, officerFilter, setOfficerFilter, onAdd,
}: {
  records: TrainingRecord[];
  requirements: TrainingRequirement[];
  officers: Officer[];
  isAdmin: boolean;
  onEdit: (r: TrainingRecord) => void;
  onDelete: (r: TrainingRecord) => void;
  onPrint: (r: TrainingRecord) => void;
  // Lifted to the parent for ?officer_id= / ?status= deep-links (v1054).
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  officerFilter: string;
  setOfficerFilter: (s: string) => void;
  // Empty-state CTA hook — when isAdmin and there are zero records.
  onAdd?: () => void;
}) {
  void requirements; // currently unused at this layer; reserved for join
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const [categoryFilter, setCategoryFilter] = useState<'all' | TrainingCategory>('all');

  const filtered = useMemo(() => {
    let result = records;
    if (statusFilter === 'expiring_soon') {
      const now = new Date();
      const thirtyDays = new Date();
      thirtyDays.setDate(thirtyDays.getDate() + 30);
      result = result.filter(r => {
        if (!r.expiry_date) return false;
        const exp = parseTimestamp(r.expiry_date);
        return exp > now && exp <= thirtyDays;
      });
    } else if (statusFilter !== 'all') {
      result = result.filter(r => r.status === statusFilter);
    }
    if (categoryFilter !== 'all') result = result.filter(r => r.category === categoryFilter);
    if (officerFilter !== 'all') result = result.filter(r => r.officer_id === officerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.course_name.toLowerCase().includes(q) ||
        r.officer_name?.toLowerCase().includes(q) ||
        r.provider?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [records, statusFilter, categoryFilter, officerFilter, search]);

  return (
    <div className="p-4 space-y-3">
      {/* Filters */}
      <div className="panel-inset p-2 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input id="ff-trainingpage-5"
            ref={searchRef}
            type="text"
            placeholder="Search... (/)" aria-label="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`input-dark text-[11px] pl-6 ${search ? 'pr-7' : 'pr-2'} py-1 w-40 min-h-[36px]`}
          />
          {search && (
            <IconButton onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300" aria-label="Clear search">
              <X className="w-3 h-3" />
            </IconButton>
          )}
        </div>
        <select id="ff-trainingpage-6"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="input-dark text-[10px] px-2 py-1 min-h-[36px]"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="in_progress">In Progress</option>
          <option value="scheduled">Scheduled</option>
          <option value="overdue">Overdue</option>
          <option value="expired">Expired</option>
          <option value="expiring_soon">Expiring in 30 Days</option>
        </select>
        <select id="ff-trainingpage-7"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value as any)}
          className="input-dark text-[10px] px-2 py-1 min-h-[36px]"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{toDisplayLabel(c).toUpperCase()}</option>
          ))}
        </select>
        <select id="ff-trainingpage-8"
          value={officerFilter}
          onChange={e => setOfficerFilter(e.target.value)}
          className="input-dark text-[10px] px-2 py-1 min-h-[36px]"
        >
          <option value="all">All Officers</option>
          {officers.map(o => (
            <option key={o.id} value={o.id}>{o.full_name}</option>
          ))}
        </select>
        <span className="text-[10px] text-rmpg-500 ml-auto">{filtered.length} records</span>
        <button
          type="button"
          className="toolbar-btn"
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('training-records.csv', trainingRecordsToCsv(filtered.map((r) => ({
            course_name: r.course_name,
            status: r.status,
            completed_at: r.completed_date,
            due_date: r.expiry_date,
          }))))}
        >CSV</button>
      </div>

      {/* Records Table — empty-state distinction (v1054):
          • Zero records in the whole DB → "No records yet" + Add CTA (admin).
          • Records exist but all filtered out → "No records match" + Clear filters.
          Previously rendered the same generic line regardless, so an
          operator with active filters couldn't tell if it was a server
          error / no data / over-filtered. */}
      {filtered.length === 0 ? (
        records.length === 0 ? (
          <EmptyState
            icon={FileText}
            message="No training records yet."
            cta={onAdd ? { label: 'Add training record', onClick: onAdd } : undefined}
          />
        ) : (
          <EmptyState
            icon={FileText}
            message="No records match your filters."
            cta={(search || statusFilter !== 'all' || categoryFilter !== 'all' || officerFilter !== 'all') ? {
              label: 'Clear filters',
              onClick: () => {
                setSearch('');
                setStatusFilter('all');
                setCategoryFilter('all');
                setOfficerFilter('all');
              },
            } : undefined}
          />
        )
      ) : (
        <div className="panel-beveled overflow-x-auto">
          <table className="table-dark w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left py-1.5 px-2">Officer</th>
                <th className="text-left py-1.5 px-2">Course</th>
                <th className="text-left py-1.5 px-2">Category</th>
                <th className="text-left py-1.5 px-2">Provider</th>
                <th className="text-left py-1.5 px-2">Completed</th>
                <th className="text-left py-1.5 px-2">Expiry</th>
                <th className="text-right py-1.5 px-2">Hours</th>
                <th className="text-right py-1.5 px-2">Score</th>
                <th className="text-left py-1.5 px-2">Status</th>
                {isAdmin && <th className="text-center py-1.5 px-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(record => (
                <tr key={record.id} className="border-t border-rmpg-700/50 hover:bg-surface-raised/50 transition-colors">
                  <td className="py-1.5 px-2 text-rmpg-100">{record.officer_name}</td>
                  <td className="py-1.5 px-2 text-rmpg-100 font-medium">{record.course_name}</td>
                  <td className="py-1.5 px-2">
                    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase border ${CATEGORY_COLORS[record.category] || CATEGORY_COLORS.other}`}>
                      {toDisplayLabel(record.category).toUpperCase()}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-rmpg-400">{record.provider || '—'}</td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">
                    {record.completed_date ? formatDate(record.completed_date) : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">
                    {record.expiry_date ? (
                      <span className="flex items-center gap-1">
                        <span className={
                          parseTimestamp(record.expiry_date) < new Date() ? 'text-red-400 font-bold' :
                          parseTimestamp(record.expiry_date) <= new Date(Date.now() + 30 * 86400000) ? 'text-amber-400' :
                          parseTimestamp(record.expiry_date) <= new Date(Date.now() + 60 * 86400000) ? 'text-yellow-400' : ''
                        }>{formatDate(record.expiry_date)}</span>
                        {(() => {
                          const days = Math.ceil((parseTimestamp(record.expiry_date).getTime() - Date.now()) / 86400000);
                          if (days < 0) return <span className="text-[8px] px-1 py-0 bg-red-900/50 text-red-400 border border-red-700/50 font-bold uppercase animate-pulse">EXPIRED {Math.abs(days)}d</span>;
                          if (days <= 30) return <span className="text-[8px] px-1 py-0 bg-red-900/50 text-red-400 border border-red-700/50 font-bold uppercase">{days}d LEFT</span>;
                          if (days <= 60) return <span className="text-[8px] px-1 py-0 bg-amber-900/50 text-amber-400 border border-amber-700/50 font-bold uppercase">{days}d LEFT</span>;
                          return <span className="text-[8px] px-1 py-0 text-green-400 font-mono">{days}d</span>;
                        })()}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-right text-rmpg-200 font-mono">{record.hours || 0}</td>
                  <td className="py-1.5 px-2 text-right text-rmpg-200 font-mono">{record.score ?? '—'}</td>
                  <td className="py-1.5 px-2">
                    <StatusBadge status={record.status} />
                  </td>
                  {isAdmin && (
                    <td className="py-1.5 px-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <IconButton
                          onClick={() => onPrint(record)}
                          className="toolbar-btn p-1"
                          title="Print court-ready training certificate PDF"
                          aria-label={`Print training certificate for record ${record.id}`}
                        >
                          <Printer className="w-3 h-3" />
                        </IconButton>
                        <IconButton onClick={() => onEdit(record)} className="toolbar-btn p-1" title="Edit" aria-label={`Edit training record ${record.id}`}>
                          <Edit2 className="w-3 h-3" />
                        </IconButton>
                        <IconButton onClick={() => onDelete(record)} className="toolbar-btn p-1 text-red-400 hover:text-red-300" title="Delete" aria-label={`Delete training record ${record.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </IconButton>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── REQUIREMENTS TAB ───────────────────────────────────────
function RequirementsTab({ requirements, records, officers, isAdmin, onAdd, onEdit, onDelete }: {
  requirements: TrainingRequirement[];
  records: TrainingRecord[];
  officers: Officer[];
  isAdmin: boolean;
  onAdd: () => void;
  onEdit: (r: TrainingRequirement) => void;
  onDelete: (r: TrainingRequirement) => void;
}) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">
          {requirements.length} Training Requirements
        </span>
        {isAdmin && (
          <button type="button" onClick={onAdd} className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1">
            <Plus className="w-3 h-3" />
            Add Requirement
          </button>
        )}
      </div>

      {requirements.length === 0 ? (
        <EmptyState icon={Target} message="No training requirements defined." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {requirements.map(req => {
            // Count how many officers have completed this
            const activeOfficers = officers.filter(o =>
              req.required_for_roles.includes(o.role)
            );
            const completedCount = activeOfficers.filter(o =>
              records.some(r => r.officer_id === o.id && r.course_name === req.course_name && r.status === 'completed')
            ).length;
            const pct = activeOfficers.length > 0 ? Math.round((completedCount / activeOfficers.length) * 100) : 0;

            return (
              <div key={req.id} className="panel-beveled p-3 bg-surface-base">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-bold text-rmpg-100">{req.course_name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase border ${CATEGORY_COLORS[req.category] || CATEGORY_COLORS.other}`}>
                        {toDisplayLabel(req.category).toUpperCase()}
                      </span>
                      {req.is_mandatory && (
                        <span className="text-[8px] font-bold uppercase bg-red-900/50 text-red-400 border border-red-700/50 px-1.5 py-0.5">
                          Mandatory
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <IconButton onClick={() => onEdit(req)} className="toolbar-btn p-1" title="Edit" aria-label={`Edit requirement ${req.id}`}>
                        <Edit2 className="w-3 h-3" />
                      </IconButton>
                      <IconButton onClick={() => onDelete(req)} className="toolbar-btn p-1 text-red-400" title="Delete" aria-label={`Delete requirement ${req.id}`}>
                        <Trash2 className="w-3 h-3" />
                      </IconButton>
                    </div>
                  )}
                </div>

                {req.description && (
                  <p className="text-[11px] text-rmpg-400 mb-2">{req.description}</p>
                )}

                <div className="grid grid-cols-3 gap-2 text-[10px] text-rmpg-400 mb-2">
                  <div>
                    <span className="text-rmpg-500">Roles: </span>
                    <span className="text-rmpg-300">{(Array.isArray(req.required_for_roles) ? req.required_for_roles : (() => { try { return JSON.parse(req.required_for_roles || '[]'); } catch { return []; } })()).map((r: string) => toDisplayLabel(r).toUpperCase()).join(', ') || '—'}</span>
                  </div>
                  <div>
                    <span className="text-rmpg-500">Min Hours: </span>
                    <span className="text-rmpg-300 font-mono">{req.minimum_hours || '—'}</span>
                  </div>
                  <div>
                    <span className="text-rmpg-500">Renewal: </span>
                    <span className="text-rmpg-300 font-mono">{req.renewal_period_months ? `${req.renewal_period_months}mo` : 'None'}</span>
                  </div>
                </div>

                {/* Compliance bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-rmpg-300">
                    {completedCount}/{activeOfficers.length} ({pct}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CALENDAR TAB ───────────────────────────────────────────
function CalendarTab({ records, requirements }: {
  records: TrainingRecord[];
  requirements: TrainingRequirement[];
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const { year, month } = viewMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // Events for this month
  const monthEvents = useMemo(() => {
    const events: { day: number; type: 'completed' | 'expiring' | 'scheduled'; record: TrainingRecord }[] = [];
    for (const r of records) {
      if (r.completed_date) {
        const d = parseTimestamp(r.completed_date);
        if (d.getFullYear() === year && d.getMonth() === month) {
          events.push({ day: d.getDate(), type: 'completed', record: r });
        }
      }
      if (r.expiry_date) {
        const d = parseTimestamp(r.expiry_date);
        if (d.getFullYear() === year && d.getMonth() === month) {
          events.push({ day: d.getDate(), type: 'expiring', record: r });
        }
      }
      if (r.status === 'scheduled' && r.created_at) {
        const d = parseTimestamp(r.created_at);
        if (d.getFullYear() === year && d.getMonth() === month) {
          events.push({ day: d.getDate(), type: 'scheduled', record: r });
        }
      }
    }
    return events;
  }, [records, year, month]);

  const prevMonth = () => {
    setViewMonth(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
  };
  const nextMonth = () => {
    setViewMonth(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
  };

  const monthName = new Date(year, month).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const days: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  return (
    <div className="p-4 space-y-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={prevMonth} className="toolbar-btn text-[10px] px-3 py-1">← Prev</button>
        <span className="text-sm font-bold text-rmpg-100">{monthName}</span>
        <button type="button" onClick={nextMonth} className="toolbar-btn text-[10px] px-3 py-1">Next →</button>
      </div>

      {/* Calendar grid */}
      <div className="panel-beveled">
        <div className="grid grid-cols-7">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider text-center py-2 border-b border-rmpg-700">
              {d}
            </div>
          ))}
          {days.map((day, i) => {
            const dayEvents = day ? monthEvents.filter(e => e.day === day) : [];
            return (
              <div
                key={i}
                className={`min-h-[80px] border-b border-r border-rmpg-700/30 p-1 ${
                  day && isToday(day) ? 'bg-brand-900/20' : day ? 'bg-surface-base' : 'bg-surface-sunken'
                }`}
              >
                {day && (
                  <>
                    <span className={`text-[10px] font-mono ${isToday(day) ? 'text-brand-400 font-bold' : 'text-rmpg-400'}`}>
                      {day}
                    </span>
                    <div className="space-y-0.5 mt-0.5">
                      {dayEvents.slice(0, 3).map((ev, j) => (
                        <div
                          key={j}
                          className={`text-[8px] px-1 py-0.5 truncate rounded-sm ${
                            ev.type === 'completed' ? 'bg-green-900/40 text-green-400' :
                            ev.type === 'expiring' ? 'bg-red-900/40 text-red-400' :
                            'bg-amber-900/40 text-amber-400'
                          }`}
                          title={`${ev.record.officer_name}: ${ev.record.course_name}`}
                        >
                          {ev.record.course_name}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[8px] text-rmpg-500">+{dayEvents.length - 3} more</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 bg-green-900/60 rounded-sm" />
          <span className="text-rmpg-400">Completed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 bg-red-900/60 rounded-sm" />
          <span className="text-rmpg-400">Expiring</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 bg-amber-900/60 rounded-sm" />
          <span className="text-rmpg-400">Scheduled</span>
        </div>
      </div>
    </div>
  );
}

// ── Shared Components ──────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.scheduled;
  const icons: Record<string, React.ElementType> = {
    completed: CheckCircle,
    in_progress: Clock,
    scheduled: BookOpen,
    overdue: AlertTriangle,
    expired: AlertTriangle,
  };
  const Icon = icons[status] || BookOpen;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase ${s.bg} ${s.text} border ${s.border}`}>
      <Icon className="w-2.5 h-2.5" />
      {toDisplayLabel(status).toUpperCase()}
    </span>
  );
}

function EmptyState({
  icon: Icon, message, cta,
}: {
  icon: React.ElementType;
  message: string;
  // v1054: optional CTA — used by RecordsTab to disambiguate "no data" vs
  // "no match for current filters".
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 bg-rmpg-700/20 border border-rmpg-700/30 flex items-center justify-center mb-4 panel-inset">
        <Icon className="w-7 h-7 text-rmpg-500" style={{ opacity: 0.7 }} />
      </div>
      <p className="text-sm text-rmpg-300">{message}</p>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1.5 mt-3 flex items-center gap-1.5"
        >
          {cta.label.toLowerCase().includes('filter') ? <FilterX className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {cta.label}
        </button>
      )}
    </div>
  );
}

// ── RECORD MODAL ───────────────────────────────────────────
function RecordModal({ record, officers, requirements, onSave, onClose }: {
  record: TrainingRecord | null;
  officers: Officer[];
  requirements: TrainingRequirement[];
  onSave: (data: Partial<TrainingRecord>) => void;
  onClose: () => void;
}) {
  const isEdit = !!record;
  const [form, setForm] = useState({
    officer_id: record?.officer_id || '',
    course_name: record?.course_name || '',
    category: record?.category || 'other' as TrainingCategory,
    provider: record?.provider || '',
    completed_date: record?.completed_date || '',
    expiry_date: record?.expiry_date || '',
    score: record?.score ?? '',
    hours: record?.hours ?? 0,
    certificate_number: record?.certificate_number || '',
    status: record?.status || 'scheduled' as TrainingStatus,
    notes: record?.notes || '',
  });

  const update = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = () => {
    if (!form.officer_id || !form.course_name) return;
    onSave({
      ...form,
      score: form.score === '' ? undefined : Number(form.score),
      hours: Number(form.hours) || 0,
    } as any);
  };

  // Autofill from requirement selection
  const handleCourseSelect = (courseName: string) => {
    update('course_name', courseName);
    const req = requirements.find(r => r.course_name === courseName);
    if (req) {
      update('category', req.category);
      if (req.minimum_hours) update('hours', req.minimum_hours);
    }
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="panel-beveled bg-surface-base w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-3 border-b border-rmpg-700">
          <h2 className="text-sm font-bold text-rmpg-100">
            {isEdit ? 'Edit Training Record' : 'Add Training Record'}
          </h2>
          <IconButton onClick={onClose} className="toolbar-btn p-1" aria-label="Close" title="Close"><X className="w-4 h-4" /></IconButton>
        </div>

        <div className="p-4 space-y-3">
          {/* Officer */}
          <div>
            <label htmlFor="ff-trainingpage-9" className="field-label mb-1 block">Officer *</label>
            <select id="ff-trainingpage-9"
              value={form.officer_id}
              onChange={e => update('officer_id', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
            >
              <option value="">Select officer...</option>
              {officers.map(o => (
                <option key={o.id} value={o.id}>{o.full_name} {o.badge_number ? `(${o.badge_number})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Course Name (with requirement suggestions) */}
          <div>
            <label htmlFor="ff-trainingpage-10" className="field-label mb-1 block">Course Name *</label>
            <input id="ff-trainingpage-10"
              list="course-suggestions"
              type="text"
              value={form.course_name}
              onChange={e => handleCourseSelect(e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              placeholder="e.g. Firearms Qualification"
            />
            <datalist id="course-suggestions">
              {requirements.map(r => (
                <option key={r.id} value={r.course_name} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label htmlFor="ff-trainingpage-11" className="field-label mb-1 block">Category</label>
              <select id="ff-trainingpage-11"
                value={form.category}
                onChange={e => update('category', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{toDisplayLabel(c).toUpperCase()}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label htmlFor="ff-trainingpage-12" className="field-label mb-1 block">Status</label>
              <select id="ff-trainingpage-12"
                value={form.status}
                onChange={e => update('status', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              >
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="overdue">Overdue</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>

          {/* Provider */}
          <div>
            <label htmlFor="ff-trainingpage-13" className="field-label mb-1 block">Provider</label>
            <input id="ff-trainingpage-13"
              type="text"
              value={form.provider}
              onChange={e => update('provider', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              placeholder="e.g. Utah POST, RMPG Internal"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Completed Date */}
            <div>
              <label htmlFor="ff-trainingpage-14" className="field-label mb-1 block">Completed Date</label>
              <input id="ff-trainingpage-14"
                type="date"
                value={form.completed_date}
                onChange={e => update('completed_date', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              />
            </div>
            {/* Expiry Date */}
            <div>
              <label htmlFor="ff-trainingpage-15" className="field-label mb-1 block">Expiry Date</label>
              <input id="ff-trainingpage-15"
                type="date"
                value={form.expiry_date}
                onChange={e => update('expiry_date', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* Hours */}
            <div>
              <label htmlFor="ff-trainingpage-16" className="field-label mb-1 block">Hours</label>
              <input id="ff-trainingpage-16"
                type="number"
                value={form.hours}
                onChange={e => update('hours', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                min="0"
                step="0.5"
              />
            </div>
            {/* Score */}
            <div>
              <label htmlFor="ff-trainingpage-17" className="field-label mb-1 block">Score</label>
              <input id="ff-trainingpage-17"
                type="number"
                value={form.score}
                onChange={e => update('score', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                min="0"
                max="100"
              />
            </div>
            {/* Certificate Number */}
            <div>
              <label htmlFor="ff-trainingpage-18" className="field-label mb-1 block">Cert #</label>
              <input id="ff-trainingpage-18"
                type="text"
                value={form.certificate_number}
                onChange={e => update('certificate_number', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="field-label mb-1 block">Notes</label>
            <RichTextArea
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 h-16 resize-none min-h-[36px]"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t border-rmpg-700">
          <button type="button" onClick={onClose} className="toolbar-btn text-[10px] px-4 py-1.5">Cancel</button>
          <button type="button"
            onClick={handleSubmit}
            disabled={!form.officer_id || !form.course_name}
            className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5"
          >
            {isEdit ? 'Save Changes' : 'Add Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── REQUIREMENT MODAL ──────────────────────────────────────
function RequirementModal({ requirement, onSave, onClose }: {
  requirement: TrainingRequirement | null;
  onSave: (data: Partial<TrainingRequirement>) => void;
  onClose: () => void;
}) {
  const isEdit = !!requirement;
  const [form, setForm] = useState({
    course_name: requirement?.course_name || '',
    category: requirement?.category || 'other' as TrainingCategory,
    required_for_roles: requirement?.required_for_roles || [] as string[],
    renewal_period_months: requirement?.renewal_period_months ?? '',
    minimum_hours: requirement?.minimum_hours ?? 0,
    is_mandatory: requirement?.is_mandatory ?? true,
    description: requirement?.description || '',
  });

  const update = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const toggleRole = (role: string) => {
    setForm(prev => ({
      ...prev,
      required_for_roles: prev.required_for_roles.includes(role)
        ? prev.required_for_roles.filter(r => r !== role)
        : [...prev.required_for_roles, role],
    }));
  };

  const handleSubmit = () => {
    if (!form.course_name) return;
    onSave({
      ...form,
      renewal_period_months: form.renewal_period_months === '' ? 0 : Number(form.renewal_period_months),
      minimum_hours: Number(form.minimum_hours) || 0,
    } as any);
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="panel-beveled bg-surface-base w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-3 border-b border-rmpg-700">
          <h2 className="text-sm font-bold text-rmpg-100">
            {isEdit ? 'Edit Requirement' : 'Add Training Requirement'}
          </h2>
          <IconButton onClick={onClose} className="toolbar-btn p-1" aria-label="Close" title="Close"><X className="w-4 h-4" /></IconButton>
        </div>

        <div className="p-4 space-y-3">
          {/* Course Name */}
          <div>
            <label htmlFor="ff-trainingpage-19" className="field-label mb-1 block">Course Name *</label>
            <input id="ff-trainingpage-19"
              type="text"
              value={form.course_name}
              onChange={e => update('course_name', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              placeholder="e.g. Annual Firearms Qualification"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label htmlFor="ff-trainingpage-20" className="field-label mb-1 block">Category</label>
              <select id="ff-trainingpage-20"
                value={form.category}
                onChange={e => update('category', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{toDisplayLabel(c).toUpperCase()}</option>
                ))}
              </select>
            </div>

            {/* Mandatory */}
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input id="ff-trainingpage-21"
                  type="checkbox"
                  checked={form.is_mandatory}
                  onChange={e => update('is_mandatory', e.target.checked)}
                  className="accent-brand-500"
                />
                <span className="text-[11px] text-rmpg-300">Mandatory</span>
              </label>
            </div>
          </div>

          {/* Required for Roles */}
          <div>
            <label className="field-label mb-1 block">Required for Roles</label>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map(role => (
                <button type="button"
                  key={role}
                  onClick={() => toggleRole(role)}
                  className={`text-[10px] px-2 py-1 capitalize ${
                    form.required_for_roles.includes(role) ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'
                  }`}
                >
                  {toDisplayLabel(role).toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Renewal Period */}
            <div>
              <label htmlFor="ff-trainingpage-22" className="field-label mb-1 block">Renewal (months)</label>
              <input id="ff-trainingpage-22"
                type="number"
                value={form.renewal_period_months}
                onChange={e => update('renewal_period_months', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                min="0"
                placeholder="0 = no renewal"
              />
            </div>

            {/* Minimum Hours */}
            <div>
              <label htmlFor="ff-trainingpage-23" className="field-label mb-1 block">Minimum Hours</label>
              <input id="ff-trainingpage-23"
                type="number"
                value={form.minimum_hours}
                onChange={e => update('minimum_hours', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                min="0"
                step="0.5"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="field-label mb-1 block">Description</label>
            <RichTextArea
              value={form.description}
              onChange={e => update('description', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 h-16 resize-none min-h-[36px]"
              placeholder="Brief description of this requirement..."
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t border-rmpg-700">
          <button type="button" onClick={onClose} className="toolbar-btn text-[10px] px-4 py-1.5">Cancel</button>
          <button type="button"
            onClick={handleSubmit}
            disabled={!form.course_name}
            className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5"
          >
            {isEdit ? 'Save Changes' : 'Add Requirement'}
          </button>
        </div>
      </div>
    </div>
  );
}
