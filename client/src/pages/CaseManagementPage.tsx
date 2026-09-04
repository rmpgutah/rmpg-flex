// ============================================================
// RMPG Flex — Case Management Page
// ============================================================
// Investigative case tracking with solvability scoring,
// investigator assignment, case notes, and linked records.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import ConfirmDialog from '../components/ConfirmDialog';
import RichTextArea from '../components/RichTextArea';
import {
  Briefcase, Search, Plus, User, X, Save, Loader2, AlertTriangle, Target,
  MessageSquare, ArrowRight, CheckCircle, FolderOpen, ShieldCheck, RotateCcw, Send,
  Link, Eye, Trash2, Unlink, FileText,
} from 'lucide-react';
import type { Case, CaseNote, CaseFull, CaseStatus, CaseType, CasePriority } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import ExportButton from '../components/ExportButton';
import { apiFetch } from '../hooks/useApi';
import FileAttachments from '../components/FileAttachments';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { humanizeCaseType, humanizeSolvabilityFactor } from '../utils/statusLabels';
import { safeDateTimeStr, parseTimestamp } from '../utils/dateUtils';
import { formatActivity, type CaseActivityRow } from '../utils/caseActivity';
import { CaseTasksTab, CaseMyTasksView } from '../components/CaseTasks';
import { CaseDashboardView, SlaBadge } from '../components/CaseDashboard';
import { InvestigationTab } from '../components/InvestigationTab';
import { CaseRelatedSection } from '../components/CaseRelated';
import { CaseReadinessCard, fetchCaseCompleteness } from '../components/CaseReadiness';
import { downloadPdfV2 } from '../utils/pdf/v2';
import { caseReportSchema, type CaseReportData } from '../utils/pdf/v2/forms/caseReport';
import { getSavedViews, persistViews, upsertView, type SavedView } from '../utils/caseSavedViews';
import { withAlpha } from '../utils/withAlpha';

const STATUS_OPTIONS: { value: CaseStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-surface-sunken text-rmpg-400 border-border-default' },
  { value: 'assigned', label: 'Assigned', color: 'bg-surface-sunken text-rmpg-400 border-border-default' },
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
  { value: 'normal', label: 'Normal', color: 'text-rmpg-400' },
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

type DetailTab = 'overview' | 'calls' | 'incidents' | 'persons' | 'vehicles' | 'properties' | 'evidence' | 'warrants' | 'citations' | 'tasks' | 'timeline' | 'notes' | 'solvability' | 'files' | 'intelligence';

const DETAIL_TABS: { id: DetailTab; label: string; countKey?: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'calls', label: 'Calls', countKey: 'calls' },
  { id: 'incidents', label: 'Incidents', countKey: 'incidents' },
  { id: 'persons', label: 'Individual', countKey: 'persons' },
  { id: 'vehicles', label: 'Vehicles', countKey: 'vehicles' },
  { id: 'properties', label: 'Properties', countKey: 'properties' },
  { id: 'evidence', label: 'Evidence', countKey: 'evidence' },
  { id: 'warrants', label: 'Warrants', countKey: 'warrants' },
  { id: 'citations', label: 'Citations', countKey: 'citations' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'notes', label: 'Notes', countKey: 'notes' },
  { id: 'solvability', label: 'Solvability' },
  { id: 'files', label: 'Files', countKey: 'attachments' },
  { id: 'intelligence', label: 'Intelligence' },
];

