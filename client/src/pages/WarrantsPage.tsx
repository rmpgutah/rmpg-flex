import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import {
  AlertTriangle,
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Archive,
  RotateCcw,
  MapPin,
  User,
  Gavel,
  ChevronDown,
  X,
  Scale,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import PrintRecordButton from '../components/PrintRecordButton';
import ConfirmDialog from '../components/ConfirmDialog';
import StatusBadge from '../components/StatusBadge';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import StatuteLookup, { OffenseLevelBadge } from '../components/StatuteLookup';
import type { StatuteResult } from '../components/StatuteLookup';

// ============================================================
// Types
// ============================================================

interface Warrant {
  id: number;
  warrant_number: string;
  type: 'arrest' | 'search' | 'bench' | 'civil' | 'other';
  status: 'active' | 'served' | 'recalled' | 'expired' | 'quashed';
  subject_person_id: number | null;
  subject_first_name: string | null;
  subject_last_name: string | null;
  subject_name: string | null;
  subject_dob?: string | null;
  subject_gender?: string | null;
  subject_race?: string | null;
  subject_height?: string | null;
  subject_weight?: string | null;
  subject_hair_color?: string | null;
  subject_eye_color?: string | null;
  subject_address?: string | null;
  subject_photo_url?: string | null;
  issuing_court: string | null;
  issuing_judge: string | null;
  charge_description: string;
  bail_amount: number | null;
  offense_level: 'felony' | 'misdemeanor' | 'infraction' | 'civil' | null;
  entered_by: number;
  entered_by_name: string | null;
  served_by: number | null;
  served_by_name?: string | null;
  served_at: string | null;
  served_location: string | null;
  expires_at: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  activity?: ActivityEntry[];
}

interface ActivityEntry {
  id: number;
  action: string;
  details: string;
  user_name: string;
  created_at: string;
}

interface Person {
  id: number;
  first_name: string;
  last_name: string;
  dob?: string;
}

// ============================================================
// Constants
// ============================================================

const WARRANT_TYPES: { value: string; label: string }[] = [
  { value: 'arrest', label: 'Arrest' },
  { value: 'search', label: 'Search' },
  { value: 'bench', label: 'Bench' },
  { value: 'civil', label: 'Civil' },
  { value: 'other', label: 'Other' },
];

const WARRANT_STATUSES: { value: string; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'served', label: 'Served' },
  { value: 'recalled', label: 'Recalled' },
  { value: 'expired', label: 'Expired' },
  { value: 'quashed', label: 'Quashed' },
];

const OFFENSE_LEVELS: { value: string; label: string }[] = [
  { value: 'felony', label: 'Felony' },
  { value: 'misdemeanor', label: 'Misdemeanor' },
  { value: 'infraction', label: 'Infraction' },
  { value: 'civil', label: 'Civil' },
];

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-red-900/50 text-red-400 border-red-700/50',
  served: 'bg-green-900/50 text-green-400 border-green-700/50',
  recalled: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  expired: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  quashed: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
};

const TYPE_COLORS: Record<string, string> = {
  arrest: 'bg-red-900/40 text-red-300 border-red-700/50',
  search: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  bench: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  civil: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  other: 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50',
};

function formatDateTime(dt: string | null): string {
  if (!dt) return '-';
  try {
    return new Date(dt.replace(' ', 'T')).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return dt; }
}

