// ============================================================
// RMPG Flex — IPED Digital Forensics Page
// ============================================================
// Dashboard + job queue for IPED digital forensics processing.
// Hash set management, job creation/monitoring, hash results.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDrive, Search, Plus, Loader2, X, RefreshCw,
  Play, Square, CheckCircle, AlertTriangle, Clock, Hash,
  Database, Trash2, Upload, Download, FileText, Eye,
  ChevronDown, Activity, Server, Shield, Copy, Zap,
  BarChart3, Filter, HelpCircle, BookOpen, ChevronRight,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import PanelTitleBar from '../components/PanelTitleBar';

// ── Types ───────────────────────────────────────────────────

interface IpedJob {
  id: number;
  evidence_id: number | null;
  job_type: string;
  status: string;
  profile: string;
  input_path: string;
  output_path: string | null;
  progress_percent: number | null;
  items_found: number | null;
  items_processed: number | null;
  result_summary: string | null;
  error_message: string | null;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface HashSet {
  name: string;
  category: string;
  count: number;
  hashType: string;
}

interface HashResult {
  id: number;
  evidence_id: number | null;
  attachment_id: number | null;
  attachment_name: string | null;
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
  flagged: number;
  flag_reason: string | null;
  iped_job_id: number | null;
  created_at: string;
}

interface StatusStats {
  totalJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalHashes: number;
  flaggedHashes: number;
}

// ── Status Badge Colors ─────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  queued:    'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  running:   'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  completed: 'bg-green-900/50 text-green-400 border border-green-700/50',
  failed:    'bg-red-900/50 text-red-400 border border-red-700/50',
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  queued: Clock,
  running: Activity,
  completed: CheckCircle,
  failed: AlertTriangle,
};

const JOB_TYPE_LABELS: Record<string, string> = {
  hash: 'Hash Computation',
  process: 'Full Processing',
  triage: 'Triage Scan',
  csam_scan: 'CSAM Scan',
};

