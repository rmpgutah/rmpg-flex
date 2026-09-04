// ============================================================
// RMPG Flex — Code Enforcement Page
// ============================================================
// Municipal code violations and vehicle tow management with
// tabbed interface, status workflows, and fine tracking.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  Construction, Search, Plus, Truck, MapPin, Clock,
  X, Save, Loader2, AlertTriangle, FileText, Eye, Calendar,
} from 'lucide-react';
import type { CodeViolation, VehicleTow, ViolationType, TowReason } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import ExportButton from '../components/ExportButton';
import { apiFetch } from '../hooks/useApi';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useDistrictOptions } from '../hooks/useDistrictLookup';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';
import { useFormDraft } from '../hooks/useFormDraft';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { isValidVIN, isValidPlate } from '../utils/validate';
import { localToday, safeDateStr, safeDateTimeStr, parseTimestamp } from '../utils/dateUtils';
import { formatAddressDisplay } from '../utils/statusLabels';
import { toDisplayLabel } from '../utils/formatters';
import EmptyState from '../components/EmptyState';
import { openCodeViolationNoticePdf, openTowOrderPdf } from '../utils/codeEnforcementPdf';
import { useAuth } from '../context/AuthContext';
import { codeViolationsToCsv, towOrdersToCsv, downloadTextFile } from '../utils/rmsListExport';

const VIOLATION_TYPES: { value: ViolationType; label: string }[] = [
  { value: 'noise', label: 'Noise' }, { value: 'property_maintenance', label: 'Property Maintenance' },
  { value: 'zoning', label: 'Zoning' }, { value: 'signage', label: 'Signage' },
  { value: 'health', label: 'Health' }, { value: 'fire', label: 'Fire' },
  { value: 'nuisance', label: 'Nuisance' }, { value: 'other', label: 'Other' },
];

