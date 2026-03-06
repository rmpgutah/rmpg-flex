// ============================================================
// RMPG Flex — Forensics Lab Page
// ============================================================
// Full forensic lab case management with exhibit tracking,
// analysis workflow, chain-of-custody, and activity timeline.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Microscope, Search, Plus, ChevronDown, User, Clock, FileText,
  X, Save, Loader2, Package, FlaskConical, Activity, Hash,
  ArrowRight, CheckCircle, AlertTriangle, Shield, Fingerprint,
  Trash2, Edit3, ChevronRight, Link2, Beaker, Eye, Lock,
} from 'lucide-react';
import type {
  ForensicCase, ForensicExhibit, ForensicAnalysis, ForensicActivityLog,
  ForensicCaseStatus, ForensicCaseType, ForensicPriority,
  ExhibitType, AnalysisType, AnalysisStatus, ExhibitDisposition,
} from '../types';
import SplitPanel from '../components/SplitPanel';
import PanelTitleBar from '../components/PanelTitleBar';
import CollapsibleSection from '../components/CollapsibleSection';
import FormModal from '../components/FormModal';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useFormDirty } from '../hooks/useFormDirty';
import { useToast } from '../components/ToastProvider';

// ── Status / Type Config ─────────────────────────────────

const STATUS_STEPS: { value: ForensicCaseStatus; label: string; short: string }[] = [
  { value: 'received', label: 'Received', short: 'RCV' },
  { value: 'in_progress', label: 'In Progress', short: 'WIP' },
  { value: 'analysis_complete', label: 'Analysis Done', short: 'ANL' },
  { value: 'report_drafted', label: 'Report Drafted', short: 'RPT' },
  { value: 'reviewed', label: 'Reviewed', short: 'REV' },
  { value: 'released', label: 'Released', short: 'REL' },
];

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  in_progress: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  analysis_complete: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  report_drafted: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50',
  reviewed: 'bg-green-900/50 text-green-400 border-green-700/50',
  released: 'bg-gray-700/50 text-rmpg-300 border-rmpg-600/50',
  cancelled: 'bg-red-900/50 text-red-400 border-red-700/50',
};

const PRIORITY_COLORS: Record<string, string> = {
  routine: 'text-rmpg-400',
  normal: 'text-blue-400',
  rush: 'text-amber-400',
  urgent: 'text-red-400',
};

const PRIORITY_BG: Record<string, string> = {
  routine: 'border-l-rmpg-600',
  normal: 'border-l-blue-600',
  rush: 'border-l-amber-500',
  urgent: 'border-l-red-500',
};

const CASE_TYPE_OPTIONS: { value: ForensicCaseType; label: string }[] = [
  { value: 'general', label: 'General' }, { value: 'homicide', label: 'Homicide' },
  { value: 'sexual_assault', label: 'Sexual Assault' }, { value: 'narcotics', label: 'Narcotics' },
  { value: 'arson', label: 'Arson' }, { value: 'fraud', label: 'Fraud' },
  { value: 'burglary', label: 'Burglary' }, { value: 'robbery', label: 'Robbery' },
  { value: 'digital', label: 'Digital / Cyber' }, { value: 'traffic', label: 'Traffic' },
  { value: 'cold_case', label: 'Cold Case' }, { value: 'other', label: 'Other' },
];

const PRIORITY_OPTIONS: { value: ForensicPriority; label: string }[] = [
  { value: 'routine', label: 'Routine' }, { value: 'normal', label: 'Normal' },
  { value: 'rush', label: 'Rush' }, { value: 'urgent', label: 'Urgent' },
];

const EXHIBIT_TYPE_OPTIONS: { value: ExhibitType; label: string }[] = [
  { value: 'biological', label: 'Biological' }, { value: 'chemical', label: 'Chemical' },
  { value: 'digital', label: 'Digital Media' }, { value: 'document', label: 'Document' },
  { value: 'drug', label: 'Drug / Substance' }, { value: 'explosive', label: 'Explosive' },
  { value: 'fingerprint', label: 'Fingerprint' }, { value: 'firearm', label: 'Firearm' },
  { value: 'trace', label: 'Trace Evidence' }, { value: 'clothing', label: 'Clothing' },
  { value: 'dna_sample', label: 'DNA Sample' }, { value: 'tool_mark', label: 'Tool Mark' },
  { value: 'glass', label: 'Glass' }, { value: 'paint', label: 'Paint' },
  { value: 'fiber', label: 'Fiber' }, { value: 'soil', label: 'Soil' },
  { value: 'impression', label: 'Impression' }, { value: 'other', label: 'Other' },
];

