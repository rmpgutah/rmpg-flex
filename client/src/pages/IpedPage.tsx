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
  ChevronDown, Activity, Server, Shield,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';

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

  // ── Effects ───────────────────────────────────────────────

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

  const handleRemoveHashSet = async (name: string) => {
    try {
      await apiFetch(`/iped/hash-sets/${encodeURIComponent(name)}`, { method: 'DELETE' });
      addToast(`Hash set "${name}" removed`, 'success');
      fetchHashSets();
    } catch (err: any) {
      addToast(err.message || 'Failed to remove hash set', 'error');
    }
  };

  const totalPages = Math.ceil(jobsTotal / 20) || 1;

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
            onClick={() => { fetchStatus(); fetchJobs(); fetchHashSets(); }}
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

      {/* ── Main Content (scrollable) ─────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Stats Cards ────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Total Jobs" value={stats.totalJobs} icon={Database} color="text-slate-300" />
          <StatCard label="Running" value={stats.runningJobs} icon={Activity} color="text-amber-400" pulse={stats.runningJobs > 0} />
          <StatCard label="Completed" value={stats.completedJobs} icon={CheckCircle} color="text-green-400" />
          <StatCard label="Failed" value={stats.failedJobs} icon={AlertTriangle} color="text-red-400" />
          <StatCard label="Total Hashes" value={stats.totalHashes} icon={Hash} color="text-blue-400" />
          <StatCard label="Flagged" value={stats.flaggedHashes} icon={Shield} color="text-red-400" />
        </div>

        {/* ── Hash Sets Panel ────────────────────────────── */}
        <div className="card-glass rounded">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3048]">
            <div className="flex items-center gap-2">
              <Database size={13} className="text-brand-blue" />
              <span className="text-xs font-bold text-white uppercase tracking-wide">Hash Sets</span>
              <span className="text-[10px] text-slate-500">({hashSets.length})</span>
            </div>
            <button
              onClick={() => setShowImportHashSet(true)}
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
              <p className="text-xs text-slate-500 text-center py-3">No hash sets loaded. Import one to begin.</p>
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
                        <span className="text-[10px] text-slate-600">{hs.hashType.toUpperCase()}</span>
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
          <div className="card-glass rounded-lg w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e3048]">
              <div className="flex items-center gap-2">
                <Upload size={14} className="text-brand-blue" />
                <span className="text-sm font-bold text-white">Import Hash Set</span>
              </div>
              <button onClick={() => setShowImportHashSet(false)} className="p-1 rounded text-slate-500 hover:text-white hover:bg-[#1a2636] transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">File Path *</label>
                <input
                  type="text"
                  value={importData.filePath}
                  onChange={(e) => setImportData(d => ({ ...d, filePath: e.target.value }))}
                  placeholder="/path/to/hashset.txt"
                  className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50 font-mono placeholder-slate-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Set Name *</label>
                <input
                  type="text"
                  value={importData.setName}
                  onChange={(e) => setImportData(d => ({ ...d, setName: e.target.value }))}
                  placeholder="NSRL Known Bad"
                  className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50 placeholder-slate-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-1">Category</label>
                  <select
                    value={importData.category}
                    onChange={(e) => setImportData(d => ({ ...d, category: e.target.value }))}
                    className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50"
                  >
                    <option value="known_bad">Known Bad</option>
                    <option value="known_good">Known Good</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-1">Hash Type</label>
                  <select
                    value={importData.hashType}
                    onChange={(e) => setImportData(d => ({ ...d, hashType: e.target.value }))}
                    className="w-full text-xs bg-[#0d1520] border border-[#1e3048] text-slate-300 rounded px-3 py-2 focus:outline-none focus:border-brand-blue/50"
                  >
                    <option value="md5">MD5</option>
                    <option value="sha1">SHA-1</option>
                    <option value="sha256">SHA-256</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1e3048]">
              <button
                onClick={() => setShowImportHashSet(false)}
                className="px-3 py-1.5 text-xs rounded bg-[#1a2636] text-slate-400 hover:text-white border border-[#1e3048] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImportHashSet}
                disabled={importSubmitting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-brand-blue text-white hover:bg-brand-blue/80 disabled:opacity-50 transition-colors"
              >
                {importSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                Import
              </button>
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
