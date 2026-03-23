// ============================================================
// RMPG Flex — Evidence / Property Room Page
// ============================================================
// Property room management with chain-of-custody workflow,
// storage tracking, disposition pipeline, and BWC footage view.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Package, Search, Plus, ChevronDown, MapPin, Clock, User,
  ArrowRightLeft, CheckCircle, AlertTriangle, X, Save, Loader2,
  Box, Warehouse, Tag, FileText, Archive, Video,
  PackageOpen, PackagePlus, RefreshCw, FlaskConical, Trash2,
  Play, Shield, Camera,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import VideoPlayer from '../components/VideoPlayer';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import type { BodyCamVideo } from '../types';

// ─── Constants ─────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  checked_in: 'bg-green-900/50 text-green-400 border-green-700/50',
  in_storage: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  checked_out: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  submitted_to_le: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  pending_disposition: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
  released: 'bg-teal-900/50 text-teal-400 border-teal-700/50',
  disposed: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const TYPE_LABELS: Record<string, string> = {
  weapon: 'Weapon', narcotics: 'Narcotics', currency: 'Currency', electronics: 'Electronics',
  documents: 'Documents', vehicle: 'Vehicle', clothing: 'Clothing', biological: 'Biological',
  other: 'Other',
};

const CHAIN_ACTIONS = [
  { value: 'check_in', label: 'Check In', icon: PackageOpen },
  { value: 'check_out', label: 'Check Out', icon: PackagePlus },
  { value: 'transfer', label: 'Transfer', icon: RefreshCw },
  { value: 'lab_submit', label: 'Submit to Lab/LE', icon: FlaskConical },
  { value: 'release', label: 'Release to Owner', icon: CheckCircle },
  { value: 'dispose', label: 'Dispose', icon: Trash2 },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'checked_in', label: 'Checked In' },
  { value: 'in_storage', label: 'In Storage' },
  { value: 'checked_out', label: 'Checked Out' },
  { value: 'submitted_to_le', label: 'To LE/Lab' },
  { value: 'pending_disposition', label: 'Pending' },
  { value: 'released', label: 'Released' },
  { value: 'disposed', label: 'Disposed' },
];

type DetailTab = 'info' | 'chain' | 'bwc';

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

