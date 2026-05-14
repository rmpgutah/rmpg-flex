import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, X, Save, Loader2, PawPrint, MapPin, User, Calendar,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import StatsCard from '../components/StatsCard';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { safeDateStr, safeDateTimeStr } from '../utils/dateUtils';

// ── Types ──
interface AnimalControlCase {
  id: number;
  case_number: string;
  case_type: string;
  status: string;
  animal_type: string;
  breed: string;
  animal_name: string;
  animal_color: string;
  animal_sex: string;
  animal_weight: string;
  microchip_id: string;
  rabies_tag: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_phone: string;
  owner_address: string;
  location: string;
  description: string;
  notes: string;
  officer_name: string;
  assigned_officer_id: number | null;
  quarantine_start: string;
  quarantine_end: string;
  created_at: string;
  updated_at: string;
}

// ── Constants ──
const CASE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'stray', label: 'Stray' },
  { value: 'bite', label: 'Bite' },
  { value: 'quarantine', label: 'Quarantine' },
  { value: 'cruelty', label: 'Cruelty' },
  { value: 'noise', label: 'Noise' },
  { value: 'licensing', label: 'Licensing' },
  { value: 'other', label: 'Other' },
];

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'quarantine', label: 'Quarantine' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'transferred', label: 'Transferred' },
];

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  investigating: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  quarantine: 'bg-red-900/50 text-red-400 border-red-700/50',
  resolved: 'bg-green-900/50 text-green-400 border-green-700/50',
  closed: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
  transferred: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
};

const EMPTY_FORM = {
  case_type: 'complaint',
  animal_type: '',
  breed: '',
  animal_name: '',
  animal_color: '',
  animal_sex: '',
  animal_weight: '',
  microchip_id: '',
  rabies_tag: '',
  owner_first_name: '',
  owner_last_name: '',
  owner_phone: '',
  owner_address: '',
  location: '',
  description: '',
  notes: '',
  quarantine_start: '',
  quarantine_end: '',
};