const ANALYSIS_TYPE_OPTIONS: { value: AnalysisType; label: string }[] = [
  { value: 'dna', label: 'DNA Analysis' }, { value: 'fingerprint', label: 'Fingerprint' },
  { value: 'drug_analysis', label: 'Drug Analysis' }, { value: 'toxicology', label: 'Toxicology' },
  { value: 'ballistics', label: 'Ballistics' }, { value: 'digital_forensics', label: 'Digital Forensics' },
  { value: 'document_exam', label: 'Document Exam' }, { value: 'trace_evidence', label: 'Trace Evidence' },
  { value: 'serology', label: 'Serology' }, { value: 'arson_analysis', label: 'Arson Analysis' },
  { value: 'tool_mark', label: 'Tool Mark' }, { value: 'glass_analysis', label: 'Glass Analysis' },
  { value: 'paint_analysis', label: 'Paint Analysis' }, { value: 'fiber_analysis', label: 'Fiber Analysis' },
  { value: 'blood_spatter', label: 'Blood Spatter' }, { value: 'gunshot_residue', label: 'Gunshot Residue' },
  { value: 'other', label: 'Other' },
];

const ANALYSIS_STATUS_COLORS: Record<AnalysisStatus, string> = {
  pending: 'bg-gray-700/50 text-rmpg-300 border-rmpg-600/50',
  in_progress: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  completed: 'bg-green-900/50 text-green-400 border-green-700/50',
  inconclusive: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  cancelled: 'bg-red-900/50 text-red-400 border-red-700/50',
};

const DISPOSITION_COLORS: Record<ExhibitDisposition, string> = {
  in_lab: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  returned: 'bg-green-900/50 text-green-400 border-green-700/50',
  destroyed: 'bg-red-900/50 text-red-400 border-red-700/50',
  transferred: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  in_storage: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50',
};

const EMPTY_CASE_FORM = {
  title: '', case_type: 'general' as ForensicCaseType, priority: 'normal' as ForensicPriority,
  description: '', requesting_agency: 'RMPG', requesting_officer: '',
  lead_examiner_id: '', linked_incident_number: '', linked_case_number: '',
  due_date: '', notes: '',
};

const EMPTY_EXHIBIT_FORM = {
  exhibit_type: 'other' as ExhibitType, description: '', quantity: 1,
  condition_received: '', storage_location: '', collected_by: '',
  collected_date: '', collection_method: '', hash_md5: '', hash_sha256: '', notes: '',
};

const EMPTY_ANALYSIS_FORM = {
  analysis_type: 'dna' as AnalysisType, exhibit_id: '',
  methodology: '', equipment_used: '', notes: '',
};

// ── Helper: format date for display ──────────────────────
function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch { return d; }
}

