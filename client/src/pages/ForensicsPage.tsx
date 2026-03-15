// ============================================================
// RMPG Flex — Forensic Lab Management Page
// ============================================================
// Full forensic case management with exhibit tracking, analysis
// workflow, examiner assignment, hashing, evidence linkage,
// and timeline logging.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Microscope, Search, Plus, Loader2, User, Clock, FileText,
  X, Save, AlertTriangle, CheckCircle, Package, FlaskConical,
  ChevronDown, ChevronRight, RefreshCw, Target, Hash,
  Clipboard, ArrowRight, Calendar, MapPin, MessageSquare, Tag,
  Eye, Trash2, Edit2, Shield, Copy, Flag, FileDigit, Link,
  Video, Car, FileArchive, Radio, Users, BookOpen,
  Activity, ChevronUp, ExternalLink, Zap,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';

// ─── Types ──────────────────────────────────────────────

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
  received_date: string | null;
  due_date: string | null;
  started_date: string | null;
  completed_date: string | null;
  report_date: string | null;
  turnaround_days: number | null;
  notes: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  exhibit_count?: number;
  analysis_count?: number;
  exhibits?: ForensicExhibit[];
  analyses?: ForensicAnalysis[];
  timeline?: TimelineEntry[];
}

interface ForensicExhibit {
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
  status: string;
  received_date: string | null;
  returned_date: string | null;
  notes: string | null;
}

interface ForensicAnalysis {
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
}

interface TimelineEntry {
  id: number;
  forensic_case_id: number;
  action: string;
  description: string | null;
  performed_by: number | null;
  performed_by_name: string | null;
  created_at: string;
}

interface HashRecord {
  id: number;
  forensic_case_id: number;
  exhibit_id: number | null;
  evidence_id: number | null;
  attachment_id: number | null;
  file_name: string;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  md5: string | null;
  sha1: string | null;
  sha256: string | null;
  sha512: string | null;
  dhash: string | null;
  hash_set_match: number;
  hash_set_name: string | null;
  hash_set_category: string | null;
  match_confidence: number | null;
  flagged: number;
  flag_reason: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  notes: string | null;
  exhibit_number?: string;
  exhibit_description?: string;
  created_at: string;
  updated_at: string | null;
}

interface LinkedRecord {
  id: number;
  forensic_case_id: number;
  linked_type: string;
  linked_id: number;
  relationship: string;
  relevance: string;
  notes: string | null;
  linked_by: number;
  linked_by_name: string | null;
  linked_at: string;
  resolved: {
    display_name: string;
    display_detail: string;
    icon: string;
    [key: string]: any;
  } | null;
}

interface LabStats {
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
  total: number;
  overdue: number;
}

// ─── Constants ──────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted', color: 'bg-blue-900/50 text-blue-400 border-blue-700/50', step: 1 },
  { value: 'intake', label: 'Intake', color: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50', step: 2 },
  { value: 'assigned', label: 'Assigned', color: 'bg-indigo-900/50 text-indigo-400 border-indigo-700/50', step: 3 },
  { value: 'in_progress', label: 'In Progress', color: 'bg-amber-900/50 text-amber-400 border-amber-700/50', step: 4 },
  { value: 'analysis_complete', label: 'Analysis Done', color: 'bg-teal-900/50 text-teal-400 border-teal-700/50', step: 5 },
  { value: 'report_draft', label: 'Report Draft', color: 'bg-purple-900/50 text-purple-400 border-purple-700/50', step: 6 },
  { value: 'report_final', label: 'Report Final', color: 'bg-green-900/50 text-green-400 border-green-700/50', step: 7 },
  { value: 'closed', label: 'Closed', color: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50', step: 8 },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-900/50 text-red-400 border-red-700/50', step: 0 },
];

const TYPE_OPTIONS = [
  { value: 'digital', label: 'Digital' },
  { value: 'biological', label: 'Biological' },
  { value: 'chemical', label: 'Chemical' },
  { value: 'ballistics', label: 'Ballistics' },
  { value: 'latent_prints', label: 'Latent Prints' },
  { value: 'questioned_documents', label: 'Documents' },
  { value: 'trace', label: 'Trace' },
  { value: 'toxicology', label: 'Toxicology' },
  { value: 'dna', label: 'DNA' },
  { value: 'firearms', label: 'Firearms' },
  { value: 'other', label: 'Other' },
];

const PRIORITY_OPTIONS = [
  { value: 'routine', label: 'Routine', color: 'text-rmpg-400', bg: 'bg-rmpg-800/50' },
  { value: 'expedited', label: 'Expedited', color: 'text-blue-400', bg: 'bg-blue-950/40' },
  { value: 'urgent', label: 'Urgent', color: 'text-amber-400', bg: 'bg-amber-950/40' },
  { value: 'rush', label: 'Rush', color: 'text-red-400', bg: 'bg-red-950/40' },
];

const ANALYSIS_TYPES = [
  { value: 'dna', label: 'DNA' },
  { value: 'fingerprint', label: 'Fingerprint' },
  { value: 'drug_analysis', label: 'Drug Analysis' },
  { value: 'digital_extraction', label: 'Digital Extraction' },
  { value: 'ballistics', label: 'Ballistics' },
  { value: 'document_analysis', label: 'Document Analysis' },
  { value: 'trace_analysis', label: 'Trace Analysis' },
  { value: 'toxicology', label: 'Toxicology' },
  { value: 'tool_marks', label: 'Tool Marks' },
  { value: 'blood_spatter', label: 'Blood Spatter' },
  { value: 'fire_debris', label: 'Fire/Debris' },
  { value: 'serology', label: 'Serology' },
  { value: 'microscopy', label: 'Microscopy' },
  { value: 'photography', label: 'Photography' },
  { value: 'other', label: 'Other' },
];

const EXHIBIT_STATUSES = [
  { value: 'received', label: 'Received' },
  { value: 'examining', label: 'Examining' },
  { value: 'complete', label: 'Complete' },
  { value: 'returned', label: 'Returned' },
  { value: 'disposed', label: 'Disposed' },
];

const LINK_TYPES = [
  { type: 'bodycam_video', label: 'Body Cam', icon: Video, color: 'text-blue-400' },
  { type: 'dashcam_video', label: 'Dash Cam', icon: Car, color: 'text-cyan-400' },
  { type: 'evidence', label: 'Evidence', icon: Package, color: 'text-amber-400' },
  { type: 'attachment', label: 'Files', icon: FileArchive, color: 'text-purple-400' },
  { type: 'incident', label: 'Incidents', icon: AlertTriangle, color: 'text-red-400' },
  { type: 'supplemental_report', label: 'Reports', icon: FileText, color: 'text-teal-400' },
  { type: 'case', label: 'Cases', icon: BookOpen, color: 'text-indigo-400' },
  { type: 'field_interview', label: 'FI Cards', icon: Users, color: 'text-orange-400' },
  { type: 'citation', label: 'Citations', icon: Clipboard, color: 'text-pink-400' },
  { type: 'radio_transcript', label: 'Radio', icon: Radio, color: 'text-green-400' },
  { type: 'daily_activity_report', label: 'DARs', icon: Calendar, color: 'text-yellow-400' },
] as const;

const RELATIONSHIP_OPTIONS = [
  { value: 'associated', label: 'Associated' },
  { value: 'primary_evidence', label: 'Primary Evidence' },
  { value: 'supporting', label: 'Supporting' },
  { value: 'reference', label: 'Reference' },
  { value: 'chain_of_custody', label: 'Chain of Custody' },
  { value: 'suspect_device', label: 'Suspect Device' },
  { value: 'victim_device', label: 'Victim Device' },
  { value: 'witness_statement', label: 'Witness Statement' },
  { value: 'forensic_source', label: 'Forensic Source' },
  { value: 'comparison_sample', label: 'Comparison Sample' },
];

const RELEVANCE_OPTIONS = [
  { value: 'critical', label: 'Critical', color: 'text-red-400' },
  { value: 'high', label: 'High', color: 'text-amber-400' },
  { value: 'standard', label: 'Standard', color: 'text-brand-400' },
  { value: 'low', label: 'Low', color: 'text-rmpg-400' },
  { value: 'reference_only', label: 'Ref Only', color: 'text-rmpg-500' },
];

const EMPTY_FORM = {
  title: '', case_type: 'digital', priority: 'routine',
  requesting_officer_name: '', assigned_examiner_name: '',
  lab_location: '', synopsis: '', due_date: '', notes: '',
};

type DetailTab = 'info' | 'exhibits' | 'analyses' | 'hashing' | 'linked' | 'timeline';

// ─── Helpers ────────────────────────────────────────────

function getStatusColor(status: string): string {
  return STATUS_OPTIONS.find(s => s.value === status)?.color || 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50';
}

function getStatusStep(status: string): number {
  return STATUS_OPTIONS.find(s => s.value === status)?.step || 0;
}

function getPriorityMeta(p: string) {
  return PRIORITY_OPTIONS.find(o => o.value === p) || PRIORITY_OPTIONS[0];
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function formatDateTime(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return d; }
}

function typeLabel(v: string): string {
  return TYPE_OPTIONS.find(t => t.value === v)?.label || v;
}

