// ============================================================
// RMPG Flex — Arrest Records Page
// ============================================================
// Full jail roster management: split panel layout with list +
// detail, manual booking CRUD, county statistics, person
// linking, criminal history integration, CSV export, and
// multi-source filtering (scraper / manual / CSV import).
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Database, Search, X, Loader2, ChevronDown, ChevronRight,
  Users, UserPlus, UserMinus, UserX, MapPin, Clock, Shield,
  BarChart3, TrendingUp, TrendingDown, Minus, Eye, Plus,
  Link2, Unlink, AlertTriangle, RefreshCw, Download, Pencil, Trash2,
  ArrowUpDown, ArrowUp, ArrowDown, FileText, ShieldAlert,
  Calendar, Building, Scale,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import PanelTitleBar from '../components/PanelTitleBar';
import EmptyState from '../components/EmptyState';
import SplitPanel from '../components/SplitPanel';
import CollapsibleSection from '../components/CollapsibleSection';
import CriminalHistorySection from '../components/CriminalHistorySection';
import ArrestFormModal from '../components/ArrestFormModal';
import type { ArrestFormData } from '../components/ArrestFormModal';
import { localToday } from '../utils/dateUtils';
import { useWebSocket } from '../context/WebSocketContext';
import { useToast } from '../components/ToastProvider';
import ExportButton from '../components/ExportButton';
// ── Types ─────────────────────────────────────────────────

interface CountyStat {
  county: string;
  display_name: string;
  total_records: number;
  active_count: number;
  released_count: number;
  earliest_booking: string | null;
  newest_booking: string | null;
  male_count: number;
  female_count: number;
  details_fetched: number;
  avg_stay_days: number | null;
}

interface PopulationSummary {
  total_records: number;
  total_active: number;
  total_released: number;
  counties_with_data: number;
  intakes_today: number;
  releases_today: number;
}