export default function AnimalControlPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [cases, setCases] = useState<AnimalControlCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<AnimalControlCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<AnimalControlCase | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  // ── Stats ──
  const stats = {
    open: cases.filter(c => c.status === 'open').length,
    investigating: cases.filter(c => c.status === 'investigating').length,
    quarantine: cases.filter(c => c.status === 'quarantine').length,
    resolved: cases.filter(c => c.status === 'resolved').length,
  };

  // ── Fetch ──
  const fetchCases = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      const params = new URLSearchParams({
        page: String(page), per_page: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterType ? { case_type: filterType } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
      });
      const res = await apiFetch<{ data: AnimalControlCase[]; pagination: any }>(`/animal-control?${params}`);
      setCases(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) { setError(err?.message || 'Failed to load cases'); } finally { setLoading(false); }
  }, [page, searchQuery, filterType, filterStatus]);

  useEffect(() => { fetchCases(); }, [fetchCases]);
  useLiveSync('alerts', () => fetchCases({ silent: true }));

  useEffect(() => { document.title = 'Animal Control \u2014 RMPG Flex'; }, []);

  // Keyboard: Escape closes modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFormOpen(false); setEditingCase(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Handlers ──
  const handleOpenNew = () => {
    setEditingCase(null);
    setFormData({ ...EMPTY_FORM });
    setFormOpen(true);
  };

  const handleEdit = (ac: AnimalControlCase) => {
    setEditingCase(ac);
    setFormData({
      case_type: ac.case_type || 'complaint',
      animal_type: ac.animal_type || '',
      breed: ac.breed || '',
      animal_name: ac.animal_name || '',
      animal_color: ac.animal_color || '',
      animal_sex: ac.animal_sex || '',
      animal_weight: ac.animal_weight || '',
      microchip_id: ac.microchip_id || '',
      rabies_tag: ac.rabies_tag || '',
      owner_first_name: ac.owner_first_name || '',
      owner_last_name: ac.owner_last_name || '',
      owner_phone: ac.owner_phone || '',
      owner_address: ac.owner_address || '',
      location: ac.location || '',
      description: ac.description || '',
      notes: ac.notes || '',
      quarantine_start: ac.quarantine_start || '',
      quarantine_end: ac.quarantine_end || '',
    });
    setFormOpen(true);
  };

  const handleRowClick = (ac: AnimalControlCase) => {
    setSelectedCase(ac);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.location) { addToast('Location is required', 'error'); return; }
    setSubmitting(true);
    try {
      const body = { ...formData };
      if (editingCase) {
        await apiFetch(`/animal-control/${editingCase.id}`, { method: 'PUT', body: JSON.stringify(body) });
        addToast('Case updated', 'success');
      } else {
        await apiFetch('/animal-control', { method: 'POST', body: JSON.stringify(body) });
        addToast('Case created', 'success');
      }
      setFormOpen(false);
      setEditingCase(null);
      await fetchCases();
    } catch (err: any) { addToast(err?.message || 'Operation failed', 'error'); } finally { setSubmitting(false); }
  };

  const handleDelete = async (ac: AnimalControlCase) => {
    if (!confirm(`Delete case ${ac.case_number}?`)) return;
    try {
      await apiFetch(`/animal-control/${ac.id}`, { method: 'DELETE' });
      addToast(`Case ${ac.case_number} deleted`, 'success');
      if (selectedCase?.id === ac.id) setSelectedCase(null);
      fetchCases();
    } catch (err: any) { addToast(err?.message || 'Delete failed', 'error'); }
  };

  const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  // ── Render ──
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PanelTitleBar icon={PawPrint} title="ANIMAL CONTROL">
        <span className="text-[9px] font-mono text-rmpg-400">{totalCount} TOTAL</span>
        <span className="toolbar-separator" />
        <button type="button" onClick={handleOpenNew} className="toolbar-btn">
          <Plus style={{ width: 11, height: 11 }} /> New Case
        </button>
      </PanelTitleBar>

      {/* Stats bar */}
      <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-2 px-3 py-2 border-b border-rmpg-700`} style={{ background: '#0a0a0a' }}>
        <StatsCard icon={PawPrint} label="Open" value={stats.open} accent="amber" />
        <StatsCard icon={Search} label="Investigating" value={stats.investigating} accent="blue" />
        <StatsCard icon={Calendar} label="Quarantine" value={stats.quarantine} accent="red" />
        <StatsCard icon={PawPrint} label="Resolved" value={stats.resolved} accent="green" />
      </div>

      {/* Filter / Search toolbar */}
      <div className={`flex ${isMobile ? 'flex-col gap-1.5' : 'items-center gap-2'} px-3 py-1.5 border-b border-rmpg-700`} style={{ background: '#0a0a0a' }}>
        <div className={`relative ${isMobile ? 'w-full' : 'flex-1 max-w-xs'}`}>
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            type="text"
            placeholder="Search animal, breed, owner, location, microchip..."
            aria-label="Search cases"
            className={`input-dark pl-7 w-full ${isMobile ? 'text-sm py-2.5' : 'text-xs'}`}
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            style={isMobile ? { minHeight: 44 } : undefined}
          />
        </div>
        <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-2'}`}>
          <select
            className={`select-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs'}`}
            value={filterType}
            onChange={e => { setFilterType(e.target.value); setPage(1); }}
            style={isMobile ? { minHeight: 44 } : undefined}
          >
            {CASE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select
            className={`select-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs'}`}
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
            style={isMobile ? { minHeight: 44 } : undefined}
          >
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-900/30 border-b border-red-700/50 text-red-400 text-xs flex items-center justify-between">
          <span>{error}</span>
          <IconButton onClick={() => setError(null)} aria-label="Dismiss error" className="text-red-400 hover:text-red-200"><X style={{ width: 12, height: 12 }} /></IconButton>
        </div>
      )}

      {/* Content: list + detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table / list */}
        <div className={`${selectedCase && !isMobile ? 'w-[55%]' : 'w-full'} overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent border-r border-rmpg-700`}>
          {loading && cases.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-rmpg-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading...
            </div>
          ) : cases.length === 0 ? (
            <EmptyState
              icon={PawPrint}
              title="No animal control cases found"
              description="Create a new case to get started."
              action={{ label: 'New Case', onClick: handleOpenNew }}
            />
          ) : (
            <>
              {/* Table header */}
              {!isMobile && (
                <div className="grid grid-cols-[100px_80px_90px_90px_90px_1fr_100px_80px_90px] gap-1 px-3 py-[3px] border-b border-rmpg-700 text-[9px] font-semibold text-rmpg-500 uppercase" style={{ background: '#111' }}>
                  <span>Case #</span>
                  <span>Date</span>
                  <span>Type</span>
                  <span>Animal</span>
                  <span>Breed</span>
                  <span>Owner</span>
                  <span>Location</span>
                  <span>Status</span>
                  <span>Officer</span>
                </div>
              )}
              {cases.map(ac => (
                isMobile ? (
                  /* Mobile card */
                  <div
                    key={ac.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowClick(ac)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(ac); } }}
                    className={`px-3 py-3 cursor-pointer border-b border-rmpg-800 transition-colors hover:bg-surface-raised ${selectedCase?.id === ac.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                    style={{ minHeight: 56 }}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] font-bold font-mono text-brand-400">{ac.case_number}</span>
                      <span className={`text-[8px] font-bold px-1.5 py-0 border rounded-sm ${STATUS_COLORS[ac.status] || STATUS_COLORS.open}`}>
                        {(ac.status || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-white font-medium">
                      <PawPrint className="w-3 h-3 inline mr-1 text-amber-400" />
                      {ac.animal_type}{ac.breed ? ` — ${ac.breed}` : ''}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-rmpg-400 mt-0.5">
                      {ac.owner_last_name && <span><User className="w-3 h-3 inline mr-0.5" />{ac.owner_last_name}, {ac.owner_first_name}</span>}
                      <span><MapPin className="w-3 h-3 inline mr-0.5" />{ac.location}</span>
                    </div>
                  </div>
                ) : (
                  /* Desktop table row */
                  <div
                    key={ac.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowClick(ac)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(ac); } }}
                    className={`grid grid-cols-[100px_80px_90px_90px_90px_1fr_100px_80px_90px] gap-1 px-3 py-[2px] cursor-pointer border-b border-rmpg-800 transition-colors hover:bg-surface-raised text-[11px] ${selectedCase?.id === ac.id ? 'bg-brand-900/20' : ''}`}
                  >
                    <span className="font-mono text-brand-400 truncate">{ac.case_number}</span>
                    <span className="text-rmpg-400 truncate">{safeDateStr(ac.created_at)}</span>
                    <span className="text-rmpg-300 truncate capitalize">{ac.case_type}</span>
                    <span className="text-white truncate">{ac.animal_type}</span>
                    <span className="text-rmpg-300 truncate">{ac.breed}</span>
                    <span className="text-rmpg-300 truncate">{ac.owner_last_name ? `${ac.owner_last_name}, ${ac.owner_first_name}` : '\u2014'}</span>
                    <span className="text-rmpg-400 truncate">{ac.location}</span>
                    <span>
                      <span className={`text-[8px] font-bold px-1.5 py-0 border rounded-sm ${STATUS_COLORS[ac.status] || STATUS_COLORS.open}`}>
                        {(ac.status || '').toUpperCase()}
                      </span>
                    </span>
                    <span className="text-rmpg-400 truncate">{ac.officer_name || '\u2014'}</span>
                  </div>
                )
              ))}
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className={`flex items-center justify-center gap-2 py-2 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400`}>
              <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px' }}>
                <ChevronLeft style={{ width: 10, height: 10 }} /> Prev
              </button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="toolbar-btn" style={{ fontSize: isMobile ? '12px' : '10px' }}>
                Next <ChevronRight style={{ width: 10, height: 10 }} />
              </button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedCase && !isMobile && (
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-white font-mono">{selectedCase.case_number}</h2>
                <span className="text-[10px] text-rmpg-400">Created {safeDateTimeStr(selectedCase.created_at)}</span>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => handleEdit(selectedCase)} className="toolbar-btn" style={{ fontSize: '10px' }}>Edit</button>
                {isAdmin && (
                  <button type="button" onClick={() => handleDelete(selectedCase)} className="toolbar-btn text-red-400 hover:text-red-300" style={{ fontSize: '10px' }}>
                    <X style={{ width: 10, height: 10 }} /> Delete
                  </button>
                )}
                <IconButton onClick={() => setSelectedCase(null)} className="toolbar-btn" aria-label="Close details">
                  <X style={{ width: 10, height: 10 }} />
                </IconButton>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              {/* Case info */}
              <div className="border border-rmpg-700 p-3" style={{ background: '#141414' }}>
                <h3 className="text-[10px] font-bold text-[#d4a017] uppercase mb-2">Case Info</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div><span className="text-rmpg-500">Type:</span> <span className="text-white capitalize">{selectedCase.case_type}</span></div>
                  <div><span className="text-rmpg-500">Status:</span> <span className={`font-bold px-1.5 py-0 border rounded-sm text-[8px] ${STATUS_COLORS[selectedCase.status] || ''}`}>{(selectedCase.status || '').toUpperCase()}</span></div>
                  <div><span className="text-rmpg-500">Location:</span> <span className="text-white">{selectedCase.location}</span></div>
                  <div><span className="text-rmpg-500">Officer:</span> <span className="text-white">{selectedCase.officer_name || '\u2014'}</span></div>
                </div>
                {selectedCase.description && <div className="mt-2 text-[11px] text-rmpg-300">{selectedCase.description}</div>}
              </div>

              {/* Animal info */}
              <div className="border border-rmpg-700 p-3" style={{ background: '#141414' }}>
                <h3 className="text-[10px] font-bold text-[#d4a017] uppercase mb-2">Animal Info</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div><span className="text-rmpg-500">Type:</span> <span className="text-white">{selectedCase.animal_type || '\u2014'}</span></div>
                  <div><span className="text-rmpg-500">Breed:</span> <span className="text-white">{selectedCase.breed || '\u2014'}</span></div>
                  <div><span className="text-rmpg-500">Name:</span> <span className="text-white">{selectedCase.animal_name || '\u2014'}</span></div>
                  <div><span className="text-rmpg-500">Color:</span> <span className="text-white">{selectedCase.animal_color || '\u2014'}</span></div>
                  <div><span className="text-rmpg-500">Sex:</span> <span className="text-white">{selectedCase.animal_sex || '\u2014'}</span></div>
                  <div><span className="text-rmpg-500">Weight:</span> <span className="text-white">{selectedCase.animal_weight || '\u2014'}</span></div>
                  <div><span className="text-rmpg-500">Microchip:</span> <span className="text-white font-mono">{selectedCase.microchip_id || '\u2014'}</span></div>
                  <div><span className="text-rmpg-500">Rabies Tag:</span> <span className="text-white font-mono">{selectedCase.rabies_tag || '\u2014'}</span></div>
                </div>
              </div>

              {/* Owner info */}
              <div className="border border-rmpg-700 p-3" style={{ background: '#141414' }}>
                <h3 className="text-[10px] font-bold text-[#d4a017] uppercase mb-2">Owner Info</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div><span className="text-rmpg-500">Name:</span> <span className="text-white">{selectedCase.owner_last_name ? `${selectedCase.owner_last_name}, ${selectedCase.owner_first_name}` : '\u2014'}</span></div>
                  <div><span className="text-rmpg-500">Phone:</span> <span className="text-white">{selectedCase.owner_phone || '\u2014'}</span></div>
                  <div className="col-span-2"><span className="text-rmpg-500">Address:</span> <span className="text-white">{selectedCase.owner_address || '\u2014'}</span></div>
                </div>
              </div>

              {/* Quarantine */}
              {(selectedCase.quarantine_start || selectedCase.quarantine_end) && (
                <div className="border border-red-700/50 p-3" style={{ background: '#1a0a0a' }}>
                  <h3 className="text-[10px] font-bold text-red-400 uppercase mb-2">Quarantine</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <div><span className="text-rmpg-500">Start:</span> <span className="text-white">{safeDateStr(selectedCase.quarantine_start)}</span></div>
                    <div><span className="text-rmpg-500">End:</span> <span className="text-white">{safeDateStr(selectedCase.quarantine_end)}</span></div>
                  </div>
                </div>
              )}

              {/* Notes */}
              {selectedCase.notes && (
                <div className="border border-rmpg-700 p-3" style={{ background: '#141414' }}>
                  <h3 className="text-[10px] font-bold text-[#d4a017] uppercase mb-2">Notes</h3>
                  <div className="text-[11px] text-rmpg-300 whitespace-pre-wrap">{selectedCase.notes}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── New / Edit modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => { setFormOpen(false); setEditingCase(null); }}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-rmpg-700 scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent"
            style={{ background: '#0e0e0e' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700" style={{ background: 'linear-gradient(180deg, #1a1a1a, #242424)' }}>
              <span className="text-[11px] font-bold text-[#d4a017] uppercase tracking-wider">
                {editingCase ? `Edit ${editingCase.case_number}` : 'New Animal Control Case'}
              </span>
              <IconButton onClick={() => { setFormOpen(false); setEditingCase(null); }} aria-label="Close form">
                <X style={{ width: 12, height: 12 }} />
              </IconButton>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {/* Section: Case Info */}
              <fieldset className="border border-rmpg-700 p-3" style={{ background: '#141414' }}>
                <legend className="text-[10px] font-bold text-[#d4a017] uppercase px-1">Case Info</legend>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Type *</label>
                    <select className="select-dark w-full text-xs" value={formData.case_type} onChange={e => update('case_type', e.target.value)}>
                      {CASE_TYPES.filter(t => t.value).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Location *</label>
                    <input className="input-dark w-full text-xs" value={formData.location} onChange={e => update('location', e.target.value)} placeholder="Incident location" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Description</label>
                    <textarea className="input-dark w-full text-xs" rows={2} value={formData.description} onChange={e => update('description', e.target.value)} placeholder="Brief description of incident" />
                  </div>
                </div>
              </fieldset>

              {/* Section: Animal Info */}
              <fieldset className="border border-rmpg-700 p-3" style={{ background: '#141414' }}>
                <legend className="text-[10px] font-bold text-[#d4a017] uppercase px-1">Animal Info</legend>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Animal Type</label>
                    <input className="input-dark w-full text-xs" value={formData.animal_type} onChange={e => update('animal_type', e.target.value)} placeholder="Dog, Cat, etc." />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Breed</label>
                    <input className="input-dark w-full text-xs" value={formData.breed} onChange={e => update('breed', e.target.value)} placeholder="Breed" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Name</label>
                    <input className="input-dark w-full text-xs" value={formData.animal_name} onChange={e => update('animal_name', e.target.value)} placeholder="Animal name" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Color</label>
                    <input className="input-dark w-full text-xs" value={formData.animal_color} onChange={e => update('animal_color', e.target.value)} placeholder="Color/markings" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Sex</label>
                    <select className="select-dark w-full text-xs" value={formData.animal_sex} onChange={e => update('animal_sex', e.target.value)}>
                      <option value="">—</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="male_neutered">Male (Neutered)</option>
                      <option value="female_spayed">Female (Spayed)</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Weight</label>
                    <input className="input-dark w-full text-xs" value={formData.animal_weight} onChange={e => update('animal_weight', e.target.value)} placeholder="lbs" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Microchip ID</label>
                    <input className="input-dark w-full text-xs font-mono" value={formData.microchip_id} onChange={e => update('microchip_id', e.target.value)} placeholder="Microchip #" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Rabies Tag</label>
                    <input className="input-dark w-full text-xs font-mono" value={formData.rabies_tag} onChange={e => update('rabies_tag', e.target.value)} placeholder="Rabies tag #" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Quarantine Start</label>
                    <input type="date" className="input-dark w-full text-xs" value={formData.quarantine_start} onChange={e => update('quarantine_start', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Quarantine End</label>
                    <input type="date" className="input-dark w-full text-xs" value={formData.quarantine_end} onChange={e => update('quarantine_end', e.target.value)} />
                  </div>
                </div>
              </fieldset>

              {/* Section: Owner Info */}
              <fieldset className="border border-rmpg-700 p-3" style={{ background: '#141414' }}>
                <legend className="text-[10px] font-bold text-[#d4a017] uppercase px-1">Owner Info</legend>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">First Name</label>
                    <input className="input-dark w-full text-xs" value={formData.owner_first_name} onChange={e => update('owner_first_name', e.target.value)} placeholder="First name" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Last Name</label>
                    <input className="input-dark w-full text-xs" value={formData.owner_last_name} onChange={e => update('owner_last_name', e.target.value)} placeholder="Last name" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Phone</label>
                    <input className="input-dark w-full text-xs" value={formData.owner_phone} onChange={e => update('owner_phone', e.target.value)} placeholder="Phone number" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 mb-0.5">Address</label>
                    <input className="input-dark w-full text-xs" value={formData.owner_address} onChange={e => update('owner_address', e.target.value)} placeholder="Owner address" />
                  </div>
                </div>
              </fieldset>

              {/* Section: Notes */}
              <fieldset className="border border-rmpg-700 p-3" style={{ background: '#141414' }}>
                <legend className="text-[10px] font-bold text-[#d4a017] uppercase px-1">Notes</legend>
                <textarea className="input-dark w-full text-xs mt-1" rows={3} value={formData.notes} onChange={e => update('notes', e.target.value)} placeholder="Additional notes..." />
              </fieldset>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setFormOpen(false); setEditingCase(null); }} className="toolbar-btn text-xs">Cancel</button>
                <button type="submit" disabled={submitting} className="toolbar-btn toolbar-btn-primary text-xs">
                  {submitting ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</> : <><Save style={{ width: 11, height: 11 }} /> {editingCase ? 'Update' : 'Create'}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
