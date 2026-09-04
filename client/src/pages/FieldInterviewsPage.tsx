import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import {
  Plus, Search, ClipboardList, MapPin, User, Clock, FileText,
  Archive, RotateCcw, X, Save, Loader2, Eye, AlertTriangle, Trash2,
  Printer, ExternalLink,
} from 'lucide-react';
import { openFiCardPdf } from '../utils/fiCardPdf';
import type { FieldInterview, FIContactReason, FIContactType, FIActionTaken } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import ExportButton from '../components/ExportButton';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useFormValidation } from '../hooks/useFormValidation';
import { useFormDraft } from '../hooks/useFormDraft';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import { isValidPlate, isValidDate } from '../utils/validate';
import { formatDate, formatDateTime, parseTimestamp, localToday, dateToLocalYMD } from '../utils/dateUtils';
import { useDistrictOptions, useDistrictIdentify } from '../hooks/useDistrictLookup';
import WarrantBadge from '../components/WarrantBadge';
import { formatAddressDisplay } from '../utils/statusLabels';
import { formatLabel, toDisplayLabel } from '../utils/formatters';
import { fiCardsToCsv, downloadTextFile } from '../utils/rmsListExport';

const CONTACT_REASONS: { value: FIContactReason; label: string }[] = [
  { value: 'suspicious_activity', label: 'Suspicious Activity' },
  { value: 'traffic_stop', label: 'Traffic Stop' },
  { value: 'trespass', label: 'Trespass' },
  { value: 'welfare_check', label: 'Welfare Check' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'other', label: 'Other' },
];

const CONTACT_TYPES: { value: FIContactType; label: string }[] = [
  { value: 'field', label: 'Field' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'foot', label: 'Foot' },
  { value: 'phone', label: 'Phone' },
];

const ACTIONS_TAKEN: { value: FIActionTaken; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'warned', label: 'Warned' },
  { value: 'cited', label: 'Cited' },
  { value: 'arrested', label: 'Arrested' },
  { value: 'released', label: 'Released' },
  { value: 'referred', label: 'Referred' },
];

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-900/50 text-green-400 border-green-700/50',
  archived: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const REASON_COLORS: Record<string, string> = {
  suspicious_activity: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  traffic_stop: 'bg-surface-sunken/50 text-rmpg-400 border-border-default/50',
  trespass: 'bg-red-900/50 text-red-400 border-red-700/50',
  welfare_check: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  investigation: 'bg-brand-900/50 text-brand-400 border-brand-700/50',
  other: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
};

