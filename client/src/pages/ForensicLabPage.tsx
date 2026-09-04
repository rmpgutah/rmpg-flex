// ============================================================
// RMPG Flex — Forensic Lab Management Page
// Guided workflow for evidence intake, case management,
// exhibit tracking, analysis, and hash management.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import RichTextArea from '../components/RichTextArea';
import { humanizeCaseType } from '../utils/statusLabels';
import { asArray } from '../utils/asArray';
import {
  Microscope, Plus, Search, Filter, ChevronRight, FileText, Clock, AlertTriangle,
  CheckCircle, XCircle, Loader2, Eye, ArrowRight, Beaker, Hash, Link2, Activity,
  Fingerprint, Cpu, FlaskConical, Shield, Network, ChevronLeft, Package, Trash2,
  RefreshCw, Info, Edit3, Send, Unlink, HardDrive, ArrowDownUp, X, Printer,
} from 'lucide-react';
import IconButton from '../components/IconButton';
import FormModal from '../components/FormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import IncidentPickerInline from '../components/IncidentPickerInline';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import ExportButton from '../components/ExportButton';
import { useToast } from '../components/ToastProvider';
import { safeDateTimeStr, parseTimestamp } from '../utils/dateUtils';
import { openForensicCasePdf } from '../utils/forensicCasePdf';
import { computePayloadHash } from '../utils/pdfIntegrity';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { withAlpha } from '../utils/withAlpha';

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

