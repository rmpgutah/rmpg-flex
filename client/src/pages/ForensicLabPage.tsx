// ============================================================
// RMPG Flex — Forensic Lab Management Page
// Guided workflow for evidence intake, case management,
// exhibit tracking, analysis, and hash management.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Microscope, Plus, Search, Filter, ChevronRight, ChevronDown,
  FileText, Clock, AlertTriangle, CheckCircle, XCircle,
  Loader2, Eye, ArrowRight, Beaker, Hash, Link2, Activity,
  Fingerprint, Cpu, FlaskConical, Camera, Shield, Network,
  HelpCircle, ChevronLeft, Package, Upload, Trash2, RefreshCw,
  Info, Edit3, Send, Unlink,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import FormModal from '../components/FormModal';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';

// ─── Constants ───────────────────────────────────────────

const CASE_TYPES = [
  { value: 'digital', label: 'Digital Forensics', desc: 'Analysis of computers, phones, drives, and digital media', icon: Cpu },
  { value: 'biological', label: 'Biological Evidence', desc: 'Blood, tissue, bodily fluids for DNA/serology', icon: FlaskConical },
  { value: 'latent_prints', label: 'Fingerprint Analysis', desc: 'Latent print development and comparison', icon: Fingerprint },
  { value: 'drug_analysis', label: 'Drug Analysis', desc: 'Controlled substance identification and weight', icon: Beaker },
  { value: 'ballistics', label: 'Ballistics / Firearms', desc: 'Firearm identification, bullet comparison, GSR', icon: Shield },
  { value: 'trace', label: 'Trace Evidence', desc: 'Fibers, glass, paint, soil, hair analysis', icon: Search },
  { value: 'questioned_documents', label: 'Document Examination', desc: 'Handwriting, ink, paper, forgery detection', icon: FileText },
  { value: 'toxicology', label: 'Toxicology', desc: 'Alcohol, drug levels in blood/urine samples', icon: FlaskConical },
  { value: 'dna', label: 'DNA Analysis', desc: 'DNA profiling and comparison from biological samples', icon: Activity },
  { value: 'other', label: 'Other', desc: 'Other forensic examination not listed above', icon: Microscope },
] as const;

const PRIORITIES = [
  { value: 'routine', label: 'Routine', desc: 'Standard processing — 30 day turnaround', color: '#5a6e80' },
  { value: 'expedited', label: 'Expedited', desc: 'Priority processing — 14 day turnaround', color: '#3b82f6' },
  { value: 'urgent', label: 'Urgent', desc: 'Urgent case need — 7 day turnaround', color: '#f59e0b' },
  { value: 'rush', label: 'Rush', desc: 'Immediate attention — 48 hour turnaround', color: '#ef4444' },
] as const;

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; nextAction: string }> = {
  submitted: { label: 'Submitted', color: '#60a5fa', bgColor: 'bg-blue-900/20', nextAction: 'Case will be reviewed and assigned to an examiner' },
  intake: { label: 'Intake', color: '#a78bfa', bgColor: 'bg-purple-900/20', nextAction: 'Evidence is being cataloged and checked in' },
  assigned: { label: 'Assigned', color: '#38bdf8', bgColor: 'bg-sky-900/20', nextAction: 'Examiner is preparing to begin analysis' },
  in_progress: { label: 'In Progress', color: '#fbbf24', bgColor: 'bg-amber-900/20', nextAction: 'Analysis is underway — check back for updates' },
  analysis_complete: { label: 'Analysis Complete', color: '#34d399', bgColor: 'bg-emerald-900/20', nextAction: 'Results are available — report being drafted' },
  report_draft: { label: 'Report Draft', color: '#a3e635', bgColor: 'bg-lime-900/20', nextAction: 'Report is being reviewed before finalization' },
  report_final: { label: 'Report Final', color: '#22c55e', bgColor: 'bg-green-900/20', nextAction: 'Final report is available' },
  closed: { label: 'Closed', color: '#6b7280', bgColor: 'bg-gray-900/20', nextAction: 'Case is complete and archived' },
  cancelled: { label: 'Cancelled', color: '#ef4444', bgColor: 'bg-red-900/20', nextAction: 'Case was cancelled' },
};

const ANALYSIS_TYPES = [
  { value: 'digital_extraction', label: 'Digital Device Extraction', desc: 'Extract data from phones, computers, drives' },
  { value: 'fingerprint', label: 'Fingerprint Comparison', desc: 'Compare latent prints against known samples' },
  { value: 'dna', label: 'DNA Profiling', desc: 'Extract and compare DNA profiles' },
  { value: 'drug_analysis', label: 'Drug Identification', desc: 'Identify controlled substances' },
  { value: 'ballistics', label: 'Ballistics Comparison', desc: 'Compare bullets, casings, firearms' },
  { value: 'document_analysis', label: 'Document Analysis', desc: 'Handwriting, ink, paper examination' },
  { value: 'trace_analysis', label: 'Trace Evidence Analysis', desc: 'Fiber, glass, paint comparison' },
  { value: 'toxicology', label: 'Toxicology Screening', desc: 'Blood/urine substance levels' },
  { value: 'tool_marks', label: 'Tool Mark Analysis', desc: 'Compare tool impressions' },
  { value: 'photography', label: 'Forensic Photography', desc: 'Evidence documentation imaging' },
  { value: 'serology', label: 'Serology', desc: 'Blood type and body fluid identification' },
  { value: 'microscopy', label: 'Microscopy', desc: 'Microscopic examination of evidence' },
  { value: 'other', label: 'Other', desc: 'Other specialized examination' },
];

const TABS = ['My Cases', 'All Cases', 'New Case'] as const;
type Tab = typeof TABS[number];

// ─── Types ───────────────────────────────────────────────

interface ForensicCase {
  id: number;
  lab_case_number: string;
  title: string;
  case_type: string;
  status: string;
  priority: string;
  incident_id: number | null;
  requesting_officer_id: number | null;
  requesting_officer_name: string | null;
  assigned_examiner_id: number | null;
  assigned_examiner_name: string | null;
  synopsis: string | null;
  findings: string | null;
  conclusion: string | null;
  methodology: string | null;
  due_date: string | null;
  received_date: string | null;
  started_date: string | null;
  completed_date: string | null;
  notes: string | null;
  exhibit_count?: number;
  analysis_count?: number;
  exhibits?: ForensicExhibit[];
  analyses?: ForensicAnalysis[];
  timeline?: TimelineEntry[];
  created_at: string;
  updated_at: string;
}