function fmtDateTime(d?: string | null): string {
  if (!d) return '—';
  try {
    const date = new Date(d);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return d; }
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════

export default function ForensicsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();

  // ── Data state ─────────────────────────────────────────
  const [cases, setCases] = useState<ForensicCase[]>([]);
  const [selected, setSelected] = useState<ForensicCase | null>(null);
  const [exhibits, setExhibits] = useState<ForensicExhibit[]>([]);
  const [analyses, setAnalyses] = useState<ForensicAnalysis[]>([]);
  const [activity, setActivity] = useState<ForensicActivityLog[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filters ────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // ── Modals ─────────────────────────────────────────────
  const [caseFormOpen, setCaseFormOpen] = useState(false);
  const [caseForm, setCaseForm] = useState({ ...EMPTY_CASE_FORM });
  const [caseSubmitting, setCaseSubmitting] = useState(false);

  const [exhibitFormOpen, setExhibitFormOpen] = useState(false);
  const [exhibitForm, setExhibitForm] = useState({ ...EMPTY_EXHIBIT_FORM });
  const [exhibitSubmitting, setExhibitSubmitting] = useState(false);

  const [analysisFormOpen, setAnalysisFormOpen] = useState(false);
  const [analysisForm, setAnalysisForm] = useState({ ...EMPTY_ANALYSIS_FORM });
  const [analysisSubmitting, setAnalysisSubmitting] = useState(false);

  // ── Detail tab ─────────────────────────────────────────
  const [detailTab, setDetailTab] = useState<'exhibits' | 'analyses' | 'timeline'>('exhibits');

  // ── Form dirty tracking ────────────────────────────────
  const { isDirty: caseDirty, snapshot: caseSnapshot } = useFormDirty(caseForm, caseFormOpen);
  const { isDirty: exhibitDirty, snapshot: exhibitSnapshot } = useFormDirty(exhibitForm, exhibitFormOpen);
  const { isDirty: analysisDirty, snapshot: analysisSnapshot } = useFormDirty(analysisForm, analysisFormOpen);

  // ── Status change ──────────────────────────────────────
  const [statusChanging, setStatusChanging] = useState(false);

  // ── Data fetching ──────────────────────────────────────
  const fetchCases = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '200',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterType ? { case_type: filterType } : {}),
        ...(filterPriority ? { priority: filterPriority } : {}),
      });
      const res = await apiFetch<{ data: ForensicCase[] }>(`/forensics?${params}`);
      setCases(res.data || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [searchQuery, filterStatus, filterType, filterPriority]);

  const fetchStats = useCallback(async () => {
    try { const res = await apiFetch<{ data: any }>('/forensics/stats'); setStats(res.data); } catch {}
  }, []);

  const fetchExhibits = useCallback(async (caseId: number) => {
    try { const res = await apiFetch<{ data: ForensicExhibit[] }>(`/forensics/${caseId}/exhibits`); setExhibits(res.data || []); } catch {}
  }, []);

  const fetchAnalyses = useCallback(async (caseId: number) => {
    try { const res = await apiFetch<{ data: ForensicAnalysis[] }>(`/forensics/${caseId}/analyses`); setAnalyses(res.data || []); } catch {}
  }, []);

  const fetchActivity = useCallback(async (caseId: number) => {
    try { const res = await apiFetch<{ data: ForensicActivityLog[] }>(`/forensics/${caseId}/activity`); setActivity(res.data || []); } catch {}
  }, []);

  useEffect(() => { fetchCases(); }, [fetchCases]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    apiFetch<{ data: any[] }>('/personnel?per_page=200').then(r => setUsers(r.data || [])).catch(() => {});
  }, []);
  useLiveSync('records', () => { fetchCases({ silent: true }); fetchStats(); });

  useEffect(() => {
    if (selected) {
      fetchExhibits(selected.id);
      fetchAnalyses(selected.id);
      fetchActivity(selected.id);
    } else {
      setExhibits([]);
      setAnalyses([]);
      setActivity([]);
    }
  }, [selected, fetchExhibits, fetchAnalyses, fetchActivity]);

  // Keep selected in sync with latest data
  useEffect(() => {
    if (selected) {
      const updated = cases.find(c => c.id === selected.id);
      if (updated) setSelected(updated);
    }
  }, [cases]);

  // ── CRUD handlers ──────────────────────────────────────

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseForm.title.trim()) { addToast('Title is required', 'error'); return; }
    setCaseSubmitting(true);
    try {
      await apiFetch('/forensics', { method: 'POST', body: JSON.stringify(caseForm) });
      addToast('Lab case created', 'success');
      setCaseFormOpen(false);
      setCaseForm({ ...EMPTY_CASE_FORM });
      fetchCases({ silent: true });
      fetchStats();
    } catch (err: any) { addToast(err?.message || 'Failed to create case', 'error'); }
    finally { setCaseSubmitting(false); }
  };

  const handleStatusChange = async (newStatus: ForensicCaseStatus) => {
    if (!selected) return;
    setStatusChanging(true);
    try {
      const res = await apiFetch<{ data: ForensicCase }>(`/forensics/${selected.id}`, {
        method: 'PUT', body: JSON.stringify({ status: newStatus }),
      });
      setSelected(res.data);
      addToast(`Status updated to ${newStatus.replace(/_/g, ' ')}`, 'success');
      fetchCases({ silent: true });
      fetchStats();
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Failed to update status', 'error'); }
    finally { setStatusChanging(false); }
  };

  const handleDeleteCase = async () => {
    if (!selected) return;
    if (!confirm(`Delete lab case ${selected.lab_number}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/forensics/${selected.id}`, { method: 'DELETE' });
      addToast('Case deleted', 'success');
      setSelected(null);
      fetchCases({ silent: true });
      fetchStats();
    } catch (err: any) { addToast(err?.message || 'Failed to delete', 'error'); }
  };

  const handleCreateExhibit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !exhibitForm.description.trim()) return;
    setExhibitSubmitting(true);
    try {
      await apiFetch(`/forensics/${selected.id}/exhibits`, {
        method: 'POST', body: JSON.stringify(exhibitForm),
      });
      addToast('Exhibit added', 'success');
      setExhibitFormOpen(false);
      setExhibitForm({ ...EMPTY_EXHIBIT_FORM });
      fetchExhibits(selected.id);
      fetchCases({ silent: true });
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Failed to add exhibit', 'error'); }
    finally { setExhibitSubmitting(false); }
  };

  const handleDeleteExhibit = async (exhibitId: number) => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/exhibits/${exhibitId}`, { method: 'DELETE' });
      addToast('Exhibit removed', 'success');
      fetchExhibits(selected.id);
      fetchCases({ silent: true });
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Failed to delete', 'error'); }
  };

  const handleCreateAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setAnalysisSubmitting(true);
    try {
      await apiFetch(`/forensics/${selected.id}/analyses`, {
        method: 'POST', body: JSON.stringify({
          ...analysisForm,
          exhibit_id: analysisForm.exhibit_id || null,
        }),
      });
      addToast('Analysis created', 'success');
      setAnalysisFormOpen(false);
      setAnalysisForm({ ...EMPTY_ANALYSIS_FORM });
      fetchAnalyses(selected.id);
      fetchCases({ silent: true });
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Failed to create analysis', 'error'); }
    finally { setAnalysisSubmitting(false); }
  };

  const handleAnalysisStatusChange = async (analysisId: number, newStatus: AnalysisStatus, results?: string, conclusion?: string) => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/analyses/${analysisId}`, {
        method: 'PUT', body: JSON.stringify({ status: newStatus, results, conclusion }),
      });
      addToast('Analysis updated', 'success');
      fetchAnalyses(selected.id);
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Failed to update', 'error'); }
  };

  const handleDeleteAnalysis = async (analysisId: number) => {
    if (!selected) return;
    try {
      await apiFetch(`/forensics/${selected.id}/analyses/${analysisId}`, { method: 'DELETE' });
      addToast('Analysis deleted', 'success');
      fetchAnalyses(selected.id);
      fetchCases({ silent: true });
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Failed to delete', 'error'); }
  };

  // ═══════════════════════════════════════════════════════
  // LEFT PANEL — Case List
  // ═══════════════════════════════════════════════════════

  const statusStepIndex = (status: ForensicCaseStatus) => STATUS_STEPS.findIndex(s => s.value === status);

  const leftPanel = (
    <div className="h-full flex flex-col overflow-hidden bg-surface-base">
      <PanelTitleBar title="Forensic Lab Cases" icon={Microscope}>
        <button
          onClick={() => { setCaseForm({ ...EMPTY_CASE_FORM }); caseSnapshot(EMPTY_CASE_FORM); setCaseFormOpen(true); }}
          className="toolbar-btn toolbar-btn-primary text-[10px]"
          style={{ padding: '2px 10px' }}
        >
          <Plus className="w-3 h-3" /> New Case
        </button>
      </PanelTitleBar>

      {/* Stats bar */}
      {stats && (
        <div className="flex gap-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b border-rmpg-700/50"
          style={{ background: 'rgba(10, 14, 20, 0.5)' }}>
          <span className="text-rmpg-400">Total: <span className="text-white font-mono">{stats.total || 0}</span></span>
          <span className="text-blue-400">Active: <span className="font-mono">{(stats.by_status?.received || 0) + (stats.by_status?.in_progress || 0)}</span></span>
          <span className="text-purple-400">Analysis: <span className="font-mono">{stats.pending_analyses || 0}</span></span>
          <span className="text-green-400">Done: <span className="font-mono">{stats.by_status?.released || 0}</span></span>
        </div>
      )}

      {/* Search & Filters */}
      <div className="p-2 space-y-1.5 border-b border-rmpg-700/50">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500" />
          <input
            className="input-dark w-full pl-7 text-xs"
            placeholder="Search lab #, title, officer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5">
          <select className="select-dark flex-1 text-[10px]" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            {STATUS_STEPS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            <option value="cancelled">Cancelled</option>
          </select>
          <select className="select-dark flex-1 text-[10px]" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {CASE_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="select-dark flex-1 text-[10px]" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
            <option value="">Priority</option>
            {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {/* Case list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-rmpg-400" />
          </div>
        ) : cases.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Microscope className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
            <p className="text-xs text-rmpg-400 font-semibold">No forensic cases found</p>
            <p className="text-[10px] text-rmpg-500 mt-1">Create a new lab case to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-rmpg-700/30">
            {cases.map(c => {
              const isSelected = selected?.id === c.id;
              const stepIdx = statusStepIndex(c.status);
              const progress = c.status === 'cancelled' ? 0 :
                c.analysis_count && c.analysis_count > 0
                  ? Math.round(((c.completed_analysis_count || 0) / c.analysis_count) * 100)
                  : (stepIdx >= 0 ? Math.round(((stepIdx + 1) / STATUS_STEPS.length) * 100) : 0);

              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full text-left px-3 py-2.5 transition-colors border-l-[3px] ${PRIORITY_BG[c.priority] || 'border-l-rmpg-600'} ${
                    isSelected ? 'bg-brand-900/30' : 'hover:bg-surface-raised'
                  }`}
                >
                  {/* Row 1: Lab number + status badge */}
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold font-mono text-white">{c.lab_number}</span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border panel-beveled ${STATUS_COLORS[c.status] || ''}`}>
                      {c.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  {/* Row 2: Title */}
                  <p className="text-[11px] text-rmpg-200 leading-tight truncate mb-1">{c.title}</p>

                  {/* Row 3: Meta */}
                  <div className="flex items-center gap-2 text-[10px] text-rmpg-500">
                    <span className="capitalize">{c.case_type.replace(/_/g, ' ')}</span>
                    <span>·</span>
                    <span className={PRIORITY_COLORS[c.priority]}>{c.priority}</span>
                    {c.exhibit_count ? <>
                      <span>·</span>
                      <span>{c.exhibit_count} exhibit{c.exhibit_count !== 1 ? 's' : ''}</span>
                    </> : null}
                  </div>

                  {/* Progress bar */}
                  <div className="mt-1.5 h-1 bg-rmpg-700/50 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300 rounded-full"
                      style={{
                        width: `${progress}%`,
                        background: progress === 100 ? '#22c55e' : progress > 60 ? '#a855f7' : '#3b82f6',
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════
  // RIGHT PANEL — Case Detail
  // ═══════════════════════════════════════════════════════

  const rightPanel = selected ? (
    <div className="h-full flex flex-col overflow-hidden bg-surface-base">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-rmpg-700/50">
        <PanelTitleBar title={selected.lab_number} icon={Microscope}>
          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border panel-beveled ${STATUS_COLORS[selected.status]}`}>
            {selected.status.replace(/_/g, ' ')}
          </span>
          <button onClick={handleDeleteCase} className="toolbar-btn toolbar-btn-danger text-[9px]" style={{ padding: '2px 6px' }}>
            <Trash2 className="w-3 h-3" />
          </button>
          <button onClick={() => setSelected(null)} className="toolbar-btn text-[9px]" style={{ padding: '2px 6px' }}>
            <X className="w-3 h-3" />
          </button>
        </PanelTitleBar>

        {/* Case info row */}
        <div className="px-3 py-2 space-y-1.5" style={{ background: 'rgba(10, 14, 20, 0.4)' }}>
          <p className="text-sm font-semibold text-white leading-snug">{selected.title}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-rmpg-400">
            <span>Type: <strong className="text-rmpg-200 capitalize">{selected.case_type.replace(/_/g, ' ')}</strong></span>
            <span>Priority: <strong className={PRIORITY_COLORS[selected.priority]}>{selected.priority}</strong></span>
            <span>Examiner: <strong className="text-rmpg-200">{selected.lead_examiner_name || '—'}</strong></span>
            <span>Received: <strong className="text-rmpg-200">{fmtDate(selected.received_date)}</strong></span>
            {selected.due_date && <span>Due: <strong className="text-amber-400">{fmtDate(selected.due_date)}</strong></span>}
            {selected.requesting_officer && <span>Req. Officer: <strong className="text-rmpg-200">{selected.requesting_officer}</strong></span>}
            {selected.linked_incident_number && <span><Link2 className="w-3 h-3 inline" /> <strong className="text-blue-400">{selected.linked_incident_number}</strong></span>}
            {selected.linked_case_number && <span><Link2 className="w-3 h-3 inline" /> <strong className="text-blue-400">{selected.linked_case_number}</strong></span>}
          </div>
          {selected.description && (
            <p className="text-[11px] text-rmpg-300 leading-snug">{selected.description}</p>
          )}
        </div>

        {/* Workflow stepper */}
        {selected.status !== 'cancelled' && (
          <div className="px-3 py-2 flex items-center gap-0.5 border-t border-rmpg-700/30">
            {STATUS_STEPS.map((step, i) => {
              const currentIdx = statusStepIndex(selected.status);
              const isCurrent = i === currentIdx;
              const isComplete = i < currentIdx;
              const isNext = i === currentIdx + 1;

              return (
                <React.Fragment key={step.value}>
                  {i > 0 && (
                    <div className={`flex-1 h-px ${isComplete ? 'bg-green-500' : 'bg-rmpg-700/50'}`} />
                  )}
                  <button
                    onClick={() => isNext && !statusChanging ? handleStatusChange(step.value) : undefined}
                    disabled={!isNext || statusChanging}
                    className={`
                      flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-bold uppercase tracking-wide transition-all
                      ${isComplete ? 'text-green-400' : isCurrent ? 'text-white bg-brand-900/30 border border-brand-700/50' : isNext ? 'text-blue-400 hover:bg-blue-900/20 cursor-pointer border border-blue-800/30' : 'text-rmpg-600'}
                    `}
                    title={isNext ? `Advance to: ${step.label}` : step.label}
                  >
                    {isComplete ? (
                      <CheckCircle className="w-3 h-3 text-green-500" />
                    ) : isCurrent ? (
                      <div className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse" />
                    ) : (
                      <div className={`w-2.5 h-2.5 rounded-full border ${isNext ? 'border-blue-500' : 'border-rmpg-600'}`} />
                    )}
                    <span className="hidden xl:inline">{step.short}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-t border-rmpg-700/30">
          {(['exhibits', 'analyses', 'timeline'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className="flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-center transition-colors"
              style={{
                background: detailTab === tab ? 'rgba(188, 16, 16, 0.15)' : 'transparent',
                color: detailTab === tab ? '#fff' : '#808080',
                borderBottom: detailTab === tab ? '2px solid #bc1010' : '2px solid transparent',
              }}
            >
              {tab === 'exhibits' && <Package className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {tab === 'analyses' && <FlaskConical className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {tab === 'timeline' && <Activity className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {tab === 'exhibits' ? `Exhibits (${exhibits.length})` :
               tab === 'analyses' ? `Analyses (${analyses.length})` :
               `Timeline (${activity.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2">
        {detailTab === 'exhibits' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-rmpg-400 font-bold uppercase">Evidence Exhibits</span>
              <button
                onClick={() => { setExhibitForm({ ...EMPTY_EXHIBIT_FORM }); exhibitSnapshot(EMPTY_EXHIBIT_FORM); setExhibitFormOpen(true); }}
                className="toolbar-btn toolbar-btn-primary text-[9px]"
                style={{ padding: '2px 8px' }}
              >
                <Plus className="w-3 h-3" /> Add Exhibit
              </button>
            </div>

            {exhibits.length === 0 ? (
              <div className="text-center py-8">
                <Package className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-xs text-rmpg-400">No exhibits logged</p>
                <p className="text-[10px] text-rmpg-500 mt-1">Add evidence items submitted for analysis</p>
              </div>
            ) : (
              exhibits.map(ex => {
                let custody: any[] = [];
                try { custody = JSON.parse(ex.chain_of_custody || '[]'); } catch {}

                return (
                  <div key={ex.id} className="panel-beveled bg-surface-base p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold font-mono text-white">{ex.exhibit_number}</span>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border panel-beveled ${DISPOSITION_COLORS[ex.disposition]}`}>
                          {ex.disposition.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <button onClick={() => handleDeleteExhibit(ex.id)} className="toolbar-btn toolbar-btn-danger text-[9px]" style={{ padding: '1px 5px' }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <p className="text-[11px] text-rmpg-200 leading-snug">{ex.description}</p>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-rmpg-400">
                      <span>Type: <strong className="text-rmpg-200 capitalize">{ex.exhibit_type.replace(/_/g, ' ')}</strong></span>
                      <span>Qty: <strong className="text-rmpg-200">{ex.quantity}</strong></span>
                      {ex.storage_location && <span>Location: <strong className="text-rmpg-200">{ex.storage_location}</strong></span>}
                      {ex.collected_by && <span>Collected by: <strong className="text-rmpg-200">{ex.collected_by}</strong></span>}
                      {ex.collected_date && <span>Date: <strong className="text-rmpg-200">{fmtDate(ex.collected_date)}</strong></span>}
                    </div>

                    {/* Hash integrity */}
                    {(ex.hash_md5 || ex.hash_sha256) && (
                      <div className="text-[9px] font-mono text-rmpg-500 bg-black/20 px-2 py-1 rounded space-y-0.5">
                        {ex.hash_md5 && <div><Lock className="w-3 h-3 inline text-green-600 mr-1" />MD5: {ex.hash_md5}</div>}
                        {ex.hash_sha256 && <div><Lock className="w-3 h-3 inline text-green-600 mr-1" />SHA-256: {ex.hash_sha256}</div>}
                      </div>
                    )}

                    {/* Chain of Custody */}
                    {custody.length > 0 && (
                      <div className="border-t border-rmpg-700/30 pt-1.5 mt-1.5">
                        <p className="text-[9px] font-bold text-rmpg-500 uppercase mb-1">Chain of Custody ({custody.length})</p>
                        <div className="space-y-0.5">
                          {custody.slice(-3).map((entry: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-400">
                              <div className="w-1.5 h-1.5 rounded-full bg-rmpg-600 flex-shrink-0" />
                              <span className="font-semibold capitalize">{entry.action}</span>
                              <span>by {entry.by}</span>
                              <span className="text-rmpg-600">·</span>
                              <span>{fmtDateTime(entry.at)}</span>
                            </div>
                          ))}
                          {custody.length > 3 && (
                            <p className="text-[9px] text-rmpg-600 pl-4">+{custody.length - 3} more entries</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {detailTab === 'analyses' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-rmpg-400 font-bold uppercase">Lab Analyses</span>
              <button
                onClick={() => { setAnalysisForm({ ...EMPTY_ANALYSIS_FORM }); analysisSnapshot(EMPTY_ANALYSIS_FORM); setAnalysisFormOpen(true); }}
                className="toolbar-btn toolbar-btn-primary text-[9px]"
                style={{ padding: '2px 8px' }}
              >
                <Plus className="w-3 h-3" /> New Analysis
              </button>
            </div>

            {analyses.length === 0 ? (
              <div className="text-center py-8">
                <FlaskConical className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-xs text-rmpg-400">No analyses started</p>
                <p className="text-[10px] text-rmpg-500 mt-1">Create an analysis to begin lab work</p>
              </div>
            ) : (
              analyses.map(a => (
                <div key={a.id} className="panel-beveled bg-surface-base p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white capitalize">{a.analysis_type.replace(/_/g, ' ')}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border panel-beveled ${ANALYSIS_STATUS_COLORS[a.status]}`}>
                        {a.status}
                      </span>
                      {a.exhibit_number && (
                        <span className="text-[9px] text-rmpg-500 font-mono">{a.exhibit_number}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {a.status === 'pending' && (
                        <button
                          onClick={() => handleAnalysisStatusChange(a.id, 'in_progress')}
                          className="toolbar-btn text-[9px]" style={{ padding: '1px 6px' }}
                        >
                          Start
                        </button>
                      )}
                      {a.status === 'in_progress' && (
                        <button
                          onClick={() => {
                            const results = prompt('Enter results:');
                            if (results !== null) {
                              const conclusion = prompt('Conclusion:');
                              handleAnalysisStatusChange(a.id, 'completed', results, conclusion || '');
                            }
                          }}
                          className="toolbar-btn toolbar-btn-success text-[9px]" style={{ padding: '1px 6px' }}
                        >
                          Complete
                        </button>
                      )}
                      <button onClick={() => handleDeleteAnalysis(a.id)} className="toolbar-btn toolbar-btn-danger text-[9px]" style={{ padding: '1px 5px' }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-rmpg-400">
                    <span>Examiner: <strong className="text-rmpg-200">{a.examiner_name || '—'}</strong></span>
                    {a.methodology && <span>Method: <strong className="text-rmpg-200">{a.methodology}</strong></span>}
                    {a.equipment_used && <span>Equipment: <strong className="text-rmpg-200">{a.equipment_used}</strong></span>}
                    {a.started_at && <span>Started: <strong className="text-rmpg-200">{fmtDateTime(a.started_at)}</strong></span>}
                    {a.completed_at && <span>Completed: <strong className="text-rmpg-200">{fmtDateTime(a.completed_at)}</strong></span>}
                  </div>

                  {a.results && (
                    <div className="bg-black/20 px-2 py-1.5 rounded mt-1">
                      <p className="text-[9px] font-bold text-rmpg-500 uppercase mb-0.5">Results</p>
                      <p className="text-[11px] text-rmpg-200 whitespace-pre-wrap">{a.results}</p>
                    </div>
                  )}

                  {a.conclusion && (
                    <div className="bg-green-900/10 border border-green-800/20 px-2 py-1.5 rounded">
                      <p className="text-[9px] font-bold text-green-600 uppercase mb-0.5">Conclusion</p>
                      <p className="text-[11px] text-green-300 whitespace-pre-wrap">{a.conclusion}</p>
                    </div>
                  )}

                  {a.notes && <p className="text-[10px] text-rmpg-500 italic">{a.notes}</p>}
                </div>
              ))
            )}
          </div>
        )}

        {detailTab === 'timeline' && (
          <div className="space-y-1">
            <span className="text-[10px] text-rmpg-400 font-bold uppercase block mb-2">Activity Log</span>
            {activity.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-xs text-rmpg-400">No activity recorded</p>
              </div>
            ) : (
              <div className="relative pl-4">
                {/* Vertical timeline line */}
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-rmpg-700/50" />

                {activity.map(a => (
                  <div key={a.id} className="relative flex items-start gap-3 pb-3">
                    <div className="relative z-10 w-3.5 h-3.5 rounded-full bg-surface-base border-2 border-rmpg-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[11px] text-rmpg-200 font-semibold capitalize">{a.action.replace(/_/g, ' ')}</p>
                        <span className="text-[9px] text-rmpg-600 flex-shrink-0">{fmtDateTime(a.performed_at)}</span>
                      </div>
                      <p className="text-[10px] text-rmpg-400">{a.details}</p>
                      {a.performed_by_name && (
                        <p className="text-[9px] text-rmpg-500">by {a.performed_by_name}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className="h-full flex items-center justify-center bg-surface-base">
      <div className="text-center">
        <Microscope className="w-12 h-12 text-rmpg-700 mx-auto mb-3" />
        <p className="text-sm text-rmpg-400 font-semibold">Select a Lab Case</p>
        <p className="text-xs text-rmpg-500 mt-1">Choose a case from the list or create a new one</p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════

  return (
    <div className="h-full">
      <SplitPanel
        left={leftPanel}
        right={rightPanel}
        rightVisible={isMobile ? !!selected : true}
        initialRatio={0.35}
        persistKey="forensics"
        minLeftPx={280}
        minRightPx={400}
        leftLabel="Cases"
        rightLabel="Detail"
      />

      {/* ── New Case Modal ──────────────────────────────── */}
      <FormModal
        isOpen={caseFormOpen}
        onClose={() => setCaseFormOpen(false)}
        onSubmit={handleCreateCase}
        title="New Forensic Lab Case"
        icon={Microscope}
        submitLabel="Create Lab Case"
        isSubmitting={caseSubmitting}
        maxWidth="max-w-xl"
        isDirty={caseDirty}
      >
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Title *</label>
            <input className="input-dark w-full text-xs" value={caseForm.title}
              onChange={e => setCaseForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Case title / summary" required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Case Type</label>
              <select className="select-dark w-full text-xs" value={caseForm.case_type}
                onChange={e => setCaseForm(f => ({ ...f, case_type: e.target.value as ForensicCaseType }))}>
                {CASE_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Priority</label>
              <select className="select-dark w-full text-xs" value={caseForm.priority}
                onChange={e => setCaseForm(f => ({ ...f, priority: e.target.value as ForensicPriority }))}>
                {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Requesting Agency</label>
              <input className="input-dark w-full text-xs" value={caseForm.requesting_agency}
                onChange={e => setCaseForm(f => ({ ...f, requesting_agency: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Requesting Officer</label>
              <input className="input-dark w-full text-xs" value={caseForm.requesting_officer}
                onChange={e => setCaseForm(f => ({ ...f, requesting_officer: e.target.value }))}
                placeholder="Officer name" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Lead Examiner</label>
              <select className="select-dark w-full text-xs" value={caseForm.lead_examiner_id}
                onChange={e => setCaseForm(f => ({ ...f, lead_examiner_id: e.target.value }))}>
                <option value="">— Select —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Due Date</label>
              <input type="date" className="input-dark w-full text-xs" value={caseForm.due_date}
                onChange={e => setCaseForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Linked Incident #</label>
              <input className="input-dark w-full text-xs" value={caseForm.linked_incident_number}
                onChange={e => setCaseForm(f => ({ ...f, linked_incident_number: e.target.value }))}
                placeholder="RKY26-00001-THF" />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Linked Case #</label>
              <input className="input-dark w-full text-xs" value={caseForm.linked_case_number}
                onChange={e => setCaseForm(f => ({ ...f, linked_case_number: e.target.value }))}
                placeholder="26-000001-GN" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Description</label>
            <textarea className="textarea-dark w-full text-xs" rows={3} value={caseForm.description}
              onChange={e => setCaseForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Detailed description of the forensic request..." />
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Notes</label>
            <textarea className="textarea-dark w-full text-xs" rows={2} value={caseForm.notes}
              onChange={e => setCaseForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Internal notes..." />
          </div>
        </div>
      </FormModal>

      {/* ── New Exhibit Modal ───────────────────────────── */}
      <FormModal
        isOpen={exhibitFormOpen}
        onClose={() => setExhibitFormOpen(false)}
        onSubmit={handleCreateExhibit}
        title={`Add Exhibit — ${selected?.lab_number || ''}`}
        icon={Package}
        submitLabel="Add Exhibit"
        isSubmitting={exhibitSubmitting}
        maxWidth="max-w-xl"
        isDirty={exhibitDirty}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Exhibit Type *</label>
              <select className="select-dark w-full text-xs" value={exhibitForm.exhibit_type}
                onChange={e => setExhibitForm(f => ({ ...f, exhibit_type: e.target.value as ExhibitType }))}>
                {EXHIBIT_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Quantity</label>
              <input type="number" className="input-dark w-full text-xs" value={exhibitForm.quantity} min={1}
                onChange={e => setExhibitForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Description *</label>
            <textarea className="textarea-dark w-full text-xs" rows={3} value={exhibitForm.description}
              onChange={e => setExhibitForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the evidence item..." required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Condition</label>
              <input className="input-dark w-full text-xs" value={exhibitForm.condition_received}
                onChange={e => setExhibitForm(f => ({ ...f, condition_received: e.target.value }))}
                placeholder="Condition when received" />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Storage Location</label>
              <input className="input-dark w-full text-xs" value={exhibitForm.storage_location}
                onChange={e => setExhibitForm(f => ({ ...f, storage_location: e.target.value }))}
                placeholder="Locker, shelf, etc." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Collected By</label>
              <input className="input-dark w-full text-xs" value={exhibitForm.collected_by}
                onChange={e => setExhibitForm(f => ({ ...f, collected_by: e.target.value }))}
                placeholder="Name of collector" />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Collected Date</label>
              <input type="date" className="input-dark w-full text-xs" value={exhibitForm.collected_date}
                onChange={e => setExhibitForm(f => ({ ...f, collected_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Collection Method</label>
            <input className="input-dark w-full text-xs" value={exhibitForm.collection_method}
              onChange={e => setExhibitForm(f => ({ ...f, collection_method: e.target.value }))}
              placeholder="Swab, packaging, imaging, etc." />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">MD5 Hash</label>
              <input className="input-dark w-full text-xs font-mono" value={exhibitForm.hash_md5}
                onChange={e => setExhibitForm(f => ({ ...f, hash_md5: e.target.value }))}
                placeholder="For digital evidence" />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">SHA-256 Hash</label>
              <input className="input-dark w-full text-xs font-mono" value={exhibitForm.hash_sha256}
                onChange={e => setExhibitForm(f => ({ ...f, hash_sha256: e.target.value }))}
                placeholder="For digital evidence" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Notes</label>
            <textarea className="textarea-dark w-full text-xs" rows={2} value={exhibitForm.notes}
              onChange={e => setExhibitForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Additional notes..." />
          </div>
        </div>
      </FormModal>

      {/* ── New Analysis Modal ──────────────────────────── */}
      <FormModal
        isOpen={analysisFormOpen}
        onClose={() => setAnalysisFormOpen(false)}
        onSubmit={handleCreateAnalysis}
        title={`New Analysis — ${selected?.lab_number || ''}`}
        icon={FlaskConical}
        submitLabel="Create Analysis"
        isSubmitting={analysisSubmitting}
        maxWidth="max-w-lg"
        isDirty={analysisDirty}
      >
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Analysis Type *</label>
            <select className="select-dark w-full text-xs" value={analysisForm.analysis_type}
              onChange={e => setAnalysisForm(f => ({ ...f, analysis_type: e.target.value as AnalysisType }))}>
              {ANALYSIS_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {exhibits.length > 0 && (
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Linked Exhibit</label>
              <select className="select-dark w-full text-xs" value={analysisForm.exhibit_id}
                onChange={e => setAnalysisForm(f => ({ ...f, exhibit_id: e.target.value }))}>
                <option value="">— None —</option>
                {exhibits.map(ex => (
                  <option key={ex.id} value={ex.id}>{ex.exhibit_number} — {ex.description.slice(0, 50)}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Methodology</label>
            <input className="input-dark w-full text-xs" value={analysisForm.methodology}
              onChange={e => setAnalysisForm(f => ({ ...f, methodology: e.target.value }))}
              placeholder="Analysis methodology / protocol" />
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Equipment Used</label>
            <input className="input-dark w-full text-xs" value={analysisForm.equipment_used}
              onChange={e => setAnalysisForm(f => ({ ...f, equipment_used: e.target.value }))}
              placeholder="Instruments, tools, software" />
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold block mb-1">Notes</label>
            <textarea className="textarea-dark w-full text-xs" rows={3} value={analysisForm.notes}
              onChange={e => setAnalysisForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Initial observations, instructions..." />
          </div>
        </div>
      </FormModal>
    </div>
  );
}