const VIOLATION_STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-900/50 text-red-400 border-red-700/50',
  notice_sent: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  reinspection: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
  resolved: 'bg-green-900/50 text-green-400 border-green-700/50',
  referred: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  voided: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const TOW_STATUS_COLORS: Record<string, string> = {
  ordered: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
  dispatched: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
  in_progress: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  completed: 'bg-green-900/50 text-green-400 border-green-700/50',
  released: 'bg-teal-900/50 text-teal-400 border-teal-700/50',
  cancelled: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const TOW_REASONS: { value: TowReason; label: string }[] = [
  { value: 'parking_violation', label: 'Parking Violation' }, { value: 'abandoned', label: 'Abandoned' },
  { value: 'evidence', label: 'Evidence' }, { value: 'accident', label: 'Accident' },
  { value: 'stolen_recovery', label: 'Stolen Recovery' }, { value: 'private_property', label: 'Private Property' },
  { value: 'other', label: 'Other' },
];

const EMPTY_VIOLATION = {
  violation_type: 'other' as ViolationType, location: '', description: '',
  code_section: '', severity: 'low', fine_amount: '', compliance_deadline: '', notes: '',
  sector_id: '', zone_id: '', beat_id: '',
};

const EMPTY_TOW = {
  vehicle_year: '', vehicle_make: '', vehicle_model: '', vehicle_color: '',
  vehicle_plate: '', vehicle_vin: '', tow_from: '', tow_to: '',
  tow_reason: 'parking_violation' as TowReason, tow_company: '', tow_fee: '', storage_fee: '', notes: '',
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

export default function CodeEnforcementPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  // admin/manager/supervisor can void violations, cancel tows, and create records
  const canEnforce = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
  const { sections: sectionOptions, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  const { errors: vFormErrors, validate: validateVForm, clearAllErrors: clearVErrors } = useFormValidation();
  const { errors: tFormErrors, validate: validateTForm, clearAllErrors: clearTErrors } = useFormValidation();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const [activeTab, setActiveTab] = useState<'violations' | 'tows'>('violations');

  // Violations state
  const [violations, setViolations] = useState<CodeViolation[]>([]);
  const [selectedViolation, setSelectedViolation] = useState<CodeViolation | null>(null);
  const [vLoading, setVLoading] = useState(true);
  const [vSearch, setVSearch] = useState('');
  const [vFilterStatus, setVFilterStatus] = useState('');
  const [vPage, setVPage] = useState(1);
  const [vTotalPages, setVTotalPages] = useState(1);
  const [vTotalCount, setVTotalCount] = useState(0);

  // Tows state
  const [tows, setTows] = useState<VehicleTow[]>([]);
  const [selectedTow, setSelectedTow] = useState<VehicleTow | null>(null);
  const [tLoading, setTLoading] = useState(true);
  const [tSearch, setTSearch] = useState('');
  const [tFilterStatus, setTFilterStatus] = useState('');
  const [tPage, setTPage] = useState(1);
  const [tTotalPages, setTTotalPages] = useState(1);
  const [tTotalCount, setTTotalCount] = useState(0);

  // Stats
  const [stats, setStats] = useState<any>(null);
  const [fetchError, setFetchError] = useState('');

  // Reinspection scheduling
  const [showReinspection, setShowReinspection] = useState(false);
  const [reinspectionDate, setReinspectionDate] = useState('');
  const [schedulingReinspection, setSchedulingReinspection] = useState(false);

  // Property violation history
  const [propertyHistory, setPropertyHistory] = useState<any>(null);

  // Forms
  const [vFormOpen, setVFormOpen] = useState(false);
  const {
    form: vFormData,
    setForm: setVFormData,
    isDirty: vFormIsDirty,
    wasRestored: vFormWasRestored,
    clearDraft: clearVFormDraft,
    snapshot: snapshotVForm,
  } = useFormDraft<typeof EMPTY_VIOLATION>({
    storageKey: 'rmpg_code_violation_form',
    defaultValue: EMPTY_VIOLATION,
    isActive: vFormOpen,
  });
  const [tFormOpen, setTFormOpen] = useState(false);
  const {
    form: tFormData,
    setForm: setTFormData,
    isDirty: tFormIsDirty,
    wasRestored: tFormWasRestored,
    clearDraft: clearTFormDraft,
    snapshot: snapshotTForm,
  } = useFormDraft<typeof EMPTY_TOW>({
    storageKey: 'rmpg_code_tow_form',
    defaultValue: EMPTY_TOW,
    isActive: tFormOpen,
  });
  const [submitting, setSubmitting] = useState(false);

  // ── ConfirmDialog state ───────────────────────────────────────────────
  // Destructive status transitions (void violation / cancel tow) require an
  // explicit confirmation and are restricted to admin/manager/supervisor.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPending, setConfirmPending] = useState<(() => Promise<void>) | null>(null);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmDetails, setConfirmDetails] = useState<React.ReactNode>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  const openConfirm = useCallback((opts: {
    title: string;
    message: string;
    details?: React.ReactNode;
    onConfirm: () => Promise<void>;
  }) => {
    setConfirmTitle(opts.title);
    setConfirmMessage(opts.message);
    setConfirmDetails(opts.details ?? null);
    setConfirmPending(() => opts.onConfirm);
    setConfirmOpen(true);
  }, []);

  const handleConfirmAction = useCallback(async () => {
    if (!confirmPending) return;
    setConfirmSubmitting(true);
    try { await confirmPending(); } finally {
      setConfirmSubmitting(false);
      setConfirmOpen(false);
      setConfirmPending(null);
    }
  }, [confirmPending]);

  // NOTE: 5 unused state+handler blocks (severityScore, compTimeline, fineCalc,
  // compDashboard, geoClusters) were declared but never rendered or called — dead
  // since this page was first stubbed. Removed in v1036 to drop the bundle weight
  // and `any`-flag count. The corresponding /code-enforcement/* routes still exist
  // server-side; re-add the UI when an operator path actually consumes them.

  // Fetch violations
  const fetchViolations = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setVLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams({
        page: String(vPage), limit: '50',
        ...(vSearch ? { search: vSearch } : {}),
        ...(vFilterStatus ? { status: vFilterStatus } : {}),
      });
      const res = await apiFetch<{ data: CodeViolation[]; pagination: any }>(`/code-enforcement/violations?${params}`);
      setViolations(res.data || []);
      setVTotalPages(res.pagination?.totalPages || 1);
      setVTotalCount(res.pagination?.total || 0);
    } catch (err: any) { setFetchError(err?.message || 'Failed to load data'); } finally { setVLoading(false); }
  }, [vPage, vSearch, vFilterStatus]);

  // Fetch tows
  const fetchTows = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setTLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(tPage), limit: '50',
        ...(tSearch ? { search: tSearch } : {}),
        ...(tFilterStatus ? { status: tFilterStatus } : {}),
      });
      const res = await apiFetch<{ data: VehicleTow[]; pagination: any }>(`/code-enforcement/tows?${params}`);
      setTows(res.data || []);
      setTTotalPages(res.pagination?.totalPages || 1);
      setTTotalCount(res.pagination?.total || 0);
    } catch { addToast('Failed to load tow records', 'error'); } finally { setTLoading(false); }
  }, [tPage, tSearch, tFilterStatus]);

  const fetchStats = useCallback(async () => {
    try { const res = await apiFetch<{ data: any }>('/code-enforcement/stats'); setStats(res.data); } catch (e) { console.warn('[CodeEnforcement] fetch stats failed:', e); }
  }, []);

  useEffect(() => { fetchViolations(); }, [fetchViolations]);
  useEffect(() => { fetchTows(); }, [fetchTows]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useLiveSync('records', () => { fetchViolations({ silent: true }); fetchTows({ silent: true }); fetchStats(); });

  // Fetch property history when violation selected
  useEffect(() => {
    if (selectedViolation?.location) {
      apiFetch<{ data: any }>(`/code-enforcement/property-history?location=${encodeURIComponent(selectedViolation.location)}`)
        .then(res => setPropertyHistory(res.data))
        .catch(() => setPropertyHistory(null));
    } else { setPropertyHistory(null); }
  }, [selectedViolation]);

  const handleCreateViolation = async () => {
    const isValid = validateVForm(vFormData, {
      location: { required: true },
      description: { required: true, minLength: 3 },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      const zoneBeat = [vFormData.zone_id, vFormData.beat_id].filter(Boolean).join('/') || undefined;
      const vPayload = {
        ...vFormData,
        zone_beat: zoneBeat,
        fine_amount: vFormData.fine_amount !== '' ? parseFloat(vFormData.fine_amount) : null,
      };
      await apiFetch('/code-enforcement/violations', { method: 'POST', body: JSON.stringify(vPayload) });
      addToast('Violation created', 'success');
      clearVFormDraft();
      setVFormOpen(false);
      setVFormData({ ...EMPTY_VIOLATION });
      fetchViolations({ silent: true }); fetchStats();
    } catch (err) { addToast(err instanceof Error ? err.message : 'Operation failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleCreateTow = async () => {
    const isValid = validateTForm(tFormData, {
      vehicle_make: { required: true },
      tow_from: { required: true },
      vehicle_vin: { custom: (v) => !v || isValidVIN(v), customMessage: 'VIN must be 17 alphanumeric characters' },
      vehicle_plate: { custom: (v) => !v || isValidPlate(v), customMessage: 'Invalid license plate format' },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      const tPayload = {
        ...tFormData,
        tow_fee: tFormData.tow_fee !== '' ? parseFloat(tFormData.tow_fee) : null,
      };
      await apiFetch('/code-enforcement/tows', { method: 'POST', body: JSON.stringify(tPayload) });
      addToast('Tow order created', 'success');
      clearTFormDraft();
      setTFormOpen(false);
      setTFormData({ ...EMPTY_TOW });
      fetchTows({ silent: true }); fetchStats();
    } catch (err) { addToast(err instanceof Error ? err.message : 'Operation failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleViolationStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/code-enforcement/violations/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      addToast(`Violation → ${toDisplayLabel(status)}`, 'success');
      fetchViolations({ silent: true }); fetchStats();
      if (selectedViolation?.id === id) {
        const updated = await apiFetch<{ data: CodeViolation }>(`/code-enforcement/violations/${id}`);
        setSelectedViolation(updated.data);
      }
    } catch (err) { addToast(err instanceof Error ? err.message : 'Operation failed', 'error'); }
  };

  const handleScheduleReinspection = async () => {
    if (!selectedViolation || !reinspectionDate) return;
    setSchedulingReinspection(true);
    try {
      await apiFetch(`/code-enforcement/violations/${selectedViolation.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'reinspection', reinspection_date: reinspectionDate }),
      });
      addToast(`Reinspection scheduled for ${safeDateStr(reinspectionDate)}`, 'success');
      setShowReinspection(false);
      setReinspectionDate('');
      fetchViolations({ silent: true }); fetchStats();
      const updated = await apiFetch<{ data: CodeViolation }>(`/code-enforcement/violations/${selectedViolation.id}`);
      setSelectedViolation(updated.data);
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed to schedule reinspection', 'error'); }
    finally { setSchedulingReinspection(false); }
  };

  const handleTowStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/code-enforcement/tows/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      addToast(`Tow → ${toDisplayLabel(status)}`, 'success');
      fetchTows({ silent: true }); fetchStats();
      if (selectedTow?.id === id) {
        const updated = await apiFetch<{ data: VehicleTow }>(`/code-enforcement/tows/${id}`);
        setSelectedTow(updated.data);
      }
    } catch (err) { addToast(err instanceof Error ? err.message : 'Operation failed', 'error'); }
  };

  // \u2500\u2500 Right-click context menus \u2500\u2500
  const buildViolationMenu = (v: CodeViolation): ContextMenuItem[] => [
    m.action('Open violation', () => setSelectedViolation(v), { icon: <Eye size={12} /> }),
    m.separator(),
    m.copy('Copy violation number', v.violation_number),
    m.copyId(v.id),
    ...(v.location ? [m.copy('Copy location', v.location)] : []),
  ];

  const buildTowMenu = (t: VehicleTow): ContextMenuItem[] => [
    m.action('Open tow order', () => setSelectedTow(t), { icon: <Eye size={12} /> }),
    m.separator(),
    m.copy('Copy tow number', t.tow_number),
    m.copyId(t.id),
    ...(t.vehicle_plate ? [m.copy('Copy plate', t.vehicle_plate)] : []),
  ];

  // Set document title
  useEffect(() => { document.title = 'Code Enforcement \u2014 RMPG Flex'; }, []);

  // \u2500\u2500 New-record helper (also used by the `N` keyboard shortcut) \u2500\u2500
  const handleOpenNew = useCallback(() => {
    if (activeTab === 'violations') {
      clearVErrors();
      setVFormData({ ...EMPTY_VIOLATION });
      setVFormOpen(true);
      snapshotVForm();
    } else {
      clearTErrors();
      setTFormData({ ...EMPTY_TOW });
      setTFormOpen(true);
      snapshotTForm();
    }
  // setForm*/snapshot* are stable refs from useFormDraft; pulling them in
  // would force handleOpenNew to re-create every render and re-bind the
  // keyboard listener.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Keyboard shortcuts:
  //   Esc \u2014 smart cascade: close the smallest-open thing first so a single
  //         tap does not punch through every overlay (reinspection inline \u2192
  //         tow form \u2192 violation form).
  //   N   \u2014 open a new record from anywhere on the page, suppressed when
  //         the user is actually typing into a field.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmOpen)      { setConfirmOpen(false); return; }
        if (showReinspection) { setShowReinspection(false); setReinspectionDate(''); return; }
        if (tFormOpen)        { clearTFormDraft(); setTFormOpen(false); return; }
        if (vFormOpen)        { clearVFormDraft(); setVFormOpen(false); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if ((e.key === 'n' || e.key === 'N') && canEnforce) {
        e.preventDefault();
        handleOpenNew();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmOpen, showReinspection, tFormOpen, vFormOpen, clearTFormDraft, clearVFormDraft, handleOpenNew]);

  // \u2500\u2500 /code-enforcement?violation_id=\u2026 / ?case_id=\u2026 / ?tow_id=\u2026 deep-link \u2500\u2500
  // ?case_id= is an alias for ?violation_id= \u2014 inbound links from case pages
  // use the case_id field to cross-reference an attached violation.
  // Once the matching list hydrates, find by id, switch tabs if needed, and
  // strip the query so a manual refresh doesn't re-select. Surfaces a one-time
  // toast when the id misses (e.g. archived or in another org's view).
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingViolationIdRef = useRef<string | null>(
    searchParams.get('violation_id') ?? searchParams.get('case_id')
  );
  const pendingTowIdRef = useRef<string | null>(searchParams.get('tow_id'));
  useEffect(() => {
    const target = pendingViolationIdRef.current;
    if (!target || vLoading) return;
    const hit = violations.find((v) => String(v.id) === String(target));
    if (!hit) {
      if (violations.length === 0) return;
      pendingViolationIdRef.current = null;
      addToast(`Violation ${target} not in the current view (try clearing filters)`, 'warning');
      const next = new URLSearchParams(searchParams);
      next.delete('violation_id');
      next.delete('case_id');
      setSearchParams(next, { replace: true });
      return;
    }
    pendingViolationIdRef.current = null;
    setActiveTab('violations');
    setSelectedViolation(hit);
    const next = new URLSearchParams(searchParams);
    next.delete('violation_id');
    next.delete('case_id');
    setSearchParams(next, { replace: true });
  }, [violations, vLoading, searchParams, setSearchParams, addToast]);

  useEffect(() => {
    const target = pendingTowIdRef.current;
    if (!target || tLoading) return;
    const hit = tows.find((t) => String(t.id) === String(target));
    if (!hit) {
      if (tows.length === 0) return;
      pendingTowIdRef.current = null;
      addToast(`Tow ${target} not in the current view (try clearing filters)`, 'warning');
      const next = new URLSearchParams(searchParams);
      next.delete('tow_id');
      setSearchParams(next, { replace: true });
      return;
    }
    pendingTowIdRef.current = null;
    setActiveTab('tows');
    setSelectedTow(hit);
    const next = new URLSearchParams(searchParams);
    next.delete('tow_id');
    setSearchParams(next, { replace: true });
  }, [tows, tLoading, searchParams, setSearchParams, addToast]);

  // \u2500\u2500 Empty-state copy that distinguishes "filters active" vs "truly empty" \u2500\u2500
  const violationsTrulyEmpty = !vSearch && !vFilterStatus;
  const towsTrulyEmpty = !tSearch && !tFilterStatus;

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left Panel ── */}
      <div className={`flex flex-col min-h-0 ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Code Enforcement" icon={Construction}>
          <button
            type="button"
            className="toolbar-btn print:hidden"
            disabled={activeTab === 'violations' ? violations.length === 0 : tows.length === 0}
            onClick={() => {
              if (activeTab === 'violations') downloadTextFile('code-violations.csv', codeViolationsToCsv(violations));
              else downloadTextFile('tow-orders.csv', towOrdersToCsv(tows));
            }}
            title="CSV without violator names, phones, or notes"
          >CSV</button>
          <ExportButton exportUrl="/api/code-enforcement/export/csv" exportFilename="code_violations_export.csv" />
          {canEnforce && (
            <button type="button"
              onClick={handleOpenNew}
              className="toolbar-btn toolbar-btn-primary print:hidden"
              title={`New ${activeTab === 'violations' ? 'violation' : 'tow order'} (N)`}
            >
              <Plus style={{ width: 11, height: 11 }} />
              New
            </button>
          )}
        </PanelTitleBar>

        {fetchError && (
          <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle style={{ width: 12, height: 12 }} />
            <span>{fetchError}</span>
            <button type="button" className="ml-auto toolbar-btn text-[10px]" onClick={() => { if (activeTab === 'violations') void fetchViolations(); else void fetchTows(); }}>Retry</button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="flex gap-2 px-2 py-1.5 border-b border-rmpg-700 bg-surface-sunken overflow-x-auto">
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">VIOLATIONS</div>
              <div className="text-sm font-bold text-red-400">{stats.violations?.open || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">TOWS</div>
              <div className="text-sm font-bold text-amber-400">{stats.tows?.active || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">PKG TODAY</div>
              <div className="text-sm font-bold text-rmpg-400">{stats.parking_citations_today || 0}</div>
            </div>
          </div>
        )}

        {/* Tab toggle */}
        <div className="flex border-b border-rmpg-700">
          <button type="button"
            onClick={() => setActiveTab('violations')}
            className={`flex-1 ${isMobile ? 'py-3 text-xs' : 'py-1.5 text-[10px]'} font-bold uppercase tracking-wider ${activeTab === 'violations' ? 'text-rmpg-100 border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500 hover:text-rmpg-300'} transition-colors`}
            style={isMobile ? { minHeight: 48 } : undefined}
          >
            Violations ({vTotalCount})
          </button>
          <button type="button"
            onClick={() => setActiveTab('tows')}
            className={`flex-1 ${isMobile ? 'py-3 text-xs' : 'py-1.5 text-[10px]'} font-bold uppercase tracking-wider ${activeTab === 'tows' ? 'text-rmpg-100 border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500 hover:text-rmpg-300'} transition-colors`}
            style={isMobile ? { minHeight: 48 } : undefined}
          >
            Tows ({tTotalCount})
          </button>
        </div>

        {/* Filters */}
        <div className={`flex ${isMobile ? 'flex-col' : ''} gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base`}>
          {activeTab === 'violations' ? (
            <>
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
                <input id="ff-codeenforcementpage-0" value={vSearch} onChange={e => { setVSearch(e.target.value); setVPage(1); }} placeholder="Search violations..." aria-label="Search violations..." className={`w-full pl-7 pr-2 ${isMobile ? 'py-2.5 text-sm' : 'py-1 text-xs'} bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder-rmpg-500 focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 outline-none`} style={isMobile ? { minHeight: 44 } : undefined} />
              </div>
              <select id="ff-codeenforcementpage-1" value={vFilterStatus} onChange={e => { setVFilterStatus(e.target.value); setVPage(1); }} className={`${isMobile ? 'text-sm py-2' : 'text-[10px]'} bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none`} style={isMobile ? { minHeight: 44 } : undefined}>
                <option value="">All</option>
                {Object.keys(VIOLATION_STATUS_COLORS).map(s => <option key={s} value={s}>{toDisplayLabel(s).toUpperCase()}</option>)}
              </select>
            </>
          ) : (
            <>
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
                <input id="ff-codeenforcementpage-2" value={tSearch} onChange={e => { setTSearch(e.target.value); setTPage(1); }} placeholder="Search tows..." aria-label="Search tows..." className={`w-full pl-7 pr-2 ${isMobile ? 'py-2.5 text-sm' : 'py-1 text-xs'} bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder-rmpg-500 focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 outline-none`} style={isMobile ? { minHeight: 44 } : undefined} />
              </div>
              <select id="ff-codeenforcementpage-3" value={tFilterStatus} onChange={e => { setTFilterStatus(e.target.value); setTPage(1); }} className={`${isMobile ? 'text-sm py-2' : 'text-[10px]'} bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none`} style={isMobile ? { minHeight: 44 } : undefined}>
                <option value="">All</option>
                {Object.keys(TOW_STATUS_COLORS).map(s => <option key={s} value={s}>{toDisplayLabel(s).toUpperCase()}</option>)}
              </select>
            </>
          )}
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
          {activeTab === 'violations' ? (
            vLoading ? <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading...</span></div> :
            violations.length === 0 ? <EmptyState
              icon={Construction}
              title={violationsTrulyEmpty ? 'No violations yet' : 'No violations match your filters'}
              description={violationsTrulyEmpty ? 'Press N or click + New to log a code violation.' : 'Try clearing search or status filter.'}
            /> :
            violations.map(v => (
              <button type="button"
                key={v.id}
                onClick={() => setSelectedViolation(v)}
                onContextMenu={(e) => openMenu(e, buildViolationMenu(v))}
                className={`w-full text-left px-3 ${isMobile ? 'py-3' : 'py-2'} border-b border-rmpg-800 transition-colors ${
                  selectedViolation?.id === v.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                }`}
                style={isMobile ? { minHeight: 56 } : undefined}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono font-bold text-rmpg-100">{v.violation_number}</span>
                    {(v as any).severity && (v as any).severity !== 'low' && (
                      <span className={`text-[8px] font-bold px-1 py-0 border ${
                        (v as any).severity === 'critical' ? 'bg-red-900/60 text-red-400 border-red-700/50' :
                        (v as any).severity === 'high' || (v as any).severity === 'major' ? 'bg-orange-900/50 text-orange-400 border-orange-700/50' :
                        (v as any).severity === 'moderate' || (v as any).severity === 'medium' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                        'bg-surface-sunken/50 text-rmpg-400 border-border-default/50'
                      }`}>
                        {((v as any).severity || '').toUpperCase()}
                      </span>
                    )}
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${VIOLATION_STATUS_COLORS[v.status] || ''}`}>
                    {toDisplayLabel(v.status).toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{v.description}</div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <MapPin style={{ width: 9, height: 9 }} />
                  <span className="truncate">{formatAddressDisplay(v.location)}</span>
                  {v.fine_amount && !isNaN(Number(v.fine_amount)) && <span className="text-amber-400">${Number(v.fine_amount).toFixed(0)}</span>}
                  {((v as any).sector_id || (v as any).zone_id || (v as any).beat_id) && (
                    <span className="font-mono text-rmpg-400">{[(v as any).sector_id, (v as any).zone_id, (v as any).beat_id].filter(Boolean).join('/')}</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            tLoading ? <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading...</span></div> :
            tows.length === 0 ? <EmptyState
              icon={Truck}
              title={towsTrulyEmpty ? 'No tow orders yet' : 'No tows match your filters'}
              description={towsTrulyEmpty ? 'Press N or click + New to open a tow order.' : 'Try clearing search or status filter.'}
            /> :
            tows.map(t => (
              <button type="button"
                key={t.id}
                onClick={() => setSelectedTow(t)}
                onContextMenu={(e) => openMenu(e, buildTowMenu(t))}
                className={`w-full text-left px-3 ${isMobile ? 'py-3' : 'py-2'} border-b border-rmpg-800 transition-colors ${
                  selectedTow?.id === t.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                }`}
                style={isMobile ? { minHeight: 56 } : undefined}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-rmpg-100">{t.tow_number}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${TOW_STATUS_COLORS[t.status] || ''}`}>
                    {toDisplayLabel(t.status).toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">
                  {[t.vehicle_year, t.vehicle_color, t.vehicle_make, t.vehicle_model].filter(Boolean).join(' ')}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  {t.vehicle_plate && <span className="font-mono">{t.vehicle_plate}</span>}
                  <span className="truncate">{t.tow_from}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 min-h-0 flex flex-col bg-surface-base">
        {activeTab === 'violations' && selectedViolation ? (
          <>
            <PanelTitleBar title={selectedViolation.violation_number} icon={Construction}>
              <button
                type="button"
                onClick={() => openCodeViolationNoticePdf(selectedViolation)}
                className="toolbar-btn print:hidden"
                title="Print court-ready Notice of Violation"
              >
                <FileText style={{ width: 11, height: 11 }} />
                Notice PDF
              </button>
            </PanelTitleBar>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-4 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border font-bold ${VIOLATION_STATUS_COLORS[selectedViolation.status] || ''}`}>
                  {toDisplayLabel(selectedViolation.status).toUpperCase()}
                </span>
                <span className="text-[10px] px-2 py-1 border bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50">
                  {VIOLATION_TYPES.find(v => v.value === selectedViolation.violation_type)?.label || selectedViolation.violation_type}
                </span>
              </div>
              {/* Status actions */}
              <div className="panel-beveled p-3">
                <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2">Actions</div>
                <div className={`flex flex-wrap ${isMobile ? 'gap-2' : 'gap-1'}`}>
                  {(['notice_sent', 'reinspection', 'resolved', 'referred', 'voided'] as const)
                    .filter(s => s !== selectedViolation.status)
                    .filter(s => (s === 'voided' || s === 'referred') ? canEnforce : true)
                    .map(s => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => {
                        if (s === 'voided') {
                          openConfirm({
                            title: 'Void Violation',
                            message: 'Voiding this violation is a destructive action. It will remove the violation from active enforcement and cannot be reversed without admin intervention.',
                            details: <><div>Violation: <strong>{selectedViolation.violation_number}</strong></div><div className="mt-0.5">{selectedViolation.description}</div></>,
                            onConfirm: async () => { await handleViolationStatus(selectedViolation.id, 'voided'); },
                          });
                        } else {
                          handleViolationStatus(selectedViolation.id, s);
                        }
                      }}
                      className={`${isMobile ? 'text-xs px-3 py-2' : 'text-[10px] px-2 py-1'} border border-rmpg-600 text-rmpg-300 hover:bg-rmpg-700/40 transition-colors`}
                      style={isMobile ? { minHeight: 48 } : undefined}
                    >
                      {toDisplayLabel(s)}
                    </button>
                  ))}
                  {!canEnforce && (
                    <span className="text-[9px] text-rmpg-500 italic self-center">Void/refer require supervisor+</span>
                  )}
                </div>
              </div>
              {/* Schedule Reinspection */}
              <div className="panel-beveled p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider">Reinspection</div>
                  <button type="button"
                    onClick={() => setShowReinspection(!showReinspection)}
                    className="text-[10px] px-2 py-1 border border-rmpg-600 text-rmpg-400 bg-surface-sunken hover:bg-rmpg-800/40 transition-colors"
                  >
                    <Calendar style={{ width: 10, height: 10, display: 'inline', marginRight: 4 }} />
                    Schedule Reinspection
                  </button>
                </div>
                {showReinspection && (
                  <div className="flex items-center gap-2 mt-2">
                    <input id="ff-codeenforcementpage-4"
                      type="date"
                      value={reinspectionDate}
                      onChange={e => setReinspectionDate(e.target.value)}
                      min={localToday()}
                      className="input-dark text-[10px] px-2 py-1 flex-1 min-h-[36px]"
                    />
                    <button type="button"
                      onClick={handleScheduleReinspection}
                      disabled={!reinspectionDate || schedulingReinspection}
                      className="text-[10px] px-3 py-1 bg-surface-sunken text-rmpg-400 border border-rmpg-600 hover:bg-rmpg-800/50 disabled:opacity-40 transition-colors"
                    >
                      {schedulingReinspection ? 'Scheduling...' : 'Confirm'}
                    </button>
                    <IconButton onClick={() => { setShowReinspection(false); setReinspectionDate(''); }} className="text-rmpg-500 hover:text-rmpg-100" aria-label="Cancel reinspection">
                      <X style={{ width: 12, height: 12 }} />
                    </IconButton>
                  </div>
                )}
                {(selectedViolation as any).reinspection_date && (
                  <div className="mt-2 text-[10px] text-rmpg-400 flex items-center gap-1">
                    <Calendar style={{ width: 10, height: 10 }} />
                    Reinspection scheduled: {safeDateStr((selectedViolation as any).reinspection_date)}
                  </div>
                )}
              </div>

              {/* Property Violation History */}
              {propertyHistory && (
                <div className={`panel-beveled p-3 ${propertyHistory.is_repeat_offender ? 'border-red-700/50 bg-red-900/10' : ''}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider">Property Violation History (12 mo)</div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 border ${
                      propertyHistory.is_repeat_offender ? 'bg-red-900/50 text-red-400 border-red-700/50' : 'bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50'
                    }`}>
                      {propertyHistory.violation_count_12mo} violation{propertyHistory.violation_count_12mo !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {propertyHistory.is_repeat_offender && (
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-red-400 font-bold">
                      <AlertTriangle style={{ width: 12, height: 12 }} />
                      REPEAT OFFENDER — 3+ violations in 12 months
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['Location', selectedViolation.location],
                  ['Description', selectedViolation.description],
                  ['Code Section', selectedViolation.code_section || '—'],
                  ['Severity', selectedViolation.severity ? selectedViolation.severity.charAt(0).toUpperCase() + selectedViolation.severity.slice(1) : '—'],
                  ['Fine Amount', selectedViolation.fine_amount && !isNaN(Number(selectedViolation.fine_amount)) ? `$${Number(selectedViolation.fine_amount).toFixed(2)}` : '—'],
                  ['Compliance Deadline', selectedViolation.compliance_deadline ? parseTimestamp(selectedViolation.compliance_deadline).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'],
                  ['S/Z/B', [(selectedViolation as any).sector_id, (selectedViolation as any).zone_id, (selectedViolation as any).beat_id].filter(Boolean).join('/') || '—'],
                  ['Created', safeDateTimeStr(selectedViolation.created_at)],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider">{label}</div>
                    <div className="text-xs text-rmpg-100 mt-0.5">{value || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : activeTab === 'tows' && selectedTow ? (
          <>
            <PanelTitleBar title={selectedTow.tow_number} icon={Truck}>
              <button
                type="button"
                onClick={() => openTowOrderPdf(selectedTow)}
                className="toolbar-btn print:hidden"
                title="Print court-ready Vehicle Tow Order"
              >
                <FileText style={{ width: 11, height: 11 }} />
                Tow Order PDF
              </button>
            </PanelTitleBar>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-4 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border font-bold ${TOW_STATUS_COLORS[selectedTow.status] || ''}`}>
                  {toDisplayLabel(selectedTow.status).toUpperCase()}
                </span>
                <span className="text-[10px] px-2 py-1 border bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50">
                  {TOW_REASONS.find(r => r.value === selectedTow.tow_reason)?.label || selectedTow.tow_reason}
                </span>
              </div>
              <div className="panel-beveled p-3">
                <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider mb-2">Actions</div>
                <div className={`flex flex-wrap ${isMobile ? 'gap-2' : 'gap-1'}`}>
                  {(['dispatched', 'in_progress', 'completed', 'released', 'cancelled'] as const)
                    .filter(s => s !== selectedTow.status)
                    .filter(s => s === 'cancelled' ? canEnforce : true)
                    .map(s => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => {
                        if (s === 'cancelled') {
                          openConfirm({
                            title: 'Cancel Tow Order',
                            message: 'Cancelling this tow order will remove it from active dispatch. This action requires supervisor authorization.',
                            details: <><div>Tow Order: <strong>{selectedTow.tow_number}</strong></div><div className="mt-0.5">{[selectedTow.vehicle_year, selectedTow.vehicle_color, selectedTow.vehicle_make, selectedTow.vehicle_model].filter(Boolean).join(' ')}</div></>,
                            onConfirm: async () => { await handleTowStatus(selectedTow.id, 'cancelled'); },
                          });
                        } else {
                          handleTowStatus(selectedTow.id, s);
                        }
                      }}
                      className={`${isMobile ? 'text-xs px-3 py-2' : 'text-[10px] px-2 py-1'} border border-rmpg-600 text-rmpg-300 hover:bg-rmpg-700/40 transition-colors`}
                      style={isMobile ? { minHeight: 48 } : undefined}
                    >
                      {toDisplayLabel(s)}
                    </button>
                  ))}
                  {!canEnforce && (
                    <span className="text-[9px] text-rmpg-500 italic self-center">Cancel requires supervisor+</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['Vehicle', [selectedTow.vehicle_year, selectedTow.vehicle_color, selectedTow.vehicle_make, selectedTow.vehicle_model].filter(Boolean).join(' ')],
                  ['Plate', selectedTow.vehicle_plate || '—'],
                  ['VIN', selectedTow.vehicle_vin || '—'],
                  ['Tow From', selectedTow.tow_from],
                  ['Tow To', selectedTow.tow_to || '—'],
                  ['Tow Company', selectedTow.tow_company || '—'],
                  ['Tow Fee', selectedTow.tow_fee && !isNaN(Number(selectedTow.tow_fee)) ? `$${Number(selectedTow.tow_fee).toFixed(2)}` : '—'],
                  ['Storage Fee', selectedTow.storage_fee_daily && !isNaN(Number(selectedTow.storage_fee_daily)) ? `$${Number(selectedTow.storage_fee_daily).toFixed(2)}` : '—'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-[9px] font-mono text-brand-gold-500 uppercase tracking-wider">{label}</div>
                    <div className="text-xs text-rmpg-100 mt-0.5">{value || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Construction className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">Select an item to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── New Violation Modal ── */}
      {vFormOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-lg mx-4 my-auto">
            <PanelTitleBar title="New Code Violation" icon={Plus}>
              <div className="flex items-center gap-2">
                {vFormIsDirty && (
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
                )}
                <IconButton onClick={() => { clearVFormDraft(); setVFormOpen(false); }} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
              </div>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              {vFormWasRestored && (
                <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30" style={{ background: 'rgb(var(--brand-gold-rgb) / 0.12)' }}>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-amber-400" />
                    <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
                  </div>
                  <button type="button" onClick={clearVFormDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                    Discard
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-codeenforcementpage-5" className="field-label">Type</label>
                  <select id="ff-codeenforcementpage-5" value={vFormData.violation_type} onChange={e => setVFormData(p => ({ ...p, violation_type: e.target.value as ViolationType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600">
                    {VIOLATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-codeenforcementpage-6" className="field-label">Severity</label>
                  <select id="ff-codeenforcementpage-6" value={vFormData.severity} onChange={e => setVFormData(p => ({ ...p, severity: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600">
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="ff-codeenforcementpage-7" className="field-label">Location *</label>
                <input id="ff-codeenforcementpage-7" value={vFormData.location} onChange={e => setVFormData(p => ({ ...p, location: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-rmpg-100 outline-none ${vFormErrors.location ? 'border-red-500' : 'border-rmpg-700'}`} />
                {vFormErrors.location && <p className="text-red-400 text-[10px] mt-0.5">{vFormErrors.location}</p>}
              </div>
              <div>
                <label htmlFor="ff-codeenforcementpage-8" className="field-label">Description *</label>
                <textarea id="ff-codeenforcementpage-8" value={vFormData.description} onChange={e => setVFormData(p => ({ ...p, description: e.target.value }))} rows={3} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-rmpg-100 outline-none resize-none ${vFormErrors.description ? 'border-red-500' : 'border-rmpg-700'}`} />
                {vFormErrors.description && <p className="text-red-400 text-[10px] mt-0.5">{vFormErrors.description}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-codeenforcementpage-9" className="field-label">Code Section</label>
                  <input id="ff-codeenforcementpage-9" value={vFormData.code_section} onChange={e => setVFormData(p => ({ ...p, code_section: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
                <div>
                  <label htmlFor="ff-codeenforcementpage-10" className="field-label">Fine Amount</label>
                  <input id="ff-codeenforcementpage-10" value={vFormData.fine_amount} onChange={e => setVFormData(p => ({ ...p, fine_amount: e.target.value }))} type="number" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="ff-codeenforcementpage-11" className="field-label">Section</label>
                  <select id="ff-codeenforcementpage-11" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600"
                    value={vFormData.sector_id || ''} onChange={e => setVFormData(p => ({...p, sector_id: e.target.value, zone_id: '', beat_id: ''}))}>
                    <option value="">—</option>
                    {sectionOptions.map(s => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-codeenforcementpage-12" className="field-label">Zone</label>
                  <select id="ff-codeenforcementpage-12" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600"
                    value={vFormData.zone_id || ''} onChange={e => setVFormData(p => ({...p, zone_id: e.target.value, beat_id: ''}))}>
                    <option value="">—</option>
                    {zonesForSection(vFormData.sector_id).map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-codeenforcementpage-13" className="field-label">Beat</label>
                  <select id="ff-codeenforcementpage-13" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600"
                    value={vFormData.beat_id || ''} onChange={e => setVFormData(p => ({...p, beat_id: e.target.value}))}>
                    <option value="">—</option>
                    {beatsForZone(vFormData.zone_id).map(b => <option key={b} value={b}>{getBeatLabel(vFormData.zone_id, b)}</option>)}
                  </select>
                </div>
              </div>
              <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-2'} pt-2 border-t border-rmpg-700`}>
                <button type="button" onClick={handleCreateViolation} disabled={submitting} className={`toolbar-btn toolbar-btn-primary ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create
                </button>
                <button type="button" onClick={() => { clearVFormDraft(); setVFormOpen(false); }} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── New Tow Modal ── */}
      {tFormOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-lg mx-4 my-auto">
            <PanelTitleBar title="New Tow Order" icon={Truck}>
              <div className="flex items-center gap-2">
                {tFormIsDirty && (
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
                )}
                <IconButton onClick={() => { clearTFormDraft(); setTFormOpen(false); }} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
              </div>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              {tFormWasRestored && (
                <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30" style={{ background: 'rgb(var(--brand-gold-rgb) / 0.12)' }}>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-amber-400" />
                    <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
                  </div>
                  <button type="button" onClick={clearTFormDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                    Discard
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><label htmlFor="ff-codeenforcementpage-14" className="field-label">Year</label><input id="ff-codeenforcementpage-14" value={tFormData.vehicle_year} onChange={e => setTFormData(p => ({ ...p, vehicle_year: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
                <div><label htmlFor="ff-codeenforcementpage-15" className="field-label">Make *</label><input id="ff-codeenforcementpage-15" value={tFormData.vehicle_make} onChange={e => setTFormData(p => ({ ...p, vehicle_make: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-rmpg-100 outline-none ${tFormErrors.vehicle_make ? 'border-red-500' : 'border-rmpg-700'}`} />{tFormErrors.vehicle_make && <p className="text-red-400 text-[10px] mt-0.5">{tFormErrors.vehicle_make}</p>}</div>
                <div><label htmlFor="ff-codeenforcementpage-16" className="field-label">Model</label><input id="ff-codeenforcementpage-16" value={tFormData.vehicle_model} onChange={e => setTFormData(p => ({ ...p, vehicle_model: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
                <div><label htmlFor="ff-codeenforcementpage-17" className="field-label">Color</label><input id="ff-codeenforcementpage-17" value={tFormData.vehicle_color} onChange={e => setTFormData(p => ({ ...p, vehicle_color: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label htmlFor="ff-codeenforcementpage-18" className="field-label">Plate</label><input id="ff-codeenforcementpage-18" value={tFormData.vehicle_plate} onChange={e => setTFormData(p => ({ ...p, vehicle_plate: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-rmpg-100 outline-none ${tFormErrors.vehicle_plate ? 'border-red-500' : 'border-rmpg-700'}`} />{tFormErrors.vehicle_plate && <p className="text-red-400 text-[10px] mt-0.5">{tFormErrors.vehicle_plate}</p>}</div>
                <div><label htmlFor="ff-codeenforcementpage-19" className="field-label">Reason</label><select id="ff-codeenforcementpage-19" value={tFormData.tow_reason} onChange={e => setTFormData(p => ({ ...p, tow_reason: e.target.value as TowReason }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600">{TOW_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
              </div>
              <div><label htmlFor="ff-codeenforcementpage-20" className="field-label">Tow From *</label><input id="ff-codeenforcementpage-20" value={tFormData.tow_from} onChange={e => setTFormData(p => ({ ...p, tow_from: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-rmpg-100 outline-none ${tFormErrors.tow_from ? 'border-red-500' : 'border-rmpg-700'}`} />{tFormErrors.tow_from && <p className="text-red-400 text-[10px] mt-0.5">{tFormErrors.tow_from}</p>}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label htmlFor="ff-codeenforcementpage-21" className="field-label">Tow Company</label><input id="ff-codeenforcementpage-21" value={tFormData.tow_company} onChange={e => setTFormData(p => ({ ...p, tow_company: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
                <div><label htmlFor="ff-codeenforcementpage-22" className="field-label">Tow Fee ($)</label><input id="ff-codeenforcementpage-22" value={tFormData.tow_fee} onChange={e => setTFormData(p => ({ ...p, tow_fee: e.target.value }))} type="number" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none focus:border-brand-600" /></div>
              </div>
              <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-2'} pt-2 border-t border-rmpg-700`}>
                <button type="button" onClick={handleCreateTow} disabled={submitting} className={`toolbar-btn toolbar-btn-primary ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create Tow
                </button>
                <button type="button" onClick={() => { clearTFormDraft(); setTFormOpen(false); }} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <UnsavedChangesGuard hasUnsavedChanges={(vFormOpen && vFormIsDirty) || (tFormOpen && tFormIsDirty)} />
      <FloatingSaveBar
        visible={vFormOpen && vFormIsDirty}
        onSave={handleCreateViolation}
        onCancel={() => { clearVFormDraft(); setVFormOpen(false); }}
        isSaving={submitting}
        saveLabel="Create Violation"
      />
      <FloatingSaveBar
        visible={tFormOpen && tFormIsDirty}
        onSave={handleCreateTow}
        onCancel={() => { clearTFormDraft(); setTFormOpen(false); }}
        isSaving={submitting}
        saveLabel="Create Tow"
      />

      {/* ── Destructive-action confirm dialog ── */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmAction}
        title={confirmTitle}
        message={confirmMessage}
        details={confirmDetails}
        confirmLabel="Confirm"
        confirmVariant="warning"
        isLoading={confirmSubmitting}
      />
    </div>
  );
}
