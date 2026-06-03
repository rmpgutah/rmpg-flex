// ============================================================
// RMPG Flex — Citations / Summons Page
// ============================================================
// Full citation management: list, create, edit, detail view.
// Left panel = filterable list, right panel = detail or form.
// Integrates StatuteLookup for violation code selection.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileWarning,
  Plus,
  Search,
  Filter,
  Loader2,
  AlertTriangle,
  Check,
  Scale,
  User,
  Car,
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
import PrintRecordButton from '../components/PrintRecordButton';
import CitationAuthor from '../components/CitationAuthor';
import type { CitationPdfData } from '../utils/recordPdfGenerator';
import { localToday, formatDate } from '../utils/dateUtils';
import ExportButton from '../components/ExportButton';
import { Combobox } from '../components/Combobox';
import { formatAddressDisplay } from '../utils/statusLabels';

// ── Types ──────────────────────────────────────────────────

type CitationType = 'traffic' | 'criminal' | 'parking' | 'warning';
type CitationStatus = 'issued' | 'paid' | 'contested' | 'dismissed' | 'warrant_issued' | 'voided' | 'payment_plan';

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
  // Spillman Flex extended fields
  latitude: number | null;
  longitude: number | null;
  vehicle_vin: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  speed_recorded: number | null;
  speed_limit: number | null;
  radar_type: string | null;
  bac_level: number | null;
  bond_amount: number | null;
  bond_type: string | null;
  is_warning: number;
  is_equipment_violation: number;
  school_zone: number;
  construction_zone: number;
  accident_related: number;
  dui_related: number;
  commercial_vehicle: number;
  voided_reason: string | null;
  court_time: string | null;
  court_room: string | null;
  appearance_required: number;
  plea: string | null;
  verdict: string | null;
  sentence: string | null;
  disposition_date: string | null;
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
  { value: 'payment_plan', label: 'Payment Plan' },
  { value: 'contested', label: 'Contested' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'warrant_issued', label: 'Warrant Issued' },
  { value: 'voided', label: 'Voided' },
];

const FILTER_TYPE_OPTIONS: { value: CitationType | ''; label: string }[] = [
  { value: '', label: 'All Types' },
  ...CITATION_TYPES,
];

const FILTER_STATUS_OPTIONS: { value: CitationStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  ...CITATION_STATUSES,
];

const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'money_order', label: 'Money Order' },
  { value: 'other', label: 'Other' },
];