function formatDate(dt: string | null): string {
  if (!dt) return '-';
  try {
    return new Date(dt.replace(' ', 'T')).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return dt; }
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// ============================================================
// Component
// ============================================================

export default function WarrantsPage() {
  const isMobile = useIsMobile();
  const warrantFormTitleId = useId();
  const serveTitleId = useId();
  // Data
  const warrantDetailRef = useRef<HTMLDivElement>(null);
  const [warrants, setWarrants] = useState<Warrant[]>([]);
  const [selectedWarrant, setSelectedWarrant] = useState<Warrant | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingWarrant, setEditingWarrant] = useState<Warrant | null>(null);
  const [formData, setFormData] = useState({
    type: 'arrest',
    subject_person_id: '',
    issuing_court: '',
    issuing_judge: '',
    charge_description: '',
    bail_amount: '',
    offense_level: '',
    expires_at: '',
    notes: '',
    statute_id: null as number | null,
    statute_citation: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Serve modal
  const [serveModalOpen, setServeModalOpen] = useState(false);
  const [serveLocation, setServeLocation] = useState('');
  const [serving, setServing] = useState(false);

  // Delete confirm
  const [deletingWarrant, setDeletingWarrant] = useState<Warrant | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Person search for form
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<Person[]>([]);
  const [personSearchLoading, setPersonSearchLoading] = useState(false);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const [selectedPersonName, setSelectedPersonName] = useState('');

  // ============================================================
  // Fetch
  // ============================================================

  const fetchWarrants = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('type', filterType);
      if (searchQuery) params.set('subject_name', searchQuery);
      params.set('archived', showArchived ? 'true' : 'false');
      params.set('page', String(page));
      params.set('per_page', '50');

      const res = await apiFetch<{ data: Warrant[]; pagination: { total: number; totalPages: number } }>(
        `/warrants?${params.toString()}`
      );
      setWarrants(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) {
      if (!options?.silent) setError(err?.message || 'Failed to load warrants');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [filterStatus, filterType, searchQuery, showArchived, page]);

  useEffect(() => { fetchWarrants(); }, [fetchWarrants]);

  // Live sync — auto-refresh when any device modifies warrants (silent to avoid unmounting UI)
  const silentRefreshWarrants = useCallback(() => fetchWarrants({ silent: true }), [fetchWarrants]);
  useLiveSync('alerts', silentRefreshWarrants);

  // Fetch warrant detail
  const fetchWarrantDetail = useCallback(async (id: number) => {
    try {
      const detail = await apiFetch<Warrant>(`/warrants/${id}`);
      setSelectedWarrant(detail);
    } catch { /* keep existing */ }
  }, []);

  // Person search
  useEffect(() => {
    if (!personSearch || personSearch.length < 2) {
      setPersonResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setPersonSearchLoading(true);
      try {
        const res = await apiFetch<{ data: Person[] }>(`/records/persons?search=${encodeURIComponent(personSearch)}&limit=10`);
        setPersonResults(res.data || res as any || []);
      } catch { setPersonResults([]); }
      finally { setPersonSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [personSearch]);

  // ============================================================
  // Handlers
  // ============================================================

  const openNewForm = () => {
    setEditingWarrant(null);
    setFormData({
      type: 'arrest',
      subject_person_id: '',
      issuing_court: '',
      issuing_judge: '',
      charge_description: '',
      bail_amount: '',
      offense_level: '',
      expires_at: '',
      notes: '',
      statute_id: null,
      statute_citation: '',
    });
    setPersonSearch('');
    setSelectedPersonName('');
    setFormOpen(true);
  };

  const openEditForm = (w: Warrant) => {
    setEditingWarrant(w);
    setFormData({
      type: w.type,
      subject_person_id: w.subject_person_id ? String(w.subject_person_id) : '',
      issuing_court: w.issuing_court || '',
      issuing_judge: w.issuing_judge || '',
      charge_description: w.charge_description,
      bail_amount: w.bail_amount != null ? String(w.bail_amount) : '',
      offense_level: w.offense_level || '',
      expires_at: w.expires_at || '',
      notes: w.notes || '',
      statute_id: (w as any).statute_id || null,
      statute_citation: (w as any).statute_citation || '',
    });
    setSelectedPersonName(w.subject_name || '');
    setPersonSearch('');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.charge_description.trim()) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        type: formData.type,
        charge_description: formData.charge_description.trim(),
        subject_person_id: formData.subject_person_id ? parseInt(formData.subject_person_id) : null,
        issuing_court: formData.issuing_court.trim() || null,
        issuing_judge: formData.issuing_judge.trim() || null,
        bail_amount: formData.bail_amount ? parseFloat(formData.bail_amount) : null,
        offense_level: formData.offense_level || null,
        expires_at: formData.expires_at || null,
        notes: formData.notes.trim() || null,
        statute_id: formData.statute_id || null,
        statute_citation: formData.statute_citation || null,
      };

      if (editingWarrant) {
        const updated = await apiFetch<Warrant>(`/warrants/${editingWarrant.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        setWarrants((prev) => prev.map((w) => w.id === editingWarrant.id ? { ...w, ...updated } : w));
        if (selectedWarrant?.id === editingWarrant.id) fetchWarrantDetail(editingWarrant.id);
      } else {
        await apiFetch('/warrants', { method: 'POST', body: JSON.stringify(body) });
        await fetchWarrants({ silent: true });
      }
      setFormOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to save warrant');
    } finally {
      setSubmitting(false);
    }
  };

  const handleServe = async () => {
    if (!selectedWarrant) return;
    setServing(true);
    try {
      const updated = await apiFetch<Warrant>(`/warrants/${selectedWarrant.id}/serve`, {
        method: 'PUT',
        body: JSON.stringify({ served_location: serveLocation.trim() || null }),
      });
      setWarrants((prev) => prev.map((w) => w.id === selectedWarrant.id ? { ...w, ...updated } : w));
      setSelectedWarrant(prev => prev ? { ...prev, ...updated } : prev);
      setServeModalOpen(false);
      setServeLocation('');
    } catch (err: any) {
      setError(err?.message || 'Failed to serve warrant');
    } finally {
      setServing(false);
    }
  };

  const handleArchive = async (id: number) => {
    try {
      await apiFetch(`/warrants/${id}/archive`, { method: 'POST' });
      await fetchWarrants({ silent: true });
      if (selectedWarrant?.id === id) setSelectedWarrant(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to archive warrant');
    }
  };

  const handleUnarchive = async (id: number) => {
    try {
      await apiFetch(`/warrants/${id}/unarchive`, { method: 'POST' });
      await fetchWarrants({ silent: true });
      if (selectedWarrant?.id === id) fetchWarrantDetail(id);
    } catch (err: any) {
      setError(err?.message || 'Failed to unarchive warrant');
    }
  };

  const handleDelete = async () => {
    if (!deletingWarrant) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/warrants/${deletingWarrant.id}`, { method: 'DELETE' });
      setDeletingWarrant(null);
      if (selectedWarrant?.id === deletingWarrant.id) setSelectedWarrant(null);
      await fetchWarrants({ silent: true });
    } catch (err: any) {
      setError(err?.message || 'Failed to delete warrant');
      setDeletingWarrant(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    try {
      const updated = await apiFetch<Warrant>(`/warrants/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setWarrants((prev) => prev.map((w) => w.id === id ? { ...w, ...updated } : w));
      if (selectedWarrant?.id === id) fetchWarrantDetail(id);
    } catch (err: any) {
      setError(err?.message || 'Failed to update status');
    }
  };

  // ============================================================
  // Render
  // ============================================================

  const activeCount = warrants.filter((w) => w.status === 'active').length;

  return (
    <div className={`absolute inset-0 ${isMobile ? 'flex flex-col' : 'flex'} overflow-hidden bg-surface-deep`}>
      {/* ── LEFT: Warrant List ── */}
      <div className={`${isMobile ? (selectedWarrant ? 'hidden' : 'flex-1') : 'w-[55%]'} flex flex-col ${!isMobile ? 'border-r border-rmpg-600' : ''}`}>
        <PanelTitleBar title="WARRANTS" icon={AlertTriangle}>
          <RmpgLogo height={16} iconOnly />
          <span className="toolbar-separator" />
          <span className="text-[9px] font-mono text-red-400">{activeCount} ACTIVE</span>
          <span className="toolbar-separator" />
          <span className="text-[9px] font-mono text-rmpg-400">{totalCount} TOTAL</span>
          <span className="toolbar-separator" />
          <button
            onClick={() => { setShowArchived(!showArchived); setPage(1); }}
            className={`toolbar-btn text-[9px] ${showArchived ? 'text-amber-400' : ''}`}
            title={showArchived ? 'Show active warrants' : 'Show archived warrants'}
          >
            <Archive className="w-3 h-3" />
            {showArchived ? 'Showing Archived' : 'Archives'}
          </button>
          <span className="toolbar-separator" />
          {!showArchived && (
            <button onClick={openNewForm} className="toolbar-btn toolbar-btn-primary text-[9px]">
              <Plus className="w-3 h-3" /> New Warrant
            </button>
          )}
          <ExportButton exportUrl="/warrants/export" exportFilename="warrants_export.csv" />
          <PrintButton />
        </PanelTitleBar>

        {/* Filters */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700 bg-surface-sunken">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
            <input
              type="text"
              className="input-dark text-xs w-full pl-7"
              placeholder="Search by subject name..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="input-dark text-xs w-28"
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          >
            <option value="">All Status</option>
            {WARRANT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            className="input-dark text-xs w-24"
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          >
            <option value="">All Types</option>
            {WARRANT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="px-3 py-2 bg-red-900/30 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-3 h-3" /> {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="w-3 h-3" /></button>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-rmpg-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading warrants...
            </div>
          ) : warrants.length === 0 ? (
            <div className="flex items-center justify-center h-full text-rmpg-400">
              <div className="text-center">
                <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-rmpg-500" />
                <p className="text-sm">{showArchived ? 'No archived warrants' : 'No warrants found'}</p>
                {!showArchived && <p className="text-xs text-rmpg-500 mt-1">Create a new warrant to get started</p>}
              </div>
            </div>
          ) : (
            <table className="table-dark">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Number</th>
                  <th style={{ width: 80 }}>Type</th>
                  <th>Subject</th>
                  <th>Charge</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th style={{ width: 90 }}>Offense</th>
                  <th style={{ width: 110 }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {warrants.filter((w) => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase();
                  return (
                    (w.warrant_number || '').toLowerCase().includes(q) ||
                    (w.charge_description || '').toLowerCase().includes(q) ||
                    (w.subject_first_name || '').toLowerCase().includes(q) ||
                    (w.subject_last_name || '').toLowerCase().includes(q) ||
                    (w.subject_name || '').toLowerCase().includes(q)
                  );
                }).map((w) => (
                  <tr
                    key={w.id}
                    onClick={() => fetchWarrantDetail(w.id)}
                    className={`cursor-pointer ${selectedWarrant?.id === w.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''}`}
                  >
                    <td className="font-mono text-xs text-white font-bold">{w.warrant_number || '-'}</td>
                    <td>
                      <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                        {w.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-rmpg-200 text-xs">{w.subject_name || <span className="text-rmpg-500">Unknown</span>}</td>
                    <td className="text-xs text-rmpg-300 truncate max-w-[200px]">{w.charge_description}</td>
                    <td>
                      <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded border ${STATUS_COLORS[w.status] || ''}`}>
                        {w.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-xs text-rmpg-400">{w.offense_level ? w.offense_level.charAt(0).toUpperCase() + w.offense_level.slice(1) : '-'}</td>
                    <td className="text-xs text-rmpg-400">{formatDate(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-sunken">
            <span className="text-[10px] text-rmpg-400">
              Page {page} of {totalPages} ({totalCount} results)
            </span>
            <div className="flex gap-1">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="toolbar-btn text-[9px]">Prev</button>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="toolbar-btn text-[9px]">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: Warrant Detail ── */}
      <div ref={warrantDetailRef} className={`${isMobile ? (selectedWarrant ? 'flex-1' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden`}>
        <PanelTitleBar title="WARRANT DETAIL" icon={Gavel}>
          {isMobile && selectedWarrant && (
            <button onClick={() => setSelectedWarrant(null)} className="toolbar-btn text-[9px]">
              ← Back
            </button>
          )}
          <PrintRecordButton recordType="warrant" recordData={selectedWarrant} identifier={selectedWarrant?.warrant_number} entityType="warrant" entityId={selectedWarrant?.id} label="Print" />
          {selectedWarrant && !selectedWarrant.archived_at && (
            <>
              {selectedWarrant.status === 'active' && (
                <>
                  <button onClick={() => { setServeLocation(''); setServeModalOpen(true); }} className="toolbar-btn toolbar-btn-primary text-[9px]">
                    <CheckCircle className="w-3 h-3" /> Serve
                  </button>
                  <button onClick={() => openEditForm(selectedWarrant)} className="toolbar-btn text-[9px]">
                    <Edit className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={() => handleUpdateStatus(selectedWarrant.id, 'recalled')} className="toolbar-btn text-[9px] text-amber-400">
                    <XCircle className="w-3 h-3" /> Recall
                  </button>
                </>
              )}
              {selectedWarrant.status !== 'active' && (
                <>
                  <button onClick={() => handleArchive(selectedWarrant.id)} className="toolbar-btn text-[9px]" title="Archive this warrant">
                    <Archive className="w-3 h-3" /> Archive
                  </button>
                  <button onClick={() => setDeletingWarrant(selectedWarrant)} className="toolbar-btn text-[9px] text-red-400" title="Permanently delete">
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </>
              )}
            </>
          )}
          {selectedWarrant?.archived_at && (
            <button onClick={() => handleUnarchive(selectedWarrant.id)} className="toolbar-btn text-[9px] text-amber-400">
              <RotateCcw className="w-3 h-3" /> Unarchive
            </button>
          )}
        </PanelTitleBar>

        {selectedWarrant ? (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* Header */}
            <div className="panel-beveled p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-lg font-bold text-white font-mono">{selectedWarrant.warrant_number}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded border ${TYPE_COLORS[selectedWarrant.type] || TYPE_COLORS.other}`}>
                      {selectedWarrant.type.toUpperCase()} WARRANT
                    </span>
                    <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded border ${STATUS_COLORS[selectedWarrant.status] || ''}`}>
                      {selectedWarrant.status.toUpperCase()}
                    </span>
                    {selectedWarrant.offense_level && (
                      <span className="inline-flex px-2 py-0.5 text-[10px] font-bold rounded border bg-rmpg-700/40 text-rmpg-200 border-rmpg-600/50">
                        {selectedWarrant.offense_level.toUpperCase()}
                      </span>
                    )}
                    {selectedWarrant.archived_at && (
                      <span className="inline-flex px-2 py-0.5 text-[10px] font-bold rounded border bg-amber-900/40 text-amber-300 border-amber-700/50">
                        ARCHIVED
                      </span>
                    )}
                  </div>
                </div>
                {selectedWarrant.bail_amount != null && selectedWarrant.bail_amount > 0 && (
                  <div className="text-right">
                    <span className="text-[10px] text-rmpg-400 uppercase">Bail</span>
                    <div className="text-lg font-bold text-green-400 font-mono">{formatCurrency(selectedWarrant.bail_amount)}</div>
                  </div>
                )}
              </div>

              {/* Statute + Charge */}
              {(selectedWarrant as any).statute_citation && (
                <div className="mb-2">
                  <span className="text-[10px] text-rmpg-400 uppercase font-bold">Statute</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-900/30 text-brand-300 border border-brand-700/40 text-xs font-mono font-bold">
                      <Scale className="w-3 h-3" />
                      {(selectedWarrant as any).statute_citation}
                    </span>
                  </div>
                </div>
              )}
              <div className="mb-3">
                <span className="text-[10px] text-rmpg-400 uppercase font-bold">Charge Description</span>
                <p className="text-sm text-white mt-0.5">{selectedWarrant.charge_description}</p>
              </div>

              {/* Dates row */}
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-rmpg-400">Entered</span>
                  <div className="text-rmpg-200 mt-0.5">{formatDateTime(selectedWarrant.created_at)}</div>
                  <div className="text-rmpg-400 text-[10px]">by {selectedWarrant.entered_by_name || 'Unknown'}</div>
                </div>
                {selectedWarrant.expires_at && (
                  <div>
                    <span className="text-rmpg-400">Expires</span>
                    <div className="text-amber-300 mt-0.5">{formatDate(selectedWarrant.expires_at)}</div>
                  </div>
                )}
                {selectedWarrant.served_at && (
                  <div>
                    <span className="text-rmpg-400">Served</span>
                    <div className="text-green-300 mt-0.5">{formatDateTime(selectedWarrant.served_at)}</div>
                    {selectedWarrant.served_by_name && <div className="text-rmpg-400 text-[10px]">by {selectedWarrant.served_by_name}</div>}
                    {selectedWarrant.served_location && (
                      <div className="text-rmpg-400 text-[10px] flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3" /> {selectedWarrant.served_location}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Subject Info */}
            {selectedWarrant.subject_name && (
              <div className="panel-beveled p-4">
                <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                  <User className="w-4 h-4 text-brand-400" /> Subject Information
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-rmpg-400">Name</span>
                    <div className="text-white font-bold">{selectedWarrant.subject_name}</div>
                  </div>
                  {selectedWarrant.subject_dob && (
                    <div>
                      <span className="text-rmpg-400">DOB</span>
                      <div className="text-rmpg-200">{formatDate(selectedWarrant.subject_dob)}</div>
                    </div>
                  )}
                  {selectedWarrant.subject_gender && (
                    <div>
                      <span className="text-rmpg-400">Gender</span>
                      <div className="text-rmpg-200">{selectedWarrant.subject_gender}</div>
                    </div>
                  )}
                  {selectedWarrant.subject_race && (
                    <div>
                      <span className="text-rmpg-400">Race</span>
                      <div className="text-rmpg-200">{selectedWarrant.subject_race}</div>
                    </div>
                  )}
                  {selectedWarrant.subject_height && (
                    <div>
                      <span className="text-rmpg-400">Height</span>
                      <div className="text-rmpg-200">{selectedWarrant.subject_height}</div>
                    </div>
                  )}
                  {selectedWarrant.subject_weight && (
                    <div>
                      <span className="text-rmpg-400">Weight</span>
                      <div className="text-rmpg-200">{selectedWarrant.subject_weight}</div>
                    </div>
                  )}
                  {selectedWarrant.subject_hair_color && (
                    <div>
                      <span className="text-rmpg-400">Hair</span>
                      <div className="text-rmpg-200">{selectedWarrant.subject_hair_color}</div>
                    </div>
                  )}
                  {selectedWarrant.subject_eye_color && (
                    <div>
                      <span className="text-rmpg-400">Eyes</span>
                      <div className="text-rmpg-200">{selectedWarrant.subject_eye_color}</div>
                    </div>
                  )}
                  {selectedWarrant.subject_address && (
                    <div className="col-span-2">
                      <span className="text-rmpg-400">Address</span>
                      <div className="text-rmpg-200">{selectedWarrant.subject_address}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Court Info */}
            {(selectedWarrant.issuing_court || selectedWarrant.issuing_judge) && (
              <div className="panel-beveled p-4">
                <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                  <Gavel className="w-4 h-4 text-brand-400" /> Court Information
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {selectedWarrant.issuing_court && (
                    <div>
                      <span className="text-rmpg-400">Issuing Court</span>
                      <div className="text-rmpg-200">{selectedWarrant.issuing_court}</div>
                    </div>
                  )}
                  {selectedWarrant.issuing_judge && (
                    <div>
                      <span className="text-rmpg-400">Issuing Judge</span>
                      <div className="text-rmpg-200">{selectedWarrant.issuing_judge}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            {selectedWarrant.notes && (
              <div className="panel-beveled p-4">
                <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2">Notes</h3>
                <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedWarrant.notes}</p>
              </div>
            )}

            {/* Activity Log */}
            {selectedWarrant.activity && selectedWarrant.activity.length > 0 && (
              <div className="panel-beveled p-4">
                <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-brand-400" /> Activity Log
                </h3>
                <div className="space-y-2">
                  {selectedWarrant.activity.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-xs">
                      <span className="text-rmpg-500 text-[10px] whitespace-nowrap mt-0.5">{formatDateTime(a.created_at)}</span>
                      <span className="text-rmpg-300">{a.details}</span>
                      <span className="text-rmpg-500 ml-auto whitespace-nowrap">{a.user_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-rmpg-400">
            <div className="text-center">
              <img src="/rmpg flex.png" alt="RMPG" className="w-20 h-20 mx-auto mb-4 opacity-15" draggable={false} />
              <Gavel className="w-8 h-8 mx-auto mb-2 text-rmpg-500" />
              <p className="text-sm">Select a warrant to view details</p>
              <p className="text-xs text-rmpg-500 mt-1">or create a new warrant</p>
            </div>
          </div>
        )}
      </div>

      {/* ── FORM MODAL ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby={warrantFormTitleId}>
          <div className={`panel-beveled ${isMobile ? 'w-full h-full' : 'w-[550px] max-h-[85vh]'} overflow-auto bg-surface-base`}>
            <div className="flex items-center justify-between p-4 border-b border-rmpg-600">
              <h2 id={warrantFormTitleId} className="text-sm font-bold text-white">{editingWarrant ? 'Edit Warrant' : 'New Warrant'}</h2>
              <button onClick={() => setFormOpen(false)} className="text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {/* Type + Offense Level */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Warrant Type *</label>
                  <select className="select-dark text-xs w-full" value={formData.type} onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}>
                    {WARRANT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Offense Level</label>
                  <select className="select-dark text-xs w-full" value={formData.offense_level} onChange={(e) => setFormData(prev => ({ ...prev, offense_level: e.target.value }))}>
                    <option value="">-- Select --</option>
                    {OFFENSE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Subject person search */}
              <div className="relative">
                <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Subject Person</label>
                {selectedPersonName && formData.subject_person_id ? (
                  <div className="flex items-center gap-2 p-2 bg-rmpg-800 border border-rmpg-600 rounded text-xs">
                    <User className="w-3 h-3 text-brand-400" />
                    <span className="text-white font-bold">{selectedPersonName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, subject_person_id: '' }));
                        setSelectedPersonName('');
                      }}
                      className="ml-auto text-rmpg-400 hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      className="input-dark text-xs w-full"
                      placeholder="Search persons by name..."
                      value={personSearch}
                      onChange={(e) => { setPersonSearch(e.target.value); setShowPersonDropdown(true); }}
                      onFocus={() => setShowPersonDropdown(true)}
                    />
                    {showPersonDropdown && personResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 max-h-40 overflow-auto bg-rmpg-800 border border-rmpg-600 rounded shadow-lg">
                        {personResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, subject_person_id: String(p.id) }));
                              setSelectedPersonName(`${p.first_name} ${p.last_name}`);
                              setShowPersonDropdown(false);
                              setPersonSearch('');
                            }}
                            className="w-full text-left px-3 py-2 text-xs text-rmpg-200 hover:bg-rmpg-700 transition-colors flex items-center gap-2"
                          >
                            <User className="w-3 h-3 text-rmpg-400" />
                            <span className="font-bold text-white">{p.first_name} {p.last_name}</span>
                            {p.dob && <span className="text-rmpg-400 ml-auto">DOB: {p.dob}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {personSearchLoading && (
                      <div className="absolute right-2 top-7"><Loader2 className="w-3 h-3 animate-spin text-rmpg-400" /></div>
                    )}
                  </>
                )}
              </div>

              {/* Statute Lookup */}
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Statute Reference</label>
                <StatuteLookup
                  value={formData.statute_citation || undefined}
                  onSelect={(statute: StatuteResult) => {
                    setFormData(prev => ({
                      ...prev,
                      statute_id: statute.id,
                      statute_citation: statute.citation,
                      charge_description: prev.charge_description || `${statute.citation} - ${statute.short_title}`,
                    }));
                  }}
                  onClear={() => setFormData(prev => ({ ...prev, statute_id: null, statute_citation: '' }))}
                  placeholder="Search Utah statute (e.g. 76-5-102 or assault)..."
                />
              </div>

              {/* Charge Description */}
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Charge Description *</label>
                <textarea
                  className="input-dark text-xs w-full"
                  rows={3}
                  value={formData.charge_description}
                  onChange={(e) => setFormData(prev => ({ ...prev, charge_description: e.target.value }))}
                  placeholder="Enter charge description..."
                  required
                />
              </div>

              {/* Court + Judge */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Issuing Court</label>
                  <input type="text" className="input-dark text-xs w-full" value={formData.issuing_court} onChange={(e) => setFormData(prev => ({ ...prev, issuing_court: e.target.value }))} placeholder="e.g. 3rd District Court" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Issuing Judge</label>
                  <input type="text" className="input-dark text-xs w-full" value={formData.issuing_judge} onChange={(e) => setFormData(prev => ({ ...prev, issuing_judge: e.target.value }))} placeholder="e.g. Hon. Smith" />
                </div>
              </div>

              {/* Bail + Expires */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Bail Amount</label>
                  <input type="number" step="0.01" className="input-dark text-xs w-full" value={formData.bail_amount} onChange={(e) => setFormData(prev => ({ ...prev, bail_amount: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Expires</label>
                  <input type="date" className="input-dark text-xs w-full" value={formData.expires_at} onChange={(e) => setFormData(prev => ({ ...prev, expires_at: e.target.value }))} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Notes</label>
                <textarea className="input-dark text-xs w-full" rows={2} value={formData.notes} onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Additional notes..." />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-600">
                <button type="button" onClick={() => setFormOpen(false)} className="toolbar-btn text-xs">Cancel</button>
                <button type="submit" disabled={submitting || !formData.charge_description.trim()} className="toolbar-btn toolbar-btn-primary text-xs">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                  {editingWarrant ? 'Update Warrant' : 'Create Warrant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── SERVE MODAL ── */}
      {serveModalOpen && selectedWarrant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby={serveTitleId}>
          <div className={`panel-beveled ${isMobile ? 'w-full mx-4' : 'w-[400px]'} bg-surface-base`}>
            <div className="flex items-center justify-between p-4 border-b border-rmpg-600">
              <h2 id={serveTitleId} className="text-sm font-bold text-white">Serve Warrant</h2>
              <button onClick={() => setServeModalOpen(false)} className="text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-xs text-rmpg-300">
                Mark warrant <span className="font-bold text-white font-mono">{selectedWarrant.warrant_number}</span> as served?
              </p>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold block mb-1">Location Served (optional)</label>
                <input
                  type="text"
                  className="input-dark text-xs w-full"
                  value={serveLocation}
                  onChange={(e) => setServeLocation(e.target.value)}
                  placeholder="e.g. 123 Main St, Salt Lake City"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setServeModalOpen(false)} className="toolbar-btn text-xs">Cancel</button>
                <button onClick={handleServe} disabled={serving} className="toolbar-btn toolbar-btn-primary text-xs">
                  {serving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                  Confirm Served
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE FAB ── */}
      {isMobile && !selectedWarrant && !showArchived && !formOpen && (
        <button onClick={openNewForm} className="mobile-fab" aria-label="New Warrant">
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* ── DELETE CONFIRM ── */}
      <ConfirmDialog
        isOpen={deletingWarrant !== null}
        onClose={() => setDeletingWarrant(null)}
        onConfirm={handleDelete}
        title="Delete Warrant"
        message={`Are you sure you want to permanently delete warrant "${deletingWarrant?.warrant_number}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteLoading}
      />
    </div>
  );
}