interface ForensicExhibit {
  id: number;
  forensic_case_id: number;
  exhibit_number: string;
  description: string;
  item_type: string;
  condition_received: string;
  examination_requested: string;
  examination_performed: string | null;
  results: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface ForensicAnalysis {
  id: number;
  forensic_case_id: number;
  exhibit_id: number | null;
  analysis_type: string;
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
}

interface TimelineEntry {
  id: number;
  action: string;
  description: string;
  performed_by_name: string | null;
  created_at: string;
}

interface Stats {
  total: number;
  overdue: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
}

// ─── Wizard Form ─────────────────────────────────────────

interface WizardData {
  title: string;
  case_type: string;
  priority: string;
  synopsis: string;
  incident_id: string;
  notes: string;
  exhibits: { description: string; item_type: string; condition_received: string; examination_requested: string }[];
}

const EMPTY_WIZARD: WizardData = {
  title: '',
  case_type: 'digital',
  priority: 'routine',
  synopsis: '',
  incident_id: '',
  notes: '',
  exhibits: [],
};

// ─── Component ───────────────────────────────────────────

export default function ForensicLabPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<Tab>('My Cases');
  const [cases, setCases] = useState<ForensicCase[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [selectedCase, setSelectedCase] = useState<ForensicCase | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'exhibits' | 'analyses' | 'timeline' | 'hashes' | 'links'>('overview');
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>(EMPTY_WIZARD);
  const [submitting, setSubmitting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Analysis modal
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisForm, setAnalysisForm] = useState({ analysis_type: 'digital_extraction', methodology: '', notes: '' });
  // Exhibit modal
  const [showExhibitModal, setShowExhibitModal] = useState(false);
  const [exhibitForm, setExhibitForm] = useState({ description: '', item_type: '', condition_received: '', examination_requested: '' });
  // Edit case modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ synopsis: '', findings: '', conclusion: '', notes: '', due_date: '' });
  // Timeline note
  const [timelineNote, setTimelineNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  // Link search
  const [linkSearchTerm, setLinkSearchTerm] = useState('');
  const [linkSearchResults, setLinkSearchResults] = useState<any[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [caseLinks, setCaseLinks] = useState<any[]>([]);
  // Hashes
  const [hashes, setHashes] = useState<any[]>([]);
  const [hashStats, setHashStats] = useState<{ total: number; flagged: number; matched: number } | null>(null);

  // ── Fetch ──────────────────────────────────────────────

  const fetchCases = useCallback(async (tab?: Tab) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('case_type', filterType);
      params.set('limit', '100');

      const [casesRes, statsRes] = await Promise.all([
        apiFetch<{ data: ForensicCase[] }>(`/forensic-lab?${params}`),
        apiFetch<Stats>('/forensic-lab/stats'),
      ]);
      setCases(casesRes.data || []);
      setStats(statsRes);
    } catch (err) {
      console.error('Fetch forensic cases error:', err);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, filterStatus, filterType]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  const fetchCaseDetail = useCallback(async (id: number) => {
    try {
      const detail = await apiFetch<ForensicCase>(`/forensic-lab/${id}`);
      setSelectedCase(detail);
      fetchCaseLinks(id);
      fetchHashes(id);
    } catch (err) {
      console.error('Fetch case detail error:', err);
    }
  }, [fetchCaseLinks, fetchHashes]);

  // ── Wizard Submit ──────────────────────────────────────

  const handleWizardSubmit = async () => {
    if (!wizardData.title.trim()) return;
    setSubmitting(true);
    try {
      const caseRes = await apiFetch<ForensicCase>('/forensic-lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: wizardData.title,
          case_type: wizardData.case_type,
          priority: wizardData.priority,
          synopsis: wizardData.synopsis,
          incident_id: wizardData.incident_id ? Number(wizardData.incident_id) : null,
          notes: wizardData.notes,
        }),
      });

      // Add exhibits
      for (const exhibit of wizardData.exhibits) {
        if (exhibit.description.trim()) {
          await apiFetch(`/forensic-lab/${caseRes.id}/exhibits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exhibit),
          });
        }
      }

      setWizardData(EMPTY_WIZARD);
      setWizardStep(0);
      setActiveTab('My Cases');
      fetchCases();
      fetchCaseDetail(caseRes.id);
    } catch (err) {
      console.error('Create case error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Add Analysis ───────────────────────────────────────

  const handleAddAnalysis = async () => {
    if (!selectedCase || !analysisForm.analysis_type) return;
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}/analyses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analysisForm),
      });
      setShowAnalysisModal(false);
      setAnalysisForm({ analysis_type: 'digital_extraction', methodology: '', notes: '' });
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      console.error('Add analysis error:', err);
    }
  };

  // ── Add Exhibit ────────────────────────────────────────

  const handleAddExhibit = async () => {
    if (!selectedCase || !exhibitForm.description.trim()) return;
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}/exhibits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exhibitForm),
      });
      setShowExhibitModal(false);
      setExhibitForm({ description: '', item_type: '', condition_received: '', examination_requested: '' });
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      console.error('Add exhibit error:', err);
    }
  };

  // ── Update Case Status ──────────────────────────────────

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedCase) return;
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchCaseDetail(selectedCase.id);
      fetchCases();
    } catch (err) {
      console.error('Update status error:', err);
    }
  };

  // ── Edit Case Fields ───────────────────────────────────

  const openEditModal = () => {
    if (!selectedCase) return;
    setEditForm({
      synopsis: selectedCase.synopsis || '',
      findings: selectedCase.findings || '',
      conclusion: selectedCase.conclusion || '',
      notes: selectedCase.notes || '',
      due_date: selectedCase.due_date?.slice(0, 10) || '',
    });
    setShowEditModal(true);
  };

  const handleEditSubmit = async () => {
    if (!selectedCase) return;
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      setShowEditModal(false);
      fetchCaseDetail(selectedCase.id);
      fetchCases();
    } catch (err) {
      console.error('Edit case error:', err);
    }
  };

  // ── Update Analysis Status ─────────────────────────────

  const handleAnalysisStatusChange = async (analysisId: number, newStatus: string, extras?: { results?: string; conclusion?: string }) => {
    if (!selectedCase) return;
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}/analyses/${analysisId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...extras }),
      });
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      console.error('Update analysis error:', err);
    }
  };

  // ── Update Exhibit Status ──────────────────────────────

  const handleExhibitStatusChange = async (exhibitId: number, newStatus: string, extras?: { results?: string }) => {
    if (!selectedCase) return;
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}/exhibits/${exhibitId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...extras }),
      });
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      console.error('Update exhibit error:', err);
    }
  };

  // ── Timeline Note ──────────────────────────────────────

  const handleAddTimelineNote = async () => {
    if (!selectedCase || !timelineNote.trim()) return;
    setAddingNote(true);
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'note', description: timelineNote }),
      });
      setTimelineNote('');
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      console.error('Add note error:', err);
    } finally {
      setAddingNote(false);
    }
  };

  // ── Entity Link Search & Link ──────────────────────────

  const handleLinkSearch = async () => {
    if (!selectedCase || !linkSearchTerm.trim()) return;
    setLinkSearching(true);
    try {
      const results = await apiFetch<any[]>(`/forensic-lab/${selectedCase.id}/links/search?q=${encodeURIComponent(linkSearchTerm)}`);
      setLinkSearchResults(results || []);
    } catch (err) {
      console.error('Link search error:', err);
      setLinkSearchResults([]);
    } finally {
      setLinkSearching(false);
    }
  };

  const handleLinkEntity = async (entityType: string, entityId: number, relationship: string = 'related') => {
    if (!selectedCase) return;
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, relationship }),
      });
      setLinkSearchResults([]);
      setLinkSearchTerm('');
      fetchCaseLinks(selectedCase.id);
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      console.error('Link entity error:', err);
    }
  };

  const handleUnlinkEntity = async (linkId: number) => {
    if (!selectedCase) return;
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}/links/${linkId}`, { method: 'DELETE' });
      fetchCaseLinks(selectedCase.id);
    } catch (err) {
      console.error('Unlink error:', err);
    }
  };

  const fetchCaseLinks = useCallback(async (id: number) => {
    try {
      const links = await apiFetch<any[]>(`/forensic-lab/${id}/links`);
      setCaseLinks(links || []);
    } catch { setCaseLinks([]); }
  }, []);

  // ── Hashes ─────────────────────────────────────────────

  const fetchHashes = useCallback(async (id: number) => {
    try {
      const data = await apiFetch<{ hashes: any[]; stats: { total: number; flagged: number; matched: number } }>(`/forensic-lab/${id}/hashes`);
      setHashes(data.hashes || []);
      setHashStats(data.stats || null);
    } catch { setHashes([]); setHashStats(null); }
  }, []);

  // ── Helpers ────────────────────────────────────────────

  const getStatusConfig = (status: string) => STATUS_CONFIG[status] || { label: status, color: '#5a6e80', bgColor: 'bg-gray-900/20', nextAction: '' };
  const getCaseTypeLabel = (t: string) => CASE_TYPES.find(c => c.value === t)?.label || t;
  const getPriorityConfig = (p: string) => PRIORITIES.find(pr => pr.value === p) || PRIORITIES[0];

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isOverdue = (c: ForensicCase) => {
    if (!c.due_date || ['closed', 'cancelled', 'report_final'].includes(c.status)) return false;
    return new Date(c.due_date) < new Date();
  };

  // ══════════════════════════════════════════════════════════
  // Case Detail View
  // ══════════════════════════════════════════════════════════

  if (selectedCase) {
    const sc = getStatusConfig(selectedCase.status);
    const pc = getPriorityConfig(selectedCase.priority);
    const overdue = isOverdue(selectedCase);

    const STATUS_PIPELINE = ['submitted', 'intake', 'assigned', 'in_progress', 'analysis_complete', 'report_draft', 'report_final', 'closed'];
    const currentIdx = STATUS_PIPELINE.indexOf(selectedCase.status);

    return (
      <div className="flex flex-col h-full bg-surface-base">
        {/* Detail Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e3048] bg-[#0d1520]">
          <button onClick={() => { setSelectedCase(null); setDetailTab('overview'); }} className="text-rmpg-400 hover:text-white transition-colors">
            <ChevronLeft size={16} />
          </button>
          <Microscope size={16} className="text-brand-400" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-brand-400">{selectedCase.lab_case_number}</span>
              <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: sc.color + '20', color: sc.color }}>{sc.label}</span>
              <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: pc.color + '20', color: pc.color }}>{pc.label}</span>
              {overdue && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 font-bold">OVERDUE</span>}
            </div>
            <div className="text-sm font-semibold text-white truncate">{selectedCase.title}</div>
          </div>
          <button
            onClick={() => fetchCaseDetail(selectedCase.id)}
            className="toolbar-btn"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>

        {/* Progress Pipeline */}
        <div className="px-3 py-2 border-b border-[#1e3048] bg-[#0d1520]/50 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {STATUS_PIPELINE.map((s, i) => {
              const cfg = getStatusConfig(s);
              const isActive = i === currentIdx;
              const isPast = i < currentIdx;
              return (
                <React.Fragment key={s}>
                  {i > 0 && <ArrowRight size={10} className={isPast ? 'text-green-500' : 'text-rmpg-600'} />}
                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide ${
                    isActive ? 'bg-brand-500/20 text-brand-400 ring-1 ring-brand-500/40' :
                    isPast ? 'text-green-500' : 'text-rmpg-600'
                  }`}>
                    {isPast && <CheckCircle size={10} />}
                    {cfg.label}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          {sc.nextAction && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <Info size={10} className="text-rmpg-500 flex-shrink-0" />
              <span className="text-[10px] text-rmpg-400 italic">{sc.nextAction}</span>
            </div>
          )}
        </div>

        {/* Detail Tabs */}
        <div className="flex items-center border-b border-[#1e3048] bg-[#0d1520]">
          {(['overview', 'exhibits', 'analyses', 'timeline', 'links', 'hashes'] as const).map(tab => {
            const icons = { overview: Eye, exhibits: Package, analyses: Beaker, timeline: Activity, links: Link2, hashes: Hash };
            const labels = { overview: 'Overview', exhibits: `Exhibits (${selectedCase.exhibits?.length || 0})`, analyses: `Analyses (${selectedCase.analyses?.length || 0})`, timeline: 'Timeline', links: `Links (${caseLinks.length})`, hashes: 'Hashes' };
            const Icon = icons[tab];
            return (
              <button
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium transition-colors border-b-2 ${
                  detailTab === tab
                    ? 'text-white border-brand-500'
                    : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-600'
                }`}
              >
                <Icon size={12} />
                {!isMobile ? labels[tab] : (tab === 'overview' ? 'Info' : tab.charAt(0).toUpperCase() + tab.slice(1, 4))}
              </button>
            );
          })}
        </div>

