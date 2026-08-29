// ============================================================
// RMPG Flex — IPED Digital Forensics Page
// ============================================================
// Dashboard + job queue for IPED digital forensics processing.
// Hash set management, job creation/monitoring, hash results.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  HardDrive, Search, Plus, Loader2, X, RefreshCw, Play, Square, CheckCircle,
  AlertTriangle, Clock, Hash, Database, Trash2, Upload, FileText, Eye, Activity,
  Server, Shield,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { formatLabel, toDisplayLabel } from '../utils/formatters';
import { useToast } from '../components/ToastProvider';
import { parseTimestamp } from '../utils/dateUtils';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { downloadTextFile, ipedCasesToCsv } from '../utils/rmsListExport';
import { useSlashFocus } from '../hooks/useSlashFocus';

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
  queued:    'bg-surface-sunken/50 text-rmpg-400 border border-border-default/50',
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
  const start = parseTimestamp(startedAt).getTime();
  const end = completedAt ? parseTimestamp(completedAt).getTime() : Date.now();
  const sec = Math.floor((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function formatDate(d: string | null): string {
  if (!d) return '--';
  return parseTimestamp(d).toLocaleString('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── Component ───────────────────────────────────────────────

export default function IpedPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Role gates
  const canManage = user?.role === 'admin' || user?.role === 'manager';

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
  const [fetchError, setFetchError] = useState('');

  // Hash search
  const [hashSearchQuery, setHashSearchQuery] = useState('');
  const [hashSearchResults, setHashSearchResults] = useState<HashResult[]>([]);
  const [hashSearching, setHashSearching] = useState(false);
  const [hashSearchDone, setHashSearchDone] = useState(false);
  const [hashSearchError, setHashSearchError] = useState('');

  // ConfirmDialog state
  const [removeHashSetTarget, setRemoveHashSetTarget] = useState<string | null>(null);
  const [cancelJobTarget, setCancelJobTarget] = useState<number | null>(null);
  const [cancelJobLoading, setCancelJobLoading] = useState(false);
  const [removeHashSetLoading, setRemoveHashSetLoading] = useState(false);

  // Refs
  const hashSearchInputRef = useRef<HTMLInputElement>(null);
  useSlashFocus(hashSearchInputRef);
  const deepLinkRef = useRef(false);

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
    setFetchError('');
    try {
      const qs = new URLSearchParams({ page: String(jobsPage), limit: '20' });
      if (jobsFilter) qs.set('status', jobsFilter);
      const data = await apiFetch<any>(`/iped/jobs?${qs}`);
      setJobs(data.jobs || []);
      setJobsTotal(data.total || 0);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to load data');
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

  const handleHashSearch = useCallback(async () => {
    if (!hashSearchQuery.trim()) return;
    setHashSearching(true);
    setHashSearchError('');
    setHashSearchDone(false);
    try {
      const q = hashSearchQuery.trim();
      const data = await apiFetch<any>(`/iped/hashes/search?q=${encodeURIComponent(q)}`);
      const results = data.results || data.data || [];
      setHashSearchResults(results);
      setHashSearchDone(true);
    } catch (err: any) {
      setHashSearchError(err?.message || 'Search failed');
      setHashSearchResults([]);
      setHashSearchDone(true);
    } finally {
      setHashSearching(false);
    }
  }, [hashSearchQuery]);

  const fetchJobDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const data = await apiFetch<any>(`/iped/jobs/${id}`);
      setSelectedJob(data.job ?? data);
      setJobHashes(data.hashes || []);
      setJobProgress(data.progress || null);
    } catch (err: any) {
      addToast(err.message || 'Failed to load job', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [addToast]);

  // ── Effects ───────────────────────────────────────────────

  useEffect(() => { document.title = 'IPED Digital Forensics — RMPG Flex'; }, []);
  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => { fetchHashSets(); }, [fetchHashSets]);

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

  // ── Deep-link: ?job_id=<id> opens job detail ─────────────
  const jobIdParam = searchParams.get('job_id');
  useEffect(() => {
    if (jobsLoading || deepLinkRef.current || !jobIdParam) return;
    deepLinkRef.current = true;
    const id = Number(jobIdParam);
    if (Number.isFinite(id) && jobs.some(j => j.id === id)) {
      fetchJobDetail(id);
      const el = document.getElementById(`iped-job-row-${id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      addToast(`Job #${jobIdParam} not found.`, 'warning');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('job_id');
    setSearchParams(next, { replace: true });
  }, [jobsLoading, jobs, jobIdParam, searchParams, setSearchParams, addToast, fetchJobDetail]);

  // ── Deep-link: ?search=<val> auto-runs hash search ───────
  const searchParam = searchParams.get('search');
  const searchDeepLinkRef = useRef(false);
  useEffect(() => {
    if (searchDeepLinkRef.current || !searchParam) return;
    searchDeepLinkRef.current = true;
    setHashSearchQuery(searchParam);
    const next = new URLSearchParams(searchParams);
    next.delete('search');
    setSearchParams(next, { replace: true });
    // Defer to let state settle
    setTimeout(() => {
      apiFetch<any>(`/iped/hashes/search?q=${encodeURIComponent(searchParam)}`)
        .then(data => {
          const results = data.results || data.data || [];
          setHashSearchResults(results);
          setHashSearchDone(true);
          if (results.length === 0) addToast(`No hash matches for "${searchParam}".`, 'warning');
        })
        .catch((err: any) => {
          setHashSearchError(err?.message || 'Search failed');
          setHashSearchDone(true);
        });
    }, 100);
  }, [searchParam, searchParams, setSearchParams, addToast]);

  // ── N shortcut → focus hash search input ─────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (t.isContentEditable) return;
      e.preventDefault();
      hashSearchInputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Esc cascade ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (cancelJobTarget !== null) {
        e.stopPropagation();
        setCancelJobTarget(null);
        return;
      }
      if (removeHashSetTarget !== null) {
        e.stopPropagation();
        setRemoveHashSetTarget(null);
        return;
      }
      if (showNewJob) {
        e.stopPropagation();
        setShowNewJob(false);
        return;
      }
      if (showImportHashSet) {
        e.stopPropagation();
        setShowImportHashSet(false);
        return;
      }
      if (selectedJob) {
        e.stopPropagation();
        setSelectedJob(null);
        setJobHashes([]);
        setJobProgress(null);
        return;
      }
      if (hashSearchResults.length > 0 || hashSearchQuery) {
        e.stopPropagation();
        setHashSearchResults([]);
        setHashSearchQuery('');
        setHashSearchDone(false);
        setHashSearchError('');
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cancelJobTarget, removeHashSetTarget, showNewJob, showImportHashSet, selectedJob, hashSearchResults, hashSearchQuery]);

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

  const handleCancelJobConfirmed = async () => {
    if (cancelJobTarget === null) return;
    const id = cancelJobTarget;
    setCancelJobLoading(true);
    try {
      await apiFetch(`/iped/jobs/${id}/cancel`, { method: 'POST' });
      addToast('Job cancelled', 'success');
      setCancelJobTarget(null);
      fetchJobs();
      fetchStatus();
      if (selectedJob?.id === id) fetchJobDetail(id);
    } catch (err: any) {
      addToast(err.message || 'Failed to cancel job', 'error');
    } finally {
      setCancelJobLoading(false);
    }
  };

  const handleImportHashSet = async () => {
    if (!importData.filePath.trim() || !importData.setName.trim()) {
      addToast('File path and set name are required', 'error');
      return;
    }
    setImportSubmitting(true);
    try {
      const data = await apiFetch<any>('/iped/hash-sets/import', {
        method: 'POST',
        body: JSON.stringify(importData),
      });
      addToast(`Imported ${data.imported} hashes into "${importData.setName}"`, 'success');
      setShowImportHashSet(false);
      setImportData({ filePath: '', setName: '', category: 'known_bad', hashType: 'md5' });
      fetchHashSets();
    } catch (err: any) {
      addToast(err.message || 'Failed to import hash set', 'error');
    } finally {
      setImportSubmitting(false);
    }
  };

  const handleRemoveHashSetConfirmed = async () => {
    if (!removeHashSetTarget) return;
    const name = removeHashSetTarget;
    setRemoveHashSetLoading(true);
    try {
      await apiFetch(`/iped/hash-sets/${encodeURIComponent(name)}`, { method: 'DELETE' });
      addToast(`Hash set "${name}" removed`, 'success');
      setRemoveHashSetTarget(null);
      fetchHashSets();
    } catch (err: any) {
      addToast(err.message || 'Failed to remove hash set', 'error');
    } finally {
      setRemoveHashSetLoading(false);
    }
  };

  const totalPages = Math.ceil(jobsTotal / 20) || 1;

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="app-grid-bg h-full flex flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
        <div className="flex items-center gap-2">
          <HardDrive size={16} className="text-brand-blue" />
          <h1 className="text-sm font-bold text-rmpg-100 tracking-wide uppercase">Digital Forensics</h1>
          <span className="text-[10px] text-rmpg-500 ml-1">IPED</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => { fetchStatus(); fetchJobs(); fetchHashSets(); }}
            className="p-1.5 rounded-sm hover:bg-surface-raised text-rmpg-400 hover:text-rmpg-100 transition-colors"
            title="Refresh all"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={jobs.length === 0}
            onClick={() => downloadTextFile('iped-jobs.csv', ipedCasesToCsv(jobs.map((j) => ({
              case_number: String(j.id),
              status: j.status,
              device_type: j.job_type,
              created_at: j.created_at,
            }))))}
          >CSV</button>
          {canManage && (
            <button type="button"
              onClick={() => setShowNewJob(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm bg-brand-blue/20 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/30 transition-colors"
            >
              <Plus size={13} />
              New Job
            </button>
          )}
        </div>
      </div>

      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
          <span>⚠ {fetchError}</span>
          <button type="button" className="toolbar-btn ml-auto" onClick={() => { void fetchJobs(); }}>Retry</button>
        </div>
      )}

      {/* ── Main Content (scrollable) ─────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">

        {/* ── Stats Cards ────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Total Jobs" value={stats.totalJobs} icon={Database} color="text-rmpg-300" />
          <StatCard label="Running" value={stats.runningJobs} icon={Activity} color="text-amber-400" pulse={stats.runningJobs > 0} />
          <StatCard label="Completed" value={stats.completedJobs} icon={CheckCircle} color="text-green-400" />
          <StatCard label="Failed" value={stats.failedJobs} icon={AlertTriangle} color="text-red-400" />
          <StatCard label="Total Hashes" value={stats.totalHashes} icon={Hash} color="text-rmpg-400" />
          <StatCard label="Flagged" value={stats.flaggedHashes} icon={Shield} color="text-red-400" />
        </div>

        {/* ── Hash Search ──────────────────────────────── */}
        <div className="card-glass rounded-sm">
          <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700">
            <div className="flex items-center gap-2">
              <Search size={13} className="text-brand-blue" />
              <span className="text-xs font-bold text-rmpg-100 uppercase tracking-wide">Hash Search</span>
            </div>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex gap-2">
              <input
                ref={hashSearchInputRef}
                id="ff-ipedpage-0"
                type="text"
                value={hashSearchQuery}
                onChange={e => { setHashSearchQuery(e.target.value); setHashSearchDone(false); }}
                onKeyDown={e => e.key === 'Enter' && handleHashSearch()}
                placeholder="Search MD5, SHA1, or SHA256 hash..." aria-label="Search MD5, SHA1, or SHA256 hash..."
                className="flex-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder-rmpg-500 font-mono outline-none"
              />
              <button type="button" onClick={handleHashSearch} disabled={hashSearching || !hashSearchQuery.trim()}
                className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold bg-brand-blue/20 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/30 disabled:opacity-50 transition-colors">
                {hashSearching ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                Search
              </button>
            </div>
            <div className="text-[9px] text-rmpg-500">Accepts MD5 (32 chars), SHA1 (40 chars), SHA256 (64 chars), or partial hashes · Press N to focus</div>

            {/* Empty states */}
            {hashSearching && (
              <div className="flex items-center gap-2 py-2 text-[10px] text-rmpg-500">
                <Loader2 size={11} className="animate-spin" />
                Searching…
              </div>
            )}
            {!hashSearching && hashSearchDone && hashSearchResults.length === 0 && !hashSearchError && (
              <div className="text-[10px] text-rmpg-500 py-2">No hash matches found.</div>
            )}
            {hashSearchError && (
              <div className="text-[10px] text-red-400">{hashSearchError}</div>
            )}
            {hashSearchResults.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {hashSearchResults.map(hr => (
                  <div key={hr.id} className={`p-2 border text-[10px] ${
                    hr.flagged ? 'bg-red-900/20 border-red-700/50' : 'bg-surface-sunken border-rmpg-700/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {hr.flagged ? (
                        <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />
                      ) : (
                        <Hash size={11} className="text-rmpg-400 flex-shrink-0" />
                      )}
                      <span className="text-rmpg-100 font-mono text-[9px] truncate">{hr.md5}</span>
                      {hr.flagged ? (
                        <span className="text-[8px] px-1 py-0.5 bg-red-900/50 text-red-400 border border-red-700/50 font-bold">FLAGGED</span>
                      ) : null}
                    </div>
                    {hr.attachment_name && <div className="text-rmpg-300 mt-0.5">File: {hr.attachment_name}</div>}
                    {hr.flag_reason && <div className="text-red-400 mt-0.5">Reason: {hr.flag_reason}</div>}
                    <div className="flex gap-3 mt-0.5 text-rmpg-500 font-mono text-[8px]">
                      <span>SHA1: {hr.sha1?.slice(0, 16)}...</span>
                      <span>SHA256: {hr.sha256?.slice(0, 16)}...</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Hash Sets Panel ────────────────────────────── */}
        <div className="card-glass rounded-sm">
          <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700">
            <div className="flex items-center gap-2">
              <Database size={13} className="text-brand-blue" />
              <span className="text-xs font-bold text-rmpg-100 uppercase tracking-wide">Hash Sets</span>
              <span className="text-[10px] text-rmpg-500">({hashSets.length})</span>
            </div>
            {canManage && (
              <button type="button"
                onClick={() => setShowImportHashSet(true)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-sm bg-brand-blue/10 text-brand-blue border border-brand-blue/20 hover:bg-brand-blue/20 transition-colors"
              >
                <Upload size={10} />
                Import
              </button>
            )}
          </div>
          <div className="p-3">
            {hashSetsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-rmpg-500" />
              </div>
            ) : hashSets.length === 0 ? (
              <p className="text-xs text-rmpg-500 text-center py-3">No hash sets loaded. Import one to begin.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {hashSets.map((hs) => (
                  <div key={hs.name} className="flex items-center justify-between px-3 py-2 rounded-sm bg-surface-sunken border border-rmpg-700 group">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-rmpg-100 truncate">{hs.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${hs.category === 'known_bad' ? 'bg-red-900/40 text-red-400' : 'bg-green-900/40 text-green-400'}`}>
                          {hs.category === 'known_bad' ? 'Known Bad' : hs.category}
                        </span>
                        <span className="text-[10px] text-rmpg-500">{hs.count.toLocaleString()} hashes</span>
                        <span className="text-[10px] text-rmpg-600">{(hs.hashType || 'MD5').toUpperCase()}</span>
                      </div>
                    </div>
                    {canManage && (
                      <button type="button"
                        onClick={() => setRemoveHashSetTarget(hs.name)}
                        className="p-1 rounded-sm text-rmpg-600 hover:text-red-400 hover:bg-red-900/20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-all"
                        title="Remove hash set"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Job Queue ──────────────────────────────────── */}
        <div className="card-glass rounded-sm flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700">
            <div className="flex items-center gap-2">
              <Server size={13} className="text-brand-blue" />
              <span className="text-xs font-bold text-rmpg-100 uppercase tracking-wide">Job Queue</span>
              <span className="text-[10px] text-rmpg-500">({jobsTotal})</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Status filter */}
              <select id="ff-ipedpage-1"
                value={jobsFilter}
                onChange={(e) => { setJobsFilter(e.target.value); setJobsPage(1); }}
                className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-2 py-1 focus:outline-none focus:border-brand-blue/50"
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
                <Loader2 size={18} className="animate-spin text-rmpg-500" />
                <span className="ml-2 text-xs text-rmpg-500">Loading jobs…</span>
              </div>
            ) : jobs.length === 0 && jobsFilter ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Search size={20} className="text-rmpg-600" />
                <p className="text-xs text-rmpg-500">No jobs match the selected filter.</p>
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Server size={20} className="text-rmpg-600" />
                <p className="text-xs text-rmpg-500">No jobs yet. Create a new processing job to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-rmpg-500 uppercase tracking-wider border-b border-rmpg-700">
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
                        id={`iped-job-row-${job.id}`}
                        key={job.id}
                        onClick={() => fetchJobDetail(job.id)}
                        className={`border-b border-rmpg-700/50 cursor-pointer transition-colors hover:bg-surface-raised/60 ${selectedJob?.id === job.id ? 'bg-brand-blue/10' : ''}`}
                      >
                        <td className="px-3 py-2 font-mono text-rmpg-400">#{job.id}</td>
                        <td className="px-3 py-2 text-rmpg-300">{JOB_TYPE_LABELS[job.job_type] || job.job_type}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-semibold ${STATUS_STYLES[job.status] || 'bg-rmpg-800 text-rmpg-400'}`}>
                            <Icon size={10} />
                            {toDisplayLabel(job.status || '')}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-rmpg-500 truncate max-w-[200px] hidden md:table-cell" title={job.input_path}>
                          {job.input_path}
                        </td>
                        <td className="px-3 py-2 text-rmpg-400 hidden lg:table-cell">{job.created_by_name || '--'}</td>
                        <td className="px-3 py-2 text-rmpg-400">{formatDate(job.started_at)}</td>
                        <td className="px-3 py-2 text-rmpg-400 font-mono hidden md:table-cell">
                          {formatDuration(job.started_at, job.completed_at)}
                        </td>
                        <td className="px-3 py-2 hidden lg:table-cell">
                          {job.status === 'running' && job.progress_percent != null ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
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
                            <span className="text-[10px] text-rmpg-600">--</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {job.status === 'running' && canManage && (
                              <button type="button"
                                onClick={(e) => { e.stopPropagation(); setCancelJobTarget(job.id); }}
                                className="p-1 rounded-sm text-red-400 hover:bg-red-900/20 transition-colors"
                                title="Cancel job"
                              >
                                <Square size={12} />
                              </button>
                            )}
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); fetchJobDetail(job.id); }}
                              className="p-1 rounded-sm text-rmpg-400 hover:text-rmpg-100 hover:bg-surface-raised transition-colors"
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
              </table></div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-rmpg-700">
              <span className="text-[10px] text-rmpg-500">
                Page {jobsPage} of {totalPages} ({jobsTotal} total)
              </span>
              <div className="flex items-center gap-1">
                <button type="button"
                  disabled={jobsPage <= 1}
                  onClick={() => setJobsPage(p => p - 1)}
                  className="px-2 py-1 text-[10px] rounded-sm bg-surface-sunken border border-rmpg-700 text-rmpg-400 hover:text-rmpg-100 disabled:opacity-40 transition-colors"
                >
                  Prev
                </button>
                <button type="button"
                  disabled={jobsPage >= totalPages}
                  onClick={() => setJobsPage(p => p + 1)}
                  className="px-2 py-1 text-[10px] rounded-sm bg-surface-sunken border border-rmpg-700 text-rmpg-400 hover:text-rmpg-100 disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Job Detail Panel ───────────────────────────── */}
        {selectedJob && (
          <div className="card-glass rounded-sm">
            <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700">
              <div className="flex items-center gap-2">
                <FileText size={13} className="text-brand-blue" />
                <span className="text-xs font-bold text-rmpg-100">Job #{selectedJob.id} Detail</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-semibold ${STATUS_STYLES[selectedJob.status] || ''}`}>
                  {formatLabel(selectedJob.status)}
                </span>
              </div>
              <button type="button"
                onClick={() => { setSelectedJob(null); setJobHashes([]); setJobProgress(null); }}
                className="p-1 rounded-sm text-rmpg-500 hover:text-rmpg-100 hover:bg-surface-raised transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-3 space-y-3">
              {detailLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={16} className="animate-spin text-rmpg-500" />
                </div>
              ) : (
                <>
                  {/* Job metadata */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-rmpg-500 uppercase">Type</span>
                      <p className="text-rmpg-300 font-semibold">{JOB_TYPE_LABELS[selectedJob.job_type] || selectedJob.job_type}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-rmpg-500 uppercase">Profile</span>
                      <p className="text-rmpg-300 font-semibold">{selectedJob.profile || '--'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-rmpg-500 uppercase">Created By</span>
                      <p className="text-rmpg-300 font-semibold">{selectedJob.created_by_name || '--'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-rmpg-500 uppercase">Duration</span>
                      <p className="text-rmpg-300 font-mono font-semibold">
                        {formatDuration(selectedJob.started_at, selectedJob.completed_at)}
                      </p>
                    </div>
                  </div>

                  {/* Input / Output paths */}
                  <div className="text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-rmpg-500 uppercase w-14 shrink-0">Input</span>
                      <code className="text-rmpg-400 bg-surface-sunken px-2 py-0.5 rounded-sm text-[10px] font-mono min-w-0 truncate flex-1">
                        {selectedJob.input_path}
                      </code>
                    </div>
                    {selectedJob.output_path && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-rmpg-500 uppercase w-14 shrink-0">Output</span>
                        <code className="text-rmpg-400 bg-surface-sunken px-2 py-0.5 rounded-sm text-[10px] font-mono min-w-0 truncate flex-1">
                          {selectedJob.output_path}
                        </code>
                      </div>
                    )}
                  </div>

                  {/* Progress bar for running jobs */}
                  {selectedJob.status === 'running' && selectedJob.progress_percent != null && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-rmpg-500">Progress</span>
                        <span className="text-amber-400 font-semibold">{selectedJob.progress_percent}%</span>
                      </div>
                      <div className="w-full h-2 bg-surface-sunken rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full transition-all"
                          style={{ width: `${selectedJob.progress_percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Result summary */}
                  {selectedJob.result_summary && (
                    <div className="bg-surface-sunken border border-rmpg-700 rounded-sm px-3 py-2">
                      <span className="text-[10px] text-rmpg-500 uppercase block mb-1">Result Summary</span>
                      <p className="text-xs text-rmpg-300">{selectedJob.result_summary}</p>
                    </div>
                  )}

                  {/* Error message */}
                  {selectedJob.error_message && (
                    <div className="bg-red-950/30 border border-red-900/50 rounded-sm px-3 py-2">
                      <span className="text-[10px] text-red-400 uppercase block mb-1">Error</span>
                      <p className="text-xs text-red-300 font-mono">{selectedJob.error_message}</p>
                    </div>
                  )}

                  {/* Items stats */}
                  {(selectedJob.items_found != null || selectedJob.items_processed != null) && (
                    <div className="flex items-center gap-4 text-xs">
                      {selectedJob.items_found != null && (
                        <div className="flex items-center gap-1">
                          <Search size={11} className="text-rmpg-500" />
                          <span className="text-rmpg-400">Found: <strong className="text-rmpg-100">{selectedJob.items_found}</strong></span>
                        </div>
                      )}
                      {selectedJob.items_processed != null && (
                        <div className="flex items-center gap-1">
                          <CheckCircle size={11} className="text-rmpg-500" />
                          <span className="text-rmpg-400">Processed: <strong className="text-rmpg-100">{selectedJob.items_processed}</strong></span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hash results table */}
                  {jobHashes.length > 0 && (
                    <div>
                      <span className="text-[10px] text-rmpg-500 uppercase block mb-2">Hash Results ({jobHashes.length})</span>
                      <div className="overflow-auto max-h-48 border border-rmpg-700 rounded-sm">
                        <div className="overflow-x-auto"><table className="w-full text-[10px]">
                          <thead>
                            <tr className="text-rmpg-500 uppercase border-b border-rmpg-700 bg-surface-sunken">
                              <th className="text-left px-2 py-1">File</th>
                              <th className="text-left px-2 py-1">MD5</th>
                              <th className="text-left px-2 py-1 hidden lg:table-cell">SHA-256</th>
                              <th className="text-center px-2 py-1">Flagged</th>
                            </tr>
                          </thead>
                          <tbody>
                            {jobHashes.map((h) => (
                              <tr key={h.id} className="border-b border-rmpg-700/30">
                                <td className="px-2 py-1 text-rmpg-300 truncate max-w-[140px]">{h.attachment_name || `Att #${h.attachment_id}`}</td>
                                <td className="px-2 py-1 text-rmpg-500 font-mono truncate max-w-[120px]" title={h.md5}>{h.md5}</td>
                                <td className="px-2 py-1 text-rmpg-500 font-mono truncate max-w-[160px] hidden lg:table-cell" title={h.sha256}>{h.sha256}</td>
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
                        </table></div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── New Job Modal ────────────────────────────────── */}
      {showNewJob && (
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 overflow-y-auto p-4" role="dialog" aria-modal="true" onClick={() => setShowNewJob(false)}>
          <div className="card-glass rounded-sm w-full max-w-md mx-4 shadow-md my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
              <div className="flex items-center gap-2">
                <Plus size={14} className="text-brand-blue" />
                <span className="text-sm font-bold text-rmpg-100">Create Processing Job</span>
              </div>
              <button type="button" onClick={() => setShowNewJob(false)} className="p-1 rounded-sm text-rmpg-500 hover:text-rmpg-100 hover:bg-surface-raised transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {/* Job type */}
              <div>
                <label htmlFor="ff-ipedpage-2" className="text-[10px] text-rmpg-500 uppercase block mb-1">Job Type</label>
                <select id="ff-ipedpage-2"
                  value={newJob.jobType}
                  onChange={(e) => setNewJob(j => ({ ...j, jobType: e.target.value }))}
                  className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50"
                >
                  <option value="hash">Hash Computation</option>
                  <option value="process">Full Processing</option>
                  <option value="triage">Triage Scan</option>
                  <option value="csam_scan">CSAM Scan</option>
                </select>
              </div>

              {/* Input path */}
              <div>
                <label htmlFor="ff-ipedpage-3" className="text-[10px] text-rmpg-500 uppercase block mb-1">Input Path *</label>
                <input id="ff-ipedpage-3"
                  type="text"
                  value={newJob.inputPath}
                  onChange={(e) => setNewJob(j => ({ ...j, inputPath: e.target.value }))}
                  placeholder="/path/to/evidence"
                  className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50 font-mono placeholder-rmpg-600"
                />
              </div>

              {/* Output path */}
              <div>
                <label htmlFor="ff-ipedpage-4" className="text-[10px] text-rmpg-500 uppercase block mb-1">Output Path (optional)</label>
                <input id="ff-ipedpage-4"
                  type="text"
                  value={newJob.outputPath}
                  onChange={(e) => setNewJob(j => ({ ...j, outputPath: e.target.value }))}
                  placeholder="/path/to/output"
                  className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50 font-mono placeholder-rmpg-600"
                />
              </div>

              {/* Evidence ID */}
              <div>
                <label htmlFor="ff-ipedpage-5" className="text-[10px] text-rmpg-500 uppercase block mb-1">Evidence ID (optional)</label>
                <input id="ff-ipedpage-5"
                  type="text"
                  value={newJob.evidenceId}
                  onChange={(e) => setNewJob(j => ({ ...j, evidenceId: e.target.value }))}
                  placeholder="e.g. 42"
                  className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50 placeholder-rmpg-600"
                />
              </div>

              {/* Profile */}
              <div>
                <label htmlFor="ff-ipedpage-6" className="text-[10px] text-rmpg-500 uppercase block mb-1">IPED Profile</label>
                <input id="ff-ipedpage-6"
                  type="text"
                  value={newJob.profile}
                  onChange={(e) => setNewJob(j => ({ ...j, profile: e.target.value }))}
                  placeholder="forensic"
                  className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50 placeholder-rmpg-600"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-rmpg-700">
              <button type="button"
                onClick={() => setShowNewJob(false)}
                className="px-3 py-1.5 text-xs rounded-sm bg-surface-raised text-rmpg-400 hover:text-rmpg-100 border border-rmpg-700 transition-colors"
              >
                Cancel
              </button>
              <button type="button"
                onClick={handleCreateJob}
                disabled={newJobSubmitting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm bg-brand-blue text-rmpg-100 hover:bg-brand-blue/80 disabled:opacity-50 transition-colors"
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
        <div className="fixed inset-0 z-50 print:hidden flex items-start justify-center bg-black/60 overflow-y-auto p-4" role="dialog" aria-modal="true" onClick={() => setShowImportHashSet(false)}>
          <div className="card-glass rounded-sm w-full max-w-md mx-4 shadow-md my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
              <div className="flex items-center gap-2">
                <Upload size={14} className="text-brand-blue" />
                <span className="text-sm font-bold text-rmpg-100">Import Hash Set</span>
              </div>
              <button type="button" onClick={() => setShowImportHashSet(false)} className="p-1 rounded-sm text-rmpg-500 hover:text-rmpg-100 hover:bg-surface-raised transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="ff-ipedpage-7" className="text-[10px] text-rmpg-500 uppercase block mb-1">File Path *</label>
                <input id="ff-ipedpage-7"
                  type="text"
                  value={importData.filePath}
                  onChange={(e) => setImportData(d => ({ ...d, filePath: e.target.value }))}
                  placeholder="/path/to/hashset.txt"
                  className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50 font-mono placeholder-rmpg-600"
                />
              </div>
              <div>
                <label htmlFor="ff-ipedpage-8" className="text-[10px] text-rmpg-500 uppercase block mb-1">Set Name *</label>
                <input id="ff-ipedpage-8"
                  type="text"
                  value={importData.setName}
                  onChange={(e) => setImportData(d => ({ ...d, setName: e.target.value }))}
                  placeholder="NSRL Known Bad"
                  className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50 placeholder-rmpg-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-ipedpage-9" className="text-[10px] text-rmpg-500 uppercase block mb-1">Category</label>
                  <select id="ff-ipedpage-9"
                    value={importData.category}
                    onChange={(e) => setImportData(d => ({ ...d, category: e.target.value }))}
                    className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50"
                  >
                    <option value="known_bad">Known Bad</option>
                    <option value="known_good">Known Good</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-ipedpage-10" className="text-[10px] text-rmpg-500 uppercase block mb-1">Hash Type</label>
                  <select id="ff-ipedpage-10"
                    value={importData.hashType}
                    onChange={(e) => setImportData(d => ({ ...d, hashType: e.target.value }))}
                    className="w-full text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-300 rounded-sm px-3 py-2 focus:outline-none focus:border-brand-blue/50"
                  >
                    <option value="md5">MD5</option>
                    <option value="sha1">SHA-1</option>
                    <option value="sha256">SHA-256</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-rmpg-700">
              <button type="button"
                onClick={() => setShowImportHashSet(false)}
                className="px-3 py-1.5 text-xs rounded-sm bg-surface-raised text-rmpg-400 hover:text-rmpg-100 border border-rmpg-700 transition-colors"
              >
                Cancel
              </button>
              <button type="button"
                onClick={handleImportHashSet}
                disabled={importSubmitting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm bg-brand-blue text-rmpg-100 hover:bg-brand-blue/80 disabled:opacity-50 transition-colors"
              >
                {importSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ConfirmDialog: Cancel Job ──────────────────────── */}
      <ConfirmDialog
        isOpen={cancelJobTarget !== null}
        onClose={() => setCancelJobTarget(null)}
        onConfirm={handleCancelJobConfirmed}
        title="Cancel Job"
        message="Stop this running job? Progress will be lost and the job will be marked as failed."
        details={cancelJobTarget !== null ? <span>Job #{cancelJobTarget}</span> : undefined}
        confirmLabel="Cancel Job"
        confirmVariant="warning"
        isLoading={cancelJobLoading}
      />

      {/* ── ConfirmDialog: Remove Hash Set ─────────────────── */}
      <ConfirmDialog
        isOpen={removeHashSetTarget !== null}
        onClose={() => setRemoveHashSetTarget(null)}
        onConfirm={handleRemoveHashSetConfirmed}
        title="Remove Hash Set"
        message="Remove this hash set? All associated hash entries will be permanently deleted. This cannot be undone."
        details={removeHashSetTarget ? <span>{removeHashSetTarget}</span> : undefined}
        confirmLabel="Remove"
        confirmVariant="danger"
        isLoading={removeHashSetLoading}
      />
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
    <div className="card-glass rounded-sm px-3 py-2.5 flex items-center gap-3">
      <div className={`p-1.5 rounded-sm bg-surface-sunken ${color}`}>
        <Icon size={14} className={pulse ? 'animate-pulse' : ''} />
      </div>
      <div>
        <p className="text-lg font-bold text-rmpg-100 leading-none">{value.toLocaleString()}</p>
        <p className="text-[10px] text-rmpg-500 uppercase tracking-wide mt-0.5">{label}</p>
      </div>
    </div>
  );
}