// ── Helpers ─────────────────────────────────────────────────

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '--';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const sec = Math.floor((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function formatDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── Component ───────────────────────────────────────────────

export default function IpedPage() {
  const { addToast } = useToast();

  // Help panel
  const [showHelp, setShowHelp] = useState(false);

  // Dashboard stats
  const [stats, setStats] = useState<StatusStats>({
    totalJobs: 0, runningJobs: 0, completedJobs: 0, failedJobs: 0,
    totalHashes: 0, flaggedHashes: 0,
  });

  // Jobs
  const [jobs, setJobs] = useState<IpedJob[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsFilter, setJobsFilter] = useState('');
  const [jobsLoading, setJobsLoading] = useState(true);

  // Selected job detail
  const [selectedJob, setSelectedJob] = useState<IpedJob | null>(null);
  const [jobHashes, setJobHashes] = useState<HashResult[]>([]);
  const [jobProgress, setJobProgress] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Hash sets
  const [hashSets, setHashSets] = useState<HashSet[]>([]);
  const [hashSetsLoading, setHashSetsLoading] = useState(false);

  // New job modal
  const [showNewJob, setShowNewJob] = useState(false);
  const [newJob, setNewJob] = useState({
    jobType: 'hash', inputPath: '', outputPath: '', evidenceId: '', profile: 'forensic', description: '',
  });
  const [newJobSubmitting, setNewJobSubmitting] = useState(false);

  // Import hash set modal
  const [showImportHashSet, setShowImportHashSet] = useState(false);
  const [importData, setImportData] = useState({
    filePath: '', setName: '', category: 'known_bad', hashType: 'md5',
  });
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [availableHashSets, setAvailableHashSets] = useState<any[]>([]);
  const [selectedAvailableSet, setSelectedAvailableSet] = useState('');

  // Review queue (Phase 3)
  const [flaggedHashes, setFlaggedHashes] = useState<any[]>([]);
  const [reviewStats, setReviewStats] = useState<any>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  // Hash search (Phase 6)
  const [searchHash, setSearchHash] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchFilters, setSearchFilters] = useState({ flagged: '', reviewStatus: '', hashSet: '' });
  const [searchLoading, setSearchLoading] = useState(false);

  // Duplicate detection (Phase 7)
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [dupScanning, setDupScanning] = useState(false);

  // Dashboard enhancements (Phase 8)
  const [usageHistory, setUsageHistory] = useState<any[]>([]);
  const [queueDepth, setQueueDepth] = useState(0);

  // ── Fetch Functions ───────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/iped/status');
      setStats({
        totalJobs: data.totalJobs || 0,
        runningJobs: data.runningJobs || 0,
        completedJobs: data.completedJobs || 0,
        failedJobs: data.failedJobs || 0,
        totalHashes: data.totalHashes || 0,
        flaggedHashes: data.flaggedHashes || 0,
      });
    } catch { /* status fetch is best-effort */ }
  }, []);

  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(jobsPage), limit: '20' });
      if (jobsFilter) qs.set('status', jobsFilter);
      const data = await apiFetch<any>(`/iped/jobs?${qs}`);
      setJobs(data.jobs || []);
      setJobsTotal(data.total || 0);
    } catch (err: any) {
      addToast(err.message || 'Failed to load jobs', 'error');
    } finally {
      setJobsLoading(false);
    }
  }, [jobsPage, jobsFilter, addToast]);

  const fetchHashSets = useCallback(async () => {
    setHashSetsLoading(true);
    try {
      const data = await apiFetch<any>('/iped/hash-sets');
      setHashSets(data.sets || []);
    } catch { /* optional */ }
    finally { setHashSetsLoading(false); }
  }, []);

  const fetchJobDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const data = await apiFetch<any>(`/iped/jobs/${id}`);
      setSelectedJob(data);
      setJobHashes(data.hashes || []);
      setJobProgress(data.progress || null);
    } catch (err: any) {
      addToast(err.message || 'Failed to load job', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [addToast]);

  const fetchReviewStats = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/iped/hash/review-stats');
      setReviewStats(data);
    } catch { /* best-effort */ }
  }, []);

  const fetchFlaggedHashes = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/iped/hash/flagged');
      setFlaggedHashes(data.data || []);
    } catch { /* best-effort */ }
  }, []);

  const fetchUsageHistory = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/iped/usage');
      setUsageHistory(data.history || []);
      setQueueDepth(data.queueDepth || 0);
    } catch { /* best-effort */ }
  }, []);

  // ── Effects ───────────────────────────────────────────────

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => { fetchHashSets(); }, [fetchHashSets]);

  useEffect(() => { fetchReviewStats(); }, [fetchReviewStats]);
  useEffect(() => { fetchFlaggedHashes(); }, [fetchFlaggedHashes]);
  useEffect(() => { fetchUsageHistory(); }, [fetchUsageHistory]);

  // Polling for running jobs
  useEffect(() => {
    if (stats.runningJobs === 0) return;
    const iv = setInterval(() => { fetchStatus(); fetchJobs(); }, 5000);
    return () => clearInterval(iv);
  }, [stats.runningJobs, fetchStatus, fetchJobs]);

  // Refresh selected job detail when it's running
  useEffect(() => {
    if (!selectedJob || selectedJob.status !== 'running') return;
    const iv = setInterval(() => fetchJobDetail(selectedJob.id), 3000);
    return () => clearInterval(iv);
  }, [selectedJob, fetchJobDetail]);

  // ── Actions ───────────────────────────────────────────────

  const handleCreateJob = async () => {
    if (!newJob.inputPath.trim()) {
      addToast('Input path is required', 'error');
      return;
    }
    setNewJobSubmitting(true);
    try {
      await apiFetch('/iped/jobs', {
        method: 'POST',
        body: JSON.stringify({
          jobType: newJob.jobType,
          inputPath: newJob.inputPath.trim(),
          outputPath: newJob.outputPath.trim() || undefined,
          evidenceId: newJob.evidenceId ? parseInt(newJob.evidenceId, 10) : undefined,
          profile: newJob.profile || 'forensic',
        }),
      });
      addToast('Job created successfully', 'success');
      setShowNewJob(false);
      setNewJob({ jobType: 'hash', inputPath: '', outputPath: '', evidenceId: '', profile: 'forensic', description: '' });
      fetchJobs();
      fetchStatus();
    } catch (err: any) {
      addToast(err.message || 'Failed to create job', 'error');
    } finally {
      setNewJobSubmitting(false);
    }
  };

  const handleCancelJob = async (id: number) => {
    try {
      await apiFetch(`/iped/jobs/${id}/cancel`, { method: 'POST' });
      addToast('Job cancelled', 'success');
      fetchJobs();
      fetchStatus();
      if (selectedJob?.id === id) fetchJobDetail(id);
    } catch (err: any) {
      addToast(err.message || 'Failed to cancel job', 'error');
    }
  };

  const handleImportHashSet = async () => {
    if (!importData.setName.trim()) {
      addToast('Set name is required', 'error');
      return;
    }
    if (!importData.filePath.trim()) {
      addToast('Select a hash set, upload a file, or enter a path', 'error');
      return;
    }
    setImportSubmitting(true);
    try {
      let data: any;
      if (importData.filePath === '__upload__') {
        // Upload content directly to server
        const content = (window as any).__hashSetUploadContent;
        if (!content) {
          addToast('No file content loaded. Please re-upload or paste hashes.', 'error');
          setImportSubmitting(false);
          return;
        }
        data = await apiFetch<any>('/iped/hash-sets/upload', {
          method: 'POST',
          body: JSON.stringify({
            content,
            setName: importData.setName,
            category: importData.category,
            hashType: importData.hashType,
            fileName: (window as any).__hashSetUploadFileName,
          }),
        });
        // Clean up
        delete (window as any).__hashSetUploadContent;
        delete (window as any).__hashSetUploadFileName;
      } else {
        // Import from server file path
        data = await apiFetch<any>('/iped/hash-sets/import', {
          method: 'POST',
          body: JSON.stringify(importData),
        });
      }
      addToast(`Imported ${data.imported} hashes into "${importData.setName}"`, 'success');
      setShowImportHashSet(false);
      setImportData({ filePath: '', setName: '', category: 'known_bad', hashType: 'md5' });
      setSelectedAvailableSet('');
      fetchHashSets();
      fetchStatus();
    } catch (err: any) {
      addToast(err.message || 'Failed to import hash set', 'error');
    } finally {
      setImportSubmitting(false);
    }
  };

  const handleRemoveHashSet = async (name: string) => {
    if (!window.confirm('Remove hash set "' + name + '"?')) return;
    try {
      await apiFetch(`/iped/hash-sets/${encodeURIComponent(name)}`, { method: 'DELETE' });
      addToast(`Hash set "${name}" removed`, 'success');
      fetchHashSets();
    } catch (err: any) {
      addToast(err.message || 'Failed to remove hash set', 'error');
    }
  };

  // ── Review Queue Actions ─────────────────────────────────

  const handleReview = async (id: number, reviewStatus: string) => {
    try {
      await apiFetch(`/iped/hash/results/${id}/review`, {
        method: 'PUT',
        body: JSON.stringify({ review_status: reviewStatus, notes: reviewNotes[id] || '' }),
      });
      addToast(`Marked as ${reviewStatus}`, 'success');
      setFlaggedHashes(prev => prev.filter(h => h.id !== id));
      setReviewNotes(prev => { const n = { ...prev }; delete n[id]; return n; });
      fetchReviewStats();
    } catch (err: any) {
      addToast(err.message || 'Review failed', 'error');
    }
  };

  // ── Hash Search Actions ─────────────────────────────────

  const handleHashSearch = async () => {
    setSearchLoading(true);
    try {
      const qs = new URLSearchParams();
      if (searchHash.trim()) qs.set('hash', searchHash.trim());
      if (searchFilters.flagged) qs.set('flagged', searchFilters.flagged);
      if (searchFilters.reviewStatus) qs.set('reviewStatus', searchFilters.reviewStatus);
      if (searchFilters.hashSet) qs.set('hashSet', searchFilters.hashSet);
      const data = await apiFetch<any>(`/iped/hash/search?${qs}`);
      setSearchResults(data.data || data.results || []);
    } catch (err: any) {
      addToast(err.message || 'Search failed', 'error');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleExportCSV = async () => {
    try {
      const qs = new URLSearchParams();
      if (searchHash.trim()) qs.set('hash', searchHash.trim());
      if (searchFilters.flagged) qs.set('flagged', searchFilters.flagged);
      if (searchFilters.reviewStatus) qs.set('reviewStatus', searchFilters.reviewStatus);
      if (searchFilters.hashSet) qs.set('hashSet', searchFilters.hashSet);
      const resp = await apiFetch<Blob>(`/iped/hash/export?${qs}`, { rawResponse: true } as any);
      const blob = resp instanceof Blob ? resp : new Blob([JSON.stringify(resp)], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hash-export-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Export downloaded', 'success');
    } catch (err: any) {
      addToast(err.message || 'Export failed', 'error');
    }
  };

  // ── Duplicate Detection Actions ─────────────────────────

  const handleScanDuplicates = async () => {
    setDupScanning(true);
    try {
      const data = await apiFetch<any>('/iped/hash/duplicates');
      setDuplicates(data.clusters || data.data || []);
    } catch (err: any) {
      addToast(err.message || 'Duplicate scan failed', 'error');
    } finally {
      setDupScanning(false);
    }
  };

  const totalPages = Math.ceil(jobsTotal / 20) || 1;

  // ── Dashboard helpers ───────────────────────────────────

  const runningJob = jobs.find(j => j.status === 'running');
  const processingSpeed = runningJob && runningJob.items_processed && runningJob.started_at
    ? Math.round(runningJob.items_processed / Math.max(1, (Date.now() - new Date(runningJob.started_at).getTime()) / 1000))
    : null;
  const historyMax = Math.max(1, ...usageHistory.map((d: any) => (d.completed || 0) + (d.failed || 0)));

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="app-grid-bg h-full flex flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e3048]">
        <div className="flex items-center gap-2">
          <HardDrive size={16} className="text-brand-blue" />
          <h1 className="text-sm font-bold text-white tracking-wide uppercase">Digital Forensics</h1>
          <span className="text-[10px] text-slate-500 ml-1">IPED</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className={`p-1.5 rounded transition-colors ${showHelp ? 'bg-brand-blue/20 text-brand-blue' : 'hover:bg-[#1a2636] text-slate-400 hover:text-white'}`}
            title="Help & Instructions"
          >
            <HelpCircle size={14} />
          </button>
          <button
            onClick={() => { fetchStatus(); fetchJobs(); fetchHashSets(); fetchReviewStats(); fetchFlaggedHashes(); fetchUsageHistory(); }}
            className="p-1.5 rounded hover:bg-[#1a2636] text-slate-400 hover:text-white transition-colors"
            title="Refresh all"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => setShowNewJob(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-brand-blue/20 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/30 transition-colors"
          >
            <Plus size={13} />
            New Job
          </button>
        </div>
      </div>

      {/* ── Help & Instructions Panel ────────────────────── */}
      {showHelp && (
        <div className="border-b border-[#1e3048] bg-[#0d1520] overflow-y-auto" style={{ maxHeight: '60vh' }}>
          <div className="p-4 space-y-4 max-w-4xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-brand-blue" />
                <h2 className="text-sm font-bold text-white">Digital Forensics — User Guide</h2>
              </div>
              <button onClick={() => setShowHelp(false)} className="p-1 rounded text-slate-500 hover:text-white hover:bg-[#1a2636]">
                <X size={14} />
              </button>
            </div>

            {/* Section 1: Overview */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Overview
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                The Digital Forensics module provides cryptographic hashing, hash set matching, integrity verification, and evidence analysis capabilities. It integrates with the Evidence module to automatically hash uploaded files and alert officers when known-bad files are detected.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <span className="text-[10px] text-brand-blue font-bold block">HASH ALGORITHMS</span>
                  <span className="text-[10px] text-slate-400">MD5, SHA-1, SHA-256, SHA-512</span>
                </div>
                <div className="bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <span className="text-[10px] text-brand-blue font-bold block">AUTO-HASH</span>
                  <span className="text-[10px] text-slate-400">Evidence uploads hashed automatically</span>
                </div>
                <div className="bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <span className="text-[10px] text-brand-blue font-bold block">HASH SETS</span>
                  <span className="text-[10px] text-slate-400">Known-bad & known-good file databases</span>
                </div>
                <div className="bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <span className="text-[10px] text-brand-blue font-bold block">CHAIN OF CUSTODY</span>
                  <span className="text-[10px] text-slate-400">Integrity verification with audit trail</span>
                </div>
              </div>
            </div>

            {/* Section 2: Hash Sets */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Hash Sets — What They Are
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Hash sets are databases of known file fingerprints (hashes). When evidence is uploaded, each file&apos;s hash is computed and checked against loaded hash sets. There are two categories:
              </p>
              <div className="space-y-1.5 mt-2">
                <div className="flex items-start gap-2 bg-red-900/10 border border-red-800/20 rounded p-2">
                  <AlertTriangle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-[10px] font-bold text-red-400 block">KNOWN BAD</span>
                    <span className="text-[10px] text-slate-400">Files identified as malware, contraband, illegal content, fraud tools, weapons manufacturing guides, stalkerware, etc. A match triggers an immediate alert and flags the evidence for supervisor review. Sources: NSRL, ProjectVIC, NCMEC, VirusTotal, FBI HashKeeper, DEA, ATF.</span>
                  </div>
                </div>
                <div className="flex items-start gap-2 bg-green-900/10 border border-green-800/20 rounded p-2">
                  <CheckCircle size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-[10px] font-bold text-green-400 block">KNOWN GOOD</span>
                    <span className="text-[10px] text-slate-400">Common operating system files, applications, and media that can be safely excluded from analysis. Matching files are NOT threats — they are standard software. Sources: NIST NSRL Reference Data Set.</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Importing Hash Sets */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Importing Hash Sets — Step by Step
              </h3>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded px-1.5 py-0.5 flex-shrink-0">1</span>
                  <span className="text-[10px] text-slate-300">Click the <span className="text-brand-blue font-semibold">Import Hash Set</span> button in the Hash Sets panel below.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded px-1.5 py-0.5 flex-shrink-0">2</span>
                  <span className="text-[10px] text-slate-300">Use the <span className="text-brand-blue font-semibold">dropdown menu</span> to select from pre-built hash sets. The system ships with 11 sets covering malware, drugs, weapons, fraud, cybercrime, stalkerware, contraband, exploitation, OS files, office apps, and media files.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded px-1.5 py-0.5 flex-shrink-0">3</span>
                  <span className="text-[10px] text-slate-300">Selecting a set auto-fills the name, category, and hash type. You can adjust these before importing.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded px-1.5 py-0.5 flex-shrink-0">4</span>
                  <span className="text-[10px] text-slate-300">Click <span className="text-brand-blue font-semibold">Import</span> to load the selected set, or click <span className="text-emerald-400 font-semibold">Import All</span> to bulk-import every available set at once.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded px-1.5 py-0.5 flex-shrink-0">5</span>
                  <span className="text-[10px] text-slate-300">For custom hash sets: enter the file path manually (e.g., <code className="font-mono text-slate-400 bg-[#0d1520] px-1 rounded">/opt/rmpg-flex/server/hash-sets/custom.md5</code>). The file format is one hash per line, with optional <code className="font-mono text-slate-400 bg-[#0d1520] px-1 rounded">hash,filename</code> CSV pairs. Lines starting with <code className="font-mono text-slate-400 bg-[#0d1520] px-1 rounded">#</code> are treated as comments.</span>
                </div>
              </div>
              <div className="bg-[#141e2b] rounded p-2 border border-[#1e3048] mt-2">
                <span className="text-[10px] text-slate-500 font-mono block">Example hash set file format:</span>
                <pre className="text-[10px] text-slate-400 font-mono mt-1 leading-relaxed">{`# Comment line (ignored)
# Category: known_bad
d41d8cd98f00b204e9800998ecf8427e,suspicious_file.exe
44d88612fea8a8f36de82e1278abb02f,malware_sample.dll
3395856ce81f2b7382dee72602f798b6`}</pre>
              </div>
            </div>

            {/* Section 4: Auto-Hash on Upload */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Auto-Hash on Evidence Upload
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                When evidence attachments are uploaded, the system <span className="text-white font-semibold">automatically computes MD5, SHA-1, SHA-256, and SHA-512 hashes</span> for each file. These hashes are immediately checked against all loaded hash sets.
              </p>
              <div className="space-y-1.5 mt-2">
                <div className="flex items-start gap-2 bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <Shield size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[10px] text-slate-400"><span className="text-green-400 font-bold">NO MATCH</span> — File is clean. Hash is stored for chain of custody. Evidence shows a green dot in the list.</span>
                </div>
                <div className="flex items-start gap-2 bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <AlertTriangle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[10px] text-slate-400"><span className="text-red-400 font-bold">KNOWN BAD MATCH</span> — File matches a threat hash set. A real-time WebSocket alert is broadcast to all connected officers. Evidence shows a red dot. The hash is added to the Review Queue for supervisor disposition.</span>
                </div>
                <div className="flex items-start gap-2 bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <CheckCircle size={12} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[10px] text-slate-400"><span className="text-blue-400 font-bold">KNOWN GOOD MATCH</span> — File is a known OS/application file. Can be safely excluded from forensic analysis to focus on relevant evidence.</span>
                </div>
              </div>
            </div>

            {/* Section 5: Review Workflow */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Review Workflow — Handling Flagged Hashes
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                When a file is flagged (matches a known-bad hash set), it appears in the <span className="text-white font-semibold">Hash Review Queue</span> below. Supervisors must review each flagged hash and assign a disposition:
              </p>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="bg-red-900/10 border border-red-800/20 rounded p-2 text-center">
                  <span className="text-[10px] font-bold text-red-400 block">CONFIRMED THREAT</span>
                  <span className="text-[9px] text-slate-500">File is verified as malicious/illegal. Preserved as evidence.</span>
                </div>
                <div className="bg-green-900/10 border border-green-800/20 rounded p-2 text-center">
                  <span className="text-[10px] font-bold text-green-400 block">FALSE POSITIVE</span>
                  <span className="text-[9px] text-slate-500">Hash matched but file is benign. Cleared from review.</span>
                </div>
                <div className="bg-amber-900/10 border border-amber-800/20 rounded p-2 text-center">
                  <span className="text-[10px] font-bold text-amber-400 block">NEEDS ANALYSIS</span>
                  <span className="text-[9px] text-slate-500">Requires deeper investigation. Assigned for follow-up.</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                All review actions are audit-logged with the reviewer&apos;s name, timestamp, and notes. This creates a court-admissible chain of custody for digital evidence.
              </p>
            </div>

            {/* Section 6: Integrity Verification */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Integrity Verification — Tamper Detection
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                From the <span className="text-white font-semibold">Evidence &gt; Digital Forensics</span> tab, click <span className="text-brand-blue font-semibold">Verify Integrity</span> to re-hash all files and compare against the original stored hashes. This proves evidence has not been altered since collection.
              </p>
              <div className="space-y-1.5 mt-2">
                <div className="flex items-start gap-2 bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <CheckCircle size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[10px] text-slate-400"><span className="text-green-400 font-bold">VERIFIED</span> — All hashes match. Evidence integrity confirmed. Green banner displayed.</span>
                </div>
                <div className="flex items-start gap-2 bg-[#141e2b] rounded p-2 border border-[#1e3048]">
                  <AlertTriangle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[10px] text-slate-400"><span className="text-red-400 font-bold">INTEGRITY ALERT</span> — Hash mismatch detected! Evidence may have been tampered with. Red alert displayed with original vs. current hash comparison. Automatically audit-logged and flagged.</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Run verification before presenting evidence in court to establish an unbroken chain of custody. Every verification attempt is recorded in the audit log.
              </p>
            </div>

            {/* Section 7: Search & Export */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Search & Export for Court
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Use the <span className="text-white font-semibold">Hash Search</span> panel to find files by hash value across all evidence. Paste a full or partial MD5/SHA-256 hash to locate matching files. Filter by flagged status, review disposition, hash set, and date range.
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
                Click <span className="text-brand-blue font-semibold">Export CSV</span> to generate a court-ready report containing evidence numbers, file names, all hash values, flagged status, review disposition, reviewer name, and timestamps. The CSV includes a UTF-8 BOM for proper Excel rendering.
              </p>
            </div>

            {/* Section 8: Duplicate Detection */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Duplicate Detection
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                The <span className="text-white font-semibold">Duplicate Detection</span> panel scans all evidence for files with identical MD5 hashes. This reveals when the same file appears across multiple evidence items — useful for linking cases, identifying copied contraband, or finding redundant evidence.
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                Results are grouped by hash cluster showing all matching files with their evidence IDs and timestamps.
              </p>
            </div>

            {/* Section 9: Available Hash Sets */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> Pre-Built Hash Sets Reference
              </h3>
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-slate-500 uppercase">
                      <th className="text-left py-1 pr-3">Set Name</th>
                      <th className="text-left py-1 pr-3">Category</th>
                      <th className="text-left py-1 pr-3">Type</th>
                      <th className="text-left py-1">Contents</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-400">
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-red-400">Malware & Exploit Tools</td><td className="pr-3"><span className="text-red-400">Known Bad</span></td><td className="pr-3">MD5</td><td>Ransomware, RATs, keyloggers, crypto miners</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-red-400">Drug Manufacturing</td><td className="pr-3"><span className="text-red-400">Known Bad</span></td><td className="pr-3">MD5</td><td>Synth guides, dealer tools, darknet software</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-red-400">Weapons & Explosives</td><td className="pr-3"><span className="text-red-400">Known Bad</span></td><td className="pr-3">MD5</td><td>Ghost gun STLs, explosive manuals, trafficking</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-red-400">Contraband Media</td><td className="pr-3"><span className="text-red-400">Known Bad</span></td><td className="pr-3">SHA-256</td><td>NCMEC/ProjectVIC reference IDs</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-red-400">Financial Fraud</td><td className="pr-3"><span className="text-red-400">Known Bad</span></td><td className="pr-3">MD5</td><td>CC skimmers, check fraud, identity theft tools</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-red-400">Cybercrime Tools</td><td className="pr-3"><span className="text-red-400">Known Bad</span></td><td className="pr-3">MD5</td><td>DDoS kits, exploits, ransomware builders</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-red-400">Human Trafficking</td><td className="pr-3"><span className="text-red-400">Known Bad</span></td><td className="pr-3">SHA-256</td><td>DHS/HSI Blue Campaign reference hashes</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-red-400">Stalkerware</td><td className="pr-3"><span className="text-red-400">Known Bad</span></td><td className="pr-3">MD5</td><td>Spyphone apps, GPS trackers, hidden cameras</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-green-400">OS System Files</td><td className="pr-3"><span className="text-green-400">Known Good</span></td><td className="pr-3">MD5</td><td>Windows, macOS, Linux system binaries</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-green-400">Office & Applications</td><td className="pr-3"><span className="text-green-400">Known Good</span></td><td className="pr-3">MD5</td><td>MS Office, Adobe, browsers, utilities</td></tr>
                    <tr className="border-t border-[#1e3048]/50"><td className="py-1 pr-3 text-green-400">Common Media</td><td className="pr-3"><span className="text-green-400">Known Good</span></td><td className="pr-3">MD5</td><td>Default wallpapers, sounds, stock photos</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                These are example/reference hashes for system testing. For production use, replace with actual databases from NIST NSRL, ProjectVIC/NCMEC (via ICAC task force), VirusTotal Intelligence, or FBI HashKeeper. Contact your agency&apos;s ICAC representative for access to law enforcement hash sets.
              </p>
            </div>

            {/* Section 10: IPED Processing */}
            <div className="card-glass rounded p-3 space-y-2">
              <h3 className="text-xs font-bold text-brand-blue uppercase flex items-center gap-1.5">
                <ChevronRight size={12} /> IPED Processing Jobs
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                For full disk imaging and deep forensic analysis, create an IPED processing job. IPED (Digital Evidence Processor) is a Java-based forensic tool that can:
              </p>
              <ul className="text-[10px] text-slate-400 space-y-1 ml-4 mt-1 list-disc">
                <li><span className="text-white font-semibold">Hash</span> — Compute hashes for all files in an evidence image or directory</li>
                <li><span className="text-white font-semibold">Process</span> — Full forensic processing: file carving, metadata extraction, timeline generation</li>
                <li><span className="text-white font-semibold">Triage</span> — Quick assessment: prioritize files by type, extract key artifacts</li>
                <li><span className="text-white font-semibold">CSAM Scan</span> — Scan for known child exploitation material using PhotoDNA/hash matching</li>
              </ul>
              <p className="text-[10px] text-slate-500 mt-2">
                IPED must be installed on the server with Java 11+. Configure the installation path in Admin &gt; System &gt; IPED Settings.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content (scrollable) ─────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── First-Time Onboarding Banner ─────────────── */}
        {stats.totalJobs === 0 && stats.totalHashes === 0 && hashSets.length === 0 && !hashSetsLoading && (
          <div className="card-glass rounded-lg p-4 border border-brand-blue/20 bg-gradient-to-r from-brand-blue/5 to-transparent">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-brand-blue/10 border border-brand-blue/20 flex-shrink-0">
                <Shield size={20} className="text-brand-blue" />
              </div>
              <div className="flex-1 space-y-2">
                <h2 className="text-sm font-bold text-white">Welcome to Digital Forensics</h2>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  This module automatically hashes evidence files, detects known threats, verifies evidence integrity for court, and provides forensic analysis tools. Get started in 3 steps:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                  <button
                    onClick={() => {
                      setShowImportHashSet(true);
                      setSelectedAvailableSet('');
                      setImportData({ filePath: '', setName: '', category: 'known_bad', hashType: 'md5' });
                      apiFetch('/iped/hash-sets/available').then((res: any) => setAvailableHashSets(res?.data || [])).catch(() => setAvailableHashSets([]));
                    }}
                    className="flex items-center gap-2 p-3 rounded bg-[#141e2b] border border-[#1e3048] hover:border-brand-blue/40 hover:bg-brand-blue/5 transition-all text-left group"
                  >
                    <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">1</span>
                    <div>
                      <span className="text-[11px] font-semibold text-white group-hover:text-brand-blue transition-colors block">Import Hash Sets</span>
                      <span className="text-[9px] text-slate-500">Load 11 pre-built sets with 215 hashes</span>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 p-3 rounded bg-[#141e2b] border border-[#1e3048] text-left">
                    <span className="text-[10px] font-bold text-slate-500 bg-[#0d1520] rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">2</span>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Upload Evidence</span>
                      <span className="text-[9px] text-slate-600">Files auto-hashed & checked on upload</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded bg-[#141e2b] border border-[#1e3048] text-left">
                    <span className="text-[10px] font-bold text-slate-500 bg-[#0d1520] rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">3</span>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 block">Review & Verify</span>
                      <span className="text-[9px] text-slate-600">Disposition flagged files, verify integrity</span>
                    </div>
                  </div>
                </div>
                <p className="text-[9px] text-slate-600 mt-1">
                  Click the <HelpCircle size={9} className="inline text-slate-500" /> button in the header for the full user guide.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Stats Cards ────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard label="Total Jobs" value={stats.totalJobs} icon={Database} color="text-slate-300" />
          {/* Running card with mini progress bar */}
          <div className="card-glass rounded px-3 py-2.5 flex items-center gap-3">
            <div className="p-1.5 rounded bg-[#0d1520] text-amber-400">
              <Activity size={14} className={stats.runningJobs > 0 ? 'animate-pulse' : ''} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold text-white leading-none">{stats.runningJobs}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Running</p>
              {runningJob && runningJob.progress_percent != null && (
                <div className="w-full h-1 bg-[#0d1520] rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${runningJob.progress_percent}%` }} />
                </div>
              )}
              {processingSpeed != null && processingSpeed > 0 && (
                <p className="text-[9px] text-amber-400/70 mt-0.5">{processingSpeed} files/sec</p>
              )}
            </div>
          </div>
          <StatCard label="Completed" value={stats.completedJobs} icon={CheckCircle} color="text-green-400" />
          <StatCard label="Failed" value={stats.failedJobs} icon={AlertTriangle} color="text-red-400" />
          <StatCard label="Total Hashes" value={stats.totalHashes} icon={Hash} color="text-blue-400" />
          <StatCard label="Flagged" value={stats.flaggedHashes} icon={Shield} color="text-red-400" />
          <StatCard label="Queue Depth" value={queueDepth} icon={Clock} color="text-blue-300" />
          {/* Pending Review card */}
          <div className="card-glass rounded px-3 py-2.5 flex items-center gap-3">
            <div className={`p-1.5 rounded bg-[#0d1520] ${(reviewStats?.pending || 0) > 0 ? 'text-red-400' : 'text-amber-400'}`}>
              <Eye size={14} />
            </div>
            <div>
              <p className="text-lg font-bold text-white leading-none">{reviewStats?.pending || 0}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Pending Review</p>
            </div>
          </div>
        </div>

        {/* ── 30-Day History Chart ─────────────────────────── */}
        {usageHistory.length > 0 && (
          <div className="card-glass rounded">
            <PanelTitleBar title="30-DAY HISTORY" icon={BarChart3} />
            <div className="p-3">
              <div className="flex items-end gap-[2px] h-20">
                {usageHistory.map((day: any, i: number) => {
                  const completed = day.completed || 0;
                  const failed = day.failed || 0;
                  const total = completed + failed;
                  const height = Math.max(2, (total / historyMax) * 100);
                  const failedHeight = total > 0 ? (failed / total) * height : 0;
                  const completedHeight = height - failedHeight;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end items-stretch" title={`${day.date || ''}: ${completed} completed, ${failed} failed`}>
                      {failedHeight > 0 && (
                        <div className="bg-red-500/70 rounded-t-sm" style={{ height: `${failedHeight}%` }} />
                      )}
                      <div className="bg-green-500/70 rounded-t-sm" style={{ height: `${completedHeight}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                {usageHistory.filter((_: any, i: number) => {
                  const step = Math.max(1, Math.floor(usageHistory.length / 7));
                  return i % step === 0 || i === usageHistory.length - 1;
                }).slice(0, 7).map((day: any, i: number) => (
                  <span key={i} className="text-[8px] text-slate-600">{day.date ? new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Hash Sets Panel ────────────────────────────── */}
        <div className="card-glass rounded">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3048]">
            <div className="flex items-center gap-2">
              <Database size={13} className="text-brand-blue" />
              <span className="text-xs font-bold text-white uppercase tracking-wide">Hash Sets</span>
              <span className="text-[10px] text-slate-500">({hashSets.length})</span>
            </div>
            <button
              onClick={() => {
                setShowImportHashSet(true);
                setSelectedAvailableSet('');
                setImportData({ filePath: '', setName: '', category: 'known_bad', hashType: 'md5' });
                apiFetch('/iped/hash-sets/available').then((res: any) => {
                  setAvailableHashSets(res?.data || []);
                }).catch(() => setAvailableHashSets([]));
              }}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-brand-blue/10 text-brand-blue border border-brand-blue/20 hover:bg-brand-blue/20 transition-colors"
            >
              <Upload size={10} />
              Import
            </button>
          </div>
          <div className="p-3">
            {hashSetsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-slate-500" />
              </div>
            ) : hashSets.length === 0 ? (
              <div className="p-4 space-y-3">
                <div className="text-center space-y-2">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-brand-blue/10 border border-brand-blue/20">
                    <Database size={18} className="text-brand-blue" />
                  </div>
                  <h3 className="text-sm font-bold text-white">No Hash Sets Loaded</h3>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                    Hash sets are databases of known file fingerprints used to identify threats in evidence. Import sets to enable automatic detection.
                  </p>
                </div>
                <div className="bg-[#0d1520] border border-[#1e3048] rounded p-3 space-y-2">
                  <span className="text-[10px] font-bold text-brand-blue uppercase">Getting Started</span>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                      <span className="text-[10px] text-slate-300">Click <span className="text-brand-blue font-semibold">Import Hash Set</span> above</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                      <span className="text-[10px] text-slate-300">Click <span className="text-emerald-400 font-semibold">IMPORT ALL 11 SETS</span> for instant setup (215 hashes)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                      <span className="text-[10px] text-slate-300">Upload evidence — files are automatically hashed and checked</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[9px]">
                  <div className="bg-red-900/10 border border-red-800/20 rounded p-2">
                    <span className="text-red-400 font-bold block">KNOWN BAD</span>
                    <span className="text-slate-500">Malware, drugs, weapons, fraud, stalkerware, contraband, trafficking, cybercrime</span>
                  </div>
                  <div className="bg-green-900/10 border border-green-800/20 rounded p-2">
                    <span className="text-green-400 font-bold block">KNOWN GOOD</span>
                    <span className="text-slate-500">OS files, Office apps, browsers, media — safely exclude from analysis</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {hashSets.map((hs) => (
                  <div key={hs.name} className="flex items-center justify-between px-3 py-2 rounded bg-[#0d1520] border border-[#1e3048] group">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{hs.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${hs.category === 'known_bad' ? 'bg-red-900/40 text-red-400' : 'bg-green-900/40 text-green-400'}`}>
                          {hs.category === 'known_bad' ? 'Known Bad' : hs.category}
                        </span>
                        <span className="text-[10px] text-slate-500">{hs.count.toLocaleString()} hashes</span>
                        <span className="text-[10px] text-slate-600">{hs.hashType?.toUpperCase() || 'MD5'}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveHashSet(hs.name)}
                      className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all"
                      title="Remove hash set"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Job Queue ──────────────────────────────────── */}
        <div className="card-glass rounded flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3048]">
            <div className="flex items-center gap-2">
              <Server size={13} className="text-brand-blue" />
              <span className="text-xs font-bold text-white uppercase tracking-wide">Job Queue</span>
              <span className="text-[10px] text-slate-500">({jobsTotal})</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Status filter */}
              <select
                value={jobsFilter}
                onChange={(e) => { setJobsFilter(e.target.value); setJobsPage(1); }}
                className="text-[10px] bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-2 py-1 focus:outline-none focus:border-brand-blue/50"
              >
                <option value="">All Status</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          {/* Jobs table */}
          <div className="flex-1 overflow-auto">
            {jobsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={18} className="animate-spin text-slate-500" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No jobs found.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-[#1e3048]">
                    <th className="text-left px-3 py-2 font-semibold">ID</th>
                    <th className="text-left px-3 py-2 font-semibold">Type</th>
                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                    <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Input</th>
                    <th className="text-left px-3 py-2 font-semibold hidden lg:table-cell">Created By</th>
                    <th className="text-left px-3 py-2 font-semibold">Started</th>
                    <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Duration</th>
                    <th className="text-left px-3 py-2 font-semibold hidden lg:table-cell">Progress</th>
                    <th className="text-right px-3 py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const Icon = STATUS_ICONS[job.status] || Clock;
                    return (
                      <tr
                        key={job.id}
                        onClick={() => fetchJobDetail(job.id)}
                        className={`border-b border-[#1e3048]/50 cursor-pointer transition-colors hover:bg-[#1a2636]/60 ${selectedJob?.id === job.id ? 'bg-brand-blue/10' : ''}`}
                      >
                        <td className="px-3 py-2 font-mono text-slate-400">#{job.id}</td>
                        <td className="px-3 py-2 text-slate-300">{JOB_TYPE_LABELS[job.job_type] || job.job_type}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${STATUS_STYLES[job.status] || 'bg-slate-800 text-slate-400'}`}>
                            <Icon size={10} />
                            {job.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 truncate max-w-[200px] hidden md:table-cell" title={job.input_path}>
                          {job.input_path}
                        </td>
                        <td className="px-3 py-2 text-slate-400 hidden lg:table-cell">{job.created_by_name || '--'}</td>
                        <td className="px-3 py-2 text-slate-400">{formatDate(job.started_at)}</td>
                        <td className="px-3 py-2 text-slate-400 font-mono hidden md:table-cell">
                          {formatDuration(job.started_at, job.completed_at)}
                        </td>
                        <td className="px-3 py-2 hidden lg:table-cell">
                          {job.status === 'running' && job.progress_percent != null ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-[#0d1520] rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-500 rounded-full transition-all"
                                  style={{ width: `${job.progress_percent}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-amber-400">{job.progress_percent}%</span>
                            </div>
                          ) : job.status === 'completed' ? (
                            <span className="text-[10px] text-green-500">100%</span>
                          ) : (
                            <span className="text-[10px] text-slate-600">--</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {job.status === 'running' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCancelJob(job.id); }}
                                className="p-1 rounded text-red-400 hover:bg-red-900/20 transition-colors"
                                title="Cancel job"
                              >
                                <Square size={12} />
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); fetchJobDetail(job.id); }}
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1a2636] transition-colors"
                              title="View details"
                            >
                              <Eye size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-[#1e3048]">
              <span className="text-[10px] text-slate-500">
                Page {jobsPage} of {totalPages} ({jobsTotal} total)
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={jobsPage <= 1}
                  onClick={() => setJobsPage(p => p - 1)}
                  className="px-2 py-1 text-[10px] rounded bg-[#0d1520] border border-[#1e3048] text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                >
                  Prev
                </button>
                <button
                  disabled={jobsPage >= totalPages}
                  onClick={() => setJobsPage(p => p + 1)}
                  className="px-2 py-1 text-[10px] rounded bg-[#0d1520] border border-[#1e3048] text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Job Detail Panel ───────────────────────────── */}
        {selectedJob && (
          <div className="card-glass rounded">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3048]">
              <div className="flex items-center gap-2">
                <FileText size={13} className="text-brand-blue" />
                <span className="text-xs font-bold text-white">Job #{selectedJob.id} Detail</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${STATUS_STYLES[selectedJob.status] || ''}`}>
                  {selectedJob.status}
                </span>
              </div>
              <button
                onClick={() => { setSelectedJob(null); setJobHashes([]); setJobProgress(null); }}
                className="p-1 rounded text-slate-500 hover:text-white hover:bg-[#1a2636] transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-3 space-y-3">
              {detailLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={16} className="animate-spin text-slate-500" />
                </div>
              ) : (
                <>
                  {/* Job metadata */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase">Type</span>
                      <p className="text-slate-300 font-semibold">{JOB_TYPE_LABELS[selectedJob.job_type] || selectedJob.job_type}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase">Profile</span>
                      <p className="text-slate-300 font-semibold">{selectedJob.profile || '--'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase">Created By</span>
                      <p className="text-slate-300 font-semibold">{selectedJob.created_by_name || '--'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase">Duration</span>
                      <p className="text-slate-300 font-mono font-semibold">
                        {formatDuration(selectedJob.started_at, selectedJob.completed_at)}
                      </p>
                    </div>
                  </div>

                  {/* Input / Output paths */}
                  <div className="text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 uppercase w-14 shrink-0">Input</span>
                      <code className="text-slate-400 bg-[#0d1520] px-2 py-0.5 rounded text-[10px] font-mono truncate flex-1">
                        {selectedJob.input_path}
                      </code>
                    </div>
                    {selectedJob.output_path && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 uppercase w-14 shrink-0">Output</span>
                        <code className="text-slate-400 bg-[#0d1520] px-2 py-0.5 rounded text-[10px] font-mono truncate flex-1">
                          {selectedJob.output_path}
                        </code>
                      </div>
                    )}
                  </div>

                  {/* Progress bar for running jobs */}
                  {selectedJob.status === 'running' && selectedJob.progress_percent != null && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">Progress</span>
                        <span className="text-amber-400 font-semibold">{selectedJob.progress_percent}%</span>
                      </div>
                      <div className="w-full h-2 bg-[#0d1520] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full transition-all"
                          style={{ width: `${selectedJob.progress_percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Result summary */}
                  {selectedJob.result_summary && (
                    <div className="bg-[#0d1520] border border-[#1e3048] rounded px-3 py-2">
                      <span className="text-[10px] text-slate-500 uppercase block mb-1">Result Summary</span>
                      <p className="text-xs text-slate-300">{selectedJob.result_summary}</p>
                    </div>
                  )}

                  {/* Error message */}
                  {selectedJob.error_message && (
                    <div className="bg-red-950/30 border border-red-900/50 rounded px-3 py-2">
                      <span className="text-[10px] text-red-400 uppercase block mb-1">Error</span>
                      <p className="text-xs text-red-300 font-mono">{selectedJob.error_message}</p>
                    </div>
                  )}

                  {/* Items stats */}
                  {(selectedJob.items_found != null || selectedJob.items_processed != null) && (
                    <div className="flex items-center gap-4 text-xs">
                      {selectedJob.items_found != null && (
                        <div className="flex items-center gap-1">
                          <Search size={11} className="text-slate-500" />
                          <span className="text-slate-400">Found: <strong className="text-white">{selectedJob.items_found}</strong></span>
                        </div>
                      )}
                      {selectedJob.items_processed != null && (
                        <div className="flex items-center gap-1">
                          <CheckCircle size={11} className="text-slate-500" />
                          <span className="text-slate-400">Processed: <strong className="text-white">{selectedJob.items_processed}</strong></span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hash results table */}
                  {jobHashes.length > 0 && (
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block mb-2">Hash Results ({jobHashes.length})</span>
                      <div className="overflow-auto max-h-48 border border-[#1e3048] rounded">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="text-slate-500 uppercase border-b border-[#1e3048] bg-[#0d1520]">
                              <th className="text-left px-2 py-1">File</th>
                              <th className="text-left px-2 py-1">MD5</th>
                              <th className="text-left px-2 py-1 hidden lg:table-cell">SHA-256</th>
                              <th className="text-center px-2 py-1">Flagged</th>
                            </tr>
                          </thead>
                          <tbody>
                            {jobHashes.map((h) => (
                              <tr key={h.id} className="border-b border-[#1e3048]/30">
                                <td className="px-2 py-1 text-slate-300 truncate max-w-[140px]">{h.attachment_name || `Att #${h.attachment_id}`}</td>
                                <td className="px-2 py-1 text-slate-500 font-mono truncate max-w-[120px]" title={h.md5}>{h.md5}</td>
                                <td className="px-2 py-1 text-slate-500 font-mono truncate max-w-[160px] hidden lg:table-cell" title={h.sha256}>{h.sha256}</td>
                                <td className="px-2 py-1 text-center">
                                  {h.flagged ? (
                                    <span className="inline-flex items-center gap-0.5 text-red-400">
                                      <AlertTriangle size={10} />
                                      {h.flag_reason || 'YES'}
                                    </span>
                                  ) : (
                                    <span className="text-green-600">--</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {/* ── Hash Review Queue (Phase 3) ─────────────────── */}
        <div className="card-glass rounded">
          <PanelTitleBar title="HASH REVIEW QUEUE" icon={Shield} statusLed={flaggedHashes.length > 0 ? 'amber' : 'off'}>
            <span className="text-[10px] text-slate-500">({flaggedHashes.length} pending)</span>
          </PanelTitleBar>
          <div className="p-3">
            {flaggedHashes.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No hashes pending review.</p>
            ) : (
              <div className="overflow-auto max-h-64 border border-[#1e3048] rounded">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-slate-500 uppercase border-b border-[#1e3048] bg-[#0d1520]">
                      <th className="text-left px-2 py-1.5">File</th>
                      <th className="text-left px-2 py-1.5">Evidence #</th>
                      <th className="text-left px-2 py-1.5">MD5</th>
                      <th className="text-left px-2 py-1.5 hidden lg:table-cell">SHA-256</th>
                      <th className="text-left px-2 py-1.5">Matched Set</th>
                      <th className="text-left px-2 py-1.5">Category</th>
                      <th className="text-left px-2 py-1.5">Notes</th>
                      <th className="text-right px-2 py-1.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flaggedHashes.map((h: any) => (
                      <tr key={h.id} className="border-b border-[#1e3048]/30 hover:bg-[#1a2636]/40">
                        <td className="px-2 py-1.5 text-slate-300 truncate max-w-[120px]">{h.attachment_name || h.file_name || '--'}</td>
                        <td className="px-2 py-1.5 text-slate-400 font-mono">{h.evidence_id || '--'}</td>
                        <td className="px-2 py-1.5 text-slate-500 font-mono truncate max-w-[100px]" title={h.md5}>{h.md5?.slice(0, 12)}...</td>
                        <td className="px-2 py-1.5 text-slate-500 font-mono truncate max-w-[120px] hidden lg:table-cell" title={h.sha256}>{h.sha256?.slice(0, 16)}...</td>
                        <td className="px-2 py-1.5 text-slate-400">{h.matched_set || h.flag_reason || '--'}</td>
                        <td className="px-2 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${h.category === 'known_bad' ? 'bg-red-900/40 text-red-400' : 'bg-slate-800 text-slate-400'}`}>
                            {h.category || 'unknown'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            placeholder="Notes..."
                            value={reviewNotes[h.id] || ''}
                            onChange={(e) => setReviewNotes(prev => ({ ...prev, [h.id]: e.target.value }))}
                            className="w-20 text-[9px] bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-brand-blue/50"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleReview(h.id, 'confirmed_threat')}
                              className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-900/30 text-red-400 border border-red-800/40 hover:bg-red-900/50 transition-colors"
                              title="Confirm as threat"
                            >
                              Threat
                            </button>
                            <button
                              onClick={() => handleReview(h.id, 'false_positive')}
                              className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-green-900/50 transition-colors"
                              title="Mark as false positive"
                            >
                              False Positive
                            </button>
                            <button
                              onClick={() => handleReview(h.id, 'needs_analysis')}
                              className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-900/30 text-amber-400 border border-amber-800/40 hover:bg-amber-900/50 transition-colors"
                              title="Needs further analysis"
                            >
                              Analyze
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Hash Search Panel (Phase 6) ──────────────────── */}
        <div className="card-glass rounded">
          <PanelTitleBar title="HASH SEARCH" icon={Search} />
          <div className="p-3 space-y-3">
            {/* Search controls */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Hash Value</label>
                <input
                  type="text"
                  value={searchHash}
                  onChange={(e) => setSearchHash(e.target.value)}
                  placeholder="Paste MD5 or SHA-256..."
                  className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-1.5 focus:outline-none focus:border-brand-blue/50 font-mono placeholder-slate-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Flagged</label>
                <select
                  value={searchFilters.flagged}
                  onChange={(e) => setSearchFilters(f => ({ ...f, flagged: e.target.value }))}
                  className="text-[10px] bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-brand-blue/50"
                >
                  <option value="">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Review Status</label>
                <select
                  value={searchFilters.reviewStatus}
                  onChange={(e) => setSearchFilters(f => ({ ...f, reviewStatus: e.target.value }))}
                  className="text-[10px] bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-brand-blue/50"
                >
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="confirmed_threat">Confirmed</option>
                  <option value="false_positive">False Positive</option>
                  <option value="needs_analysis">Needs Analysis</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Hash Set</label>
                <select
                  value={searchFilters.hashSet}
                  onChange={(e) => setSearchFilters(f => ({ ...f, hashSet: e.target.value }))}
                  className="text-[10px] bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-brand-blue/50"
                >
                  <option value="">All Sets</option>
                  {hashSets.map(hs => (
                    <option key={hs.name} value={hs.name}>{hs.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleHashSearch}
                disabled={searchLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-brand-blue/20 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/30 transition-colors disabled:opacity-50"
              >
                {searchLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                Search
              </button>
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#1a2636] text-slate-300 border border-[#1e3048] hover:text-white transition-colors"
              >
                <Download size={11} />
                Export CSV
              </button>
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="overflow-auto max-h-56 border border-[#1e3048] rounded">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-slate-500 uppercase border-b border-[#1e3048] bg-[#0d1520]">
                      <th className="text-left px-2 py-1.5">File</th>
                      <th className="text-left px-2 py-1.5">Evidence #</th>
                      <th className="text-left px-2 py-1.5">MD5</th>
                      <th className="text-left px-2 py-1.5 hidden lg:table-cell">SHA-256</th>
                      <th className="text-center px-2 py-1.5">Flagged</th>
                      <th className="text-left px-2 py-1.5">Review Status</th>
                      <th className="text-left px-2 py-1.5">Set Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((r: any, i: number) => (
                      <tr key={r.id || i} className="border-b border-[#1e3048]/30 hover:bg-[#1a2636]/40">
                        <td className="px-2 py-1.5 text-slate-300 truncate max-w-[120px]">{r.attachment_name || r.file_name || '--'}</td>
                        <td className="px-2 py-1.5 text-slate-400 font-mono">{r.evidence_id || '--'}</td>
                        <td className="px-2 py-1.5 text-slate-500 font-mono truncate max-w-[100px]" title={r.md5}>{r.md5}</td>
                        <td className="px-2 py-1.5 text-slate-500 font-mono truncate max-w-[120px] hidden lg:table-cell" title={r.sha256}>{r.sha256}</td>
                        <td className="px-2 py-1.5 text-center">
                          {r.flagged ? <span className="text-red-400">YES</span> : <span className="text-slate-600">--</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                            r.review_status === 'confirmed_threat' ? 'bg-red-900/40 text-red-400' :
                            r.review_status === 'false_positive' ? 'bg-green-900/40 text-green-400' :
                            r.review_status === 'needs_analysis' ? 'bg-amber-900/40 text-amber-400' :
                            'bg-slate-800 text-slate-400'
                          }`}>
                            {r.review_status || 'pending'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-slate-400">{r.set_name || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {searchResults.length === 0 && !searchLoading && (
              <p className="text-xs text-slate-500 text-center py-2">Enter a hash or apply filters and click Search.</p>
            )}
          </div>
        </div>

        {/* ── Duplicate Detection Panel (Phase 7) ──────────── */}
        <div className="card-glass rounded">
          <PanelTitleBar title="DUPLICATE DETECTION" icon={Copy}>
            <button
              onClick={handleScanDuplicates}
              disabled={dupScanning}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-brand-blue/10 text-brand-blue border border-brand-blue/20 hover:bg-brand-blue/20 transition-colors disabled:opacity-50"
            >
              {dupScanning ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
              Scan for Duplicates
            </button>
          </PanelTitleBar>
          <div className="p-3">
            {dupScanning ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={16} className="animate-spin text-slate-500 mr-2" />
                <span className="text-xs text-slate-400">Scanning for duplicates...</span>
              </div>
            ) : duplicates.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No duplicates found across evidence.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-auto">
                {duplicates.map((cluster: any, ci: number) => (
                  <div key={ci} className="bg-[#0d1520] border border-[#1e3048] rounded p-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Hash size={10} className="text-amber-400" />
                      <span className="text-[10px] text-amber-400 font-mono truncate" title={cluster.hash}>{cluster.hash}</span>
                      <span className="text-[9px] text-slate-500">({cluster.files?.length || 0} files)</span>
                    </div>
                    <div className="space-y-1 ml-4">
                      {(cluster.files || []).map((f: any, fi: number) => (
                        <div key={fi} className="flex items-center gap-3 text-[10px]">
                          <span className="text-slate-300 truncate max-w-[200px]">{f.name || f.file_name || f.attachment_name || '--'}</span>
                          <span className="text-slate-500 font-mono">Ev #{f.evidence_id || '--'}</span>
                          <span className="text-slate-600">{f.created_at ? formatDate(f.created_at) : '--'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── New Job Modal ────────────────────────────────── */}
      {showNewJob && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setShowNewJob(false)}>
          <div className="card-glass rounded-lg w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e3048]">
              <div className="flex items-center gap-2">
                <Plus size={14} className="text-brand-blue" />
                <span className="text-sm font-bold text-white">Create Processing Job</span>
              </div>
              <button onClick={() => setShowNewJob(false)} className="p-1 rounded text-slate-500 hover:text-white hover:bg-[#1a2636] transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {/* Job type */}
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Job Type</label>
                <select
                  value={newJob.jobType}
                  onChange={(e) => setNewJob(j => ({ ...j, jobType: e.target.value }))}
                  className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50"
                >
                  <option value="hash">Hash Computation</option>
                  <option value="process">Full Processing</option>
                  <option value="triage">Triage Scan</option>
                  <option value="csam_scan">CSAM Scan</option>
                </select>
              </div>

              {/* Input path */}
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Input Path *</label>
                <input
                  type="text"
                  value={newJob.inputPath}
                  onChange={(e) => setNewJob(j => ({ ...j, inputPath: e.target.value }))}
                  placeholder="/path/to/evidence"
                  className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50 font-mono placeholder-slate-600"
                />
              </div>

              {/* Output path */}
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Output Path (optional)</label>
                <input
                  type="text"
                  value={newJob.outputPath}
                  onChange={(e) => setNewJob(j => ({ ...j, outputPath: e.target.value }))}
                  placeholder="/path/to/output"
                  className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50 font-mono placeholder-slate-600"
                />
              </div>

              {/* Evidence ID */}
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Evidence ID (optional)</label>
                <input
                  type="text"
                  value={newJob.evidenceId}
                  onChange={(e) => setNewJob(j => ({ ...j, evidenceId: e.target.value }))}
                  placeholder="e.g. 42"
                  className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50 placeholder-slate-600"
                />
              </div>

              {/* Profile */}
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">IPED Profile</label>
                <input
                  type="text"
                  value={newJob.profile}
                  onChange={(e) => setNewJob(j => ({ ...j, profile: e.target.value }))}
                  placeholder="forensic"
                  className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50 placeholder-slate-600"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1e3048]">
              <button
                onClick={() => setShowNewJob(false)}
                className="px-3 py-1.5 text-xs rounded bg-[#1a2636] text-slate-400 hover:text-white border border-[#1e3048] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateJob}
                disabled={newJobSubmitting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-brand-blue text-white hover:bg-brand-blue/80 disabled:opacity-50 transition-colors"
              >
                {newJobSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Create Job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import Hash Set Modal ────────────────────────── */}
      {showImportHashSet && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setShowImportHashSet(false)}>
          <div className="card-glass rounded-lg w-full max-w-2xl mx-4 shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e3048]">
              <div className="flex items-center gap-2">
                <Upload size={14} className="text-brand-blue" />
                <span className="text-sm font-bold text-white">Import Hash Set</span>
                <span className="text-[10px] text-slate-500">Select a set below or enter a custom path</span>
              </div>
              <button onClick={() => setShowImportHashSet(false)} className="p-1 rounded text-slate-500 hover:text-white hover:bg-[#1a2636] transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* ── Quick Import: Visual Card Grid ─────────── */}
              {availableHashSets.length > 0 && (
                <>
                  {/* Import All banner */}
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Import all ${availableHashSets.length} hash sets? This loads ${availableHashSets.reduce((s: number, h: any) => s + h.hashCount, 0)} total hashes.`)) return;
                      setImportSubmitting(true);
                      let imported = 0;
                      for (const set of availableHashSets) {
                        try {
                          await apiFetch('/iped/hash-sets/import', {
                            method: 'POST',
                            body: JSON.stringify({ filePath: set.filePath, setName: set.displayName, category: set.category, hashType: set.hashType }),
                          });
                          imported++;
                        } catch { /* skip failed */ }
                      }
                      setImportSubmitting(false);
                      addToast(`Imported ${imported} of ${availableHashSets.length} hash sets`, 'success');
                      setShowImportHashSet(false);
                      fetchHashSets();
                      fetchStatus();
                    }}
                    disabled={importSubmitting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded bg-gradient-to-r from-emerald-600/20 to-brand-blue/20 text-emerald-400 border border-emerald-600/30 hover:from-emerald-600/30 hover:to-brand-blue/30 disabled:opacity-50 transition-all"
                  >
                    {importSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                    IMPORT ALL {availableHashSets.length} SETS ({availableHashSets.reduce((s: number, h: any) => s + h.hashCount, 0)} hashes)
                  </button>

                  {/* Known Bad section */}
                  {availableHashSets.filter((s: any) => s.category === 'known_bad').length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <AlertTriangle size={11} className="text-red-400" />
                        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Known Bad — Threat Detection</span>
                        <span className="text-[9px] text-slate-600 ml-1">Flags evidence matching these hashes</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {availableHashSets.filter((s: any) => s.category === 'known_bad').map((set: any) => (
                          <button
                            key={set.fileName}
                            onClick={() => {
                              setSelectedAvailableSet(set.fileName);
                              setImportData({ filePath: set.filePath, setName: set.displayName, category: set.category, hashType: set.hashType });
                            }}
                            className={`text-left rounded p-2.5 border transition-all ${
                              selectedAvailableSet === set.fileName
                                ? 'bg-red-900/20 border-red-600/40 ring-1 ring-red-500/30'
                                : 'bg-[#141e2b] border-[#1e3048] hover:border-red-800/40 hover:bg-red-900/10'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-white">{set.displayName}</span>
                              {selectedAvailableSet === set.fileName && <CheckCircle size={12} className="text-red-400" />}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-800/20 font-mono">{set.hashType?.toUpperCase() || 'MD5'}</span>
                              <span className="text-[9px] text-slate-500">{set.hashCount} hashes</span>
                            </div>
                            {set.description && <p className="text-[9px] text-slate-500 mt-1 leading-relaxed line-clamp-2">{set.description}</p>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Known Good section */}
                  {availableHashSets.filter((s: any) => s.category === 'known_good').length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <CheckCircle size={11} className="text-green-400" />
                        <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">Known Good — Safe Exclusion</span>
                        <span className="text-[9px] text-slate-600 ml-1">Excludes common OS/app files from analysis</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {availableHashSets.filter((s: any) => s.category === 'known_good').map((set: any) => (
                          <button
                            key={set.fileName}
                            onClick={() => {
                              setSelectedAvailableSet(set.fileName);
                              setImportData({ filePath: set.filePath, setName: set.displayName, category: set.category, hashType: set.hashType });
                            }}
                            className={`text-left rounded p-2.5 border transition-all ${
                              selectedAvailableSet === set.fileName
                                ? 'bg-green-900/20 border-green-600/40 ring-1 ring-green-500/30'
                                : 'bg-[#141e2b] border-[#1e3048] hover:border-green-800/40 hover:bg-green-900/10'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-white">{set.displayName}</span>
                              {selectedAvailableSet === set.fileName && <CheckCircle size={12} className="text-green-400" />}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-800/20 font-mono">{set.hashType?.toUpperCase() || 'MD5'}</span>
                              <span className="text-[9px] text-slate-500">{set.hashCount} hashes</span>
                            </div>
                            {set.description && <p className="text-[9px] text-slate-500 mt-1 leading-relaxed line-clamp-2">{set.description}</p>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Upload / Paste / Manual Section ──────────── */}
              <div className="border-t border-[#1e3048] pt-3 space-y-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Upload size={11} className="text-slate-400" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Upload or Create Custom Hash Set</span>
                </div>

                {/* Drag & drop / file picker / paste zone */}
                <div
                  className="relative border-2 border-dashed border-[#1e3048] hover:border-brand-blue/40 rounded p-3 text-center transition-colors cursor-pointer group"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-brand-blue/60', 'bg-brand-blue/5'); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove('border-brand-blue/60', 'bg-brand-blue/5'); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('border-brand-blue/60', 'bg-brand-blue/5');
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const text = reader.result as string;
                      const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
                      setImportData(d => ({
                        ...d,
                        filePath: '__upload__',
                        setName: d.setName || file.name.replace(/\.\w+$/, '').replace(/[-_]/g, ' '),
                        hashType: file.name.endsWith('.sha256') ? 'sha256' : file.name.endsWith('.sha1') ? 'sha1' : 'md5',
                      }));
                      setSelectedAvailableSet('');
                      // Store content for upload
                      (window as any).__hashSetUploadContent = text;
                      (window as any).__hashSetUploadFileName = file.name;
                      addToast(`Loaded ${lines.length} hashes from ${file.name}`, 'success');
                    };
                    reader.readAsText(file);
                  }}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.md5,.sha256,.sha1,.csv,.txt';
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const text = reader.result as string;
                        const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
                        setImportData(d => ({
                          ...d,
                          filePath: '__upload__',
                          setName: d.setName || file.name.replace(/\.\w+$/, '').replace(/[-_]/g, ' '),
                          hashType: file.name.endsWith('.sha256') ? 'sha256' : file.name.endsWith('.sha1') ? 'sha1' : 'md5',
                        }));
                        setSelectedAvailableSet('');
                        (window as any).__hashSetUploadContent = text;
                        (window as any).__hashSetUploadFileName = file.name;
                        addToast(`Loaded ${lines.length} hashes from ${file.name}`, 'success');
                      };
                      reader.readAsText(file);
                    };
                    input.click();
                  }}
                >
                  <Upload size={16} className="mx-auto text-slate-500 group-hover:text-brand-blue transition-colors mb-1" />
                  <p className="text-[10px] text-slate-400 group-hover:text-slate-300">
                    <span className="text-brand-blue font-semibold">Click to browse</span> or drag & drop a hash set file
                  </p>
                  <p className="text-[9px] text-slate-600 mt-0.5">Accepts .md5, .sha256, .sha1, .csv, .txt — one hash per line</p>
                  {importData.filePath === '__upload__' && (
                    <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-emerald-400">
                      <CheckCircle size={10} />
                      <span>File loaded: {(window as any).__hashSetUploadFileName}</span>
                    </div>
                  )}
                </div>

                {/* Paste hashes directly */}
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">Or paste hashes directly (one per line)</label>
                  <textarea
                    rows={3}
                    placeholder={"d41d8cd98f00b204e9800998ecf8427e,file1.exe\n44d88612fea8a8f36de82e1278abb02f,file2.dll\n3395856ce81f2b7382dee72602f798b6"}
                    className="w-full text-[10px] bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50 font-mono placeholder-slate-600 resize-none"
                    onChange={(e) => {
                      const text = e.target.value;
                      if (text.trim()) {
                        (window as any).__hashSetUploadContent = text;
                        (window as any).__hashSetUploadFileName = 'pasted-hashes.md5';
                        setImportData(d => ({ ...d, filePath: '__upload__' }));
                        setSelectedAvailableSet('');
                      }
                    }}
                  />
                </div>

                {/* Divider */}
                <div className="flex items-center gap-2 text-[9px] text-slate-600">
                  <div className="flex-1 border-t border-[#1e3048]" />
                  <span>or enter server file path</span>
                  <div className="flex-1 border-t border-[#1e3048]" />
                </div>

                {/* Server file path dropdown */}
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">Server File Path</label>
                  <select
                    value={importData.filePath === '__upload__' ? '' : importData.filePath}
                    onChange={(e) => {
                      const path = e.target.value;
                      setSelectedAvailableSet('');
                      (window as any).__hashSetUploadContent = undefined;
                      if (path) {
                        const set = availableHashSets.find((s: any) => s.filePath === path);
                        setImportData(d => ({
                          ...d,
                          filePath: path,
                          setName: set?.displayName || d.setName,
                          category: set?.category || d.category,
                          hashType: set?.hashType || d.hashType,
                        }));
                      } else {
                        setImportData(d => ({ ...d, filePath: '' }));
                      }
                    }}
                    className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-1.5 focus:outline-none focus:border-brand-blue/50 font-mono"
                  >
                    <option value="">-- Select a file from server --</option>
                    {availableHashSets.map((s: any) => (
                      <option key={s.filePath} value={s.filePath}>
                        {s.fileName} ({s.hashCount} hashes, {s.category})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Name / Category / Type */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Set Name</label>
                    <input
                      type="text"
                      value={importData.setName}
                      onChange={(e) => setImportData(d => ({ ...d, setName: e.target.value }))}
                      placeholder="My Custom Set"
                      className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-1.5 focus:outline-none focus:border-brand-blue/50 placeholder-slate-600"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Category</label>
                    <select
                      value={importData.category}
                      onChange={(e) => setImportData(d => ({ ...d, category: e.target.value }))}
                      className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-1.5 focus:outline-none focus:border-brand-blue/50"
                    >
                      <option value="known_bad">Known Bad</option>
                      <option value="known_good">Known Good</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Hash Type</label>
                    <select
                      value={importData.hashType}
                      onChange={(e) => setImportData(d => ({ ...d, hashType: e.target.value }))}
                      className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-1.5 focus:outline-none focus:border-brand-blue/50"
                    >
                      <option value="md5">MD5</option>
                      <option value="sha1">SHA-1</option>
                      <option value="sha256">SHA-256</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e3048]">
              {selectedAvailableSet ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                  <CheckCircle size={10} className="text-brand-blue" />
                  <span>Selected: <span className="text-white font-semibold">{importData.setName}</span></span>
                </div>
              ) : importData.filePath ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono truncate max-w-[250px]">
                  <FileText size={10} /> {importData.filePath}
                </div>
              ) : (
                <span className="text-[10px] text-slate-600">Select a set above or enter a path</span>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowImportHashSet(false)}
                  className="px-3 py-1.5 text-xs rounded bg-[#1a2636] text-slate-400 hover:text-white border border-[#1e3048] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportHashSet}
                  disabled={importSubmitting || (!importData.filePath && !selectedAvailableSet)}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded bg-brand-blue text-white hover:bg-brand-blue/80 disabled:opacity-40 transition-colors"
                >
                  {importSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Import Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stat Card Sub-component ─────────────────────────────────

function StatCard({ label, value, icon: Icon, color, pulse }: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div className="card-glass rounded px-3 py-2.5 flex items-center gap-3">
      <div className={`p-1.5 rounded bg-[#0d1520] ${color}`}>
        <Icon size={14} className={pulse ? 'animate-pulse' : ''} />
      </div>
      <div>
        <p className="text-lg font-bold text-white leading-none">{value.toLocaleString()}</p>
        <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{label}</p>
      </div>
    </div>
  );
}