        {/* Detail Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Overview Tab */}
          {detailTab === 'overview' && (
            <>
              {/* Quick Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedCase.status}
                  onChange={e => handleStatusChange(e.target.value)}
                  className="px-2 py-1 text-[10px] bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none font-bold"
                  style={{ color: sc.color }}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <button onClick={openEditModal} className="toolbar-btn text-[10px]">
                  <Edit3 size={10} /> Edit Details
                </button>
                <button onClick={() => navigate(`/forensics?type=case&id=${selectedCase.id}`)} className="toolbar-btn text-[10px]">
                  <Network size={10} /> View Connections
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="panel-beveled bg-surface-sunken p-3 space-y-2">
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Case Details</div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-rmpg-400">Type</span><span className="text-rmpg-200">{getCaseTypeLabel(selectedCase.case_type)}</span></div>
                    <div className="flex justify-between"><span className="text-rmpg-400">Requesting Officer</span><span className="text-rmpg-200">{selectedCase.requesting_officer_name || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-rmpg-400">Examiner</span><span className="text-rmpg-200">{selectedCase.assigned_examiner_name || 'Unassigned'}</span></div>
                    <div className="flex justify-between"><span className="text-rmpg-400">Received</span><span className="text-rmpg-200 font-mono">{formatDate(selectedCase.received_date)}</span></div>
                    <div className="flex justify-between"><span className="text-rmpg-400">Due Date</span><span className={`font-mono ${overdue ? 'text-red-400 font-bold' : 'text-rmpg-200'}`}>{formatDate(selectedCase.due_date)}</span></div>
                    {selectedCase.incident_id && (
                      <div className="flex justify-between">
                        <span className="text-rmpg-400">Linked Incident</span>
                        <button onClick={() => navigate(`/incidents?id=${selectedCase.incident_id}`)} className="text-brand-400 hover:underline">#{selectedCase.incident_id}</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-3 space-y-2">
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Statistics</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-center">
                      <div className="text-xl font-bold font-mono text-brand-400">{selectedCase.exhibits?.length || 0}</div>
                      <div className="text-[9px] text-rmpg-500 uppercase">Exhibits</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold font-mono text-amber-400">{selectedCase.analyses?.length || 0}</div>
                      <div className="text-[9px] text-rmpg-500 uppercase">Analyses</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold font-mono text-purple-400">{caseLinks.length}</div>
                      <div className="text-[9px] text-rmpg-500 uppercase">Links</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold font-mono text-cyan-400">{hashes.length}</div>
                      <div className="text-[9px] text-rmpg-500 uppercase">Hashes</div>
                    </div>
                  </div>
                </div>
              </div>
              {selectedCase.synopsis && (
                <div className="panel-beveled bg-surface-sunken p-3">
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Synopsis</div>
                  <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedCase.synopsis}</p>
                </div>
              )}
              {selectedCase.findings && (
                <div className="panel-beveled bg-surface-sunken p-3">
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Findings</div>
                  <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedCase.findings}</p>
                </div>
              )}
              {selectedCase.conclusion && (
                <div className="panel-beveled bg-surface-sunken p-3 border-l-[3px] border-l-green-500">
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Conclusion</div>
                  <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedCase.conclusion}</p>
                </div>
              )}
            </>
          )}

          {/* Exhibits Tab */}
          {detailTab === 'exhibits' && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Evidence Items</div>
                <button onClick={() => setShowExhibitModal(true)} className="toolbar-btn toolbar-btn-primary text-[10px]">
                  <Plus size={10} /> Add Exhibit
                </button>
              </div>
              {(!selectedCase.exhibits || selectedCase.exhibits.length === 0) ? (
                <div className="panel-beveled bg-surface-sunken p-6 text-center">
                  <Package size={24} className="text-rmpg-600 mx-auto mb-2" />
                  <p className="text-xs text-rmpg-400">No exhibits yet. Add evidence items to this case.</p>
                  <p className="text-[10px] text-rmpg-500 mt-1 italic">Tip: Each exhibit gets an auto-assigned letter (A, B, C...) for chain of custody tracking</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedCase.exhibits.map(ex => {
                    const exStatus = ex.status === 'complete' ? { color: '#22c55e', icon: CheckCircle } :
                      ex.status === 'examining' ? { color: '#f59e0b', icon: Activity } :
                      { color: '#60a5fa', icon: Package };
                    return (
                      <div key={ex.id} className="panel-beveled bg-surface-sunken p-3 border-l-[3px]" style={{ borderLeftColor: exStatus.color }}>
                        <div className="flex items-start gap-2">
                          <div className="w-8 h-8 rounded flex items-center justify-center text-sm font-bold font-mono" style={{ backgroundColor: exStatus.color + '20', color: exStatus.color }}>
                            {ex.exhibit_number}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-rmpg-200">{ex.description}</div>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                              {ex.item_type && <span>Type: {ex.item_type}</span>}
                              {ex.condition_received && <span>Condition: {ex.condition_received}</span>}
                              <span className="font-bold uppercase" style={{ color: exStatus.color }}>{ex.status}</span>
                            </div>
                            {ex.examination_requested && (
                              <div className="text-[10px] text-rmpg-400 mt-1">
                                <span className="text-rmpg-500">Exam requested:</span> {ex.examination_requested}
                              </div>
                            )}
                            {ex.results && (
                              <div className="mt-2 p-2 bg-surface-base rounded text-[10px] text-rmpg-200 border border-[#1e3048]">
                                <span className="text-green-400 font-bold uppercase text-[9px]">Results: </span>{ex.results}
                              </div>
                            )}
                            {/* Status actions */}
                            <div className="flex items-center gap-1.5 mt-2">
                              {ex.status === 'received' && (
                                <button onClick={() => handleExhibitStatusChange(ex.id, 'examining')} className="text-[9px] px-2 py-0.5 bg-amber-900/20 text-amber-400 border border-amber-700/40 rounded hover:bg-amber-900/40 transition-colors">
                                  Begin Examination
                                </button>
                              )}
                              {ex.status === 'examining' && (
                                <button onClick={() => {
                                  const result = prompt('Enter examination results:');
                                  if (result) handleExhibitStatusChange(ex.id, 'complete', { results: result });
                                }} className="text-[9px] px-2 py-0.5 bg-green-900/20 text-green-400 border border-green-700/40 rounded hover:bg-green-900/40 transition-colors">
                                  Mark Complete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Analyses Tab */}
          {detailTab === 'analyses' && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Examination Records</div>
                <button onClick={() => setShowAnalysisModal(true)} className="toolbar-btn toolbar-btn-primary text-[10px]">
                  <Plus size={10} /> New Analysis
                </button>
              </div>
              {(!selectedCase.analyses || selectedCase.analyses.length === 0) ? (
                <div className="panel-beveled bg-surface-sunken p-6 text-center">
                  <Beaker size={24} className="text-rmpg-600 mx-auto mb-2" />
                  <p className="text-xs text-rmpg-400">No analyses recorded yet.</p>
                  <p className="text-[10px] text-rmpg-500 mt-1 italic">Tip: Create an analysis record for each examination procedure performed</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedCase.analyses.map(an => {
                    const anStatus = an.status === 'complete' ? '#22c55e' : an.status === 'in_progress' ? '#f59e0b' : '#60a5fa';
                    const typeLabel = ANALYSIS_TYPES.find(t => t.value === an.analysis_type)?.label || an.analysis_type;
                    return (
                      <div key={an.id} className="panel-beveled bg-surface-sunken p-3 border-l-[3px]" style={{ borderLeftColor: anStatus }}>
                        <div className="flex items-center gap-2 mb-1">
                          <Beaker size={12} style={{ color: anStatus }} />
                          <span className="text-xs font-semibold text-rmpg-200">{typeLabel}</span>
                          <span className="text-[9px] font-bold uppercase ml-auto" style={{ color: anStatus }}>{an.status}</span>
                        </div>
                        {an.examiner_name && <div className="text-[10px] text-rmpg-400">Examiner: {an.examiner_name}</div>}
                        {an.methodology && <div className="text-[10px] text-rmpg-400 mt-1">Method: {an.methodology}</div>}
                        {an.results && (
                          <div className="mt-2 p-2 bg-surface-base rounded text-[10px] text-rmpg-200 border border-[#1e3048]">
                            <span className="text-green-400 font-bold uppercase text-[9px]">Results: </span>{an.results}
                          </div>
                        )}
                        {an.conclusion && (
                          <div className="mt-1 text-[10px] text-amber-300 font-semibold">Conclusion: {an.conclusion}</div>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[9px] text-rmpg-500">
                          {an.started_at && <span>Started: {formatDate(an.started_at)}</span>}
                          {an.completed_at && <span>Completed: {formatDate(an.completed_at)}</span>}
                        </div>
                        {/* Status actions */}
                        <div className="flex items-center gap-1.5 mt-2">
                          {an.status === 'pending' && (
                            <button onClick={() => handleAnalysisStatusChange(an.id, 'in_progress')} className="text-[9px] px-2 py-0.5 bg-amber-900/20 text-amber-400 border border-amber-700/40 rounded hover:bg-amber-900/40 transition-colors">
                              Start Analysis
                            </button>
                          )}
                          {an.status === 'in_progress' && (
                            <button onClick={() => {
                              const results = prompt('Enter analysis results:');
                              const conclusion = prompt('Enter conclusion:');
                              if (results) handleAnalysisStatusChange(an.id, 'complete', { results, conclusion: conclusion || undefined });
                            }} className="text-[9px] px-2 py-0.5 bg-green-900/20 text-green-400 border border-green-700/40 rounded hover:bg-green-900/40 transition-colors">
                              Complete Analysis
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Timeline Tab */}
          {detailTab === 'timeline' && (
            <>
              {/* Add Note */}
              <div className="panel-beveled bg-surface-sunken p-3">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">Add Note</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={timelineNote}
                    onChange={e => setTimelineNote(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTimelineNote()}
                    className="flex-1 px-3 py-1.5 text-xs bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                    placeholder="Add a note, observation, or update..."
                  />
                  <button
                    onClick={handleAddTimelineNote}
                    disabled={!timelineNote.trim() || addingNote}
                    className="toolbar-btn toolbar-btn-primary text-[10px] px-3 disabled:opacity-40"
                  >
                    {addingNote ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />} Add
                  </button>
                </div>
              </div>

              <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Activity Log</div>
              {(!selectedCase.timeline || selectedCase.timeline.length === 0) ? (
                <div className="panel-beveled bg-surface-sunken p-6 text-center">
                  <Activity size={24} className="text-rmpg-600 mx-auto mb-2" />
                  <p className="text-xs text-rmpg-400">No activity recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {selectedCase.timeline.map((t, i) => (
                    <div key={t.id} className="flex gap-3 py-2 border-b border-rmpg-700/30 last:border-0">
                      <div className="flex flex-col items-center">
                        <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-brand-500' : 'bg-rmpg-600'}`} />
                        {i < (selectedCase.timeline?.length || 0) - 1 && <div className="w-px flex-1 bg-rmpg-700/50" />}
                      </div>
                      <div className="flex-1 min-w-0 pb-1">
                        <div className="text-xs text-rmpg-200">{t.description}</div>
                        <div className="flex items-center gap-2 mt-0.5 text-[9px] text-rmpg-500">
                          <span>{t.performed_by_name || 'System'}</span>
                          <span className="font-mono">{formatDate(t.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Hashes Tab */}
          {detailTab === 'hashes' && (
            <>
              {hashStats && (
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="panel-beveled bg-surface-sunken p-2 text-center">
                    <div className="text-lg font-bold font-mono text-brand-400">{hashStats.total}</div>
                    <div className="text-[8px] text-rmpg-500 uppercase">Total Hashes</div>
                  </div>
                  <div className="panel-beveled bg-surface-sunken p-2 text-center">
                    <div className={`text-lg font-bold font-mono ${hashStats.flagged > 0 ? 'text-red-400' : 'text-green-400'}`}>{hashStats.flagged}</div>
                    <div className="text-[8px] text-rmpg-500 uppercase">Flagged</div>
                  </div>
                  <div className="panel-beveled bg-surface-sunken p-2 text-center">
                    <div className={`text-lg font-bold font-mono ${hashStats.matched > 0 ? 'text-amber-400' : 'text-green-400'}`}>{hashStats.matched}</div>
                    <div className="text-[8px] text-rmpg-500 uppercase">DB Matches</div>
                  </div>
                </div>
              )}
              {hashes.length === 0 ? (
                <div className="panel-beveled bg-surface-sunken p-6 text-center">
                  <Hash size={24} className="text-rmpg-600 mx-auto mb-2" />
                  <p className="text-xs text-rmpg-400">No hashes computed yet</p>
                  <p className="text-[10px] text-rmpg-500 mt-1 italic">
                    Compute MD5, SHA-1, SHA-256, and PhotoDNA hashes for digital evidence files.
                    Hashes verify evidence integrity and flag known contraband.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-rmpg-600">
                        <th className="px-2 py-1.5 text-left text-rmpg-400 font-bold uppercase">File</th>
                        <th className="px-2 py-1.5 text-left text-rmpg-400 font-bold uppercase">SHA-256</th>
                        <th className="px-2 py-1.5 text-left text-rmpg-400 font-bold uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hashes.map((h: any) => (
                        <tr key={h.id} className="border-b border-rmpg-700/30 hover:bg-rmpg-800/30">
                          <td className="px-2 py-1.5 text-rmpg-200 font-mono truncate max-w-[200px]">{h.file_name || '—'}</td>
                          <td className="px-2 py-1.5 text-rmpg-300 font-mono truncate max-w-[200px]">{h.sha256?.slice(0, 16)}...</td>
                          <td className="px-2 py-1.5">
                            {h.flagged ? (
                              <span className="text-red-400 font-bold flex items-center gap-1"><AlertTriangle size={10} /> FLAGGED</span>
                            ) : h.hash_set_match ? (
                              <span className="text-amber-400 font-bold">MATCH</span>
                            ) : (
                              <span className="text-green-400">Clean</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Links Tab */}
          {detailTab === 'links' && (
            <>
              {/* Link Search */}
              <div className="panel-beveled bg-surface-sunken p-3">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">Link Entity to Case</div>
                <div className="p-2 bg-blue-900/10 border border-blue-800/30 rounded text-[10px] text-blue-300 mb-2">
                  <Info size={10} className="inline mr-1" />
                  Search for persons, incidents, evidence, or cases to link to this forensic case.
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={linkSearchTerm}
                    onChange={e => setLinkSearchTerm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLinkSearch()}
                    className="flex-1 px-3 py-1.5 text-xs bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                    placeholder="Search by name, case number, evidence ID..."
                  />
                  <button onClick={handleLinkSearch} disabled={linkSearching || !linkSearchTerm.trim()} className="toolbar-btn toolbar-btn-primary text-[10px] px-3 disabled:opacity-40">
                    {linkSearching ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />} Search
                  </button>
                </div>
                {linkSearchResults.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-[200px] overflow-y-auto">
                    {linkSearchResults.map((r: any, i: number) => (
                      <div key={`${r.type}-${r.id}-${i}`} className="flex items-center gap-2 p-2 bg-surface-base rounded border border-[#1e3048] hover:border-brand-500/50 transition-colors">
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-brand-900/20 text-brand-400">{r.type}</span>
                        <span className="text-xs text-rmpg-200 flex-1 truncate">{r.label || r.name || r.title || `#${r.id}`}</span>
                        <button onClick={() => handleLinkEntity(r.type, r.id)} className="text-[9px] px-2 py-0.5 bg-green-900/20 text-green-400 border border-green-700/40 rounded hover:bg-green-900/40 transition-colors">
                          <Link2 size={10} className="inline mr-1" />Link
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Current Links */}
              <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mt-3">Linked Entities</div>
              {caseLinks.length === 0 ? (
                <div className="panel-beveled bg-surface-sunken p-6 text-center">
                  <Link2 size={24} className="text-rmpg-600 mx-auto mb-2" />
                  <p className="text-xs text-rmpg-400">No entities linked to this case yet</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {caseLinks.map((link: any) => (
                    <div key={link.id} className="flex items-center gap-2 p-2 panel-beveled bg-surface-sunken">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-900/20 text-purple-400">{link.entity_type}</span>
                      <span className="text-xs text-rmpg-200 flex-1">{link.entity_label || `${link.entity_type} #${link.entity_id}`}</span>
                      <span className="text-[9px] text-rmpg-500">{link.relationship}</span>
                      <button onClick={() => handleUnlinkEntity(link.id)} className="text-rmpg-500 hover:text-red-400 transition-colors" title="Remove link">
                        <Unlink size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Analysis Modal */}
        {showAnalysisModal && (
          <FormModal
            isOpen={showAnalysisModal}
            onClose={() => setShowAnalysisModal(false)}
            onSubmit={handleAddAnalysis}
            title="New Analysis Record"
            icon={Beaker}
            submitLabel="Create"
            maxWidth="max-w-md"
            isDirty={!!analysisForm.analysis_type}
          >
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Analysis Type</label>
                <select
                  value={analysisForm.analysis_type}
                  onChange={e => setAnalysisForm(f => ({ ...f, analysis_type: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                >
                  {ANALYSIS_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Methodology</label>
                <textarea
                  value={analysisForm.methodology}
                  onChange={e => setAnalysisForm(f => ({ ...f, methodology: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none h-20"
                  placeholder="Describe the examination method..."
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Notes</label>
                <textarea
                  value={analysisForm.notes}
                  onChange={e => setAnalysisForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none h-16"
                  placeholder="Additional notes..."
                />
              </div>
            </div>
          </FormModal>
        )}

        {/* Exhibit Modal */}
        {showExhibitModal && (
          <FormModal
            isOpen={showExhibitModal}
            onClose={() => setShowExhibitModal(false)}
            onSubmit={handleAddExhibit}
            title="Add Evidence Exhibit"
            icon={Package}
            submitLabel="Add"
            maxWidth="max-w-md"
            isDirty={exhibitForm.description.trim().length > 0}
          >
            <div className="space-y-3">
              <div className="p-2 bg-blue-900/10 border border-blue-800/30 rounded text-[10px] text-blue-300">
                <Info size={10} className="inline mr-1" />
                Each exhibit is auto-assigned a letter (A, B, C...) for chain of custody tracking.
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Description <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={exhibitForm.description}
                  onChange={e => setExhibitForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                  placeholder="e.g. Samsung Galaxy S24 — black, screen cracked"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-rmpg-400 mb-1">Item Type</label>
                  <input
                    type="text"
                    value={exhibitForm.item_type}
                    onChange={e => setExhibitForm(f => ({ ...f, item_type: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                    placeholder="e.g. Cell phone"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-rmpg-400 mb-1">Condition</label>
                  <input
                    type="text"
                    value={exhibitForm.condition_received}
                    onChange={e => setExhibitForm(f => ({ ...f, condition_received: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                    placeholder="e.g. Good, sealed bag"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Examination Requested</label>
                <select
                  value={exhibitForm.examination_requested}
                  onChange={e => setExhibitForm(f => ({ ...f, examination_requested: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="">Select examination type...</option>
                  {ANALYSIS_TYPES.map(t => (
                    <option key={t.value} value={t.label}>{t.label} — {t.desc}</option>
                  ))}
                </select>
              </div>
            </div>
          </FormModal>
        )}

        {/* Edit Case Modal */}
        {showEditModal && (
          <FormModal
            isOpen={showEditModal}
            onClose={() => setShowEditModal(false)}
            onSubmit={handleEditSubmit}
            title="Edit Case Details"
            icon={Edit3}
            submitLabel="Save"
            maxWidth="max-w-lg"
            isDirty={true}
          >
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Synopsis</label>
                <textarea
                  value={editForm.synopsis}
                  onChange={e => setEditForm(f => ({ ...f, synopsis: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none h-20"
                  placeholder="Case synopsis..."
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Findings</label>
                <textarea
                  value={editForm.findings}
                  onChange={e => setEditForm(f => ({ ...f, findings: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none h-20"
                  placeholder="Examination findings..."
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Conclusion</label>
                <textarea
                  value={editForm.conclusion}
                  onChange={e => setEditForm(f => ({ ...f, conclusion: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none h-20"
                  placeholder="Final conclusion..."
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Due Date</label>
                <input
                  type="date"
                  value={editForm.due_date}
                  onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none h-16"
                  placeholder="Internal notes..."
                />
              </div>
            </div>
          </FormModal>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // Main View (List + Wizard)
  // ══════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e3048] bg-[#0d1520] flex-wrap">
        <div className="flex items-center gap-1.5">
          <Microscope size={16} className="text-brand-400" />
          {!isMobile && <span className="text-sm font-semibold text-white">Forensic Lab</span>}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => navigate('/forensics')}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-400 bg-purple-900/20 hover:bg-purple-900/40 border border-purple-700/40 rounded transition-colors"
            title="Connection Analysis Graph"
          >
            <Network size={12} />
            {!isMobile && 'Connections'}
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className={`grid ${isMobile ? 'grid-cols-3 gap-1 px-2 py-1.5' : 'grid-cols-6 gap-2 px-3 py-2'} border-b border-[#1e3048] bg-[#0d1520]/50`}>
          <div className="text-center">
            <div className="text-sm font-bold font-mono text-brand-400">{stats.total}</div>
            <div className="text-[8px] text-rmpg-500 uppercase">Total</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold font-mono text-amber-400">{stats.by_status?.in_progress || 0}</div>
            <div className="text-[8px] text-rmpg-500 uppercase">Active</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold font-mono text-blue-400">{stats.by_status?.submitted || 0}</div>
            <div className="text-[8px] text-rmpg-500 uppercase">Pending</div>
          </div>
          {!isMobile && (
            <>
              <div className="text-center">
                <div className="text-sm font-bold font-mono text-green-400">{stats.by_status?.closed || 0}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Closed</div>
              </div>
              <div className="text-center">
                <div className={`text-sm font-bold font-mono ${stats.overdue > 0 ? 'text-red-400' : 'text-green-400'}`}>{stats.overdue}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Overdue</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold font-mono text-purple-400">{(stats.by_status?.analysis_complete || 0) + (stats.by_status?.report_draft || 0)}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Review</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex items-center border-b border-[#1e3048] bg-[#0d1520]">
        {TABS.map(tab => {
          const Icon = tab === 'New Case' ? Plus : tab === 'My Cases' ? FileText : Search;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === tab
                  ? 'text-white border-brand-500'
                  : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-600'
              }`}
            >
              <Icon size={14} />
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── My Cases / All Cases ─────────────────────────── */}
        {(activeTab === 'My Cases' || activeTab === 'All Cases') && (
          <div className="p-3 space-y-3">
            {/* Search + Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-rmpg-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search cases by number, title, officer..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`toolbar-btn text-[10px] ${showFilters ? 'text-brand-400' : ''}`}
              >
                <Filter size={12} /> Filters
              </button>
            </div>

            {showFilters && (
              <div className="flex items-center gap-2 flex-wrap">
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="px-2 py-1 text-[10px] bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none">
                  <option value="">All Statuses</option>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <select value={filterType} onChange={e => setFilterType(e.target.value)}
                  className="px-2 py-1 text-[10px] bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none">
                  <option value="">All Types</option>
                  {CASE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {(filterStatus || filterType) && (
                  <button onClick={() => { setFilterStatus(''); setFilterType(''); }} className="text-[10px] text-red-400 hover:underline">Clear</button>
                )}
              </div>
            )}

            {/* Case List */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-brand-400" />
              </div>
            ) : cases.length === 0 ? (
              <div className="panel-beveled bg-surface-sunken p-8 text-center">
                <Microscope size={32} className="text-rmpg-600 mx-auto mb-3" />
                <p className="text-sm text-rmpg-300">No forensic cases found</p>
                <p className="text-xs text-rmpg-500 mt-1">Create a new case using the "New Case" tab above</p>
                <button onClick={() => setActiveTab('New Case')} className="mt-3 toolbar-btn toolbar-btn-primary text-xs">
                  <Plus size={12} /> Create First Case
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {cases.map(c => {
                  const sc = getStatusConfig(c.status);
                  const pc = getPriorityConfig(c.priority);
                  const overdue = isOverdue(c);
                  return (
                    <div
                      key={c.id}
                      onClick={() => fetchCaseDetail(c.id)}
                      className="panel-beveled bg-surface-sunken p-3 cursor-pointer hover:bg-surface-raised transition-colors border-l-[3px] group"
                      style={{ borderLeftColor: sc.color }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono text-brand-400">{c.lab_case_number}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: sc.color + '20', color: sc.color }}>{sc.label}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: pc.color + '20', color: pc.color }}>{pc.label}</span>
                            {overdue && <span className="text-[8px] px-1 py-0.5 rounded bg-red-900/30 text-red-400 font-bold animate-pulse">OVERDUE</span>}
                          </div>
                          <div className="text-xs font-semibold text-rmpg-200 truncate">{c.title}</div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                            <span>{getCaseTypeLabel(c.case_type)}</span>
                            {c.requesting_officer_name && <span>By: {c.requesting_officer_name}</span>}
                            {c.assigned_examiner_name && <span>Examiner: {c.assigned_examiner_name}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-rmpg-500">
                          {(c.exhibit_count ?? 0) > 0 && (
                            <span className="text-[9px] font-mono">{c.exhibit_count} exhibits</span>
                          )}
                          <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── New Case Wizard ─────────────────────────────── */}
        {activeTab === 'New Case' && (
          <div className="p-3 space-y-4 max-w-2xl mx-auto">
            {/* Wizard Steps Indicator */}
            <div className="flex items-center justify-center gap-2">
              {['Case Info', 'Evidence', 'Review'].map((step, i) => (
                <React.Fragment key={step}>
                  {i > 0 && <div className={`w-8 h-px ${i <= wizardStep ? 'bg-brand-500' : 'bg-rmpg-600'}`} />}
                  <button
                    onClick={() => i <= wizardStep && setWizardStep(i)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${
                      i === wizardStep ? 'bg-brand-500/20 text-brand-400 ring-1 ring-brand-500/40' :
                      i < wizardStep ? 'text-green-400' : 'text-rmpg-600'
                    }`}
                  >
                    {i < wizardStep ? <CheckCircle size={12} /> : <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[8px]">{i + 1}</span>}
                    {step}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Step 1: Case Info */}
            {wizardStep === 0 && (
              <div className="panel-beveled bg-surface-sunken p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={16} className="text-brand-400" />
                  <h3 className="text-sm font-bold text-white">Case Information</h3>
                </div>
                <div className="p-2 bg-blue-900/10 border border-blue-800/30 rounded text-[10px] text-blue-300">
                  <Info size={10} className="inline mr-1" />
                  Start by describing the case. A lab case number will be auto-generated (e.g. FL-2026-0001).
                  Choose the type of forensic examination needed and the priority level.
                </div>

                <div>
                  <label className="block text-[11px] text-rmpg-400 mb-1">Case Title <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={wizardData.title}
                    onChange={e => setWizardData(d => ({ ...d, title: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                    placeholder="e.g. Phone extraction — Smith assault case"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-rmpg-400 mb-1">Case Type</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {CASE_TYPES.map(ct => {
                      const Icon = ct.icon;
                      return (
                        <button
                          key={ct.value}
                          onClick={() => setWizardData(d => ({ ...d, case_type: ct.value }))}
                          className={`flex items-start gap-2 p-2.5 rounded border text-left transition-colors ${
                            wizardData.case_type === ct.value
                              ? 'border-brand-500 bg-brand-500/10'
                              : 'border-[#1e3048] bg-[#0d1520] hover:border-rmpg-500'
                          }`}
                        >
                          <Icon size={14} className={wizardData.case_type === ct.value ? 'text-brand-400' : 'text-rmpg-500'} />
                          <div>
                            <div className={`text-[11px] font-semibold ${wizardData.case_type === ct.value ? 'text-brand-400' : 'text-rmpg-200'}`}>{ct.label}</div>
                            <div className="text-[9px] text-rmpg-500">{ct.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-rmpg-400 mb-1">Priority</label>
                  <div className="flex gap-2">
                    {PRIORITIES.map(p => (
                      <button
                        key={p.value}
                        onClick={() => setWizardData(d => ({ ...d, priority: p.value }))}
                        className={`flex-1 p-2 rounded border text-center transition-colors ${
                          wizardData.priority === p.value
                            ? 'border-current bg-current/10'
                            : 'border-[#1e3048] bg-[#0d1520] hover:border-rmpg-500'
                        }`}
                        style={wizardData.priority === p.value ? { borderColor: p.color, color: p.color } : undefined}
                      >
                        <div className="text-[11px] font-bold" style={{ color: wizardData.priority === p.value ? p.color : '#8a9aaa' }}>{p.label}</div>
                        <div className="text-[8px] text-rmpg-500">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-rmpg-400 mb-1">Synopsis</label>
                  <textarea
                    value={wizardData.synopsis}
                    onChange={e => setWizardData(d => ({ ...d, synopsis: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none h-24"
                    placeholder="Describe the circumstances and what you need examined..."
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-rmpg-400 mb-1">Linked Incident # (optional)</label>
                  <input
                    type="text"
                    value={wizardData.incident_id}
                    onChange={e => setWizardData(d => ({ ...d, incident_id: e.target.value.replace(/\D/g, '') }))}
                    className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                    placeholder="Incident ID number"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => wizardData.title.trim() && setWizardStep(1)}
                    disabled={!wizardData.title.trim()}
                    className="toolbar-btn toolbar-btn-primary text-xs px-4 py-1.5 disabled:opacity-40"
                  >
                    Next: Evidence <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Evidence Intake */}
            {wizardStep === 1 && (
              <div className="panel-beveled bg-surface-sunken p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Package size={16} className="text-brand-400" />
                  <h3 className="text-sm font-bold text-white">Evidence Intake</h3>
                </div>
                <div className="p-2 bg-blue-900/10 border border-blue-800/30 rounded text-[10px] text-blue-300">
                  <Info size={10} className="inline mr-1" />
                  Add each piece of evidence as a separate exhibit. Each will be assigned a letter (A, B, C...).
                  You can skip this step and add exhibits later.
                </div>

                {wizardData.exhibits.map((ex, i) => (
                  <div key={i} className="panel-beveled bg-surface-base p-3 space-y-2 border-l-[3px] border-l-brand-500">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-brand-400">Exhibit {String.fromCharCode(65 + i)}</span>
                      <button
                        onClick={() => setWizardData(d => ({ ...d, exhibits: d.exhibits.filter((_, j) => j !== i) }))}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={ex.description}
                      onChange={e => {
                        const exhibits = [...wizardData.exhibits];
                        exhibits[i] = { ...exhibits[i], description: e.target.value };
                        setWizardData(d => ({ ...d, exhibits }));
                      }}
                      className="w-full px-3 py-1.5 text-xs bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                      placeholder="Description (e.g. iPhone 15 Pro, black case)"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={ex.item_type}
                        onChange={e => {
                          const exhibits = [...wizardData.exhibits];
                          exhibits[i] = { ...exhibits[i], item_type: e.target.value };
                          setWizardData(d => ({ ...d, exhibits }));
                        }}
                        className="px-2 py-1 text-[10px] bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                        placeholder="Item type"
                      />
                      <input
                        type="text"
                        value={ex.condition_received}
                        onChange={e => {
                          const exhibits = [...wizardData.exhibits];
                          exhibits[i] = { ...exhibits[i], condition_received: e.target.value };
                          setWizardData(d => ({ ...d, exhibits }));
                        }}
                        className="px-2 py-1 text-[10px] bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                        placeholder="Condition"
                      />
                      <select
                        value={ex.examination_requested}
                        onChange={e => {
                          const exhibits = [...wizardData.exhibits];
                          exhibits[i] = { ...exhibits[i], examination_requested: e.target.value };
                          setWizardData(d => ({ ...d, exhibits }));
                        }}
                        className="px-2 py-1 text-[10px] bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">Exam type...</option>
                        {ANALYSIS_TYPES.map(t => (
                          <option key={t.value} value={t.label}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => setWizardData(d => ({
                    ...d,
                    exhibits: [...d.exhibits, { description: '', item_type: '', condition_received: '', examination_requested: '' }],
                  }))}
                  className="toolbar-btn text-xs w-full justify-center py-2"
                >
                  <Plus size={12} /> Add Exhibit
                </button>

                <div className="flex justify-between">
                  <button onClick={() => setWizardStep(0)} className="toolbar-btn text-xs px-4 py-1.5">
                    <ChevronLeft size={12} /> Back
                  </button>
                  <button onClick={() => setWizardStep(2)} className="toolbar-btn toolbar-btn-primary text-xs px-4 py-1.5">
                    Next: Review <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Review & Submit */}
            {wizardStep === 2 && (
              <div className="panel-beveled bg-surface-sunken p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={16} className="text-green-400" />
                  <h3 className="text-sm font-bold text-white">Review & Submit</h3>
                </div>
                <div className="p-2 bg-green-900/10 border border-green-800/30 rounded text-[10px] text-green-300">
                  <Info size={10} className="inline mr-1" />
                  Review your case details below. Once submitted, the case will be assigned a lab case number and queued for intake.
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><span className="text-rmpg-400">Title</span><span className="text-rmpg-200 font-semibold">{wizardData.title}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-rmpg-400">Type</span><span className="text-rmpg-200">{getCaseTypeLabel(wizardData.case_type)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-rmpg-400">Priority</span><span style={{ color: getPriorityConfig(wizardData.priority).color }} className="font-bold">{getPriorityConfig(wizardData.priority).label}</span></div>
                  {wizardData.synopsis && <div className="text-xs"><span className="text-rmpg-400">Synopsis:</span><p className="text-rmpg-200 mt-0.5">{wizardData.synopsis}</p></div>}
                  {wizardData.incident_id && <div className="flex justify-between text-xs"><span className="text-rmpg-400">Linked Incident</span><span className="text-rmpg-200">#{wizardData.incident_id}</span></div>}
                  <div className="flex justify-between text-xs"><span className="text-rmpg-400">Exhibits</span><span className="text-rmpg-200">{wizardData.exhibits.length} items</span></div>
                </div>

                {wizardData.exhibits.length > 0 && (
                  <div className="space-y-1">
                    {wizardData.exhibits.map((ex, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-300 bg-surface-base p-2 rounded">
                        <span className="font-mono font-bold text-brand-400">{String.fromCharCode(65 + i)}</span>
                        {ex.description || 'No description'}
                        {ex.examination_requested && <span className="text-rmpg-500 ml-auto">{ex.examination_requested}</span>}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-between">
                  <button onClick={() => setWizardStep(1)} className="toolbar-btn text-xs px-4 py-1.5">
                    <ChevronLeft size={12} /> Back
                  </button>
                  <button
                    onClick={handleWizardSubmit}
                    disabled={submitting || !wizardData.title.trim()}
                    className="toolbar-btn toolbar-btn-primary text-xs px-6 py-1.5 disabled:opacity-40"
                  >
                    {submitting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                    Submit Case
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