const EMPTY_FORM = {
  date: localToday(),
  subject_first_name: '', subject_last_name: '', subject_dob: '',
  subject_gender: '', subject_race: '', subject_height: '', subject_weight: '',
  subject_hair: '', subject_eye: '', subject_clothing: '', subject_description: '',
  location: '', contact_reason: 'other' as FIContactReason, contact_type: 'field' as FIContactType,
  action_taken: 'none' as FIActionTaken, narrative: '',
  vehicle_plate: '', vehicle_description: '',
  person_id: '',
  section_id: '', zone_id: '', beat_id: '',
  gang_affiliation: '',
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

export default function FieldInterviewsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin'; // Admin God Mode — unrestricted access
  const canManage = isAdmin || user?.role === 'manager' || user?.role === 'supervisor';
  const canManageRef = useRef(canManage);
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();
  const { sections: sectionOptions, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  useDistrictIdentify(); // keep hook mounted for side-effects; identify not used on this page
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  // Data state
  const [fis, setFis] = useState<FieldInterview[]>([]);
  const [selectedFi, setSelectedFi] = useState<FieldInterview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterReason, setFilterReason] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Deep-link pre-filters consumed once from URL — persisted in state so
  // the list stays scoped even after the params are stripped.
  const [filterPersonId, setFilterPersonId] = useState<string | null>(null);
  const [filterOfficerId, setFilterOfficerId] = useState<string | null>(null);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editingFi, setEditingFi] = useState<FieldInterview | null>(null);
  const {
    form: formData,
    setForm: setFormData,
    isDirty: formIsDirty,
    wasRestored: formWasRestored,
    clearDraft: clearFormDraft,
    snapshot: snapshotForm,
  } = useFormDraft<typeof EMPTY_FORM>({
    storageKey: `rmpg_fi_form_${editingFi?.id ?? 'new'}`,
    defaultValue: EMPTY_FORM,
    isActive: formOpen,
  });
  const [submitting, setSubmitting] = useState(false);

  // Person search
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const personSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Repeat contact warning
  const [repeatWarning, setRepeatWarning] = useState<string | null>(null);
  const repeatCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Admin hard-delete confirmation — routes through ConfirmDialog instead of
  // the native confirm() prompt for a11y + visual consistency.
  const [hardDeleteTarget, setHardDeleteTarget] = useState<FieldInterview | null>(null);

  // ── Fetch ──
  const fetchFis = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterReason ? { contact_reason: filterReason } : {}),
        archived: showArchived ? 'true' : 'false',
        ...(filterPersonId ? { person_id: filterPersonId } : {}),
        ...(filterOfficerId ? { officer_id: filterOfficerId } : {}),
      });
      const res = await apiFetch<{ data: FieldInterview[]; pagination: any }>(`/field-interviews?${params}`);
      setFis(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) {
      setError(err?.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, filterReason, showArchived, filterPersonId, filterOfficerId]);

  useEffect(() => { fetchFis(); }, [fetchFis]);
  useLiveSync('alerts', () => fetchFis({ silent: true }));

  // ── Person search debounce ──
  useEffect(() => {
    if (personSearch.length < 2) { setPersonResults([]); return; }
    if (personSearchTimer.current) clearTimeout(personSearchTimer.current);
    personSearchTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ data: any[] }>(`/records/persons?search=${encodeURIComponent(personSearch)}&per_page=8`);
        setPersonResults(res.data || []);
      } catch { setPersonResults([]); }
    }, 300);
    return () => { if (personSearchTimer.current) clearTimeout(personSearchTimer.current); };
  }, [personSearch]);

  // ── Repeat contact check ──
  useEffect(() => {
    if (!formOpen || editingFi) { setRepeatWarning(null); return; }
    const lastName = formData.subject_last_name?.trim();
    if (!lastName || lastName.length < 2) { setRepeatWarning(null); return; }
    if (repeatCheckTimer.current) clearTimeout(repeatCheckTimer.current);
    repeatCheckTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ count: number }>(`/field-interviews/repeat-check?name=${encodeURIComponent(lastName)}`);
        if (res.count >= 3) {
          setRepeatWarning(`This subject has been contacted ${res.count} times in the last 30 days`);
        } else {
          setRepeatWarning(null);
        }
      } catch { setRepeatWarning(null); }
    }, 500);
    return () => { if (repeatCheckTimer.current) clearTimeout(repeatCheckTimer.current); };
  }, [formData.subject_last_name, formOpen, editingFi]);

  // ── Handlers ──
  const handleOpenNew = () => {
    setEditingFi(null);
    setFormData({ ...EMPTY_FORM });
    setSelectedPerson(null);
    setPersonSearch('');
    clearAllErrors();
    setFormOpen(true);
    snapshotForm();
  };

  const handleEdit = (fi: FieldInterview) => {
    setEditingFi(fi);
    clearAllErrors();
    setFormData({
      date: (fi as any).date || (fi.created_at ? dateToLocalYMD(parseTimestamp(fi.created_at)) : '') || localToday(),
      subject_first_name: fi.subject_first_name || '',
      subject_last_name: fi.subject_last_name || '',
      subject_dob: fi.subject_dob || '',
      subject_gender: fi.subject_gender || '',
      subject_race: fi.subject_race || '',
      subject_height: fi.subject_height || '',
      subject_weight: fi.subject_weight || '',
      subject_hair: fi.subject_hair || '',
      subject_eye: fi.subject_eye || '',
      subject_clothing: fi.subject_clothing || '',
      subject_description: fi.subject_description || '',
      location: fi.location,
      contact_reason: fi.contact_reason,
      contact_type: fi.contact_type,
      action_taken: fi.action_taken,
      narrative: fi.narrative || '',
      vehicle_plate: fi.vehicle_plate || '',
      vehicle_description: fi.vehicle_description || '',
      person_id: fi.person_id ? String(fi.person_id) : '',
      section_id: (fi as any).section_id || '',
      zone_id: (fi as any).zone_id || '',
      beat_id: (fi as any).beat_id || '',
      gang_affiliation: (fi as any).gang_affiliation || '',
    });
    setFormOpen(true);
    snapshotForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isValid = validateForm(formData, {
      location: { required: true },
      subject_last_name: { required: true },
      subject_dob: { custom: (v) => !v || isValidDate(v), customMessage: 'Invalid date format (YYYY-MM-DD)' },
      vehicle_plate: { custom: (v) => !v || isValidPlate(v), customMessage: 'Invalid plate format (2–8 alphanumeric)' },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      const body = {
        ...formData,
        person_id: formData.person_id ? parseInt(formData.person_id, 10) : null,
        zone_beat: [formData.zone_id, formData.beat_id].filter(Boolean).join('/') || null,
      };
      if (editingFi) {
        await apiFetch(`/field-interviews/${editingFi.id}`, { method: 'PUT', body: JSON.stringify(body) });
        addToast('Field interview updated', 'success');
      } else {
        await apiFetch('/field-interviews', { method: 'POST', body: JSON.stringify(body) });
        addToast('Field interview created', 'success');
      }
      clearFormDraft();
      setFormOpen(false);
      setEditingFi(null);
      await fetchFis();
    } catch (err: any) {
      setError(err?.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (fi: FieldInterview) => {
    try {
      await apiFetch(`/field-interviews/${fi.id}/archive`, { method: 'POST' });
      addToast('Field interview archived', 'success');
      await fetchFis();
      if (selectedFi?.id === fi.id) setSelectedFi(null);
    } catch (err: any) { setError(err?.message || 'Operation failed'); }
  };

  const handleUnarchive = async (fi: FieldInterview) => {
    try {
      await apiFetch(`/field-interviews/${fi.id}/unarchive`, { method: 'POST' });
      addToast('Field interview restored', 'success');
      await fetchFis();
    } catch (err: any) { setError(err?.message || 'Operation failed'); }
  };

  const update = (field: string, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

  const selectPerson = (p: any) => {
    setSelectedPerson(p);
    setPersonSearch('');
    setPersonResults([]);
    setFormData(prev => ({
      ...prev,
      person_id: String(p.id),
      subject_first_name: p.first_name || '',
      subject_last_name: p.last_name || '',
      subject_dob: p.date_of_birth || p.dob || '',
      subject_gender: p.gender || '',
      subject_race: p.race || '',
      subject_height: p.height || '',
      subject_weight: p.weight || '',
      subject_hair: p.hair_color || '',
      subject_eye: p.eye_color || '',
    }));
  };

  // Admin God Mode — permanently delete an FI card (shared by detail button +
  // context menu). Opens ConfirmDialog instead of the native confirm() prompt.
  const handleDelete = (fi: FieldInterview) => { setHardDeleteTarget(fi); };

  // Confirm-dialog callback — actually fires the DELETE once the operator
  // clicks through the modal.
  const confirmHardDelete = async () => {
    const fi = hardDeleteTarget;
    if (!fi) return;
    try {
      await apiFetch(`/field-interviews/${fi.id}?hard=true`, { method: 'DELETE' });
      addToast(`FI ${fi.fi_number} permanently deleted`, 'success');
      if (selectedFi?.id === fi.id) setSelectedFi(null);
      setFis(prev => prev.filter(f => f.id !== fi.id));
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
    finally { setHardDeleteTarget(null); }
  };

  // ── Right-click context menu for FI list rows ──
  const buildFiMenu = (fi: FieldInterview): ContextMenuItem[] => {
    const subject = fi.subject_last_name
      ? `${fi.subject_last_name}, ${fi.subject_first_name || ''}`.trim()
      : 'Unknown Subject';
    return [
      m.action('Open FI card', () => setSelectedFi(fi), { icon: <Eye size={12} /> }),
      ...(canManage ? [m.action('Edit', () => handleEdit(fi), { icon: <FileText size={12} /> })] : []),
      m.separator(),
      m.copy('Copy FI number', fi.fi_number),
      m.copyId(fi.id),
      m.separator(),
      ...(canManage
        ? fi.status === 'active'
          ? [m.action('Archive', () => handleArchive(fi), { icon: <Archive size={12} /> })]
          : [m.action('Restore', () => handleUnarchive(fi), { icon: <RotateCcw size={12} /> })]
        : []),
      ...(isAdmin ? [m.action('Delete', () => handleDelete(fi), { icon: <Trash2 size={12} />, danger: true })] : []),
    ];
  };

  // Set document title
  useEffect(() => { document.title = 'Field Interviews \u2014 RMPG Flex'; }, []);

  // Keep live refs so the keyboard handler always sees the latest modal state
  // without re-registering on every state change (which would miss keystrokes
  // during rapid typing).
  const hardDeleteTargetRef = useRef(hardDeleteTarget);
  const formOpenRef = useRef(formOpen);
  const selectedFiRef = useRef(selectedFi);
  useEffect(() => { hardDeleteTargetRef.current = hardDeleteTarget; }, [hardDeleteTarget]);
  useEffect(() => { formOpenRef.current = formOpen; }, [formOpen]);
  useEffect(() => { selectedFiRef.current = selectedFi; }, [selectedFi]);

  // Keyboard shortcuts: Escape closes modals (smart cascade — innermost first);
  // `N` opens a new FI card from anywhere on the page (mirrors Dispatch's `N`
  // binding). Suppressed when the user is typing into an input/textarea/select.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Smart cascade: dismiss innermost layer first.
        if (hardDeleteTargetRef.current !== null) { setHardDeleteTarget(null); return; }
        if (formOpenRef.current) { clearFormDraft(); setFormOpen(false); setEditingFi(null); return; }
        if (selectedFiRef.current) { setSelectedFi(null); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === 'n' || e.key === 'N') {
        if (!canManageRef.current) return;
        e.preventDefault();
        handleOpenNew();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ?person_id= / ?officer_id= deep-link pre-filters ──
  // Consumed once at mount: strip from URL and activate the server-side
  // filter so the list only shows FIs for that person / officer.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const pid = searchParams.get('person_id');
    const oid = searchParams.get('officer_id');
    if (!pid && !oid) return;
    if (pid) setFilterPersonId(pid);
    if (oid) setFilterOfficerId(oid);
    const next = new URLSearchParams(searchParams);
    next.delete('person_id');
    next.delete('officer_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── /field-interviews?fi_id=<id> deep-link auto-select ──
  // Once `fis` hydrates, find by id and set as selectedFi; strip the query so
  // a refresh doesn't re-select. Surfaces a one-time toast if the id misses.
  const pendingFiIdRef = useRef<string | null>(searchParams.get('fi_id'));
  useEffect(() => {
    const target = pendingFiIdRef.current;
    if (!target || loading) return;
    const hit = fis.find((f) => String(f.id) === String(target));
    if (!hit) {
      // Wait until the list has actually hydrated before complaining.
      if (fis.length === 0) return;
      pendingFiIdRef.current = null;
      addToast(`FI ${target} not in the current view (try unarchiving or clearing filters)`, 'warning');
      const next = new URLSearchParams(searchParams);
      next.delete('fi_id');
      next.delete('interview_id');
      setSearchParams(next, { replace: true });
      return;
    }
    pendingFiIdRef.current = null;
    setSelectedFi(hit);
    const next = new URLSearchParams(searchParams);
    next.delete('fi_id');
    next.delete('interview_id');
    setSearchParams(next, { replace: true });
  }, [fis, loading, searchParams, setSearchParams, addToast]);

  // Pre-compute repeat-contact counts so each row does an O(1) Map lookup
  // instead of an O(n) filter scan inside render (avoids O(n²) on large lists).
  const repeatContactCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of fis) {
      if (!f.subject_last_name) continue;
      const key = `${f.subject_last_name}|${f.subject_first_name || ''}`.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [fis]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PanelTitleBar icon={ClipboardList} title="FIELD INTERVIEWS">
        <span className="text-[9px] font-mono text-rmpg-400">{totalCount} TOTAL</span>
        <span className="toolbar-separator" />
        <ExportButton exportUrl="/field-interviews/export/csv" exportFilename="field_interviews_export.csv" />
        <button
          type="button"
          className="toolbar-btn"
          disabled={fis.length === 0}
          onClick={() => downloadTextFile('field-interviews.csv', fiCardsToCsv(fis))}
          title="CSV of FI number, location, reason — no names, DOB, or narrative"
        >CSV</button>
        {canManage && (
          <button type="button" onClick={handleOpenNew} className="toolbar-btn">
            <Plus style={{ width: 11, height: 11 }} /> New FI Card
          </button>
        )}
      </PanelTitleBar>

      {/* Toolbar */}
      <div className={`flex ${isMobile ? 'flex-col gap-1.5' : 'items-center gap-2'} px-3 py-1.5 border-b border-rmpg-700 bg-surface-base`}>
        <div className={`relative ${isMobile ? 'w-full' : 'flex-1 max-w-xs'}`}>
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
          <input id="ff-fieldinterviewspage-0"
            type="text" placeholder="Search FIs..." aria-label="Search field interviews" className={`input-dark pl-7 w-full focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow ${isMobile ? 'text-sm py-2.5' : 'text-xs'}`}
            value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            style={isMobile ? { minHeight: 44 } : undefined}
          />
          {searchQuery && (
            <IconButton onClick={() => { setSearchQuery(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-100 transition-colors" aria-label="Clear search">
              <X className="w-3 h-3" />
            </IconButton>
          )}
        </div>
        <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-2'}`}>
          <select id="ff-fieldinterviewspage-1" className={`select-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs'}`} value={filterReason} onChange={e => { setFilterReason(e.target.value); setPage(1); }} style={isMobile ? { minHeight: 44 } : undefined} aria-label="Filter by contact reason">
            <option value="">All Reasons</option>
            {CONTACT_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <label className={`flex items-center gap-1 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400 cursor-pointer`} style={isMobile ? { minHeight: 44 } : undefined}>
            <input id="ff-fieldinterviewspage-2" type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); setPage(1); }} className="accent-brand-500" style={isMobile ? { width: 20, height: 20 } : undefined} />
            Archived
          </label>
        </div>
      </div>

      {/* Scoped-filter banner — shown when the list is pre-filtered via a
          ?person_id= or ?officer_id= deep-link (e.g. from PersonDossierPage). */}
      {(filterPersonId || filterOfficerId) && (
        <div className="px-3 py-1.5 bg-brand-900/30 border-b border-brand-700/40 text-brand-300 text-[10px] flex items-center gap-2">
          <Eye className="w-3 h-3 flex-shrink-0 text-brand-400" aria-hidden="true" />
          <span className="flex-1">
            {filterPersonId ? `Showing FIs linked to person #${filterPersonId}` : `Showing FIs for officer #${filterOfficerId}`}
          </span>
          <button type="button" className="text-brand-400 hover:text-brand-200 underline text-[10px]"
            onClick={() => { setFilterPersonId(null); setFilterOfficerId(null); setPage(1); }}>
            Clear
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="px-3 py-2 bg-red-900/40 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => fetchFis()} className="text-red-200 hover:text-rmpg-100 underline text-[10px]">Retry</button>
        </div>
      )}

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className={`${selectedFi && !isMobile ? 'w-[40%]' : 'w-full'} overflow-y-auto scrollbar-dark border-r border-rmpg-700`}>
          {loading && fis.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-rmpg-400 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" role="status" aria-label="Loading field interviews" />
              <span className="text-[10px] text-rmpg-500 animate-pulse">Loading field interviews...</span>
            </div>
          ) : fis.length === 0 ? (
            (searchQuery || filterReason || showArchived || filterPersonId || filterOfficerId) ? (
              <EmptyState
                icon={Search}
                title="No field interviews match your filters"
                description="Try clearing the search or adjusting the filters."
                action={{ label: 'Clear filters', onClick: () => { setSearchQuery(''); setFilterReason(''); setShowArchived(false); setFilterPersonId(null); setFilterOfficerId(null); setPage(1); } }}
              />
            ) : (
              <EmptyState
                icon={ClipboardList}
                title="No field interviews yet"
                description="Create a new FI card to get started."
                action={{ label: 'New FI Card', onClick: handleOpenNew }}
              />
            )
          ) : (
            fis.map((fi, idx) => (
              <div
                key={fi.id}
                role="listitem"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedFi(fi); } }}
                onClick={() => setSelectedFi(fi)}
                onContextMenu={(e) => openMenu(e, buildFiMenu(fi))}
                className={`px-3 ${isMobile ? 'py-3' : 'py-2'} cursor-pointer border-b border-rmpg-800 transition-all duration-150 hover:bg-surface-raised ${selectedFi?.id === fi.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : `border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-rmpg-800/15' : ''}`}`}
                style={isMobile ? { minHeight: 56 } : undefined}
                aria-selected={selectedFi?.id === fi.id}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-bold font-mono text-brand-400">{fi.fi_number}</span>
                  <div className="flex items-center gap-1">
                    <span className={`text-[8px] font-bold px-1.5 py-0 border ${REASON_COLORS[fi.contact_reason] || REASON_COLORS.other}`}>
                      {toDisplayLabel(fi.contact_reason || '').toUpperCase()}
                    </span>
                    <span className={`text-[8px] font-bold px-1.5 py-0 border ${STATUS_COLORS[fi.status]}`}>
                      {(fi.status || '').toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-rmpg-100 font-medium flex items-center gap-1.5">
                  {fi.subject_last_name ? `${fi.subject_last_name}, ${fi.subject_first_name || ''}` : 'Unknown Subject'}
                  {fi.person_flags && <WarrantBadge flags={fi.person_flags} size="sm" />}
                  {fi.subject_last_name && (() => {
                    const key = `${fi.subject_last_name}|${fi.subject_first_name || ''}`.toLowerCase();
                    const count = repeatContactCounts.get(key) ?? 0;
                    return count >= 2 ? <span className="text-[8px] font-bold px-1 py-0 bg-orange-900/50 text-orange-400 border border-orange-700/50">REPEAT ({count})</span> : null;
                  })()}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-rmpg-400 mt-0.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{formatAddressDisplay(fi.location)}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-rmpg-500 mt-0.5">
                  <span>{fi.officer_name || fi.officer_display_name || 'Unknown Officer'}</span>
                  <span>•</span>
                  <span>{formatDate(fi.created_at)}</span>
                </div>
              </div>
            ))
          )}
          {/* Pagination */}
          {totalPages > 1 && (
            <div className={`flex items-center justify-center gap-2 py-2 border-t border-rmpg-700/50 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400`}>
              <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="toolbar-btn disabled:opacity-30" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined, minWidth: isMobile ? 48 : undefined }}>Prev</button>
              <span className="tabular-nums font-mono">Page {page} of {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="toolbar-btn disabled:opacity-30" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined, minWidth: isMobile ? 48 : undefined }}>Next</button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedFi && (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-rmpg-100 font-mono">{selectedFi.fi_number}</h2>
                <span className="text-[10px] text-rmpg-400">Created {formatDateTime(selectedFi.created_at)}</span>
              </div>
              <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-1'}`}>
                {/* Court-ready PDF — Arial banner + agency strap + active-
                    warrant alert + subject/contact/narrative blocks +
                    signature block. Replaces "screenshot the detail panel"
                    as the supervisor-review / court-package path. */}
                <button
                  type="button"
                  onClick={() => openFiCardPdf(selectedFi)}
                  className="toolbar-btn"
                  title="Open a printable PDF of this FI card"
                  style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}
                >
                  <Printer style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Print
                </button>
                {canManage && (
                  <button type="button" onClick={() => handleEdit(selectedFi)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                    <FileText style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Edit
                  </button>
                )}
                {canManage && (selectedFi.status === 'active' ? (
                  <button type="button" onClick={() => handleArchive(selectedFi)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                    <Archive style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Archive
                  </button>
                ) : (
                  <button type="button" onClick={() => handleUnarchive(selectedFi)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                    <RotateCcw style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Restore
                  </button>
                ))}
                {isAdmin && (
                  <button type="button" onClick={() => handleDelete(selectedFi)} className="toolbar-btn text-red-400 hover:text-red-300" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                    <X style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Delete
                  </button>
                )}
                <IconButton onClick={() => setSelectedFi(null)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }} aria-label="Close details">
                  <X style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} />
                </IconButton>
              </div>
            </div>

            {/* Warrant warning banner */}
            {selectedFi.person_flags && (() => {
              try {
                const flags = typeof selectedFi.person_flags === 'string' ? JSON.parse(selectedFi.person_flags || '[]') : (selectedFi.person_flags || []);
                const hasWarrant = flags.some((f: any) => f?.type === 'ACTIVE_WARRANT' || f === 'ACTIVE_WARRANT');
                if (!hasWarrant) return null;
                return (
                  <div className="bg-red-900/50 border border-red-500 rounded-sm px-3 py-2 text-red-200 text-sm font-bold mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                    <span>SUBJECT HAS ACTIVE WARRANTS — Exercise caution</span>
                  </div>
                );
              } catch { return null; }
            })()}

            {/* Detail grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Subject</span><div className="text-rmpg-100 font-medium flex items-center gap-1.5 mt-0.5">{selectedFi.subject_last_name}, {selectedFi.subject_first_name}{selectedFi.person_flags && <WarrantBadge flags={selectedFi.person_flags} size="sm" />}</div></div>
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">DOB</span><div className="text-rmpg-100 mt-0.5">{selectedFi.subject_dob ? formatDate(selectedFi.subject_dob) : '—'}</div></div>
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Gender / Race</span><div className="text-rmpg-100 mt-0.5">{[selectedFi.subject_gender, selectedFi.subject_race].filter(Boolean).join(' / ') || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Build</span><div className="text-rmpg-100 mt-0.5">{[selectedFi.subject_height, selectedFi.subject_weight ? `${selectedFi.subject_weight} lbs` : ''].filter(Boolean).join(', ') || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Hair / Eyes</span><div className="text-rmpg-100 mt-0.5">{[selectedFi.subject_hair, selectedFi.subject_eye].filter(Boolean).join(' / ') || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Clothing</span><div className="text-rmpg-100 mt-0.5">{selectedFi.subject_clothing || '—'}</div></div>
              {selectedFi.subject_description && (
                <div className="col-span-2"><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Description</span><div className="text-rmpg-100 mt-0.5">{selectedFi.subject_description}</div></div>
              )}
              {selectedFi.gang_affiliation && (
                <div className="col-span-2">
                  <span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Gang Affiliation</span>
                  <div className="text-amber-300 font-semibold mt-0.5">{toDisplayLabel(selectedFi.gang_affiliation)}</div>
                </div>
              )}
              <div className="col-span-2"><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Location</span><div className="text-rmpg-100 mt-0.5">{formatAddressDisplay(selectedFi.location)}</div></div>
              {((selectedFi as any).section_id || (selectedFi as any).zone_id || (selectedFi as any).beat_id) && (
                <div className="col-span-2"><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Section / Zone / Beat</span><div className="text-rmpg-100 mt-0.5">{[(selectedFi as any).section_id, (selectedFi as any).zone_id, (selectedFi as any).beat_id].filter(Boolean).join(' / ') || '—'}</div></div>
              )}
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Contact Reason</span><div className="text-rmpg-100 mt-0.5 capitalize">{toDisplayLabel(selectedFi.contact_reason)}</div></div>
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Contact Type</span><div className="text-rmpg-100 mt-0.5">{formatLabel(selectedFi.contact_type)}</div></div>
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Action Taken</span><div className="text-rmpg-100 mt-0.5 capitalize">{toDisplayLabel(selectedFi.action_taken)}</div></div>
              <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Officer</span><div className="text-rmpg-100 mt-0.5">{selectedFi.officer_name || selectedFi.officer_display_name || '—'}</div></div>
              {selectedFi.vehicle_plate && <div><span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Vehicle</span><div className="text-rmpg-100 mt-0.5">{selectedFi.vehicle_plate} {selectedFi.vehicle_description}</div></div>}
              {/* Person record cross-reference — only shown when the FI is linked
                  to a canonical persons row. Opens PersonDossierPage (#1663). */}
              {selectedFi.person_id && (
                <div className="col-span-2 mt-1">
                  <span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Person Record</span>
                  <div className="mt-0.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/intel/person/${selectedFi.person_id}`)}
                      className="toolbar-btn text-brand-400 hover:text-brand-300"
                      style={{ fontSize: 10 }}
                    >
                      <ExternalLink style={{ width: 10, height: 10 }} />
                      {selectedFi.linked_person_last
                        ? `${selectedFi.linked_person_last}, ${selectedFi.linked_person_first || ''}`.trim()
                        : `Person #${selectedFi.person_id}`}
                      &nbsp;— Open Dossier
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Narrative */}
            {selectedFi.narrative && (
              <div className="mt-3 pt-2 border-t border-rmpg-700">
                <span className="text-rmpg-500 text-[9px] uppercase font-semibold tracking-wider select-none">Narrative</span>
                <p className="text-xs text-rmpg-200 mt-1 whitespace-pre-wrap leading-relaxed">{selectedFi.narrative}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-label={`${editingFi ? 'Edit' : 'New'} Field Interview`} onClick={() => { clearFormDraft(); setFormOpen(false); }}>
          <div className="bg-surface-raised border border-rmpg-600 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-dark shadow-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700" style={{ background:"var(--surface-sunken)" }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-rmpg-100 uppercase">{editingFi ? 'Edit' : 'New'} Field Interview</span>
                {formIsDirty && (
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
                )}
              </div>
              <IconButton onClick={() => { clearFormDraft(); setFormOpen(false); }} className="text-rmpg-400 hover:text-rmpg-100" aria-label="Close form"><X style={{ width: 14, height: 14 }} /></IconButton>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              {formWasRestored && (
                <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30" style={{ background: 'rgb(var(--sev-warn-rgb) / 0.08)' }}>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-amber-400" />
                    <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
                  </div>
                  <button type="button" onClick={clearFormDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                    Discard
                  </button>
                </div>
              )}
              {repeatWarning && (
                <div className="bg-amber-900/40 border border-amber-700/50 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
                  <AlertTriangle style={{ width: 14, height: 14 }} className="flex-shrink-0 text-amber-400" />
                  <span className="flex-1">{repeatWarning}</span>
                  {/* Drill-down: close the form + pre-fill the search input with
                      the subject's last name so the operator can see the prior
                      contacts that triggered the warning. Detection without
                      action was the gap pre-2026-06. */}
                  <button
                    type="button"
                    onClick={() => {
                      const lastName = formData.subject_last_name?.trim();
                      if (!lastName) return;
                      setSearchQuery(lastName);
                      setPage(1);
                      setShowArchived(false);
                      clearFormDraft();
                      setFormOpen(false);
                    }}
                    className="text-[10px] underline text-amber-200 hover:text-amber-100 transition-colors flex-shrink-0"
                    title="Close this form and search the list for prior contacts with this last name"
                  >
                    View previous contacts →
                  </button>
                </div>
              )}
              {/* Person search */}
              <div>
                <label htmlFor="ff-fieldinterviewspage-3" className="field-label">Link to Person Record (Optional)</label>
                <div className="relative">
                  <input id="ff-fieldinterviewspage-3" type="text" className="input-dark text-xs w-full min-h-[36px]" placeholder="Search person records..." aria-label="Search person records..."
                    value={personSearch} onChange={e => setPersonSearch(e.target.value)} />
                  {personResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-rmpg-700 max-h-40 overflow-y-auto">
                      {personResults.map((p: any) => (
                        <button key={p.id} type="button" onClick={() => selectPerson(p)}
                          className="w-full text-left px-3 py-1.5 text-xs text-rmpg-100 hover:bg-rmpg-700 flex items-center gap-2">
                          <User className="w-3 h-3 text-rmpg-400" />
                          {p.last_name}, {p.first_name} {p.date_of_birth ? `— DOB: ${formatDate(p.date_of_birth)}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedPerson && <div className="mt-1 text-[10px] text-brand-400">Linked: {selectedPerson.last_name}, {selectedPerson.first_name}</div>}
              </div>

              {/* Subject info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label htmlFor="ff-fieldinterviewspage-4" className="field-label">First Name</label>
                  <input id="ff-fieldinterviewspage-4" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_first_name} onChange={e => update('subject_first_name', e.target.value)} /></div>
                <div><label htmlFor="ff-fieldinterviewspage-5" className="field-label">Last Name *</label>
                  <input id="ff-fieldinterviewspage-5" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_last_name} onChange={e => update('subject_last_name', e.target.value)} />
                  {formErrors.subject_last_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.subject_last_name}</p>}</div>
                <div><label htmlFor="ff-fieldinterviewspage-6" className="field-label">DOB</label>
                  <input id="ff-fieldinterviewspage-6" type="date" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_dob} onChange={e => update('subject_dob', e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><label htmlFor="ff-fieldinterviewspage-7" className="field-label">Gender</label>
                  <select id="ff-fieldinterviewspage-7" className="select-dark text-xs w-full" value={formData.subject_gender} onChange={e => update('subject_gender', e.target.value)}>
                    <option value="">—</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option>
                  </select></div>
                <div><label htmlFor="ff-fieldinterviewspage-8" className="field-label">Race</label>
                  <input id="ff-fieldinterviewspage-8" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_race} onChange={e => update('subject_race', e.target.value)} /></div>
                <div><label htmlFor="ff-fieldinterviewspage-9" className="field-label">Height</label>
                  <input id="ff-fieldinterviewspage-9" className="input-dark text-xs w-full min-h-[36px]" placeholder="5'10&quot;" value={formData.subject_height} onChange={e => update('subject_height', e.target.value)} /></div>
                <div><label htmlFor="ff-fieldinterviewspage-10" className="field-label">Weight</label>
                  <input id="ff-fieldinterviewspage-10" className="input-dark text-xs w-full min-h-[36px]" placeholder="180" value={formData.subject_weight} onChange={e => update('subject_weight', e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label htmlFor="ff-fieldinterviewspage-11" className="field-label">Hair</label>
                  <input id="ff-fieldinterviewspage-11" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_hair} onChange={e => update('subject_hair', e.target.value)} /></div>
                <div><label htmlFor="ff-fieldinterviewspage-12" className="field-label">Eyes</label>
                  <input id="ff-fieldinterviewspage-12" className="input-dark text-xs w-full min-h-[36px]" value={formData.subject_eye} onChange={e => update('subject_eye', e.target.value)} /></div>
                <div><label htmlFor="ff-fieldinterviewspage-13" className="field-label">Clothing</label>
                  <input id="ff-fieldinterviewspage-13" className="input-dark text-xs w-full min-h-[36px]" placeholder="Dark hoodie, jeans" value={formData.subject_clothing} onChange={e => update('subject_clothing', e.target.value)} /></div>
              </div>

              {/* UPGRADE 44: Gang Affiliation field */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label htmlFor="ff-fieldinterviewspage-14" className="field-label">Gang Affiliation</label>
                  <input id="ff-fieldinterviewspage-14" className="input-dark text-xs w-full min-h-[36px]" placeholder="Known gang affiliation (if any)" value={formData.gang_affiliation} onChange={e => update('gang_affiliation', e.target.value)} /></div>
                <div><label htmlFor="ff-fieldinterviewspage-15" className="field-label">Description</label>
                  <input id="ff-fieldinterviewspage-15" className="input-dark text-xs w-full min-h-[36px]" placeholder="Physical description" value={formData.subject_description} onChange={e => update('subject_description', e.target.value)} /></div>
              </div>

              {/* Location + reason */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label htmlFor="ff-fieldinterviewspage-16" className="field-label">Location *</label>
                  <input id="ff-fieldinterviewspage-16" className="input-dark text-xs w-full min-h-[36px]" value={formData.location} onChange={e => update('location', e.target.value)} />
                  {formErrors.location && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.location}</p>}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div><label htmlFor="ff-fieldinterviewspage-17" className="field-label">Reason</label>
                    <select id="ff-fieldinterviewspage-17" className="select-dark text-xs w-full" value={formData.contact_reason} onChange={e => update('contact_reason', e.target.value)}>
                      {CONTACT_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select></div>
                  <div><label htmlFor="ff-fieldinterviewspage-18" className="field-label">Type</label>
                    <select id="ff-fieldinterviewspage-18" className="select-dark text-xs w-full" value={formData.contact_type} onChange={e => update('contact_type', e.target.value)}>
                      {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select></div>
                </div>
              </div>

              {/* Section / Zone / Beat — cascading: zone scoped to section, beat scoped to zone */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="ff-fieldinterviewspage-19" className="field-label">Section</label>
                  <select id="ff-fieldinterviewspage-19" className="select-dark text-xs w-full"
                    value={formData.section_id || ''} onChange={e => { update('section_id', e.target.value); update('zone_id', ''); update('beat_id', ''); }}>
                    <option value="">—</option>
                    {sectionOptions.map(s => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-fieldinterviewspage-20" className="field-label">Zone</label>
                  <select id="ff-fieldinterviewspage-20" className="select-dark text-xs w-full"
                    value={formData.zone_id || ''} onChange={e => { update('zone_id', e.target.value); update('beat_id', ''); }}>
                    <option value="">—</option>
                    {zonesForSection(formData.section_id).map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-fieldinterviewspage-21" className="field-label">Beat</label>
                  <select id="ff-fieldinterviewspage-21" className="select-dark text-xs w-full"
                    value={formData.beat_id || ''} onChange={e => update('beat_id', e.target.value)}>
                    <option value="">—</option>
                    {beatsForZone(formData.zone_id).map(b => <option key={b} value={b}>{getBeatLabel(formData.zone_id, b)}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label htmlFor="ff-fieldinterviewspage-22" className="field-label">Action Taken</label>
                  <select id="ff-fieldinterviewspage-22" className="select-dark text-xs w-full" value={formData.action_taken} onChange={e => update('action_taken', e.target.value)}>
                    {ACTIONS_TAKEN.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select></div>
                <div><label htmlFor="ff-fieldinterviewspage-23" className="field-label">Vehicle Plate</label>
                  <input id="ff-fieldinterviewspage-23" className={`input-dark text-xs w-full ${formErrors.vehicle_plate ? '!border-red-500' : ''}`} value={formData.vehicle_plate} onChange={e => update('vehicle_plate', e.target.value)} />
                  {formErrors.vehicle_plate && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.vehicle_plate}</p>}</div>
                <div><label htmlFor="ff-fieldinterviewspage-24" className="field-label">Vehicle Desc.</label>
                  <input id="ff-fieldinterviewspage-24" className="input-dark text-xs w-full min-h-[36px]" value={formData.vehicle_description} onChange={e => update('vehicle_description', e.target.value)} /></div>
              </div>

              {/* Narrative */}
              <div><label htmlFor="ff-fieldinterviewspage-25" className="field-label">Narrative</label>
                <textarea id="ff-fieldinterviewspage-25" className="input-dark text-xs w-full min-h-[36px]" rows={4} value={formData.narrative} onChange={e => update('narrative', e.target.value)} /></div>

              {/* Actions */}
              <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-2'} pt-2 border-t border-rmpg-700`}>
                <button type="submit" disabled={submitting} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} />}
                  {editingFi ? 'Update' : 'Create'} FI Card
                </button>
                <button type="button" onClick={() => { clearFormDraft(); setFormOpen(false); }} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <UnsavedChangesGuard hasUnsavedChanges={formOpen && formIsDirty} />
      <FloatingSaveBar
        visible={formOpen && formIsDirty}
        onSave={() => { const e = { preventDefault: () => {} } as React.FormEvent; handleSubmit(e); }}
        onCancel={() => { clearFormDraft(); setFormOpen(false); }}
        isSaving={submitting}
        saveLabel={editingFi ? 'Update FI Card' : 'Create FI Card'}
      />

      {/* Admin God Mode hard-delete confirmation — replaces the native
          confirm() prompt. Routes through the existing ConfirmDialog
          component for a11y + visual consistency with every other
          destructive flow in the app. */}
      <ConfirmDialog
        isOpen={hardDeleteTarget !== null}
        onClose={() => setHardDeleteTarget(null)}
        onConfirm={confirmHardDelete}
        title="Permanently delete FI card"
        message="This will permanently remove the field-interview record from the database. The action cannot be undone."
        details={hardDeleteTarget && (
          <div className="space-y-1">
            <div><span className="text-rmpg-500">FI:</span> <span className="font-mono text-rmpg-200">{hardDeleteTarget.fi_number}</span></div>
            <div><span className="text-rmpg-500">Subject:</span> {hardDeleteTarget.subject_last_name ? `${hardDeleteTarget.subject_last_name}, ${hardDeleteTarget.subject_first_name || ''}` : 'Unknown'}</div>
            <div><span className="text-rmpg-500">Created:</span> {formatDateTime(hardDeleteTarget.created_at)}</div>
          </div>
        )}
        confirmLabel="Delete permanently"
        confirmVariant="danger"
      />
    </div>
  );
}