const STATUS_BADGE: Record<string, string> = {
  issued: 'bg-gray-900/50 text-gray-300 border-gray-700/50',
  paid: 'bg-green-900/50 text-green-300 border-green-700/50',
  payment_plan: 'bg-gray-900/50 text-gray-300 border-gray-700/50',
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

// formatDate imported from ../utils/dateUtils

function formatCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Component ──────────────────────────────────────────────

export default function CitationsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin'; // Admin God Mode — unrestricted access
  const isMobile = useIsMobile();

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

  // Data completeness
  const [completeness, setCompleteness] = useState<{ score: number; grade: string; missing_required: string[]; missing_recommended: string[] } | null>(null);

  // Payment summary
  const [paymentSummary, setPaymentSummary] = useState<{ payment_count: number; payment_total: number; outstanding_amount: number; collection_rate: number } | null>(null);

  // Payment plan tracking
  const [paymentData, setPaymentData] = useState<{ payments: any[]; total_amount: number; total_paid: number; remaining: number } | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_date: localToday(), payment_method: 'cash', reference_number: '', notes: '' });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

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

  // ── Fetch payments when citation selected ──────────────
  useEffect(() => {
    if (!selectedCitation || !selectedCitation.fine_amount) { setPaymentData(null); return; }
    (async () => {
      try {
        const res = await apiFetch<{ data: any }>(`/citations/${selectedCitation.id}/payments`);
        setPaymentData(res.data);
      } catch { setPaymentData(null); }
    })();
  }, [selectedCitation?.id, selectedCitation?.fine_amount]);

  // ── Fetch completeness when citation selected (UPGRADE 39) ──
  useEffect(() => {
    if (!selectedCitation) { setCompleteness(null); return; }
    (async () => {
      try {
        const res = await apiFetch<{ data: any }>(`/citations/${selectedCitation.id}/completeness`);
        setCompleteness(res.data);
      } catch { setCompleteness(null); }
    })();
  }, [selectedCitation?.id]);

  // ── Fetch payment summary on mount (UPGRADE 40) ──
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ data: any }>('/citations/payment-summary');
        setPaymentSummary(res.data);
      } catch { setPaymentSummary(null); }
    })();
  }, []);

  const handleRecordPayment = async () => {
    if (!selectedCitation || !paymentForm.amount) return;
    setPaymentSubmitting(true);
    try {
      await apiFetch(`/citations/${selectedCitation.id}/payments`, {
        method: 'POST', body: JSON.stringify(paymentForm),
      });
      // Refresh
      const res = await apiFetch<{ data: any }>(`/citations/${selectedCitation.id}/payments`);
      setPaymentData(res.data);
      setShowPaymentForm(false);
      setPaymentForm({ amount: '', payment_date: localToday(), payment_method: 'cash', reference_number: '', notes: '' });
      fetchCitations({ silent: true }); fetchStats();
    } catch (err: any) { alert(err.message || 'Failed to record payment'); }
    finally { setPaymentSubmitting(false); }
  };

  // ── Form launchers ───────────────────────────────────────

  const handleNewCitation = () => {
    setSelectedCitation(null);
    setMode('create');
  };

  const handleEditCitation = (_c: Citation) => {
    // selectedCitation is already set; CitationAuthor hydrates from it.
    setMode('edit');
  };

  const handleCancelForm = () => {
    setMode('list');
  };

  const handleAuthorSaved = (_id: number) => {
    setMode('list');
    fetchCitations({ silent: true });
    fetchStats();
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
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-gray-900/30 text-gray-300 border-gray-700/50">
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
        {paymentSummary && paymentSummary.collection_rate > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-brand-900/20 text-brand-400 border-brand-700/40">
            <Check size={10} /> Collection: {paymentSummary.collection_rate}%
          </span>
        )}
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
        <div className={`flex items-center gap-2 ${isMobile ? 'flex-col' : ''}`}>
          <div className={`relative ${isMobile ? 'w-full' : 'flex-1'}`}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search citations..." aria-label="Search citations"
              autoComplete="off"
              className={`input-dark w-full pl-8 pr-3 ${isMobile ? 'py-2.5 text-sm' : 'py-1.5 text-xs'}`}
              style={isMobile ? { minHeight: 44 } : undefined}
            />
          </div>
          <div className={`flex items-center gap-2 ${isMobile ? 'w-full' : ''}`}>
            <button type="button" onClick={handleNewCitation} className={`toolbar-btn toolbar-btn-primary ${isMobile ? 'flex-1 justify-center' : ''}`} title="New Citation" style={isMobile ? { minHeight: 48 } : undefined}>
              <Plus size={isMobile ? 16 : 12} /> New
            </button>
            <ExportButton exportUrl="/api/citations/export/csv" exportFilename="citations.csv" />
            <button type="button" onClick={() => { fetchCitations(); fetchStats(); }} className="text-rmpg-400 hover:text-rmpg-200 p-1 transition-colors" title="Refresh" style={isMobile ? { minHeight: 48, minWidth: 48 } : undefined}>
              <RefreshCw size={isMobile ? 18 : 14} />
            </button>
          </div>
        </div>
        {/* Filter row */}
        <div className={`flex items-center ${isMobile ? 'flex-col gap-1.5' : 'gap-2 flex-wrap'}`}>
          {!isMobile && <Filter size={10} className="text-rmpg-500" />}
          <div className={isMobile ? 'w-full' : 'w-44'}>
            <Combobox
              value={FILTER_TYPE_OPTIONS.find(o => o.value === filterType) ?? FILTER_TYPE_OPTIONS[0]}
              onChange={(opt) => { setFilterType((opt?.value ?? '') as CitationType | ''); setPage(1); }}
              options={FILTER_TYPE_OPTIONS}
              getLabel={(o) => o.label}
              getKey={(o) => String(o.value)}
              placeholder="Filter type…"
            />
          </div>
          <div className={isMobile ? 'w-full' : 'w-48'}>
            <Combobox
              value={FILTER_STATUS_OPTIONS.find(o => o.value === filterStatus) ?? FILTER_STATUS_OPTIONS[0]}
              onChange={(opt) => { setFilterStatus((opt?.value ?? '') as CitationStatus | ''); setPage(1); }}
              options={FILTER_STATUS_OPTIONS}
              getLabel={(o) => o.label}
              getKey={(o) => String(o.value)}
              placeholder="Filter status…"
            />
          </div>
        </div>
      </div>

      {/* List body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent" style={{ overscrollBehavior: 'contain' }}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Loader2 size={20} className="animate-spin text-brand-400" role="status" aria-label="Loading" />
            <span className="text-[10px] text-rmpg-500">Loading citations...</span>
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-red-400 flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        ) : citations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
            <FileWarning size={28} className="mb-2 opacity-40" />
            <p className="text-xs font-medium">No citations found</p>
            <p className="text-[10px] text-rmpg-600 mt-1">Adjust filters or create a new citation</p>
          </div>
        ) : (
          citations.map(c => (
            <button type="button"
              key={c.id}
              onClick={() => handleSelectCitation(c)}
              className={`w-full text-left px-3 ${isMobile ? 'py-3' : 'py-2'} border-b border-rmpg-700/50 hover:bg-rmpg-700/20 transition-colors ${
                selectedCitation?.id === c.id && mode === 'list' ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''
              }`}
              style={isMobile ? { minHeight: 56 } : undefined}
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
        <div className={`flex items-center justify-between px-3 py-2 border-t border-rmpg-700 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400`}>
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="hover:text-rmpg-200 disabled:opacity-30" style={isMobile ? { minHeight: 48, minWidth: 48 } : undefined}>
            Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="hover:text-rmpg-200 disabled:opacity-30" style={isMobile ? { minHeight: 48, minWidth: 48 } : undefined}>
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
                id: c.id,
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
            <button type="button" onClick={() => handleEditCitation(c)} className="toolbar-btn text-[10px]">
              <FileText size={12} /> Edit
            </button>
            {(c.status !== 'voided' || isAdmin) && (
              <button type="button" onClick={() => handleVoid(c)} className="toolbar-btn text-[10px] text-red-400 hover:text-red-300">
                <Ban size={12} /> {c.status === 'voided' && isAdmin ? 'Un-Void' : 'Void'}
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent p-4 space-y-4">
          {/* Violation */}
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
              <Scale size={10} className="text-[#d4a017]" /> Violation
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              {c.statute_citation && (
                <div><span className="text-rmpg-400">Statute:</span> <span className="text-rmpg-200 font-mono">{c.statute_citation}</span></div>
              )}
              {c.violation_description && (
                <div><span className="text-rmpg-400">Description:</span> <span className="text-rmpg-200">{c.violation_description}</span></div>
              )}
              {c.offense_level && (
                <div className="flex items-center gap-2">
                  <span className="text-rmpg-400">Offense Level:</span>
                  <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm border ${
                    c.offense_level === 'felony' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                    c.offense_level === 'misdemeanor' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                    'bg-gray-900/50 text-gray-400 border-gray-700/50'
                  }`}>{c.offense_level.replace(/_/g, ' ')}</span>
                </div>
              )}
              {c.fine_amount != null && (
                <div><span className="text-rmpg-400">Fine:</span> <span className="text-green-400 font-bold">{formatCurrency(c.fine_amount)}</span></div>
              )}
            </div>
          </section>

          {/* Payment Plan Tracking */}
          {c.fine_amount != null && c.fine_amount > 0 && paymentData && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
                <DollarSign size={10} className="text-[#d4a017]" /> Payment Tracking
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-2">
                <div className="flex items-center gap-4 text-xs">
                  <div><span className="text-rmpg-400">Total:</span> <span className="text-rmpg-200 font-bold">{formatCurrency(paymentData.total_amount)}</span></div>
                  <div><span className="text-rmpg-400">Paid:</span> <span className="text-green-400 font-bold">{formatCurrency(paymentData.total_paid)}</span></div>
                  <div><span className="text-rmpg-400">Remaining:</span> <span className="text-amber-400 font-bold">{formatCurrency(paymentData.remaining)}</span></div>
                </div>
                {paymentData.total_amount > 0 && (
                  <div className="h-1.5 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${Math.min(100, (paymentData.total_paid / paymentData.total_amount) * 100)}%` }} />
                  </div>
                )}
                {paymentData.payments.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {paymentData.payments.map((p: any) => (
                      <div key={p.id} className="flex items-center gap-2 text-[10px] border-b border-rmpg-800/30 pb-1">
                        <span className="text-rmpg-500">{formatDate(p.payment_date)}</span>
                        <span className="text-green-400 font-bold">{formatCurrency(p.amount)}</span>
                        {p.payment_method && <span className="text-rmpg-500 capitalize">{p.payment_method}</span>}
                        {p.reference_number && <span className="text-rmpg-500 font-mono">{p.reference_number}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {!showPaymentForm ? (
                  <button type="button" onClick={() => setShowPaymentForm(true)} className="toolbar-btn text-[10px] mt-1">
                    <Plus size={10} /> Record Payment
                  </button>
                ) : (
                  <div className="space-y-2 mt-2 p-2 border border-rmpg-700 bg-surface-sunken">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[9px] text-rmpg-400 uppercase">Amount *</label>
                        <input type="number" step="0.01" className="input-dark text-xs w-full min-h-[36px]" value={paymentForm.amount} onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))} /></div>
                      <div><label className="text-[9px] text-rmpg-400 uppercase">Date *</label>
                        <input type="date" className="input-dark text-xs w-full min-h-[36px]" value={paymentForm.payment_date} onChange={e => setPaymentForm(p => ({ ...p, payment_date: e.target.value }))} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[9px] text-rmpg-400 uppercase">Method</label>
                        <Combobox
                          value={PAYMENT_METHOD_OPTIONS.find(o => o.value === paymentForm.payment_method) ?? PAYMENT_METHOD_OPTIONS[0]}
                          onChange={(opt) => setPaymentForm(p => ({ ...p, payment_method: opt?.value ?? 'cash' }))}
                          options={PAYMENT_METHOD_OPTIONS}
                          getLabel={(o) => o.label}
                          getKey={(o) => o.value}
                          placeholder="Method…"
                        /></div>
                      <div><label className="text-[9px] text-rmpg-400 uppercase">Reference #</label>
                        <input className="input-dark text-xs w-full min-h-[36px]" value={paymentForm.reference_number} onChange={e => setPaymentForm(p => ({ ...p, reference_number: e.target.value }))} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleRecordPayment} disabled={paymentSubmitting || !paymentForm.amount} className="toolbar-btn-primary text-[10px] px-3 py-1">
                        {paymentSubmitting ? 'Saving...' : 'Save Payment'}
                      </button>
                      <button type="button" onClick={() => setShowPaymentForm(false)} className="toolbar-btn text-[10px]">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Data Completeness (UPGRADE 41) */}
          {completeness && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1">
                <Check size={10} /> Data Completeness
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className={`text-sm font-bold px-2 py-0.5 rounded ${completeness.grade === 'A' ? 'bg-green-900/50 text-green-400' : completeness.grade === 'B' ? 'bg-gray-900/50 text-gray-400' : completeness.grade === 'C' ? 'bg-amber-900/50 text-amber-400' : 'bg-red-900/50 text-red-400'}`}>{completeness.grade}</div>
                  <div className="flex-1 h-1.5 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div className={`h-full transition-all ${completeness.score >= 80 ? 'bg-green-500' : completeness.score >= 60 ? 'bg-gray-500' : completeness.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${completeness.score}%` }} />
                  </div>
                  <span className="text-[10px] text-rmpg-400">{completeness.score}%</span>
                </div>
                {completeness.missing_required.length > 0 && (
                  <div className="text-[10px] text-amber-400">Missing: {completeness.missing_required.join(', ')}</div>
                )}
              </div>
            </section>
          )}

          {/* Subject */}
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
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
              <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
                <Car size={10} /> Vehicle
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {c.vehicle_description && <div><span className="text-rmpg-400">Description:</span> <span className="text-rmpg-200">{c.vehicle_description}</span></div>}
                {c.vehicle_plate && <div><span className="text-rmpg-400">Plate:</span> <span className="text-rmpg-200 font-mono">{c.vehicle_plate}</span> <span className="text-rmpg-500">({c.vehicle_state || 'UT'})</span></div>}
                {(c as any).vehicle_vin && <div><span className="text-rmpg-400">VIN:</span> <span className="text-rmpg-200 font-mono">{(c as any).vehicle_vin}</span></div>}
                {((c as any).vehicle_year || (c as any).vehicle_make) && (
                  <div>
                    <span className="text-rmpg-400">Vehicle:</span>{' '}
                    <span className="text-rmpg-200">{[(c as any).vehicle_year, (c as any).vehicle_make, (c as any).vehicle_model].filter(Boolean).join(' ')}</span>
                    {(c as any).vehicle_color && <span className="text-rmpg-400 ml-2">({(c as any).vehicle_color})</span>}
                  </div>
                )}
                {(c as any).commercial_vehicle ? <span className="text-[8px] font-bold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 border border-amber-700/30">COMMERCIAL VEHICLE</span> : null}
              </div>
            </section>
          )}

          {/* Traffic / Speed Details */}
          {(c.type === 'traffic' || (c as any).speed_recorded || (c as any).bac_level || (c as any).dui_related) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
                ⚡ Traffic Details
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {(c as any).speed_recorded && (
                  <div className="flex items-center gap-2">
                    <span className="text-rmpg-400">Speed:</span>
                    <span className="text-red-400 font-bold font-mono text-sm">{(c as any).speed_recorded} MPH</span>
                    {(c as any).speed_limit && <span className="text-rmpg-400">in a <span className="text-white font-bold">{(c as any).speed_limit} MPH</span> zone</span>}
                    {(c as any).speed_recorded && (c as any).speed_limit && (
                      <span className="text-[9px] font-bold text-red-400">({(c as any).speed_recorded - (c as any).speed_limit} over)</span>
                    )}
                  </div>
                )}
                {(c as any).radar_type && <div><span className="text-rmpg-400">Radar/LIDAR:</span> <span className="text-rmpg-200">{(c as any).radar_type}</span></div>}
                {(c as any).bac_level != null && (c as any).bac_level > 0 && (
                  <div><span className="text-rmpg-400">BAC Level:</span> <span className={`font-bold font-mono ${(c as any).bac_level >= 0.08 ? 'text-red-400' : 'text-amber-400'}`}>{(c as any).bac_level.toFixed(3)}%</span></div>
                )}
                <div className="flex flex-wrap gap-2 mt-1">
                  {(c as any).school_zone ? <span className="text-[8px] font-bold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 border border-amber-700/30">SCHOOL ZONE</span> : null}
                  {(c as any).construction_zone ? <span className="text-[8px] font-bold text-orange-400 bg-orange-900/30 px-1.5 py-0.5 border border-orange-700/30">CONSTRUCTION ZONE</span> : null}
                  {(c as any).accident_related ? <span className="text-[8px] font-bold text-red-400 bg-red-900/30 px-1.5 py-0.5 border border-red-700/30">ACCIDENT RELATED</span> : null}
                  {(c as any).dui_related ? <span className="text-[8px] font-bold text-red-400 bg-red-900/30 px-1.5 py-0.5 border border-red-700/30">DUI RELATED</span> : null}
                  {(c as any).is_warning ? <span className="text-[8px] font-bold text-gray-400 bg-gray-900/30 px-1.5 py-0.5 border border-gray-700/30">WARNING ONLY</span> : null}
                  {(c as any).is_equipment_violation ? <span className="text-[8px] font-bold text-gray-400 bg-[#0c0c0c]/30 px-1.5 py-0.5 border border-gray-700/30">EQUIPMENT VIOLATION</span> : null}
                </div>
              </div>
            </section>
          )}

          {/* Bond / Bail */}
          {((c as any).bond_amount > 0 || (c as any).appearance_required) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
                🔒 Bond / Bail
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {(c as any).bond_amount > 0 && <div><span className="text-rmpg-400">Bond Amount:</span> <span className="text-green-400 font-bold font-mono">${Number((c as any).bond_amount).toLocaleString()}</span></div>}
                {(c as any).bond_type && <div><span className="text-rmpg-400">Bond Type:</span> <span className="text-rmpg-200 capitalize">{(c as any).bond_type}</span></div>}
                {(c as any).appearance_required ? <span className="text-[9px] font-bold text-red-400 bg-red-900/20 px-2 py-1 border border-red-700/30">COURT APPEARANCE REQUIRED</span> : null}
              </div>
            </section>
          )}

          {/* Case Disposition */}
          {((c as any).plea || (c as any).verdict || (c as any).sentence) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
                ⚖ Case Disposition
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {(c as any).plea && <div><span className="text-rmpg-400">Plea:</span> <span className="text-rmpg-200 capitalize">{(c as any).plea}</span></div>}
                {(c as any).verdict && <div><span className="text-rmpg-400">Verdict:</span> <span className={`font-bold capitalize ${(c as any).verdict === 'guilty' ? 'text-red-400' : (c as any).verdict === 'not_guilty' ? 'text-green-400' : 'text-rmpg-200'}`}>{(c as any).verdict.replace(/_/g, ' ')}</span></div>}
                {(c as any).sentence && <div><span className="text-rmpg-400">Sentence:</span> <span className="text-rmpg-200">{(c as any).sentence}</span></div>}
                {(c as any).disposition_date && <div><span className="text-rmpg-400">Disposition Date:</span> <span className="text-rmpg-200">{formatDate((c as any).disposition_date)}</span></div>}
              </div>
            </section>
          )}

          {/* Location & Time */}
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
              <MapPin size={10} /> Location & Time
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              <div><span className="text-rmpg-400">Date:</span> <span className="text-rmpg-200">{formatDate(c.violation_date)}</span></div>
              {c.violation_time && <div><span className="text-rmpg-400">Time:</span> <span className="text-rmpg-200">{c.violation_time}</span></div>}
              {c.location && <div><span className="text-rmpg-400">Location:</span> <span className="text-rmpg-200">{formatAddressDisplay(c.location)}</span></div>}
              {(c.section_id || c.zone_id || c.beat_id) && (
                <div><span className="text-rmpg-400">S/Z/B:</span> <span className="text-rmpg-200 font-mono">{c.section_id || '—'} / {c.zone_id || '—'} / {c.beat_id || '—'}</span></div>
              )}
            </div>
          </section>

          {/* Officer */}
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
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
              <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2 flex items-center gap-1">
                <Scale size={10} /> Court Information
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {c.court_date && (() => {
                  const daysUntil = Math.ceil((new Date(c.court_date + 'T00:00:00').getTime() - Date.now()) / 86400000);
                  const cdColor = daysUntil < 0 ? '#ef4444' : daysUntil <= 7 ? '#f97316' : daysUntil <= 30 ? '#eab308' : '#22c55e';
                  const cdLabel = daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? 'TODAY' : `${daysUntil}d away`;
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-rmpg-400">Court Date:</span>
                      <span className="text-rmpg-200">{formatDate(c.court_date)}</span>
                      <span className="text-[9px] font-bold font-mono" style={{ color: cdColor }}>({cdLabel})</span>
                    </div>
                  );
                })()}
                {c.court_name && <div><span className="text-rmpg-400">Court:</span> <span className="text-rmpg-200">{c.court_name}</span></div>}
                {(c as any).court_time && <div><span className="text-rmpg-400">Time:</span> <span className="text-rmpg-200">{(c as any).court_time}</span></div>}
                {(c as any).court_room && <div><span className="text-rmpg-400">Courtroom:</span> <span className="text-rmpg-200">{(c as any).court_room}</span></div>}
                {c.court_address && <div><span className="text-rmpg-400">Address:</span> <span className="text-rmpg-200">{c.court_address}</span></div>}
                {(c as any).appearance_required ? <span className="text-[9px] font-bold text-red-400 mt-1 inline-block">⚠ APPEARANCE REQUIRED</span> : null}
              </div>
            </section>
          )}

          {/* Notes */}
          {c.notes && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2">Notes</h3>
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
  // Right panel switcher
  // ============================================================

  const renderRightPanel = () => {
    if (mode === 'create' || mode === 'edit') {
      return (
        <CitationAuthor
          mode={mode}
          initialData={mode === 'edit' ? selectedCitation : undefined}
          onSaved={handleAuthorSaved}
          onCancel={handleCancelForm}
        />
      );
    }

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
        <button type="button" onClick={handleNewCitation} className="toolbar-btn toolbar-btn-primary print:hidden">
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

  // Set document title
  useEffect(() => { document.title = 'Citations \u2014 RMPG Flex'; }, []);

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
                <button type="button" onClick={() => setSelectedCitation(null)} className="toolbar-btn text-[10px]">← Back</button>
                <span className="text-xs text-rmpg-400 font-mono">{selectedCitation.citation_number}</span>
              </div>
            )}
            {renderRightPanel()}
          </div>
        )}
      </div>

      {/* Mobile FAB for new citation */}
      {isMobile && !selectedCitation && mode === 'list' && (
        <button type="button" onClick={handleNewCitation} className="mobile-fab" aria-label="New Citation">
          <Plus size={24} />
        </button>
      )}
    </div>
  );
}
