// ============================================================
// RMPG Flex — Forensic Lab Management Page
// ============================================================
// Split-panel lab case management with exhibit tracking,
// analysis workflow, and timeline logging.
// Consumes /api/forensics endpoints.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, X, Save, Loader2, Microscope, FlaskConical,
  FileText, Clock, ChevronRight, Package, AlertTriangle,
  CheckCircle, RotateCcw, User, Calendar, Tag, ClipboardList,
  Beaker, Activity, Hash,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import SplitPanel from '../components/SplitPanel';
import PanelTitleBar from '../components/PanelTitleBar';
import { formatDateTime, formatDate } from '../utils/dateUtils';

// ── Types ──────────────────────────────────────────────────

interface ForensicCase {
  id: number;
  lab_case_number: string;
  title: string;
  case_type: string;
  status: string;
  priority: string;
  incident_id: number | null;
  evidence_ids: string;
  requesting_officer_id: number | null;
  requesting_officer_name: string | null;
  assigned_examiner_id: number | null;
  assigned_examiner_name: string | null;
  lab_location: string | null;
  synopsis: string | null;
  findings: string | null;
  conclusion: string | null;
  methodology: string | null;
  due_date: string | null;
  received_date: string | null;
  started_date: string | null;
  completed_date: string | null;
  report_date: string | null;
  turnaround_days: number | null;
  notes: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  exhibit_count?: number;
  analysis_count?: number;
  exhibits?: Exhibit[];
  analyses?: Analysis[];
  timeline?: TimelineEntry[];
}

interface Exhibit {
  id: number;
  forensic_case_id: number;
  exhibit_number: string;
  evidence_id: number | null;
  description: string;
  item_type: string | null;
  condition_received: string | null;
  examination_requested: string | null;
  examination_performed: string | null;
  results: string | null;
  status: string | null;
  notes: string | null;
  received_date: string | null;
  returned_date: string | null;
  created_at: string;
  updated_at: string;
}

interface Analysis {
  id: number;
  forensic_case_id: number;
  exhibit_id: number | null;
  analysis_type: string;
  examiner_id: number | null;
  examiner_name: string | null;
  status: string;
  methodology: string | null;
  instruments_used: string | null;
  results: string | null;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface TimelineEntry {
  id: number;
  forensic_case_id: number;
  action: string;
  description: string;
  performed_by: number;
  performed_by_name: string;
  created_at: string;
}

interface ListResponse {
  data: ForensicCase[];
  total: number;
  page: number;
  limit: number;
}

// ── Status / Priority Maps ─────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  submitted:     { bg: '#1a3a5e', text: '#5ba3e6', border: '#2a5a8e' },
  assigned:      { bg: '#1a3a5e', text: '#5ba3e6', border: '#2a5a8e' },
  in_progress:   { bg: '#1a4a2e', text: '#4dd0a0', border: '#2a6a4e' },
  analysis:      { bg: '#3a2a1a', text: '#ffb74d', border: '#5a4a2a' },
  review:        { bg: '#3a1a3a', text: '#ce93d8', border: '#5a2a5a' },
  report_draft:  { bg: '#2a2a1a', text: '#e6c85b', border: '#4a4a2a' },
  report_final:  { bg: '#1a4a1a', text: '#66bb6a', border: '#2a6a2a' },
  closed:        { bg: '#1a2a1a', text: '#81c784', border: '#2a4a2a' },
  cancelled:     { bg: '#2a1a1a', text: '#ef5350', border: '#4a2a2a' },
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  rush:      { bg: '#4a1a1a', text: '#ff5252' },
  urgent:    { bg: '#4a2a1a', text: '#ff9800' },
  expedited: { bg: '#3a3a1a', text: '#ffeb3b' },
  routine:   { bg: '#1a2a3a', text: '#7a8a9a' },
};

const CASE_TYPES = ['digital', 'dna', 'fingerprint', 'toxicology', 'ballistics', 'trace', 'document', 'other'];
const STATUSES = ['submitted', 'assigned', 'in_progress', 'analysis', 'review', 'report_draft', 'report_final', 'closed', 'cancelled'];
const PRIORITIES = ['rush', 'urgent', 'expedited', 'routine'];

const ANALYSIS_TYPES = [
  'Digital Forensics', 'DNA Analysis', 'Fingerprint Analysis', 'Toxicology',
  'Ballistics', 'Trace Evidence', 'Document Examination', 'Drug Analysis',
  'Serology', 'Fiber Analysis', 'Tool Mark Analysis', 'Other',
];

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Component ──────────────────────────────────────────────