// ── Reusable LinkedEntityPanel for each entity tab ──
function LinkedEntityPanel({
  items, columns, entityType, caseId, onRefresh, searchEndpoint, searchFields,
}: {
  items: any[];
  columns: { key: string; label: string; render?: (val: any, row: any) => React.ReactNode }[];
  entityType: string;
  caseId: number;
  onRefresh: () => void;
  searchEndpoint: string;
  searchFields: string[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

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
    } catch (err) { addToast(err instanceof Error ? err.message : 'Link failed', 'error'); }
  };

  const handleUnlink = async (entityId: number) => {
    try {
      await apiFetch(`/cases/${caseId}/${entityType}/${entityId}`, { method: 'DELETE' });
      addToast(`${entityType.slice(0, -1)} unlinked from case`, 'success');
      onRefresh();
    } catch (err) { addToast(err instanceof Error ? err.message : 'Unlink failed', 'error'); }
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
                <tr key={item.id || idx} className="border-b border-rmpg-800 hover:bg-rmpg-800/30 transition-colors"
                  onContextMenu={(e) => openMenu(e, [
                    m.copyId(item.id),
                    m.separator(),
                    m.action(`Unlink ${entityType.slice(0, -1)}`, () => handleUnlink(item.id), { icon: <Unlink size={12} />, danger: true }),
                  ])}
                >
                  {columns.map(col => (
                    <td key={col.key} className="px-2 py-1.5 text-rmpg-300">
                      {col.render ? col.render(item[col.key], item) : (item[col.key] ?? '—')}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    <button type="button" onClick={() => handleUnlink(item.id)} className="text-red-400 hover:text-red-300 text-[9px] font-mono uppercase">
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
              <IconButton onClick={() => { setModalOpen(false); setSearchResults([]); setSearchQuery(''); }} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input id="ff-casemanagementpage-0" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder={`Search ${entityType}...`} aria-label={`Search ${entityType}`}
                  className="flex-1 px-2 py-1.5 w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none" />
                <button type="button" onClick={handleSearch} disabled={searching} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {searching ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Search style={{ width: 11, height: 11 }} />}
                  Search
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent space-y-1">
                {searchResults.map((item: any) => (
                  <button type="button" key={item.id} onClick={() => handleLink(item.id)}
                    className="w-full text-left px-3 py-2 border border-rmpg-700 hover:bg-rmpg-800/40 transition-colors">
                    <div className="text-[11px] font-bold text-rmpg-100">
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
    let cancelled = false;
    setLoading(true);
    apiFetch<any>(`/cases/${caseId}/solvability`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [caseId]);

  if (loading) return <div className="flex items-center gap-2 text-[10px] text-rmpg-500 p-3"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Analyzing solvability...</div>;
  if (!data) return null;

  const ratingColor = data.rating === 'high' ? 'var(--sev-ok)' : data.rating === 'medium' ? 'var(--sev-warn)' : 'var(--sev-critical)';

  return (
    <div className="panel-beveled p-4">
      <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-3">Server Analysis</div>
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--border-subtle)" strokeWidth="3" />
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
// Accepts pre-fetched caseFull data to avoid double-fetching /full.
function LinkedIncidentsGraph({ caseId, caseFull }: { caseId: string | number; caseFull?: any }) {
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use pre-fetched /full data when available (avoids a double-fetch and
    // uses hydrated objects instead of the raw JSON-string legacy columns).
    if (caseFull) {
      const related = [
        ...(caseFull.incidents || []).map((i: any) => ({ ...i, rel_type: 'incident' })),
        ...(caseFull.related || []).map((c: any) => ({ ...c, rel_type: 'case' })),
        ...(caseFull.warrants || []).map((w: any) => ({ ...w, rel_type: 'warrant' })),
        ...(caseFull.persons || []).map((p: any) => ({ ...p, rel_type: 'person' })),
      ];
      setLinks(related);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<any>(`/cases/${caseId}/full`)
      .then((data: any) => {
        const related = [
          ...(data?.incidents || []).map((i: any) => ({ ...i, rel_type: 'incident' })),
          ...(data?.related || []).map((c: any) => ({ ...c, rel_type: 'case' })),
          ...(data?.warrants || []).map((w: any) => ({ ...w, rel_type: 'warrant' })),
          ...(data?.persons || []).map((p: any) => ({ ...p, rel_type: 'person' })),
        ];
        setLinks(related);
      })
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }, [caseId, caseFull]);

  if (loading) return <div className="flex items-center gap-2 text-[10px] text-rmpg-500 p-3"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Loading relationships...</div>;
  if (links.length === 0) return null;

  // Timeline / chart colors routed through semantic --sev-* tokens so the
  // dots re-color cleanly across night / day / legacy. The `case` entry maps
  // to --sev-special (purple) which is a shade-shift from the previous
  // var(--sev-special) (tailwind violet-500) but stays semantically distinct.
  const typeColors: Record<string, string> = {
    incident: 'var(--spm-text-muted)',
    case: 'var(--sev-special)',
    warrant: 'var(--sev-critical)',
    person: 'var(--sev-ok)',
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
          const color = typeColors[link.rel_type] || 'var(--text-muted)';
          return (
            <div key={idx} className="flex items-center gap-1">
              <ArrowRight className="w-3 h-3 text-rmpg-600" />
              <div
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold border"
                style={{ background: withAlpha(color, '15'), borderColor: withAlpha(color, '50'), color }}
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

export default function CaseManagementPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin'; // Admin God Mode — unrestricted access
  const isManager = user?.role === 'manager';
  const isSupervisor = user?.role === 'supervisor';
  // Role gates: delete/archive → admin|manager; assign → admin|manager|supervisor
  const canDelete = isAdmin || isManager;
  const canArchive = isAdmin || isManager;
  const canAssign = isAdmin || isManager || isSupervisor;
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const [cases, setCases] = useState<Case[]>([]);
  const [selected, setSelected] = useState<Case | null>(null);
  // Top-level view: case list/detail, cross-case My Tasks, or Dashboard (v2)
  const [viewMode, setViewMode] = useState<'cases' | 'mytasks' | 'dashboard'>('cases');
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [personnelLoading, setPersonnelLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [filterMine, setFilterMine] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
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
  // Audit/activity trail (v2 Phase 1) — newest first
  const [caseActivity, setCaseActivity] = useState<CaseActivityRow[]>([]);

  // Solvability
  const [solvFactors, setSolvFactors] = useState<Record<string, boolean>>({});
  const [solvSubmitting, setSolvSubmitting] = useState(false);

  // Note operations
  const [noteDeleting, setNoteDeleting] = useState<number | null>(null);
  const [noteTogglingPin, setNoteTogglingPin] = useState<number | null>(null);

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

  // Inline replacements for the previous native window.prompt / confirm
  // dialogs. Each native call replaced 2026-06-22 with a state-driven modal
  // that's a11y-correct, keyboard-friendly, and renders rich content
  // (bulleted missing-fields lists instead of \n-joined plain text).
  const [noteToDelete, setNoteToDelete] = useState<number | null>(null);
  const [saveViewModalOpen, setSaveViewModalOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [caseToDelete, setCaseToDelete] = useState<Case | null>(null);
  const [caseDeleting, setCaseDeleting] = useState(false);
  const [pendingClose, setPendingClose] = useState<{
    newStatus: string;
    percent: number;
    missing: string[];
  } | null>(null);
  const [pendingReview, setPendingReview] = useState<{
    percent: number;
    missing: string[];
  } | null>(null);

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
        ...(filterOverdue ? { overdue: 'true' } : {}),
        ...(filterMine && user?.id ? { lead_investigator_id: String(user.id) } : {}),
      });
      const res = await apiFetch<{ data: Case[]; pagination: any }>(`/cases?${params}`);
      setCases(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) { setFetchError(err?.message || 'Failed to load data'); } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus, filterType, filterPriority, filterOverdue, filterMine, user?.id]);

  const fetchStats = useCallback(async () => {
    try { const res = await apiFetch<{ data: any }>('/cases/stats'); setStats(res.data); } catch { /* silently skip */ }
  }, []);

  const fetchNotes = useCallback(async (caseId: number) => {
    try { const res = await apiFetch<{ data: CaseNote[] }>(`/cases/${caseId}/notes`); setNotes(res.data || []); } catch { /* silently skip */ }
  }, []);

  // Refreshes both the full-case aggregate and its audit trail, so every
  // existing onRefresh (link/unlink, etc.) keeps the Timeline tab current.
  const fetchFullCase = useCallback(async (caseId: number) => {
    try {
      const data = await apiFetch<any>(`/cases/${caseId}/full`);
      setCaseFull(data);
    } catch { /* silent */ }
    try {
      const r = await apiFetch<{ data: CaseActivityRow[] }>(`/cases/${caseId}/activity`);
      setCaseActivity(Array.isArray(r) ? r : (r?.data || []));
    } catch { setCaseActivity([]); }
  }, []);

  // Open a case by id (e.g. from the My Tasks view) — fetch + select it.
  const openCaseById = useCallback(async (caseId: number) => {
    try {
      const r = await apiFetch<{ data: Case }>(`/cases/${caseId}`);
      if (r?.data) setSelected(r.data);
    } catch { /* silent */ }
  }, []);

  // Full case-report PDF — pulls linked records from caseFull, the audit
  // trail from caseActivity, and fetches tasks fresh at click time.
  const handleExportPdf = async () => {
    if (!selected) return;
    const cf = caseFull as any;
    let tasks: any[] = [];
    try {
      const r = await apiFetch<{ data: any[] }>(`/cases/${selected.id}/tasks`);
      tasks = Array.isArray(r) ? r : (r?.data || []);
    } catch { /* tasks optional in the report */ }
    const reportData: CaseReportData = {
      caseRow: cf || selected,
      calls: cf?.calls, incidents: cf?.incidents, persons: cf?.persons,
      vehicles: cf?.vehicles, properties: cf?.properties, evidence: cf?.evidence,
      warrants: cf?.warrants, citations: cf?.citations, notes: cf?.notes,
      related: cf?.related, tasks, activity: caseActivity,
    };
    const num = String(reportData.caseRow?.case_number ?? 'case').replace(/[^\w-]/g, '_');
    await downloadPdfV2(caseReportSchema, reportData, `case_report_${num}.pdf`, { schemaId: 'case_report' });
    addToast('Case report generated', 'success');
  };

  // ── Bulk selection + actions (v3 Phase 3) ──
  const toggleSelect = (id: number) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());
  const handleBulk = async (action: 'status' | 'assign' | 'archive', value?: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      const r = await apiFetch<{ updated: number }>(`/cases/bulk`, { method: 'POST', body: JSON.stringify({ ids, action, value }) });
      const n = r?.updated ?? ids.length;
      addToast(`${n} case${n === 1 ? '' : 's'} updated`, 'success');
      clearSelection();
      fetchCases({ silent: true });
      fetchStats();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Bulk action failed', 'error'); }
  };

  // ── Saved filter views (v3 Phase 4) ──
  useEffect(() => { setSavedViews(getSavedViews()); }, []);
  const applyView = (view: SavedView) => {
    const f = view.filters;
    setSearchQuery(f.search || '');
    setFilterStatus(f.status || '');
    setFilterType(f.type || '');
    setFilterPriority(f.priority || '');
    setFilterMine(!!f.mine);
    setFilterOverdue(!!f.overdue);
    setPage(1);
  };
  // Save-view modal trigger — opens the inline-modal name input instead of
  // the previous window.prompt. Confirmation lands in commitSaveView() below.
  const saveCurrentView = () => {
    setSaveViewName('');
    setSaveViewModalOpen(true);
  };
  const commitSaveView = () => {
    const trimmed = saveViewName.trim();
    if (!trimmed) return;
    const view: SavedView = {
      name: trimmed,
      filters: {
        search: searchQuery || undefined, status: filterStatus || undefined,
        type: filterType || undefined, priority: filterPriority || undefined,
        mine: filterMine || undefined, overdue: filterOverdue || undefined,
      },
    };
    const next = upsertView(savedViews, view);
    setSavedViews(next);
    persistViews(next);
    addToast(`View "${view.name}" saved`, 'success');
    setSaveViewModalOpen(false);
    setSaveViewName('');
  };

  useEffect(() => { fetchCases(); }, [fetchCases]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    let cancelled = false;
    type PersonnelRecord = { id: number | string; full_name: string; [key: string]: unknown };
    apiFetch<{ data: PersonnelRecord[] } | PersonnelRecord[]>('/personnel')
      .then(r => {
        if (!cancelled) {
          let resolved: PersonnelRecord[];
          if (Array.isArray(r)) {
            resolved = r;
          } else if (r && Array.isArray((r as { data: PersonnelRecord[] }).data)) {
            resolved = (r as { data: PersonnelRecord[] }).data;
          } else {
            resolved = [];
          }
          setUsers(resolved);
        }
      })
      .catch(() => { /* silently skip */ })
      .finally(() => { if (!cancelled) setPersonnelLoading(false); });
    return () => { cancelled = true; };
  }, []);
  // Realtime: refresh the list/stats and the open case detail when any case
  // mutation broadcasts on 'records' (v3 Phase 4).
  useLiveSync('records', () => {
    fetchCases({ silent: true });
    fetchStats();
    if (selected) fetchFullCase(selected.id);
  });

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
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleAddNote = async () => {
    if (!selected || !newNote.trim()) return;
    setNoteSubmitting(true);
    try {
      await apiFetch(`/cases/${selected.id}/notes`, { method: 'POST', body: JSON.stringify({ content: newNote }) });
      setNewNote('');
      fetchNotes(selected.id);
      fetchFullCase(selected.id);
      addToast('Note added', 'success');
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setNoteSubmitting(false); }
  };

  // Delete-note flow — opens ConfirmDialog instead of native confirm().
  const handleDeleteNote = (noteId: number) => { setNoteToDelete(noteId); };
  const confirmDeleteNote = async () => {
    const noteId = noteToDelete;
    if (!selected || noteId == null) return;
    setNoteDeleting(noteId);
    try {
      await apiFetch(`/cases/${selected.id}/notes/${noteId}`, { method: 'DELETE' });
      addToast('Note deleted', 'success');
      fetchNotes(selected.id);
      fetchFullCase(selected.id);
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
    finally { setNoteDeleting(null); setNoteToDelete(null); }
  };

  const handleTogglePin = async (note: CaseNote) => {
    if (!selected) return;
    setNoteTogglingPin(note.id);
    try {
      await apiFetch(`/cases/${selected.id}/notes/${note.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_pinned: !note.is_pinned }),
      });
      addToast(note.is_pinned ? 'Note unpinned' : 'Note pinned', 'success');
      fetchNotes(selected.id);
      fetchFullCase(selected.id);
    } catch (err) { addToast(err instanceof Error ? err.message : 'Toggle failed', 'error'); }
    finally { setNoteTogglingPin(null); }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selected || statusChanging) return;
    // Set the in-flight flag BEFORE the async readiness gate so the buttons
    // disable immediately — otherwise a double-click during the gate's network
    // round-trip / confirm dialog fires two concurrent status writes.
    setStatusChanging(true);
    try {
      // Advisory readiness gate on close — warn, never block (per design).
      // The native window.confirm previously rendered the missing-fields list
      // as a \n-joined plain-text line; now hands off to an inline modal
      // (pendingClose state) that bullets them properly. The modal's confirm
      // handler calls applyStatusChange() with the same newStatus.
      if (newStatus.startsWith('closed')) {
        const comp = await fetchCaseCompleteness(selected.id);
        if (comp && comp.percent < 100) {
          setPendingClose({ newStatus, percent: comp.percent, missing: comp.missing || [] });
          // The modal owns continuation; clear the in-flight flag so the
          // operator can still cancel + click another button without being
          // locked out.
          setStatusChanging(false);
          return;
        }
      }
      await applyStatusChange(newStatus);
    } catch (err: any) {
      addToast(err.message, 'error');
      setStatusChanging(false);
    }
  };

  // Continuation of the status-change flow after the readiness modal returns.
  // Shared by the direct-path (already-complete cases) and the modal-confirm
  // path (operator overrode the warning) so the API call lives in one place.
  const applyStatusChange = async (newStatus: string) => {
    if (!selected) return;
    setStatusChanging(true);
    try {
      await apiFetch(`/cases/${selected.id}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      addToast(`Case status → ${toDisplayLabel(newStatus)}`, 'success');
      const updated = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(updated.data);
      fetchCases({ silent: true });
      fetchStats();
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setStatusChanging(false); setPendingClose(null); }
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
    if (!selected || reviewSubmitting) return;
    setReviewSubmitting(true);
    try {
      const comp = await fetchCaseCompleteness(selected.id);
      if (comp && comp.percent < 100) {
        // Hand off to the inline-modal readiness gate — same shape as
        // handleStatusChange. Modal continuation lands in applySubmitForReview.
        setPendingReview({ percent: comp.percent, missing: comp.missing || [] });
        setReviewSubmitting(false);
        return;
      }
      await applySubmitForReview();
    } catch (err: any) {
      addToast(err.message, 'error');
      setReviewSubmitting(false);
    }
  };

  const applySubmitForReview = async () => {
    if (!selected) return;
    setReviewSubmitting(true);
    try {
      await apiFetch(`/cases/${selected.id}/submit-review`, { method: 'PUT' });
      addToast('Case submitted for supervisor review', 'success');
      const updated = await apiFetch<{ data: Case }>(`/cases/${selected.id}`);
      setSelected(updated.data);
      fetchCases({ silent: true });
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setReviewSubmitting(false); setPendingReview(null); }
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

  // Delete-case flow — opens ConfirmDialog instead of native confirm().
  const handleDeleteCase = (c: Case) => { setCaseToDelete(c); };
  const confirmDeleteCase = async () => {
    const c = caseToDelete;
    if (!c) return;
    setCaseDeleting(true);
    try {
      await apiFetch(`/cases/${c.id}`, { method: 'DELETE' });
      addToast(`Case ${c.case_number} deleted`, 'success');
      if (selected?.id === c.id) setSelected(null);
      fetchCases();
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
    finally { setCaseDeleting(false); setCaseToDelete(null); }
  };

  // ── Right-click context menu for case list rows ──
  const buildCaseMenu = (c: Case): ContextMenuItem[] => [
    m.action('Open case', () => { setSelected(c); setDetailTab('overview'); }, { icon: <Eye size={12} /> }),
    m.separator(),
    m.copy('Copy case number', c.case_number),
    m.copyId(c.id),
    ...(c.title ? [m.copy('Copy title', c.title)] : []),
    ...(canDelete ? [m.separator(), m.action('Delete', () => handleDeleteCase(c), { icon: <Trash2 size={12} />, danger: true })] : []),
  ];

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
      await apiFetch(`/cases/${selected.id}/persons`, {
        method: 'POST',
        body: JSON.stringify({ person_id: person.id, relationship: 'involved' }),
      });
      addToast(`${person.first_name} ${person.last_name} linked to case`, 'success');
      setLinkPersonOpen(false);
      setPersonSearchQuery('');
      setPersonResults([]);
      fetchFullCase(selected.id);
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

  // \u2500\u2500 /cases?case_id=<id> URL deep-link auto-select \u2500\u2500
  // 11th consecutive page-pass for the cross-page contract. Falls through
  // to a direct fetch by id when the case isn't in the current paged list.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingCaseIdRef = useRef<string | null>(searchParams.get('case_id'));
  useEffect(() => {
    const target = pendingCaseIdRef.current;
    if (!target || loading) return;
    pendingCaseIdRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const hit = cases.find((c) => String(c.id) === String(target));
        if (hit) {
          if (!cancelled) { setSelected(hit); setDetailTab('overview'); }
        } else {
          const res = await apiFetch<any>(`/cases/${target}`);
          if (cancelled) return;
          const item = res?.data ?? res;
          if (item && item.id != null) {
            setSelected(item as Case);
            setDetailTab('overview');
          } else {
            addToast(`Case ${target} not found`, 'warning');
          }
        }
      } catch {
        if (!cancelled) addToast(`Failed to load case ${target}`, 'error');
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('case_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, loading]);

  // Keyboard shortcuts:
  //   N — open new case modal (only when no modal is already open and not
  //       typing in an input/textarea).
  //   Escape — close whichever modal is currently open (smallest-open-first
  //       cascade). stopPropagation() prevents the event from bubbling into
  //       nested handlers after we handle it.
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'N' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable) {
        const anyModalOpen = saveViewModalOpen || pendingClose !== null || pendingReview !== null
          || noteToDelete !== null || caseToDelete !== null || linkPersonOpen || showReturnModal || formOpen;
        if (!anyModalOpen) {
          e.preventDefault();
          setFormOpen(true);
          setFormData({ ...EMPTY_FORM });
          // Focus title input after modal renders
          requestAnimationFrame(() => { titleInputRef.current?.focus(); });
        }
        return;
      }

      if (e.key !== 'Escape') return;
      // Order: confirmation modals first (most dismissible), then the
      // entry / picker modals, finally the main form.
      if (saveViewModalOpen) { e.stopPropagation(); setSaveViewModalOpen(false); return; }
      if (caseToDelete !== null) { e.stopPropagation(); setCaseToDelete(null); return; }
      if (pendingClose) { e.stopPropagation(); setPendingClose(null); return; }
      if (pendingReview) { e.stopPropagation(); setPendingReview(null); return; }
      if (noteToDelete != null) { e.stopPropagation(); setNoteToDelete(null); return; }
      if (linkPersonOpen) { e.stopPropagation(); setLinkPersonOpen(false); return; }
      if (showReturnModal) { e.stopPropagation(); setShowReturnModal(false); return; }
      if (formOpen) { e.stopPropagation(); setFormOpen(false); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveViewModalOpen, caseToDelete, pendingClose, pendingReview, noteToDelete, linkPersonOpen, showReturnModal, formOpen]);

  return (
    <div className="h-full flex flex-col">
      {/* ── View toggle (Cases / My Tasks / Dashboard) ── */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-rmpg-700 bg-surface-sunken shrink-0">
        {([['cases', 'Cases'], ['mytasks', 'My Tasks'], ['dashboard', 'Dashboard']] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setViewMode(v)}
            className={`px-3 py-1 text-[10px] font-mono uppercase tracking-wider border transition-colors ${viewMode === v ? 'bg-brand-900/40 border-brand-600/50 text-brand-300' : 'border-transparent text-rmpg-500 hover:text-rmpg-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {viewMode === 'mytasks' ? (
        <CaseMyTasksView onOpenCase={(cid) => { setViewMode('cases'); openCaseById(cid); }} />
      ) : viewMode === 'dashboard' ? (
        <CaseDashboardView stats={stats} onShowOverdue={() => { setViewMode('cases'); setFilterMine(false); setFilterStatus(''); setFilterOverdue(true); setPage(1); }} />
      ) : (
      <div className={`flex-1 min-h-0 flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left: Case List ── */}
      <div className={`flex flex-col min-h-0 ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Case Management" icon={Briefcase}>
          <ExportButton exportUrl="/cases/export/csv" exportFilename="cases_export.csv" />
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
              <div className="text-sm font-bold text-rmpg-100 tabular-nums">{stats.total || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">ACTIVE</div>
              {/* stats.open is the server's canonical open count
                  (`status NOT LIKE 'closed%' AND archived_at IS NULL`, cases.ts:131).
                  This tile used to hand-sum by_status.{open,active,assigned},
                  which silently dropped the other two non-closed statuses --
                  `under_review` and `suspended`. Live D1 had 2 cases sitting in
                  under_review while this rendered ACTIVE 0, reading as "no open
                  case work". Enumerating members breaks every time a status is
                  added; negating the closed set does not. */}
              <div className="text-sm font-bold text-green-400 tabular-nums">{stats.open || 0}</div>
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
            <input id="ff-casemanagementpage-1"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search cases..." aria-label="Search cases..."
              className="w-full pl-7 pr-7 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder-rmpg-500 focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 outline-none transition-shadow"
            />
            {searchQuery && (
              <IconButton onClick={() => { setSearchQuery(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-100 transition-colors" aria-label="Clear search">
                <X style={{ width: 10, height: 10 }} />
              </IconButton>
            )}
          </div>
          <select id="ff-casemanagementpage-2" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none">
            <option value="">All Status</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select id="ff-casemanagementpage-3" value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none">
            <option value="">All Types</option>
            {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="button" onClick={() => { setFilterMine(m => !m); setPage(1); }} aria-pressed={filterMine}
            className={`text-[10px] px-2 py-1 border transition-colors ${filterMine ? 'bg-brand-900/40 border-brand-600/50 text-brand-300' : 'border-rmpg-700 text-rmpg-500 hover:text-rmpg-300'}`}>
            Mine
          </button>
          <button type="button" onClick={() => { setFilterOverdue(o => !o); setPage(1); }} aria-pressed={filterOverdue}
            className={`text-[10px] px-2 py-1 border transition-colors ${filterOverdue ? 'bg-red-900/30 border-red-700/50 text-red-400' : 'border-rmpg-700 text-rmpg-500 hover:text-rmpg-300'}`}>
            Overdue
          </button>
          {savedViews.length > 0 && (
            <select aria-label="Saved views" value=""
              onChange={e => { const vv = savedViews.find(x => x.name === e.target.value); if (vv) applyView(vv); }}
              className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none">
              <option value="">Views…</option>
              {savedViews.map(vv => <option key={vv.name} value={vv.name}>{vv.name}</option>)}
            </select>
          )}
          <button type="button" onClick={saveCurrentView} title="Save current filters as a view"
            className="text-[10px] px-2 py-1 border border-rmpg-700 text-rmpg-500 hover:text-rmpg-300 transition-colors">★ Save</button>
        </div>

        {/* Bulk action bar (v3 Phase 3) */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-rmpg-700 bg-brand-900/20">
            <span className="text-[10px] font-bold text-brand-300">{selectedIds.size} selected</span>
            {/* Controlled value="" resets to the placeholder on every render
                (incl. the bulk-error path), unlike an uncontrolled defaultValue. */}
            <select aria-label="Bulk set status" value=""
              onChange={e => { if (e.target.value) handleBulk('status', e.target.value); }}
              className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-0.5 outline-none">
              <option value="">Set status…</option>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {canAssign && (
              <select aria-label="Bulk assign" value=""
                onChange={e => { if (e.target.value) handleBulk('assign', e.target.value); }}
                className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-0.5 outline-none">
                <option value="">Assign to…</option>
                {users.map(u => <option key={u.id} value={String(u.id)}>{u.full_name}</option>)}
              </select>
            )}
            {canArchive && (
              <button type="button" onClick={() => handleBulk('archive')} className="text-[10px] px-2 py-0.5 border border-rmpg-700 text-rmpg-400 hover:text-rmpg-100 transition-colors">Archive</button>
            )}
            <button type="button" onClick={clearSelection} className="text-[10px] px-2 py-0.5 text-rmpg-500 hover:text-rmpg-100 transition-colors ml-auto">Clear</button>
          </div>
        )}

        {/* Case List */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider animate-pulse">Loading cases...</span></div>
          ) : fetchError ? null : cases.length === 0 && (searchQuery || filterStatus || filterType || filterPriority || filterOverdue || filterMine) ? (
            <EmptyState
              icon={Search}
              title="No results"
              description="No cases match the current filters."
              action={{ label: 'Clear filters', onClick: () => { setSearchQuery(''); setFilterStatus(''); setFilterType(''); setFilterPriority(''); setFilterOverdue(false); setFilterMine(false); setPage(1); } }}
            />
          ) : cases.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No cases yet"
              description="Create a new case to get started."
              action={{ label: 'New Case', onClick: () => { setFormOpen(true); setFormData({ ...EMPTY_FORM }); } }}
            />
          ) : (
            cases.map(c => (
              <div key={c.id}
                className={`flex items-stretch border-b border-rmpg-800 border-l-2 ${
                  selected?.id === c.id ? 'bg-brand-900/20 border-l-brand-500' : 'border-l-transparent'
                }`}
              >
                <label className="flex items-center pl-2 pr-1 cursor-pointer" title="Select for bulk action">
                  <input type="checkbox" className="accent-brand-500" checked={selectedIds.has(c.id)}
                    onChange={() => toggleSelect(c.id)} aria-label={`Select case ${c.case_number}`} />
                </label>
              <button type="button"
                onClick={() => { setSelected(c); setDetailTab('overview'); }}
                onContextMenu={(e) => openMenu(e, buildCaseMenu(c))}
                className={`flex-1 min-w-0 text-left px-2 py-2 transition-colors ${selected?.id === c.id ? '' : 'hover:bg-rmpg-800/40'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold text-rmpg-100">{c.case_number}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <SlaBadge caseRow={c} />
                    <span className={`text-[9px] px-1.5 py-0.5 border ${getStatusColor(c.status)}`}>
                      {toDisplayLabel(c.status).toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{c.title}</div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <span className={`font-bold ${getPriorityColor(c.priority)}`}>{formatEnumValue(c.priority)}</span>
                  <span>{humanizeCaseType(c.case_type)}</span>
                  {c.solvability_score != null && (
                    <span className="flex items-center gap-0.5">
                      <Target style={{ width: 9, height: 9 }} />
                      {c.solvability_score}%
                    </span>
                  )}
                </div>
              </button>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-base">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-[10px] text-rmpg-400 disabled:opacity-30 hover:text-rmpg-100 transition-colors">Prev</button>
            <span className="text-[9px] font-mono text-rmpg-500 tabular-nums">Page {page}/{totalPages}</span>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-[10px] text-rmpg-400 disabled:opacity-30 hover:text-rmpg-100 transition-colors">Next</button>
          </div>
        )}
      </div>

      {/* ── Right: Detail ── */}
      <div className="flex-1 min-h-0 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`${selected.case_number} — ${selected.title}`} icon={Briefcase}>
              <SlaBadge caseRow={selected} />
              <button type="button" onClick={handleExportPdf} className="toolbar-btn text-[10px] print:hidden" title="Export full case report (PDF)">
                <FileText style={{ width: 11, height: 11 }} /> PDF
              </button>
            </PanelTitleBar>

            {/* Tabs */}
            <div className="flex border-b border-rmpg-700 overflow-x-auto tab-scroll">
              {DETAIL_TABS.map(tab => {
                const count = tab.countKey && caseFull?.counts ? (caseFull.counts as any)[tab.countKey] : undefined;
                return (
                  <button type="button"
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap flex items-center gap-1 ${
                      detailTab === tab.id ? 'text-rmpg-100 border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500 hover:text-rmpg-300'
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

            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent p-4">
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  {/* Status + Priority badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-1 border font-bold ${getStatusColor(selected.status)}`}>
                      {toDisplayLabel(selected.status).toUpperCase()}
                    </span>
                    <span className={`text-[10px] px-2 py-1 border bg-rmpg-700/30 border-rmpg-600/50 font-bold ${getPriorityColor(selected.priority)}`}>
                      {formatEnumValue(selected.priority)}
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
                            <div className="text-sm font-bold text-rmpg-100 tabular-nums">{count}</div>
                            <div className="text-[8px] font-mono text-rmpg-500 uppercase">{t.label}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Case readiness / completeness (v3 Phase 1) */}
                  <CaseReadinessCard caseId={selected.id} refreshKey={caseFull} />

                  {/* Related cases (v2 Phase 4) */}
                  <CaseRelatedSection
                    caseId={selected.id}
                    related={(caseFull as any)?.related || []}
                    onChanged={() => fetchFullCase(selected.id)}
                  />

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

                  {/* Delete Case — admin|manager only */}
                  {canDelete && (
                    <div className="panel-beveled p-3 border-red-900/30">
                      <button type="button"
                        onClick={() => handleDeleteCase(selected)}
                        className="toolbar-btn text-red-400 border-red-700/50 hover:bg-red-900/30 text-[10px]"
                      >
                        <X style={{ width: 11, height: 11 }} /> Delete Case
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
                            {toDisplayLabel((selected as any).approval_status || '').toUpperCase()}
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
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase">Linked Individuals</div>
                      <button type="button" onClick={() => setLinkPersonOpen(true)} className="toolbar-btn text-[10px]">
                        <Link style={{ width: 10, height: 10 }} /> Link Person
                      </button>
                    </div>
                    {linkedPersons.length > 0 ? (
                      <div className="space-y-1">
                        {linkedPersons.map((p: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-300">
                            <User style={{ width: 10, height: 10 }} className="text-rmpg-500" />
                            <span className="text-rmpg-100 font-bold">{p.last_name}, {p.first_name}</span>
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
                      ['Opened', selected.opened_date ? parseTimestamp(selected.opened_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'],
                      ['Due Date', selected.due_date ? parseTimestamp(selected.due_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'],
                      ['Closed', selected.closed_date ? parseTimestamp(selected.closed_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—'],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                        <div className="text-xs text-rmpg-100 mt-0.5">{value || '—'}</div>
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
                    { key: 'call_number', label: 'CFS #', render: (v: any) => <span className="font-mono font-bold text-rmpg-100">{v || '—'}</span> },
                    { key: 'incident_type', label: 'Type' },
                    { key: 'priority', label: 'Priority', render: (v) => <span className="font-bold uppercase">{v || '—'}</span> },
                    { key: 'status', label: 'Status' },
                    { key: 'location', label: 'Location' },
                    { key: 'created_at', label: 'Date', render: (v) => v ? parseTimestamp(v).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—' },
                  ]}
                  entityType="calls"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/dispatch/calls"
                  searchFields={['call_number', 'incident_type', 'location_address']}
                />
              )}

              {detailTab === 'incidents' && (
                <LinkedEntityPanel
                  items={caseFull?.incidents || []}
                  columns={[
                    { key: 'incident_number', label: 'Incident #', render: (v) => <span className="font-mono font-bold text-rmpg-100">{v || '—'}</span> },
                    { key: 'incident_type', label: 'Type' },
                    { key: 'status', label: 'Status' },
                    { key: 'location', label: 'Location' },
                    { key: 'created_at', label: 'Date', render: (v) => v ? parseTimestamp(v).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—' },
                  ]}
                  entityType="incidents"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/incidents"
                  searchFields={['incident_number', 'incident_type', 'location']}
                />
              )}

              {detailTab === 'persons' && (
                <LinkedEntityPanel
                  items={caseFull?.persons || []}
                  columns={[
                    { key: 'last_name', label: 'Name', render: (_v, row) => <span className="font-bold text-rmpg-100">{row.last_name}, {row.first_name}</span> },
                    { key: 'date_of_birth', label: 'DOB', render: (v) => v ? parseTimestamp(v).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—' },
                    { key: 'role', label: 'Role', render: (v) => <span className="text-[9px] px-1 border border-rmpg-700 bg-rmpg-800/50">{v || 'involved'}</span> },
                    { key: 'phone', label: 'Phone' },
                  ]}
                  entityType="persons"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/records/persons"
                  searchFields={['last_name', 'first_name', 'date_of_birth']}
                />
              )}

              {detailTab === 'vehicles' && (
                <LinkedEntityPanel
                  items={caseFull?.vehicles || []}
                  columns={[
                    { key: 'plate_number', label: 'Plate', render: (v) => <span className="font-mono font-bold text-rmpg-100">{v || '—'}</span> },
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
                />
              )}

              {detailTab === 'properties' && (
                <LinkedEntityPanel
                  items={caseFull?.properties || []}
                  columns={[
                    { key: 'description', label: 'Description', render: (v) => <span className="text-rmpg-100">{v || '—'}</span> },
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
                />
              )}

              {detailTab === 'evidence' && (
                <LinkedEntityPanel
                  items={caseFull?.evidence || []}
                  columns={[
                    { key: 'evidence_number', label: 'Evidence #', render: (v) => <span className="font-mono font-bold text-rmpg-100">{v || '—'}</span> },
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
                />
              )}

              {detailTab === 'warrants' && (
                <LinkedEntityPanel
                  items={caseFull?.warrants || []}
                  columns={[
                    { key: 'warrant_number', label: 'Warrant #', render: (v) => <span className="font-mono font-bold text-rmpg-100">{v || '—'}</span> },
                    { key: 'warrant_type', label: 'Type' },
                    { key: 'status', label: 'Status' },
                    { key: 'subject_name', label: 'Subject' },
                    { key: 'issued_date', label: 'Issued', render: (v) => v ? parseTimestamp(v).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—' },
                  ]}
                  entityType="warrants"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/warrants"
                  searchFields={['warrant_number', 'subject_name', 'warrant_type']}
                />
              )}

              {detailTab === 'citations' && (
                <LinkedEntityPanel
                  items={caseFull?.citations || []}
                  columns={[
                    { key: 'citation_number', label: 'Citation #', render: (v) => <span className="font-mono font-bold text-rmpg-100">{v || '—'}</span> },
                    { key: 'violation', label: 'Violation' },
                    { key: 'status', label: 'Status' },
                    { key: 'violator_name', label: 'Violator' },
                    { key: 'issued_date', label: 'Issued', render: (v) => v ? parseTimestamp(v).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '—' },
                  ]}
                  entityType="citations"
                  caseId={selected.id}
                  onRefresh={() => fetchFullCase(selected.id)}
                  searchEndpoint="/citations"
                  searchFields={['citation_number', 'violation', 'violator_name']}
                />
              )}

              {/* ── Timeline Tab ── */}
              {detailTab === 'tasks' && (
                <CaseTasksTab caseId={selected.id} users={users} onChanged={() => fetchFullCase(selected.id)} />
              )}

              {detailTab === 'timeline' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-rmpg-500 uppercase">Case Timeline</div>
                  {caseActivity.length === 0 && (caseFull?.notes || []).length === 0 && (caseFull?.calls || []).length === 0 && (caseFull?.incidents || []).length === 0 ? (
                    <div className="text-center py-6 text-rmpg-500 text-xs">No timeline events</div>
                  ) : (
                    <div className="relative pl-4 border-l border-rmpg-700 space-y-3">
                      {[
                        // Audit trail — the authoritative who/what/when. Skip
                        // note.added here; notes render below with full content.
                        ...caseActivity
                          .filter((a) => a.action !== 'note.added')
                          .map((a) => {
                            const f = formatActivity(a.action, a.detail);
                            return { date: a.created_at, type: a.actor_name || 'System', label: f.label, color: f.color };
                          }),
                        // Notes (with content) — purple/special for "operator commentary"
                        ...(caseFull?.notes || []).map((n: any) => ({ date: n.created_at, type: 'Note', label: (n.content || '').substring(0, 100) || 'Note', color: 'var(--sev-special)' })),
                        // Linked-record occurrence context — semantic tokens
                        ...(caseFull?.calls || []).map((c: any) => ({ date: c.created_at, type: 'Call', label: `CFS ${c.call_number || c.case_number || '#' + c.id} — ${c.incident_type || c.call_type || 'Unknown'}`, color: 'var(--spm-text-muted)' })),
                        ...(caseFull?.incidents || []).map((i: any) => ({ date: i.created_at, type: 'Incident', label: `${i.incident_number || '#' + i.id} — ${i.incident_type || 'Unknown'}`, color: 'var(--sev-warn)' })),
                      ]
                        .sort((a, b) => (b.date ? parseTimestamp(b.date).getTime() : 0) - (a.date ? parseTimestamp(a.date).getTime() : 0))
                        .map((event, idx) => (
                          <div key={idx} className="relative">
                            <div className="absolute -left-[21px] w-2.5 h-2.5 rounded-full border-2 border-surface-base" style={{ background: event.color }} />
                            <div className="text-[9px] font-mono text-rmpg-500">{safeDateTimeStr(event.date)}</div>
                            <div className="text-[10px] text-rmpg-300">
                              <span className="font-bold text-rmpg-100 mr-1" style={{ color: event.color }}>[{event.type}]</span>
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
                    <RichTextArea
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      placeholder="Add a case note..."
                      rows={3}
                      className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder-rmpg-500 outline-none resize-none"
                    />
                    <div className="flex justify-end mt-2">
                      <button type="button" onClick={handleAddNote} disabled={noteSubmitting || !newNote.trim()} className="toolbar-btn toolbar-btn-primary print:hidden">
                        {noteSubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <MessageSquare style={{ width: 11, height: 11 }} />}
                        Add Note
                      </button>
                    </div>
                  </div>

                  {notes.map(note => (
                    <div key={note.id} className={`panel-beveled p-3 ${note.is_pinned ? 'border-brand-700/50 bg-brand-900/10' : ''}`}>
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {note.is_pinned && <span className="text-[8px] font-mono text-brand-400 uppercase">PINNED</span>}
                          <span className="text-[10px] font-bold text-rmpg-100 truncate">{(note as any).author_full_name || note.author_name || 'Unknown'}</span>
                          {note.note_type && note.note_type !== 'general' && (
                            <span className="text-[8px] px-1 border border-rmpg-700 text-rmpg-500 uppercase">{toDisplayLabel(note.note_type)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-[9px] font-mono text-rmpg-500">{safeDateTimeStr(note.created_at, '')}</span>
                          <button
                            type="button"
                            onClick={() => handleTogglePin(note)}
                            disabled={noteTogglingPin === note.id}
                            title={note.is_pinned ? 'Unpin note' : 'Pin note'}
                            className={`text-[9px] px-1.5 py-0.5 border transition-colors ${note.is_pinned ? 'border-brand-700/50 text-brand-400 hover:bg-brand-900/30' : 'border-rmpg-700 text-rmpg-500 hover:text-brand-400'}`}
                          >
                            {noteTogglingPin === note.id ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" role="status" aria-label="Loading" /> : '📌'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteNote(note.id)}
                            disabled={noteDeleting === note.id}
                            title="Delete note"
                            className="text-[9px] px-1.5 py-0.5 border border-rmpg-700 text-rmpg-500 hover:text-red-400 hover:border-red-700/50 transition-colors"
                          >
                            {noteDeleting === note.id ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" role="status" aria-label="Loading" /> : <Trash2 style={{ width: 10, height: 10, display: 'inline' }} />}
                          </button>
                        </div>
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
                  <LinkedIncidentsGraph caseId={selected.id} caseFull={caseFull} />

                  <div className="panel-beveled p-4">
                    <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-3">Solvability Factors</div>
                    <div className="space-y-2">
                      {SOLVABILITY_FACTORS.map(f => (
                        <label key={f.key} className="flex items-center gap-3 cursor-pointer">
                          <input id="ff-casemanagementpage-4"
                            type="checkbox"
                            checked={!!solvFactors[f.key]}
                            onChange={e => setSolvFactors(prev => ({ ...prev, [f.key]: e.target.checked }))}
                            className="accent-brand-500"
                          />
                          <span className="text-xs text-rmpg-100 flex-1" title={humanizeSolvabilityFactor(f.key)}>{f.label}</span>
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

              {/* ── Files Tab — dedicated file management ── */}
              {detailTab === 'files' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-rmpg-500 uppercase">
                    Case Files &amp; Documents
                    {caseFull?.counts?.attachments != null && caseFull.counts.attachments > 0 && (
                      <span className="ml-2 text-brand-400">({caseFull.counts.attachments})</span>
                    )}
                  </div>
                  <FileAttachments entityType="case" entityId={String(selected.id)} />
                </div>
              )}

              {/* ── Intelligence Tab — cross-reference engine, MO patterns, timelines ── */}
              {detailTab === 'intelligence' && (
                <InvestigationTab caseId={selected.id} caseNumber={selected.case_number} />
              )}

              {/* File Attachments (always visible outside tabs for quick access) */}
              {detailTab !== 'files' && (
                <div className="panel-beveled p-3 bg-surface-base">
                  <FileAttachments entityType="case" entityId={String(selected.id)} />
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
      </div>
      )}

      {/* ── Return Case Modal ── */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Return Case" icon={RotateCcw}>
              <IconButton onClick={() => setShowReturnModal(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-casemanagementpage-5" className="field-label">Return Reason *</label>
                <RichTextArea value={returnReason} onChange={e => setReturnReason(e.target.value)} rows={3}
                  placeholder="Explain why this case needs additional work..."
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none resize-none" />
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
              <IconButton onClick={() => { setLinkPersonOpen(false); setPersonResults([]); setPersonSearchQuery(''); }} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input id="ff-casemanagementpage-5" value={personSearchQuery} onChange={e => setPersonSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePersonSearch()}
                  placeholder="Search by name, phone, email..." aria-label="Search by name, phone, email..."
                  className="flex-1 px-2 py-1.5 w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none" />
                <button type="button" onClick={handlePersonSearch} disabled={personSearching} className="toolbar-btn toolbar-btn-primary print:hidden">
                  {personSearching ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Search style={{ width: 11, height: 11 }} />}
                  Search
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent space-y-1">
                {personResults.map((p: any) => (
                  <button type="button" key={p.id} onClick={() => handleLinkPerson(p)}
                    className="w-full text-left px-3 py-2 border border-rmpg-700 hover:bg-rmpg-800/40 transition-colors">
                    <div className="text-[11px] font-bold text-rmpg-100">{p.last_name}, {p.first_name}</div>
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
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-modal="true">
          <div className="panel-surface w-full max-w-lg mx-4 my-auto">
            <PanelTitleBar title="New Case" icon={Plus}>
              <IconButton onClick={() => setFormOpen(false)} className="toolbar-btn" aria-label="Close"><X style={{ width: 12, height: 12 }} /></IconButton>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-casemanagementpage-6" className="field-label">Title *</label>
                <input id="ff-casemanagementpage-6" ref={titleInputRef} value={formData.title} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ff-casemanagementpage-7" className="field-label">Type</label>
                  <select id="ff-casemanagementpage-7" value={formData.case_type} onChange={e => setFormData(p => ({ ...p, case_type: e.target.value as CaseType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none">
                    {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-casemanagementpage-8" className="field-label">Priority</label>
                  <select id="ff-casemanagementpage-8" value={formData.priority} onChange={e => setFormData(p => ({ ...p, priority: e.target.value as CasePriority }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none">
                    {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-casemanagementpage-9" className="field-label">Lead Investigator</label>
                  <select id="ff-casemanagementpage-9" value={formData.lead_investigator_id} onChange={e => setFormData(p => ({ ...p, lead_investigator_id: e.target.value }))} disabled={personnelLoading} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none disabled:opacity-60">
                    {personnelLoading ? (
                      <option value="">Loading…</option>
                    ) : (
                      <>
                        <option value="">Unassigned</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </>
                    )}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">Summary</label>
                <RichTextArea value={formData.summary} onChange={e => setFormData(p => ({ ...p, summary: e.target.value }))} rows={3} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none resize-none" />
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

      {/* ── Inline modals — replace previous native window.prompt / confirm
          dialogs. ConfirmDialog handles a11y + Esc-cancel for the binary
          cases; the readiness gates use a fuller surface so the
          missing-fields list can be rendered as a proper bullet list. */}
      <ConfirmDialog
        isOpen={caseToDelete !== null}
        onClose={() => setCaseToDelete(null)}
        onConfirm={confirmDeleteCase}
        title="Delete case"
        message={`Delete case ${caseToDelete?.case_number || ''}? This cannot be undone.`}
        details={caseToDelete?.title ? <span>{caseToDelete.title}</span> : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={caseDeleting}
      />

      <ConfirmDialog
        isOpen={noteToDelete !== null}
        onClose={() => setNoteToDelete(null)}
        onConfirm={confirmDeleteNote}
        title="Delete note"
        message="This will permanently remove this note from the case timeline."
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={noteDeleting === noteToDelete}
      />

      {pendingClose && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPendingClose(null)}
        >
          <div
            className="panel-beveled bg-surface-base p-4 w-[420px] space-y-3"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-case-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden="true" />
              <h3 id="close-case-modal-title" className="text-[12px] font-bold uppercase text-rmpg-100">Close case anyway?</h3>
            </div>
            <p className="text-[11px] text-rmpg-300">
              This case is <span className="font-mono text-amber-400">{pendingClose.percent}% complete</span>.
              Closing now will skip the standard checklist.
            </p>
            {pendingClose.missing.length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">Missing</div>
                <ul className="text-[11px] text-rmpg-200 list-disc list-inside space-y-0.5 max-h-[180px] overflow-y-auto">
                  {pendingClose.missing.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPendingClose(null)} className="toolbar-btn text-[10px]">Cancel</button>
              <button type="button" onClick={() => applyStatusChange(pendingClose.newStatus)} className="toolbar-btn toolbar-btn-primary text-[10px]" disabled={statusChanging}>
                Close anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingReview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPendingReview(null)}
        >
          <div
            className="panel-beveled bg-surface-base p-4 w-[420px] space-y-3"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-case-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden="true" />
              <h3 id="review-case-modal-title" className="text-[12px] font-bold uppercase text-rmpg-100">Submit for review anyway?</h3>
            </div>
            <p className="text-[11px] text-rmpg-300">
              This case is <span className="font-mono text-amber-400">{pendingReview.percent}% complete</span>.
              The supervisor will see the same checklist warning.
            </p>
            {pendingReview.missing.length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">Missing</div>
                <ul className="text-[11px] text-rmpg-200 list-disc list-inside space-y-0.5 max-h-[180px] overflow-y-auto">
                  {pendingReview.missing.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPendingReview(null)} className="toolbar-btn text-[10px]">Cancel</button>
              <button type="button" onClick={applySubmitForReview} className="toolbar-btn toolbar-btn-primary text-[10px]" disabled={reviewSubmitting}>
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {saveViewModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSaveViewModalOpen(false)}
        >
          <div
            className="panel-beveled bg-surface-base p-4 w-[360px] space-y-3"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-view-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="save-view-modal-title" className="text-[12px] font-bold uppercase text-rmpg-100">Save current view</h3>
            <p className="text-[10px] text-rmpg-400">Saves the current filters under a name you can re-open later.</p>
            <input
              type="text"
              autoFocus
              value={saveViewName}
              onChange={(e) => setSaveViewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitSaveView(); }}
              className="w-full bg-surface-sunken border border-border-default px-2 py-1.5 text-[11px] text-rmpg-100"
              placeholder="e.g. My overdue homicides"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSaveViewModalOpen(false)} className="toolbar-btn text-[10px]">Cancel</button>
              <button type="button" onClick={commitSaveView} disabled={!saveViewName.trim()} className="toolbar-btn toolbar-btn-primary text-[10px]">Save view</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
