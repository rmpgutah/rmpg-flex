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
  HardDrive, Download, Globe, Database, Wifi, WifiOff, RefreshCw,
  FileSearch, Tag, BookMarked, Calendar, Server, BookOpen, ChevronUp, Copy,
} from 'lucide-react';
import type {
  ForensicCase, ForensicExhibit, ForensicAnalysis, ForensicActivityLog,
  ForensicCaseStatus, ForensicCaseType, ForensicPriority,
  ExhibitType, AnalysisType, AnalysisStatus, ExhibitDisposition,
  IpedCase, IpedItem, IpedFinding, IpedImport, IpedConnectionStatus,
  IpedBookmark, IpedTimelineEvent,
  ForensicHashSet, HashSetType,
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
  const [detailTab, setDetailTab] = useState<'exhibits' | 'analyses' | 'timeline' | 'iped' | 'hashsets'>('exhibits');

  // ── IPED Integration state ────────────────────────────
  const [ipedStatus, setIpedStatus] = useState<IpedConnectionStatus | null>(null);
  const [ipedCases, setIpedCases] = useState<IpedCase[]>([]);
  const [ipedSelectedCase, setIpedSelectedCase] = useState<IpedCase | null>(null);
  const [ipedSearchQuery, setIpedSearchQuery] = useState('');
  const [ipedSearchResults, setIpedSearchResults] = useState<IpedItem[]>([]);
  const [ipedSearchTotal, setIpedSearchTotal] = useState(0);
  const [ipedBookmarks, setIpedBookmarks] = useState<IpedBookmark[]>([]);
  const [ipedFindings, setIpedFindings] = useState<IpedFinding[]>([]);
  const [ipedImports, setIpedImports] = useState<IpedImport[]>([]);
  const [ipedLoading, setIpedLoading] = useState(false);
  const [ipedImporting, setIpedImporting] = useState(false);
  const [ipedSubTab, setIpedSubTab] = useState<'browse' | 'findings' | 'bookmarks' | 'imports'>('browse');
  // IPED setup form
  const [ipedSetupOpen, setIpedSetupOpen] = useState(false);
  const [ipedSetupForm, setIpedSetupForm] = useState({ baseUrl: '', apiKey: '' });
  const [ipedSetupSubmitting, setIpedSetupSubmitting] = useState(false);
  const [ipedGuideOpen, setIpedGuideOpen] = useState(false);

  // ── Hash Sets state ─────────────────────────────────────
  const [hashSets, setHashSets] = useState<ForensicHashSet[]>([]);
  const [hashSetsLoading, setHashSetsLoading] = useState(false);
  const [hashImportOpen, setHashImportOpen] = useState(false);
  const [hashImportForm, setHashImportForm] = useState({ name: '', set_type: 'custom' as HashSetType, description: '', version: '' });
  const [hashImportFile, setHashImportFile] = useState<File | null>(null);
  const [hashImporting, setHashImporting] = useState(false);
  const [hashCheckInput, setHashCheckInput] = useState('');
  const [hashCheckResults, setHashCheckResults] = useState<Record<string, any[]> | null>(null);
  const [hashChecking, setHashChecking] = useState(false);
  // Quick-check overlay (accessible from any tab via status bar)
  const [quickCheckOpen, setQuickCheckOpen] = useState(false);
  // Drag-and-drop state
  const [hashDropActive, setHashDropActive] = useState(false);
  const [hashFilePreviewCount, setHashFilePreviewCount] = useState<number | null>(null);
  // Auto-check exhibit hashes against loaded sets
  const [exhibitHashMatches, setExhibitHashMatches] = useState<Record<number, { status: 'known_good' | 'known_bad' | 'unknown' | 'unchecked'; matches: any[] }>>({});

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

  // ── IPED data fetching ────────────────────────────────

  const fetchIpedStatus = useCallback(async () => {
    try {
      const res = await apiFetch<IpedConnectionStatus>('/iped/status');
      setIpedStatus(res);
    } catch { setIpedStatus(null); }
  }, []);

  const fetchIpedCases = useCallback(async () => {
    setIpedLoading(true);
    try {
      const res = await apiFetch<{ data: IpedCase[] }>('/iped/cases');
      setIpedCases(res.data || []);
    } catch { setIpedCases([]); }
    finally { setIpedLoading(false); }
  }, []);

  const fetchIpedImports = useCallback(async (caseId: number) => {
    try {
      const res = await apiFetch<{ data: IpedImport[] }>(`/iped/imports/${caseId}`);
      setIpedImports(res.data || []);
    } catch { setIpedImports([]); }
  }, []);

  const handleIpedSearch = useCallback(async () => {
    if (!ipedSelectedCase) return;
    setIpedLoading(true);
    try {
      const q = ipedSearchQuery.trim() || '*';
      const res = await apiFetch<{ data: any }>(`/iped/cases/${encodeURIComponent(ipedSelectedCase.id)}/search?q=${encodeURIComponent(q)}&pageSize=100`);
      const items = Array.isArray(res.data?.items || res.data) ? (res.data?.items || res.data) : [];
      setIpedSearchResults(items);
      setIpedSearchTotal(res.data?.totalItems || items.length);
    } catch { setIpedSearchResults([]); setIpedSearchTotal(0); }
    finally { setIpedLoading(false); }
  }, [ipedSelectedCase, ipedSearchQuery]);

  const handleIpedFetchBookmarks = useCallback(async () => {
    if (!ipedSelectedCase) return;
    setIpedLoading(true);
    try {
      const res = await apiFetch<{ data: IpedBookmark[] }>(`/iped/cases/${encodeURIComponent(ipedSelectedCase.id)}/bookmarks`);
      setIpedBookmarks(res.data || []);
    } catch { setIpedBookmarks([]); }
    finally { setIpedLoading(false); }
  }, [ipedSelectedCase]);

  const handleIpedFetchFindings = useCallback(async () => {
    if (!ipedSelectedCase) return;
    setIpedLoading(true);
    try {
      const res = await apiFetch<{ data: IpedFinding[]; total: number }>(`/iped/cases/${encodeURIComponent(ipedSelectedCase.id)}/findings`);
      setIpedFindings(res.data || []);
    } catch { setIpedFindings([]); }
    finally { setIpedLoading(false); }
  }, [ipedSelectedCase]);

  // Fetch IPED status on mount
  useEffect(() => { fetchIpedStatus(); }, [fetchIpedStatus]);

  // Fetch IPED imports when selected case changes
  useEffect(() => {
    if (selected && detailTab === 'iped') fetchIpedImports(selected.id);
  }, [selected, detailTab, fetchIpedImports]);

  // IPED import handlers
  const handleIpedSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipedSetupForm.baseUrl.trim()) { addToast('Base URL is required', 'error'); return; }
    setIpedSetupSubmitting(true);
    try {
      await apiFetch('/iped/credentials', { method: 'PUT', body: JSON.stringify(ipedSetupForm) });
      addToast('IPED connection configured', 'success');
      setIpedSetupOpen(false);
      setIpedSetupForm({ baseUrl: '', apiKey: '' });
      fetchIpedStatus();
    } catch (err: any) { addToast(err?.message || 'Failed to save credentials', 'error'); }
    finally { setIpedSetupSubmitting(false); }
  };

  const handleIpedTestConnection = async () => {
    setIpedLoading(true);
    try {
      const res = await apiFetch<{ connected: boolean; latency: number; caseCount?: number; error?: string }>('/iped/test-connection', { method: 'POST' });
      if (res.connected) {
        addToast(`Connected to IPED (${res.latency}ms, ${res.caseCount} cases)`, 'success');
        fetchIpedCases();
      } else {
        addToast(`Connection failed: ${res.error || 'Unknown error'}`, 'error');
      }
    } catch (err: any) { addToast(err?.message || 'Connection test failed', 'error'); }
    finally { setIpedLoading(false); }
  };

  const handleIpedLinkCase = async (ipedCase: IpedCase) => {
    if (!selected) return;
    setIpedImporting(true);
    try {
      await apiFetch('/iped/import/link', { method: 'POST', body: JSON.stringify({
        forensicCaseId: selected.id, ipedCaseId: ipedCase.id, ipedCaseName: ipedCase.name,
      })});
      addToast(`Linked IPED case: ${ipedCase.name}`, 'success');
      setIpedSelectedCase(ipedCase);
      fetchIpedImports(selected.id);
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Failed to link case', 'error'); }
    finally { setIpedImporting(false); }
  };

  const handleIpedImportFindings = async () => {
    if (!selected || !ipedSelectedCase || ipedFindings.length === 0) return;
    setIpedImporting(true);
    try {
      const targetAnalysis = analyses.find(a => a.analysis_type === 'digital_forensics' && a.status !== 'cancelled');
      await apiFetch('/iped/import/findings', { method: 'POST', body: JSON.stringify({
        forensicCaseId: selected.id,
        ipedCaseId: ipedSelectedCase.id,
        ipedCaseName: ipedSelectedCase.name,
        findings: ipedFindings,
        analysisId: targetAnalysis?.id || null,
        category: 'regex',
      })});
      addToast(`Imported ${ipedFindings.length} findings`, 'success');
      fetchIpedImports(selected.id);
      fetchActivity(selected.id);
      if (targetAnalysis) fetchAnalyses(selected.id);
    } catch (err: any) { addToast(err?.message || 'Import failed', 'error'); }
    finally { setIpedImporting(false); }
  };

  const handleIpedImportTimeline = async () => {
    if (!selected || !ipedSelectedCase) return;
    setIpedImporting(true);
    try {
      const res = await apiFetch<{ data: IpedTimelineEvent[] }>(`/iped/cases/${encodeURIComponent(ipedSelectedCase.id)}/timeline`);
      const events = res.data || [];
      if (events.length === 0) { addToast('No timeline events found', 'warning'); setIpedImporting(false); return; }
      await apiFetch('/iped/import/timeline', { method: 'POST', body: JSON.stringify({
        forensicCaseId: selected.id,
        ipedCaseId: ipedSelectedCase.id,
        ipedCaseName: ipedSelectedCase.name,
        events,
      })});
      addToast(`Imported ${events.length} timeline events`, 'success');
      fetchIpedImports(selected.id);
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Timeline import failed', 'error'); }
    finally { setIpedImporting(false); }
  };

  const handleIpedImportItems = async (items: IpedItem[]) => {
    if (!selected || !ipedSelectedCase || items.length === 0) return;
    setIpedImporting(true);
    try {
      await apiFetch('/iped/import/items', { method: 'POST', body: JSON.stringify({
        forensicCaseId: selected.id,
        ipedCaseId: ipedSelectedCase.id,
        ipedCaseName: ipedSelectedCase.name,
        items,
      })});
      addToast(`Imported ${items.length} items as exhibits`, 'success');
      fetchIpedImports(selected.id);
      fetchExhibits(selected.id);
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Item import failed', 'error'); }
    finally { setIpedImporting(false); }
  };

  const handleIpedAttachReport = async (reportType: 'html' | 'csv') => {
    if (!selected || !ipedSelectedCase) return;
    setIpedImporting(true);
    try {
      await apiFetch('/iped/import/report', { method: 'POST', body: JSON.stringify({
        forensicCaseId: selected.id,
        ipedCaseId: ipedSelectedCase.id,
        ipedCaseName: ipedSelectedCase.name,
        reportName: `IPED ${reportType.toUpperCase()} Report — ${ipedSelectedCase.name}`,
        reportType,
        itemCount: ipedSelectedCase.totalItems || 0,
      })});
      addToast(`Attached ${reportType.toUpperCase()} report reference`, 'success');
      fetchIpedImports(selected.id);
      fetchActivity(selected.id);
    } catch (err: any) { addToast(err?.message || 'Failed to attach report', 'error'); }
    finally { setIpedImporting(false); }
  };

  // ── Hash Set handlers ─────────────────────────────────

  const fetchHashSets = useCallback(async () => {
    setHashSetsLoading(true);
    try {
      const res = await apiFetch<{ data: ForensicHashSet[] }>('/forensics/hash-sets');
      setHashSets(res.data || []);
    } catch { /* silent */ }
    finally { setHashSetsLoading(false); }
  }, []);

  // Fetch hash sets eagerly on page mount (enables status bar + auto-checking)
  useEffect(() => { fetchHashSets(); }, [fetchHashSets]);

  const handleHashImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hashImportForm.name.trim()) { addToast('Name is required', 'error'); return; }
    setHashImporting(true);
    try {
      let entries: any[] = [];
      if (hashImportFile) {
        const text = await hashImportFile.text();
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) { addToast('CSV must have a header row and at least one data row', 'error'); setHashImporting(false); return; }
        const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(',').map(v => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { if (vals[idx]) row[h] = vals[idx]; });
          entries.push({
            md5: row['md5'] || row['md5hash'] || undefined,
            sha1: row['sha1'] || row['sha1hash'] || undefined,
            sha256: row['sha256'] || row['sha256hash'] || undefined,
            file_name: row['filename'] || row['file_name'] || row['name'] || undefined,
            file_size: row['filesize'] || row['file_size'] || row['size'] ? parseInt(row['filesize'] || row['file_size'] || row['size']) : undefined,
            category: row['category'] || row['type'] || undefined,
          });
        }
      }
      await apiFetch('/forensics/hash-sets', {
        method: 'POST',
        body: JSON.stringify({
          name: hashImportForm.name,
          set_type: hashImportForm.set_type,
          description: hashImportForm.description || undefined,
          version: hashImportForm.version || undefined,
          entries,
        }),
      });
      addToast(`Hash set "${hashImportForm.name}" imported (${entries.length} entries)`, 'success');
      setHashImportOpen(false);
      setHashImportForm({ name: '', set_type: 'custom', description: '', version: '' });
      setHashImportFile(null);
      fetchHashSets();
    } catch (err: any) { addToast(err?.message || 'Import failed', 'error'); }
    finally { setHashImporting(false); }
  };

  const handleDeleteHashSet = async (id: number, name: string) => {
    if (!window.confirm(`Delete hash set "${name}" and all its entries?`)) return;
    try {
      await apiFetch(`/forensics/hash-sets/${id}`, { method: 'DELETE' });
      addToast(`Hash set "${name}" deleted`, 'success');
      fetchHashSets();
    } catch (err: any) { addToast(err?.message || 'Delete failed', 'error'); }
  };

  const handleHashCheck = async () => {
    const hashes = hashCheckInput.split(/[\n,\s]+/).map(h => h.trim()).filter(Boolean);
    if (hashes.length === 0) { addToast('Enter at least one hash value', 'error'); return; }
    setHashChecking(true);
    try {
      const res = await apiFetch<{ data: Record<string, any[]>; total_matches: number }>('/forensics/hash-sets/check', {
        method: 'POST',
        body: JSON.stringify({ hashes }),
      });
      setHashCheckResults(res.data);
      if (res.total_matches === 0) addToast('No matches found', 'info');
      else addToast(`${res.total_matches} match(es) found`, 'success');
    } catch (err: any) { addToast(err?.message || 'Hash check failed', 'error'); }
    finally { setHashChecking(false); }
  };

  // ── Auto-check exhibit hashes against loaded sets ──────
  useEffect(() => {
    if (hashSets.length === 0 || exhibits.length === 0) {
      // Mark all exhibits with hashes as unchecked when no sets loaded
      if (hashSets.length === 0 && exhibits.length > 0) {
        const m: typeof exhibitHashMatches = {};
        exhibits.forEach(ex => {
          if (ex.hash_md5 || ex.hash_sha256) m[ex.id] = { status: 'unchecked', matches: [] };
        });
        setExhibitHashMatches(m);
      }
      return;
    }
    // Gather all hashes from exhibits
    const allHashes: string[] = [];
    const exhibitHashMap: Record<string, number[]> = {}; // hash → exhibit ids
    exhibits.forEach(ex => {
      [ex.hash_md5, ex.hash_sha256].filter(Boolean).forEach(h => {
        const lower = h!.toLowerCase();
        allHashes.push(lower);
        if (!exhibitHashMap[lower]) exhibitHashMap[lower] = [];
        exhibitHashMap[lower].push(ex.id);
      });
    });
    if (allHashes.length === 0) return;
    (async () => {
      try {
        const res = await apiFetch<{ data: Record<string, any[]> }>('/forensics/hash-sets/check', {
          method: 'POST',
          body: JSON.stringify({ hashes: [...new Set(allHashes)] }),
        });
        const matches = res.data || {};
        const result: typeof exhibitHashMatches = {};
        exhibits.forEach(ex => {
          if (!ex.hash_md5 && !ex.hash_sha256) return;
          const exHashes = [ex.hash_md5, ex.hash_sha256].filter(Boolean).map(h => h!.toLowerCase());
          const allMatches: any[] = [];
          let hasGood = false, hasBad = false;
          exHashes.forEach(h => {
            const m = matches[h] || [];
            allMatches.push(...m);
            m.forEach((match: any) => {
              if (match.set_type === 'projectvic' || match.set_type === 'known_bad') hasBad = true;
              if (match.set_type === 'nsrl' || match.set_type === 'known_good') hasGood = true;
            });
          });
          result[ex.id] = {
            status: hasBad ? 'known_bad' : hasGood ? 'known_good' : 'unknown',
            matches: allMatches,
          };
        });
        setExhibitHashMatches(result);
      } catch { /* silent */ }
    })();
  }, [exhibits, hashSets]);

  // ── Smart file detection helpers ───────────────────────
  const detectHashSetType = (filename: string): HashSetType => {
    const lower = filename.toLowerCase();
    if (lower.includes('nsrl')) return 'nsrl';
    if (lower.includes('projectvic') || lower.includes('project_vic') || lower.includes('vic')) return 'projectvic';
    if (lower.includes('known_bad') || lower.includes('knownbad') || lower.includes('bad')) return 'known_bad';
    if (lower.includes('known_good') || lower.includes('knowngood') || lower.includes('good')) return 'known_good';
    return 'custom';
  };

  const cleanFileName = (filename: string): string => {
    return filename.replace(/\.(csv|txt|tsv)$/i, '').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const previewCsvRowCount = async (file: File) => {
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      setHashFilePreviewCount(Math.max(0, lines.length - 1)); // subtract header
    } catch { setHashFilePreviewCount(null); }
  };

  // ── Drag-and-drop handler for hash CSV import ──────────
  const handleHashFileDrop = (file: File) => {
    const detected = detectHashSetType(file.name);
    const name = cleanFileName(file.name);
    setHashImportForm(f => ({ ...f, name, set_type: detected }));
    setHashImportFile(file);
    setHashImportOpen(true);
    previewCsvRowCount(file);
    // Switch to hash sets tab so user sees the import form
    setDetailTab('hashsets');
  };

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

        {/* ── Hash Status Bar (always visible) ───────────── */}
        {(() => {
          const totalHashes = hashSets.reduce((sum, hs) => sum + hs.hash_count, 0);
          const nsrlSets = hashSets.filter(h => h.set_type === 'nsrl' || h.set_type === 'known_good');
          const badSets = hashSets.filter(h => h.set_type === 'projectvic' || h.set_type === 'known_bad');
          const customSets = hashSets.filter(h => h.set_type === 'custom');
          const nsrlCount = nsrlSets.reduce((s, h) => s + h.hash_count, 0);
          const badCount = badSets.reduce((s, h) => s + h.hash_count, 0);
          return (
            <div
              className="border-t border-rmpg-700/30 px-3 py-1.5 flex items-center gap-2 text-[9px]"
              style={{ background: hashSets.length === 0 ? 'rgba(217, 119, 6, 0.08)' : 'rgba(10, 14, 20, 0.5)' }}
              onDragOver={e => { e.preventDefault(); setHashDropActive(true); }}
              onDragLeave={() => setHashDropActive(false)}
              onDrop={e => {
                e.preventDefault();
                setHashDropActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file && (file.name.endsWith('.csv') || file.name.endsWith('.txt'))) handleHashFileDrop(file);
              }}
            >
              <Database className="w-3.5 h-3.5 flex-shrink-0" style={{ color: hashSets.length > 0 ? '#22c55e' : '#d97706' }} />
              {hashSets.length === 0 ? (
                <>
                  <span className="text-amber-400 font-bold uppercase">No hash sets loaded</span>
                  <span className="text-rmpg-500">— Drag CSV here or</span>
                  <button
                    onClick={() => { setDetailTab('hashsets'); setHashImportOpen(true); }}
                    className="text-brand-400 hover:text-brand-300 font-bold uppercase underline underline-offset-2"
                  >
                    Import Now
                  </button>
                </>
              ) : (
                <>
                  <span className="text-rmpg-300 font-bold">{hashSets.length} set{hashSets.length !== 1 ? 's' : ''}</span>
                  <span className="text-rmpg-600">|</span>
                  <span className="text-rmpg-400 font-mono">{totalHashes.toLocaleString()} hashes</span>
                  {nsrlSets.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-green-900/20 text-green-400 font-bold rounded-sm">
                      {nsrlCount.toLocaleString()} KNOWN GOOD
                    </span>
                  )}
                  {badSets.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-red-900/20 text-red-400 font-bold rounded-sm">
                      {badCount.toLocaleString()} KNOWN BAD
                    </span>
                  )}
                  {customSets.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-rmpg-700/40 text-rmpg-400 font-bold rounded-sm">
                      {customSets.length} CUSTOM
                    </span>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => setQuickCheckOpen(!quickCheckOpen)}
                    className="toolbar-btn text-[9px] px-2 py-0.5"
                    title="Quick hash check"
                  >
                    <Search className="w-3 h-3" /> Check Hash
                  </button>
                </>
              )}
              {hashDropActive && (
                <div className="absolute inset-0 bg-brand-900/40 border-2 border-dashed border-brand-400 flex items-center justify-center z-10 rounded">
                  <span className="text-brand-300 font-bold text-sm">Drop CSV to import hash set</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Quick-check overlay (opens from status bar) */}
        {quickCheckOpen && (
          <div className="border-t border-rmpg-700/30 px-3 py-2" style={{ background: 'rgba(10, 14, 20, 0.6)' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <Search className="w-3 h-3 text-rmpg-400" />
              <span className="text-[9px] text-rmpg-400 font-bold uppercase">Quick Hash Check</span>
              <div className="flex-1" />
              <button onClick={() => setQuickCheckOpen(false)} className="text-rmpg-500 hover:text-rmpg-300">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex gap-1.5">
              <textarea
                className="input-dark flex-1 text-xs font-mono resize-none"
                rows={2}
                placeholder="Paste MD5, SHA1, or SHA256 hash(es) — one per line or comma-separated"
                value={hashCheckInput}
                onChange={e => setHashCheckInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleHashCheck(); }}
              />
              <div className="flex flex-col gap-1">
                <button
                  onClick={handleHashCheck}
                  className="toolbar-btn toolbar-btn-primary text-[9px] px-3 py-1"
                  disabled={hashChecking || !hashCheckInput.trim()}
                >
                  {hashChecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Check
                </button>
                {hashCheckInput.trim() && (
                  <span className="text-[8px] text-rmpg-500 text-center">
                    {hashCheckInput.split(/[\n,\s]+/).filter(Boolean).length} hash(es)
                  </span>
                )}
              </div>
            </div>
            {hashCheckResults && (
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {Object.keys(hashCheckResults).length === 0 ? (
                  <div className="panel-inset p-2 text-center">
                    <span className="text-[10px] text-green-400 font-semibold flex items-center justify-center gap-1">
                      <CheckCircle className="w-3 h-3" /> No matches — hash is not in any loaded set
                    </span>
                  </div>
                ) : (
                  Object.entries(hashCheckResults).map(([hash, matches]) => (
                    <div key={hash} className="panel-inset p-2">
                      <p className="text-[9px] font-mono text-white mb-1 truncate">{hash}</p>
                      {matches.map((m: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-[9px]">
                          <span className="font-bold uppercase px-1 py-0.5 rounded-sm" style={{
                            background: m.set_type === 'nsrl' || m.set_type === 'known_good' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: m.set_type === 'nsrl' || m.set_type === 'known_good' ? '#22c55e' : '#ef4444',
                          }}>
                            {m.set_type === 'nsrl' || m.set_type === 'known_good' ? 'KNOWN GOOD' : 'KNOWN BAD'}
                          </span>
                          <span className="text-rmpg-300">{m.set_name}</span>
                          {m.file_name && <span className="text-rmpg-500 truncate">{m.file_name}</span>}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-t border-rmpg-700/30">
          {(['exhibits', 'analyses', 'timeline', 'iped', 'hashsets'] as const).map(tab => (
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
              {tab === 'iped' && <HardDrive className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {tab === 'hashsets' && <Database className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {tab === 'exhibits' ? `Exhibits (${exhibits.length})` :
               tab === 'analyses' ? `Analyses (${analyses.length})` :
               tab === 'timeline' ? `Timeline (${activity.length})` :
               tab === 'iped' ? `IPED${ipedImports.length ? ` (${ipedImports.length})` : ''}` :
               `Hash Sets (${hashSets.length})`}
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

                    {/* Hash integrity + match status */}
                    {(ex.hash_md5 || ex.hash_sha256) && (() => {
                      const match = exhibitHashMatches[ex.id];
                      const status = match?.status || 'unchecked';
                      return (
                        <div className={`text-[9px] font-mono px-2 py-1.5 rounded space-y-1 border ${
                          status === 'known_bad' ? 'bg-red-900/20 border-red-700/40' :
                          status === 'known_good' ? 'bg-green-900/15 border-green-700/30' :
                          status === 'unknown' ? 'bg-black/20 border-rmpg-700/30' :
                          'bg-amber-900/10 border-amber-700/20'
                        }`}>
                          {/* Match badge */}
                          <div className="flex items-center gap-2 mb-1">
                            {status === 'known_bad' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-900/40 text-red-400 font-bold uppercase text-[8px] rounded-sm animate-pulse">
                                <AlertTriangle className="w-3 h-3" /> KNOWN BAD
                              </span>
                            )}
                            {status === 'known_good' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-900/30 text-green-400 font-bold uppercase text-[8px] rounded-sm">
                                <CheckCircle className="w-3 h-3" /> KNOWN GOOD
                              </span>
                            )}
                            {status === 'unknown' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-rmpg-700/40 text-rmpg-400 font-bold uppercase text-[8px] rounded-sm">
                                <Shield className="w-3 h-3" /> NO MATCH
                              </span>
                            )}
                            {status === 'unchecked' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-900/20 text-amber-500 font-bold uppercase text-[8px] rounded-sm">
                                <AlertTriangle className="w-3 h-3" /> UNCHECKED
                              </span>
                            )}
                            {match?.matches?.length > 0 && (
                              <span className="text-[8px] text-rmpg-500">
                                Matched: {match.matches.map((m: any) => m.set_name).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(', ')}
                              </span>
                            )}
                          </div>
                          {/* Hash values */}
                          <div className="text-rmpg-500 space-y-0.5">
                            {ex.hash_md5 && <div><Lock className="w-3 h-3 inline text-green-600 mr-1" />MD5: {ex.hash_md5}</div>}
                            {ex.hash_sha256 && <div><Lock className="w-3 h-3 inline text-green-600 mr-1" />SHA-256: {ex.hash_sha256}</div>}
                          </div>
                        </div>
                      );
                    })()}

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

        {/* ── IPED Integration Tab ──────────────────────── */}
        {detailTab === 'iped' && (
          <div className="space-y-2">

            {/* IPED Connection Status Bar */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-rmpg-400" />
                <span className="text-[10px] text-rmpg-400 font-bold uppercase">IPED Digital Forensics</span>
                {ipedStatus?.configured ? (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-green-400">
                    <Wifi className="w-2.5 h-2.5" /> Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-rmpg-600">
                    <WifiOff className="w-2.5 h-2.5" /> Not Configured
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setIpedGuideOpen(v => !v)} className={`toolbar-btn text-[9px] ${ipedGuideOpen ? 'toolbar-btn-primary' : ''}`} style={{ padding: '2px 6px' }} title="IPED Usage Guide">
                  <BookOpen className="w-3 h-3" /> Guide
                </button>
                {ipedStatus?.configured && (
                  <button onClick={handleIpedTestConnection} className="toolbar-btn text-[9px]" style={{ padding: '2px 6px' }} disabled={ipedLoading}>
                    <RefreshCw className={`w-3 h-3 ${ipedLoading ? 'animate-spin' : ''}`} /> Test
                  </button>
                )}
                <button onClick={() => { setIpedSetupOpen(true); setIpedSetupForm({ baseUrl: '', apiKey: '' }); }} className="toolbar-btn toolbar-btn-primary text-[9px]" style={{ padding: '2px 6px' }}>
                  <Server className="w-3 h-3" /> {ipedStatus?.configured ? 'Reconfigure' : 'Setup'}
                </button>
              </div>
            </div>

            {/* IPED Setup Inline Form */}
            {ipedSetupOpen && (
              <form onSubmit={handleIpedSetup} className="panel-beveled bg-surface-base p-3 space-y-2">
                <p className="text-[10px] text-rmpg-300 font-bold uppercase">IPED Server Configuration</p>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-semibold block mb-0.5">Base URL *</label>
                  <input className="input-dark w-full text-xs" placeholder="http://192.168.1.100:11111" value={ipedSetupForm.baseUrl}
                    onChange={e => setIpedSetupForm(f => ({ ...f, baseUrl: e.target.value }))} required />
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-semibold block mb-0.5">API Key (optional)</label>
                  <input className="input-dark w-full text-xs" placeholder="Optional API key" type="password" value={ipedSetupForm.apiKey}
                    onChange={e => setIpedSetupForm(f => ({ ...f, apiKey: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button type="submit" className="toolbar-btn toolbar-btn-primary text-[9px]" style={{ padding: '3px 10px' }} disabled={ipedSetupSubmitting}>
                    {ipedSetupSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                  </button>
                  <button type="button" onClick={() => setIpedSetupOpen(false)} className="toolbar-btn text-[9px]" style={{ padding: '3px 10px' }}>Cancel</button>
                </div>
              </form>
            )}

            {/* ── IPED Usage Guide ───────────────────────── */}
            {ipedGuideOpen && (
              <div className="panel-beveled bg-surface-base p-3 space-y-3 max-h-[60vh] overflow-y-auto" style={{ border: '1px solid #2a3a5a' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">IPED Usage Guide</span>
                  </div>
                  <button onClick={() => setIpedGuideOpen(false)} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-white transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-[10px] text-rmpg-300">
                  IPED (Internet Protocol Evidence Decoder) is a digital forensics tool for processing and analyzing seized devices.
                  This integration allows you to connect to a running IPED server, browse processed cases, search evidence,
                  and import findings directly into your forensic case files.
                </p>

                {/* Section 1: Getting Started */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider border-b border-rmpg-700 pb-0.5">
                    1. Getting Started
                  </div>
                  <div className="text-[10px] text-rmpg-300 space-y-1 pl-2">
                    <p><strong className="text-rmpg-200">Prerequisites:</strong> An IPED server must be running and accessible from this machine. IPED processes disk images, mobile dumps, and other digital evidence into searchable indexes.</p>
                    <p><strong className="text-rmpg-200">Setup:</strong> Click the <span className="text-blue-400 font-bold">Setup</span> button above. Enter your IPED server&apos;s Base URL (e.g., <code className="text-[9px] bg-rmpg-800 px-1 py-0.5 text-brand-400">http://192.168.1.100:11111</code>) and optional API Key if authentication is configured.</p>
                    <p><strong className="text-rmpg-200">Testing:</strong> After saving credentials, click <span className="text-blue-400 font-bold">Test</span> to verify the connection. A green &quot;Connected&quot; badge indicates success.</p>
                  </div>
                </div>

                {/* Section 2: Case Browser */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider border-b border-rmpg-700 pb-0.5">
                    2. Case Browser
                  </div>
                  <div className="text-[10px] text-rmpg-300 space-y-1 pl-2">
                    <p>Navigate to the <strong className="text-rmpg-200">Case Browser</strong> sub-tab and click <span className="text-blue-400 font-bold">Load IPED Cases</span> to fetch all processed cases from the server.</p>
                    <p>Each case shows its name, total items, and processing date. Click a case to select it — this enables searching, viewing findings, and importing data.</p>
                    <p><strong className="text-rmpg-200">Link to Forensic Case:</strong> Once an IPED case is selected, click <span className="text-blue-400 font-bold">Link Case</span> to associate it with the current forensic case file. This creates an import record for audit tracking.</p>
                  </div>
                </div>

                {/* Section 3: Search */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider border-b border-rmpg-700 pb-0.5">
                    3. Searching Evidence
                  </div>
                  <div className="text-[10px] text-rmpg-300 space-y-1 pl-2">
                    <p>With an IPED case selected, use the search bar to query indexed evidence using <strong className="text-rmpg-200">Lucene syntax</strong>:</p>
                    <div className="bg-rmpg-800/80 p-2 text-[9px] font-mono text-rmpg-200 space-y-0.5" style={{ border: '1px solid #303030' }}>
                      <div><span className="text-amber-400">Simple:</span> <span className="text-brand-400">drug evidence photos</span></div>
                      <div><span className="text-amber-400">Exact Phrase:</span> <span className="text-brand-400">&quot;bank statement&quot;</span></div>
                      <div><span className="text-amber-400">Field Search:</span> <span className="text-brand-400">category:&quot;Images&quot; AND name:*.jpg</span></div>
                      <div><span className="text-amber-400">Wildcards:</span> <span className="text-brand-400">receipt_2024*</span></div>
                      <div><span className="text-amber-400">Boolean:</span> <span className="text-brand-400">(chat OR message) AND NOT spam</span></div>
                    </div>
                    <p>Results show items with relevance scores, file names, categories, and sizes. Click items to see metadata details.</p>
                  </div>
                </div>

                {/* Section 4: Findings */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider border-b border-rmpg-700 pb-0.5">
                    4. Findings
                  </div>
                  <div className="text-[10px] text-rmpg-300 space-y-1 pl-2">
                    <p>The <strong className="text-rmpg-200">Findings</strong> sub-tab displays forensic findings from the selected IPED case — flagged items, notable artifacts, and examiner annotations.</p>
                    <p>Click <span className="text-blue-400 font-bold">Import Findings</span> to pull these into your forensic case as analysis records with full metadata preserved.</p>
                  </div>
                </div>

                {/* Section 5: Bookmarks */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider border-b border-rmpg-700 pb-0.5">
                    5. Bookmarks
                  </div>
                  <div className="text-[10px] text-rmpg-300 space-y-1 pl-2">
                    <p>IPED bookmarks are examiner-created groupings of related items (e.g., &quot;Relevant Photos&quot;, &quot;Chat Conversations&quot;, &quot;Financial Documents&quot;).</p>
                    <p>The <strong className="text-rmpg-200">Bookmarks</strong> sub-tab lists all bookmark groups with item counts. Import bookmark groups to associate them with your forensic case.</p>
                  </div>
                </div>

                {/* Section 6: Timeline */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider border-b border-rmpg-700 pb-0.5">
                    6. Timeline Import
                  </div>
                  <div className="text-[10px] text-rmpg-300 space-y-1 pl-2">
                    <p>IPED builds a chronological timeline of file system activity, browser history, messages, and other timestamped artifacts.</p>
                    <p>Use the <span className="text-blue-400 font-bold">Import Timeline</span> action from the Case Browser to pull timeline events into your forensic case&apos;s activity log, enabling cross-reference with physical evidence timestamps.</p>
                  </div>
                </div>

                {/* Section 7: Import Types */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider border-b border-rmpg-700 pb-0.5">
                    7. Import Types Reference
                  </div>
                  <div className="text-[10px] text-rmpg-300 pl-2">
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      {[
                        ['case_link', 'Links an IPED case to this forensic case'],
                        ['findings', 'Imports flagged items and examiner notes'],
                        ['timeline', 'Imports chronological activity events'],
                        ['report', 'Imports IPED processing report summary'],
                        ['bookmarks', 'Imports bookmark groups and their items'],
                        ['items', 'Imports individual evidence items with metadata'],
                      ].map(([type, desc]) => (
                        <div key={type as string} className="flex gap-1.5 items-start">
                          <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-blue-900/30 text-blue-400 border border-blue-700/40 whitespace-nowrap">{(type as string).replace(/_/g, ' ')}</span>
                          <span className="text-[9px] text-rmpg-400">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Section 8: Troubleshooting */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider border-b border-rmpg-700 pb-0.5">
                    8. Troubleshooting
                  </div>
                  <div className="text-[10px] text-rmpg-300 space-y-1 pl-2">
                    <p><strong className="text-rmpg-200">Connection Failed:</strong> Verify the IPED server is running and the Base URL is correct. Check firewall rules allow access on the IPED port.</p>
                    <p><strong className="text-rmpg-200">Authentication Error:</strong> If your IPED server uses API keys, click <span className="text-blue-400 font-bold">Reconfigure</span> and update the API Key. Credentials are stored with AES-256-GCM encryption.</p>
                    <p><strong className="text-rmpg-200">No Cases Found:</strong> Ensure at least one case has been processed by IPED. Cases must complete processing before they appear in the browser.</p>
                    <p><strong className="text-rmpg-200">Import Errors:</strong> Check the <strong className="text-rmpg-200">Import Log</strong> sub-tab for error details. Common issues include network timeouts on large datasets — try importing smaller subsets.</p>
                  </div>
                </div>

                <div className="text-[9px] text-rmpg-600 text-center pt-1 border-t border-rmpg-700">
                  All IPED imports are logged with timestamps, user attribution, and item counts for audit compliance.
                </div>
              </div>
            )}

            {/* If not configured, show setup prompt */}
            {!ipedStatus?.configured && !ipedSetupOpen && (
              <div className="text-center py-8">
                <Server className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
                <p className="text-xs text-rmpg-400 font-semibold">IPED Not Connected</p>
                <p className="text-[10px] text-rmpg-500 mt-1 max-w-xs mx-auto">
                  Configure your IPED server connection to browse cases, import findings, and sync timeline data.
                </p>
              </div>
            )}

            {/* If configured, show sub-tabs and content */}
            {ipedStatus?.configured && !ipedSetupOpen && (
              <>
                {/* Sub-tab bar */}
                <div className="flex gap-0.5 mb-2">
                  {([
                    { key: 'browse' as const, label: 'Case Browser', icon: FileSearch },
                    { key: 'findings' as const, label: 'Findings', icon: Tag },
                    { key: 'bookmarks' as const, label: 'Bookmarks', icon: BookMarked },
                    { key: 'imports' as const, label: 'Import Log', icon: Database },
                  ]).map(st => (
                    <button
                      key={st.key}
                      onClick={() => {
                        setIpedSubTab(st.key);
                        if (st.key === 'findings' && ipedSelectedCase) handleIpedFetchFindings();
                        if (st.key === 'bookmarks' && ipedSelectedCase) handleIpedFetchBookmarks();
                        if (st.key === 'imports' && selected) fetchIpedImports(selected.id);
                      }}
                      className="flex items-center gap-1 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide rounded transition-colors"
                      style={{
                        background: ipedSubTab === st.key ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                        color: ipedSubTab === st.key ? '#93c5fd' : '#808080',
                        borderBottom: ipedSubTab === st.key ? '2px solid #3b82f6' : '2px solid transparent',
                      }}
                    >
                      <st.icon className="w-3 h-3" /> {st.label}
                    </button>
                  ))}
                </div>

                {/* Browse Sub-tab: IPED Case list + Search */}
                {ipedSubTab === 'browse' && (
                  <div className="space-y-2">
                    {/* Load Cases button */}
                    {ipedCases.length === 0 && (
                      <div className="text-center py-4">
                        <button onClick={fetchIpedCases} className="toolbar-btn toolbar-btn-primary text-[10px]" style={{ padding: '4px 12px' }} disabled={ipedLoading}>
                          {ipedLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />} Load IPED Cases
                        </button>
                      </div>
                    )}

                    {/* IPED Case list */}
                    {ipedCases.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[9px] text-rmpg-400 font-bold uppercase">Available IPED Cases ({ipedCases.length})</span>
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {ipedCases.map(ic => (
                            <div
                              key={ic.id}
                              onClick={() => { setIpedSelectedCase(ic); setIpedSearchResults([]); setIpedSearchTotal(0); }}
                              className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors
                                ${ipedSelectedCase?.id === ic.id
                                  ? 'bg-blue-900/30 border border-blue-700/40'
                                  : 'panel-beveled bg-surface-base hover:bg-rmpg-800/50'}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <HardDrive className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-[11px] text-white font-semibold truncate">{ic.name}</p>
                                  {ic.totalItems != null && (
                                    <p className="text-[9px] text-rmpg-500">{ic.totalItems.toLocaleString()} items</p>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={e => { e.stopPropagation(); handleIpedLinkCase(ic); }}
                                className="toolbar-btn text-[8px] flex-shrink-0" style={{ padding: '2px 6px' }}
                                disabled={ipedImporting}
                                title="Link this IPED case to the current forensic case"
                              >
                                <Link2 className="w-3 h-3" /> Link
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Search within selected IPED case */}
                    {ipedSelectedCase && (
                      <div className="space-y-2 mt-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-blue-400 font-bold uppercase flex-shrink-0">Search in: {ipedSelectedCase.name}</span>
                        </div>
                        <div className="flex gap-1">
                          <div className="flex-1 relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
                            <input
                              className="input-dark w-full text-xs pl-6"
                              placeholder="Lucene query (e.g., crypto OR wallet, *.pdf, email:*@gmail.com)"
                              value={ipedSearchQuery}
                              onChange={e => setIpedSearchQuery(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleIpedSearch()}
                            />
                          </div>
                          <button onClick={handleIpedSearch} className="toolbar-btn toolbar-btn-primary text-[9px]" style={{ padding: '2px 8px' }} disabled={ipedLoading}>
                            {ipedLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Search
                          </button>
                        </div>

                        {/* Search results */}
                        {ipedSearchResults.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-rmpg-400 font-bold">{ipedSearchTotal} results</span>
                              <button
                                onClick={() => handleIpedImportItems(ipedSearchResults)}
                                className="toolbar-btn toolbar-btn-primary text-[8px]" style={{ padding: '2px 6px' }}
                                disabled={ipedImporting}
                              >
                                <Download className="w-3 h-3" /> Import All as Exhibits
                              </button>
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-1">
                              {ipedSearchResults.map((item, i) => (
                                <div key={item.id || i} className="flex items-center gap-2 p-1.5 panel-beveled bg-surface-base text-[10px]">
                                  <FileText className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-rmpg-200 truncate font-medium">{item.name || 'Unnamed'}</p>
                                    <p className="text-rmpg-500 truncate">{item.path || ''}</p>
                                  </div>
                                  <span className="text-[8px] text-rmpg-600 flex-shrink-0">{item.type || item.category || ''}</span>
                                  {item.size != null && <span className="text-[8px] text-rmpg-600 flex-shrink-0">{(item.size / 1024).toFixed(1)}KB</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-1 pt-1 border-t border-rmpg-700/30">
                          <button onClick={() => handleIpedAttachReport('html')} className="toolbar-btn text-[9px]" style={{ padding: '2px 8px' }} disabled={ipedImporting}>
                            <FileText className="w-3 h-3" /> Attach HTML Report
                          </button>
                          <button onClick={() => handleIpedAttachReport('csv')} className="toolbar-btn text-[9px]" style={{ padding: '2px 8px' }} disabled={ipedImporting}>
                            <FileText className="w-3 h-3" /> Attach CSV Report
                          </button>
                          <button onClick={handleIpedImportTimeline} className="toolbar-btn text-[9px]" style={{ padding: '2px 8px' }} disabled={ipedImporting}>
                            <Calendar className="w-3 h-3" /> Import Timeline
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Findings Sub-tab */}
                {ipedSubTab === 'findings' && (
                  <div className="space-y-2">
                    {!ipedSelectedCase ? (
                      <div className="text-center py-6">
                        <Tag className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                        <p className="text-xs text-rmpg-400">Link an IPED case first</p>
                        <p className="text-[10px] text-rmpg-500">Use the Case Browser tab to select and link an IPED case</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-rmpg-400 font-bold uppercase">
                            Regex Findings — {ipedSelectedCase.name} ({ipedFindings.length} hits)
                          </span>
                          <div className="flex gap-1">
                            <button onClick={handleIpedFetchFindings} className="toolbar-btn text-[8px]" style={{ padding: '2px 6px' }} disabled={ipedLoading}>
                              <RefreshCw className={`w-3 h-3 ${ipedLoading ? 'animate-spin' : ''}`} /> Refresh
                            </button>
                            {ipedFindings.length > 0 && (
                              <button onClick={handleIpedImportFindings} className="toolbar-btn toolbar-btn-primary text-[8px]" style={{ padding: '2px 6px' }} disabled={ipedImporting}>
                                <Download className="w-3 h-3" /> Import to Analysis
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-[9px] text-rmpg-500">
                          Crypto wallets, emails, IPs, credit cards, and other PII detected by IPED's regex engine.
                          {analyses.some(a => a.analysis_type === 'digital_forensics') ?
                            ' Findings will be appended to the Digital Forensics analysis.' :
                            ' Create a Digital Forensics analysis first to auto-link findings.'
                          }
                        </p>
                        {ipedLoading ? (
                          <div className="text-center py-6"><Loader2 className="w-6 h-6 text-rmpg-500 mx-auto animate-spin" /></div>
                        ) : ipedFindings.length === 0 ? (
                          <div className="text-center py-6">
                            <Tag className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                            <p className="text-xs text-rmpg-400">No regex findings loaded</p>
                          </div>
                        ) : (
                          <div className="max-h-64 overflow-y-auto space-y-1">
                            {ipedFindings.map((f, i) => (
                              <div key={f.id || i} className="panel-beveled bg-surface-base p-2 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-amber-900/40 text-amber-400 border border-amber-700/40 panel-beveled">
                                    {f.category}
                                  </span>
                                  <span className="text-[10px] text-white font-medium truncate">{f.name}</span>
                                </div>
                                {f.path && <p className="text-[9px] text-rmpg-500 truncate">{f.path}</p>}
                                {f.content_preview && (
                                  <p className="text-[9px] text-rmpg-400 font-mono bg-rmpg-900/50 p-1 rounded truncate">{f.content_preview}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Bookmarks Sub-tab */}
                {ipedSubTab === 'bookmarks' && (
                  <div className="space-y-2">
                    {!ipedSelectedCase ? (
                      <div className="text-center py-6">
                        <BookMarked className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                        <p className="text-xs text-rmpg-400">Link an IPED case first</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-rmpg-400 font-bold uppercase">
                            IPED Bookmarks — {ipedSelectedCase.name} ({ipedBookmarks.length})
                          </span>
                          <button onClick={handleIpedFetchBookmarks} className="toolbar-btn text-[8px]" style={{ padding: '2px 6px' }} disabled={ipedLoading}>
                            <RefreshCw className={`w-3 h-3 ${ipedLoading ? 'animate-spin' : ''}`} /> Refresh
                          </button>
                        </div>
                        {ipedLoading ? (
                          <div className="text-center py-6"><Loader2 className="w-6 h-6 text-rmpg-500 mx-auto animate-spin" /></div>
                        ) : ipedBookmarks.length === 0 ? (
                          <div className="text-center py-6">
                            <BookMarked className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                            <p className="text-xs text-rmpg-400">No bookmarks loaded</p>
                          </div>
                        ) : (
                          <div className="max-h-64 overflow-y-auto space-y-1">
                            {ipedBookmarks.map((bk, i) => (
                              <div key={bk.id || i} className="panel-beveled bg-surface-base p-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <BookMarked className="w-3 h-3 text-blue-400" />
                                    <span className="text-[11px] text-white font-semibold">{bk.name}</span>
                                    {bk.itemCount != null && (
                                      <span className="text-[9px] text-rmpg-500">{bk.itemCount} items</span>
                                    )}
                                  </div>
                                </div>
                                {bk.comment && <p className="text-[9px] text-rmpg-400 mt-0.5">{bk.comment}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Import Log Sub-tab */}
                {ipedSubTab === 'imports' && (
                  <div className="space-y-2">
                    <span className="text-[9px] text-rmpg-400 font-bold uppercase block">IPED Import History ({ipedImports.length})</span>
                    {ipedImports.length === 0 ? (
                      <div className="text-center py-6">
                        <Database className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                        <p className="text-xs text-rmpg-400">No imports yet</p>
                        <p className="text-[10px] text-rmpg-500 mt-1">Link an IPED case and import data to see history here</p>
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {ipedImports.map(imp => {
                          const typeColors: Record<string, string> = {
                            case_link: 'bg-blue-900/40 text-blue-400 border-blue-700/40',
                            findings: 'bg-amber-900/40 text-amber-400 border-amber-700/40',
                            timeline: 'bg-purple-900/40 text-purple-400 border-purple-700/40',
                            report: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/40',
                            bookmarks: 'bg-green-900/40 text-green-400 border-green-700/40',
                            items: 'bg-red-900/40 text-red-400 border-red-700/40',
                          };
                          return (
                            <div key={imp.id} className="panel-beveled bg-surface-base p-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border panel-beveled ${typeColors[imp.import_type] || 'bg-rmpg-800 text-rmpg-300 border-rmpg-600'}`}>
                                    {imp.import_type.replace(/_/g, ' ')}
                                  </span>
                                  <span className="text-[10px] text-rmpg-200 font-medium">{imp.iped_case_name || imp.iped_case_id}</span>
                                  {imp.item_count > 0 && (
                                    <span className="text-[9px] text-rmpg-500">{imp.item_count} items</span>
                                  )}
                                </div>
                                <span className="text-[9px] text-rmpg-600">{fmtDateTime(imp.created_at)}</span>
                              </div>
                              {imp.summary && <p className="text-[9px] text-rmpg-400 mt-0.5">{imp.summary}</p>}
                              {imp.imported_by_name && <p className="text-[8px] text-rmpg-500">by {imp.imported_by_name}</p>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Hash Sets Tab ────────────────────────────────── */}
        {detailTab === 'hashsets' && (
          <div
            className={`space-y-3 relative ${hashDropActive ? 'ring-2 ring-brand-400 ring-inset' : ''}`}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setHashDropActive(true); }}
            onDragLeave={e => { e.stopPropagation(); setHashDropActive(false); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              setHashDropActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file && (file.name.endsWith('.csv') || file.name.endsWith('.txt'))) handleHashFileDrop(file);
            }}
          >
            {/* Drop overlay */}
            {hashDropActive && (
              <div className="absolute inset-0 bg-brand-900/50 border-2 border-dashed border-brand-400 flex flex-col items-center justify-center z-10 rounded">
                <Download className="w-8 h-8 text-brand-300 mb-2" />
                <span className="text-brand-200 font-bold text-sm">Drop CSV to import hash set</span>
                <span className="text-brand-400 text-[10px] mt-1">Supports NSRL, ProjectVIC, or custom CSV formats</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-rmpg-400" />
                <span className="text-[10px] text-rmpg-400 font-bold uppercase">
                  Hash Sets ({hashSets.length} loaded)
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={fetchHashSets} className="toolbar-btn text-[9px]" style={{ padding: '2px 6px' }} disabled={hashSetsLoading}>
                  <RefreshCw className={`w-3 h-3 ${hashSetsLoading ? 'animate-spin' : ''}`} /> Refresh
                </button>
                <button onClick={() => setHashImportOpen(!hashImportOpen)} className="toolbar-btn toolbar-btn-primary text-[9px]" style={{ padding: '2px 6px' }}>
                  <Plus className="w-3 h-3" /> Import Hash Set
                </button>
              </div>
            </div>

            {/* Import Form */}
            {hashImportOpen && (
              <form onSubmit={handleHashImport} className="panel-beveled bg-surface-base p-3 space-y-2">
                <p className="text-[10px] text-rmpg-300 font-bold uppercase">Import Hash Set</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-rmpg-400 uppercase font-semibold block mb-0.5">Name *</label>
                    <input className="input-dark w-full text-xs" placeholder="e.g., NSRL v3.82" value={hashImportForm.name}
                      onChange={e => setHashImportForm(f => ({ ...f, name: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="text-[9px] text-rmpg-400 uppercase font-semibold block mb-0.5">Type *</label>
                    <select className="select-dark w-full text-xs" value={hashImportForm.set_type}
                      onChange={e => setHashImportForm(f => ({ ...f, set_type: e.target.value as HashSetType }))}>
                      <option value="nsrl">NSRL (Known Good)</option>
                      <option value="projectvic">ProjectVIC (Known Bad)</option>
                      <option value="known_good">Custom Known Good</option>
                      <option value="known_bad">Custom Known Bad</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-rmpg-400 uppercase font-semibold block mb-0.5">Description</label>
                    <input className="input-dark w-full text-xs" placeholder="Optional description" value={hashImportForm.description}
                      onChange={e => setHashImportForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[9px] text-rmpg-400 uppercase font-semibold block mb-0.5">Version</label>
                    <input className="input-dark w-full text-xs" placeholder="e.g., 3.82" value={hashImportForm.version}
                      onChange={e => setHashImportForm(f => ({ ...f, version: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase font-semibold block mb-0.5">
                    CSV File (md5, sha1, sha256, filename, filesize, category columns)
                  </label>
                  <input type="file" accept=".csv,.txt" className="text-[10px] text-rmpg-400"
                    onChange={e => {
                      const f = e.target.files?.[0] || null;
                      setHashImportFile(f);
                      if (f) {
                        if (!hashImportForm.name) setHashImportForm(prev => ({ ...prev, name: cleanFileName(f.name) }));
                        if (hashImportForm.set_type === 'custom') setHashImportForm(prev => ({ ...prev, set_type: detectHashSetType(f.name) }));
                        previewCsvRowCount(f);
                      } else { setHashFilePreviewCount(null); }
                    }} />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button type="submit" className="toolbar-btn toolbar-btn-primary text-[9px]" style={{ padding: '3px 10px' }} disabled={hashImporting}>
                    {hashImporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    {hashFilePreviewCount !== null ? `Import ${hashFilePreviewCount.toLocaleString()} Entries` : 'Import'}
                  </button>
                  <button type="button" onClick={() => { setHashImportOpen(false); setHashFilePreviewCount(null); }} className="toolbar-btn text-[9px]" style={{ padding: '3px 10px' }}>Cancel</button>
                  {hashFilePreviewCount !== null && (
                    <span className="text-[9px] text-green-400 font-mono flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> {hashFilePreviewCount.toLocaleString()} rows detected
                    </span>
                  )}
                </div>
              </form>
            )}

            {/* Hash Set List */}
            {hashSetsLoading ? (
              <div className="text-center py-8"><Loader2 className="w-6 h-6 text-rmpg-500 mx-auto animate-spin" /></div>
            ) : hashSets.length === 0 ? (
              <div className="text-center py-8">
                <Database className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
                <p className="text-xs text-rmpg-400 font-semibold">No hash sets loaded</p>
                <p className="text-[10px] text-rmpg-500 mt-1 max-w-xs mx-auto">
                  Import NSRL, ProjectVIC, or CSV hash sets to enable known-file matching.
                  Supported formats: CSV with md5/sha1/sha256 columns.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {hashSets.map(hs => (
                  <div key={hs.id} className="panel-beveled bg-surface-base p-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Hash className="w-3.5 h-3.5 flex-shrink-0" style={{
                        color: hs.set_type === 'nsrl' ? '#22c55e' :
                               hs.set_type === 'projectvic' || hs.set_type === 'known_bad' ? '#ef4444' :
                               hs.set_type === 'known_good' ? '#3b82f6' : '#808080'
                      }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white font-semibold truncate">{hs.name}</span>
                          <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-sm flex-shrink-0" style={{
                            background: hs.set_type === 'nsrl' ? 'rgba(34,197,94,0.15)' :
                                        hs.set_type === 'projectvic' || hs.set_type === 'known_bad' ? 'rgba(239,68,68,0.15)' :
                                        hs.set_type === 'known_good' ? 'rgba(59,130,246,0.15)' : 'rgba(128,128,128,0.15)',
                            color: hs.set_type === 'nsrl' ? '#22c55e' :
                                   hs.set_type === 'projectvic' || hs.set_type === 'known_bad' ? '#ef4444' :
                                   hs.set_type === 'known_good' ? '#3b82f6' : '#808080',
                          }}>
                            {hs.set_type.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[9px] text-rmpg-500 mt-0.5">
                          <span className="font-mono">{hs.hash_count.toLocaleString()} hashes</span>
                          {hs.version && <span>v{hs.version}</span>}
                          {hs.imported_by_name && <span>by {hs.imported_by_name}</span>}
                          <span>{new Date(hs.created_at).toLocaleDateString()}</span>
                        </div>
                        {hs.description && <p className="text-[9px] text-rmpg-500 mt-0.5 truncate">{hs.description}</p>}
                      </div>
                    </div>
                    <button onClick={() => handleDeleteHashSet(hs.id, hs.name)}
                      className="toolbar-btn toolbar-btn-danger p-1 flex-shrink-0" title="Delete hash set">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Hash Check Tool — Enhanced */}
            <div className="border-t border-rmpg-700/30 pt-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-rmpg-400" />
                  <span className="text-[10px] text-rmpg-400 font-bold uppercase">Check Hashes</span>
                  {hashCheckInput.trim() && (() => {
                    const count = hashCheckInput.split(/[\n,]+/).map(h => h.trim()).filter(Boolean).length;
                    return <span className="text-[9px] text-brand-400 font-mono">{count} hash{count !== 1 ? 'es' : ''} to check</span>;
                  })()}
                </div>
                {hashCheckResults && Object.keys(hashCheckResults).length > 0 && (
                  <button
                    className="toolbar-btn text-[9px]"
                    style={{ padding: '2px 8px' }}
                    onClick={() => {
                      const lines: string[] = [];
                      Object.entries(hashCheckResults).forEach(([hash, matches]) => {
                        if ((matches as any[]).length > 0) {
                          (matches as any[]).forEach((m: any) => {
                            lines.push(`${hash}\t${m.set_type.replace(/_/g, ' ').toUpperCase()}\t${m.set_name}${m.file_name ? '\t' + m.file_name : ''}${m.category ? '\t[' + m.category + ']' : ''}`);
                          });
                        } else {
                          lines.push(`${hash}\tNO MATCH`);
                        }
                      });
                      // Also include hashes with no results at all
                      const checked = hashCheckInput.split(/[\n,]+/).map(h => h.trim()).filter(Boolean);
                      checked.forEach(h => {
                        if (!hashCheckResults[h]) lines.push(`${h}\tNO MATCH`);
                      });
                      navigator.clipboard.writeText(lines.join('\n'));
                    }}
                    title="Copy results to clipboard (tab-separated)"
                  >
                    <Copy className="w-3 h-3" /> Copy Results
                  </button>
                )}
              </div>
              <textarea
                className="input-dark w-full text-xs font-mono resize-y"
                rows={4}
                placeholder={"Paste one or more hashes (MD5, SHA1, or SHA256)\nOne per line, or comma-separated\n\nExample:\nd41d8cd98f00b204e9800998ecf8427e\ne3b0c44298fc1c149afbf4c8996fb924..."}
                value={hashCheckInput}
                onChange={e => setHashCheckInput(e.target.value)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file && (file.name.endsWith('.txt') || file.name.endsWith('.csv'))) {
                    file.text().then(text => setHashCheckInput(prev => prev ? prev + '\n' + text : text));
                  }
                }}
              />
              <div className="flex items-center gap-2 mt-1.5">
                <button onClick={handleHashCheck} className="toolbar-btn toolbar-btn-primary text-[9px]" style={{ padding: '3px 10px' }} disabled={hashChecking || hashSets.length === 0 || !hashCheckInput.trim()}>
                  {hashChecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  Check Against {hashSets.length} Set{hashSets.length !== 1 ? 's' : ''}
                </button>
                {hashCheckInput.trim() && (
                  <button onClick={() => { setHashCheckInput(''); setHashCheckResults(null); }} className="toolbar-btn text-[9px]" style={{ padding: '3px 8px' }}>
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
                <span className="text-[8px] text-rmpg-600 ml-auto">Drag & drop a .txt file or paste hashes</span>
              </div>
              {hashCheckResults && (
                <div className="mt-3 space-y-1">
                  {/* Summary bar */}
                  {(() => {
                    const checked = hashCheckInput.split(/[\n,]+/).map(h => h.trim()).filter(Boolean);
                    const matched = Object.keys(hashCheckResults).filter(h => (hashCheckResults[h] as any[]).length > 0).length;
                    const noMatch = checked.length - matched;
                    return (
                      <div className="flex items-center gap-3 text-[9px] font-bold mb-2">
                        <span className="text-rmpg-400">{checked.length} checked</span>
                        {matched > 0 && <span className="text-red-400">{matched} MATCHED</span>}
                        {noMatch > 0 && <span className="text-green-400">{noMatch} clean</span>}
                      </div>
                    );
                  })()}
                  {Object.keys(hashCheckResults).length === 0 ? (
                    <div className="panel-beveled bg-green-900/20 border border-green-700/30 p-3 text-center">
                      <CheckCircle className="w-4 h-4 text-green-400 mx-auto mb-1" />
                      <span className="text-[11px] text-green-400 font-semibold">All clean — no hashes matched any loaded set</span>
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {Object.entries(hashCheckResults).map(([hash, matches]) => (
                        <div key={hash} className={`panel-beveled p-2 border-l-2 ${
                          (matches as any[]).some((m: any) => m.set_type === 'projectvic' || m.set_type === 'known_bad')
                            ? 'bg-red-900/15 border-l-red-500'
                            : (matches as any[]).some((m: any) => m.set_type === 'nsrl' || m.set_type === 'known_good')
                              ? 'bg-green-900/15 border-l-green-500'
                              : 'bg-surface-base border-l-rmpg-600'
                        }`}>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] font-mono text-white truncate flex-1">{hash}</p>
                            {(matches as any[]).length === 0 ? (
                              <span className="text-[8px] font-bold uppercase text-rmpg-500 bg-rmpg-800 px-1.5 py-0.5 flex-shrink-0">no match</span>
                            ) : (matches as any[]).some((m: any) => m.set_type === 'projectvic' || m.set_type === 'known_bad') ? (
                              <span className="text-[8px] font-bold uppercase text-red-400 bg-red-900/40 px-1.5 py-0.5 flex-shrink-0 animate-pulse">KNOWN BAD</span>
                            ) : (
                              <span className="text-[8px] font-bold uppercase text-green-400 bg-green-900/40 px-1.5 py-0.5 flex-shrink-0">KNOWN GOOD</span>
                            )}
                          </div>
                          {(matches as any[]).map((m: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-[9px] mt-0.5">
                              <span className="font-bold uppercase px-1 py-0.5 rounded-sm" style={{
                                background: m.set_type === 'nsrl' || m.set_type === 'known_good' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                color: m.set_type === 'nsrl' || m.set_type === 'known_good' ? '#22c55e' : '#ef4444',
                              }}>
                                {m.set_type.replace(/_/g, ' ')}
                              </span>
                              <span className="text-rmpg-300">{m.set_name}</span>
                              {m.file_name && <span className="text-rmpg-500 truncate">{m.file_name}</span>}
                              {m.category && <span className="text-rmpg-600">[{m.category}]</span>}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
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
