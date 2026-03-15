// ============================================================
// RMPG Flex — Citations / Summons Page
// ============================================================
// Full citation management: list, create, edit, detail view.
// Left panel = filterable list, right panel = detail or form.
// Integrates StatuteLookup for violation code selection.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileWarning,
  Plus,
  Search,
  Filter,
  X,
  Loader2,
  AlertTriangle,
  Check,
  Scale,
  User,
  Car,
  Calendar,
  DollarSign,
  Clock,
  Hash,
  MapPin,
  FileText,
  Ban,
  RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { toDisplayLabel } from '../utils/formatters';
import { useLiveSync } from '../hooks/useLiveSync';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import StatuteLookup, { type StatuteResult } from '../components/StatuteLookup';
import PrintRecordButton from '../components/PrintRecordButton';
import type { CitationPdfData } from '../utils/recordPdfGenerator';
import { localToday, formatDate } from '../utils/dateUtils';
import { useFormValidation } from '../hooks/useFormValidation';
import { isValidDate, isValidPlate, isValidState } from '../utils/validate';
import { useDistrictOptions, useDistrictIdentify } from '../hooks/useDistrictLookup';

// ── Types ──────────────────────────────────────────────────

type CitationType = 'traffic' | 'criminal' | 'parking' | 'warning';
type CitationStatus = 'issued' | 'paid' | 'contested' | 'dismissed' | 'warrant_issued' | 'voided';

interface Citation {
  id: number;
  citation_number: string;
  type: CitationType;
  status: CitationStatus;
  person_id: number | null;
  person_name: string | null;
  person_dob: string | null;
  person_dl: string | null;
  person_address: string | null;
  vehicle_description: string | null;
  vehicle_plate: string | null;
  vehicle_state: string | null;
  statute_id: number | null;
  statute_citation: string | null;
  violation_description: string | null;
  offense_level: string | null;
  fine_amount: number | null;
  violation_date: string | null;
  violation_time: string | null;
  location: string | null;
  incident_id: number | null;
  call_id: number | null;
  issuing_officer_id: number | null;
  issuing_officer_name: string | null;
  badge_number: string | null;
  court_date: string | null;
  court_name: string | null;
  court_address: string | null;
  notes: string | null;
  section_id: string | null;
  zone_id: string | null;
  beat_id: string | null;
  zone_beat: string | null;
  created_at: string;
  updated_at: string;
}

interface CitationStats {
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  total: number;
  fines_issued: number;
  fines_collected: number;
  today_count: number;
}

interface CitationForm {
  type: CitationType;
  status: CitationStatus;
  person_id: string;
  person_name: string;
  person_dob: string;
  person_dl: string;
  person_address: string;
  vehicle_description: string;
  vehicle_plate: string;
  vehicle_state: string;
  statute_id: string;
  statute_citation: string;
  violation_description: string;
  offense_level: string;
  fine_amount: string;
  violation_date: string;
  violation_time: string;
  location: string;
  issuing_officer_name: string;
  badge_number: string;
  court_date: string;
  court_name: string;
  court_address: string;
  notes: string;
  section_id: string;
  zone_id: string;
  beat_id: string;
  zone_beat: string;
}

// ── Constants ──────────────────────────────────────────────

const CITATION_TYPES: { value: CitationType; label: string }[] = [
  { value: 'traffic', label: 'Traffic' },
  { value: 'criminal', label: 'Criminal' },
  { value: 'parking', label: 'Parking' },
  { value: 'warning', label: 'Warning' },
];

const CITATION_STATUSES: { value: CitationStatus; label: string }[] = [
  { value: 'issued', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'contested', label: 'Contested' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'warrant_issued', label: 'Warrant Issued' },
  { value: 'voided', label: 'Voided' },
];

const STATUS_BADGE: Record<string, string> = {
  issued: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  paid: 'bg-green-900/50 text-green-300 border-green-700/50',
  contested: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  dismissed: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  warrant_issued: 'bg-red-900/60 text-red-300 border-red-700/50',
  voided: 'bg-rmpg-800/50 text-rmpg-500 border-rmpg-700/50',
};

const TYPE_BADGE: Record<string, string> = {
  traffic: 'bg-brand-900/40 text-brand-300 border-brand-700/50',
  criminal: 'bg-red-900/40 text-red-300 border-red-700/50',
  parking: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
};

const US_STATES = [
  'UT','AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','VT','VA','WA','WV','WI','WY',
];

const EMPTY_FORM: CitationForm = {
  type: 'traffic',
  status: 'issued',
  person_id: '',
  person_name: '',
  person_dob: '',
  person_dl: '',
  person_address: '',
  vehicle_description: '',
  vehicle_plate: '',
  vehicle_state: 'UT',
  statute_id: '',
  statute_citation: '',
  violation_description: '',
  offense_level: '',
  fine_amount: '',
  violation_date: localToday(),
  violation_time: new Date().toTimeString().slice(0, 5),
  location: '',
  issuing_officer_name: '',
  badge_number: '',
  court_date: '',
  court_name: '',
  court_address: '',
  notes: '',
  section_id: '',
  zone_id: '',
  beat_id: '',
  zone_beat: '',
};