export default function ForensicsLabPage() {
  const { user } = useAuth();

  // List state
  const [cases, setCases] = useState<ForensicCase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  // Detail state
  const [selectedCase, setSelectedCase] = useState<ForensicCase | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'exhibits' | 'analyses' | 'timeline'>('overview');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: '', case_type: 'digital', priority: 'routine',
    requesting_officer_name: '', assigned_examiner_name: '',
    lab_location: '', synopsis: '', due_date: '', notes: '',
  });
  const [creating, setCreating] = useState(false);

  // Editing state for overview
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<ForensicCase>>({});
  const [saving, setSaving] = useState(false);

  // Exhibit add form
  const [showAddExhibit, setShowAddExhibit] = useState(false);
  const [exhibitForm, setExhibitForm] = useState({
    description: '', item_type: '', condition_received: '', examination_requested: '', notes: '',
  });

  // Analysis add form
  const [showAddAnalysis, setShowAddAnalysis] = useState(false);
  const [analysisForm, setAnalysisForm] = useState({
    analysis_type: '', examiner_name: '', methodology: '', instruments_used: '', notes: '',
  });

  // ── Data Fetching ──────────────────────────────────────────

  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (searchQuery) params.set('search', searchQuery);
      params.set('page', String(page));
      params.set('limit', '50');
      const qs = params.toString();
      const res = await apiFetch<ListResponse>(`/forensics?${qs}`);
      setCases(res.data);
      setTotal(res.total);
    } catch (err) {
      console.error('Failed to load forensic cases:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, page]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  const fetchDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await apiFetch<ForensicCase>(`/forensics/${id}`);
      setSelectedCase(res);
      setEditing(false);
    } catch (err) {
      console.error('Failed to load case detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleSelectCase = (c: ForensicCase) => {
    setSelectedCase(c);
    setActiveTab('overview');
    setEditing(false);
    fetchDetail(c.id);
  };

  // ── Search with debounce ───────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── CRUD Operations ────────────────────────────────────────

  const handleCreate = async () => {
    if (!createForm.title.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<ForensicCase>('/forensics', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      setShowCreate(false);
      setCreateForm({
        title: '', case_type: 'digital', priority: 'routine',
        requesting_officer_name: '', assigned_examiner_name: '',
        lab_location: '', synopsis: '', due_date: '', notes: '',
      });
      fetchCases();
      handleSelectCase(res);
    } catch (err) {
      console.error('Create case failed:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedCase) return;
    setSaving(true);
    try {
      await apiFetch(`/forensics/${selectedCase.id}`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });
      fetchDetail(selectedCase.id);
      fetchCases();
      setEditing(false);
    } catch (err) {
      console.error('Update case failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAddExhibit = async () => {
    if (!selectedCase || !exhibitForm.description.trim()) return;
    try {
      await apiFetch(`/forensics/${selectedCase.id}/exhibits`, {
        method: 'POST',
        body: JSON.stringify(exhibitForm),
      });
      setShowAddExhibit(false);
      setExhibitForm({ description: '', item_type: '', condition_received: '', examination_requested: '', notes: '' });
      fetchDetail(selectedCase.id);
    } catch (err) {
      console.error('Add exhibit failed:', err);
    }
  };

  const handleAddAnalysis = async () => {
    if (!selectedCase || !analysisForm.analysis_type) return;
    try {
      await apiFetch(`/forensics/${selectedCase.id}/analyses`, {
        method: 'POST',
        body: JSON.stringify(analysisForm),
      });
      setShowAddAnalysis(false);
      setAnalysisForm({ analysis_type: '', examiner_name: '', methodology: '', instruments_used: '', notes: '' });
      fetchDetail(selectedCase.id);
    } catch (err) {
      console.error('Add analysis failed:', err);
    }
  };

  const startEditing = () => {
    if (!selectedCase) return;
    setEditForm({
      title: selectedCase.title,
      case_type: selectedCase.case_type,
      status: selectedCase.status,
      priority: selectedCase.priority,
      requesting_officer_name: selectedCase.requesting_officer_name || '',
      assigned_examiner_name: selectedCase.assigned_examiner_name || '',
      lab_location: selectedCase.lab_location || '',
      synopsis: selectedCase.synopsis || '',
      findings: selectedCase.findings || '',
      conclusion: selectedCase.conclusion || '',
      methodology: selectedCase.methodology || '',
      due_date: selectedCase.due_date || '',
      notes: selectedCase.notes || '',
    });
    setEditing(true);
  };

  // ── Status Badge ───────────────────────────────────────────

  const StatusBadgeInline = ({ status }: { status: string }) => {
    const c = STATUS_COLORS[status] || STATUS_COLORS.submitted;
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      >
        {statusLabel(status)}
      </span>
    );
  };

  const PriorityBadge = ({ priority }: { priority: string }) => {
    const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS.routine;
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
        style={{ background: c.bg, color: c.text }}
      >
        {priority}
      </span>
    );
  };

  // ── Left Panel: Case List ──────────────────────────────────

  const leftPanel = (
    <div className="h-full flex flex-col" style={{ background: '#0d1520' }}>
      <PanelTitleBar title="Forensic Lab Cases" icon={Microscope}>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
          style={{ background: '#1a5a9e', color: '#fff', border: '1px solid #2a6aae' }}
        >
          <Plus size={11} /> New Case
        </button>
      </PanelTitleBar>

      {/* Filters */}
      <div className="flex-shrink-0 p-2 space-y-1.5" style={{ borderBottom: '1px solid #1e3048' }}>
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#5a6a7a]" />
          <input
            type="text"
            placeholder="Search cases..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="w-full pl-7 pr-7 py-1.5 text-xs rounded-sm"
            style={{ background: '#141e2b', border: '1px solid #1e3048', color: '#c8d8e8', outline: 'none' }}
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setSearchQuery(''); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5a6a7a] hover:text-white"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => { setStatusFilter(''); setPage(1); }}
            className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{
              background: !statusFilter ? 'rgba(26, 90, 158, 0.3)' : 'transparent',
              color: !statusFilter ? '#5ba3e6' : '#5a6a7a',
              border: `1px solid ${!statusFilter ? '#2a5a8e' : '#1e3048'}`,
            }}
          >
            All ({total})
          </button>
          {['submitted', 'in_progress', 'analysis', 'review', 'closed'].map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
              style={{
                background: statusFilter === s ? (STATUS_COLORS[s]?.bg || '#1a2636') : 'transparent',
                color: statusFilter === s ? (STATUS_COLORS[s]?.text || '#aaa') : '#5a6a7a',
                border: `1px solid ${statusFilter === s ? (STATUS_COLORS[s]?.border || '#2a3e58') : '#1e3048'}`,
              }}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {/* Case List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-[#5a6a7a]" size={20} />
          </div>
        ) : cases.length === 0 ? (
          <div className="text-center py-12 text-[#5a6a7a] text-xs">
            No forensic cases found
          </div>
        ) : (
          cases.map(c => (
            <button
              key={c.id}
              onClick={() => handleSelectCase(c)}
              className="w-full text-left px-3 py-2.5 transition-colors"
              style={{
                background: selectedCase?.id === c.id ? 'rgba(26, 90, 158, 0.15)' : 'transparent',
                borderBottom: '1px solid #141e2b',
                borderLeft: selectedCase?.id === c.id ? '2px solid #1a5a9e' : '2px solid transparent',
              }}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-mono font-bold" style={{ color: '#5ba3e6' }}>
                  {c.lab_case_number}
                </span>
                <StatusBadgeInline status={c.status} />
              </div>
              <div className="text-xs text-white/90 truncate mb-0.5">{c.title}</div>
              <div className="flex items-center gap-2 text-[10px] text-[#5a6a7a]">
                <span className="flex items-center gap-0.5">
                  <Tag size={9} /> {c.case_type}
                </span>
                {c.assigned_examiner_name && (
                  <span className="flex items-center gap-0.5">
                    <User size={9} /> {c.assigned_examiner_name}
                  </span>
                )}
                {(c.exhibit_count ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Package size={9} /> {c.exhibit_count}
                  </span>
                )}
                <PriorityBadge priority={c.priority} />
              </div>
            </button>
          ))
        )}
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 text-[10px]"
          style={{ borderTop: '1px solid #1e3048', color: '#5a6a7a' }}
        >
          <span>Page {page} of {Math.ceil(total / 50)}</span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-2 py-0.5 rounded-sm disabled:opacity-30"
              style={{ background: '#141e2b', border: '1px solid #1e3048', color: '#7a8a9a' }}
            >
              Prev
            </button>
            <button
              disabled={page >= Math.ceil(total / 50)}
              onClick={() => setPage(p => p + 1)}
              className="px-2 py-0.5 rounded-sm disabled:opacity-30"
              style={{ background: '#141e2b', border: '1px solid #1e3048', color: '#7a8a9a' }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ── Right Panel: Detail View ───────────────────────────────

  const tabs: { key: typeof activeTab; label: string; icon: React.ElementType }[] = [
    { key: 'overview', label: 'Overview', icon: FileText },
    { key: 'exhibits', label: 'Exhibits', icon: Package },
    { key: 'analyses', label: 'Analyses', icon: Beaker },
    { key: 'timeline', label: 'Timeline', icon: Clock },
  ];

  const rightPanel = (
    <div className="h-full flex flex-col" style={{ background: '#0d1520' }}>
      {!selectedCase ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-[#3a4a5a]">
            <Microscope size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">Select a case to view details</p>
          </div>
        </div>
      ) : (
        <>
          {/* Detail Header */}
          <PanelTitleBar title={selectedCase.lab_case_number} icon={FlaskConical}>
            <StatusBadgeInline status={selectedCase.status} />
            <PriorityBadge priority={selectedCase.priority} />
          </PanelTitleBar>

          {/* Tabs */}
          <div
            className="flex-shrink-0 flex"
            style={{ borderBottom: '1px solid #1e3048', background: '#111c28' }}
          >
            {tabs.map(t => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className="flex items-center gap-1 px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors"
                  style={{
                    color: active ? '#fff' : '#5a6a7a',
                    borderBottom: active ? '2px solid #1a5a9e' : '2px solid transparent',
                    background: active ? 'rgba(26, 90, 158, 0.1)' : 'transparent',
                  }}
                >
                  <Icon size={12} /> {t.label}
                  {t.key === 'exhibits' && selectedCase.exhibits && (
                    <span className="ml-0.5 text-[9px] opacity-60">({selectedCase.exhibits.length})</span>
                  )}
                  {t.key === 'analyses' && selectedCase.analyses && (
                    <span className="ml-0.5 text-[9px] opacity-60">({selectedCase.analyses.length})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto min-h-0 p-3">
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-[#5a6a7a]" size={20} />
              </div>
            ) : (
              <>
                {activeTab === 'overview' && renderOverview()}
                {activeTab === 'exhibits' && renderExhibits()}
                {activeTab === 'analyses' && renderAnalyses()}
                {activeTab === 'timeline' && renderTimeline()}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

  // ── Overview Tab ───────────────────────────────────────────

  function renderOverview() {
    if (!selectedCase) return null;

    if (editing) {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#7a8a9a]">Edit Case</h3>
            <div className="flex gap-1">
              <button
                onClick={() => setEditing(false)}
                className="px-2 py-1 text-[10px] font-bold uppercase rounded-sm"
                style={{ background: '#1a2636', color: '#7a8a9a', border: '1px solid #1e3048' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase rounded-sm"
                style={{ background: '#1a5a9e', color: '#fff', border: '1px solid #2a6aae' }}
              >
                {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
              </button>
            </div>
          </div>

          {renderFormField('Title', 'title', editForm.title || '', (v) => setEditForm(f => ({ ...f, title: v })))}
          <div className="grid grid-cols-2 gap-2">
            {renderSelectField('Status', 'status', editForm.status || '', STATUSES, (v) => setEditForm(f => ({ ...f, status: v })))}
            {renderSelectField('Priority', 'priority', editForm.priority || '', PRIORITIES, (v) => setEditForm(f => ({ ...f, priority: v })))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {renderSelectField('Case Type', 'case_type', editForm.case_type || '', CASE_TYPES, (v) => setEditForm(f => ({ ...f, case_type: v })))}
            {renderFormField('Due Date', 'due_date', editForm.due_date || '', (v) => setEditForm(f => ({ ...f, due_date: v })), 'date')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {renderFormField('Requesting Officer', 'req_officer', editForm.requesting_officer_name || '', (v) => setEditForm(f => ({ ...f, requesting_officer_name: v })))}
            {renderFormField('Assigned Examiner', 'examiner', editForm.assigned_examiner_name || '', (v) => setEditForm(f => ({ ...f, assigned_examiner_name: v })))}
          </div>
          {renderFormField('Lab Location', 'lab_loc', editForm.lab_location || '', (v) => setEditForm(f => ({ ...f, lab_location: v })))}
          {renderTextareaField('Synopsis', 'synopsis', editForm.synopsis || '', (v) => setEditForm(f => ({ ...f, synopsis: v })))}
          {renderTextareaField('Findings', 'findings', editForm.findings || '', (v) => setEditForm(f => ({ ...f, findings: v })))}
          {renderTextareaField('Conclusion', 'conclusion', editForm.conclusion || '', (v) => setEditForm(f => ({ ...f, conclusion: v })))}
          {renderTextareaField('Methodology', 'methodology', editForm.methodology || '', (v) => setEditForm(f => ({ ...f, methodology: v })))}
          {renderTextareaField('Notes', 'notes', editForm.notes || '', (v) => setEditForm(f => ({ ...f, notes: v })))}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-white">{selectedCase.title}</h3>
          <button
            onClick={startEditing}
            className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ background: '#1a2636', color: '#5ba3e6', border: '1px solid #1e3048' }}
          >
            Edit
          </button>
        </div>

        {/* Info Grid */}
        <div
          className="rounded-sm p-3 space-y-2"
          style={{ background: '#141e2b', border: '1px solid #1e3048' }}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <InfoRow label="Case Number" value={selectedCase.lab_case_number} mono />
            <InfoRow label="Case Type" value={selectedCase.case_type} />
            <InfoRow label="Status" value={<StatusBadgeInline status={selectedCase.status} />} />
            <InfoRow label="Priority" value={<PriorityBadge priority={selectedCase.priority} />} />
            <InfoRow label="Requesting Officer" value={selectedCase.requesting_officer_name || '—'} />
            <InfoRow label="Assigned Examiner" value={selectedCase.assigned_examiner_name || '—'} />
            <InfoRow label="Lab Location" value={selectedCase.lab_location || '—'} />
            <InfoRow label="Due Date" value={selectedCase.due_date ? formatDate(selectedCase.due_date) : '—'} />
            <InfoRow label="Received" value={selectedCase.received_date ? formatDate(selectedCase.received_date) : '—'} />
            <InfoRow label="Started" value={selectedCase.started_date ? formatDate(selectedCase.started_date) : '—'} />
            <InfoRow label="Completed" value={selectedCase.completed_date ? formatDate(selectedCase.completed_date) : '—'} />
            <InfoRow label="Turnaround" value={selectedCase.turnaround_days != null ? `${selectedCase.turnaround_days} days` : '—'} />
          </div>
        </div>

        {/* Synopsis */}
        {selectedCase.synopsis && (
          <DetailSection title="Synopsis" icon={ClipboardList}>
            <p className="text-xs text-[#b0c0d0] whitespace-pre-wrap">{selectedCase.synopsis}</p>
          </DetailSection>
        )}

        {/* Findings */}
        {selectedCase.findings && (
          <DetailSection title="Findings" icon={FileText}>
            <p className="text-xs text-[#b0c0d0] whitespace-pre-wrap">{selectedCase.findings}</p>
          </DetailSection>
        )}

        {/* Conclusion */}
        {selectedCase.conclusion && (
          <DetailSection title="Conclusion" icon={CheckCircle}>
            <p className="text-xs text-[#b0c0d0] whitespace-pre-wrap">{selectedCase.conclusion}</p>
          </DetailSection>
        )}

        {/* Methodology */}
        {selectedCase.methodology && (
          <DetailSection title="Methodology" icon={Activity}>
            <p className="text-xs text-[#b0c0d0] whitespace-pre-wrap">{selectedCase.methodology}</p>
          </DetailSection>
        )}

        {/* Notes */}
        {selectedCase.notes && (
          <DetailSection title="Notes" icon={FileText}>
            <p className="text-xs text-[#b0c0d0] whitespace-pre-wrap">{selectedCase.notes}</p>
          </DetailSection>
        )}

        {/* Dates */}
        <div
          className="rounded-sm p-2.5 text-[10px] text-[#5a6a7a]"
          style={{ background: '#0d1520', border: '1px solid #141e2b' }}
        >
          Created: {formatDateTime(selectedCase.created_at)} | Updated: {formatDateTime(selectedCase.updated_at)}
        </div>
      </div>
    );
  }

  // ── Exhibits Tab ───────────────────────────────────────────

  function renderExhibits() {
    if (!selectedCase) return null;
    const exhibits = selectedCase.exhibits || [];

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#7a8a9a]">
            Exhibits ({exhibits.length})
          </h3>
          <button
            onClick={() => setShowAddExhibit(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
            style={{ background: '#1a5a9e', color: '#fff', border: '1px solid #2a6aae' }}
          >
            <Plus size={10} /> Add Exhibit
          </button>
        </div>

        {/* Add Exhibit Form */}
        {showAddExhibit && (
          <div className="rounded-sm p-3 space-y-2" style={{ background: '#141e2b', border: '1px solid #1e3048' }}>
            <h4 className="text-[11px] font-bold uppercase text-[#5ba3e6]">New Exhibit</h4>
            {renderFormField('Description *', 'ex_desc', exhibitForm.description, (v) => setExhibitForm(f => ({ ...f, description: v })))}
            <div className="grid grid-cols-2 gap-2">
              {renderFormField('Item Type', 'ex_type', exhibitForm.item_type, (v) => setExhibitForm(f => ({ ...f, item_type: v })))}
              {renderFormField('Condition Received', 'ex_cond', exhibitForm.condition_received, (v) => setExhibitForm(f => ({ ...f, condition_received: v })))}
            </div>
            {renderFormField('Examination Requested', 'ex_exam', exhibitForm.examination_requested, (v) => setExhibitForm(f => ({ ...f, examination_requested: v })))}
            {renderTextareaField('Notes', 'ex_notes', exhibitForm.notes, (v) => setExhibitForm(f => ({ ...f, notes: v })))}
            <div className="flex gap-1 justify-end">
              <button
                onClick={() => setShowAddExhibit(false)}
                className="px-2 py-1 text-[10px] font-bold uppercase rounded-sm"
                style={{ background: '#1a2636', color: '#7a8a9a', border: '1px solid #1e3048' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddExhibit}
                disabled={!exhibitForm.description.trim()}
                className="px-2 py-1 text-[10px] font-bold uppercase rounded-sm disabled:opacity-40"
                style={{ background: '#1a5a9e', color: '#fff', border: '1px solid #2a6aae' }}
              >
                Add
              </button>
            </div>
          </div>
        )}

        {exhibits.length === 0 ? (
          <div className="text-center py-8 text-[#3a4a5a] text-xs">No exhibits recorded</div>
        ) : (
          exhibits.map(ex => (
            <div
              key={ex.id}
              className="rounded-sm p-3"
              style={{ background: '#141e2b', border: '1px solid #1e3048' }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 text-[11px] font-bold rounded-sm"
                    style={{ background: '#1a3a5e', color: '#5ba3e6', border: '1px solid #2a5a8e' }}
                  >
                    {ex.exhibit_number}
                  </span>
                  <span className="text-xs font-bold text-white">{ex.description}</span>
                </div>
                {ex.status && <StatusBadgeInline status={ex.status} />}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-[#7a8a9a]">
                {ex.item_type && <span>Type: {ex.item_type}</span>}
                {ex.condition_received && <span>Condition: {ex.condition_received}</span>}
                {ex.examination_requested && <span>Exam Requested: {ex.examination_requested}</span>}
                {ex.examination_performed && <span>Exam Performed: {ex.examination_performed}</span>}
                {ex.received_date && <span>Received: {formatDate(ex.received_date)}</span>}
                {ex.returned_date && <span>Returned: {formatDate(ex.returned_date)}</span>}
              </div>
              {ex.results && (
                <div className="mt-1.5 pt-1.5 text-xs text-[#b0c0d0]" style={{ borderTop: '1px solid #1e3048' }}>
                  <span className="text-[10px] font-bold uppercase text-[#5a6a7a]">Results: </span>
                  {ex.results}
                </div>
              )}
              {ex.notes && (
                <div className="mt-1 text-[10px] text-[#5a6a7a] italic">{ex.notes}</div>
              )}
            </div>
          ))
        )}
      </div>
    );
  }

  // ── Analyses Tab ───────────────────────────────────────────

  function renderAnalyses() {
    if (!selectedCase) return null;
    const analyses = selectedCase.analyses || [];

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#7a8a9a]">
            Analyses ({analyses.length})
          </h3>
          <button
            onClick={() => setShowAddAnalysis(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
            style={{ background: '#1a5a9e', color: '#fff', border: '1px solid #2a6aae' }}
          >
            <Plus size={10} /> New Analysis
          </button>
        </div>

        {/* Add Analysis Form */}
        {showAddAnalysis && (
          <div className="rounded-sm p-3 space-y-2" style={{ background: '#141e2b', border: '1px solid #1e3048' }}>
            <h4 className="text-[11px] font-bold uppercase text-[#5ba3e6]">New Analysis</h4>
            {renderSelectField('Analysis Type *', 'an_type', analysisForm.analysis_type, ANALYSIS_TYPES, (v) => setAnalysisForm(f => ({ ...f, analysis_type: v })))}
            {renderFormField('Examiner Name', 'an_exam', analysisForm.examiner_name, (v) => setAnalysisForm(f => ({ ...f, examiner_name: v })))}
            {renderTextareaField('Methodology', 'an_meth', analysisForm.methodology, (v) => setAnalysisForm(f => ({ ...f, methodology: v })))}
            {renderFormField('Instruments Used', 'an_inst', analysisForm.instruments_used, (v) => setAnalysisForm(f => ({ ...f, instruments_used: v })))}
            {renderTextareaField('Notes', 'an_notes', analysisForm.notes, (v) => setAnalysisForm(f => ({ ...f, notes: v })))}
            <div className="flex gap-1 justify-end">
              <button
                onClick={() => setShowAddAnalysis(false)}
                className="px-2 py-1 text-[10px] font-bold uppercase rounded-sm"
                style={{ background: '#1a2636', color: '#7a8a9a', border: '1px solid #1e3048' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddAnalysis}
                disabled={!analysisForm.analysis_type}
                className="px-2 py-1 text-[10px] font-bold uppercase rounded-sm disabled:opacity-40"
                style={{ background: '#1a5a9e', color: '#fff', border: '1px solid #2a6aae' }}
              >
                Create
              </button>
            </div>
          </div>
        )}

        {analyses.length === 0 ? (
          <div className="text-center py-8 text-[#3a4a5a] text-xs">No analyses recorded</div>
        ) : (
          analyses.map(an => (
            <div
              key={an.id}
              className="rounded-sm p-3"
              style={{ background: '#141e2b', border: '1px solid #1e3048' }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white">{an.analysis_type}</span>
                <StatusBadgeInline status={an.status} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-[#7a8a9a]">
                {an.examiner_name && <span>Examiner: {an.examiner_name}</span>}
                {an.methodology && <span>Method: {an.methodology}</span>}
                {an.instruments_used && <span>Instruments: {an.instruments_used}</span>}
                {an.started_at && <span>Started: {formatDateTime(an.started_at)}</span>}
                {an.completed_at && <span>Completed: {formatDateTime(an.completed_at)}</span>}
              </div>
              {an.results && (
                <div className="mt-1.5 pt-1.5 text-xs text-[#b0c0d0]" style={{ borderTop: '1px solid #1e3048' }}>
                  <span className="text-[10px] font-bold uppercase text-[#5a6a7a]">Results: </span>
                  {an.results}
                </div>
              )}
              {an.conclusion && (
                <div className="mt-1 text-xs text-[#b0c0d0]">
                  <span className="text-[10px] font-bold uppercase text-[#5a6a7a]">Conclusion: </span>
                  {an.conclusion}
                </div>
              )}
              {an.notes && (
                <div className="mt-1 text-[10px] text-[#5a6a7a] italic">{an.notes}</div>
              )}
            </div>
          ))
        )}
      </div>
    );
  }

  // ── Timeline Tab ───────────────────────────────────────────

  function renderTimeline() {
    if (!selectedCase) return null;
    const timeline = selectedCase.timeline || [];

    const actionColors: Record<string, string> = {
      created: '#4dd0a0',
      status_change: '#5ba3e6',
      assigned: '#ce93d8',
      exhibit_added: '#ffb74d',
      analysis_created: '#ff9800',
      analysis_update: '#ff9800',
      hash_computed: '#90caf9',
      hash_added: '#90caf9',
      hash_flagged: '#ff5252',
      hash_unflagged: '#81c784',
      evidence_linked: '#4fc3f7',
      evidence_unlinked: '#ef5350',
      note: '#7a8a9a',
    };

    return (
      <div className="space-y-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#7a8a9a] mb-2">
          Activity Timeline ({timeline.length})
        </h3>

        {timeline.length === 0 ? (
          <div className="text-center py-8 text-[#3a4a5a] text-xs">No activity recorded</div>
        ) : (
          <div className="relative pl-4">
            {/* Vertical line */}
            <div
              className="absolute left-[7px] top-0 bottom-0 w-px"
              style={{ background: '#1e3048' }}
            />
            {timeline.map(entry => (
              <div key={entry.id} className="relative pb-3">
                {/* Dot */}
                <div
                  className="absolute left-[-13px] top-1 w-2.5 h-2.5 rounded-full"
                  style={{
                    background: actionColors[entry.action] || '#5a6a7a',
                    border: '2px solid #0d1520',
                  }}
                />
                <div className="ml-2">
                  <div className="text-[10px] text-[#5a6a7a] mb-0.5">
                    {formatDateTime(entry.created_at)}
                    <span className="ml-2 text-[#7a8a9a]">{entry.performed_by_name}</span>
                  </div>
                  <div className="text-xs text-[#b0c0d0]">{entry.description}</div>
                  <div
                    className="inline-block mt-0.5 px-1 py-0 text-[9px] font-bold uppercase tracking-wider rounded-sm"
                    style={{
                      color: actionColors[entry.action] || '#5a6a7a',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    {entry.action.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Reusable Form Fields ───────────────────────────────────

  function renderFormField(
    label: string, id: string, value: string,
    onChange: (v: string) => void, type = 'text',
  ) {
    return (
      <div>
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6a7a] mb-0.5">
          {label}
        </label>
        <input
          id={id}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded-sm"
          style={{ background: '#0d1520', border: '1px solid #1e3048', color: '#c8d8e8', outline: 'none' }}
        />
      </div>
    );
  }

  function renderSelectField(
    label: string, id: string, value: string,
    options: string[], onChange: (v: string) => void,
  ) {
    return (
      <div>
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6a7a] mb-0.5">
          {label}
        </label>
        <select
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded-sm"
          style={{ background: '#0d1520', border: '1px solid #1e3048', color: '#c8d8e8', outline: 'none' }}
        >
          <option value="">— Select —</option>
          {options.map(o => (
            <option key={o} value={o}>{statusLabel(o)}</option>
          ))}
        </select>
      </div>
    );
  }

  function renderTextareaField(
    label: string, id: string, value: string,
    onChange: (v: string) => void,
  ) {
    return (
      <div>
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6a7a] mb-0.5">
          {label}
        </label>
        <textarea
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          className="w-full px-2 py-1.5 text-xs rounded-sm resize-y"
          style={{ background: '#0d1520', border: '1px solid #1e3048', color: '#c8d8e8', outline: 'none' }}
        />
      </div>
    );
  }

  // ── Create Case Modal ──────────────────────────────────────

  const createModal = showCreate && (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="w-full max-w-lg rounded-sm overflow-hidden"
        style={{ background: '#141e2b', border: '1px solid #1e3048' }}
      >
        <PanelTitleBar title="New Forensic Lab Case" icon={Microscope}>
          <button onClick={() => setShowCreate(false)} className="text-[#5a6a7a] hover:text-white">
            <X size={14} />
          </button>
        </PanelTitleBar>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {renderFormField('Title *', 'cr_title', createForm.title, (v) => setCreateForm(f => ({ ...f, title: v })))}
          <div className="grid grid-cols-2 gap-2">
            {renderSelectField('Case Type', 'cr_type', createForm.case_type, CASE_TYPES, (v) => setCreateForm(f => ({ ...f, case_type: v })))}
            {renderSelectField('Priority', 'cr_pri', createForm.priority, PRIORITIES, (v) => setCreateForm(f => ({ ...f, priority: v })))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {renderFormField('Requesting Officer', 'cr_officer', createForm.requesting_officer_name, (v) => setCreateForm(f => ({ ...f, requesting_officer_name: v })))}
            {renderFormField('Assigned Examiner', 'cr_examiner', createForm.assigned_examiner_name, (v) => setCreateForm(f => ({ ...f, assigned_examiner_name: v })))}
          </div>
          {renderFormField('Lab Location', 'cr_lab', createForm.lab_location, (v) => setCreateForm(f => ({ ...f, lab_location: v })))}
          {renderFormField('Due Date', 'cr_due', createForm.due_date, (v) => setCreateForm(f => ({ ...f, due_date: v })), 'date')}
          {renderTextareaField('Synopsis', 'cr_synopsis', createForm.synopsis, (v) => setCreateForm(f => ({ ...f, synopsis: v })))}
          {renderTextareaField('Notes', 'cr_notes', createForm.notes, (v) => setCreateForm(f => ({ ...f, notes: v })))}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid #1e3048' }}>
          <button
            onClick={() => setShowCreate(false)}
            className="px-3 py-1.5 text-[11px] font-bold uppercase rounded-sm"
            style={{ background: '#1a2636', color: '#7a8a9a', border: '1px solid #1e3048' }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !createForm.title.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase rounded-sm disabled:opacity-40"
            style={{ background: '#1a5a9e', color: '#fff', border: '1px solid #2a6aae' }}
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create Case
          </button>
        </div>
      </div>
    </div>
  );

  // ── Main Render ────────────────────────────────────────────

  return (
    <div className="h-full app-grid-bg">
      <SplitPanel
        left={leftPanel}
        right={rightPanel}
        initialRatio={0.35}
        minLeftPx={300}
        minRightPx={400}
        rightVisible={true}
        persistKey="forensics-lab"
        leftLabel="Cases"
        rightLabel="Detail"
      />
      {createModal}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#5a6a7a]">{label}</span>
      <span className={`text-xs text-[#c8d8e8] ${mono ? 'font-mono' : ''}`}>{value}</span>
    </>
  );
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-sm p-3" style={{ background: '#141e2b', border: '1px solid #1e3048' }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} className="text-[#5a6a7a]" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#5a6a7a]">{title}</span>
      </div>
      {children}
    </div>
  );
}
