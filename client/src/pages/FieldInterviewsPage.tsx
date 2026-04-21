import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, ClipboardList, MapPin, User, Clock, FileText,
  ChevronDown, Archive, RotateCcw, X, Save, Loader2, Eye,
} from 'lucide-react';
import type { FieldInterview, FIContactReason, FIContactType, FIActionTaken } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import ExportButton from '../components/ExportButton';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';
import { isValidPlate, isValidDate } from '../utils/validate';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { useDistrictOptions, useDistrictIdentify } from '../hooks/useDistrictLookup';
import WarrantBadge from '../components/WarrantBadge';

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
  traffic_stop: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  trespass: 'bg-red-900/50 text-red-400 border-red-700/50',
  welfare_check: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  investigation: 'bg-brand-900/50 text-brand-400 border-brand-700/50',
  other: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
};

const EMPTY_FORM = {
  subject_first_name: '', subject_last_name: '', subject_dob: '',
  subject_gender: '', subject_race: '', subject_height: '', subject_weight: '',
  subject_hair: '', subject_eye: '', subject_clothing: '', subject_description: '',
  location: '', contact_reason: 'other' as FIContactReason, contact_type: 'field' as FIContactType,
  action_taken: 'none' as FIActionTaken, narrative: '',
  vehicle_plate: '', vehicle_description: '',
  person_id: '',
  section_id: '', zone_id: '', beat_id: '',
};