interface ArrestRecord {
  id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  date_of_birth: string | null;
  booking_date: string | null;
  release_date: string | null;
  charges: string[] | string;
  county: string;
  source_id: string;
  source_name: string | null;
  status: string;
  booking_number: string | null;
  agency: string | null;
  gender: string | null;
  race: string | null;
  age: number | null;
  height: string | null;
  weight: string | null;
  hair_color: string | null;
  eye_color: string | null;
  address: string | null;
  bail_amount: number | null;
  hold_reason: string | null;
  notes: string | null;
  entry_source: string | null;
  jailbase_id: string | null;
  person_id: number | null;
  linked_person: { id: number; name: string } | null;
  entered_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface PersonResult {
  id: number;
  first_name: string;
  last_name: string;
  dob?: string;
}

// ── County colors ─────────────────────────────────────────

const COUNTY_COLORS: Record<string, string> = {
  weber:     'from-blue-600/20 to-blue-800/10 border-blue-500/30',
  davis:     'from-emerald-600/20 to-emerald-800/10 border-emerald-500/30',
  iron:      'from-red-600/20 to-red-800/10 border-red-500/30',
  salt_lake: 'from-purple-600/20 to-purple-800/10 border-purple-500/30',
  summit:    'from-cyan-600/20 to-cyan-800/10 border-cyan-500/30',
  uinta:     'from-amber-600/20 to-amber-800/10 border-amber-500/30',
};

const COUNTY_ACCENTS: Record<string, string> = {
  weber: 'text-blue-400', davis: 'text-emerald-400', iron: 'text-red-400',
  salt_lake: 'text-purple-400', summit: 'text-cyan-400', uinta: 'text-amber-400',
};

const COUNTY_BAR_COLORS: Record<string, string> = {
  weber: 'bg-blue-500', davis: 'bg-emerald-500', iron: 'bg-red-500',
  salt_lake: 'bg-purple-500', summit: 'bg-cyan-500', uinta: 'bg-amber-500',
};

// ── Sort config ───────────────────────────────────────────

type SortField = 'booking_date' | 'full_name' | 'county' | 'status';
type SortDir = 'asc' | 'desc';
const SORT_CYCLE: { field: SortField; dir: SortDir; label: string }[] = [
  { field: 'booking_date', dir: 'desc', label: 'Newest First' },
  { field: 'full_name', dir: 'asc', label: 'Name A→Z' },
  { field: 'county', dir: 'asc', label: 'County A→Z' },
  { field: 'status', dir: 'asc', label: 'Status' },
];

// ── Helpers ───────────────────────────────────────────────

function parseCharges(c: string[] | string | null | undefined): string[] {
  if (!c) return [];
  if (Array.isArray(c)) return c;
  try { const parsed = JSON.parse(c); return Array.isArray(parsed) ? parsed : []; }
  catch { return c ? [c] : []; }
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return String(d).substring(0, 10);
}

function calcAge(dob: string | null | undefined): string {
  if (!dob) return '';
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `(${age} yrs)`;
}

function statusBadge(status: string) {
  if (status === 'active') return { bg: 'bg-red-900/40 text-red-400', label: 'IN CUSTODY' };
  if (status === 'released') return { bg: 'bg-green-900/40 text-green-400', label: 'RELEASED' };
  if (status === 'transferred') return { bg: 'bg-amber-900/40 text-amber-400', label: 'TRANSFERRED' };
  if (status === 'bonded') return { bg: 'bg-blue-900/40 text-blue-400', label: 'BONDED' };
  return { bg: 'bg-rmpg-700 text-rmpg-400', label: status?.toUpperCase() || '—' };
}

function sourceBadge(source: string | null) {
  if (source === 'manual') return { bg: 'bg-brand-900/40 text-brand-400', label: 'MANUAL' };
  if (source === 'scraper') return { bg: 'bg-emerald-900/30 text-emerald-400', label: 'SCRAPER' };
  if (source === 'csv') return { bg: 'bg-purple-900/30 text-purple-400', label: 'CSV' };
  return { bg: 'bg-rmpg-700 text-rmpg-400', label: source?.toUpperCase() || 'UNKNOWN' };
}

// ── CSV Export ────────────────────────────────────────────

function exportCsv(records: ArrestRecord[]) {
  const headers = ['Name', 'DOB', 'County', 'Booking Date', 'Release Date', 'Status', 'Charges', 'Bail Amount', 'Agency', 'Source'];
  const rows = records.map(r => [
    r.full_name,
    r.date_of_birth || '',
    r.county || r.source_id || '',
    fmtDate(r.booking_date),
    fmtDate(r.release_date),
    r.status,
    parseCharges(r.charges).join('; '),
    r.bail_amount != null ? String(r.bail_amount) : '',
    r.agency || '',
    r.entry_source || '',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `arrest-records-${localToday()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────

const timeAgo = (date: string) => {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function ArrestRecordsPage() {
  // ── State ───────────────────────────────────────────────
  const { subscribe } = useWebSocket();
  const { addToast } = useToast();

  // Statistics
  const [stats, setStats] = useState<{
    per_county: CountyStat[];
    population_summary: PopulationSummary;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Records
  const [records, setRecords] = useState<ArrestRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ArrestRecord | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [countyFilter, setCountyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  // Sort
  const [sortIdx, setSortIdx] = useState(0);

  // Error
  const [error, setError] = useState<string | null>(null);

  // CRUD
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ArrestRecord | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Person linking
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<PersonResult[]>([]);
  const [searchingPerson, setSearchingPerson] = useState(false);
  const [linkingPerson, setLinkingPerson] = useState(false);

  // Refs
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // ── Fetch statistics ────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch<any>('/jail-roster/statistics');
      setStats(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load statistics';
      setError(msg);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Fetch records (no hardcoded source filter!) ─────────

  const fetchRecords = useCallback(async (page = 1) => {
    setRecordsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: '30',
        ...(sourceFilter ? { source: sourceFilter } : {}),
        ...(countyFilter ? { source_id: countyFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });

      let data: any;
      if (searchTerm.trim()) {
        const searchQs = new URLSearchParams({
          name: searchTerm,
          ...(sourceFilter ? { source: sourceFilter } : {}),
          ...(countyFilter ? { source_id: countyFilter } : {}),
        });
        data = await apiFetch<any>(`/arrests/search?${searchQs}`);
        setRecords(data.records || []);
        setRecordsTotal(data.resultCount || data.records?.length || 0);
      } else {
        data = await apiFetch<any>(`/arrests/recent?${qs}`);
        setRecords(data.records || []);
        setRecordsTotal(data.total || 0);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load records';
      setError(msg);
    } finally {
      setRecordsLoading(false);
    }
  }, [searchTerm, countyFilter, statusFilter, sourceFilter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchRecords(recordsPage); }, [fetchRecords, recordsPage]);
  useLiveSync('arrests', () => { fetchRecords(recordsPage); fetchStats(); });

  // ── WebSocket live sync ─────────────────────────────────

  useEffect(() => {
    return subscribe('record_update', (msg) => {
      const data = msg.data as any;
      if (data?.type === 'arrest_created' || data?.type === 'arrest_updated') {
        fetchRecords(recordsPage);
        if (selectedRecord && data?.id === selectedRecord.id) {
          apiFetch<ArrestRecord>(`/arrests/manual/${selectedRecord.id}`)
            .then(fresh => setSelectedRecord(fresh))
            .catch(() => { /* keep existing */ });
        }
      }
    });
  }, [subscribe, recordsPage, selectedRecord, fetchRecords]);

  // ── Person search (debounced) ───────────────────────────

  const searchPersons = useCallback(async (query: string) => {
    if (query.length < 2) { setPersonResults([]); return; }
    setSearchingPerson(true);
    try {
      const data = await apiFetch<any>(`/records/persons/search?q=${encodeURIComponent(query)}&limit=8`);
      setPersonResults(data.results || data || []);
    } catch {
      setPersonResults([]);
    } finally {
      setSearchingPerson(false);
    }
  }, []);

  useEffect(() => {
    if (!linkingId) return;
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchPersons(personSearch), 300);
    return () => clearTimeout(searchTimeout.current);
  }, [personSearch, searchPersons, linkingId]);

  // ── Link / Unlink person ────────────────────────────────

  const handleLinkPerson = async (arrestId: number, personId: number) => {
    setLinkingPerson(true);
    try {
      await apiFetch(`/arrests/${arrestId}/link-person`, {
        method: 'PUT',
        body: JSON.stringify({ person_id: personId }),
      });
      setLinkingId(null);
      setPersonSearch('');
      setPersonResults([]);
      fetchRecords(recordsPage);
      if (selectedRecord?.id === arrestId) {
        try {
          const fresh = await apiFetch<ArrestRecord>(`/arrests/manual/${arrestId}`);
          setSelectedRecord(fresh);
        } catch { /* keep existing */ }
      }
      addToast('Person linked to arrest record', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to link person';
      addToast(msg, 'error');
    } finally {
      setLinkingPerson(false);
    }
  };

  const handleUnlinkPerson = async (arrestId: number) => {
    try {
      await apiFetch(`/arrests/${arrestId}/link-person`, { method: 'DELETE' });
      fetchRecords(recordsPage);
      if (selectedRecord?.id === arrestId) {
        setSelectedRecord(prev => prev ? { ...prev, linked_person: null, person_id: null } : null);
      }
      addToast('Person unlinked', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to unlink person';
      addToast(msg, 'error');
    }
  };

  // ── CRUD handlers ───────────────────────────────────────

  const handleFormSubmit = async (data: ArrestFormData) => {
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/arrests/manual/${editingRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
      } else {
        await apiFetch('/arrests/manual', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
      setFormOpen(false);
      setEditingRecord(undefined);
      fetchRecords(recordsPage);
      if (editingRecord && selectedRecord?.id === editingRecord.id) {
        try {
          const fresh = await apiFetch<ArrestRecord>(`/arrests/manual/${editingRecord.id}`);
          setSelectedRecord(fresh);
        } catch { /* keep existing */ }
      }
      addToast(editingRecord ? 'Booking updated' : 'Booking created', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save booking';
      setFormError(msg);
      addToast(msg, 'error');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/arrests/manual/${id}`, { method: 'DELETE' });
      setDeleteConfirm(null);
      if (selectedRecord?.id === id) setSelectedRecord(null);
      fetchRecords(recordsPage);
      addToast('Record deleted', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete record';
      addToast(msg, 'error');
    }
  };

  const openEdit = (rec: ArrestRecord) => {
    setEditingRecord(rec);
    setFormError(null);
    setFormOpen(true);
  };

  const openNew = () => {
    setEditingRecord(undefined);
    setFormError(null);
    setFormOpen(true);
  };

  // ── Sort ────────────────────────────────────────────────

  const cycleSort = () => setSortIdx(i => (i + 1) % SORT_CYCLE.length);
  const sortConfig = SORT_CYCLE[sortIdx];

  const sortedRecords = [...records].sort((a, b) => {
    const { field, dir } = sortConfig;
    const av = (a[field] || '') as string;
    const bv = (b[field] || '') as string;
    const cmp = av.localeCompare(bv);
    return dir === 'asc' ? cmp : -cmp;
  });

  // ── Derived ─────────────────────────────────────────────

  const totalPages = Math.ceil(recordsTotal / 30);
  const maxPopulation = stats?.per_county?.length ? Math.max(...stats.per_county.map(c => c.active_count), 1) : 1;
  const isManualRecord = (rec: ArrestRecord) => rec.entry_source === 'manual';

  // ── Render: Left Panel (List) ───────────────────────────

  const leftPanel = (
    <div className="h-full flex flex-col bg-surface-base">
      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border-b border-red-700 text-red-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Summary bar */}
      {stats?.population_summary && (
        <div className="grid grid-cols-3 gap-1 p-2 border-b border-rmpg-700/30">
          {[
            { label: 'Total', value: stats.population_summary.total_records, color: 'text-brand-400' },
            { label: 'In Custody', value: stats.population_summary.total_active, color: 'text-red-400' },
            { label: 'Released', value: stats.population_summary.total_released, color: 'text-green-400' },
          ].map(s => (
            <div key={s.label} className="text-center py-1">
              <div className={`text-sm font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
              <div className="text-[7px] text-rmpg-500 uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* County stats (collapsible) */}
      {stats?.per_county && stats.per_county.length > 0 && (
        <CollapsibleSection title="County Statistics" icon={BarChart3} defaultOpen={false} className="border-b border-rmpg-700/30">
          <div className="grid grid-cols-2 gap-1.5 px-1">
            {stats.per_county.map(c => (
              <div
                key={c.county}
                className={`bg-gradient-to-br ${COUNTY_COLORS[c.county] || 'from-rmpg-700/20 to-rmpg-800/10 border-rmpg-600/30'} border rounded-sm p-2 cursor-pointer hover:brightness-110 transition-all ${countyFilter === c.county ? 'ring-1 ring-brand-400' : ''}`}
                onClick={() => { setCountyFilter(countyFilter === c.county ? '' : c.county); setRecordsPage(1); }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold text-rmpg-100 truncate">{c.display_name || c.county}</span>
                  <span className={`text-sm font-black ${COUNTY_ACCENTS[c.county] || 'text-brand-400'}`}>
                    {c.active_count}
                  </span>
                </div>
                <div className="w-full bg-rmpg-800/50 rounded-full h-1.5 mt-1">
                  <div
                    className={`h-1.5 rounded-full ${COUNTY_BAR_COLORS[c.county] || 'bg-brand-500'}`}
                    style={{ width: `${(c.active_count / maxPopulation) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1 text-[7px] text-rmpg-500">
                  <span>Tot: {c.total_records}</span>
                  <span>{c.male_count}M / {c.female_count}F</span>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Toolbar: search, filters, actions */}
      <div className="p-2 space-y-1.5 border-b border-rmpg-700/30">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setRecordsPage(1); }}
            placeholder="Search by name..." aria-label="Search by name..."
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] pl-7 pr-8 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
          />
          {searchTerm && (
            <button type="button" onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-1 flex-wrap">
          <select
            value={countyFilter}
            onChange={e => { setCountyFilter(e.target.value); setRecordsPage(1); }}
            className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[9px] px-1.5 py-1 rounded-sm flex-1 min-w-0"
          >
            <option value="">All Counties</option>
            {(stats?.per_county || []).map(c => (
              <option key={c.county} value={c.county}>{c.display_name || c.county} ({c.active_count})</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setRecordsPage(1); }}
            className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[9px] px-1.5 py-1 rounded-sm"
          >
            <option value="">All Status</option>
            <option value="active">In Custody</option>
            <option value="released">Released</option>
            <option value="transferred">Transferred</option>
            <option value="bonded">Bonded</option>
          </select>

          <select
            value={sourceFilter}
            onChange={e => { setSourceFilter(e.target.value); setRecordsPage(1); }}
            className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[9px] px-1.5 py-1 rounded-sm"
          >
            <option value="">All Sources</option>
            <option value="scraper">Scraper</option>
            <option value="manual">Manual</option>
            <option value="csv">CSV Import</option>
          </select>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <button type="button" onClick={openNew} className="toolbar-btn toolbar-btn-primary text-[9px] flex items-center gap-1 px-2 py-1">
            <Plus className="w-3 h-3" /> New Booking
          </button>
          <ExportButton exportUrl="/api/arrests/export/csv" exportFilename="arrests.csv" />
          <button type="button" onClick={() => exportCsv(sortedRecords)} className="toolbar-btn text-[9px] flex items-center gap-1 px-2 py-1">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button type="button" onClick={cycleSort} className="toolbar-btn text-[9px] flex items-center gap-1 px-2 py-1" title={`Sort: ${sortConfig.label}`}>
            <ArrowUpDown className="w-3 h-3" /> {sortConfig.label}
          </button>
          <button type="button"
            onClick={() => { fetchStats(); fetchRecords(recordsPage); }}
            className="toolbar-btn text-[9px] flex items-center gap-1 px-2 py-1 ml-auto"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <span className="text-[8px] text-rmpg-500">{recordsTotal.toLocaleString()}</span>
        </div>
      </div>

      {/* Records list */}
      <div className="flex-1 overflow-y-auto">
        {recordsLoading ? (
          <div className="flex items-center gap-2 text-[10px] text-rmpg-500 py-8 justify-center">
            <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Loading records...
          </div>
        ) : sortedRecords.length === 0 ? (
          <EmptyState icon={UserX} title="No records found" description="Adjust filters or create a new booking." />
        ) : (
          <div className="space-y-0.5 p-1">
            {sortedRecords.map(rec => {
              const charges = parseCharges(rec.charges);
              const isSelected = selectedRecord?.id === rec.id;
              const stBadge = statusBadge(rec.status);

              return (
                <div
                  key={rec.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-brand-900/30 border-l-2 border-brand-400'
                      : 'bg-surface-sunken hover:bg-rmpg-800/30 border-l-2 border-transparent'
                  }`}
                  onClick={() => setSelectedRecord(rec)}
                >
                  {/* County color indicator */}
                  <div className={`shrink-0 w-1 h-8 rounded-full ${COUNTY_BAR_COLORS[rec.source_id] || 'bg-rmpg-600'}`} />

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-rmpg-100 truncate">{rec.full_name}</span>
                      {rec.entry_source === 'manual' && (
                        <span className="text-[7px] px-1 py-px bg-brand-900/40 text-brand-400 font-bold uppercase rounded-sm">M</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[8px] text-rmpg-500">
                      <span className={COUNTY_ACCENTS[rec.source_id] || ''}>{rec.county || rec.source_id || '—'}</span>
                      <span>{fmtDate(rec.booking_date)}</span>
                      {charges.length > 0 && <span className="text-amber-400">{charges.length} chg</span>}
                    </div>
                  </div>

                  {/* Status badge */}
                  <span className={`text-[7px] font-bold uppercase px-1.5 py-0.5 rounded-sm shrink-0 ${stBadge.bg}`}>
                    {stBadge.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700/30 text-[9px]">
          <button type="button"
            disabled={recordsPage <= 1}
            onClick={() => setRecordsPage(p => p - 1)}
            className="text-rmpg-400 hover:text-rmpg-200 disabled:opacity-30 px-2 py-0.5"
          >
            ← Prev
          </button>
          <span className="text-rmpg-500">
            {recordsPage} / {totalPages}
          </span>
          <button type="button"
            disabled={recordsPage >= totalPages}
            onClick={() => setRecordsPage(p => p + 1)}
            className="text-rmpg-400 hover:text-rmpg-200 disabled:opacity-30 px-2 py-0.5"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );

  // ── Render: Right Panel (Detail) ────────────────────────

  const rightPanel = selectedRecord ? (() => {
    const rec = selectedRecord;
    const charges = parseCharges(rec.charges);
    const stBadge = statusBadge(rec.status);
    const srcBadge = sourceBadge(rec.entry_source);
    const isManual = isManualRecord(rec);
    const isLinking = linkingId === rec.id;

    return (
      <div className="h-full overflow-y-auto bg-surface-base">
        {/* Header */}
        <div className="p-4 border-b border-rmpg-700/30" style={{ background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)' }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-white">{rec.full_name}</h2>
              {rec.booking_number && (
                <span className="text-[9px] font-mono text-rmpg-400">Booking #{rec.booking_number}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded-sm ${stBadge.bg}`}>{stBadge.label}</span>
              <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded-sm ${srcBadge.bg}`}>{srcBadge.label}</span>
            </div>
          </div>

          {isManual && (
            <div className="flex items-center gap-1.5 mt-2">
              <button type="button" onClick={() => openEdit(rec)} className="toolbar-btn text-[9px] flex items-center gap-1 px-2 py-1">
                <Pencil className="w-3 h-3" /> Edit
              </button>
              <button type="button"
                onClick={() => setDeleteConfirm(rec.id)}
                className="toolbar-btn text-[9px] flex items-center gap-1 px-2 py-1 text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          )}
        </div>

        <div className="p-2 space-y-1">
          {/* Booking Information */}
          <CollapsibleSection title="Booking Information" icon={Calendar} defaultOpen>
            <div className="grid grid-cols-2 gap-2 text-[9px]">
              {[
                { label: 'Booking Date', value: fmtDate(rec.booking_date) },
                { label: 'Release Date', value: fmtDate(rec.release_date) },
                { label: 'County', value: rec.county || rec.source_id || '—', accent: COUNTY_ACCENTS[rec.source_id] },
                { label: 'Agency', value: rec.agency || '—' },
                { label: 'Booking Number', value: rec.booking_number || '—', mono: true },
                { label: 'Source', value: rec.entry_source || '—' },
              ].map(f => (
                <div key={f.label}>
                  <span className="text-rmpg-500 uppercase text-[8px]">{f.label}</span>
                  <div className={`font-bold ${f.accent || 'text-rmpg-200'} ${f.mono ? 'font-mono' : ''}`}>{f.value}</div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* Physical Description */}
          <CollapsibleSection title="Physical Description" icon={Eye} defaultOpen>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[9px]">
              {[
                { label: 'DOB', value: rec.date_of_birth ? `${fmtDate(rec.date_of_birth)} ${calcAge(rec.date_of_birth)}` : null },
                { label: 'Gender', value: rec.gender },
                { label: 'Race', value: rec.race },
                { label: 'Height', value: rec.height },
                { label: 'Weight', value: rec.weight },
                { label: 'Hair', value: rec.hair_color },
                { label: 'Eyes', value: rec.eye_color },
                { label: 'Address', value: rec.address },
              ].map(f => (
                <div key={f.label}>
                  <span className="text-rmpg-500 uppercase text-[8px]">{f.label}</span>
                  <div className="text-rmpg-200 font-bold">{f.value || '—'}</div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* Charges & Bail */}
          <CollapsibleSection title="Charges & Bail" icon={Scale} count={charges.length} defaultOpen>
            {charges.length > 0 ? (
              <div className="space-y-0.5 mb-2">
                {charges.map((ch, i) => (
                  <div key={i} className="text-[9px] text-amber-300 bg-amber-950/20 px-2 py-1 rounded-sm">
                    {ch}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[9px] text-rmpg-500 py-1">No charges listed</div>
            )}
            <div className="grid grid-cols-2 gap-2 text-[9px]">
              <div>
                <span className="text-rmpg-500 uppercase text-[8px]">Bail Amount</span>
                <div className="text-rmpg-200 font-bold">
                  {rec.bail_amount != null ? `$${Number(rec.bail_amount).toLocaleString()}` : '—'}
                </div>
              </div>
              <div>
                <span className="text-rmpg-500 uppercase text-[8px]">Hold Reason</span>
                <div className="text-rmpg-200 font-bold">{rec.hold_reason || '—'}</div>
              </div>
            </div>
          </CollapsibleSection>

          {/* Linked Person */}
          <CollapsibleSection title="Linked Person" icon={Link2} defaultOpen>
            {rec.linked_person ? (
              <div className="flex items-center gap-2 text-[9px]">
                <Link2 className="w-3 h-3 text-brand-400" />
                <span className="text-brand-300 font-bold">{rec.linked_person.name}</span>
                <span className="text-rmpg-500">(ID: {rec.linked_person.id})</span>
                <button type="button"
                  onClick={() => handleUnlinkPerson(rec.id)}
                  className="text-[8px] text-red-400 hover:text-red-300 flex items-center gap-0.5 ml-2"
                >
                  <Unlink className="w-2.5 h-2.5" /> Unlink
                </button>
              </div>
            ) : isLinking ? (
              <div className="space-y-1">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-rmpg-500" />
                  <input
                    type="text"
                    value={personSearch}
                    onChange={e => setPersonSearch(e.target.value)}
                    placeholder="Search persons by name..." aria-label="Search persons by name..."
                    className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] pl-6 pr-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                    autoFocus
                  />
                </div>
                {searchingPerson && (
                  <div className="flex items-center gap-1 text-[9px] text-rmpg-500">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" role="status" aria-label="Loading" /> Searching...
                  </div>
                )}
                {personResults.length > 0 && (
                  <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
                    {personResults.map(p => (
                      <button type="button"
                        key={p.id}
                        onClick={() => handleLinkPerson(rec.id, p.id)}
                        disabled={linkingPerson}
                        className="w-full text-left px-2 py-1 rounded-sm bg-surface-sunken hover:bg-brand-900/30 text-[9px] flex items-center gap-2"
                      >
                        <UserPlus className="w-3 h-3 text-brand-400" />
                        <span className="text-rmpg-200 font-bold">{p.last_name}, {p.first_name}</span>
                        {p.dob && <span className="text-rmpg-500">DOB: {p.dob}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button"
                  onClick={() => { setLinkingId(null); setPersonSearch(''); setPersonResults([]); }}
                  className="text-[8px] text-rmpg-500 hover:text-rmpg-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button"
                onClick={() => setLinkingId(rec.id)}
                className="text-[9px] text-brand-400 hover:text-brand-300 flex items-center gap-1"
              >
                <UserPlus className="w-3 h-3" /> Link to Person Record
              </button>
            )}
          </CollapsibleSection>

          {/* Criminal History (if linked to a person) */}
          {rec.linked_person && (
            <CriminalHistorySection
              personId={String(rec.linked_person.id)}
              personName={rec.linked_person.name}
            />
          )}

          {/* Notes */}
          {rec.notes && (
            <CollapsibleSection title="Notes" icon={FileText} defaultOpen>
              <div className="text-[9px] text-rmpg-200 whitespace-pre-wrap leading-relaxed">
                {rec.notes}
              </div>
            </CollapsibleSection>
          )}

          {/* Metadata */}
          <CollapsibleSection title="Metadata" icon={Database} defaultOpen={false}>
            <div className="grid grid-cols-2 gap-2 text-[9px]">
              {[
                { label: 'Created', value: rec.created_at ? fmtDate(rec.created_at) : null },
                { label: 'Updated', value: rec.updated_at ? fmtDate(rec.updated_at) : null },
                { label: 'Entered By', value: rec.entered_by ? `User #${rec.entered_by}` : null },
                { label: 'Entry Source', value: rec.entry_source },
                { label: 'Source ID', value: rec.source_id || rec.jailbase_id },
                { label: 'Record ID', value: String(rec.id) },
              ].map(f => (
                <div key={f.label}>
                  <span className="text-rmpg-500 uppercase text-[8px]">{f.label}</span>
                  <div className="text-rmpg-200 font-mono">{f.value || '—'}</div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      </div>
    );
  })() : (
    <div className="h-full flex items-center justify-center bg-surface-base">
      <EmptyState
        icon={ShieldAlert}
        title="Select a record"
        description="Choose a booking record from the list to view details."
      />
    </div>
  );

  // ── Main Render ─────────────────────────────────────────

  // Set document title
  useEffect(() => { document.title = 'Arrest Records \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFormOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface-base">
      <PanelTitleBar title="Arrest Records" icon={Shield}>
        <span className="text-[8px] text-rmpg-500">
          {recordsTotal.toLocaleString()} records
        </span>
      </PanelTitleBar>

      <div className="flex-1 overflow-hidden">
        <SplitPanel
          left={leftPanel}
          right={rightPanel}
          persistKey="arrests-split"
          initialRatio={0.45}
          rightVisible={true}
          leftLabel="List"
          rightLabel="Detail"
        />
      </div>

      {/* Booking Form Modal */}
      <ArrestFormModal
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleFormSubmit}
        isSubmitting={formSubmitting}
        editingRecord={editingRecord}
        submitError={formError}
      />

      {/* Delete Confirmation */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDeleteConfirm(null)} />
          <div className="relative w-full max-w-sm mx-4 bg-surface-base border border-rmpg-600 shadow-2xl animate-fade-in">
            <div
              className="flex items-center gap-2 px-4 py-2 border-b border-rmpg-600"
              style={{ background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)' }}
            >
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">Delete Booking</h2>
            </div>
            <div className="p-5">
              <p className="text-sm text-rmpg-200 leading-relaxed">
                Are you sure you want to permanently delete this booking record? This action cannot be undone.
              </p>
              <div className="flex items-center justify-end gap-3 mt-5">
                <button type="button" onClick={() => setDeleteConfirm(null)} className="toolbar-btn">
                  Cancel
                </button>
                <button type="button"
                  onClick={() => handleDelete(deleteConfirm)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide border shadow-sm bg-red-700 hover:bg-red-600 border-red-500 text-white transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