// Priority + status colors map to severity tokens from theme-palettes.css.
// These re-theme automatically between night (steel-blue) and day (light-grey).
// Same semantic ladder used by Dispatch CFS severity, audit alerts, and SOR
// hit indicators, so an officer's visual muscle memory ("red = bad / amber =
// urgent / green = done") carries across surfaces.
const PRIORITIES = [
  { value: 'routine', label: 'Routine', desc: 'Standard processing — 30 day turnaround', color: 'var(--text-muted)' },
  { value: 'expedited', label: 'Expedited', desc: 'Priority processing — 14 day turnaround', color: 'var(--text-muted)' },
  { value: 'urgent', label: 'Urgent', desc: 'Urgent case need — 7 day turnaround', color: 'var(--sev-warn)' },
  { value: 'rush', label: 'Rush', desc: 'Immediate attention — 48 hour turnaround', color: 'var(--sev-critical)' },
] as const;

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; nextAction: string }> = {
  submitted: { label: 'Submitted', color: 'var(--text-secondary)', bgColor: 'bg-surface-sunken/20', nextAction: 'Case will be reviewed and assigned to an examiner' },
  intake: { label: 'Intake', color: 'var(--sev-special-soft)', bgColor: 'bg-purple-900/20', nextAction: 'Evidence is being cataloged and checked in' },
  assigned: { label: 'Assigned', color: 'var(--text-secondary)', bgColor: 'bg-surface-sunken/20', nextAction: 'Examiner is preparing to begin analysis' },
  in_progress: { label: 'In Progress', color: 'var(--sev-warn-soft)', bgColor: 'bg-amber-900/20', nextAction: 'Analysis is underway — check back for updates' },
  analysis_complete: { label: 'Analysis Complete', color: 'var(--sev-ok-soft)', bgColor: 'bg-emerald-900/20', nextAction: 'Results are available — report being drafted' },
  report_draft: { label: 'Report Draft', color: 'var(--sev-ok-soft)', bgColor: 'bg-lime-900/20', nextAction: 'Report is being reviewed before finalization' },
  report_final: { label: 'Report Final', color: 'var(--sev-ok)', bgColor: 'bg-green-900/20', nextAction: 'Final report is available' },
  closed: { label: 'Closed', color: 'var(--text-muted)', bgColor: 'bg-surface-sunken/20', nextAction: 'Case is complete and archived' },
  cancelled: { label: 'Cancelled', color: 'var(--sev-critical)', bgColor: 'bg-red-900/20', nextAction: 'Case was cancelled' },
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

const DEVICE_TYPES = [
  { value: 'phone', label: 'Phone' },
  { value: 'laptop', label: 'Laptop' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'server', label: 'Server' },
  { value: 'hard_drive', label: 'Hard Drive' },
  { value: 'usb', label: 'USB Device' },
  { value: 'other', label: 'Other' },
];

const DIGITAL_FORENSIC_STEPS = [
  'Create forensic image',
  'Verify hash integrity',
  'Extract file system',
  'Recover deleted files',
  'Analyze browser history',
  'Extract communications',
  'Analyze metadata',
  'Generate timeline',
];

const IMAGING_TOOLS = [
  'FTK Imager',
  'dd',
  'Cellebrite',
  'EnCase',
  'X-Ways',
  'Autopsy',
  'Magnet AXIOM',
  'Other',
];

const HASH_ALGORITHMS = ['MD5', 'SHA-1', 'SHA-256'];

interface CustodyEvent {
  id: string;
  timestamp: string;
  from_person: string;
  to_person: string;
  action: 'received' | 'transferred' | 'stored' | 'analyzed' | 'returned';
  notes: string;
}

interface DeviceInfo {
  device_type: string;
  make: string;
  model: string;
  serial_number: string;
  os_version: string;
  storage_capacity: string;
}

interface ImagingData {
  imaging_tool: string;
  hash_algorithm: string;
  original_hash: string;
  verification_hash: string;
  imaging_date: string;
  imager_name: string;
}

interface CaseMetadata {
  device_info?: DeviceInfo;
  forensic_steps?: Record<string, boolean>;
  custody_log?: CustodyEvent[];
  imaging?: ImagingData;
}

const TABS = ['My Cases', 'All Cases', 'New Case'] as const;
type Tab = typeof TABS[number];

// ─── Types ───────────────────────────────────────────────

interface ForensicCase {
  id: number;
  /** Server column is `lab_number` (e.g. "LAB-26-0042"). The legacy
   *  client name `lab_case_number` did not match the row shape from
   *  `src/routes/forensics.ts` GET /:id, so it always rendered blank.
   *  Aliased to keep older callers compiling while the canonical name
   *  is `lab_number`. */
  lab_number: string;
  /** @deprecated alias for `lab_number` — kept so prior consumers don't break. */
  lab_case_number?: string;
  title: string;
  case_type: string;
  status: string;
  priority: string;
  linked_incident_id: number | null;
  requesting_officer_id: number | null;
  requesting_officer_name: string | null;
  assigned_examiner_id: number | null;
  assigned_examiner_name: string | null;
  description: string | null;
  findings: string | null;
  conclusion: string | null;
  methodology: string | null;
  due_date: string | null;
  received_date: string | null;
  started_date: string | null;
  completed_date: string | null;
  notes: string | null;
  metadata?: string | null;
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
  exhibit_type: string;
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
  exhibits: { description: string; exhibit_type: string; condition_received: string; examination_requested: string }[];
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
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  // admin/manager/supervisor can create and edit; admin/manager can delete
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const canDelete = ['admin', 'manager'].includes(user?.role ?? '');
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const [activeTab, setActiveTab] = useState<Tab>('My Cases');
  const [cases, setCases] = useState<ForensicCase[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [selectedCase, setSelectedCase] = useState<ForensicCase | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'exhibits' | 'analyses' | 'timeline' | 'hashes' | 'links' | 'qc' | 'turnaround'>('overview');
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>(EMPTY_WIZARD);
  const [submitting, setSubmitting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Analysis modal
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisForm, setAnalysisForm] = useState({ analysis_type: 'digital_extraction', methodology: '', equipment_used: '', notes: '' });
  // Exhibit modal
  const [showExhibitModal, setShowExhibitModal] = useState(false);
  const [exhibitForm, setExhibitForm] = useState({ description: '', exhibit_type: '', condition_received: '', examination_requested: '' });
  // Edit case modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ description: '', findings: '', conclusion: '', notes: '', due_date: '' });
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
  // Custody log transfer modal
  const [showCustodyModal, setShowCustodyModal] = useState(false);
  const [custodyForm, setCustodyForm] = useState({ from_person: '', to_person: '', action: 'received' as CustodyEvent['action'], notes: '' });
  // Unlink-entity confirmation (replaces window.confirm)
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<number | null>(null);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  // Mark-complete modal (replaces window.prompt for exhibit + analysis results)
  type CompleteTarget =
    | { kind: 'exhibit'; id: number; label: string }
    | { kind: 'analysis'; id: number; label: string };
  const [completeTarget, setCompleteTarget] = useState<CompleteTarget | null>(null);
  const [completeResults, setCompleteResults] = useState('');
  const [completeConclusion, setCompleteConclusion] = useState('');
  const [completeBusy, setCompleteBusy] = useState(false);
  // Court PDF generation
  const [pdfBusy, setPdfBusy] = useState(false);
  // Deep-link hydration guard — fire only once, before user interaction.
  const deepLinkHandled = useRef(false);
  // Ref for the primary New Case title input — N shortcut focuses it.
  const primaryInputRef = useRef<HTMLInputElement>(null);
  // Close/cancel-case confirmation (admin/manager only — canDelete gated).
  const [confirmCloseCase, setConfirmCloseCase] = useState(false);
  const [closeCaseBusy, setCloseCaseBusy] = useState(false);

  // ── UPGRADE: Turnaround & QC ──
  const [turnaroundData, setTurnaroundData] = useState<any>(null);
  const [turnaroundLoading, setTurnaroundLoading] = useState(false);
  const [backlogData, setBacklogData] = useState<any>(null);
  const [backlogLoading, setBacklogLoading] = useState(false);
  const [qcHistory, setQcHistory] = useState<any[]>([]);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcForm, setQcForm] = useState({ check_type: 'peer_review', reviewer_notes: '', pass: true });
  const [qcSubmitting, setQcSubmitting] = useState(false);
  const [showBacklogReport, setShowBacklogReport] = useState(false);

  const fetchTurnaroundData = async () => {
    setTurnaroundLoading(true);
    try { const r = await apiFetch<any>('/forensics/turnaround-times'); setTurnaroundData(r?.data || null); }
    catch (err: any) { if (err?.name !== 'AbortError') addToast('Failed to load turnaround data', 'error'); } finally { setTurnaroundLoading(false); }
  };

  const fetchBacklogData = async () => {
    setBacklogLoading(true);
    try { const r = await apiFetch<any>('/forensics/metrics/backlog'); setBacklogData(r?.data || null); }
    catch (err: any) { if (err?.name !== 'AbortError') addToast('Failed to load backlog data', 'error'); } finally { setBacklogLoading(false); }
  };

  const fetchQcHistory = async (caseId: number) => {
    setQcLoading(true);
    try { const r = await apiFetch<any>(`/forensics/${caseId}/qc-history`); setQcHistory(r?.data || []); }
    catch (err: any) { setQcHistory([]); if (err?.name !== 'AbortError') addToast('Failed to load QC history', 'error'); } finally { setQcLoading(false); }
  };

  // (Removed: fetchAnalysisTemplates + analysisTemplates state — declared
  // but never rendered or wired to a UI. The /forensics/analysis-templates
  // endpoint still exists if a future "preset methodology" picker wants
  // to mount it; the dead client-side state was only adding bundle weight
  // and a misleading "we have templates" mental model.)

  const handleQcSubmit = async () => {
    if (!selectedCase) return;
    setQcSubmitting(true);
    try {
      await apiFetch(`/forensics/${selectedCase.id}/qc-check`, {
        method: 'POST', body: JSON.stringify(qcForm),
      });
      addToast(`QC check recorded: ${qcForm.pass ? 'PASS' : 'FAIL'}`, qcForm.pass ? 'success' : 'warning');
      fetchQcHistory(selectedCase.id);
      setQcForm({ check_type: 'peer_review', reviewer_notes: '', pass: true });
    } catch (err) { addToast(err instanceof Error ? err.message : 'QC check failed', 'error'); }
    finally { setQcSubmitting(false); }
  };

  // (Removed: lab-queue / report-templates / capacity-planning / evidence-
  // intake helpers — declared in v1024+ but never wired to a button. The
  // server endpoints they target (/forensics/queue/priority, /templates/
  // report, /capacity/planning, /:id/evidence-intake) also don't exist on
  // live as of this PR. Re-introduce alongside the corresponding UI when
  // a future PR actually ships those tabs.)

  // ── Close / Cancel Case ────────────────────────────────
  // Gated to canDelete (admin/manager). Transitions the case to 'cancelled'
  // status. A ConfirmDialog gate replaces the prior implicit no-protection path.

  const handleConfirmCloseCase = async () => {
    if (!selectedCase) return;
    setCloseCaseBusy(true);
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      addToast(`Case ${selectedCase.lab_number || selectedCase.lab_case_number || `FC-${selectedCase.id}`} cancelled`, 'success');
      setSelectedCase(null);
      setDetailTab('overview');
      fetchCases();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to cancel case', 'error');
    } finally {
      setCloseCaseBusy(false);
      setConfirmCloseCase(false);
    }
  };

  // ── Fetch ──────────────────────────────────────────────

  const fetchCases = useCallback(async (tab?: Tab, signal?: AbortSignal) => {
    setLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('case_type', filterType);
      params.set('limit', '100');

      const [casesRes, statsRes] = await Promise.all([
        apiFetch<{ data: ForensicCase[] }>(`/forensic-lab?${params}`, { signal }),
        apiFetch<Stats>('/forensic-lab/stats', { signal }),
      ]);
      setCases(casesRes.data || []);
      setStats(statsRes);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setFetchError(err?.message || 'Failed to load forensic cases');
      addToast('Failed to load forensic cases', 'error');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, filterStatus, filterType, addToast]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCases(undefined, controller.signal);
    return () => controller.abort();
  }, [fetchCases]);
  useLiveSync('forensic-lab', fetchCases);

  const fetchCaseDetail = useCallback(async (id: number, signal?: AbortSignal) => {
    try {
      // Server returns `{ data: row }` from GET /:id (see src/routes/forensics.ts:239).
      // Previously the page typed the response as `ForensicCase` directly, so
      // `detail.id` was always undefined and every selectedCase-keyed render
      // path silently fell back to the empty state. Unwrap the envelope here
      // and tolerate older clients that return the bare row (defensive `?? detail`).
      const raw = await apiFetch<{ data: ForensicCase } | ForensicCase>(`/forensic-lab/${id}`, { signal });
      const detail = (raw as { data?: ForensicCase })?.data ?? (raw as ForensicCase);
      setSelectedCase(detail);
      // Fetch links and hashes in parallel. The .catch() stays as defensive
      // handling for a transient network error, not a 404 workaround — both
      // endpoints are implemented as of migration 0187 (see
      // docs/superpowers/specs/2026-07-13-forensics-government-standard-design.md).
      apiFetch<any[]>(`/forensic-lab/${id}/links`, { signal }).then(l => setCaseLinks(asArray(l))).catch(() => setCaseLinks([]));
      apiFetch<{ hashes: any[]; stats: any }>(`/forensic-lab/${id}/hashes`, { signal })
        .then(d => { setHashes(asArray(d?.hashes)); setHashStats(d?.stats || null); })
        .catch(() => { setHashes([]); setHashStats(null); });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      addToast('Failed to load case details', 'error');
    }
  }, [addToast]);

  // ── Wizard Submit ──────────────────────────────────────

  const handleWizardSubmit = async () => {
    if (!wizardData.title.trim()) return;
    setSubmitting(true);
    try {
      const caseRes = await apiFetch<{ data: ForensicCase; lab_number: string }>('/forensic-lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: wizardData.title,
          case_type: wizardData.case_type,
          priority: wizardData.priority,
          description: wizardData.synopsis,
          linked_incident_id: wizardData.incident_id ? Number(wizardData.incident_id) : null,
          notes: wizardData.notes,
        }),
      });
      const newCaseId = caseRes.data.id;

      // Add exhibits
      for (const exhibit of wizardData.exhibits) {
        if (exhibit.description.trim()) {
          await apiFetch(`/forensic-lab/${newCaseId}/exhibits`, {
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
      fetchCaseDetail(newCaseId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create case', 'error');
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
      setAnalysisForm({ analysis_type: 'digital_extraction', methodology: '', equipment_used: '', notes: '' });
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      addToast('Failed to add analysis', 'error');
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
      setExhibitForm({ description: '', exhibit_type: '', condition_received: '', examination_requested: '' });
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      addToast('Failed to add exhibit', 'error');
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
      addToast('Failed to update status', 'error');
    }
  };

  // ── Edit Case Fields ───────────────────────────────────

  const openEditModal = () => {
    if (!selectedCase) return;
    setEditForm({
      description: selectedCase.description || '',
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
      addToast('Failed to save case changes', 'error');
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
      addToast('Failed to update analysis', 'error');
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
      addToast('Failed to update exhibit', 'error');
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
      addToast('Failed to add note', 'error');
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
      addToast('Failed to link entity', 'error');
    }
  };

  // Unlink is two-step: handleUnlinkEntity opens ConfirmDialog (replaces
  // the old window.confirm), confirmUnlinkEntity executes after the operator
  // accepts. Browser-native confirm is unacceptable on a chain-of-custody
  // surface — Esc + click outside should both cancel, and the dialog must
  // render inside the app theme so an officer recognises it as part of RMPG.
  const handleUnlinkEntity = (linkId: number) => {
    setConfirmUnlinkId(linkId);
  };

  const confirmUnlinkEntity = async () => {
    if (!selectedCase || confirmUnlinkId == null) return;
    setUnlinkBusy(true);
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}/links/${confirmUnlinkId}`, { method: 'DELETE' });
      fetchCaseLinks(selectedCase.id);
      addToast('Linked entity removed', 'success');
    } catch (err) {
      addToast('Failed to unlink entity', 'error');
    } finally {
      setUnlinkBusy(false);
      setConfirmUnlinkId(null);
    }
  };

  // Mark-complete flow for exhibits + analyses. Replaces the two
  // `window.prompt()` calls that captured court-record results as
  // single-line text with no validation or richtext. Now goes through
  // a real modal with required Results + optional Conclusion fields.
  const submitComplete = async () => {
    if (!completeTarget || !completeResults.trim()) return;
    setCompleteBusy(true);
    try {
      if (completeTarget.kind === 'exhibit') {
        await handleExhibitStatusChange(completeTarget.id, 'complete', { results: completeResults.trim() });
      } else {
        await handleAnalysisStatusChange(completeTarget.id, 'complete', {
          results: completeResults.trim(),
          conclusion: completeConclusion.trim() || undefined,
        });
      }
      addToast(`${completeTarget.label} marked complete`, 'success');
      setCompleteTarget(null);
      setCompleteResults('');
      setCompleteConclusion('');
    } catch (err) {
      addToast('Failed to mark complete', 'error');
    } finally {
      setCompleteBusy(false);
    }
  };

  const fetchCaseLinks = useCallback(async (id: number) => {
    try {
      const links = await apiFetch<any[]>(`/forensic-lab/${id}/links`);
      setCaseLinks(links || []);
    } catch (err: any) { setCaseLinks([]); if (err?.name !== 'AbortError') addToast('Failed to load case links', 'error'); }
  }, [addToast]);

  // ── Hashes ─────────────────────────────────────────────

  const fetchHashes = useCallback(async (id: number) => {
    try {
      const data = await apiFetch<{ hashes: any[]; stats: { total: number; flagged: number; matched: number } }>(`/forensic-lab/${id}/hashes`);
      setHashes(data.hashes || []);
      setHashStats(data.stats || null);
    } catch (err: any) { setHashes([]); setHashStats(null); if (err?.name !== 'AbortError') addToast('Failed to load hashes', 'error'); }
  }, [addToast]);

  // ── Metadata helpers ─────────────────────────────────────

  const parseMeta = (c: ForensicCase | null): CaseMetadata => {
    if (!c?.metadata) return {};
    try { return typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata; } catch { return {}; }
  };

  const saveMetadata = async (updates: Partial<CaseMetadata>) => {
    if (!selectedCase) return;
    const current = parseMeta(selectedCase);
    const merged = { ...current, ...updates };
    try {
      await apiFetch(`/forensic-lab/${selectedCase.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: JSON.stringify(merged) }),
      });
      fetchCaseDetail(selectedCase.id);
    } catch (err) {
      addToast('Failed to save metadata', 'error');
    }
  };

  const handleSaveDeviceInfo = async (deviceInfo: DeviceInfo) => {
    await saveMetadata({ device_info: deviceInfo });
  };

  const handleToggleForensicStep = async (step: string, checked: boolean) => {
    const meta = parseMeta(selectedCase);
    const steps = { ...(meta.forensic_steps || {}), [step]: checked };
    await saveMetadata({ forensic_steps: steps });
  };

  const handleAddCustodyEntry = async () => {
    if (!selectedCase || !custodyForm.from_person.trim() || !custodyForm.to_person.trim()) return;
    const meta = parseMeta(selectedCase);
    const log = [...(meta.custody_log || [])];
    log.push({
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      from_person: custodyForm.from_person,
      to_person: custodyForm.to_person,
      action: custodyForm.action,
      notes: custodyForm.notes,
    });
    await saveMetadata({ custody_log: log });
    setShowCustodyModal(false);
    setCustodyForm({ from_person: '', to_person: '', action: 'received', notes: '' });
  };

  const handleSaveImaging = async (imaging: ImagingData) => {
    await saveMetadata({ imaging });
  };

  // ── Court-ready PDF ────────────────────────────────────
  //
  // Forensic case files are direct court-record material. The page shipped
  // with full in-app detail panels but no print path — defense counsel
  // subpoenas these during discovery, and a screenshot of the SPA isn't
  // discoverable. This generates a paginated PDF with case header, exhibits
  // (incl. chain-of-custody mini-tables), analyses, findings/conclusion,
  // tamper-evidence statement, and a SHA-256 payload-hash trailer that
  // binds the document to the underlying case state at print time.
  // Mirrors auditLogPdf / evidenceItemPdf for visual consistency in
  // court-package binders. Phase-D Ed25519 signing arrives via the same
  // pdfIntegrity surface the record forms already use, but the document
  // is meaningful without it (the payload hash alone is the operative
  // binding for "this PDF describes the same row that was in the DB").
  const handleGenerateCourtPdf = async () => {
    if (!selectedCase) return;
    setPdfBusy(true);
    try {
      const exhibits = selectedCase.exhibits || [];
      const analyses = selectedCase.analyses || [];
      const bundle = {
        case: selectedCase,
        exhibits,
        analyses,
      };
      const payloadHash = await computePayloadHash(bundle);
      openForensicCasePdf({
        case: {
          id: selectedCase.id,
          lab_number: selectedCase.lab_number || selectedCase.lab_case_number,
          title: selectedCase.title,
          case_type: selectedCase.case_type,
          status: selectedCase.status,
          priority: selectedCase.priority,
          description: selectedCase.description || undefined,
          findings: selectedCase.findings || undefined,
          conclusion: selectedCase.conclusion || undefined,
          notes: selectedCase.notes || undefined,
          requesting_officer: selectedCase.requesting_officer_name || undefined,
          lead_examiner_name: selectedCase.assigned_examiner_name || undefined,
          received_date: selectedCase.received_date || undefined,
          due_date: selectedCase.due_date || undefined,
          completed_date: selectedCase.completed_date || undefined,
          created_at: selectedCase.created_at,
        },
        exhibits: exhibits.map((ex: any) => ({
          id: ex.id,
          exhibit_number: ex.exhibit_number,
          exhibit_type: ex.exhibit_type,
          description: ex.description,
          quantity: ex.quantity,
          condition_received: ex.condition_received,
          storage_location: ex.storage_location,
          storage_temp: ex.storage_temp,
          collected_by: ex.collected_by,
          collected_date: ex.collected_date,
          collection_method: ex.collection_method,
          hash_md5: ex.hash_md5,
          hash_sha256: ex.hash_sha256,
          disposition: ex.disposition,
          disposition_date: ex.disposition_date,
          notes: ex.notes,
          chain_of_custody: ex.chain_of_custody,
        })),
        analyses: analyses.map((a: any) => ({
          id: a.id,
          analysis_type: a.analysis_type,
          status: a.status,
          methodology: a.methodology,
          equipment_used: a.equipment_used,
          results: a.results,
          conclusion: a.conclusion,
          notes: a.notes,
          analyst_name: a.examiner_name || a.analyst_name,
          started_at: a.started_at,
          completed_at: a.completed_at,
        })),
        payloadHash,
      });
      addToast('Court PDF opened in a new tab', 'success');
    } catch (err) {
      addToast('Failed to generate court PDF', 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────

  const getStatusConfig = (status: string) => STATUS_CONFIG[status] || { label: status, color: 'var(--text-muted)', bgColor: 'bg-surface-sunken/20', nextAction: '' };
  const getCaseTypeLabel = (t: string) => CASE_TYPES.find(c => c.value === t)?.label || t;
  const getPriorityConfig = (p: string) => PRIORITIES.find(pr => pr.value === p) || PRIORITIES[0];

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return parseTimestamp(d).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isOverdue = (c: ForensicCase) => {
    if (!c.due_date || ['closed', 'cancelled', 'report_final'].includes(c.status)) return false;
    return parseTimestamp(c.due_date) < new Date();
  };

  // \u2500\u2500 Right-click context menu for forensic case list rows \u2500\u2500
  const buildCaseMenu = (c: ForensicCase): ContextMenuItem[] => [
    m.action('Open case', () => fetchCaseDetail(c.id), { icon: <Eye size={12} /> }),
    m.action('View connections', () => navigate(`/connections?type=case&id=${c.id}`), { icon: <Network size={12} /> }),
    m.separator(),
    m.copy('Copy lab case number', c.lab_number || c.lab_case_number || ''),
    m.copyId(c.id),
    ...(c.title ? [m.copy('Copy title', c.title)] : []),
  ];

  // Set document title
  useEffect(() => { document.title = 'Forensic Lab \u2014 RMPG Flex'; }, []);

  // Keyboard shortcuts — Esc smart-cascade + N opens New Case tab.
  // Esc closes the topmost open surface only, in this priority order, so
  // a stacked open-modal-over-detail-view doesn't pop the whole detail
  // by accident. The cascade was previously a one-line setShowAnalysisModal
  // call that ignored every other modal + the detail view + the filter chip.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when the operator is mid-type in an input/textarea
      // — let the browser's native blur-on-Esc handle the field, and let
      // 'N' actually type the letter.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      if (e.key === 'Escape') {
        // Cascade: topmost open surface first; stopPropagation so only one
        // layer closes per keystroke (prevents Esc from tunnelling through
        // stacked modals in a single event tick).
        if (completeTarget) { e.stopPropagation(); setCompleteTarget(null); setCompleteResults(''); setCompleteConclusion(''); return; }
        if (confirmUnlinkId != null) { e.stopPropagation(); setConfirmUnlinkId(null); return; }
        if (confirmCloseCase) { e.stopPropagation(); setConfirmCloseCase(false); return; }
        if (showAnalysisModal) { e.stopPropagation(); setShowAnalysisModal(false); return; }
        if (showExhibitModal) { e.stopPropagation(); setShowExhibitModal(false); return; }
        if (showEditModal) { e.stopPropagation(); setShowEditModal(false); return; }
        if (showCustodyModal) { e.stopPropagation(); setShowCustodyModal(false); return; }
        if (linkSearchResults.length > 0) { e.stopPropagation(); setLinkSearchResults([]); setLinkSearchTerm(''); return; }
        if (showFilters) { e.stopPropagation(); setShowFilters(false); return; }
        if (fetchError) { e.stopPropagation(); setFetchError(''); return; }
        if (selectedCase) { e.stopPropagation(); setSelectedCase(null); setDetailTab('overview'); return; }
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        // Quick-jump to New Case tab from the list view. Only when no modal
        // is open + no case is selected, so it doesn't fight the typing in
        // a richtext field somewhere in the detail panels.
        if (canManage && !selectedCase && !completeTarget && !showAnalysisModal && !showExhibitModal
          && !showEditModal && !showCustodyModal && confirmUnlinkId == null) {
          setActiveTab('New Case');
          setWizardStep(0);
          // Focus the case title input so the operator can start typing immediately.
          setTimeout(() => primaryInputRef.current?.focus(), 50);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [completeTarget, confirmUnlinkId, confirmCloseCase, showAnalysisModal, showExhibitModal,
      showEditModal, showCustodyModal, linkSearchResults.length, showFilters,
      fetchError, selectedCase, canManage]);

  // Deep-link hydration — supports ?case_id=<n>, ?tab=<detail-tab>,
  // and ?new=1 (jump straight to the New Case wizard). Mirrors the
  // contract every other v1024+ audited page exposes so a supervisor can
  // paste a link to a specific case from an audit report or chat.
  // Params are stripped after first paint so a refresh doesn't repeatedly
  // re-pin the operator to a stale link they've since clicked away from.
  useEffect(() => {
    if (deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    // Accept ?case_id=, ?id=, or ?sample_id= (generic "open this item" alias)
    const caseIdRaw = searchParams.get('case_id') || searchParams.get('id') || searchParams.get('sample_id');
    const tabRaw = searchParams.get('tab');
    const newCase = searchParams.get('new');
    if (caseIdRaw) {
      const n = parseInt(caseIdRaw, 10);
      if (Number.isFinite(n)) {
        fetchCaseDetail(n);
        if (tabRaw && ['overview', 'exhibits', 'analyses', 'timeline', 'links', 'hashes', 'qc', 'turnaround'].includes(tabRaw)) {
          setDetailTab(tabRaw as any);
        }
        addToast(`Opening forensic case #${n}…`, 'info');
      } else {
        addToast('Invalid case ID in URL — showing case list', 'warning');
      }
    } else if (newCase === '1') {
      setActiveTab('New Case');
      setWizardStep(0);
    }
    // Strip handled params so we don't re-trigger on every render. Keeps
    // other query params (none today, but future-proof) intact.
    if (caseIdRaw || tabRaw || newCase) {
      const next = new URLSearchParams(searchParams);
      next.delete('case_id'); next.delete('id'); next.delete('sample_id'); next.delete('tab'); next.delete('new');
      setSearchParams(next, { replace: true });
    }
    // Intentionally omit dependencies — this MUST be a one-shot. The
    // `deepLinkHandled` ref guards re-runs even when React strict-mode
    // double-invokes effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700 bg-surface-sunken">
          <IconButton onClick={() => { setSelectedCase(null); setDetailTab('overview'); }} className="text-rmpg-400 hover:text-rmpg-100 transition-colors" aria-label="Back to case list">
            <ChevronLeft size={16} />
          </IconButton>
          <Microscope size={16} className="text-brand-400" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-brand-400">{selectedCase.lab_number || selectedCase.lab_case_number || `FC-${selectedCase.id}`}</span>
              <span className="text-[9px] px-1.5 py-0.5 font-bold border" style={{ backgroundColor: withAlpha(sc.color, '15'), color: sc.color, borderColor: withAlpha(sc.color, '40') }}>{sc.label}</span>
              <span className="text-[9px] px-1.5 py-0.5 font-bold border" style={{ backgroundColor: withAlpha(pc.color, '15'), color: pc.color, borderColor: withAlpha(pc.color, '40') }}>{pc.label}</span>
              {overdue && <span className="text-[9px] px-1.5 py-0.5 bg-red-900/30 text-red-400 font-bold border border-red-700/50 animate-pulse">OVERDUE</span>}
            </div>
            <div className="text-sm font-semibold text-rmpg-100 truncate">{selectedCase.title}</div>
          </div>
          <button type="button"
            onClick={() => fetchCaseDetail(selectedCase.id)}
            className="toolbar-btn"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>

        {/* Progress Pipeline */}
        <div className="px-3 py-2 border-b border-rmpg-700 bg-surface-sunken/50 overflow-x-auto tab-scroll">
          <div className="flex items-center gap-1 min-w-max">
            {STATUS_PIPELINE.map((s, i) => {
              const cfg = getStatusConfig(s);
              const isActive = i === currentIdx;
              const isPast = i < currentIdx;
              return (
                <React.Fragment key={s}>
                  {i > 0 && <ArrowRight size={10} className={isPast ? 'text-green-500' : 'text-rmpg-600'} />}
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[9px] font-bold uppercase tracking-wide ${
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
        <div className="flex items-center border-b border-rmpg-700 bg-surface-sunken">
          {(['overview', 'exhibits', 'analyses', 'timeline', 'links', 'hashes', 'qc', 'turnaround'] as const).map(tab => {
            const icons = { overview: Eye, exhibits: Package, analyses: Beaker, timeline: Activity, links: Link2, hashes: Hash, qc: Shield, turnaround: Clock };
            const labels = { overview: 'Overview', exhibits: `Exhibits (${selectedCase.exhibits?.length || 0})`, analyses: `Analyses (${selectedCase.analyses?.length || 0})`, timeline: 'Timeline', links: `Links (${caseLinks.length})`, hashes: 'Hashes', qc: 'QC', turnaround: 'Timing' };
            const Icon = icons[tab];
            return (
              <button type="button"
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium transition-colors border-b-2 ${
                  detailTab === tab
                    ? 'text-rmpg-100 border-brand-500'
                    : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-700'
                }`}
              >
                <Icon size={12} />
                {!isMobile ? labels[tab] : (tab === 'overview' ? 'Info' : tab.charAt(0).toUpperCase() + tab.slice(1, 4))}
              </button>
            );
          })}
        </div>

        {/* Detail Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {/* Overview Tab */}
          {detailTab === 'overview' && (
            <>
              {/* Quick Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <select id="ff-forensiclabpage-0"
                  value={selectedCase.status}
                  onChange={e => handleStatusChange(e.target.value)}
                  className="px-2 py-1 text-[10px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none font-bold"
                  style={{ color: sc.color }}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                {canManage && (
                  <button type="button" onClick={openEditModal} className="toolbar-btn text-[10px]">
                    <Edit3 size={10} /> Edit Details
                  </button>
                )}
                <button type="button" onClick={() => navigate(`/connections?type=case&id=${selectedCase.id}`)} className="toolbar-btn text-[10px]">
                  <Network size={10} /> View Connections
                </button>
                <button type="button" onClick={handleGenerateCourtPdf} disabled={pdfBusy}
                  className="toolbar-btn text-[10px] disabled:opacity-50"
                  title="Generate a court-ready PDF with tamper-evidence payload hash"
                >
                  {pdfBusy ? <Loader2 size={10} className="animate-spin" /> : <Printer size={10} />}
                  Court PDF
                </button>
                {canDelete && !['closed', 'cancelled'].includes(selectedCase.status) && (
                  <button type="button"
                    onClick={() => setConfirmCloseCase(true)}
                    className="toolbar-btn text-[10px] text-red-400 hover:text-red-300"
                    title="Cancel this forensic case (admin/manager only)"
                  >
                    <XCircle size={10} /> Cancel Case
                  </button>
                )}
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
                    {selectedCase.linked_incident_id && (
                      <div className="flex justify-between">
                        <span className="text-rmpg-400">Linked Incident</span>
                        <button type="button" onClick={() => navigate(`/incidents?id=${selectedCase.linked_incident_id}`)} className="text-brand-400 hover:underline">#{selectedCase.linked_incident_id}</button>
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
                      <div className="text-xl font-bold font-mono text-rmpg-400">{hashes.length}</div>
                      <div className="text-[9px] text-rmpg-500 uppercase">Hashes</div>
                    </div>
                  </div>
                </div>
              </div>
              {selectedCase.description && (
                <div className="panel-beveled bg-surface-sunken p-3">
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Synopsis</div>
                  <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedCase.description}</p>
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

              {/* ── Device Analysis (digital cases only) ─────────── */}
              {selectedCase.case_type === 'digital' && (() => {
                const meta = parseMeta(selectedCase);
                const device = meta.device_info || { device_type: '', make: '', model: '', serial_number: '', os_version: '', storage_capacity: '' };
                const steps = meta.forensic_steps || {};
                return (
                  <div className="panel-beveled bg-surface-sunken p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <Cpu size={14} className="text-rmpg-400" />
                      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Device Analysis</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="ff-forensiclabpage-1" className="block text-[10px] text-rmpg-500 mb-0.5">Device Type</label>
                        <select id="ff-forensiclabpage-1"
                          value={device.device_type}
                          onChange={e => handleSaveDeviceInfo({ ...device, device_type: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                        >
                          <option value="">Select...</option>
                          {DEVICE_TYPES.map(dt => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="ff-forensiclabpage-2" className="block text-[10px] text-rmpg-500 mb-0.5">Make</label>
                        <input id="ff-forensiclabpage-2" type="text" value={device.make} onBlur={e => handleSaveDeviceInfo({ ...device, make: e.target.value })} onChange={e => { /* controlled via onBlur */ }}
                          defaultValue={device.make}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                          placeholder="e.g. Apple, Samsung"
                        />
                      </div>
                      <div>
                        <label htmlFor="ff-forensiclabpage-3" className="block text-[10px] text-rmpg-500 mb-0.5">Model</label>
                        <input id="ff-forensiclabpage-3" type="text" defaultValue={device.model} onBlur={e => handleSaveDeviceInfo({ ...device, model: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                          placeholder="e.g. iPhone 15 Pro"
                        />
                      </div>
                      <div>
                        <label htmlFor="ff-forensiclabpage-4" className="block text-[10px] text-rmpg-500 mb-0.5">Serial Number</label>
                        <input id="ff-forensiclabpage-4" type="text" defaultValue={device.serial_number} onBlur={e => handleSaveDeviceInfo({ ...device, serial_number: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none font-mono"
                          placeholder="S/N"
                        />
                      </div>
                      <div>
                        <label htmlFor="ff-forensiclabpage-5" className="block text-[10px] text-rmpg-500 mb-0.5">OS Version</label>
                        <input id="ff-forensiclabpage-5" type="text" defaultValue={device.os_version} onBlur={e => handleSaveDeviceInfo({ ...device, os_version: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                          placeholder="e.g. iOS 18.2, Windows 11"
                        />
                      </div>
                      <div>
                        <label htmlFor="ff-forensiclabpage-6" className="block text-[10px] text-rmpg-500 mb-0.5">Storage Capacity</label>
                        <input id="ff-forensiclabpage-6" type="text" defaultValue={device.storage_capacity} onBlur={e => handleSaveDeviceInfo({ ...device, storage_capacity: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                          placeholder="e.g. 256 GB, 1 TB"
                        />
                      </div>
                    </div>

                    <div className="border-t border-rmpg-700 pt-2">
                      <div className="text-[10px] text-rmpg-400 font-semibold mb-1.5">Digital Forensic Steps</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {DIGITAL_FORENSIC_STEPS.map(step => (
                          <label key={step} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-base transition-colors cursor-pointer">
                            <input id="ff-forensiclabpage-7"
                              type="checkbox"
                              checked={!!steps[step]}
                              onChange={e => handleToggleForensicStep(step, e.target.checked)}
                              className="w-3.5 h-3.5 rounded-sm border-rmpg-700 bg-surface-sunken text-brand-500 focus:ring-brand-500 focus:ring-1"
                            />
                            <span className={`text-[11px] ${steps[step] ? 'text-green-400 line-through' : 'text-rmpg-300'}`}>{step}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-1.5 text-[9px] text-rmpg-500">
                        {Object.values(steps).filter(Boolean).length} / {DIGITAL_FORENSIC_STEPS.length} steps completed
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Chain of Custody Log ──────────────────────────── */}
              {(() => {
                const meta = parseMeta(selectedCase);
                const custodyLog = meta.custody_log || [];
                const CUSTODY_ACTIONS = ['received', 'transferred', 'stored', 'analyzed', 'returned'] as const;
                const actionColors: Record<string, string> = {
                  // `returned` must not reuse --text-muted: it is `received`'s color, and
                  // the two are opposite ends of a custody transfer.
                  received: 'var(--text-muted)', transferred: 'var(--sev-warn)', stored: 'var(--sev-special-soft)', analyzed: 'var(--sev-ok-soft)', returned: 'var(--text-secondary)',
                };
                return (
                  <div className="panel-beveled bg-surface-sunken p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ArrowDownUp size={14} className="text-amber-400" />
                        <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Chain of Custody</div>
                        <span className="text-[9px] text-rmpg-600 font-mono">({custodyLog.length} entries)</span>
                      </div>
                      {canManage && (
                        <button type="button"
                          onClick={() => setShowCustodyModal(true)}
                          className="toolbar-btn toolbar-btn-primary text-[10px]"
                        >
                          <Plus size={10} /> Log Transfer
                        </button>
                      )}
                    </div>
                    {custodyLog.length === 0 ? (
                      <div className="text-center py-4">
                        <ArrowDownUp size={20} className="text-rmpg-600 mx-auto mb-1.5" />
                        <p className="text-[11px] text-rmpg-400">No custody events logged yet.</p>
                        <p className="text-[9px] text-rmpg-500 mt-0.5 italic">Log every time evidence changes hands to maintain chain of custody.</p>
                      </div>
                    ) : (
                      <div className="relative ml-3">
                        {/* Vertical line */}
                        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-rmpg-700/50" />
                        <div className="space-y-3">
                          {custodyLog.map((ev, i) => (
                            <div key={ev.id} className="flex gap-3 relative">
                              <div className="w-3 h-3 rounded-full border-2 flex-shrink-0 mt-0.5 z-10" style={{
                                borderColor: actionColors[ev.action] || 'var(--text-muted)',
                                backgroundColor: i === 0 ? (actionColors[ev.action] || 'var(--text-muted)') : 'var(--surface-overlay)',
                              }} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm" style={{
                                    backgroundColor: withAlpha(actionColors[ev.action] || 'var(--text-muted)', '20'),
                                    color: actionColors[ev.action] || 'var(--text-muted)',
                                  }}>{toDisplayLabel(ev.action)}</span>
                                  <span className="text-[10px] text-rmpg-300">
                                    <span className="text-rmpg-200 font-semibold">{ev.from_person}</span>
                                    <span className="text-rmpg-500 mx-1">&rarr;</span>
                                    <span className="text-rmpg-200 font-semibold">{ev.to_person}</span>
                                  </span>
                                </div>
                                {ev.notes && <p className="text-[10px] text-rmpg-400 mt-0.5">{ev.notes}</p>}
                                <div className="text-[9px] text-rmpg-500 font-mono mt-0.5">
                                  {safeDateTimeStr(ev.timestamp)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Forensic Imaging Workflow (digital cases only) ── */}
              {selectedCase.case_type === 'digital' && (() => {
                const meta = parseMeta(selectedCase);
                const imaging = meta.imaging || { imaging_tool: '', hash_algorithm: '', original_hash: '', verification_hash: '', imaging_date: '', imager_name: '' };
                const hashMatch = imaging.original_hash && imaging.verification_hash
                  ? imaging.original_hash.trim().toLowerCase() === imaging.verification_hash.trim().toLowerCase()
                  : null;
                return (
                  <div className="panel-beveled bg-surface-sunken p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <HardDrive size={14} className="text-purple-400" />
                      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Forensic Imaging</div>
                      {hashMatch === true && <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-green-900/20 text-green-400 font-bold flex items-center gap-1"><CheckCircle size={10} /> VERIFIED</span>}
                      {hashMatch === false && <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-red-900/20 text-red-400 font-bold flex items-center gap-1"><XCircle size={10} /> MISMATCH</span>}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="ff-forensiclabpage-8" className="block text-[10px] text-rmpg-500 mb-0.5">Imaging Tool</label>
                        <select id="ff-forensiclabpage-8"
                          value={imaging.imaging_tool}
                          onChange={e => handleSaveImaging({ ...imaging, imaging_tool: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                        >
                          <option value="">Select tool...</option>
                          {IMAGING_TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="ff-forensiclabpage-9" className="block text-[10px] text-rmpg-500 mb-0.5">Hash Algorithm</label>
                        <select id="ff-forensiclabpage-9"
                          value={imaging.hash_algorithm}
                          onChange={e => handleSaveImaging({ ...imaging, hash_algorithm: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                        >
                          <option value="">Select algorithm...</option>
                          {HASH_ALGORITHMS.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor="ff-forensiclabpage-10" className="block text-[10px] text-rmpg-500 mb-0.5">Original Hash Value</label>
                        <input id="ff-forensiclabpage-10" type="text" defaultValue={imaging.original_hash}
                          onBlur={e => handleSaveImaging({ ...imaging, original_hash: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none font-mono"
                          placeholder="Hash of original source..."
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor="ff-forensiclabpage-11" className="block text-[10px] text-rmpg-500 mb-0.5">Verification Hash</label>
                        <div className="flex items-center gap-2">
                          <input id="ff-forensiclabpage-11" type="text" defaultValue={imaging.verification_hash}
                            onBlur={e => handleSaveImaging({ ...imaging, verification_hash: e.target.value })}
                            className="flex-1 px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none font-mono"
                            placeholder="Hash of forensic image..."
                          />
                          {hashMatch === true && <CheckCircle size={16} className="text-green-400 flex-shrink-0" />}
                          {hashMatch === false && <XCircle size={16} className="text-red-400 flex-shrink-0" />}
                        </div>
                        {hashMatch === false && (
                          <p className="text-[9px] text-red-400 mt-0.5 font-semibold">WARNING: Hash values do not match. Image integrity cannot be verified.</p>
                        )}
                        {hashMatch === true && (
                          <p className="text-[9px] text-green-400 mt-0.5">Hash values match. Forensic image integrity confirmed.</p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="ff-forensiclabpage-12" className="block text-[10px] text-rmpg-500 mb-0.5">Imaging Date/Time</label>
                        <input id="ff-forensiclabpage-12" type="datetime-local" defaultValue={imaging.imaging_date}
                          onBlur={e => handleSaveImaging({ ...imaging, imaging_date: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="ff-forensiclabpage-13" className="block text-[10px] text-rmpg-500 mb-0.5">Imager Name</label>
                        <input id="ff-forensiclabpage-13" type="text" defaultValue={imaging.imager_name}
                          onBlur={e => handleSaveImaging({ ...imaging, imager_name: e.target.value })}
                          className="w-full px-2 py-1 text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                          placeholder="Name of person who created the image"
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* Exhibits Tab */}
          {detailTab === 'exhibits' && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Evidence Items</div>
                {canManage && (
                  <button type="button" onClick={() => setShowExhibitModal(true)} className="toolbar-btn toolbar-btn-primary text-[10px]">
                    <Plus size={10} /> Add Exhibit
                  </button>
                )}
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
                    const exStatus = ex.status === 'complete' ? { color: 'var(--sev-ok)', icon: CheckCircle } :
                      ex.status === 'examining' ? { color: 'var(--sev-warn)', icon: Activity } :
                      { color: 'var(--text-secondary)', icon: Package };
                    return (
                      <div key={ex.id} className="panel-beveled bg-surface-sunken p-3 border-l-[3px]" style={{ borderLeftColor: exStatus.color }}>
                        <div className="flex items-start gap-2">
                          <div className="w-8 h-8 rounded-sm flex items-center justify-center text-sm font-bold font-mono" style={{ backgroundColor: withAlpha(exStatus.color, '20'), color: exStatus.color }}>
                            {ex.exhibit_number}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-rmpg-200">{ex.description}</div>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                              {ex.exhibit_type && <span>Type: {ex.exhibit_type}</span>}
                              {ex.condition_received && <span>Condition: {ex.condition_received}</span>}
                              <span className="font-bold uppercase" style={{ color: exStatus.color }}>{toDisplayLabel(ex.status || '')}</span>
                            </div>
                            {ex.examination_requested && (
                              <div className="text-[10px] text-rmpg-400 mt-1">
                                <span className="text-rmpg-500">Exam requested:</span> {ex.examination_requested}
                              </div>
                            )}
                            {ex.results && (
                              <div className="mt-2 p-2 bg-surface-base rounded-sm text-[10px] text-rmpg-200 border border-rmpg-700">
                                <span className="text-green-400 font-bold uppercase text-[9px]">Results: </span>{ex.results}
                              </div>
                            )}
                            {/* Status actions */}
                            <div className="flex items-center gap-1.5 mt-2">
                              {ex.status === 'received' && (
                                <button type="button" onClick={() => handleExhibitStatusChange(ex.id, 'examining')} className="text-[9px] px-2 py-0.5 bg-amber-900/20 text-amber-400 border border-amber-700/40 rounded-sm hover:bg-amber-900/40 transition-colors">
                                  Begin Examination
                                </button>
                              )}
                              {ex.status === 'examining' && (
                                <button type="button" onClick={() => {
                                  setCompleteTarget({ kind: 'exhibit', id: ex.id, label: `Exhibit ${ex.exhibit_number || ex.id}` });
                                  setCompleteResults('');
                                  setCompleteConclusion('');
                                }} className="text-[9px] px-2 py-0.5 bg-green-900/20 text-green-400 border border-green-700/40 rounded-sm hover:bg-green-900/40 transition-colors">
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
                {canManage && (
                  <button type="button" onClick={() => setShowAnalysisModal(true)} className="toolbar-btn toolbar-btn-primary text-[10px]">
                    <Plus size={10} /> New Analysis
                  </button>
                )}
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
                    const anStatus = an.status === 'complete' ? 'var(--sev-ok)' : an.status === 'in_progress' ? 'var(--sev-warn)' : 'var(--text-muted)';
                    const typeLabel = ANALYSIS_TYPES.find(t => t.value === an.analysis_type)?.label || an.analysis_type;
                    return (
                      <div key={an.id} className="panel-beveled bg-surface-sunken p-3 border-l-[3px]" style={{ borderLeftColor: anStatus }}>
                        <div className="flex items-center gap-2 mb-1">
                          <Beaker size={12} style={{ color: anStatus }} />
                          <span className="text-xs font-semibold text-rmpg-200">{typeLabel}</span>
                          <span className="text-[9px] font-bold uppercase ml-auto" style={{ color: anStatus }}>{toDisplayLabel(an.status || '')}</span>
                        </div>
                        {an.examiner_name && <div className="text-[10px] text-rmpg-400">Examiner: {an.examiner_name}</div>}
                        {an.methodology && <div className="text-[10px] text-rmpg-400 mt-1">Method: {an.methodology}</div>}
                        {an.results && (
                          <div className="mt-2 p-2 bg-surface-base rounded-sm text-[10px] text-rmpg-200 border border-rmpg-700">
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
                            <button type="button" onClick={() => handleAnalysisStatusChange(an.id, 'in_progress')} className="text-[9px] px-2 py-0.5 bg-amber-900/20 text-amber-400 border border-amber-700/40 rounded-sm hover:bg-amber-900/40 transition-colors">
                              Start Analysis
                            </button>
                          )}
                          {an.status === 'in_progress' && (
                            <button type="button" onClick={() => {
                              const typeLabel = ANALYSIS_TYPES.find(t => t.value === an.analysis_type)?.label || an.analysis_type;
                              setCompleteTarget({ kind: 'analysis', id: an.id, label: typeLabel });
                              setCompleteResults('');
                              setCompleteConclusion('');
                            }} className="text-[9px] px-2 py-0.5 bg-green-900/20 text-green-400 border border-green-700/40 rounded-sm hover:bg-green-900/40 transition-colors">
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
                  <input id="ff-forensiclabpage-14"
                    type="text"
                    value={timelineNote}
                    onChange={e => setTimelineNote(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTimelineNote()}
                    className="flex-1 px-3 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                    placeholder="Add a note, observation, or update..."
                  />
                  <button type="button"
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
                      <tr className="border-b border-rmpg-700">
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

          {/* QC Tab */}
          {detailTab === 'qc' && selectedCase && (
            <div className="space-y-3">
              <div className="panel-beveled bg-surface-sunken p-3">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">Record QC Check</div>
                <div className="space-y-2">
                  <select id="ff-forensiclabpage-15" value={qcForm.check_type} onChange={e => setQcForm(f => ({ ...f, check_type: e.target.value }))}
                    className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100">
                    <option value="peer_review">Peer Review</option>
                    <option value="admin_review">Admin Review</option>
                    <option value="technical_review">Technical Review</option>
                    <option value="calibration_check">Calibration Check</option>
                    <option value="blank_check">Blank Check</option>
                    <option value="positive_control">Positive Control</option>
                    <option value="negative_control">Negative Control</option>
                  </select>
                  <RichTextArea value={qcForm.reviewer_notes} onChange={e => setQcForm(f => ({ ...f, reviewer_notes: e.target.value }))}
                    className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 h-16 resize-none"
                    placeholder="Reviewer notes..." />
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-green-400 cursor-pointer">
                      <input id="ff-forensiclabpage-16" type="radio" checked={qcForm.pass} onChange={() => setQcForm(f => ({ ...f, pass: true }))} className="accent-green-400" /> Pass
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-red-400 cursor-pointer">
                      <input id="ff-forensiclabpage-17" type="radio" checked={!qcForm.pass} onChange={() => setQcForm(f => ({ ...f, pass: false }))} className="accent-red-400" /> Fail
                    </label>
                  </div>
                  {canManage && (
                    <button type="button" onClick={handleQcSubmit} disabled={qcSubmitting}
                      className="btn-primary w-full flex items-center justify-center gap-2 text-xs">
                      {qcSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
                      Record QC Check
                    </button>
                  )}
                </div>
              </div>
              {/* QC History */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">QC History</span>
                  <button type="button" onClick={() => fetchQcHistory(selectedCase.id)} className="text-[10px] text-brand-400 hover:text-brand-300">Refresh</button>
                </div>
                {qcLoading ? <div className="text-center py-4"><Loader2 size={16} className="animate-spin text-brand-400 mx-auto" /></div> : (
                  qcHistory.length === 0 ? <div className="text-xs text-rmpg-500 text-center py-4">No QC checks recorded</div> : (
                    <div className="space-y-1">
                      {qcHistory.map((qc: any, i: number) => (
                        <div key={i} className="panel-beveled p-2 text-[10px]">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold ${qc.pass ? 'text-green-400' : 'text-red-400'}`}>
                              {qc.pass ? 'PASS' : 'FAIL'}
                            </span>
                            <span className="text-rmpg-400">{toDisplayLabel(qc.check_type)}</span>
                          </div>
                          <div className="text-rmpg-500 mt-0.5">{qc.reviewer_name} — {qc.created_at}</div>
                          {qc.reviewer_notes && <div className="text-rmpg-300 mt-0.5 line-clamp-2">{qc.reviewer_notes}</div>}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* Turnaround/Timing Tab */}
          {detailTab === 'turnaround' && selectedCase && (
            <div className="space-y-3">
              <button type="button" onClick={fetchTurnaroundData} className="btn-primary text-xs flex items-center gap-2">
                <Clock size={12} /> Load Turnaround Data
              </button>
              {turnaroundLoading ? <div className="text-center py-4"><Loader2 size={16} className="animate-spin text-brand-400 mx-auto" /></div> : turnaroundData && (
                <div className="space-y-3">
                  {turnaroundData.by_type?.length > 0 && (
                    <div>
                      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">By Case Type</div>
                      {turnaroundData.by_type.map((t: any) => (
                        <div key={t.case_type} className="panel-beveled p-2 mb-1 flex items-center justify-between">
                          <span className="text-xs text-rmpg-200">{humanizeCaseType(t.case_type)}</span>
                          <span className="text-xs font-mono text-brand-400">{t.avg_days}d avg ({t.cases_completed} cases)</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {turnaroundData.overdue_cases?.length > 0 && (
                    <div>
                      <div className="text-[9px] text-red-400 uppercase font-bold tracking-wider mb-1">Overdue Cases ({turnaroundData.overdue_cases.length})</div>
                      {turnaroundData.overdue_cases.slice(0, 5).map((c: any) => (
                        <div key={c.id} className="panel-beveled p-2 mb-1 border-l-2 border-red-500">
                          <div className="text-xs text-rmpg-100">{c.lab_number} — {c.title}</div>
                          <div className="text-[10px] text-red-400">{c.days_overdue} days overdue (Due: {c.due_date})</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {turnaroundData.analysis_turnaround?.length > 0 && (
                    <div>
                      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Analysis Turnaround</div>
                      {turnaroundData.analysis_turnaround.map((a: any) => (
                        <div key={a.analysis_type} className="flex justify-between text-[10px] py-0.5">
                          <span className="text-rmpg-300">{formatEnumValue(a.analysis_type)}</span>
                          <span className="text-rmpg-400 font-mono">{a.avg_days}d avg ({a.completed})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Backlog Section */}
              <div className="border-t border-rmpg-700 pt-3">
                <button type="button" onClick={() => { setShowBacklogReport(!showBacklogReport); if (!backlogData) fetchBacklogData(); }}
                  className="text-[10px] text-rmpg-400 uppercase tracking-wider font-bold hover:text-rmpg-100">
                  {showBacklogReport ? '▾' : '▸'} Backlog Report
                </button>
                {showBacklogReport && (
                  backlogLoading ? <div className="text-center py-4"><Loader2 size={16} className="animate-spin text-brand-400 mx-auto" /></div> : backlogData && (
                    <div className="space-y-2 mt-2">
                      <div className="panel-beveled p-2">
                        <div className="text-sm font-bold text-rmpg-100">{backlogData.total_backlog}</div>
                        <div className="text-[9px] text-rmpg-500">Total Active Cases | {backlogData.unassigned_cases} Unassigned | {backlogData.pending_analyses} Pending Analyses</div>
                      </div>
                      {backlogData.backlog_by_examiner?.map((e: any) => (
                        <div key={e.examiner} className="flex justify-between text-[10px] py-0.5">
                          <span className="text-rmpg-300">{e.examiner || 'Unassigned'}</span>
                          <span className="text-rmpg-400 font-mono">{e.active_cases} cases ({e.avg_age_days}d avg)</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* Links Tab */}
          {detailTab === 'links' && (
            <>
              {/* Link Search */}
              <div className="panel-beveled bg-surface-sunken p-3">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">Link Entity to Case</div>
                <div className="p-2 bg-surface-sunken/10 border border-border-subtle/30 rounded-sm text-[10px] text-rmpg-300 mb-2">
                  <Info size={10} className="inline mr-1" />
                  Search for persons, incidents, evidence, or cases to link to this forensic case.
                </div>
                <div className="flex gap-2">
                  <input id="ff-forensiclabpage-18"
                    type="text"
                    value={linkSearchTerm}
                    onChange={e => setLinkSearchTerm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLinkSearch()}
                    className="flex-1 px-3 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                    placeholder="Search by name, case number, evidence ID..." aria-label="Search by name, case number, evidence ID..."
                  />
                  <button type="button" onClick={handleLinkSearch} disabled={linkSearching || !linkSearchTerm.trim()} className="toolbar-btn toolbar-btn-primary text-[10px] px-3 disabled:opacity-40">
                    {linkSearching ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />} Search
                  </button>
                </div>
                {linkSearchResults.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-[200px] overflow-y-auto">
                    {linkSearchResults.map((r: any, i: number) => (
                      <div key={`${r.type}-${r.id}-${i}`} className="flex items-center gap-2 p-2 bg-surface-base rounded-sm border border-rmpg-700 hover:border-brand-500/50 transition-colors">
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm bg-brand-900/20 text-brand-400">{toDisplayLabel(String(r.type))}</span>
                        <span className="text-xs text-rmpg-200 min-w-0 flex-1 truncate">{r.label || r.name || r.title || `#${r.id}`}</span>
                        <button type="button" onClick={() => handleLinkEntity(r.type, r.id)} className="text-[9px] px-2 py-0.5 bg-green-900/20 text-green-400 border border-green-700/40 rounded-sm hover:bg-green-900/40 transition-colors">
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
                    <div key={link.id} className="flex items-center gap-2 p-2 panel-beveled bg-surface-sunken"
                      onContextMenu={(e) => openMenu(e, [
                        m.copy('Copy label', link.entity_label || `${link.entity_type} #${link.entity_id}`),
                        m.copyId(link.entity_id),
                        m.separator(),
                        m.action('Unlink entity', () => handleUnlinkEntity(link.id), { icon: <Unlink size={12} />, danger: true }),
                      ])}
                    >
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm bg-purple-900/20 text-purple-400">{toDisplayLabel(link.entity_type)}</span>
                      <span className="text-xs text-rmpg-200 flex-1">{link.entity_label || `${link.entity_type} #${link.entity_id}`}</span>
                      <span className="text-[9px] text-rmpg-500">{link.relationship}</span>
                      <IconButton onClick={() => handleUnlinkEntity(link.id)} className="text-rmpg-500 hover:text-red-400 transition-colors" title="Remove link" aria-label="Remove link">
                        <Unlink size={12} />
                      </IconButton>
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
                <label htmlFor="ff-forensiclabpage-19" className="block text-[11px] text-rmpg-400 mb-1">Analysis Type</label>
                <select id="ff-forensiclabpage-19"
                  value={analysisForm.analysis_type}
                  onChange={e => setAnalysisForm(f => ({ ...f, analysis_type: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                >
                  {ANALYSIS_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Methodology</label>
                <RichTextArea
                  value={analysisForm.methodology}
                  onChange={e => setAnalysisForm(f => ({ ...f, methodology: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-20"
                  placeholder="Describe the examination method..."
                />
              </div>
              <div>
                <label htmlFor="ff-forensiclabpage-20" className="block text-[11px] text-rmpg-400 mb-1">Equipment Used</label>
                <input id="ff-forensiclabpage-20"
                  type="text"
                  value={analysisForm.equipment_used}
                  onChange={e => setAnalysisForm(f => ({ ...f, equipment_used: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                  placeholder="e.g. Cellebrite UFED, FTK Imager, GC-MS"
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Notes</label>
                <RichTextArea
                  value={analysisForm.notes}
                  onChange={e => setAnalysisForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-16"
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
              <div className="p-2 bg-surface-sunken/10 border border-border-subtle/30 rounded-sm text-[10px] text-rmpg-300">
                <Info size={10} className="inline mr-1" />
                Each exhibit is auto-assigned a letter (A, B, C...) for chain of custody tracking.
              </div>
              <div>
                <label htmlFor="ff-forensiclabpage-21" className="block text-[11px] text-rmpg-400 mb-1">Description <span className="text-red-400">*</span></label>
                <input id="ff-forensiclabpage-21"
                  type="text"
                  value={exhibitForm.description}
                  onChange={e => setExhibitForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                  placeholder="e.g. Samsung Galaxy S24 — black, screen cracked"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-forensiclabpage-22" className="block text-[11px] text-rmpg-400 mb-1">Item Type</label>
                  <input id="ff-forensiclabpage-22"
                    type="text"
                    value={exhibitForm.exhibit_type}
                    onChange={e => setExhibitForm(f => ({ ...f, exhibit_type: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                    placeholder="e.g. Cell phone"
                  />
                </div>
                <div>
                  <label htmlFor="ff-forensiclabpage-23" className="block text-[11px] text-rmpg-400 mb-1">Condition</label>
                  <input id="ff-forensiclabpage-23"
                    type="text"
                    value={exhibitForm.condition_received}
                    onChange={e => setExhibitForm(f => ({ ...f, condition_received: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                    placeholder="e.g. Good, sealed bag"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ff-forensiclabpage-24" className="block text-[11px] text-rmpg-400 mb-1">Examination Requested</label>
                <select id="ff-forensiclabpage-24"
                  value={exhibitForm.examination_requested}
                  onChange={e => setExhibitForm(f => ({ ...f, examination_requested: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
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
                <RichTextArea
                  value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-20"
                  placeholder="Case synopsis..."
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">Findings</label>
                <RichTextArea
                  value={editForm.findings}
                  onChange={e => setEditForm(f => ({ ...f, findings: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-20"
                  placeholder="Examination findings..."
                />
              </div>
              <div>
                <label htmlFor="ff-forensiclabpage-31" className="block text-[11px] text-rmpg-400 mb-1">Conclusion</label>
                <RichTextArea
                  value={editForm.conclusion}
                  onChange={e => setEditForm(f => ({ ...f, conclusion: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-20"
                  placeholder="Final conclusion..."
                />
              </div>
              <div>
                <label htmlFor="ff-forensiclabpage-25" className="block text-[11px] text-rmpg-400 mb-1">Due Date</label>
                <input id="ff-forensiclabpage-25"
                  type="date"
                  value={editForm.due_date}
                  onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="ff-forensiclabpage-30" className="block text-[11px] text-rmpg-400 mb-1">Notes</label>
                <RichTextArea
                  value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-16"
                  placeholder="Internal notes..."
                />
              </div>
            </div>
          </FormModal>
        )}

        {/* Custody Transfer Modal */}
        {showCustodyModal && (
          <FormModal
            isOpen={showCustodyModal}
            onClose={() => setShowCustodyModal(false)}
            onSubmit={handleAddCustodyEntry}
            title="Log Chain of Custody Transfer"
            icon={ArrowDownUp}
            submitLabel="Log Transfer"
            maxWidth="max-w-md"
            isDirty={custodyForm.from_person.trim().length > 0 || custodyForm.to_person.trim().length > 0}
          >
            <div className="space-y-3">
              <div className="p-2 bg-surface-sunken/10 border border-border-subtle/30 rounded-sm text-[10px] text-rmpg-300">
                <Info size={10} className="inline mr-1" />
                Record every transfer of evidence to maintain a complete chain of custody.
              </div>
              <div>
                <label htmlFor="ff-forensiclabpage-26" className="block text-[11px] text-rmpg-400 mb-1">Action</label>
                <select id="ff-forensiclabpage-26"
                  value={custodyForm.action}
                  onChange={e => setCustodyForm(f => ({ ...f, action: e.target.value as CustodyEvent['action'] }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                >
                  <option value="received">Received</option>
                  <option value="transferred">Transferred</option>
                  <option value="stored">Stored</option>
                  <option value="analyzed">Analyzed</option>
                  <option value="returned">Returned</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-forensiclabpage-27" className="block text-[11px] text-rmpg-400 mb-1">From <span className="text-red-400">*</span></label>
                  <input id="ff-forensiclabpage-27"
                    type="text"
                    value={custodyForm.from_person}
                    onChange={e => setCustodyForm(f => ({ ...f, from_person: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                    placeholder="Person releasing"
                  />
                </div>
                <div>
                  <label htmlFor="ff-forensiclabpage-28" className="block text-[11px] text-rmpg-400 mb-1">To <span className="text-red-400">*</span></label>
                  <input id="ff-forensiclabpage-28"
                    type="text"
                    value={custodyForm.to_person}
                    onChange={e => setCustodyForm(f => ({ ...f, to_person: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                    placeholder="Person receiving"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ff-forensiclabpage-29" className="block text-[11px] text-rmpg-400 mb-1">Notes</label>
                <RichTextArea
                  value={custodyForm.notes}
                  onChange={e => setCustodyForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-16"
                  placeholder="Additional details about this transfer..."
                />
              </div>
            </div>
          </FormModal>
        )}

        {/* Cancel-case confirmation — admin/manager only (canDelete gate).
            ConfirmDialog enforces in-theme rendering; Esc + click-outside
            cancel; busy-state while the PUT request is in flight. */}
        <ConfirmDialog
          isOpen={confirmCloseCase}
          onClose={() => setConfirmCloseCase(false)}
          onConfirm={handleConfirmCloseCase}
          title="Cancel forensic case"
          message={`Cancel case "${selectedCase.lab_number || selectedCase.lab_case_number || `FC-${selectedCase.id}`}"? The case will be marked cancelled and removed from the active queue. All exhibits, analyses, and timeline entries are preserved.`}
          confirmLabel="Cancel Case"
          confirmVariant="danger"
          isLoading={closeCaseBusy}
        />

        {/* Unlink-entity confirmation — replaces the legacy window.confirm.
            ConfirmDialog enforces in-theme rendering, Esc + click-outside
            cancel, busy-state on Confirm, and the kind of identifying
            context (which entity is being unlinked) that a chain-of-custody
            surface owes the operator. */}
        <ConfirmDialog
          isOpen={confirmUnlinkId != null}
          onClose={() => setConfirmUnlinkId(null)}
          onConfirm={confirmUnlinkEntity}
          title="Remove linked entity"
          message="The link will be deleted from this forensic case. The underlying entity (person / vehicle / case) is not affected."
          confirmLabel="Remove link"
          confirmVariant="danger"
          isLoading={unlinkBusy}
        />

        {/* Mark-complete modal — replaces the two window.prompt() calls
            that previously captured court-record results as single-line
            text. Required Results + optional Conclusion field, both
            multi-line so an examiner can paste a paragraph. The
            Conclusion field is hidden for exhibits (analyses only). */}
        {completeTarget && (
          <FormModal
            isOpen={completeTarget != null}
            onClose={() => { setCompleteTarget(null); setCompleteResults(''); setCompleteConclusion(''); }}
            onSubmit={submitComplete}
            title={`Mark ${completeTarget.label} complete`}
            icon={CheckCircle}
            submitLabel={completeBusy ? 'Saving…' : 'Mark Complete'}
            maxWidth="max-w-lg"
            isDirty={completeResults.trim().length > 0 || completeConclusion.trim().length > 0}
          >
            <div className="space-y-3">
              <div className="p-2 bg-surface-sunken/10 border border-border-subtle/30 rounded-sm text-[10px] text-rmpg-300">
                <Info size={10} className="inline mr-1" />
                Results entered here are part of the court record for this case. Be specific —
                include methodology, observations, and any deviation from the documented protocol.
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">
                  Results <span className="text-red-400">*</span>
                </label>
                <RichTextArea
                  value={completeResults}
                  onChange={(e) => setCompleteResults(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-28"
                  placeholder="Examination results, observations, measurements…"
                />
              </div>
              {completeTarget.kind === 'analysis' && (
                <div>
                  <label className="block text-[11px] text-rmpg-400 mb-1">Conclusion (optional)</label>
                  <RichTextArea
                    value={completeConclusion}
                    onChange={(e) => setCompleteConclusion(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-20"
                    placeholder="Investigative conclusion based on the results above…"
                  />
                </div>
              )}
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
      {/* Error Banner */}
      {fetchError && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" /> {fetchError}
          <IconButton onClick={() => setFetchError('')} className="ml-auto text-red-400 hover:text-red-300" aria-label="Dismiss error"><X className="w-3 h-3" /></IconButton>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700 bg-surface-sunken flex-wrap">
        <div className="flex items-center gap-1.5">
          <Microscope size={16} className="text-brand-400" />
          {!isMobile && <span className="text-sm font-semibold text-rmpg-100">Forensic Lab</span>}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <ExportButton exportUrl="/api/forensic-lab/export/csv" exportFilename="forensic-cases.csv" />
          <button type="button"
            onClick={() => navigate('/connections')}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-400 bg-purple-900/20 hover:bg-purple-900/40 border border-purple-700/40 rounded-sm transition-colors"
            title="Connection Analysis Graph"
          >
            <Network size={12} />
            {!isMobile && 'Connections'}
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className={`grid ${isMobile ? 'grid-cols-3 gap-1 px-2 py-1.5' : 'grid-cols-6 gap-2 px-3 py-2'} border-b border-rmpg-700 bg-surface-sunken/50`}>
          <div className="text-center">
            <div className="text-sm font-bold font-mono text-brand-400">{stats.total}</div>
            <div className="text-[8px] text-rmpg-500 uppercase">Total</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold font-mono text-amber-400">{stats.by_status?.in_progress || 0}</div>
            <div className="text-[8px] text-rmpg-500 uppercase">Active</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold font-mono text-rmpg-400">{stats.by_status?.submitted || 0}</div>
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

      {/* Examiner Workload Summary */}
      {stats && !isMobile && (
        <div className="px-3 py-2 border-b border-rmpg-700 bg-surface-sunken/30">
          <div className="flex items-center gap-4 text-[10px]">
            <span className="text-rmpg-400 font-bold uppercase tracking-wider">Workload</span>
            <div className="flex items-center gap-1">
              <span className="text-rmpg-500">Cases/Examiner:</span>
              <span className="text-rmpg-100 font-bold font-mono">{stats.total > 0 ? Math.ceil(stats.total / Math.max(1, Object.keys(stats.by_type || {}).length || 1)) : 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-rmpg-500">Queue Depth:</span>
              <span className="text-amber-400 font-bold font-mono">{(stats.by_status?.submitted || 0) + (stats.by_status?.intake || 0)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-rmpg-500">Avg Turnaround:</span>
              <span className="text-rmpg-400 font-bold font-mono">{stats.overdue > 0 ? 'Behind schedule' : 'On track'}</span>
            </div>
            {stats.overdue > 0 && (
              <div className="flex items-center gap-1 ml-auto">
                <AlertTriangle size={10} className="text-red-400" />
                <span className="text-red-400 font-bold">{stats.overdue} overdue</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex items-center border-b border-rmpg-700 bg-surface-sunken">
        {TABS.filter(tab => tab !== 'New Case' || canManage).map(tab => {
          const Icon = tab === 'New Case' ? Plus : tab === 'My Cases' ? FileText : Search;
          return (
            <button type="button"
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === tab
                  ? 'text-rmpg-100 border-brand-500'
                  : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-700'
              }`}
            >
              <Icon size={14} />
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* ── My Cases / All Cases ─────────────────────────── */}
        {(activeTab === 'My Cases' || activeTab === 'All Cases') && (
          <div className="p-3 space-y-3">
            {/* Search + Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-rmpg-500" />
                <input id="ff-forensiclabpage-29"
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search cases by number, title, officer..." aria-label="Search cases by number, title, officer..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                />
              </div>
              <button type="button"
                onClick={() => setShowFilters(!showFilters)}
                className={`toolbar-btn text-[10px] ${showFilters ? 'text-brand-400' : ''}`}
              >
                <Filter size={12} /> Filters
              </button>
            </div>

            {showFilters && (
              <div className="flex items-center gap-2 flex-wrap">
                <select id="ff-forensiclabpage-30" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="px-2 py-1 text-[10px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                  aria-label="Filter by case status">
                  <option value="">All Statuses</option>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <select id="ff-forensiclabpage-31" value={filterType} onChange={e => setFilterType(e.target.value)}
                  className="px-2 py-1 text-[10px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                  aria-label="Filter by case type">
                  <option value="">All Types</option>
                  {CASE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {(filterStatus || filterType) && (
                  <button type="button" onClick={() => { setFilterStatus(''); setFilterType(''); }} className="text-[10px] text-red-400 hover:underline">Clear</button>
                )}
              </div>
            )}

            {/* Case List */}
            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="panel-beveled bg-surface-sunken p-3 border-l-[3px] border-border-default">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-24 bg-surface-raised animate-pulse rounded" />
                          <div className="h-3 w-16 bg-surface-raised animate-pulse rounded" />
                          <div className="h-3 w-14 bg-surface-raised animate-pulse rounded" />
                        </div>
                        <div className="h-3.5 w-48 bg-surface-raised animate-pulse rounded" />
                        <div className="flex items-center gap-3">
                          <div className="h-2.5 w-20 bg-surface-raised animate-pulse rounded" />
                          <div className="h-2.5 w-28 bg-surface-raised animate-pulse rounded" />
                        </div>
                      </div>
                      <div className="h-5 w-5 bg-surface-raised animate-pulse rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : cases.length === 0 ? (
              // Empty-state distinction — "no rows in the DB" is a different
              // operator condition from "your filter selected an impossible
              // slice". The prior copy was identical for both and offered no
              // recovery from a too-narrow filter; the "Clear filters" path
              // is the same audit fix v1024+ pages apply.
              (() => {
                const hasActiveFilters = !!(searchTerm || filterStatus || filterType);
                if (hasActiveFilters) {
                  return (
                    <div className="panel-beveled bg-surface-sunken p-8 text-center">
                      <Filter size={32} className="text-rmpg-600 mx-auto mb-3" />
                      <p className="text-sm text-rmpg-300">No cases match the active filters</p>
                      <p className="text-xs text-rmpg-500 mt-1">
                        {[
                          searchTerm && `search "${searchTerm}"`,
                          filterStatus && `status=${getStatusConfig(filterStatus).label}`,
                          filterType && `type=${getCaseTypeLabel(filterType)}`,
                        ].filter(Boolean).join(', ')}
                      </p>
                      <button type="button"
                        onClick={() => { setSearchTerm(''); setFilterStatus(''); setFilterType(''); }}
                        className="mt-3 toolbar-btn text-xs"
                      >
                        <X size={12} /> Clear all filters
                      </button>
                    </div>
                  );
                }
                return (
                  <div className="panel-beveled bg-surface-sunken p-8 text-center">
                    <Microscope size={32} className="text-rmpg-600 mx-auto mb-3" />
                    <p className="text-sm text-rmpg-300">No forensic cases yet</p>
                    <p className="text-xs text-rmpg-500 mt-1">Create a new case using the "New Case" tab above (or press N).</p>
                    <button type="button" onClick={() => setActiveTab('New Case')} className="mt-3 toolbar-btn toolbar-btn-primary text-xs">
                      <Plus size={12} /> Create First Case
                    </button>
                  </div>
                );
              })()
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
                      onContextMenu={(e) => openMenu(e, buildCaseMenu(c))}
                      className="panel-beveled bg-surface-sunken p-3 cursor-pointer hover:bg-surface-raised transition-colors border-l-[3px] group"
                      style={{ borderLeftColor: sc.color }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono text-brand-400">{c.lab_number || c.lab_case_number || `FC-${c.id}`}</span>
                            <span className="text-[9px] px-1.5 py-0.5 font-bold border" style={{ backgroundColor: withAlpha(sc.color, '15'), color: sc.color, borderColor: withAlpha(sc.color, '40') }}>{sc.label}</span>
                            <span className="text-[9px] px-1.5 py-0.5 font-bold border" style={{ backgroundColor: withAlpha(pc.color, '15'), color: pc.color, borderColor: withAlpha(pc.color, '40') }}>{pc.label}</span>
                            {overdue && <span className="text-[8px] px-1 py-0.5 bg-red-900/30 text-red-400 font-bold border border-red-700/50 animate-pulse">OVERDUE</span>}
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
                            <span className="text-[9px] font-mono tabular-nums">{c.exhibit_count} exhibits</span>
                          )}
                          <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" />
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
                  <button type="button"
                    onClick={() => i <= wizardStep && setWizardStep(i)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wide transition-colors ${
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
                  <h3 className="text-sm font-bold text-rmpg-100">Case Information</h3>
                </div>
                <div className="p-2 bg-surface-sunken/10 border border-border-subtle/30 rounded-sm text-[10px] text-rmpg-300">
                  <Info size={10} className="inline mr-1" />
                  Start by describing the case. A lab case number will be auto-generated (e.g. FL-2026-0001).
                  Choose the type of forensic examination needed and the priority level.
                </div>

                <div>
                  <label htmlFor="ff-forensiclabpage-32" className="block text-[11px] text-rmpg-400 mb-1">Case Title <span className="text-red-400">*</span></label>
                  <input id="ff-forensiclabpage-32"
                    ref={primaryInputRef}
                    type="text"
                    value={wizardData.title}
                    onChange={e => setWizardData(d => ({ ...d, title: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                    placeholder="e.g. Phone extraction — Smith assault case"
                  />
                </div>

                <div>
                  <label htmlFor="ff-forensiclabpage-37" className="block text-[11px] text-rmpg-400 mb-1">Case Type</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {CASE_TYPES.map(ct => {
                      const Icon = ct.icon;
                      return (
                        <button type="button"
                          key={ct.value}
                          onClick={() => setWizardData(d => ({ ...d, case_type: ct.value }))}
                          className={`flex items-start gap-2 p-2.5 rounded-sm border text-left transition-colors ${
                            wizardData.case_type === ct.value
                              ? 'border-brand-500 bg-brand-500/10'
                              : 'border-rmpg-700 bg-surface-sunken hover:border-rmpg-500'
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
                  <label htmlFor="ff-forensiclabpage-36" className="block text-[11px] text-rmpg-400 mb-1">Priority</label>
                  <div className="flex gap-2">
                    {PRIORITIES.map(p => (
                      <button type="button"
                        key={p.value}
                        onClick={() => setWizardData(d => ({ ...d, priority: p.value }))}
                        className={`flex-1 p-2 rounded-sm border text-center transition-colors ${
                          wizardData.priority === p.value
                            ? 'border-current bg-current/10'
                            : 'border-rmpg-700 bg-surface-sunken hover:border-rmpg-500'
                        }`}
                        style={wizardData.priority === p.value ? { borderColor: p.color, color: p.color } : undefined}
                      >
                        <div className="text-[11px] font-bold" style={{ color: wizardData.priority === p.value ? p.color : 'var(--text-muted)' }}>{p.label}</div>
                        <div className="text-[8px] text-rmpg-500">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="ff-forensiclabpage-35" className="block text-[11px] text-rmpg-400 mb-1">Synopsis</label>
                  <RichTextArea
                    value={wizardData.synopsis}
                    onChange={e => setWizardData(d => ({ ...d, synopsis: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none h-24"
                    placeholder="Describe the circumstances and what you need examined..."
                  />
                </div>

                <div>
                  <label htmlFor="ff-forensiclabpage-34" className="block text-[11px] text-rmpg-400 mb-1">Linked Incident (optional)</label>
                  <IncidentPickerInline
                    id="ff-forensiclabpage-33"
                    value={wizardData.incident_id ? Number(wizardData.incident_id) : null}
                    onChange={(id) => setWizardData(d => ({ ...d, incident_id: id ? String(id) : '' }))}
                    placeholder="Search by incident # / type / location…"
                  />
                </div>

                <div className="flex justify-end">
                  <button type="button"
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
                  <h3 className="text-sm font-bold text-rmpg-100">Evidence Intake</h3>
                </div>
                <div className="p-2 bg-surface-sunken/10 border border-border-subtle/30 rounded-sm text-[10px] text-rmpg-300">
                  <Info size={10} className="inline mr-1" />
                  Add each piece of evidence as a separate exhibit. Each will be assigned a letter (A, B, C...).
                  You can skip this step and add exhibits later.
                </div>

                {wizardData.exhibits.map((ex, i) => (
                  <div key={i} className="panel-beveled bg-surface-base p-3 space-y-2 border-l-[3px] border-l-brand-500">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-brand-400">Exhibit {String.fromCharCode(65 + i)}</span>
                      <button type="button"
                        onClick={() => setWizardData(d => ({ ...d, exhibits: d.exhibits.filter((_, j) => j !== i) }))}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <input id="ff-forensiclabpage-34"
                      type="text"
                      value={ex.description}
                      onChange={e => {
                        const exhibits = [...wizardData.exhibits];
                        exhibits[i] = { ...exhibits[i], description: e.target.value };
                        setWizardData(d => ({ ...d, exhibits }));
                      }}
                      className="w-full px-3 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                      placeholder="Description (e.g. iPhone 15 Pro, black case)"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input id="ff-forensiclabpage-35"
                        type="text"
                        value={ex.exhibit_type}
                        onChange={e => {
                          const exhibits = [...wizardData.exhibits];
                          exhibits[i] = { ...exhibits[i], exhibit_type: e.target.value };
                          setWizardData(d => ({ ...d, exhibits }));
                        }}
                        className="px-2 py-1 text-[10px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                        placeholder="Item type"
                      />
                      <input id="ff-forensiclabpage-36"
                        type="text"
                        value={ex.condition_received}
                        onChange={e => {
                          const exhibits = [...wizardData.exhibits];
                          exhibits[i] = { ...exhibits[i], condition_received: e.target.value };
                          setWizardData(d => ({ ...d, exhibits }));
                        }}
                        className="px-2 py-1 text-[10px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                        placeholder="Condition"
                      />
                      <select id="ff-forensiclabpage-37"
                        value={ex.examination_requested}
                        onChange={e => {
                          const exhibits = [...wizardData.exhibits];
                          exhibits[i] = { ...exhibits[i], examination_requested: e.target.value };
                          setWizardData(d => ({ ...d, exhibits }));
                        }}
                        className="px-2 py-1 text-[10px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-100 focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">Exam type...</option>
                        {ANALYSIS_TYPES.map(t => (
                          <option key={t.value} value={t.label}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}

                <button type="button"
                  onClick={() => setWizardData(d => ({
                    ...d,
                    exhibits: [...d.exhibits, { description: '', exhibit_type: '', condition_received: '', examination_requested: '' }],
                  }))}
                  className="toolbar-btn text-xs w-full justify-center py-2"
                >
                  <Plus size={12} /> Add Exhibit
                </button>

                <div className="flex justify-between">
                  <button type="button" onClick={() => setWizardStep(0)} className="toolbar-btn text-xs px-4 py-1.5">
                    <ChevronLeft size={12} /> Back
                  </button>
                  <button type="button" onClick={() => setWizardStep(2)} className="toolbar-btn toolbar-btn-primary text-xs px-4 py-1.5">
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
                  <h3 className="text-sm font-bold text-rmpg-100">Review & Submit</h3>
                </div>
                <div className="p-2 bg-green-900/10 border border-green-800/30 rounded-sm text-[10px] text-green-300">
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
                      <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-300 bg-surface-base p-2 rounded-sm">
                        <span className="font-mono font-bold text-brand-400">{String.fromCharCode(65 + i)}</span>
                        {ex.description || 'No description'}
                        {ex.examination_requested && <span className="text-rmpg-500 ml-auto">{ex.examination_requested}</span>}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-between">
                  <button type="button" onClick={() => setWizardStep(1)} className="toolbar-btn text-xs px-4 py-1.5">
                    <ChevronLeft size={12} /> Back
                  </button>
                  <button type="button"
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
