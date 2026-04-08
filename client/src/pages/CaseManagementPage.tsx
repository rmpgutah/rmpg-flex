// ============================================================
// RMPG Flex — Case Management Page
// ============================================================
// Investigative case tracking with solvability scoring,
// investigator assignment, case notes, and linked records.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Search, Plus, ChevronDown, User, Clock, FileText,
  X, Save, Loader2, AlertTriangle, Target, MessageSquare,
  ArrowRight, CheckCircle, Pause, Hash, FolderOpen, ShieldCheck, RotateCcw, Send, Link, ExternalLink,
} from 'lucide-react';
import type { Case, CaseNote, CaseFull, CaseStatus, CaseType, CasePriority } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ExportButton from '../components/ExportButton';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { humanizeCaseType, humanizeSolvabilityFactor } from '../utils/statusLabels';

const STATUS_OPTIONS: { value: CaseStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-gray-900/50 text-gray-400 border-gray-700/50' },
  { value: 'assigned', label: 'Assigned', color: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50' },
  { value: 'active', label: 'Active', color: 'bg-green-900/50 text-green-400 border-green-700/50' },
  { value: 'suspended', label: 'Suspended', color: 'bg-amber-900/50 text-amber-400 border-amber-700/50' },
  { value: 'under_review', label: 'Under Review', color: 'bg-purple-900/50 text-purple-400 border-purple-700/50' },
  { value: 'closed_cleared', label: 'Closed (Cleared)', color: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50' },
  { value: 'closed_unfounded', label: 'Closed (Unfounded)', color: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50' },
  { value: 'closed_exception', label: 'Closed (Exception)', color: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50' },
];

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  approved: 'bg-green-900/50 text-green-400 border-green-700/50',
  returned: 'bg-red-900/50 text-red-400 border-red-700/50',
};

const TYPE_OPTIONS: { value: CaseType; label: string }[] = [
  { value: 'general', label: 'General' }, { value: 'theft', label: 'Theft' },
  { value: 'assault', label: 'Assault' }, { value: 'fraud', label: 'Fraud' },
  { value: 'narcotics', label: 'Narcotics' }, { value: 'missing_person', label: 'Missing Person' },
  { value: 'other', label: 'Other' },
];

const PRIORITY_OPTIONS: { value: CasePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-rmpg-400' },
  { value: 'normal', label: 'Normal', color: 'text-gray-400' },
  { value: 'high', label: 'High', color: 'text-amber-400' },
  { value: 'critical', label: 'Critical', color: 'text-red-400' },
];

const SOLVABILITY_FACTORS = [
  { key: 'witness_available', label: 'Witness Available', weight: 15 },
  { key: 'physical_evidence', label: 'Physical Evidence', weight: 20 },
  { key: 'suspect_named', label: 'Suspect Named', weight: 25 },
  { key: 'suspect_described', label: 'Suspect Described', weight: 10 },
  { key: 'suspect_vehicle', label: 'Suspect Vehicle Known', weight: 10 },
  { key: 'video_available', label: 'Video Available', weight: 10 },
  { key: 'traceable_property', label: 'Traceable Property', weight: 5 },
  { key: 'significant_modus', label: 'Significant MO', weight: 5 },
];

const EMPTY_FORM = {
  title: '', case_type: 'general' as CaseType, priority: 'normal' as CasePriority,
  summary: '', lead_investigator_id: '',
};

type DetailTab = 'overview' | 'calls' | 'incidents' | 'persons' | 'vehicles' | 'properties' | 'evidence' | 'warrants' | 'citations' | 'timeline' | 'notes' | 'solvability';

const DETAIL_TABS: { id: DetailTab; label: string; countKey?: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'calls', label: 'Calls', countKey: 'calls' },
  { id: 'incidents', label: 'Incidents', countKey: 'incidents' },
  { id: 'persons', label: 'Persons', countKey: 'persons' },
  { id: 'vehicles', label: 'Vehicles', countKey: 'vehicles' },
  { id: 'properties', label: 'Properties', countKey: 'properties' },
  { id: 'evidence', label: 'Evidence', countKey: 'evidence' },
  { id: 'warrants', label: 'Warrants', countKey: 'warrants' },
  { id: 'citations', label: 'Citations', countKey: 'citations' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'notes', label: 'Notes', countKey: 'notes' },
  { id: 'solvability', label: 'Solvability' },
];

// ── Reusable LinkedEntityPanel for each entity tab ──
function LinkedEntityPanel({
  items, columns, entityType, caseId, onRefresh, searchEndpoint, searchFields, onNavigate,
}: {
  items: any[];
  columns: { key: string; label: string; render?: (val: any, row: any) => React.ReactNode }[];
  entityType: string;
  caseId: number;
  onRefresh: () => void;
  searchEndpoint: string;
  searchFields: string[];
  onNavigate?: (item: any) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const { addToast } = useToast();

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await apiFetch<any>(`${searchEndpoint}?search=${encodeURIComponent(searchQuery)}&limit=20`);
      setSearchResults(Array.isArray(data) ? data : (data?.data || data?.results || []));
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const handleLink = async (entityId: number) => {
    // Map entity type plural → singular for the POST body key
    const singularMap: Record<string, string> = {
      calls: 'call', incidents: 'incident', persons: 'person', vehicles: 'vehicle',
      properties: 'property', evidence: 'evidence', warrants: 'warrant', citations: 'citation',
    };
    const singular = singularMap[entityType] || entityType.replace(/s$/, '');
    try {
      await apiFetch(`/cases/${caseId}/${entityType}`, { method: 'POST', body: JSON.stringify({ [`${singular}_id`]: entityId }) });
      addToast(`${entityType.slice(0, -1)} linked to case`, 'success');
      setModalOpen(false);
      setSearchQuery('');
      setSearchResults([]);
      onRefresh();
    } catch (err: any) { addToast(err.message || 'Link failed', 'error'); }
  };

  const handleUnlink = async (entityId: number) => {
    try {
      await apiFetch(`/cases/${caseId}/${entityType}/${entityId}`, { method: 'DELETE' });
      addToast(`${entityType.slice(0, -1)} unlinked from case`, 'success');
      onRefresh();
    } catch (err: any) { addToast(err.message || 'Unlink failed', 'error'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-rmpg-500 uppercase">{entityType} ({items.length})</div>
        <button type="button" onClick={() => setModalOpen(true)} className="toolbar-btn text-[10px]">
          <Link style={{ width: 10, height: 10 }} /> Link {entityType.slice(0, -1)}
        </button>
      </div>

      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-rmpg-700">
                {columns.map(col => (
                  <th key={col.key} className="text-left text-[9px] font-mono text-rmpg-500 uppercase px-2 py-1.5">{col.label}</th>
                ))}
                <th className="text-right text-[9px] font-mono text-rmpg-500 uppercase px-2 py-1.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, idx: number) => (
                <tr key={item.id || idx} className={`border-b border-rmpg-800 hover:bg-rmpg-800/30 transition-colors ${onNavigate ? 'cursor-pointer' : ''}`} onClick={() => onNavigate?.(item)}>
                  {columns.map(col => (
                    <td key={col.key} className="px-2 py-1.5 text-rmpg-300">
                      {col.render ? col.render(item[col.key], item) : (item[col.key] ?? '—')}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right flex items-center justify-end gap-2">
                    {onNavigate && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); onNavigate(item); }} className="text-brand-300 hover:text-brand-200 text-[9px] font-mono uppercase flex items-center gap-0.5">
                        <ExternalLink style={{ width: 9, height: 9 }} /> View
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleUnlink(item.id); }} className="text-red-400 hover:text-red-300 text-[9px] font-mono uppercase">
                      Unlink
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 text-rmpg-500 text-xs">No {entityType} linked to this case</div>
      )}

      {/* Link Search Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title={`Link ${entityType.slice(0, -1).replace(/^./, c => c.toUpperCase())}`} icon={Link}>
              <button type="button" onClick={() => { setModalOpen(false); setSearchResults([]); setSearchQuery(''); }} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder={`Search ${entityType}...`} aria-label={`Search ${entityType}`}
                  className="flex-1 px-2 py-1.5 w-full text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                <button type="button" onClick={handleSearch} disabled={searching} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {searching ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Search style={{ width: 11, height: 11 }} />}
                  Search
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent space-y-1">
                {searchResults.map((item: any) => (
                  <button type="button" key={item.id} onClick={() => handleLink(item.id)}
                    className="w-full text-left px-3 py-2 border border-rmpg-700 hover:bg-rmpg-800/40 transition-colors">
                    <div className="text-[11px] font-bold text-white">
                      {searchFields.map(f => item[f]).filter(Boolean).join(' — ')}
                    </div>
                    <div className="text-[9px] text-rmpg-500">ID: {item.id}</div>
                  </button>
                ))}
                {searchResults.length === 0 && searchQuery && !searching && (
                  <div className="text-[10px] text-rmpg-500 text-center py-4">No results found</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feature 29: Solvability Score Card (server-side analysis) ──
function SolvabilityScoreCard({ caseId }: { caseId: string | number }) {
  const [data, setData] = useState<{ score: number; rating: string; factors: string[]; evidence_count: number; witness_count: number; suspect_identified: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>(`/records/cases/${caseId}/solvability`)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [caseId]);

  if (loading) return <div className="flex items-center gap-2 text-[10px] text-rmpg-500 p-3"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Analyzing solvability...</div>;
  if (!data) return null;

  const ratingColor = data.rating === 'high' ? '#22c55e' : data.rating === 'medium' ? '#f59e0b' : '#ef4444';

  return (
    <div className="panel-beveled p-4">
      <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-3">Server Analysis</div>
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#141414" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={ratingColor} strokeWidth="3" strokeDasharray={`${data.score}, 100`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold" style={{ color: ratingColor }}>{data.score}</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-xs font-bold uppercase mb-1" style={{ color: ratingColor }}>{data.rating} solvability</div>
          <div className="space-y-0.5">
            {data.factors.map((f, i) => (
              <div key={i} className="text-[9px] text-rmpg-300 flex items-center gap-1">
                <CheckCircle className="w-2.5 h-2.5 text-green-400 flex-shrink-0" /> {f}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Feature 40: Linked Incidents Relationship Graph ──
function LinkedIncidentsGraph({ caseId }: { caseId: string | number }) {
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>(`/cases/${caseId}`)
      .then(data => {
        const related = [
          ...(data?.linked_incidents || []).map((i: any) => ({ ...i, rel_type: 'incident' })),
          ...(data?.linked_cases || []).map((c: any) => ({ ...c, rel_type: 'case' })),
          ...(data?.linked_warrants || []).map((w: any) => ({ ...w, rel_type: 'warrant' })),
          ...(data?.linked_persons || []).map((p: any) => ({ ...p, rel_type: 'person' })),
        ];
        setLinks(related);
      })
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }, [caseId]);

  if (loading) return <div className="flex items-center gap-2 text-[10px] text-rmpg-500 p-3"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Loading relationships...</div>;
  if (links.length === 0) return null;

  const typeColors: Record<string, string> = {
    incident: '#888888',
    case: '#8b5cf6',
    warrant: '#ef4444',
    person: '#22c55e',
  };

  const typeIcons: Record<string, string> = {
    incident: 'INC',
    case: 'CASE',
    warrant: 'WAR',
    person: 'PER',
  };

  return (
    <div className="panel-beveled p-4">
      <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-3">Linked Records ({links.length})</div>
      {/* Visual relationship display */}
      <div className="flex flex-wrap gap-2">
        {/* Center node = current case */}
        <div className="flex items-center gap-1 px-2 py-1 bg-brand-900/40 border border-brand-600/50 text-brand-300 text-[10px] font-bold">
          <Target className="w-3 h-3" /> THIS CASE
        </div>
        {links.map((link: any, idx: number) => {
          const color = typeColors[link.rel_type] || '#666666';
          return (
            <div key={idx} className="flex items-center gap-1">
              <ArrowRight className="w-3 h-3 text-rmpg-600" />
              <div
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold border"
                style={{ background: `${color}15`, borderColor: `${color}50`, color }}
              >
                <span className="text-[8px] font-mono opacity-70">{typeIcons[link.rel_type]}</span>
                {link.incident_number || link.case_number || link.warrant_number || `${link.first_name || ''} ${link.last_name || ''}`.trim() || `#${link.id}`}
              </div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex gap-3 mt-2 text-[8px] text-rmpg-500">
        {Object.entries(typeColors).map(([type, color]) => {
          const count = links.filter(l => l.rel_type === type).length;
          if (count === 0) return null;
          return (
            <div key={type} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              {type} ({count})
            </div>
          );
        })}
      </div>
    </div>
  );
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
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

export default function CaseManagementPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin'; // Admin God Mode — unrestricted access

  const [cases, setCases] = useState<Case[]>([]);
  const [selected, setSelected] = useState<Case | null>(null);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  // Detail tab
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [newNote, setNewNote] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  // Full case data for entity tabs
  const [caseFull, setCaseFull] = useState<CaseFull | null>(null);

  // Solvability
  const [solvFactors, setSolvFactors] = useState<Record<string, boolean>>({});
  const [solvSubmitting, setSolvSubmitting] = useState(false);

  // Status change
  const [statusChanging, setStatusChanging] = useState(false);

  // Review workflow
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(false);

  // Link person
  const [linkPersonOpen, setLinkPersonOpen] = useState(false);
  const [personSearchQuery, setPersonSearchQuery] = useState('');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [personSearching, setPersonSearching] = useState(false);
  const [linkedPersons, setLinkedPersons] = useState<any[]>([]);

  const fetchCases = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterType ? { case_type: filterType } : {}),
        ...(filterPriority ? { priority: filterPriority } : {}),
      });
      const res = await apiFetch<{ data: Case[]; pagination: any }>(`/cases?${params}`);
      setCases(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) { setFetchError(err?.message || 'Failed to load data'); } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus, filterType, filterPriority]);

  const fetchStats = useCallback(async () => {
    try { const res = await apiFetch<{ data: any }>('/cases/stats'); setStats(res.data); } catch (e) { console.warn('[Cases] fetch stats failed:', e); }
  }, []);

  const fetchNotes = useCallback(async (caseId: number) => {
    try { const res = await apiFetch<{ data: CaseNote[] }>(`/cases/${caseId}/notes`); setNotes(res.data || []); } catch (e) { console.warn('[Cases] fetch notes failed:', e); }
  }, []);

  const fetchFullCase = useCallback(async (caseId: number) => {
    try {
      const data = await apiFetch<any>(`/cases/${caseId}/full`);
      setCaseFull(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchCases(); }, [fetchCases]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    let cancelled = false;
    apiFetch<any>('/personnel').then(r => { if (!cancelled) setUsers(Array.isArray(r) ? r : (r?.data || [])); }).catch((err) => { console.warn('[CaseManagementPage] fetch personnel failed:', err); });
    return () => { cancelled = true; };
  }, []);
  useLiveSync('records', () => { fetchCases({ silent: true }); fetchStats(); });

  useEffect(() => {
    if (selected) {
      fetchNotes(selected.id);
      fetchFullCase(selected.id);
      let factors: Record<string, any> = {};
      try {
        factors = selected.solvability_factors
          ? (typeof selected.solvability_factors === 'string' ? JSON.parse(selected.solvability_factors) : selected.solvability_factors)
          : {};
      } catch { /* malformed JSON in DB — use empty */ }
      setSolvFactors(factors);
    }
  }, [selected, fetchNotes, fetchFullCase]);

  const handleCreate = async () => {
    if (!formData.title.trim()) { addToast('Title is required', 'error'); return; }
    setSubmitting(true);
    try {
      await apiFetch('/cases', { method: 'POST', body: JSON.stringify(formData) });
      addToast('Case created', 'success');
      setFormOpen(false);
      setFormData({ ...EMPTY_FORM });
      fetchCases({ silent: true });
      fetchStats();
    } catch (err: any) { addToast(err.message || 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleAddNote = async () => {
    if (!selected || !newNote.trim()) return;
    setNoteSubmitting(true);
    try {
      await apiFetch(`/cases/${selected.id}/notes`, { method: 'POST', body: JSON.stringify({ content: newNote }) });
      setNewNote('');
      fetchNotes(selected.id);
      addToast('Note added', 'success');
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setNoteSubmitting(false); }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selected) return;
    setStatusChanging(true);
    try {
      await apiFetch(`/cases/${selected.id}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      addToast(`Case status → ${newStatus.replace(/_/g, ' ')}`, 'success');
      const updated = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(updated.data);
      fetchCases({ silent: true });
      fetchStats();
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setStatusChanging(false); }
  };

  const handleCalculateSolvability = async () => {
    if (!selected) return;
    setSolvSubmitting(true);
    try {
      const res = await apiFetch<{ data: { score: number } }>(`/cases/${selected.id}/calculate-solvability`, {
        method: 'POST', body: JSON.stringify({ factors: solvFactors }),
      });
      addToast(`Solvability score: ${res.data.score}/100`, 'success');
      const updated = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setSolvSubmitting(false); }
  };

  // ── Review workflow handlers ──
  const handleSubmitForReview = async () => {
    if (!selected) return;
    setReviewSubmitting(true);
    try {
      await apiFetch(`/cases/${selected.id}/submit-review`, { method: 'PUT' });
      addToast('Case submitted for supervisor review', 'success');
      const updated = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(updated.data);
      fetchCases({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setReviewSubmitting(false); }
  };

  const handleApproveCase = async (action: 'approve' | 'return') => {
    if (!selected) return;
    setReviewSubmitting(true);
    try {
      await apiFetch(`/cases/${selected.id}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ action, return_reason: returnReason }),
      });
      addToast(action === 'approve' ? 'Case approved' : 'Case returned', 'success');
      setShowReturnModal(false);
      setReturnReason('');
      const updated = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(updated.data);
      fetchCases({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setReviewSubmitting(false); }
  };

  // ── Link Person handlers ──
  const handlePersonSearch = async () => {
    if (!personSearchQuery.trim()) return;
    setPersonSearching(true);
    try {
      const data = await apiFetch<any>(`/records/persons/search?q=${encodeURIComponent(personSearchQuery)}`);
      setPersonResults(Array.isArray(data) ? data : (data?.data || []));
    } catch { setPersonResults([]); }
    finally { setPersonSearching(false); }
  };

  const handleLinkPerson = async (person: any) => {
    if (!selected) return;
    try {
      let existing: any[] = [];
      try { existing = selected.linked_persons ? (typeof selected.linked_persons === 'string' ? JSON.parse(selected.linked_persons) : selected.linked_persons) : []; } catch { existing = []; }
      const already = existing.some((p: any) => p.id === person.id);
      if (already) { addToast('Person already linked', 'error'); return; }
      const updated = [...existing, { id: person.id, first_name: person.first_name, last_name: person.last_name, role: 'involved' }];
      await apiFetch(`/cases/${selected.id}`, { method: 'PUT', body: JSON.stringify({ linked_persons: updated }) });
      addToast(`${person.first_name} ${person.last_name} linked to case`, 'success');
      const refreshed = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(refreshed.data);
      setLinkPersonOpen(false);
      setPersonSearchQuery('');
      setPersonResults([]);
    } catch (err: any) { addToast(err.message, 'error'); }
  };

  // Parse linked persons for display
  useEffect(() => {
    if (selected?.linked_persons) {
      try {
        const parsed = typeof selected.linked_persons === 'string' ? JSON.parse(selected.linked_persons) : selected.linked_persons;
        setLinkedPersons(Array.isArray(parsed) ? parsed : []);
      } catch { setLinkedPersons([]); }
    } else { setLinkedPersons([]); }
  }, [selected]);

  const getStatusColor = (status: string) => STATUS_OPTIONS.find(s => s.value === status)?.color || '';
  const getPriorityColor = (priority: string) => PRIORITY_OPTIONS.find(p => p.value === priority)?.color || '';

  // Set document title
  useEffect(() => { document.title = 'Case Management \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowReturnModal(false); setFormOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left: Case List ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Case Management" icon={Briefcase}>
          <ExportButton exportUrl="/api/cases/export/csv" exportFilename="cases_export.csv" />
          <button type="button" onClick={() => { setFormOpen(true); setFormData({ ...EMPTY_FORM }); }} className="toolbar-btn toolbar-btn-primary print:hidden">
            <Plus style={{ width: 11, height: 11 }} /> New
          </button>
          <span className="text-[9px] font-mono text-rmpg-500">{totalCount}</span>
        </PanelTitleBar>

        {fetchError && (
          <div className="mx-3 mt-2 p-2 bg-red-900/30 border border-red-700/50 text-red-400 text-xs flex items-center gap-2" role="alert">
            <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
            <span className="flex-1">{fetchError}</span>
            <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300 text-[10px]" aria-label="Dismiss error">dismiss</button>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="flex gap-2 px-2 py-1.5 border-b border-rmpg-700 bg-surface-sunken overflow-x-auto">
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">TOTAL</div>
              <div className="text-sm font-bold text-white tabular-nums">{stats.total || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">ACTIVE</div>
              <div className="text-sm font-bold text-green-400 tabular-nums">{(stats.by_status?.open || 0) + (stats.by_status?.active || 0) + (stats.by_status?.assigned || 0)}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">SOLVABILITY</div>
              <div className="text-sm font-bold text-amber-400 tabular-nums">{stats.avg_solvability || 0}%</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base">
          <div className="flex-1 min-w-[120px] relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500 pointer-events-none" style={{ width: 12, height: 12 }} />
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search cases..." aria-label="Search cases..."
              className="w-full pl-7 pr-7 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 outline-none transition-shadow"
            />
            {searchQuery && (
              <button type="button" onClick={() => { setSearchQuery(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white transition-colors" aria-label="Clear search">
                <X style={{ width: 10, height: 10 }} />
              </button>
            )}
          </div>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none">
            <option value="">All Status</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none">
            <option value="">All Types</option>
            {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* Case List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider animate-pulse">Loading cases...</span></div>
          ) : cases.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No cases found"
              description="Create a new case to get started."
              action={{ label: 'New Case', onClick: () => { setFormOpen(true); setFormData({ ...EMPTY_FORM }); } }}
            />
          ) : (
            cases.map(c => (
              <button type="button"
                key={c.id}
                onClick={() => { setSelected(c); setDetailTab('overview'); }}
                className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-colors ${
                  selected?.id === c.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-white">{c.case_number}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${getStatusColor(c.status)}`}>
                    {c.status.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{c.title}</div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <span className={`font-bold ${getPriorityColor(c.priority)}`}>{c.priority.toUpperCase()}</span>
                  <span>{humanizeCaseType(c.case_type)}</span>
                  {c.solvability_score != null && (
                    <span className="flex items-center gap-0.5">
                      <Target style={{ width: 9, height: 9 }} />
                      {c.solvability_score}%
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-base">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-[10px] text-rmpg-400 disabled:opacity-30 hover:text-white transition-colors">Prev</button>
            <span className="text-[9px] font-mono text-rmpg-500 tabular-nums">Page {page}/{totalPages}</span>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-[10px] text-rmpg-400 disabled:opacity-30 hover:text-white transition-colors">Next</button>
          </div>
        )}
      </div>

      {/* ── Right: Detail ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.case_number} — ${selected.title}`} icon={Briefcase}>
            </PanelTitleBar>

            {/* Tabs */}
            <div className="flex border-b border-rmpg-700 overflow-x-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent">
              {DETAIL_TABS.map(tab => {
                const count = tab.countKey && caseFull?.counts ? (caseFull.counts as any)[tab.countKey] : undefined;
                return (
                  <button type="button"
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap flex items-center gap-1 ${
                      detailTab === tab.id ? 'text-white border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500 hover:text-rmpg-300'
                    }`}
                  >
                    {tab.label}
                    {count != null && count > 0 && (
                      <span className="text-[8px] px-1 py-0.5 bg-brand-900/40 text-brand-300 border border-brand-700/50 tabular-nums">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent p-4">
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  {/* Status + Priority badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-1 border font-bold ${getStatusColor(selected.status)}`}>
                      {selected.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span className={`text-[10px] px-2 py-1 border bg-rmpg-700/30 border-rmpg-600/50 font-bold ${getPriorityColor(selected.priority)}`}>
                      {selected.priority.toUpperCase()}
                    </span>
                    {selected.solvability_score != null && (
                      <span className="text-[10px] px-2 py-1 border bg-amber-900/30 text-amber-400 border-amber-700/50 font-bold">
                        SOLVABILITY: {selected.solvability_score}%
                      </span>
                    )}
                  </div>

                  {/* Entity count summary cards */}
                  {caseFull?.counts && (
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {DETAIL_TABS.filter(t => t.countKey).map(t => {
                        const count = (caseFull.counts as any)[t.countKey!] || 0;
                        return (
                          <button type="button" key={t.id} onClick={() => setDetailTab(t.id)} className="panel-beveled p-2 text-center hover:bg-rmpg-800/40 transition-colors">
                            <div className="text-sm font-bold text-white tabular-nums">{count}</div>
                            <div className="text-[8px] font-mono text-rmpg-500 uppercase">{t.label}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Status change */}
                  <div className="panel-beveled p-3">
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2">Change Status</div>
                    <div className="flex flex-wrap gap-1">
                      {STATUS_OPTIONS.filter(s => s.value !== selected.status).map(s => (
                        <button type="button"
                          key={s.value}
                          onClick={() => handleStatusChange(s.value)}
                          disabled={statusChanging}
                          className="text-[10px] px-2 py-1 border border-rmpg-600 text-rmpg-300 hover:bg-rmpg-700/40 transition-colors"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Admin God Mode: Delete Case */}
                  {isAdmin && (
                    <div className="panel-beveled p-3 border-red-900/30">
                      <button type="button"
                        onClick={async () => {
                          if (!confirm(`Admin God Mode: Delete case ${selected.case_number}? This cannot be undone.`)) return;
                          try {
                            await apiFetch(`/cases/${selected.id}`, { method: 'DELETE' });
                            addToast(`Case ${selected.case_number} deleted`, 'success');
                            setSelected(null);
                            fetchCases();
                          } catch (err: any) { addToast(err.message || 'Delete failed', 'error'); }
                        }}
                        className="toolbar-btn text-red-400 border-red-700/50 hover:bg-red-900/30 text-[10px]"
                      >
                        <X style={{ width: 11, height: 11 }} /> Delete Case (Admin)
                      </button>
                    </div>
                  )}

                  {/* Review Workflow */}
                  {(selected.status === 'under_review' || (selected as any).approval_status) && (
                    <div className="panel-beveled p-3">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2">Case Review Workflow</div>
                      {(selected as any).approval_status && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[10px] px-2 py-0.5 border font-bold ${APPROVAL_STATUS_COLORS[(selected as any).approval_status] || ''}`}>
                            {((selected as any).approval_status || '').replace(/_/g, ' ').toUpperCase()}
                          </span>
                          {(selected as any).return_reason && (
                            <span className="text-[10px] text-red-400 italic">Reason: {(selected as any).return_reason}</span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {selected.status === 'under_review' && !(selected as any).approval_status && (
                          <button type="button" onClick={handleSubmitForReview} disabled={reviewSubmitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                            {reviewSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Send style={{ width: 11, height: 11 }} />}
                            Submit for Review
                          </button>
                        )}
                        {(selected as any).approval_status === 'pending_review' && (
                          <>
                            <button type="button" onClick={() => handleApproveCase('approve')} disabled={reviewSubmitting} className="toolbar-btn text-green-400 border-green-700/50 hover:bg-green-900/30">
                              {reviewSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <ShieldCheck style={{ width: 11, height: 11 }} />}
                              Approve
                            </button>
                            <button type="button" onClick={() => setShowReturnModal(true)} disabled={reviewSubmitting} className="toolbar-btn text-red-400 border-red-700/50 hover:bg-red-900/30">
                              <RotateCcw style={{ width: 11, height: 11 }} /> Return
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Link Person Quick Action */}
                  <div className="panel-beveled p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase">Linked Persons</div>
                      <button type="button" onClick={() => setLinkPersonOpen(true)} className="toolbar-btn text-[10px]">
                        <Link style={{ width: 10, height: 10 }} /> Link Person
                      </button>
                    </div>
                    {linkedPersons.length > 0 ? (
                      <div className="space-y-1">
                        {linkedPersons.map((p: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-300">
                            <User style={{ width: 10, height: 10 }} className="text-rmpg-500" />
                            <span className="text-white font-bold">{p.last_name}, {p.first_name}</span>
                            <span className="text-[9px] text-rmpg-500 px-1 border border-rmpg-700 bg-rmpg-800/50">{p.role || 'involved'}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-rmpg-500">No persons linked</div>
                    )}
                  </div>

                  {/* Detail grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      ['Case Number', selected.case_number],
                      ['Type', humanizeCaseType(selected.case_type)],
                      ['Lead Investigator', selected.lead_investigator_name || '—'],
                      ['Opened', selected.opened_date ? new Date(selected.opened_date).toLocaleDateString() : '—'],
                      ['Due Date', selected.due_date ? new Date(selected.due_date).toLocaleDateString() : '—'],
                      ['Closed', selected.closed_date ? new Date(selected.closed_date).toLocaleDateString() : '—'],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                        <div className="text-xs text-white mt-0.5">{value || '—'}</div>
                      </div>
                    ))}
                  </div>

                  {selected.summary && (
                    <div className="panel-beveled p-3">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Summary</div>
                      <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selected.summary}</div>
                    </div>
                  )}
                  {selected.narrative && (
                    <div className="panel-beveled p-3">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Narrative</div>
                      <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selected.narrative}</div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Entity Tabs ── */}
              {detailTab === 'calls' && (
                <LinkedEntityPanel
                  items={caseFull?.calls || []}
                  columns={[
                    { key: 'call_number', label: 'CFS #', render: (v: any) => <span className="font-mono font-bold text-white">{v || '—'}</span> },
                    { key: 'incident_type', label: 'Type' },
                    { key: 'priority', label: 'Priority', render: (v) => <span className="font-bold uppercase">{v || '—'}</span> },
                    { key: 'status', label: 'Status' },
                    { key: 'location', label: 'Location' },
                    { key: 'created_at', label: 'Date', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                  ]}
                  entityType="calls"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/dispatch/calls"
                  searchFields={['call_number', 'incident_type', 'location_address']}
                  onNavigate={() => navigate('/dispatch')}
                />
              )}

              {detailTab === 'incidents' && (
                <LinkedEntityPanel
                  items={caseFull?.incidents || []}
                  columns={[
                    { key: 'incident_number', label: 'Incident #', render: (v) => <span className="font-mono font-bold text-white">{v || '—'}</span> },
                    { key: 'incident_type', label: 'Type' },
                    { key: 'status', label: 'Status' },
                    { key: 'location', label: 'Location' },
                    { key: 'created_at', label: 'Date', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                  ]}
                  entityType="incidents"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/incidents"
                  searchFields={['incident_number', 'incident_type', 'location']}
                  onNavigate={(item) => navigate(`/incidents?id=${item.id}`)}
                />
              )}

              {detailTab === 'persons' && (
                <LinkedEntityPanel
                  items={caseFull?.persons || []}
                  columns={[
                    { key: 'last_name', label: 'Name', render: (_v, row) => <span className="font-bold text-white">{row.last_name}, {row.first_name}</span> },
                    { key: 'date_of_birth', label: 'DOB', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                    { key: 'role', label: 'Role', render: (v) => <span className="text-[9px] px-1 border border-rmpg-700 bg-rmpg-800/50">{v || 'involved'}</span> },
                    { key: 'phone', label: 'Phone' },
                  ]}
                  entityType="persons"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/records/persons"
                  searchFields={['last_name', 'first_name', 'date_of_birth']}
                  onNavigate={(item) => navigate(`/records?tab=persons&personId=${item.id}`)}
                />
              )}

              {detailTab === 'vehicles' && (
                <LinkedEntityPanel
                  items={caseFull?.vehicles || []}
                  columns={[
                    { key: 'plate_number', label: 'Plate', render: (v) => <span className="font-mono font-bold text-white">{v || '—'}</span> },
                    { key: 'make', label: 'Make' },
                    { key: 'model', label: 'Model' },
                    { key: 'year', label: 'Year' },
                    { key: 'color', label: 'Color' },
                    { key: 'vin', label: 'VIN' },
                  ]}
                  entityType="vehicles"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/records/vehicles"
                  searchFields={['plate_number', 'make', 'model', 'color']}
                  onNavigate={(item) => navigate(`/records?tab=vehicles&vehicleId=${item.id}`)}
                />
              )}

              {detailTab === 'properties' && (
                <LinkedEntityPanel
                  items={caseFull?.properties || []}
                  columns={[
                    { key: 'description', label: 'Description', render: (v) => <span className="text-white">{v || '—'}</span> },
                    { key: 'property_type', label: 'Type' },
                    { key: 'serial_number', label: 'Serial #' },
                    { key: 'status', label: 'Status' },
                    { key: 'estimated_value', label: 'Value', render: (v) => v ? `$${Number(v).toLocaleString()}` : '—' },
                  ]}
                  entityType="properties"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/records/properties"
                  searchFields={['description', 'serial_number', 'property_type']}
                  onNavigate={(item) => navigate(`/records?tab=properties&propertyId=${item.id}`)}
                />
              )}

              {detailTab === 'evidence' && (
                <LinkedEntityPanel
                  items={caseFull?.evidence || []}
                  columns={[
                    { key: 'evidence_number', label: 'Evidence #', render: (v) => <span className="font-mono font-bold text-white">{v || '—'}</span> },
                    { key: 'description', label: 'Description' },
                    { key: 'evidence_type', label: 'Type' },
                    { key: 'location', label: 'Location' },
                    { key: 'status', label: 'Status' },
                  ]}
                  entityType="evidence"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/records/evidence"
                  searchFields={['evidence_number', 'description', 'evidence_type']}
                  onNavigate={() => navigate('/evidence')}
                />
              )}

              {detailTab === 'warrants' && (
                <LinkedEntityPanel
                  items={caseFull?.warrants || []}
                  columns={[
                    { key: 'warrant_number', label: 'Warrant #', render: (v) => <span className="font-mono font-bold text-white">{v || '—'}</span> },
                    { key: 'warrant_type', label: 'Type' },
                    { key: 'status', label: 'Status' },
                    { key: 'subject_name', label: 'Subject' },
                    { key: 'issued_date', label: 'Issued', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                  ]}
                  entityType="warrants"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/warrants"
                  searchFields={['warrant_number', 'subject_name', 'warrant_type']}
                  onNavigate={(item) => navigate(`/warrants?id=${item.id}`)}
                />
              )}

              {detailTab === 'citations' && (
                <LinkedEntityPanel
                  items={caseFull?.citations || []}
                  columns={[
                    { key: 'citation_number', label: 'Citation #', render: (v) => <span className="font-mono font-bold text-white">{v || '—'}</span> },
                    { key: 'violation', label: 'Violation' },
                    { key: 'status', label: 'Status' },
                    { key: 'violator_name', label: 'Violator' },
                    { key: 'issued_date', label: 'Issued', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
                  ]}
                  entityType="citations"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/citations"
                  searchFields={['citation_number', 'violation', 'violator_name']}
                  onNavigate={(item) => navigate(`/citations?id=${item.id}`)}
                />
              )}

              {/* ── Timeline Tab ── */}
              {detailTab === 'timeline' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-rmpg-500 uppercase">Case Timeline</div>
                  {(caseFull?.notes || []).length === 0 && (caseFull?.calls || []).length === 0 && (caseFull?.incidents || []).length === 0 ? (
                    <div className="text-center py-6 text-rmpg-500 text-xs">No timeline events</div>
                  ) : (
                    <div className="relative pl-4 border-l border-rmpg-700 space-y-3">
                      {[
                        ...(caseFull?.calls || []).map((c: any) => ({ date: c.created_at, type: 'Call', label: `CFS ${c.case_number || '#' + c.id} — ${c.call_type || 'Unknown'}`, color: '#888888' })),
                        ...(caseFull?.incidents || []).map((i: any) => ({ date: i.created_at, type: 'Incident', label: `${i.incident_number || '#' + i.id} — ${i.incident_type || 'Unknown'}`, color: '#f59e0b' })),
                        ...(caseFull?.notes || []).map((n: any) => ({ date: n.created_at, type: 'Note', label: n.content?.substring(0, 80) || 'Note', color: '#8b5cf6' })),
                      ]
                        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
                        .map((event, idx) => (
                          <div key={idx} className="relative">
                            <div className="absolute -left-[21px] w-2.5 h-2.5 rounded-full border-2 border-surface-base" style={{ background: event.color }} />
                            <div className="text-[9px] font-mono text-rmpg-500">{event.date ? new Date(event.date).toLocaleString() : '—'}</div>
                            <div className="text-[10px] text-rmpg-300">
                              <span className="font-bold text-white mr-1" style={{ color: event.color }}>[{event.type}]</span>
                              {event.label}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Notes Tab ── */}
              {detailTab === 'notes' && (
                <div className="space-y-3">
                  {/* Add note */}
                  <div className="panel-beveled p-3">
                    <textarea
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      placeholder="Add a case note..."
                      rows={3}
                      className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 outline-none resize-none"
                    />
                    <div className="flex justify-end mt-2">
                      <button type="button" onClick={handleAddNote} disabled={noteSubmitting || !newNote.trim()} className="toolbar-btn toolbar-btn-primary print:hidden">
                        {noteSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <MessageSquare style={{ width: 11, height: 11 }} />}
                        Add Note
                      </button>
                    </div>
                  </div>

                  {notes.map(note => (
                    <div key={note.id} className="panel-beveled p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-white">{note.author_name || 'Unknown'}</span>
                        <span className="text-[9px] font-mono text-rmpg-500">
                          {note.created_at ? new Date(note.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                      <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{note.content}</div>
                    </div>
                  ))}
                  {notes.length === 0 && <div className="text-center py-6 text-rmpg-500 text-xs">No notes yet</div>}
                </div>
              )}

              {/* ── Solvability Tab ── */}
              {detailTab === 'solvability' && (
                <div className="space-y-4">
                  {/* Feature 29: Enhanced Solvability Score from server analysis */}
                  <SolvabilityScoreCard caseId={selected.id} />

                  {/* Feature 40: Linked Incidents Relationship Graph */}
                  <LinkedIncidentsGraph caseId={selected.id} />

                  <div className="panel-beveled p-4">
                    <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-3">Solvability Factors</div>
                    <div className="space-y-2">
                      {SOLVABILITY_FACTORS.map(f => (
                        <label key={f.key} className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!solvFactors[f.key]}
                            onChange={e => setSolvFactors(prev => ({ ...prev, [f.key]: e.target.checked }))}
                            className="accent-brand-500"
                          />
                          <span className="text-xs text-white flex-1" title={humanizeSolvabilityFactor(f.key)}>{f.label}</span>
                          <span className="text-[9px] font-mono text-rmpg-500">+{f.weight}pts</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-rmpg-700">
                      <span className="text-xs text-rmpg-400">
                        Projected: <span className="font-bold text-amber-400">
                          {SOLVABILITY_FACTORS.reduce((sum, f) => sum + (solvFactors[f.key] ? f.weight : 0), 0)}/100
                        </span>
                      </span>
                      <button type="button" onClick={handleCalculateSolvability} disabled={solvSubmitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                        {solvSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Target style={{ width: 11, height: 11 }} />}
                        Calculate & Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Briefcase className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">Select a case to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Return Case Modal ── */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Return Case" icon={RotateCcw}>
              <button type="button" onClick={() => setShowReturnModal(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Return Reason *</label>
                <textarea value={returnReason} onChange={e => setReturnReason(e.target.value)} rows={3}
                  placeholder="Explain why this case needs additional work..."
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setShowReturnModal(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={() => handleApproveCase('return')} disabled={reviewSubmitting || !returnReason.trim()} className="toolbar-btn text-red-400 border-red-700/50 hover:bg-red-900/30">
                  {reviewSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <RotateCcw style={{ width: 11, height: 11 }} />}
                  Return Case
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Link Person Modal ── */}
      {linkPersonOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Link Person to Case" icon={Link}>
              <button type="button" onClick={() => { setLinkPersonOpen(false); setPersonResults([]); setPersonSearchQuery(''); }} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input value={personSearchQuery} onChange={e => setPersonSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePersonSearch()}
                  placeholder="Search by name, phone, email..." aria-label="Search by name, phone, email..."
                  className="flex-1 px-2 py-1.5 w-full text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                <button type="button" onClick={handlePersonSearch} disabled={personSearching} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {personSearching ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Search style={{ width: 11, height: 11 }} />}
                  Search
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent space-y-1">
                {personResults.map((p: any) => (
                  <button type="button" key={p.id} onClick={() => handleLinkPerson(p)}
                    className="w-full text-left px-3 py-2 border border-rmpg-700 hover:bg-rmpg-800/40 transition-colors">
                    <div className="text-[11px] font-bold text-white">{p.last_name}, {p.first_name}</div>
                    <div className="text-[9px] text-rmpg-500">
                      {p.date_of_birth && <span>DOB: {p.date_of_birth} </span>}
                      {p.phone && <span>Ph: {p.phone}</span>}
                    </div>
                  </button>
                ))}
                {personResults.length === 0 && personSearchQuery && !personSearching && (
                  <div className="text-[10px] text-rmpg-500 text-center py-4">No results found</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── New Case Modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-lg mx-4">
            <PanelTitleBar title="New Case" icon={Plus}>
              <button type="button" onClick={() => setFormOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Title *</label>
                <input value={formData.title} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="field-label">Type</label>
                  <select value={formData.case_type} onChange={e => setFormData(p => ({ ...p, case_type: e.target.value as CaseType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Priority</label>
                  <select value={formData.priority} onChange={e => setFormData(p => ({ ...p, priority: e.target.value as CasePriority }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Lead Investigator</label>
                  <select value={formData.lead_investigator_id} onChange={e => setFormData(p => ({ ...p, lead_investigator_id: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    <option value="">Unassigned</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">Summary</label>
                <textarea value={formData.summary} onChange={e => setFormData(p => ({ ...p, summary: e.target.value }))} rows={3} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button type="button" onClick={() => setFormOpen(false)} className="toolbar-btn">Cancel</button>
                <button type="button" onClick={handleCreate} disabled={submitting} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create Case
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