// formatDate imported from ../utils/dateUtils

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '--';
  return `$${Number(n).toFixed(2)}`;
}

// ── Component ──────────────────────────────────────────────

export default function CitationsPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { sections: sectionOptions, zones: zoneOptions, beats: beatOptions } = useDistrictOptions();
  const { identify: identifyDistrict } = useDistrictIdentify();

  // List state
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<CitationType | ''>('');
  const [filterStatus, setFilterStatus] = useState<CitationStatus | ''>('');
  const [stats, setStats] = useState<CitationStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Detail state
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Form state
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [form, setForm] = useState<CitationForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const { errors: formErrors, validate: runValidation, clearAllErrors: clearFormErrors } = useFormValidation();

  // Person search state
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [personSearching, setPersonSearching] = useState(false);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const personDropdownRef = useRef<HTMLDivElement>(null);
  const personSearchTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Data fetching ────────────────────────────────────────

  const fetchCitations = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(''); }
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (filterType) params.set('type', filterType);
      if (filterStatus) params.set('status', filterStatus);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const res = await apiFetch<{ data: Citation[]; pagination: any }>(`/citations?${params}`);
      setCitations(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
    } catch (err: any) {
      if (!options?.silent) setError(err.message || 'Failed to load citations');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [page, filterType, filterStatus, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: CitationStats }>('/citations/stats');
      setStats(res.data);
    } catch {
      // stats are non-critical
    }
  }, []);

  useEffect(() => {
    fetchCitations();
  }, [fetchCitations]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Live sync — auto-refresh when any device modifies citations (silent to avoid unmounting UI)
  const silentRefreshCitations = useCallback(() => fetchCitations({ silent: true }), [fetchCitations]);
  useLiveSync('citations', silentRefreshCitations);

  // Close person dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (personDropdownRef.current && !personDropdownRef.current.contains(e.target as Node)) {
        setShowPersonDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Person search ────────────────────────────────────────

  const handlePersonSearchChange = (val: string) => {
    setPersonSearch(val);
    if (personSearchTimer.current) clearTimeout(personSearchTimer.current);
    if (val.length < 2) {
      setPersonResults([]);
      setShowPersonDropdown(false);
      return;
    }
    setPersonSearching(true);
    personSearchTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ data: any[] }>(`/records/persons/search?q=${encodeURIComponent(val)}&limit=10`);
        setPersonResults(res.data || []);
        setShowPersonDropdown(true);
      } catch {
        setPersonResults([]);
      } finally {
        setPersonSearching(false);
      }
    }, 300);
  };

  const selectPerson = (p: any) => {
    setForm(prev => ({
      ...prev,
      person_id: String(p.id),
      person_name: [p.last_name, p.first_name].filter(Boolean).join(', '),
      person_dob: p.dob || '',
      person_dl: p.dl_number || '',
      person_address: [p.address, p.city, p.state, p.zip].filter(Boolean).join(', '),
    }));
    setPersonSearch([p.last_name, p.first_name].filter(Boolean).join(', '));
    setShowPersonDropdown(false);
  };

  const clearPerson = () => {
    setForm(prev => ({
      ...prev, person_id: '', person_name: '', person_dob: '', person_dl: '', person_address: '',
    }));
    setPersonSearch('');
  };

  // ── Statute lookup ───────────────────────────────────────

  const handleStatuteSelect = (statute: StatuteResult) => {
    setForm(prev => ({
      ...prev,
      statute_id: String(statute.id),
      statute_citation: statute.citation,
      violation_description: prev.violation_description || statute.short_title,
      offense_level: statute.offense_level || prev.offense_level,
      fine_amount: statute.citation_fine ? String(statute.citation_fine) : prev.fine_amount,
    }));
  };

  const clearStatute = () => {
    setForm(prev => ({ ...prev, statute_id: '', statute_citation: '', offense_level: '' }));
  };

  // ── Form helpers ─────────────────────────────────────────

  const updateField = (key: keyof CitationForm, value: any) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      // Auto-compute zone_beat when zone or beat changes
      if (key === 'zone_id' || key === 'beat_id') {
        const z = key === 'zone_id' ? value : prev.zone_id;
        const b = key === 'beat_id' ? value : prev.beat_id;
        next.zone_beat = (z && b) ? `${z}-${b}` : '';
      }
      return next;
    });
  };

  const handleNewCitation = () => {
    setForm({
      ...EMPTY_FORM,
      violation_date: localToday(),
      violation_time: new Date().toTimeString().slice(0, 5),
      issuing_officer_name: (user as any)?.full_name || (user as any)?.username || '',
      badge_number: (user as any)?.badge_number || '',
    });
    setPersonSearch('');
    setSaveError('');
    setSaveSuccess(false);
    clearFormErrors();
    setMode('create');
    setSelectedCitation(null);
  };

  const handleEditCitation = (c: Citation) => {
    setForm({
      type: c.type,
      status: c.status,
      person_id: c.person_id ? String(c.person_id) : '',
      person_name: c.person_name || '',
      person_dob: c.person_dob || '',
      person_dl: c.person_dl || '',
      person_address: c.person_address || '',
      vehicle_description: c.vehicle_description || '',
      vehicle_plate: c.vehicle_plate || '',
      vehicle_state: c.vehicle_state || 'UT',
      statute_id: c.statute_id ? String(c.statute_id) : '',
      statute_citation: c.statute_citation || '',
      violation_description: c.violation_description || '',
      offense_level: c.offense_level || '',
      fine_amount: c.fine_amount != null ? String(c.fine_amount) : '',
      violation_date: c.violation_date || '',
      violation_time: c.violation_time || '',
      location: c.location || '',
      issuing_officer_name: c.issuing_officer_name || '',
      badge_number: c.badge_number || '',
      court_date: c.court_date || '',
      court_name: c.court_name || '',
      court_address: c.court_address || '',
      notes: c.notes || '',
      section_id: c.section_id || '',
      zone_id: c.zone_id || '',
      beat_id: c.beat_id || '',
      zone_beat: c.zone_beat || '',
    });
    setPersonSearch(c.person_name || '');
    setSaveError('');
    setSaveSuccess(false);
    clearFormErrors();
    setMode('edit');
  };

  const handleCancelForm = () => {
    setMode('list');
    clearFormErrors();
    setSaveError('');
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    const isValid = runValidation(form, {
      violation_description: { required: true, minLength: 3 },
      violation_date: { required: true, custom: isValidDate, customMessage: 'Valid date required' },
      person_name: { required: true },
      vehicle_plate: { custom: (v) => !v || isValidPlate(v), customMessage: 'Invalid plate format (2–8 alphanumeric)' },
      vehicle_state: { custom: (v) => !v || isValidState(v), customMessage: 'Invalid US state abbreviation' },
    });
    if (!isValid) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);

    try {
      const payload: any = {
        ...form,
        person_id: form.person_id ? parseInt(form.person_id, 10) : null,
        statute_id: form.statute_id ? parseInt(form.statute_id, 10) : null,
        fine_amount: form.fine_amount ? parseFloat(form.fine_amount) : null,
        issuing_officer_id: (user as any)?.userId || null,
      };

      if (mode === 'create') {
        const res = await apiFetch<{ data: Citation }>('/citations', { method: 'POST', body: JSON.stringify(payload) });
        setSelectedCitation(res.data);
        setSaveSuccess(true);
        setTimeout(() => {
          setMode('list');
          setSaveSuccess(false);
          fetchCitations({ silent: true });
          fetchStats();
        }, 1200);
      } else if (mode === 'edit' && selectedCitation) {
        const res = await apiFetch<{ data: Citation }>(`/citations/${selectedCitation.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setSelectedCitation(res.data);
        setSaveSuccess(true);
        setTimeout(() => {
          setMode('list');
          setSaveSuccess(false);
          fetchCitations({ silent: true });
          fetchStats();
        }, 1200);
      }
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save citation');
    } finally {
      setSaving(false);
    }
  };

  // ── Void ─────────────────────────────────────────────────

  const handleVoid = async (c: Citation) => {
    if (!confirm(`Void citation ${c.citation_number}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/citations/${c.id}`, { method: 'DELETE' });
      fetchCitations({ silent: true });
      fetchStats();
      if (selectedCitation?.id === c.id) setSelectedCitation(null);
    } catch (err: any) {
      alert(err.message || 'Failed to void citation');
    }
  };

  // ── Select citation ──────────────────────────────────────

  const handleSelectCitation = async (c: Citation) => {
    if (mode !== 'list') return;
    setDetailLoading(true);
    try {
      const res = await apiFetch<{ data: Citation }>(`/citations/${c.id}`);
      setSelectedCitation(res.data);
    } catch {
      setSelectedCitation(c);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Statute category filter based on citation type ───────

  const statuteCategoryFilter = form.type === 'traffic' || form.type === 'parking' ? 'vehicle' as const : undefined;

  // ============================================================
  // Stats bar
  // ============================================================

  const renderStatsBar = () => {
    if (!stats) return null;
    return (
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-brand-900/30 text-brand-300 border-brand-700/50">
          <Hash size={10} /> {stats.total} Total
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-blue-900/30 text-blue-300 border-blue-700/50">
          <FileWarning size={10} /> {stats.by_status.issued || 0} Issued
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-green-900/30 text-green-300 border-green-700/50">
          <Check size={10} /> {stats.by_status.paid || 0} Paid
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-amber-900/30 text-amber-300 border-amber-700/50">
          <AlertTriangle size={10} /> {stats.by_status.contested || 0} Contested
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-red-900/30 text-red-300 border-red-700/50">
          <Scale size={10} /> {stats.by_status.warrant_issued || 0} Warrant
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-green-900/20 text-green-400 border-green-700/40">
          <DollarSign size={10} /> Collected: {formatCurrency(stats.fines_collected)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-rmpg-800/40 text-rmpg-300 border-rmpg-600/50">
          <Clock size={10} /> Today: {stats.today_count}
        </span>
      </div>
    );
  };

  // ============================================================
  // Left panel: list
  // ============================================================

  const renderListPanel = () => (
    <>
      {/* Search & filters header */}
      <div className="p-3 border-b border-rmpg-700 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search citations..."
              className="input-dark w-full py-1.5 pl-8 pr-3 text-xs"
            />
          </div>
          <button onClick={handleNewCitation} className="toolbar-btn toolbar-btn-primary" title="New Citation">
            <Plus size={12} /> New
          </button>
          <button onClick={() => { fetchCitations(); fetchStats(); }} className="text-rmpg-400 hover:text-rmpg-200 p-1 transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
        {/* Filter row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={10} className="text-rmpg-500" />
          <select value={filterType} onChange={e => { setFilterType(e.target.value as any); setPage(1); }} className="input-dark py-1 px-2 text-[10px]">
            <option value="">All Types</option>
            {CITATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value as any); setPage(1); }} className="input-dark py-1 px-2 text-[10px]">
            <option value="">All Statuses</option>
            {CITATION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* List body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-brand-400 mr-2" />
            <span className="text-xs text-rmpg-400">Loading...</span>
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-red-400 flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        ) : citations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
            <FileWarning size={32} className="mb-2 opacity-30" />
            <p className="text-xs">No citations found</p>
          </div>
        ) : (
          citations.map(c => (
            <button
              key={c.id}
              onClick={() => handleSelectCitation(c)}
              className={`w-full text-left px-3 py-2 border-b border-rmpg-700/50 hover:bg-rmpg-700/20 transition-colors ${
                selectedCitation?.id === c.id && mode === 'list' ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[11px] font-mono font-bold text-white">{c.citation_number}</span>
                <span className={`inline-flex items-center px-1.5 py-0 text-[9px] font-bold uppercase border panel-beveled ${STATUS_BADGE[c.status] || ''}`}>
                  {c.status.replace(/_/g, ' ')}
                </span>
                <span className={`inline-flex items-center px-1.5 py-0 text-[9px] font-bold uppercase border panel-beveled ${TYPE_BADGE[c.type] || ''}`}>
                  {toDisplayLabel(c.type)}
                </span>
                <span className="text-[10px] text-rmpg-500 ml-auto">{formatDate(c.violation_date)}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                {c.person_name && <span className="text-rmpg-300">{c.person_name}</span>}
                {c.statute_citation && <span className="text-rmpg-500 font-mono">{c.statute_citation}</span>}
              </div>
              {c.violation_description && (
                <p className="text-[10px] text-rmpg-400 truncate mt-0.5">{c.violation_description}</p>
              )}
            </button>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-rmpg-700 text-[10px] text-rmpg-400">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="hover:text-rmpg-200 disabled:opacity-30">
            Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="hover:text-rmpg-200 disabled:opacity-30">
            Next
          </button>
        </div>
      )}
    </>
  );

  // ============================================================
  // Detail view
  // ============================================================

  const renderDetailView = () => {
    if (!selectedCitation) return null;
    const c = selectedCitation;

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-rmpg-700">
          <Hash size={14} className="text-rmpg-400" />
          <h2 className="text-sm font-mono font-bold text-white">{c.citation_number}</h2>
          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border panel-beveled ${STATUS_BADGE[c.status] || ''}`}>
            {c.status.replace(/_/g, ' ')}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border panel-beveled ${TYPE_BADGE[c.type] || ''}`}>
            {toDisplayLabel(c.type)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <PrintRecordButton
              recordType="citation"
              recordData={{
                citation_number: c.citation_number,
                type: c.type,
                status: c.status,
                person_name: c.person_name || undefined,
                person_dob: c.person_dob || undefined,
                person_dl: c.person_dl || undefined,
                person_address: c.person_address || undefined,
                vehicle_description: c.vehicle_description || undefined,
                vehicle_plate: c.vehicle_plate || undefined,
                vehicle_state: c.vehicle_state || undefined,
                statute_citation: c.statute_citation || undefined,
                violation_description: c.violation_description || undefined,
                offense_level: c.offense_level || undefined,
                fine_amount: c.fine_amount ?? undefined,
                violation_date: c.violation_date || undefined,
                violation_time: c.violation_time || undefined,
                location: c.location || undefined,
                issuing_officer_name: c.issuing_officer_name || undefined,
                badge_number: c.badge_number || undefined,
                court_date: c.court_date || undefined,
                court_name: c.court_name || undefined,
                court_address: c.court_address || undefined,
                notes: c.notes || undefined,
                created_at: c.created_at,
                updated_at: c.updated_at,
              } as CitationPdfData}
              identifier={c.citation_number}
              entityType="citation"
              entityId={c.id}
              iconOnly
            />
            <button onClick={() => handleEditCitation(c)} className="toolbar-btn text-[10px]">
              <FileText size={12} /> Edit
            </button>
            {c.status !== 'voided' && (
              <button onClick={() => handleVoid(c)} className="toolbar-btn text-[10px] text-red-400 hover:text-red-300">
                <Ban size={12} /> Void
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Violation */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1">
              <Scale size={10} /> Violation
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              {c.statute_citation && (
                <div><span className="text-rmpg-400">Statute:</span> <span className="text-rmpg-200 font-mono">{c.statute_citation}</span></div>
              )}
              {c.violation_description && (
                <div><span className="text-rmpg-400">Description:</span> <span className="text-rmpg-200">{c.violation_description}</span></div>
              )}
              {c.offense_level && (
                <div><span className="text-rmpg-400">Offense Level:</span> <span className="text-rmpg-200 capitalize">{c.offense_level.replace(/_/g, ' ')}</span></div>
              )}
              {c.fine_amount != null && (
                <div><span className="text-rmpg-400">Fine:</span> <span className="text-green-400 font-bold">{formatCurrency(c.fine_amount)}</span></div>
              )}
            </div>
          </section>

          {/* Subject */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1">
              <User size={10} /> Subject
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              {c.person_name && <div><span className="text-rmpg-400">Name:</span> <span className="text-rmpg-200">{c.person_name}</span></div>}
              {c.person_dob && <div><span className="text-rmpg-400">DOB:</span> <span className="text-rmpg-200">{formatDate(c.person_dob)}</span></div>}
              {c.person_dl && <div><span className="text-rmpg-400">DL#:</span> <span className="text-rmpg-200 font-mono">{c.person_dl}</span></div>}
              {c.person_address && <div><span className="text-rmpg-400">Address:</span> <span className="text-rmpg-200">{c.person_address}</span></div>}
            </div>
          </section>

          {/* Vehicle */}
          {(c.vehicle_description || c.vehicle_plate) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1">
                <Car size={10} /> Vehicle
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {c.vehicle_description && <div><span className="text-rmpg-400">Description:</span> <span className="text-rmpg-200">{c.vehicle_description}</span></div>}
                {c.vehicle_plate && <div><span className="text-rmpg-400">Plate:</span> <span className="text-rmpg-200 font-mono">{c.vehicle_plate}</span> <span className="text-rmpg-500">({c.vehicle_state || 'UT'})</span></div>}
              </div>
            </section>
          )}

          {/* Location & Time */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1">
              <MapPin size={10} /> Location & Time
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              <div><span className="text-rmpg-400">Date:</span> <span className="text-rmpg-200">{formatDate(c.violation_date)}</span></div>
              {c.violation_time && <div><span className="text-rmpg-400">Time:</span> <span className="text-rmpg-200">{c.violation_time}</span></div>}
              {c.location && <div><span className="text-rmpg-400">Location:</span> <span className="text-rmpg-200">{c.location}</span></div>}
              {(c.section_id || c.zone_id || c.beat_id) && (
                <div><span className="text-rmpg-400">S/Z/B:</span> <span className="text-rmpg-200 font-mono">{c.section_id || '—'} / {c.zone_id || '—'} / {c.beat_id || '—'}</span></div>
              )}
            </div>
          </section>

          {/* Officer */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1">
              <User size={10} /> Issuing Officer
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              {c.issuing_officer_name && <div><span className="text-rmpg-400">Officer:</span> <span className="text-rmpg-200">{c.issuing_officer_name}</span></div>}
              {c.badge_number && <div><span className="text-rmpg-400">Badge:</span> <span className="text-rmpg-200 font-mono">{c.badge_number}</span></div>}
            </div>
          </section>

          {/* Court */}
          {(c.court_date || c.court_name) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1">
                <Scale size={10} /> Court Information
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {c.court_date && <div><span className="text-rmpg-400">Court Date:</span> <span className="text-rmpg-200">{formatDate(c.court_date)}</span></div>}
                {c.court_name && <div><span className="text-rmpg-400">Court:</span> <span className="text-rmpg-200">{c.court_name}</span></div>}
                {c.court_address && <div><span className="text-rmpg-400">Address:</span> <span className="text-rmpg-200">{c.court_address}</span></div>}
              </div>
            </section>
          )}

          {/* Notes */}
          {c.notes && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2">Notes</h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 text-xs text-rmpg-200 whitespace-pre-wrap">{c.notes}</div>
            </section>
          )}

          {/* Timestamps */}
          <div className="text-[9px] text-rmpg-600 pt-2 border-t border-rmpg-700/50 flex gap-4">
            <span>Created: {formatDate(c.created_at)}</span>
            <span>Updated: {formatDate(c.updated_at)}</span>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // Form (create / edit)
  // ============================================================

  const showVehicleSection = form.type === 'traffic' || form.type === 'parking';
  const isEdit = mode === 'edit';

  const renderForm = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Form header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-300">
          {isEdit ? `Edit Citation ${selectedCitation?.citation_number || ''}` : 'New Citation / Summons'}
        </h2>
        <button onClick={handleCancelForm} className="text-rmpg-400 hover:text-rmpg-200 transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {saveError && (
          <div className="bg-red-900/40 border border-red-700/50 px-3 py-2 text-xs text-red-300 flex items-center gap-2">
            <AlertTriangle size={14} /> {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="bg-green-900/40 border border-green-700/50 px-3 py-2 text-xs text-green-300 flex items-center gap-2">
            <Check size={14} /> Citation saved successfully
          </div>
        )}

        {/* Type selector */}
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2">Citation Type</h3>
          <div className="flex gap-2 flex-wrap">
            {CITATION_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => updateField('type', t.value)}
                className={`px-3 py-1.5 text-xs font-bold uppercase transition-colors border ${
                  form.type === t.value
                    ? TYPE_BADGE[t.value] + ' ring-1 ring-brand-500/50'
                    : 'border-rmpg-600 text-rmpg-400 bg-rmpg-800/40 hover:bg-rmpg-700/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* Status (edit only) */}
        {isEdit && (
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2">Status</h3>
            <select value={form.status} onChange={e => updateField('status', e.target.value)} className="input-dark w-full py-2 text-xs">
              {CITATION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </section>
        )}

        {/* Violation */}
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1.5">
            <Scale size={12} /> Violation
          </h3>
          <div className="space-y-3">
            <div>
              <label className="field-label">Statute Search</label>
              <StatuteLookup
                onSelect={handleStatuteSelect}
                value={form.statute_citation || undefined}
                onClear={clearStatute}
                categoryFilter={statuteCategoryFilter}
                placeholder="Search statute code or description..."
                showStateFilter
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Statute Citation</label>
                <input type="text" value={form.statute_citation} onChange={e => updateField('statute_citation', e.target.value)} placeholder="e.g. 41-6a-601" className="input-dark w-full py-2 text-xs font-mono" />
              </div>
              <div>
                <label className="field-label">Offense Level</label>
                <input type="text" value={form.offense_level} onChange={e => updateField('offense_level', e.target.value)} placeholder="e.g. infraction" className="input-dark w-full py-2 text-xs capitalize" />
              </div>
            </div>
            <div>
              <label className="field-label">Violation Description *</label>
              <input
                type="text"
                value={form.violation_description}
                onChange={e => updateField('violation_description', e.target.value)}
                placeholder="Describe the violation..."
                className={`input-dark w-full py-2 text-xs ${formErrors.violation_description ? 'border-red-500' : ''}`}
              />
              {formErrors.violation_description && <p className="text-red-400 text-[10px] mt-1">{formErrors.violation_description}</p>}
            </div>
            <div>
              <label className="field-label">Fine Amount ($)</label>
              <div className="relative">
                <DollarSign size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-400" />
                <input type="number" step="0.01" min="0" value={form.fine_amount} onChange={e => updateField('fine_amount', e.target.value)} placeholder="0.00" className="input-dark w-full py-2 pl-8 text-xs" />
              </div>
            </div>
          </div>
        </section>

        {/* Subject */}
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1.5">
            <User size={12} /> Subject
          </h3>
          <div className="space-y-3">
            <div ref={personDropdownRef} className="relative">
              <label className="field-label">Search Existing Person</label>
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-400" />
                <input
                  type="text"
                  value={personSearch}
                  onChange={e => handlePersonSearchChange(e.target.value)}
                  onFocus={() => { if (personResults.length > 0) setShowPersonDropdown(true); }}
                  placeholder="Search by name or DL..."
                  className="input-dark w-full py-2 pl-8 pr-8 text-xs"
                />
                {personSearching && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-rmpg-400 animate-spin" />}
                {form.person_id && (
                  <button onClick={clearPerson} className="absolute right-3 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-200">
                    <X size={12} />
                  </button>
                )}
              </div>
              {showPersonDropdown && personResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-rmpg-800 border border-rmpg-600 shadow-xl max-h-48 overflow-y-auto">
                  {personResults.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => selectPerson(p)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-rmpg-700/50 border-b border-rmpg-700/50 last:border-b-0 transition-colors"
                    >
                      <div className="font-semibold text-rmpg-200">{p.last_name}, {p.first_name}</div>
                      <div className="text-[10px] text-rmpg-400">
                        {p.dob ? `DOB: ${formatDate(p.dob)}` : ''} {p.dl_number ? `DL: ${p.dl_number}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {form.person_id && (
              <div className="text-[10px] text-brand-300 bg-brand-900/20 px-2 py-1 flex items-center gap-1">
                <Check size={10} /> Linked to person record #{form.person_id}
              </div>
            )}

            <div>
              <label className="field-label">Full Name *</label>
              <input
                type="text"
                value={form.person_name}
                onChange={e => updateField('person_name', e.target.value)}
                placeholder="Last, First Middle"
                className={`input-dark w-full py-2 text-xs ${formErrors.person_name ? 'border-red-500' : ''}`}
              />
              {formErrors.person_name && <p className="text-red-400 text-[10px] mt-1">{formErrors.person_name}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Date of Birth</label>
                <input type="date" value={form.person_dob} onChange={e => updateField('person_dob', e.target.value)} className="input-dark w-full py-2 text-xs" />
              </div>
              <div>
                <label className="field-label">Driver License #</label>
                <input type="text" value={form.person_dl} onChange={e => updateField('person_dl', e.target.value)} placeholder="DL number" className="input-dark w-full py-2 text-xs font-mono" />
              </div>
            </div>

            <div>
              <label className="field-label">Address</label>
              <input type="text" value={form.person_address} onChange={e => updateField('person_address', e.target.value)} placeholder="Street, City, State ZIP" className="input-dark w-full py-2 text-xs" />
            </div>
          </div>
        </section>

        {/* Vehicle (traffic/parking only) */}
        {showVehicleSection && (
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1.5">
              <Car size={12} /> Vehicle Information
            </h3>
            <div className="space-y-3">
              <div>
                <label className="field-label">Vehicle Description</label>
                <input type="text" value={form.vehicle_description} onChange={e => updateField('vehicle_description', e.target.value)} placeholder="Year Make Model Color" className="input-dark w-full py-2 text-xs" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">License Plate</label>
                  <input type="text" value={form.vehicle_plate} onChange={e => updateField('vehicle_plate', e.target.value.toUpperCase())} placeholder="ABC1234" className="input-dark w-full py-2 text-xs font-mono uppercase" />
                </div>
                <div>
                  <label className="field-label">State</label>
                  <select value={form.vehicle_state} onChange={e => updateField('vehicle_state', e.target.value)} className="input-dark w-full py-2 text-xs">
                    {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Location & Time */}
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1.5">
            <Calendar size={12} /> Location & Time
          </h3>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Violation Date *</label>
                <input
                  type="date"
                  value={form.violation_date}
                  onChange={e => updateField('violation_date', e.target.value)}
                  className={`input-dark w-full py-2 text-xs ${formErrors.violation_date ? 'border-red-500' : ''}`}
                />
                {formErrors.violation_date && <p className="text-red-400 text-[10px] mt-1">{formErrors.violation_date}</p>}
              </div>
              <div>
                <label className="field-label">Violation Time</label>
                <input type="time" value={form.violation_time} onChange={e => updateField('violation_time', e.target.value)} className="input-dark w-full py-2 text-xs" />
              </div>
            </div>
            <div>
              <label className="field-label">Location</label>
              <input type="text" value={form.location} onChange={e => updateField('location', e.target.value)} placeholder="Address or intersection" className="input-dark w-full py-2 text-xs" />
            </div>
            {/* Section / Zone / Beat */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Section</label>
                <select className="w-full bg-[#1a2636] border border-[#2a3a4a] rounded px-2 py-1.5 text-sm text-white"
                  value={form.section_id || ''} onChange={(e) => updateField('section_id', e.target.value)}>
                  <option value="">—</option>
                  {sectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Zone</label>
                <select className="w-full bg-[#1a2636] border border-[#2a3a4a] rounded px-2 py-1.5 text-sm text-white"
                  value={form.zone_id || ''} onChange={(e) => updateField('zone_id', e.target.value)}>
                  <option value="">—</option>
                  {zoneOptions.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Beat</label>
                <select className="w-full bg-[#1a2636] border border-[#2a3a4a] rounded px-2 py-1.5 text-sm text-white"
                  value={form.beat_id || ''} onChange={(e) => updateField('beat_id', e.target.value)}>
                  <option value="">—</option>
                  {beatOptions.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Officer */}
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1.5">
            <User size={12} /> Issuing Officer
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">Officer Name</label>
              <input type="text" value={form.issuing_officer_name} onChange={e => updateField('issuing_officer_name', e.target.value)} className="input-dark w-full py-2 text-xs" />
            </div>
            <div>
              <label className="field-label">Badge #</label>
              <input type="text" value={form.badge_number} onChange={e => updateField('badge_number', e.target.value)} className="input-dark w-full py-2 text-xs font-mono" />
            </div>
          </div>
        </section>

        {/* Court */}
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1.5">
            <Scale size={12} /> Court Information
          </h3>
          <div className="space-y-3">
            <div>
              <label className="field-label">Court Date</label>
              <input type="date" value={form.court_date} onChange={e => updateField('court_date', e.target.value)} className="input-dark w-full py-2 text-xs" />
            </div>
            <div>
              <label className="field-label">Court Name</label>
              <input type="text" value={form.court_name} onChange={e => updateField('court_name', e.target.value)} placeholder="e.g. Provo Justice Court" className="input-dark w-full py-2 text-xs" />
            </div>
            <div>
              <label className="field-label">Court Address</label>
              <input type="text" value={form.court_address} onChange={e => updateField('court_address', e.target.value)} placeholder="Street, City, State ZIP" className="input-dark w-full py-2 text-xs" />
            </div>
          </div>
        </section>

        {/* Notes */}
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2">Notes</h3>
          <textarea
            value={form.notes}
            onChange={e => updateField('notes', e.target.value)}
            placeholder="Additional notes or remarks..."
            rows={4}
            className="input-dark w-full py-2 text-xs resize-none"
          />
        </section>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-rmpg-700">
        <button onClick={handleCancelForm} className="px-4 py-2 text-xs font-bold uppercase text-rmpg-300 hover:text-rmpg-100 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="toolbar-btn toolbar-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <><Loader2 size={14} className="animate-spin" /> Saving...</>
          ) : (
            <><Check size={14} /> {isEdit ? 'Save Changes' : 'Create Citation'}</>
          )}
        </button>
      </div>
    </div>
  );

  // ============================================================
  // Right panel switcher
  // ============================================================

  const renderRightPanel = () => {
    if (mode === 'create' || mode === 'edit') return renderForm();

    if (detailLoading) {
      return (
        <div className="flex items-center justify-center h-full text-rmpg-400">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading citation...
        </div>
      );
    }

    if (selectedCitation) return renderDetailView();

    return (
      <div className="flex flex-col items-center justify-center h-full text-rmpg-500 px-8">
        <FileWarning size={48} className="mb-4 opacity-30" />
        <p className="text-sm font-semibold text-rmpg-400 mb-1">No Citation Selected</p>
        <p className="text-xs text-center text-rmpg-500 mb-6 max-w-xs">
          Select a citation from the list to view details, or create a new one.
        </p>
        <button onClick={handleNewCitation} className="toolbar-btn toolbar-btn-primary">
          <Plus size={14} /> New Citation
        </button>
      </div>
    );
  };

  // ============================================================
  // Main layout
  // ============================================================

  // On mobile, show list OR detail/form — not both side by side
  const showListOnMobile = !isMobile || (mode === 'list' && !selectedCitation);
  const showRightOnMobile = !isMobile || mode !== 'list' || !!selectedCitation;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats bar */}
      <div className={`${isMobile ? 'px-3 pt-3' : 'px-4 pt-4'} pb-0 shrink-0`}>
        {isMobile ? (
          <div className="overflow-x-auto -mx-3 px-3 pb-2">
            {renderStatsBar()}
          </div>
        ) : (
          renderStatsBar()
        )}
      </div>

      {/* Split view */}
      <div className={`flex flex-1 overflow-hidden ${isMobile ? 'px-2 pb-2 flex-col' : 'px-4 pb-4 gap-4'}`}>
        {/* Left panel */}
        {showListOnMobile && (
          <div className={`${isMobile ? 'flex-1' : 'w-[420px] min-w-[360px] shrink-0'} panel-beveled bg-surface-base border border-rmpg-700 flex flex-col overflow-hidden`}>
            {renderListPanel()}
          </div>
        )}

        {/* Right panel */}
        {showRightOnMobile && (
          <div className={`flex-1 panel-beveled bg-surface-base border border-rmpg-700 overflow-hidden flex flex-col ${isMobile && !showListOnMobile ? '' : ''}`}>
            {isMobile && selectedCitation && mode === 'list' && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
                <button onClick={() => setSelectedCitation(null)} className="toolbar-btn text-[10px]">← Back</button>
                <span className="text-xs text-rmpg-400 font-mono">{selectedCitation.citation_number}</span>
              </div>
            )}
            {renderRightPanel()}
          </div>
        )}
      </div>

      {/* Mobile FAB for new citation */}
      {isMobile && !selectedCitation && mode === 'list' && (
        <button onClick={handleNewCitation} className="mobile-fab" aria-label="New Citation">
          <Plus size={24} />
        </button>
      )}
    </div>
  );
}