export default function FieldInterviewsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();
  const { sections: sectionOptions, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  const { identify: identifyDistrict } = useDistrictIdentify();

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

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editingFi, setEditingFi] = useState<FieldInterview | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  // Person search
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const personSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<FieldInterview | null>(null);

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
  }, [page, searchQuery, filterReason, showArchived]);

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

  // ── Handlers ──
  const handleOpenNew = () => {
    setEditingFi(null);
    setFormData({ ...EMPTY_FORM });
    setSelectedPerson(null);
    setPersonSearch('');
    clearAllErrors();
    setFormOpen(true);
  };

  const handleEdit = (fi: FieldInterview) => {
    setEditingFi(fi);
    clearAllErrors();
    setFormData({
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
    });
    setFormOpen(true);
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PanelTitleBar icon={ClipboardList} title="FIELD INTERVIEWS">
        <span className="text-[9px] font-mono text-rmpg-400">{totalCount} TOTAL</span>
        <span className="toolbar-separator" />
        <ExportButton exportUrl="/field-interviews?per_page=9999" exportFilename="field_interviews_export.csv" />
        <button onClick={handleOpenNew} className="toolbar-btn">
          <Plus style={{ width: 11, height: 11 }} /> New FI Card
        </button>
      </PanelTitleBar>

      {/* Toolbar */}
      <div className={`flex ${isMobile ? 'flex-col gap-1.5' : 'items-center gap-2'} px-3 py-1.5 border-b border-rmpg-700`} className="bg-surface-base">
        <div className={`relative ${isMobile ? 'w-full' : 'flex-1 max-w-xs'}`}>
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            type="text" placeholder="Search FIs..." className={`input-dark pl-7 w-full ${isMobile ? 'text-sm py-2.5' : 'text-xs'}`}
            value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            style={isMobile ? { minHeight: 44 } : undefined}
          />
        </div>
        <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-2'}`}>
          <select className={`select-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs'}`} value={filterReason} onChange={e => { setFilterReason(e.target.value); setPage(1); }} style={isMobile ? { minHeight: 44 } : undefined}>
            <option value="">All Reasons</option>
            {CONTACT_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <label className={`flex items-center gap-1 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400 cursor-pointer`} style={isMobile ? { minHeight: 44 } : undefined}>
            <input type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); setPage(1); }} className="accent-brand-500" style={isMobile ? { width: 20, height: 20 } : undefined} />
            Archived
          </label>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-3 py-2 bg-red-900/40 border-b border-red-700 text-red-300 text-xs flex items-center justify-between">
          <span>Failed to load field interviews: {error}</span>
          <button onClick={() => fetchFis()} className="text-red-200 hover:text-white underline text-[10px]">Retry</button>
        </div>
      )}

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className={`${selectedFi && !isMobile ? 'w-[40%]' : 'w-full'} overflow-y-auto border-r border-rmpg-700`}>
          {loading && fis.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-rmpg-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : fis.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No field interviews found"
              description="Create a new FI card to get started."
              action={{ label: 'New FI Card', onClick: handleOpenNew }}
            />
          ) : (
            fis.map(fi => (
              <div
                key={fi.id}
                onClick={() => setSelectedFi(fi)}
                className={`px-3 ${isMobile ? 'py-3' : 'py-2'} cursor-pointer border-b border-rmpg-800 transition-colors hover:bg-surface-raised ${selectedFi?.id === fi.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                style={isMobile ? { minHeight: 56 } : undefined}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-bold font-mono text-brand-400">{fi.fi_number}</span>
                  <div className="flex items-center gap-1">
                    <span className={`text-[8px] font-bold px-1.5 py-0 border ${REASON_COLORS[fi.contact_reason] || REASON_COLORS.other}`}>
                      {(fi.contact_reason || '').replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span className={`text-[8px] font-bold px-1.5 py-0 border ${STATUS_COLORS[fi.status]}`}>
                      {(fi.status || '').toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-white font-medium flex items-center gap-1.5">
                  {fi.subject_last_name ? `${fi.subject_last_name}, ${fi.subject_first_name || ''}` : 'Unknown Subject'}
                  {fi.person_flags && <WarrantBadge flags={fi.person_flags} size="sm" />}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-rmpg-400 mt-0.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{fi.location}</span>
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
            <div className={`flex items-center justify-center gap-2 py-2 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400`}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined, minWidth: isMobile ? 48 : undefined }}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined, minWidth: isMobile ? 48 : undefined }}>Next</button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedFi && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-white font-mono">{selectedFi.fi_number}</h2>
                <span className="text-[10px] text-rmpg-400">Created {formatDateTime(selectedFi.created_at)}</span>
              </div>
              <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-1'}`}>
                <button onClick={() => handleEdit(selectedFi)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                  <FileText style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Edit
                </button>
                {selectedFi.status === 'active' ? (
                  <button onClick={() => handleArchive(selectedFi)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                    <Archive style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Archive
                  </button>
                ) : (
                  <button onClick={() => handleUnarchive(selectedFi)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                    <RotateCcw style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Restore
                  </button>
                )}
                <button onClick={() => setSelectedFi(null)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px', minHeight: isMobile ? 48 : undefined }}>
                  <X style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} />
                </button>
              </div>
            </div>

            {/* Warrant warning banner */}
            {selectedFi.person_flags && (() => {
              try {
                const flags = typeof selectedFi.person_flags === 'string' ? JSON.parse(selectedFi.person_flags || '[]') : (selectedFi.person_flags || []);
                const hasWarrant = flags.some((f: any) => f?.type === 'ACTIVE_WARRANT' || f === 'ACTIVE_WARRANT');
                if (!hasWarrant) return null;
                return (
                  <div className="bg-red-900/50 border border-red-500 rounded-sm px-3 py-2 text-red-200 text-sm font-bold mb-3">
                    ⚠️ SUBJECT HAS ACTIVE WARRANTS — Exercise caution
                  </div>
                );
              } catch { return null; }
            })()}

            {/* Detail grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div><span className="text-rmpg-500 text-[10px] uppercase">Subject</span><div className="text-white font-medium flex items-center gap-1.5">{selectedFi.subject_last_name}, {selectedFi.subject_first_name}{selectedFi.person_flags && <WarrantBadge flags={selectedFi.person_flags} size="sm" />}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">DOB</span><div className="text-white">{selectedFi.subject_dob ? formatDate(selectedFi.subject_dob) : '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Gender / Race</span><div className="text-white">{[selectedFi.subject_gender, selectedFi.subject_race].filter(Boolean).join(' / ') || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Build</span><div className="text-white">{[selectedFi.subject_height, selectedFi.subject_weight ? `${selectedFi.subject_weight} lbs` : ''].filter(Boolean).join(', ') || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Hair / Eyes</span><div className="text-white">{[selectedFi.subject_hair, selectedFi.subject_eye].filter(Boolean).join(' / ') || '—'}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Clothing</span><div className="text-white">{selectedFi.subject_clothing || '—'}</div></div>
              <div className="col-span-2"><span className="text-rmpg-500 text-[10px] uppercase">Location</span><div className="text-white">{selectedFi.location}</div></div>
              {((selectedFi as any).section_id || (selectedFi as any).zone_id || (selectedFi as any).beat_id) && (
                <div className="col-span-2"><span className="text-rmpg-500 text-[10px] uppercase">Section / Zone / Beat</span><div className="text-white">{[(selectedFi as any).section_id, (selectedFi as any).zone_id, (selectedFi as any).beat_id].filter(Boolean).join(' / ') || '—'}</div></div>
              )}
              <div><span className="text-rmpg-500 text-[10px] uppercase">Contact Reason</span><div className="text-white capitalize">{selectedFi.contact_reason.replace(/_/g, ' ')}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Contact Type</span><div className="text-white capitalize">{selectedFi.contact_type}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Action Taken</span><div className="text-white capitalize">{selectedFi.action_taken}</div></div>
              <div><span className="text-rmpg-500 text-[10px] uppercase">Officer</span><div className="text-white">{selectedFi.officer_name || selectedFi.officer_display_name || '—'}</div></div>
              {selectedFi.vehicle_plate && <div><span className="text-rmpg-500 text-[10px] uppercase">Vehicle</span><div className="text-white">{selectedFi.vehicle_plate} {selectedFi.vehicle_description}</div></div>}
            </div>

            {/* Narrative */}
            {selectedFi.narrative && (
              <div className="mt-3 pt-2 border-t border-rmpg-700">
                <span className="text-rmpg-500 text-[10px] uppercase">Narrative</span>
                <p className="text-xs text-rmpg-200 mt-1 whitespace-pre-wrap">{selectedFi.narrative}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-600 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700 bg-surface-base">
              <span className="text-xs font-bold text-white uppercase">{editingFi ? 'Edit' : 'New'} Field Interview</span>
              <button onClick={() => setFormOpen(false)} className="text-rmpg-400 hover:text-white"><X style={{ width: 14, height: 14 }} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              {/* Person search */}
              <div>
                <label className="field-label">Link to Person Record (Optional)</label>
                <div className="relative">
                  <input type="text" className="input-dark text-xs w-full" placeholder="Search person records..."
                    value={personSearch} onChange={e => setPersonSearch(e.target.value)} />
                  {personResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-rmpg-600 max-h-40 overflow-y-auto">
                      {personResults.map((p: any) => (
                        <button key={p.id} type="button" onClick={() => selectPerson(p)}
                          className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-rmpg-700 flex items-center gap-2">
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
                <div><label className="field-label">First Name</label>
                  <input className="input-dark text-xs w-full" value={formData.subject_first_name} onChange={e => update('subject_first_name', e.target.value)} /></div>
                <div><label className="field-label">Last Name *</label>
                  <input className="input-dark text-xs w-full" value={formData.subject_last_name} onChange={e => update('subject_last_name', e.target.value)} />
                  {formErrors.subject_last_name && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.subject_last_name}</p>}</div>
                <div><label className="field-label">DOB</label>
                  <input type="date" className="input-dark text-xs w-full" value={formData.subject_dob} onChange={e => update('subject_dob', e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><label className="field-label">Gender</label>
                  <select className="select-dark text-xs w-full" value={formData.subject_gender} onChange={e => update('subject_gender', e.target.value)}>
                    <option value="">—</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option>
                  </select></div>
                <div><label className="field-label">Race</label>
                  <input className="input-dark text-xs w-full" value={formData.subject_race} onChange={e => update('subject_race', e.target.value)} /></div>
                <div><label className="field-label">Height</label>
                  <input className="input-dark text-xs w-full" placeholder="5'10&quot;" value={formData.subject_height} onChange={e => update('subject_height', e.target.value)} /></div>
                <div><label className="field-label">Weight</label>
                  <input className="input-dark text-xs w-full" placeholder="180" value={formData.subject_weight} onChange={e => update('subject_weight', e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className="field-label">Hair</label>
                  <input className="input-dark text-xs w-full" value={formData.subject_hair} onChange={e => update('subject_hair', e.target.value)} /></div>
                <div><label className="field-label">Eyes</label>
                  <input className="input-dark text-xs w-full" value={formData.subject_eye} onChange={e => update('subject_eye', e.target.value)} /></div>
                <div><label className="field-label">Clothing</label>
                  <input className="input-dark text-xs w-full" placeholder="Dark hoodie, jeans" value={formData.subject_clothing} onChange={e => update('subject_clothing', e.target.value)} /></div>
              </div>

              {/* Location + reason */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label className="field-label">Location *</label>
                  <input className="input-dark text-xs w-full" value={formData.location} onChange={e => update('location', e.target.value)} />
                  {formErrors.location && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.location}</p>}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div><label className="field-label">Reason</label>
                    <select className="select-dark text-xs w-full" value={formData.contact_reason} onChange={e => update('contact_reason', e.target.value)}>
                      {CONTACT_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select></div>
                  <div><label className="field-label">Type</label>
                    <select className="select-dark text-xs w-full" value={formData.contact_type} onChange={e => update('contact_type', e.target.value)}>
                      {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select></div>
                </div>
              </div>

              {/* Section / Zone / Beat — cascading: zone scoped to section, beat scoped to zone */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="field-label">Section</label>
                  <select className="select-dark text-[11px]"
                    value={formData.section_id || ''} onChange={e => { update('section_id', e.target.value); update('zone_id', ''); update('beat_id', ''); }}>
                    <option value="">—</option>
                    {sectionOptions.map(s => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Zone</label>
                  <select className="select-dark text-[11px]"
                    value={formData.zone_id || ''} onChange={e => { update('zone_id', e.target.value); update('beat_id', ''); }}>
                    <option value="">—</option>
                    {zonesForSection(formData.section_id).map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Beat</label>
                  <select className="select-dark text-[11px]"
                    value={formData.beat_id || ''} onChange={e => update('beat_id', e.target.value)}>
                    <option value="">—</option>
                    {beatsForZone(formData.zone_id).map(b => <option key={b} value={b}>{getBeatLabel(formData.zone_id, b)}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className="field-label">Action Taken</label>
                  <select className="select-dark text-xs w-full" value={formData.action_taken} onChange={e => update('action_taken', e.target.value)}>
                    {ACTIONS_TAKEN.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select></div>
                <div><label className="field-label">Vehicle Plate</label>
                  <input className={`input-dark text-xs w-full ${formErrors.vehicle_plate ? '!border-red-500' : ''}`} value={formData.vehicle_plate} onChange={e => update('vehicle_plate', e.target.value)} />
                  {formErrors.vehicle_plate && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.vehicle_plate}</p>}</div>
                <div><label className="field-label">Vehicle Desc.</label>
                  <input className="input-dark text-xs w-full" value={formData.vehicle_description} onChange={e => update('vehicle_description', e.target.value)} /></div>
              </div>

              {/* Narrative */}
              <div><label className="field-label">Narrative</label>
                <textarea className="input-dark text-xs w-full" rows={4} value={formData.narrative} onChange={e => update('narrative', e.target.value)} /></div>

              {/* Actions */}
              <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-2'} pt-2 border-t border-rmpg-700`}>
                <button type="submit" disabled={submitting} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={{ background: 'rgba(26,90,158,0.3)', borderColor: 'rgba(26,90,158,0.5)', minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 14 : undefined }}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} />}
                  {editingFi ? 'Update' : 'Create'} FI Card
                </button>
                <button type="button" onClick={() => setFormOpen(false)} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