// ─── Component ─────────────────────────────────────────
export default function EvidencePropertyPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();

  // Data
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Chain of custody modal
  const [chainModalOpen, setChainModalOpen] = useState(false);
  const [chainAction, setChainAction] = useState('check_in');
  const [chainLocation, setChainLocation] = useState('');
  const [chainNotes, setChainNotes] = useState('');
  const [chainSubmitting, setChainSubmitting] = useState(false);

  // Release request
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseTo, setReleaseTo] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [releaseSubmitting, setReleaseSubmitting] = useState(false);

  // New evidence modal
  const [newEvidenceOpen, setNewEvidenceOpen] = useState(false);
  const [newEvidence, setNewEvidence] = useState({
    description: '', evidence_type: 'other', category: '', storage_location: '',
    serial_number: '', brand: '', model: '', estimated_value: '',
    collected_date: '', notes: '', incident_id: '',
  });
  const [newEvidenceSubmitting, setNewEvidenceSubmitting] = useState(false);

  // Detail tab
  const [detailTab, setDetailTab] = useState<DetailTab>('info');

  // BWC footage
  const [bwcVideos, setBwcVideos] = useState<BodyCamVideo[]>([]);
  const [bwcLoading, setBwcLoading] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<BodyCamVideo | null>(null);

  // ─── Fetchers ──────────────────────────────────────
  const fetchItems = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams({
        page: String(page), per_page: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterType ? { type: filterType } : {}),
      });
      const res = await apiFetch<{ data: any[]; pagination: any }>(`/records/evidence?${params}`);
      setItems(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) { setFetchError(err?.message || 'Failed to load data'); } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus, filterType]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: any }>('/records/evidence/stats');
      setStats(res.data);
    } catch { /* silent */ }
  }, []);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: any[] }>('/records/evidence/locations');
      setLocations(res.data || []);
    } catch { /* silent */ }
  }, []);

  const fetchBwcVideos = useCallback(async (caseNumber: string) => {
    if (!caseNumber) { setBwcVideos([]); return; }
    setBwcLoading(true);
    try {
      const res = await apiFetch<BodyCamVideo[]>(`/personnel/bodycam-videos?case_number=${encodeURIComponent(caseNumber)}`);
      setBwcVideos(Array.isArray(res) ? res : []);
    } catch { setBwcVideos([]); } finally { setBwcLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchStats(); fetchLocations(); }, [fetchStats, fetchLocations]);
  useLiveSync('records', () => { fetchItems({ silent: true }); fetchStats(); });

  // When detail tab switches to BWC, fetch videos
  useEffect(() => {
    if (detailTab === 'bwc' && selected) {
      const caseNum = selected.evidence_number || selected.case_number || '';
      fetchBwcVideos(caseNum);
    }
  }, [detailTab, selected, fetchBwcVideos]);

  // ─── Handlers ──────────────────────────────────────
  const handleChainAction = async () => {
    if (!selected) return;
    setChainSubmitting(true);
    try {
      await apiFetch(`/records/evidence/${selected.id}/chain-action`, {
        method: 'POST',
        body: JSON.stringify({
          action: chainAction,
          to_location: chainLocation || undefined,
          notes: chainNotes || undefined,
        }),
      });
      addToast('Chain of custody action recorded', 'success');
      setChainModalOpen(false);
      setChainNotes('');
      fetchItems({ silent: true });
      const updated = await apiFetch<{ data: any }>(`/records/evidence/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) {
      addToast(err?.message || 'Failed to record action', 'error');
    } finally { setChainSubmitting(false); }
  };

  const handleCreateEvidence = async () => {
    if (!newEvidence.description || !newEvidence.evidence_type) {
      addToast('Description and type are required', 'error');
      return;
    }
    setNewEvidenceSubmitting(true);
    try {
      await apiFetch('/records/evidence', {
        method: 'POST',
        body: JSON.stringify({
          ...newEvidence,
          incident_id: newEvidence.incident_id || undefined,
          estimated_value: newEvidence.estimated_value || undefined,
        }),
      });
      addToast('Evidence item created', 'success');
      setNewEvidenceOpen(false);
      setNewEvidence({
        description: '', evidence_type: 'other', category: '', storage_location: '',
        serial_number: '', brand: '', model: '', estimated_value: '',
        collected_date: '', notes: '', incident_id: '',
      });
      fetchItems({ silent: true });
      fetchStats();
    } catch (err: any) {
      addToast(err?.message || 'Failed to create evidence', 'error');
    } finally { setNewEvidenceSubmitting(false); }
  };

  const handleRequestRelease = async () => {
    if (!selected) return;
    setReleaseSubmitting(true);
    try {
      await apiFetch(`/records/evidence/${selected.id}/request-release`, {
        method: 'POST', body: JSON.stringify({ release_to: releaseTo, reason: releaseReason }),
      });
      addToast('Release requested — awaiting supervisor approval', 'success');
      setReleaseOpen(false);
      setReleaseTo('');
      setReleaseReason('');
      fetchItems({ silent: true });
      const updated = await apiFetch<{ data: any }>(`/records/evidence/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err?.message || 'Failed', 'error'); }
    finally { setReleaseSubmitting(false); }
  };

  const handleApproveRelease = async (action: 'approve' | 'deny') => {
    if (!selected) return;
    setReleaseSubmitting(true);
    try {
      await apiFetch(`/records/evidence/${selected.id}/approve-release`, {
        method: 'PUT', body: JSON.stringify({ action }),
      });
      addToast(action === 'approve' ? 'Release approved' : 'Release denied', 'success');
      fetchItems({ silent: true });
      const updated = await apiFetch<{ data: any }>(`/records/evidence/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err?.message || 'Failed', 'error'); }
    finally { setReleaseSubmitting(false); }
  };

  let chainOfCustody: any[] = [];
  if (selected?.chain_of_custody) {
    try {
      chainOfCustody = typeof selected.chain_of_custody === 'string'
        ? JSON.parse(selected.chain_of_custody)
        : selected.chain_of_custody;
    } catch { chainOfCustody = []; }
  }

  const formatDate = (d?: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTime = (d?: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('rmpg_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  // ─── Render ────────────────────────────────────────
  // Set document title
  useEffect(() => { document.title = 'Evidence & Property \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setChainModalOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left Panel: Evidence List ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[420px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Evidence / Property Room" icon={Package}>
          <button type="button"
            onClick={() => setNewEvidenceOpen(true)}
            className="toolbar-btn toolbar-btn-primary print:hidden"
          >
            <Plus style={{ width: 11, height: 11 }} />
            <span className="hidden sm:inline">New Evidence</span>
          </button>
        </PanelTitleBar>

        {fetchError && (
          <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
            <span>⚠ {fetchError}</span>
            <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300">✕</button>
          </div>
        )}

        {/* Stats Row */}
        {stats && (
          <div className="flex gap-3 px-3 py-2 border-b border-rmpg-700 bg-surface-sunken">
            {[
              { label: 'TOTAL', value: stats.total_items || 0, color: 'text-white' },
              { label: 'IN STORAGE', value: stats.by_status?.in_storage || 0, color: 'text-blue-400' },
              { label: 'CHECKED OUT', value: stats.by_status?.checked_out || 0, color: 'text-amber-400' },
              { label: 'PENDING', value: stats.pending_disposition || 0, color: 'text-orange-400' },
            ].map(s => (
              <div key={s.label} className="panel-beveled px-3 py-1.5 text-center min-w-0">
                <div className="text-[9px] font-mono text-rmpg-500 tracking-wider">{s.label}</div>
                <div className={`text-sm font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-rmpg-700 bg-surface-base">
          <div className="flex gap-1.5">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
              <input
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                placeholder="Search evidence..." aria-label="Search evidence..."
                className="input-dark w-full pl-7 pr-2 py-1 text-xs min-h-[36px]"
              />
            </div>
            <select
              value={filterType}
              onChange={e => { setFilterType(e.target.value); setPage(1); }}
              className="select-dark text-[10px] px-1.5 py-1"
            >
              <option value="">All Types</option>
              {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {/* Status filter chips */}
          <div className="flex gap-1 flex-wrap">
            {STATUS_OPTIONS.map(opt => (
              <button type="button"
                key={opt.value}
                onClick={() => { setFilterStatus(opt.value); setPage(1); }}
                className={`text-[9px] px-2 py-0.5 transition-colors ${
                  filterStatus === opt.value
                    ? 'bg-brand-600/30 text-brand-300 border border-brand-600/50'
                    : 'toolbar-btn text-rmpg-500'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Item List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading...</span></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
              <Package className="w-8 h-8 mb-2 text-rmpg-600" />
              <p className="text-xs">No evidence items found</p>
              <button type="button" onClick={() => setNewEvidenceOpen(true)} className="toolbar-btn text-[10px] mt-3 text-brand-400">
                <Plus style={{ width: 10, height: 10 }} /> Create Evidence Item
              </button>
            </div>
          ) : (
            items.map(item => (
              <button type="button"
                key={item.id}
                onClick={() => { setSelected(item); setDetailTab('info'); }}
                className={`w-full text-left px-3 py-2.5 border-b border-rmpg-700/60 transition-colors ${
                  selected?.id === item.id
                    ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                    : 'hover:bg-rmpg-800/30 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold text-white truncate">
                    {item.evidence_number || `EV-${item.id}`}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 border font-semibold whitespace-nowrap ${STATUS_COLORS[item.status] || STATUS_COLORS.in_storage}`}>
                    {(item.status || 'unknown').replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{item.description || 'No description'}</div>
                <div className="flex items-center gap-3 mt-1 text-[9px] text-rmpg-500">
                  <span className="flex items-center gap-1">
                    <Tag style={{ width: 9, height: 9 }} />
                    {TYPE_LABELS[item.type] || item.type || item.evidence_type}
                  </span>
                  {item.storage_location && (
                    <span className="flex items-center gap-1">
                      <Warehouse style={{ width: 9, height: 9 }} />
                      {item.storage_location}
                    </span>
                  )}
                  {item.collected_date && (
                    <span className="flex items-center gap-1">
                      <Clock style={{ width: 9, height: 9 }} />
                      {formatDate(item.collected_date)}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-base">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-[10px] text-rmpg-400 disabled:opacity-30 hover:text-white transition-colors">
              ← Prev
            </button>
            <span className="text-[9px] font-mono text-rmpg-500">
              Page {page} / {totalPages} &bull; {totalCount} items
            </span>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-[10px] text-rmpg-400 disabled:opacity-30 hover:text-white transition-colors">
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Right Panel: Detail ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={selected.evidence_number || `Evidence #${selected.id}`} icon={Box}>
              <button type="button"
                onClick={() => { setChainAction('check_in'); setChainLocation(''); setChainNotes(''); setChainModalOpen(true); }}
                className="toolbar-btn toolbar-btn-primary print:hidden"
              >
                <ArrowRightLeft style={{ width: 11, height: 11 }} />
                <span className="hidden sm:inline">Chain Action</span>
              </button>
            </PanelTitleBar>

            {/* Tabs */}
            <div className="flex border-b border-rmpg-700 bg-surface-raised">
              {([
                { id: 'info' as DetailTab, label: 'Details', icon: FileText },
                { id: 'chain' as DetailTab, label: 'Chain of Custody', icon: ArrowRightLeft },
                { id: 'bwc' as DetailTab, label: 'BWC Footage', icon: Camera },
              ]).map(tab => {
                const Icon = tab.icon;
                return (
                  <button type="button"
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      detailTab === tab.id
                        ? 'text-white border-b-2 border-brand-500 bg-brand-900/10'
                        : 'text-rmpg-500 hover:text-rmpg-300'
                    }`}
                  >
                    <Icon style={{ width: 11, height: 11 }} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* ── Details Tab ── */}
              {detailTab === 'info' && (
                <div className="space-y-4">
                  {/* Status + Type badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-1 border font-bold ${STATUS_COLORS[selected.status] || ''}`}>
                      {(selected.status || '').replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span className="text-[10px] px-2 py-1 border bg-rmpg-700/50 text-rmpg-300 border-rmpg-700/50 font-semibold">
                      {TYPE_LABELS[selected.type] || TYPE_LABELS[selected.evidence_type] || selected.type || selected.evidence_type}
                    </span>
                    {selected.category && (
                      <span className="text-[10px] px-2 py-1 border bg-rmpg-700/30 text-rmpg-400 border-rmpg-700/30">
                        {selected.category}
                      </span>
                    )}
                  </div>

                  {/* Item Info */}
                  <div className="panel-inset p-3">
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2 tracking-wider">Item Information</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                      {[
                        ['Description', selected.description],
                        ['Evidence #', selected.evidence_number || `EV-${selected.id}`],
                        ['Incident #', selected.incident_number || (selected.incident_id ? `INC-${selected.incident_id}` : '—')],
                        ['Category', selected.category || '—'],
                        ['Serial Number', selected.serial_number || '—'],
                        ['Make / Model', [selected.make || selected.brand, selected.model].filter(Boolean).join(' ') || '—'],
                        ['Quantity', selected.quantity || '1'],
                        ['Estimated Value', selected.estimated_value && !isNaN(Number(selected.estimated_value)) ? `$${Number(selected.estimated_value).toFixed(2)}` : '—'],
                      ].map(([label, value]) => (
                        <div key={label as string}>
                          <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                          <div className="text-xs text-rmpg-100 mt-0.5">{value || '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Collection & Storage */}
                  <div className="panel-inset p-3">
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2 tracking-wider">Collection & Storage</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                      {[
                        ['Collected By', selected.collected_by_name || (selected.collected_by ? `Officer #${selected.collected_by}` : '—')],
                        ['Collection Date', formatDate(selected.collected_date)],
                        ['Storage Location', selected.storage_location || '—'],
                        ['Condition', selected.condition || '—'],
                        ['Packaging', selected.packaging_type || '—'],
                        ['Dimensions', selected.dimensions || '—'],
                      ].map(([label, value]) => (
                        <div key={label as string}>
                          <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                          <div className="text-xs text-rmpg-100 mt-0.5">{value || '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  {selected.notes && (
                    <div className="panel-beveled p-3">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1 tracking-wider">Notes</div>
                      <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selected.notes}</div>
                    </div>
                  )}

                  {/* Release Authorization */}
                  <div className="panel-inset p-3">
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2 tracking-wider">Release Authorization</div>
                    {selected.release_status === 'release_requested' ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-2 py-0.5 border bg-amber-900/50 text-amber-400 border-amber-700/50 font-bold">RELEASE REQUESTED</span>
                          {selected.release_to && <span className="text-[10px] text-rmpg-300">To: {selected.release_to}</span>}
                        </div>
                        {selected.release_reason && <div className="text-[10px] text-rmpg-400">Reason: {selected.release_reason}</div>}
                        <div className="flex gap-1">
                          <button type="button" onClick={() => handleApproveRelease('approve')} disabled={releaseSubmitting}
                            className="toolbar-btn text-green-400 border-green-700/50 hover:bg-green-900/30">
                            <CheckCircle style={{ width: 11, height: 11 }} /> Approve Release
                          </button>
                          <button type="button" onClick={() => handleApproveRelease('deny')} disabled={releaseSubmitting}
                            className="toolbar-btn text-red-400 border-red-700/50 hover:bg-red-900/30">
                            <X style={{ width: 11, height: 11 }} /> Deny
                          </button>
                        </div>
                      </div>
                    ) : selected.release_status === 'released' ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 border bg-green-900/50 text-green-400 border-green-700/50 font-bold">RELEASED</span>
                        {selected.release_to && <span className="text-[10px] text-rmpg-300">To: {selected.release_to}</span>}
                      </div>
                    ) : selected.status !== 'released' && selected.status !== 'disposed' ? (
                      <div>
                        {!releaseOpen ? (
                          <button type="button" onClick={() => setReleaseOpen(true)} className="toolbar-btn text-[10px]">
                            <PackageOpen style={{ width: 10, height: 10 }} /> Request Release
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <input value={releaseTo} onChange={e => setReleaseTo(e.target.value)} placeholder="Release to (name/entity)..."
                              className="input-dark w-full min-h-[36px]" />
                            <textarea value={releaseReason} onChange={e => setReleaseReason(e.target.value)} placeholder="Reason for release..."
                              rows={2} className="textarea-dark w-full" />
                            <div className="flex gap-1">
                              <button type="button" onClick={handleRequestRelease} disabled={releaseSubmitting || !releaseReason.trim()} className="toolbar-btn toolbar-btn-primary print:hidden">
                                {releaseSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle style={{ width: 11, height: 11 }} />}
                                Submit Request
                              </button>
                              <button type="button" onClick={() => setReleaseOpen(false)} className="toolbar-btn">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] text-rmpg-500">Item already {selected.status.replace(/_/g, ' ')}</div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Chain of Custody Tab ── */}
              {detailTab === 'chain' && (
                <div className="space-y-2">
                  {chainOfCustody.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                      <ArrowRightLeft className="w-8 h-8 mb-2 text-rmpg-600" />
                      <p className="text-xs">No chain of custody entries yet</p>
                      <button type="button"
                        onClick={() => { setChainAction('check_in'); setChainLocation(''); setChainNotes(''); setChainModalOpen(true); }}
                        className="toolbar-btn text-[10px] mt-3 text-brand-400"
                      >
                        <Plus style={{ width: 10, height: 10 }} /> Record First Action
                      </button>
                    </div>
                  ) : (
                    chainOfCustody.slice().reverse().map((entry: any, idx: number) => {
                      const actionDef = CHAIN_ACTIONS.find(a => a.value === entry.action);
                      const ActionIcon = actionDef?.icon || ArrowRightLeft;
                      return (
                        <div key={idx} className="panel-beveled p-3 flex gap-3">
                          <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-surface-sunken border border-rmpg-700 rounded-sm">
                            <ActionIcon style={{ width: 14, height: 14 }} className="text-brand-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-white">
                                {actionDef?.label || entry.action}
                              </span>
                              <span className="text-[9px] font-mono text-rmpg-500 flex-shrink-0">
                                {entry.timestamp ? formatDateTime(entry.timestamp) : ''}
                              </span>
                            </div>
                            <div className="text-[10px] text-rmpg-400 mt-0.5">
                              <User style={{ width: 9, height: 9, display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
                              {entry.user_name || `User #${entry.user_id}`}
                            </div>
                            {(entry.from_location || entry.to_location) && (
                              <div className="text-[10px] text-rmpg-400 flex items-center gap-1 mt-0.5">
                                <MapPin style={{ width: 9, height: 9 }} />
                                {entry.from_location && <span>{entry.from_location}</span>}
                                {entry.from_location && entry.to_location && <span>→</span>}
                                {entry.to_location && <span>{entry.to_location}</span>}
                              </div>
                            )}
                            {entry.notes && <div className="text-[10px] text-rmpg-300 mt-1 italic">{entry.notes}</div>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* ── BWC Footage Tab ── */}
              {detailTab === 'bwc' && (
                <div>
                  {bwcLoading ? (
                    <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading...</span></div>
                  ) : bwcVideos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                      <Camera className="w-8 h-8 mb-2 text-rmpg-600" />
                      <p className="text-xs">No body camera footage linked</p>
                      <p className="text-[10px] text-rmpg-600 mt-1">
                        Videos tagged with case # "{selected.evidence_number || selected.case_number || '—'}" will appear here
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider mb-2">
                        {bwcVideos.length} video{bwcVideos.length !== 1 ? 's' : ''} linked to {selected.evidence_number || 'this item'}
                      </div>
                      {bwcVideos.map(vid => (
                        <div key={vid.id} className="panel-beveled p-3 flex items-center gap-3">
                          <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-surface-sunken border border-rmpg-700 rounded-sm">
                            <Video style={{ width: 16, height: 16 }} className="text-brand-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-white truncate">{vid.title}</div>
                            <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                              <span className="flex items-center gap-1">
                                <Shield style={{ width: 9, height: 9 }} />
                                {vid.officer_name || '—'}
                              </span>
                              <span className="flex items-center gap-1">
                                <Camera style={{ width: 9, height: 9 }} />
                                {vid.camera_serial || '—'}
                              </span>
                              <span>{formatDuration(vid.duration_seconds)}</span>
                              <span>{formatSize(vid.file_size)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[9px] text-rmpg-500">
                              <span>{formatDateTime(vid.recorded_at)}</span>
                              <span className={`px-1 py-0 border text-[8px] font-bold ${
                                vid.classification === 'evidence' ? 'bg-amber-900/40 text-amber-400 border-amber-700/50' :
                                vid.classification === 'flagged' ? 'bg-red-900/40 text-red-400 border-red-700/50' :
                                vid.classification === 'restricted' ? 'bg-purple-900/40 text-purple-400 border-purple-700/50' :
                                'bg-rmpg-700/40 text-rmpg-400 border-rmpg-600/50'
                              }`}>
                                {vid.classification.toUpperCase()}
                              </span>
                            </div>
                          </div>
                          <button type="button"
                            onClick={() => setPlayingVideo(vid)}
                            className="toolbar-btn toolbar-btn-primary px-2.5 py-1.5 flex items-center gap-1"
                          >
                            <Play style={{ width: 11, height: 11 }} />
                            <span className="text-[10px]">Play</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Package className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">Select an evidence item to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Chain of Custody Action Modal ── */}
      {chainModalOpen && selected && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" onClick={() => setChainModalOpen(false)}>
          <div className="bg-surface-base border border-rmpg-700 rounded-sm shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-brand-400" />
                <h2 className="text-sm font-bold text-rmpg-100">Record Chain of Custody Action</h2>
              </div>
              <button type="button" onClick={() => setChainModalOpen(false)} className="toolbar-btn p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Action</label>
                <select
                  value={chainAction}
                  onChange={e => setChainAction(e.target.value)}
                  className="select-dark w-full"
                >
                  {CHAIN_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>

              {(chainAction === 'check_in' || chainAction === 'transfer') && (
                <div>
                  <label className="field-label">Destination Location</label>
                  <select
                    value={chainLocation}
                    onChange={e => setChainLocation(e.target.value)}
                    className="select-dark w-full"
                  >
                    <option value="">Select location...</option>
                    {locations.map((l: any) => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="field-label">Notes</label>
                <textarea
                  value={chainNotes}
                  onChange={e => setChainNotes(e.target.value)}
                  rows={3}
                  className="textarea-dark w-full"
                  placeholder="Optional notes..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setChainModalOpen(false)} className="toolbar-btn text-xs px-4 py-1.5">Cancel</button>
                <button type="button" onClick={handleChainAction} disabled={chainSubmitting} className="toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5">
                  {chainSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Record Action
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── New Evidence Modal ── */}
      {newEvidenceOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" onClick={() => setNewEvidenceOpen(false)}>
          <div className="bg-surface-base border border-rmpg-700 rounded-sm shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-brand-400" />
                <h2 className="text-sm font-bold text-rmpg-100">New Evidence Item</h2>
              </div>
              <button type="button" onClick={() => setNewEvidenceOpen(false)} className="toolbar-btn p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Description <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={newEvidence.description}
                  onChange={e => setNewEvidence(p => ({ ...p, description: e.target.value }))}
                  className="input-dark w-full min-h-[36px]"
                  placeholder="Describe the evidence item..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Type <span className="text-red-400">*</span></label>
                  <select
                    value={newEvidence.evidence_type}
                    onChange={e => setNewEvidence(p => ({ ...p, evidence_type: e.target.value }))}
                    className="select-dark w-full"
                  >
                    {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Category</label>
                  <input
                    type="text"
                    value={newEvidence.category}
                    onChange={e => setNewEvidence(p => ({ ...p, category: e.target.value }))}
                    className="input-dark w-full min-h-[36px]"
                    placeholder="e.g. Firearm, Drug, etc."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Incident #</label>
                  <input
                    type="text"
                    value={newEvidence.incident_id}
                    onChange={e => setNewEvidence(p => ({ ...p, incident_id: e.target.value }))}
                    className="input-dark w-full min-h-[36px]"
                    placeholder="Optional incident ID"
                  />
                </div>
                <div>
                  <label className="field-label">Storage Location</label>
                  <select
                    value={newEvidence.storage_location}
                    onChange={e => setNewEvidence(p => ({ ...p, storage_location: e.target.value }))}
                    className="select-dark w-full"
                  >
                    <option value="">Select location...</option>
                    {locations.map((l: any) => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="field-label">Serial #</label>
                  <input
                    type="text"
                    value={newEvidence.serial_number}
                    onChange={e => setNewEvidence(p => ({ ...p, serial_number: e.target.value }))}
                    className="input-dark w-full min-h-[36px]"
                  />
                </div>
                <div>
                  <label className="field-label">Brand</label>
                  <input
                    type="text"
                    value={newEvidence.brand}
                    onChange={e => setNewEvidence(p => ({ ...p, brand: e.target.value }))}
                    className="input-dark w-full min-h-[36px]"
                  />
                </div>
                <div>
                  <label className="field-label">Model</label>
                  <input
                    type="text"
                    value={newEvidence.model}
                    onChange={e => setNewEvidence(p => ({ ...p, model: e.target.value }))}
                    className="input-dark w-full min-h-[36px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Estimated Value</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newEvidence.estimated_value}
                    onChange={e => setNewEvidence(p => ({ ...p, estimated_value: e.target.value }))}
                    className="input-dark w-full min-h-[36px]"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="field-label">Collected Date</label>
                  <input
                    type="datetime-local"
                    value={newEvidence.collected_date}
                    onChange={e => setNewEvidence(p => ({ ...p, collected_date: e.target.value }))}
                    className="input-dark w-full min-h-[36px]"
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Notes</label>
                <textarea
                  value={newEvidence.notes}
                  onChange={e => setNewEvidence(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  className="textarea-dark w-full"
                  placeholder="Additional notes..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setNewEvidenceOpen(false)} className="toolbar-btn text-xs px-4 py-1.5">Cancel</button>
                <button type="button"
                  onClick={handleCreateEvidence}
                  disabled={newEvidenceSubmitting || !newEvidence.description || !newEvidence.evidence_type}
                  className="toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5"
                >
                  {newEvidenceSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Plus style={{ width: 11, height: 11 }} />}
                  Create Evidence
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Video Player Modal ── */}
      <VideoPlayer
        isOpen={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        video={playingVideo}
        apiBase={window.location.origin + '/api'}
        getAuthHeaders={getAuthHeaders}
      />
    </div>
  );
}