function analysisLabel(v: string): string {
  return ANALYSIS_TYPES.find(t => t.value === v)?.label || v;
}

function getLinkTypeInfo(type: string) {
  return LINK_TYPES.find(t => t.type === type) || LINK_TYPES[0];
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Reusable sub-components ─────────────────────────────

function SectionHeader({ icon: Icon, title, count, actions }: { icon: any; title: string; count?: number; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-sm bg-brand-900/40 border border-brand-700/30 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-brand-400" />
        </div>
        <h3 className="text-[11px] font-bold text-rmpg-200 uppercase tracking-wider">{title}</h3>
        {count !== undefined && <span className="text-[10px] text-rmpg-500 font-mono">({count})</span>}
      </div>
      {actions}
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle, action }: { icon: any; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-12 h-12 rounded-lg bg-rmpg-800/50 border border-rmpg-700/50 flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-rmpg-600" />
      </div>
      <div className="text-[11px] text-rmpg-400 font-medium">{title}</div>
      <div className="text-[10px] text-rmpg-600 mt-1 max-w-[240px]">{subtitle}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'cyan' }) {
  const colors = {
    default: 'bg-rmpg-800/60 text-rmpg-400 border-rmpg-700/50',
    red: 'bg-red-900/30 text-red-400 border-red-700/30',
    amber: 'bg-amber-900/30 text-amber-400 border-amber-700/30',
    green: 'bg-green-900/30 text-green-400 border-green-700/30',
    blue: 'bg-blue-900/30 text-blue-400 border-blue-700/30',
    purple: 'bg-purple-900/30 text-purple-400 border-purple-700/30',
    cyan: 'bg-cyan-900/30 text-cyan-400 border-cyan-700/30',
  };
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-sm border font-bold uppercase ${colors[variant]}`}>{children}</span>;
}

// ─── Component ──────────────────────────────────────────

export default function ForensicsPage() {
  const { addToast } = useToast();

  // Data
  const [cases, setCases] = useState<ForensicCase[]>([]);
  const [selected, setSelected] = useState<ForensicCase | null>(null);
  const [stats, setStats] = useState<LabStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // Detail
  const [detailTab, setDetailTab] = useState<DetailTab>('info');

  // Create/Edit modal
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  // Add exhibit inline
  const [showAddExhibit, setShowAddExhibit] = useState(false);
  const [exhibitForm, setExhibitForm] = useState({ description: '', item_type: '', examination_requested: '', condition_received: '' });

  // Add analysis inline
  const [showAddAnalysis, setShowAddAnalysis] = useState(false);
  const [analysisForm, setAnalysisForm] = useState({ analysis_type: 'fingerprint', methodology: '', notes: '' });

  // Timeline note
  const [timelineNote, setTimelineNote] = useState('');

  // Hashing
  const [hashRecords, setHashRecords] = useState<HashRecord[]>([]);
  const [hashStats, setHashStats] = useState({ total: 0, flagged: 0, matched: 0 });
  const [showAddHash, setShowAddHash] = useState(false);
  const [hashForm, setHashForm] = useState({ file_name: '', file_path: '', md5: '', sha1: '', sha256: '', sha512: '', notes: '', exhibit_id: '' });
  const [hashing, setHashing] = useState(false);
  const [hashComputePath, setHashComputePath] = useState('');
  const [hashVerifyValue, setHashVerifyValue] = useState('');
  const [hashVerifyType, setHashVerifyType] = useState('sha256');
  const [hashVerifyResults, setHashVerifyResults] = useState<any[] | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Linked Evidence
  const [linkedRecords, setLinkedRecords] = useState<LinkedRecord[]>([]);
  const [linkedStats, setLinkedStats] = useState({ total: 0, by_type: {} as Record<string, number>, by_relevance: {} as Record<string, number> });
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkSearchType, setLinkSearchType] = useState('bodycam_video');
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkSearchResults, setLinkSearchResults] = useState<any[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkRelationship, setLinkRelationship] = useState('associated');
  const [linkRelevance, setLinkRelevance] = useState('standard');
  const [linkNotes, setLinkNotes] = useState('');
  const [editingLink, setEditingLink] = useState<LinkedRecord | null>(null);

  // ── Fetchers ────────────────────────────────────────────

  const fetchCases = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('case_type', filterType);
      if (filterPriority) params.set('priority', filterPriority);
      params.set('limit', '100');
      const data = await apiFetch<{ data: ForensicCase[]; total: number }>(`/forensics?${params}`);
      setCases(data.data || []);
    } catch (err) {
      console.error('Fetch forensic cases:', err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterStatus, filterType, filterPriority]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<LabStats>('/forensics/stats');
      setStats(data);
    } catch { /* non-critical */ }
  }, []);

  const fetchDetail = useCallback(async (id: number) => {
    try {
      const data = await apiFetch<ForensicCase>(`/forensics/${id}`);
      setSelected(data);
    } catch (err) {
      console.error('Fetch forensic case detail:', err);
    }
  }, []);

  useEffect(() => { fetchCases(); fetchStats(); }, [fetchCases, fetchStats]);

  // ── Handlers ────────────────────────────────────────────

  const handleSelect = (c: ForensicCase) => {
    fetchDetail(c.id);
    setDetailTab('info');
    setHashRecords([]);
    setHashVerifyResults(null);
    setLinkedRecords([]);
    setShowLinkSearch(false);
    setLinkSearchResults([]);
    setEditingLink(null);
  };

  const handleCreate = async () => {
    if (!form.title.trim()) return addToast('Title is required', 'error');
    setSaving(true);
    try {
      const created = await apiFetch<ForensicCase>('/forensics', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      addToast(`Case ${created.lab_case_number} created`, 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
      await fetchCases();
      await fetchStats();
      fetchDetail(created.id);
    } catch (err) {
      addToast('Failed to create case', 'error');
    } finally { setSaving(false); }
  };

  const handleUpdate = async (updates: Partial<ForensicCase>) => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiFetch(`/forensics/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      addToast('Case updated', 'success');
      await fetchDetail(selected.id);
      await fetchCases();
      await fetchStats();
      setEditMode(false);
    } catch (err) {
      addToast('Failed to update case', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveEdit = () => {
    handleUpdate({
      title: form.title,
      case_type: form.case_type,
      priority: form.priority,
      requesting_officer_name: form.requesting_officer_name,
      assigned_examiner_name: form.assigned_examiner_name,
      lab_location: form.lab_location,
      synopsis: form.synopsis,
      due_date: form.due_date || undefined,
      notes: form.notes,
    });
  };

  const handleStatusChange = (newStatus: string) => handleUpdate({ status: newStatus });

  const handleDelete = async () => {
    if (!selected || !confirm('Delete this forensic case? This cannot be undone.')) return;
    try {
      await apiFetch(`/forensics/${selected.id}`, { method: 'DELETE' });
      addToast('Case deleted', 'success');
      setSelected(null);
      await fetchCases();
      await fetchStats();
    } catch { addToast('Failed to delete', 'error'); }
  };

  // Exhibits
  const handleAddExhibit = async () => {
    if (!selected || !exhibitForm.description.trim()) return addToast('Description required', 'error');
    try {
      await apiFetch(`/forensics/${selected.id}/exhibits`, { method: 'POST', body: JSON.stringify(exhibitForm) });
      addToast('Exhibit added', 'success');
      setShowAddExhibit(false);
      setExhibitForm({ description: '', item_type: '', examination_requested: '', condition_received: '' });
      await fetchDetail(selected.id);
    } catch { addToast('Failed to add exhibit', 'error'); }
  };

  const handleExhibitStatus = async (exhibitId: number, newStatus: string) => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/exhibits/${exhibitId}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      await fetchDetail(selected.id);
    } catch { addToast('Failed to update exhibit', 'error'); }
  };

  // Analyses
  const handleAddAnalysis = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/analyses`, { method: 'POST', body: JSON.stringify(analysisForm) });
      addToast('Analysis added', 'success');
      setShowAddAnalysis(false);
      setAnalysisForm({ analysis_type: 'fingerprint', methodology: '', notes: '' });
      await fetchDetail(selected.id);
    } catch { addToast('Failed to add analysis', 'error'); }
  };

  const handleAnalysisStatus = async (analysisId: number, newStatus: string) => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/analyses/${analysisId}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
      await fetchDetail(selected.id);
    } catch { addToast('Failed to update analysis', 'error'); }
  };

  // Timeline
  const handleAddNote = async () => {
    if (!selected || !timelineNote.trim()) return;
    try {
      await apiFetch(`/forensics/${selected.id}/timeline`, { method: 'POST', body: JSON.stringify({ action: 'note', description: timelineNote.trim() }) });
      setTimelineNote('');
      await fetchDetail(selected.id);
    } catch { addToast('Failed to add note', 'error'); }
  };

  const openEdit = () => {
    if (!selected) return;
    setForm({
      title: selected.title, case_type: selected.case_type, priority: selected.priority,
      requesting_officer_name: selected.requesting_officer_name || '',
      assigned_examiner_name: selected.assigned_examiner_name || '',
      lab_location: selected.lab_location || '', synopsis: selected.synopsis || '',
      due_date: selected.due_date || '', notes: selected.notes || '',
    });
    setEditMode(true);
  };

  // Hashing
  const fetchHashes = useCallback(async (caseId: number) => {
    try {
      const data = await apiFetch<{ hashes: HashRecord[]; total: number; flagged: number; matched: number }>(`/forensics/${caseId}/hashes`);
      setHashRecords(data.hashes || []);
      setHashStats({ total: data.total, flagged: data.flagged, matched: data.matched });
    } catch { /* non-critical */ }
  }, []);

  const handleComputeHash = async () => {
    if (!selected || !hashComputePath.trim()) return addToast('Enter a file path', 'error');
    setHashing(true);
    try {
      await apiFetch(`/forensics/${selected.id}/hashes/compute`, { method: 'POST', body: JSON.stringify({ file_path: hashComputePath.trim() }) });
      addToast('Hashes computed successfully', 'success');
      setHashComputePath('');
      await fetchHashes(selected.id);
      await fetchDetail(selected.id);
    } catch (err: any) {
      addToast(err?.message || 'Hash computation failed', 'error');
    } finally { setHashing(false); }
  };

  const handleAddManualHash = async () => {
    if (!selected || !hashForm.file_name.trim()) return addToast('File name is required', 'error');
    if (!hashForm.md5 && !hashForm.sha1 && !hashForm.sha256) return addToast('At least one hash value required', 'error');
    try {
      await apiFetch(`/forensics/${selected.id}/hashes/manual`, {
        method: 'POST',
        body: JSON.stringify({ ...hashForm, exhibit_id: hashForm.exhibit_id ? parseInt(hashForm.exhibit_id) : null }),
      });
      addToast('Hash record added', 'success');
      setShowAddHash(false);
      setHashForm({ file_name: '', file_path: '', md5: '', sha1: '', sha256: '', sha512: '', notes: '', exhibit_id: '' });
      await fetchHashes(selected.id);
      await fetchDetail(selected.id);
    } catch { addToast('Failed to add hash', 'error'); }
  };

  const handleFlagHash = async (hashId: number, flag: boolean, reason?: string) => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/hashes/${hashId}`, { method: 'PUT', body: JSON.stringify({ flagged: flag, flag_reason: reason || null }) });
      await fetchHashes(selected.id);
      await fetchDetail(selected.id);
    } catch { addToast('Failed to update flag', 'error'); }
  };

  const handleDeleteHash = async (hashId: number) => {
    if (!selected || !confirm('Delete this hash record?')) return;
    try {
      await apiFetch(`/forensics/${selected.id}/hashes/${hashId}`, { method: 'DELETE' });
      addToast('Hash record deleted', 'success');
      await fetchHashes(selected.id);
    } catch { addToast('Failed to delete hash', 'error'); }
  };

  const handleVerifyHash = async () => {
    if (!selected || !hashVerifyValue.trim()) return addToast('Enter a hash value to verify', 'error');
    try {
      const data = await apiFetch<{ matches: any[]; matches_found: number }>(`/forensics/${selected.id}/hashes/verify`, {
        method: 'POST',
        body: JSON.stringify({ hash_value: hashVerifyValue.trim(), hash_type: hashVerifyType }),
      });
      setHashVerifyResults(data.matches || []);
      if (data.matches_found === 0) addToast('No matches found', 'info');
      else addToast(`${data.matches_found} match(es) found`, 'success');
    } catch { addToast('Hash verification failed', 'error'); }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedHash(text);
      addToast(`${label} copied`, 'success');
      setTimeout(() => setCopiedHash(null), 2000);
    });
  };

  // Linked Evidence
  const fetchLinks = useCallback(async (caseId: number) => {
    try {
      const data = await apiFetch<{ links: LinkedRecord[]; total: number; by_type: Record<string, number>; by_relevance: Record<string, number> }>(`/forensics/${caseId}/links`);
      setLinkedRecords(data.links || []);
      setLinkedStats({ total: data.total, by_type: data.by_type || {}, by_relevance: data.by_relevance || {} });
    } catch { /* non-critical */ }
  }, []);

  const handleSearchLinkable = async () => {
    if (!selected) return;
    setLinkSearching(true);
    try {
      const params = new URLSearchParams({ type: linkSearchType });
      if (linkSearchQuery.trim()) params.set('q', linkSearchQuery.trim());
      const data = await apiFetch<{ results: any[] }>(`/forensics/${selected.id}/links/search?${params}`);
      setLinkSearchResults(data.results || []);
    } catch { addToast('Search failed', 'error'); }
    finally { setLinkSearching(false); }
  };

  const handleCreateLink = async (linkedType: string, linkedId: number) => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/links`, {
        method: 'POST',
        body: JSON.stringify({ linked_type: linkedType, linked_id: linkedId, relationship: linkRelationship, relevance: linkRelevance, notes: linkNotes || null }),
      });
      addToast('Evidence linked successfully', 'success');
      await fetchLinks(selected.id);
      await fetchDetail(selected.id);
      handleSearchLinkable();
    } catch (err: any) {
      addToast(err?.message || 'Failed to link evidence', 'error');
    }
  };

  const handleUpdateLink = async (linkId: number, updates: any) => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/links/${linkId}`, { method: 'PUT', body: JSON.stringify(updates) });
      addToast('Link updated', 'success');
      setEditingLink(null);
      await fetchLinks(selected.id);
      await fetchDetail(selected.id);
    } catch { addToast('Failed to update link', 'error'); }
  };

  const handleDeleteLink = async (linkId: number) => {
    if (!selected || !confirm('Remove this evidence link?')) return;
    try {
      await apiFetch(`/forensics/${selected.id}/links/${linkId}`, { method: 'DELETE' });
      addToast('Link removed', 'success');
      await fetchLinks(selected.id);
      await fetchDetail(selected.id);
    } catch { addToast('Failed to remove link', 'error'); }
  };

  // ── Render ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    );
  }

  const activeCount = cases.filter(c => !['closed', 'cancelled'].includes(c.status)).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header ──────────────────────────────────────────── */}
      <PanelTitleBar
        title="Forensic Lab"
        icon={Microscope}
      >
        <div className="flex items-center gap-2 ml-2">
          <span className="text-[10px] text-rmpg-500">{stats?.total || 0} cases</span>
          {(stats?.overdue || 0) > 0 && (
            <span className="text-[9px] bg-red-950/60 text-red-400 border border-red-800/40 px-1.5 py-0.5 rounded-sm font-bold animate-pulse">
              {stats!.overdue} OVERDUE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => { fetchCases(); fetchStats(); if (selected) fetchDetail(selected.id); }}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-2 py-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); }}
            className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1 px-2.5 py-1">
            <Plus className="w-3 h-3" /> New Case
          </button>
        </div>
      </PanelTitleBar>

      {/* ── Dashboard Stats ─────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-rmpg-800 bg-surface-base">
        {[
          { label: 'Active', value: activeCount, color: 'text-brand-400', bg: 'bg-brand-900/20' },
          { label: 'Submitted', value: stats?.by_status?.submitted || 0, color: 'text-blue-400', bg: 'bg-blue-900/20' },
          { label: 'In Progress', value: stats?.by_status?.in_progress || 0, color: 'text-amber-400', bg: 'bg-amber-900/20' },
          { label: 'Done', value: (stats?.by_status?.report_final || 0) + (stats?.by_status?.closed || 0), color: 'text-green-400', bg: 'bg-green-900/20' },
        ].map(s => (
          <div key={s.label} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm ${s.bg}`}>
            <span className={`text-xs font-bold font-mono ${s.color}`}>{s.value}</span>
            <span className="text-[9px] text-rmpg-500">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Main Split ──────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ═══ LEFT PANEL — Case List ═══ */}
        <div className="w-[340px] shrink-0 border-r border-rmpg-800 flex flex-col bg-surface-base">
          {/* Search & Filters */}
          <div className="p-2 space-y-1.5 border-b border-rmpg-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search cases..."
                className="w-full input-dark text-[11px] pl-8 pr-2 py-2 rounded-sm"
              />
            </div>
            <div className="flex gap-1">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="flex-1 bg-surface-sunken border border-rmpg-700 text-rmpg-300 text-[10px] px-1.5 py-1 rounded-sm">
                <option value="">All Status</option>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select value={filterType} onChange={e => setFilterType(e.target.value)}
                className="flex-1 bg-surface-sunken border border-rmpg-700 text-rmpg-300 text-[10px] px-1.5 py-1 rounded-sm">
                <option value="">All Types</option>
                {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
                className="flex-1 bg-surface-sunken border border-rmpg-700 text-rmpg-300 text-[10px] px-1.5 py-1 rounded-sm">
                <option value="">Priority</option>
                {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Case List */}
          <div className="flex-1 overflow-y-auto">
            {cases.length === 0 ? (
              <EmptyState
                icon={Microscope}
                title="No forensic cases found"
                subtitle="Create a new forensic lab case to begin tracking evidence and analyses"
                action={
                  <button onClick={() => { setForm(EMPTY_FORM); setShowForm(true); }}
                    className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1 px-3 py-1.5">
                    <Plus className="w-3 h-3" /> Create Case
                  </button>
                }
              />
            ) : cases.map(c => {
              const prio = getPriorityMeta(c.priority);
              const step = getStatusStep(c.status);
              const isOverdue = c.due_date && new Date(c.due_date) < new Date() && !['closed','cancelled','report_final'].includes(c.status);
              return (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  className={`w-full text-left px-3 py-2.5 border-b border-rmpg-800/50 hover:bg-rmpg-800/30 transition-colors ${
                    selected?.id === c.id ? 'bg-brand-600/10 border-l-2 border-l-brand-500' : ''
                  }`}
                >
                  {/* Row 1: Case number + priority */}
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-brand-400 font-mono">{c.lab_case_number}</span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm ${prio.color} ${prio.bg}`}>
                      {c.priority}
                    </span>
                  </div>
                  {/* Row 2: Title */}
                  <div className="text-[11px] text-rmpg-200 font-medium truncate leading-tight">{c.title}</div>
                  {/* Row 3: Status + type + examiner */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <StatusBadge status={c.status} type="incident_status" className={`text-[9px] px-1.5 py-0.5 ${getStatusColor(c.status)}`} />
                    <span className="text-[9px] text-rmpg-500">{typeLabel(c.case_type)}</span>
                    {c.assigned_examiner_name && (
                      <span className="text-[9px] text-rmpg-500 truncate flex items-center gap-0.5 ml-auto">
                        <User className="w-2.5 h-2.5" /> {c.assigned_examiner_name}
                      </span>
                    )}
                  </div>
                  {/* Row 4: Progress bar + date + overdue */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1 bg-rmpg-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          step >= 7 ? 'bg-green-500' : step >= 4 ? 'bg-amber-500' : 'bg-brand-500'
                        }`}
                        style={{ width: `${Math.max(step / 8 * 100, 5)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-rmpg-600 shrink-0">{formatDate(c.received_date || c.created_at)}</span>
                    {isOverdue && (
                      <span className="text-[8px] text-red-400 font-bold shrink-0">OVERDUE</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ═══ RIGHT PANEL — Detail ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden bg-rmpg-950">
          {!selected ? (
            <EmptyState
              icon={Microscope}
              title="Select a forensic case"
              subtitle="Choose a case from the list to view exhibits, analyses, hashing, linked evidence, and timeline"
            />
          ) : (
            <>
              {/* Detail Header */}
              <div className="shrink-0 px-4 py-3 border-b border-rmpg-800 bg-surface-base">
                {/* Title row */}
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-brand-400 font-mono">{selected.lab_case_number}</span>
                      <StatusBadge status={selected.status} type="incident_status" className={`text-[9px] px-2 py-0.5 ${getStatusColor(selected.status)}`} />
                      {(() => {
                        const p = getPriorityMeta(selected.priority);
                        return <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm ${p.color} ${p.bg}`}>{selected.priority}</span>;
                      })()}
                      {selected.due_date && new Date(selected.due_date) < new Date() && !['closed','cancelled','report_final'].includes(selected.status) && (
                        <span className="text-[9px] bg-red-950/60 text-red-400 border border-red-800/40 px-1.5 py-0.5 rounded-sm font-bold flex items-center gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" /> OVERDUE
                        </span>
                      )}
                    </div>
                    <h2 className="text-[13px] font-semibold text-rmpg-100 leading-tight">{selected.title}</h2>
                    <div className="flex items-center gap-3 text-[10px] text-rmpg-500 mt-1">
                      <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> {typeLabel(selected.case_type)}</span>
                      {selected.requesting_officer_name && <span>Requested by: {selected.requesting_officer_name}</span>}
                      {selected.assigned_examiner_name && <span className="flex items-center gap-1"><User className="w-3 h-3" /> <strong className="text-rmpg-300">{selected.assigned_examiner_name}</strong></span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <button onClick={openEdit} className="toolbar-btn text-[10px] flex items-center gap-1 px-2 py-1" title="Edit case">
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={handleDelete} className="toolbar-btn text-[10px] p-1 text-red-400 hover:text-red-300" title="Delete case">
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <button onClick={() => setSelected(null)} className="toolbar-btn p-1" title="Close">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Workflow stepper */}
                <div className="flex items-center gap-0.5 mb-3">
                  {STATUS_OPTIONS.filter(s => s.step > 0).map((s, i) => {
                    const currentStep = getStatusStep(selected.status);
                    const isActive = s.value === selected.status;
                    const isDone = s.step < currentStep;
                    return (
                      <React.Fragment key={s.value}>
                        {i > 0 && <div className={`flex-1 h-px ${isDone ? 'bg-green-600' : 'bg-rmpg-700'}`} />}
                        <button
                          onClick={() => handleStatusChange(s.value)}
                          title={`Set status: ${s.label}`}
                          className={`shrink-0 w-5 h-5 rounded-full text-[7px] font-bold flex items-center justify-center border transition-all ${
                            isActive
                              ? 'bg-brand-600 border-brand-500 text-white ring-2 ring-brand-500/30 scale-110'
                              : isDone
                              ? 'bg-green-900/60 border-green-600/50 text-green-400'
                              : 'bg-rmpg-800 border-rmpg-700 text-rmpg-500 hover:border-rmpg-500 hover:text-rmpg-300'
                          }`}
                        >
                          {isDone ? <CheckCircle className="w-3 h-3" /> : s.step}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Tab bar */}
                <div className="flex items-center gap-1 -mb-[13px]">
                  {([
                    { id: 'info' as DetailTab, label: 'Overview', icon: FileText },
                    { id: 'exhibits' as DetailTab, label: 'Exhibits', count: selected.exhibits?.length || 0, icon: Package },
                    { id: 'analyses' as DetailTab, label: 'Analyses', count: selected.analyses?.length || 0, icon: FlaskConical },
                    { id: 'hashing' as DetailTab, label: 'Hashing', count: hashStats.total || undefined, icon: Hash },
                    { id: 'linked' as DetailTab, label: 'Linked', count: linkedStats.total || undefined, icon: Link },
                    { id: 'timeline' as DetailTab, label: 'Timeline', icon: Clock },
                  ]).map(tab => (
                    <button key={tab.id} onClick={() => {
                      setDetailTab(tab.id);
                      if (tab.id === 'hashing' && selected) fetchHashes(selected.id);
                      if (tab.id === 'linked' && selected) fetchLinks(selected.id);
                    }}
                      className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium rounded-t-sm border-b-2 transition-all ${
                        detailTab === tab.id
                          ? 'text-brand-400 border-brand-500 bg-rmpg-900/60'
                          : 'text-rmpg-500 border-transparent hover:text-rmpg-300 hover:bg-rmpg-900/30'
                      }`}>
                      <tab.icon className="w-3 h-3" />
                      {tab.label}
                      {tab.count !== undefined && tab.count > 0 && (
                        <span className={`text-[8px] px-1 py-0 rounded-full font-mono ${
                          detailTab === tab.id ? 'bg-brand-500/30 text-brand-300' : 'bg-rmpg-700/50 text-rmpg-500'
                        }`}>{tab.count}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Detail Content ────────────────────────────── */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* ═══ OVERVIEW TAB ═══ */}
                {detailTab === 'info' && (
                  <>
                    {/* Key dates grid */}
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Received', value: formatDate(selected.received_date), icon: Calendar, color: 'text-blue-400' },
                        { label: 'Due Date', value: formatDate(selected.due_date), icon: AlertTriangle, color: selected.due_date && new Date(selected.due_date) < new Date() && !['closed','cancelled','report_final'].includes(selected.status) ? 'text-red-400' : 'text-rmpg-400' },
                        { label: 'Started', value: formatDate(selected.started_date), icon: ArrowRight, color: 'text-amber-400' },
                        { label: 'Completed', value: formatDate(selected.completed_date), icon: CheckCircle, color: 'text-green-400' },
                      ].map(d => (
                        <div key={d.label} className="panel-beveled bg-surface-base p-3 text-center">
                          <d.icon className={`w-4 h-4 mx-auto mb-1.5 ${d.color}`} />
                          <div className={`text-[11px] font-semibold ${d.color !== 'text-rmpg-400' && d.value !== '—' ? d.color : 'text-rmpg-200'}`}>{d.value}</div>
                          <div className="text-[9px] text-rmpg-500 mt-0.5">{d.label}</div>
                        </div>
                      ))}
                    </div>

                    {selected.turnaround_days !== null && selected.turnaround_days !== undefined && (
                      <div className="flex items-center gap-2 text-[11px] px-3 py-2.5 rounded-sm bg-green-950/30 border border-green-800/40 text-green-400">
                        <CheckCircle className="w-4 h-4" />
                        Case completed in <strong>{selected.turnaround_days}</strong> day{selected.turnaround_days !== 1 ? 's' : ''}
                      </div>
                    )}

                    {/* Synopsis */}
                    {selected.synopsis && (
                      <div className="panel-beveled bg-surface-base p-4">
                        <SectionHeader icon={Clipboard} title="Synopsis" />
                        <p className="text-[11px] text-rmpg-300 leading-relaxed whitespace-pre-wrap">{selected.synopsis}</p>
                      </div>
                    )}

                    {/* Findings / Conclusion */}
                    {(selected.findings || selected.conclusion) && (
                      <div className="panel-beveled bg-surface-base p-4 space-y-3">
                        {selected.findings && (
                          <div>
                            <SectionHeader icon={Target} title="Findings" />
                            <p className="text-[11px] text-rmpg-300 leading-relaxed whitespace-pre-wrap">{selected.findings}</p>
                          </div>
                        )}
                        {selected.conclusion && (
                          <div>
                            <SectionHeader icon={CheckCircle} title="Conclusion" />
                            <p className="text-[11px] text-rmpg-300 leading-relaxed whitespace-pre-wrap">{selected.conclusion}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Case details grid */}
                    <div className="panel-beveled bg-surface-base p-4">
                      <SectionHeader icon={FileText} title="Case Details" />
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
                        {[
                          ['Lab Location', selected.lab_location],
                          ['Requesting Officer', selected.requesting_officer_name],
                          ['Assigned Examiner', selected.assigned_examiner_name],
                          ['Type', typeLabel(selected.case_type)],
                          ['Priority', selected.priority?.charAt(0).toUpperCase() + selected.priority?.slice(1)],
                          ['Report Date', formatDate(selected.report_date)],
                        ].map(([label, value]) => (
                          <div key={label as string} className="flex items-baseline gap-3">
                            <span className="text-rmpg-500 shrink-0 w-28 text-[10px]">{label}</span>
                            <span className="text-rmpg-200 truncate font-medium">{(value as string) || '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {selected.notes && (
                      <div className="panel-beveled bg-surface-base p-4">
                        <SectionHeader icon={MessageSquare} title="Notes" />
                        <p className="text-[11px] text-rmpg-400 leading-relaxed whitespace-pre-wrap">{selected.notes}</p>
                      </div>
                    )}
                  </>
                )}

                {/* ═══ EXHIBITS TAB ═══ */}
                {detailTab === 'exhibits' && (
                  <>
                    <SectionHeader icon={Package} title="Exhibits" count={selected.exhibits?.length || 0} actions={
                      <button onClick={() => setShowAddExhibit(!showAddExhibit)}
                        className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1 px-2.5 py-1">
                        <Plus className="w-3 h-3" /> Add Exhibit
                      </button>
                    } />

                    {showAddExhibit && (
                      <div className="panel-beveled bg-surface-base p-4 space-y-2.5">
                        <h4 className="text-[11px] font-bold text-rmpg-200">New Exhibit</h4>
                        <input value={exhibitForm.description} onChange={e => setExhibitForm(p => ({ ...p, description: e.target.value }))}
                          placeholder="Description *" className="w-full input-dark text-[11px] px-3 py-2" />
                        <div className="flex gap-2">
                          <input value={exhibitForm.item_type} onChange={e => setExhibitForm(p => ({ ...p, item_type: e.target.value }))}
                            placeholder="Item type" className="flex-1 input-dark text-[11px] px-3 py-2" />
                          <input value={exhibitForm.condition_received} onChange={e => setExhibitForm(p => ({ ...p, condition_received: e.target.value }))}
                            placeholder="Condition received" className="flex-1 input-dark text-[11px] px-3 py-2" />
                        </div>
                        <input value={exhibitForm.examination_requested} onChange={e => setExhibitForm(p => ({ ...p, examination_requested: e.target.value }))}
                          placeholder="Examination requested" className="w-full input-dark text-[11px] px-3 py-2" />
                        <div className="flex gap-2 pt-1">
                          <button onClick={handleAddExhibit} className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5 flex items-center gap-1">
                            <Save className="w-3 h-3" /> Save Exhibit
                          </button>
                          <button onClick={() => setShowAddExhibit(false)} className="toolbar-btn text-[10px] px-3 py-1.5">Cancel</button>
                        </div>
                      </div>
                    )}

                    {(selected.exhibits || []).length === 0 && !showAddExhibit ? (
                      <EmptyState icon={Package} title="No exhibits recorded" subtitle="Add exhibits submitted for forensic analysis" action={
                        <button onClick={() => setShowAddExhibit(true)} className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1 px-3 py-1.5">
                          <Plus className="w-3 h-3" /> Add First Exhibit
                        </button>
                      } />
                    ) : (selected.exhibits || []).map(ex => (
                      <div key={ex.id} className="panel-beveled bg-surface-base p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-sm bg-brand-900/40 border border-brand-700/30 flex items-center justify-center">
                              <span className="text-[10px] font-bold text-brand-400">{ex.exhibit_number}</span>
                            </div>
                            <div>
                              <div className="text-[11px] text-rmpg-200 font-medium">{ex.description}</div>
                              {ex.item_type && <div className="text-[9px] text-rmpg-500">Type: {ex.item_type}</div>}
                            </div>
                          </div>
                          <select value={ex.status} onChange={e => handleExhibitStatus(ex.id, e.target.value)}
                            className="bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-300 px-2 py-1 rounded-sm">
                            {EXHIBIT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-1 gap-1 text-[10px]">
                          {ex.condition_received && <div><span className="text-rmpg-500">Condition:</span> <span className="text-rmpg-300">{ex.condition_received}</span></div>}
                          {ex.examination_requested && <div><span className="text-rmpg-500">Exam Requested:</span> <span className="text-rmpg-300">{ex.examination_requested}</span></div>}
                          {ex.examination_performed && <div><span className="text-rmpg-500">Exam Performed:</span> <span className="text-rmpg-300">{ex.examination_performed}</span></div>}
                          {ex.results && <div><span className="text-rmpg-500">Results:</span> <span className="text-rmpg-200 font-medium">{ex.results}</span></div>}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {/* ═══ ANALYSES TAB ═══ */}
                {detailTab === 'analyses' && (
                  <>
                    <SectionHeader icon={FlaskConical} title="Analyses" count={selected.analyses?.length || 0} actions={
                      <button onClick={() => setShowAddAnalysis(!showAddAnalysis)}
                        className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1 px-2.5 py-1">
                        <Plus className="w-3 h-3" /> Add Analysis
                      </button>
                    } />

                    {showAddAnalysis && (
                      <div className="panel-beveled bg-surface-base p-4 space-y-2.5">
                        <h4 className="text-[11px] font-bold text-rmpg-200">New Analysis</h4>
                        <select value={analysisForm.analysis_type} onChange={e => setAnalysisForm(p => ({ ...p, analysis_type: e.target.value }))}
                          className="w-full input-dark text-[11px] px-3 py-2">
                          {ANALYSIS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <input value={analysisForm.methodology} onChange={e => setAnalysisForm(p => ({ ...p, methodology: e.target.value }))}
                          placeholder="Methodology / instruments" className="w-full input-dark text-[11px] px-3 py-2" />
                        <input value={analysisForm.notes} onChange={e => setAnalysisForm(p => ({ ...p, notes: e.target.value }))}
                          placeholder="Notes" className="w-full input-dark text-[11px] px-3 py-2" />
                        <div className="flex gap-2 pt-1">
                          <button onClick={handleAddAnalysis} className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5 flex items-center gap-1">
                            <Save className="w-3 h-3" /> Save Analysis
                          </button>
                          <button onClick={() => setShowAddAnalysis(false)} className="toolbar-btn text-[10px] px-3 py-1.5">Cancel</button>
                        </div>
                      </div>
                    )}

                    {(selected.analyses || []).length === 0 && !showAddAnalysis ? (
                      <EmptyState icon={FlaskConical} title="No analyses recorded" subtitle="Add forensic analyses performed on exhibits" action={
                        <button onClick={() => setShowAddAnalysis(true)} className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1 px-3 py-1.5">
                          <Plus className="w-3 h-3" /> Add First Analysis
                        </button>
                      } />
                    ) : (selected.analyses || []).map(a => (
                      <div key={a.id} className={`panel-beveled bg-surface-base p-4 border-l-2 ${
                        a.status === 'complete' ? 'border-l-green-500' :
                        a.status === 'in_progress' ? 'border-l-amber-500' :
                        a.status === 'inconclusive' ? 'border-l-purple-500' : 'border-l-rmpg-700'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-rmpg-200">{analysisLabel(a.analysis_type)}</span>
                            <StatusBadge status={a.status} type="incident_status" className={`text-[9px] px-1.5 py-0.5 ${
                              a.status === 'complete' ? 'bg-green-900/50 text-green-400 border-green-700/50' :
                              a.status === 'in_progress' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                              a.status === 'inconclusive' ? 'bg-purple-900/50 text-purple-400 border-purple-700/50' :
                              'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50'
                            }`} />
                          </div>
                          <select value={a.status} onChange={e => handleAnalysisStatus(a.id, e.target.value)}
                            className="bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-300 px-2 py-1 rounded-sm">
                            <option value="pending">Pending</option>
                            <option value="in_progress">In Progress</option>
                            <option value="complete">Complete</option>
                            <option value="inconclusive">Inconclusive</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                        {a.examiner_name && <div className="text-[10px] text-rmpg-500 mb-1">Examiner: <span className="text-rmpg-300">{a.examiner_name}</span></div>}
                        <div className="grid grid-cols-1 gap-1 text-[10px]">
                          {a.methodology && <div><span className="text-rmpg-500">Methodology:</span> <span className="text-rmpg-300">{a.methodology}</span></div>}
                          {a.instruments_used && <div><span className="text-rmpg-500">Instruments:</span> <span className="text-rmpg-300">{a.instruments_used}</span></div>}
                          {a.results && <div><span className="text-rmpg-500">Results:</span> <span className="text-rmpg-200 font-medium">{a.results}</span></div>}
                          {a.conclusion && <div><span className="text-rmpg-500">Conclusion:</span> <span className="text-rmpg-200 font-medium">{a.conclusion}</span></div>}
                        </div>
                        {(a.started_at || a.completed_at) && (
                          <div className="flex items-center gap-3 mt-2 text-[9px] text-rmpg-600">
                            {a.started_at && <span>Started: {formatDateTime(a.started_at)}</span>}
                            {a.completed_at && <span>Completed: {formatDateTime(a.completed_at)}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {/* ═══ HASHING TAB ═══ */}
                {detailTab === 'hashing' && (
                  <>
                    <SectionHeader icon={Hash} title="Digital Hashing" count={hashStats.total} actions={
                      <div className="flex items-center gap-1">
                        {hashStats.flagged > 0 && <Badge variant="red"><Flag className="w-2 h-2 inline mr-0.5" />{hashStats.flagged} flagged</Badge>}
                        {hashStats.matched > 0 && <Badge variant="amber"><Shield className="w-2 h-2 inline mr-0.5" />{hashStats.matched} matched</Badge>}
                        <button onClick={() => selected && fetchHashes(selected.id)} className="toolbar-btn p-1" title="Refresh">
                          <RefreshCw className="w-3 h-3" />
                        </button>
                        <button onClick={() => setShowAddHash(!showAddHash)} className="toolbar-btn text-[10px] flex items-center gap-1 px-2 py-1">
                          <Plus className="w-3 h-3" /> Manual
                        </button>
                      </div>
                    } />

                    {/* Compute hashes */}
                    <div className="panel-beveled bg-surface-base p-4 space-y-2">
                      <h4 className="text-[11px] font-bold text-rmpg-200 flex items-center gap-1.5">
                        <FileDigit className="w-3.5 h-3.5 text-brand-400" /> Compute File Hashes
                      </h4>
                      <div className="flex items-center gap-2">
                        <input value={hashComputePath} onChange={e => setHashComputePath(e.target.value)}
                          placeholder="/opt/rmpg-flex/evidence/cases/device.img"
                          className="flex-1 input-dark text-[11px] px-3 py-2 font-mono"
                          onKeyDown={e => { if (e.key === 'Enter') handleComputeHash(); }}
                        />
                        <button onClick={handleComputeHash} disabled={hashing || !hashComputePath.trim()}
                          className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5 disabled:opacity-50 flex items-center gap-1">
                          {hashing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                          {hashing ? 'Computing...' : 'Compute'}
                        </button>
                      </div>
                      <p className="text-[9px] text-rmpg-600">Auto-computes MD5, SHA-1, SHA-256, SHA-512 and content fingerprint</p>
                    </div>

                    {/* Verify hash */}
                    <div className="panel-beveled bg-surface-base p-4 space-y-2">
                      <h4 className="text-[11px] font-bold text-rmpg-200 flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5 text-brand-400" /> Verify Hash Across Cases
                      </h4>
                      <div className="flex items-center gap-2">
                        <select value={hashVerifyType} onChange={e => setHashVerifyType(e.target.value)}
                          className="bg-surface-sunken border border-rmpg-700 text-[11px] text-rmpg-300 px-2 py-2 rounded-sm w-28">
                          <option value="md5">MD5</option>
                          <option value="sha1">SHA-1</option>
                          <option value="sha256">SHA-256</option>
                          <option value="sha512">SHA-512</option>
                        </select>
                        <input value={hashVerifyValue} onChange={e => setHashVerifyValue(e.target.value)}
                          placeholder="Paste hash value to cross-reference..."
                          className="flex-1 input-dark text-[11px] px-3 py-2 font-mono"
                          onKeyDown={e => { if (e.key === 'Enter') handleVerifyHash(); }}
                        />
                        <button onClick={handleVerifyHash} disabled={!hashVerifyValue.trim()}
                          className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5 disabled:opacity-50">
                          Verify
                        </button>
                      </div>
                      {hashVerifyResults && hashVerifyResults.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-[10px] text-green-400 font-bold">{hashVerifyResults.length} match(es) found:</div>
                          {hashVerifyResults.map((m: any, i: number) => (
                            <div key={i} className="text-[10px] bg-green-950/30 border border-green-800/30 px-3 py-2 rounded-sm flex items-center gap-2">
                              <FileDigit className="w-3 h-3 text-green-400 shrink-0" />
                              <span className="text-green-400 font-mono font-medium">{m.file_name}</span>
                              {m.lab_case_number && <span className="text-rmpg-500">Case: <span className="text-brand-400 font-bold">{m.lab_case_number}</span></span>}
                              {m.case_title && <span className="text-rmpg-500 truncate">— {m.case_title}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {hashVerifyResults && hashVerifyResults.length === 0 && (
                        <p className="text-[10px] text-rmpg-500 mt-1">No matches found in any case.</p>
                      )}
                    </div>

                    {/* Manual hash entry */}
                    {showAddHash && (
                      <div className="panel-beveled bg-surface-base p-4 space-y-2.5">
                        <h4 className="text-[11px] font-bold text-rmpg-200">Add Hash Record Manually</h4>
                        <div className="grid grid-cols-2 gap-2">
                          <input value={hashForm.file_name} onChange={e => setHashForm(p => ({ ...p, file_name: e.target.value }))}
                            placeholder="File name *" className="input-dark text-[11px] px-3 py-2" />
                          <input value={hashForm.file_path} onChange={e => setHashForm(p => ({ ...p, file_path: e.target.value }))}
                            placeholder="File path (optional)" className="input-dark text-[11px] px-3 py-2 font-mono" />
                        </div>
                        <input value={hashForm.md5} onChange={e => setHashForm(p => ({ ...p, md5: e.target.value }))} placeholder="MD5" className="w-full input-dark text-[11px] px-3 py-2 font-mono" />
                        <input value={hashForm.sha1} onChange={e => setHashForm(p => ({ ...p, sha1: e.target.value }))} placeholder="SHA-1" className="w-full input-dark text-[11px] px-3 py-2 font-mono" />
                        <input value={hashForm.sha256} onChange={e => setHashForm(p => ({ ...p, sha256: e.target.value }))} placeholder="SHA-256" className="w-full input-dark text-[11px] px-3 py-2 font-mono" />
                        <input value={hashForm.sha512} onChange={e => setHashForm(p => ({ ...p, sha512: e.target.value }))} placeholder="SHA-512 (optional)" className="w-full input-dark text-[11px] px-3 py-2 font-mono" />
                        {selected?.exhibits && selected.exhibits.length > 0 && (
                          <select value={hashForm.exhibit_id} onChange={e => setHashForm(p => ({ ...p, exhibit_id: e.target.value }))}
                            className="w-full bg-surface-sunken border border-rmpg-700 text-[11px] text-rmpg-300 px-3 py-2 rounded-sm">
                            <option value="">Link to exhibit (optional)</option>
                            {selected.exhibits.map(ex => <option key={ex.id} value={ex.id}>Exhibit {ex.exhibit_number} — {ex.description}</option>)}
                          </select>
                        )}
                        <input value={hashForm.notes} onChange={e => setHashForm(p => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" className="w-full input-dark text-[11px] px-3 py-2" />
                        <div className="flex gap-2 pt-1">
                          <button onClick={handleAddManualHash} className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5 flex items-center gap-1"><Save className="w-3 h-3" /> Save</button>
                          <button onClick={() => setShowAddHash(false)} className="toolbar-btn text-[10px] px-3 py-1.5">Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Hash records */}
                    {hashRecords.length === 0 ? (
                      <EmptyState icon={Hash} title="No hash records" subtitle="Compute hashes from evidence file paths or enter manually from external tools" />
                    ) : hashRecords.map(hr => (
                      <div key={hr.id} className={`panel-beveled bg-surface-base p-4 ${
                        hr.flagged ? 'border-l-2 border-l-red-500' : hr.hash_set_match ? 'border-l-2 border-l-amber-500' : ''
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <FileDigit className="w-4 h-4 text-brand-400" />
                            <span className="text-[11px] font-bold text-rmpg-200 truncate max-w-[260px]">{hr.file_name}</span>
                            {hr.exhibit_number && <Badge variant="blue">Exhibit {hr.exhibit_number}</Badge>}
                            {hr.flagged === 1 && <Badge variant="red"><Flag className="w-2 h-2 inline mr-0.5" />FLAGGED</Badge>}
                            {hr.hash_set_match === 1 && <Badge variant="amber"><Shield className="w-2 h-2 inline mr-0.5" />SET MATCH</Badge>}
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleFlagHash(hr.id, !hr.flagged, hr.flagged ? undefined : 'Manual flag')}
                              className={`toolbar-btn p-1 ${hr.flagged ? 'text-red-400' : 'text-rmpg-500'}`} title={hr.flagged ? 'Unflag' : 'Flag'}>
                              <Flag className="w-3 h-3" />
                            </button>
                            <button onClick={() => handleDeleteHash(hr.id)} className="toolbar-btn p-1 text-rmpg-500 hover:text-red-400" title="Delete">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-rmpg-500 mb-2">
                          {hr.file_size && <span>{formatFileSize(hr.file_size)}</span>}
                          {hr.mime_type && <span>{hr.mime_type}</span>}
                          <span>{formatDateTime(hr.created_at)}</span>
                        </div>
                        <div className="space-y-1.5">
                          {[
                            { label: 'MD5', value: hr.md5 },
                            { label: 'SHA-1', value: hr.sha1 },
                            { label: 'SHA-256', value: hr.sha256 },
                            { label: 'SHA-512', value: hr.sha512 },
                          ].filter(h => h.value).map(h => (
                            <div key={h.label} className="flex items-center gap-2 group">
                              <span className="text-[10px] text-rmpg-500 w-16 shrink-0 font-bold">{h.label}</span>
                              <span className="text-[10px] font-mono text-rmpg-300 truncate flex-1">{h.value}</span>
                              <button onClick={() => copyToClipboard(h.value!, h.label)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity toolbar-btn p-0.5" title={`Copy ${h.label}`}>
                                <Copy className={`w-3 h-3 ${copiedHash === h.value ? 'text-green-400' : 'text-rmpg-500'}`} />
                              </button>
                            </div>
                          ))}
                        </div>
                        {hr.dhash && (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-rmpg-500 w-16 shrink-0 font-bold">Fingerprint</span>
                            <span className="text-[10px] font-mono text-rmpg-400 truncate">{hr.dhash}</span>
                          </div>
                        )}
                        {hr.hash_set_match === 1 && (
                          <div className="mt-2 bg-amber-950/30 border border-amber-800/30 rounded-sm px-3 py-2 text-[10px]">
                            <span className="text-amber-400 font-bold">Hash Set Match:</span>
                            <span className="text-rmpg-300 ml-1">{hr.hash_set_name || 'Unknown set'}</span>
                            {hr.hash_set_category && <span className="text-rmpg-500 ml-1">({hr.hash_set_category})</span>}
                            {hr.match_confidence && <span className="text-amber-400 ml-2">{(hr.match_confidence * 100).toFixed(0)}% confidence</span>}
                          </div>
                        )}
                        {hr.flagged === 1 && hr.flag_reason && (
                          <div className="mt-2 text-[10px] text-red-400"><span className="font-bold">Flag reason:</span> {hr.flag_reason}</div>
                        )}
                        {hr.notes && <div className="mt-1.5 text-[10px] text-rmpg-500"><span className="font-bold text-rmpg-400">Notes:</span> {hr.notes}</div>}
                        {hr.reviewed_at && <div className="mt-1 text-[9px] text-green-400/70">Reviewed {formatDateTime(hr.reviewed_at)}</div>}
                      </div>
                    ))}
                  </>
                )}

                {/* ═══ LINKED EVIDENCE TAB ═══ */}
                {detailTab === 'linked' && (
                  <>
                    <SectionHeader icon={Link} title="Linked Evidence" count={linkedStats.total} actions={
                      <button onClick={() => setShowLinkSearch(!showLinkSearch)}
                        className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1 px-2.5 py-1">
                        {showLinkSearch ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                        {showLinkSearch ? 'Close' : 'Link Evidence'}
                      </button>
                    } />

                    {/* Type breakdown chips */}
                    {linkedStats.total > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {Object.entries(linkedStats.by_type).map(([t, c]) => {
                          const info = getLinkTypeInfo(t);
                          const Icon = info.icon;
                          return (
                            <span key={t} className="flex items-center gap-1 text-[9px] bg-rmpg-800/40 border border-rmpg-700/40 text-rmpg-400 px-2 py-1 rounded-sm">
                              <Icon className={`w-2.5 h-2.5 ${info.color}`} /> {info.label}: <strong className="text-rmpg-200">{c}</strong>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Link search */}
                    {showLinkSearch && (
                      <div className="panel-beveled bg-surface-base p-4 space-y-3">
                        <h4 className="text-[11px] font-bold text-rmpg-200">Search & Link Evidence</h4>
                        {/* Source types */}
                        <div className="flex flex-wrap gap-1">
                          {LINK_TYPES.map(src => (
                            <button key={src.type}
                              onClick={() => { setLinkSearchType(src.type); setLinkSearchResults([]); }}
                              className={`flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-sm border transition-colors ${
                                linkSearchType === src.type
                                  ? 'bg-brand-600/20 border-brand-500/50 text-brand-400'
                                  : 'bg-surface-sunken border-rmpg-700 text-rmpg-400 hover:text-rmpg-200 hover:border-rmpg-600'
                              }`}>
                              <src.icon className="w-3 h-3" /> {src.label}
                            </button>
                          ))}
                        </div>
                        {/* Search input */}
                        <div className="flex items-center gap-2">
                          <input value={linkSearchQuery} onChange={e => setLinkSearchQuery(e.target.value)}
                            placeholder={`Search ${linkSearchType.replace(/_/g, ' ')}s...`}
                            className="flex-1 input-dark text-[11px] px-3 py-2"
                            onKeyDown={e => { if (e.key === 'Enter') handleSearchLinkable(); }}
                          />
                          <button onClick={handleSearchLinkable} disabled={linkSearching}
                            className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5 disabled:opacity-50 flex items-center gap-1">
                            {linkSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Search
                          </button>
                        </div>
                        {/* Classification row */}
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-rmpg-500 shrink-0">Classify as:</span>
                          <select value={linkRelationship} onChange={e => setLinkRelationship(e.target.value)}
                            className="bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-1.5 rounded-sm text-[10px]">
                            {RELATIONSHIP_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                          <select value={linkRelevance} onChange={e => setLinkRelevance(e.target.value)}
                            className="bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-1.5 rounded-sm text-[10px]">
                            {RELEVANCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                          <input value={linkNotes} onChange={e => setLinkNotes(e.target.value)}
                            placeholder="Notes (optional)" className="flex-1 input-dark text-[10px] px-2 py-1.5" />
                        </div>
                        {/* Results */}
                        {linkSearchResults.length > 0 && (
                          <div className="space-y-1 max-h-[280px] overflow-y-auto border-t border-rmpg-700/50 pt-2">
                            <div className="text-[10px] text-rmpg-500 font-bold mb-1">{linkSearchResults.length} result(s)</div>
                            {linkSearchResults.map((r: any) => (
                              <div key={r.id} className={`flex items-center justify-between px-3 py-2.5 rounded-sm border ${
                                r.already_linked ? 'bg-green-950/20 border-green-800/30' : 'bg-surface-sunken border-rmpg-700 hover:border-rmpg-600'
                              }`}>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] text-rmpg-200 font-medium truncate">
                                    {r.title || r.incident_number || r.evidence_number || r.report_number || r.case_number || r.fi_number || r.citation_number || r.dar_number || r.original_name || r.channel || `#${r.id}`}
                                  </div>
                                  <div className="text-[9px] text-rmpg-500 truncate mt-0.5">
                                    {[r.officer_name && `Officer: ${r.officer_name}`, r.classification, r.status && `Status: ${r.status}`, r.incident_type, r.address, r.subject_name, r.mime_type, r.shift_date && `Shift: ${r.shift_date}`].filter(Boolean).join(' · ')}
                                  </div>
                                </div>
                                {r.already_linked ? (
                                  <span className="text-[10px] text-green-400 font-bold shrink-0 ml-3 flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" /> Linked
                                  </span>
                                ) : (
                                  <button onClick={() => handleCreateLink(linkSearchType, r.id)}
                                    className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1 shrink-0 ml-3 flex items-center gap-1">
                                    <Link className="w-3 h-3" /> Link
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Linked records */}
                    {linkedRecords.length === 0 && !showLinkSearch ? (
                      <EmptyState icon={Link} title="No linked evidence" subtitle="Connect body cam, dash cam, incidents, reports, evidence items, and more to build a complete forensic case file" action={
                        <button onClick={() => setShowLinkSearch(true)} className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1 px-3 py-1.5">
                          <Plus className="w-3 h-3" /> Link First Evidence
                        </button>
                      } />
                    ) : linkedRecords.map(lr => {
                      const typeInfo = getLinkTypeInfo(lr.linked_type);
                      const TypeIcon = typeInfo.icon;
                      return (
                        <div key={lr.id} className={`panel-beveled bg-surface-base p-4 border-l-2 ${
                          lr.relevance === 'critical' ? 'border-l-red-500' :
                          lr.relevance === 'high' ? 'border-l-amber-500' :
                          lr.relevance === 'standard' ? 'border-l-brand-500' :
                          lr.relevance === 'low' ? 'border-l-rmpg-600' : 'border-l-rmpg-700'
                        }`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`w-6 h-6 rounded-sm bg-rmpg-800/60 border border-rmpg-700/50 flex items-center justify-center shrink-0`}>
                                <TypeIcon className={`w-3.5 h-3.5 ${typeInfo.color}`} />
                              </div>
                              <span className="text-[11px] font-bold text-rmpg-200 truncate">
                                {lr.resolved?.display_name || `${lr.linked_type} #${lr.linked_id}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => setEditingLink(editingLink?.id === lr.id ? null : lr)}
                                className="toolbar-btn p-1 text-rmpg-500 hover:text-brand-400" title="Edit"><Edit2 className="w-3 h-3" /></button>
                              <button onClick={() => handleDeleteLink(lr.id)}
                                className="toolbar-btn p-1 text-rmpg-500 hover:text-red-400" title="Remove"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          </div>
                          {lr.resolved?.display_detail && <div className="text-[10px] text-rmpg-500 mb-2 ml-8">{lr.resolved.display_detail}</div>}
                          <div className="flex items-center gap-1.5 flex-wrap ml-8">
                            <Badge>{typeInfo.label}</Badge>
                            <Badge variant={lr.relationship === 'primary_evidence' ? 'red' : lr.relationship === 'suspect_device' || lr.relationship === 'victim_device' ? 'amber' : lr.relationship === 'forensic_source' ? 'purple' : lr.relationship === 'chain_of_custody' ? 'cyan' : 'default'}>{lr.relationship.replace(/_/g, ' ')}</Badge>
                            <Badge variant={lr.relevance === 'critical' ? 'red' : lr.relevance === 'high' ? 'amber' : lr.relevance === 'standard' ? 'blue' : 'default'}>{lr.relevance.replace(/_/g, ' ')}</Badge>
                            <span className="text-[8px] text-rmpg-600 ml-auto">{lr.linked_by_name} &bull; {formatDateTime(lr.linked_at)}</span>
                          </div>
                          {lr.notes && <div className="text-[10px] text-rmpg-500 mt-2 ml-8"><span className="text-rmpg-400 font-bold">Notes:</span> {lr.notes}</div>}
                          {editingLink?.id === lr.id && (
                            <div className="mt-3 pt-3 border-t border-rmpg-700/50 space-y-2 ml-8">
                              <div className="flex items-center gap-2">
                                <select defaultValue={lr.relationship} onChange={e => setEditingLink({ ...editingLink, relationship: e.target.value })}
                                  className="bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-300 px-2 py-1.5 rounded-sm">
                                  {RELATIONSHIP_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                                <select defaultValue={lr.relevance} onChange={e => setEditingLink({ ...editingLink, relevance: e.target.value })}
                                  className="bg-surface-sunken border border-rmpg-700 text-[10px] text-rmpg-300 px-2 py-1.5 rounded-sm">
                                  {RELEVANCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                              </div>
                              <input defaultValue={lr.notes || ''} onChange={e => setEditingLink({ ...editingLink, notes: e.target.value })}
                                placeholder="Notes" className="w-full input-dark text-[10px] px-2 py-1.5" />
                              <div className="flex gap-1">
                                <button onClick={() => handleUpdateLink(lr.id, { relationship: editingLink.relationship, relevance: editingLink.relevance, notes: editingLink.notes })}
                                  className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1">Save</button>
                                <button onClick={() => setEditingLink(null)} className="toolbar-btn text-[10px] px-3 py-1">Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {/* ═══ TIMELINE TAB ═══ */}
                {detailTab === 'timeline' && (
                  <>
                    <SectionHeader icon={Clock} title="Case Timeline" count={selected.timeline?.length || 0} />

                    <div className="flex items-center gap-2">
                      <input value={timelineNote} onChange={e => setTimelineNote(e.target.value)}
                        placeholder="Add a note to the case timeline..."
                        className="flex-1 input-dark text-[11px] px-3 py-2"
                        onKeyDown={e => { if (e.key === 'Enter') handleAddNote(); }}
                      />
                      <button onClick={handleAddNote} disabled={!timelineNote.trim()}
                        className="toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5 disabled:opacity-50">
                        Add Note
                      </button>
                    </div>

                    {(selected.timeline || []).length === 0 ? (
                      <EmptyState icon={Clock} title="No timeline entries" subtitle="Timeline events are automatically created when you modify the case, add exhibits, or link evidence" />
                    ) : (
                      <div className="relative pl-6 mt-2">
                        <div className="absolute left-[9px] top-2 bottom-2 w-px bg-rmpg-700" />
                        {(selected.timeline || []).map(t => (
                          <div key={t.id} className="relative flex items-start gap-3 pb-4">
                            <div className={`absolute left-[-15px] top-1.5 w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-rmpg-950 ${
                              t.action === 'created' ? 'bg-green-400' :
                              t.action === 'status_change' ? 'bg-blue-400' :
                              t.action === 'assigned' ? 'bg-indigo-400' :
                              t.action === 'exhibit_added' ? 'bg-amber-400' :
                              t.action === 'analysis_created' || t.action === 'analysis_update' ? 'bg-purple-400' :
                              t.action === 'evidence_linked' ? 'bg-cyan-400' :
                              t.action === 'evidence_unlinked' ? 'bg-orange-400' :
                              t.action === 'link_updated' ? 'bg-teal-400' :
                              'bg-rmpg-500'
                            }`} />
                            <div className="flex-1 min-w-0 ml-1">
                              <div className="text-[11px] text-rmpg-200 leading-relaxed">{t.description}</div>
                              <div className="text-[10px] text-rmpg-600 mt-0.5 flex items-center gap-1.5">
                                <User className="w-2.5 h-2.5" />
                                {t.performed_by_name || 'System'} &bull; {formatDateTime(t.created_at)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ NEW CASE MODAL ═══ */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-base border border-rmpg-700 rounded-sm w-[520px] max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
              <h3 className="text-[12px] font-bold text-rmpg-200 flex items-center gap-2">
                <Microscope className="w-4 h-4 text-brand-400" /> New Forensic Case
              </h3>
              <button onClick={() => setShowForm(false)} className="toolbar-btn p-1"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Case Title *</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g., Digital Device Extraction — Case #2024-0123"
                  className="w-full input-dark text-[12px] px-3 py-2.5" autoFocus />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Case Type</label>
                  <select value={form.case_type} onChange={e => setForm(p => ({ ...p, case_type: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2">{TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Priority</label>
                  <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2">{PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Requesting Officer</label>
                  <input value={form.requesting_officer_name} onChange={e => setForm(p => ({ ...p, requesting_officer_name: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Assigned Examiner</label>
                  <input value={form.assigned_examiner_name} onChange={e => setForm(p => ({ ...p, assigned_examiner_name: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Lab Location</label>
                <input value={form.lab_location} onChange={e => setForm(p => ({ ...p, lab_location: e.target.value }))}
                  className="w-full input-dark text-[11px] px-3 py-2" />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Synopsis</label>
                <textarea value={form.synopsis} onChange={e => setForm(p => ({ ...p, synopsis: e.target.value }))}
                  rows={3} className="w-full textarea-dark text-[11px] px-3 py-2" />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2} className="w-full textarea-dark text-[11px] px-3 py-2" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-rmpg-700">
              <button onClick={() => setShowForm(false)} className="toolbar-btn text-[10px] px-4 py-1.5">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !form.title.trim()}
                className="toolbar-btn toolbar-btn-primary text-[10px] px-5 py-1.5 disabled:opacity-50 flex items-center gap-1">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Create Case
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ EDIT CASE MODAL ═══ */}
      {editMode && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-base border border-rmpg-700 rounded-sm w-[520px] max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
              <h3 className="text-[12px] font-bold text-rmpg-200 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-brand-400" /> Edit {selected.lab_case_number}
              </h3>
              <button onClick={() => setEditMode(false)} className="toolbar-btn p-1"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Case Title *</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full input-dark text-[12px] px-3 py-2.5" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Case Type</label>
                  <select value={form.case_type} onChange={e => setForm(p => ({ ...p, case_type: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2">{TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Priority</label>
                  <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2">{PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Requesting Officer</label>
                  <input value={form.requesting_officer_name} onChange={e => setForm(p => ({ ...p, requesting_officer_name: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Assigned Examiner</label>
                  <input value={form.assigned_examiner_name} onChange={e => setForm(p => ({ ...p, assigned_examiner_name: e.target.value }))}
                    className="w-full input-dark text-[11px] px-3 py-2" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Lab Location</label>
                <input value={form.lab_location} onChange={e => setForm(p => ({ ...p, lab_location: e.target.value }))}
                  className="w-full input-dark text-[11px] px-3 py-2" />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Synopsis</label>
                <textarea value={form.synopsis} onChange={e => setForm(p => ({ ...p, synopsis: e.target.value }))}
                  rows={3} className="w-full textarea-dark text-[11px] px-3 py-2" />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 mb-1 block font-medium">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2} className="w-full textarea-dark text-[11px] px-3 py-2" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-rmpg-700">
              <button onClick={() => setEditMode(false)} className="toolbar-btn text-[10px] px-4 py-1.5">Cancel</button>
              <button onClick={handleSaveEdit} disabled={saving || !form.title.trim()}
                className="toolbar-btn toolbar-btn-primary text-[10px] px-5 py-1.5 disabled:opacity-50 flex items-center gap-1">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
