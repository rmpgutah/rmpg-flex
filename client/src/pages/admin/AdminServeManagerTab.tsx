import React, { useState, useEffect, useCallback } from 'react';
import {
  Link2, Key, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Clock, Search, Eye, EyeOff, Trash2, Zap,
  ChevronLeft, ChevronRight, FileText, Briefcase, MapPin,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import type {
  SMIntegrationStatus, SMConnectionTestResult, SMSyncResult,
  SMSyncLogEntry, SMCachedJob, SMPaginatedResponse, SMCachedAttempt,
} from '../../types/servemanager';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

export default function AdminServeManagerTab({ LoadingSpinner, error, setError }: Props) {
  // ── Status ──
  const [status, setStatus] = useState<SMIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // ── API Key ──
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [testResult, setTestResult] = useState<SMConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // ── Sync ──
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<SMSyncLogEntry[]>([]);

  // ── Jobs browser ──
  const [jobs, setJobs] = useState<SMCachedJob[]>([]);
  const [jobSearch, setJobSearch] = useState('');
  const [jobPage, setJobPage] = useState(1);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobTotalPages, setJobTotalPages] = useState(0);
  const [loadingJobs, setLoadingJobs] = useState(false);

  // ── Job detail ──
  const [selectedJob, setSelectedJob] = useState<(SMCachedJob & { attempts?: SMCachedAttempt[] }) | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ── Data fetching ──

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SMIntegrationStatus>('/servemanager/status');
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch SM status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSyncLog = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: SMSyncLogEntry[] }>('/servemanager/sync/log');
      setSyncLog(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const params = new URLSearchParams({ page: String(jobPage), per_page: '25' });
      if (jobSearch) params.set('q', jobSearch);
      const res = await apiFetch<SMPaginatedResponse<SMCachedJob>>(`/servemanager/jobs?${params}`);
      setJobs(res.data);
      setJobTotal(res.pagination?.total || 0);
      setJobTotalPages(res.pagination?.totalPages || 0);
    } catch (err) {
      console.error('Failed to fetch SM jobs:', err);
    } finally {
      setLoadingJobs(false);
    }
  }, [jobSearch, jobPage]);

  useEffect(() => { fetchStatus(); fetchSyncLog(); }, [fetchStatus, fetchSyncLog]);
  useEffect(() => { if (status?.configured) fetchJobs(); }, [status?.configured, fetchJobs]);

  // ── Handlers ──

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    setTestResult(null);
    try {
      await apiFetch('/servemanager/api-key', { method: 'PUT', body: JSON.stringify({ api_key: apiKey }) });
      setApiKey('');
      setShowKey(false);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSavingKey(false);
    }
  };

  const handleClearKey = async () => {
    try {
      await apiFetch('/servemanager/api-key', { method: 'DELETE' });
      setTestResult(null);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear API key');
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<SMConnectionTestResult>('/servemanager/test-connection', { method: 'POST' });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async (type: 'full' | 'incremental') => {
    setSyncing(true);
    try {
      await apiFetch<SMSyncResult>('/servemanager/sync', { method: 'POST', body: JSON.stringify({ type }) });
      await fetchStatus();
      await fetchSyncLog();
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleViewJob = async (jobId: number) => {
    setLoadingDetail(true);
    try {
      const res = await apiFetch<{ data: SMCachedJob & { attempts?: SMCachedAttempt[] } }>(`/servemanager/jobs/${jobId}`);
      setSelectedJob(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job details');
    } finally {
      setLoadingDetail(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-brand-400" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">ServeManager Integration</h2>
        {status?.configured && (
          <span className="ml-2 flex items-center gap-1 text-green-400 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            CONNECTED
          </span>
        )}
        {!status?.configured && (
          <span className="ml-2 flex items-center gap-1 text-rmpg-500 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-rmpg-500" />
            NOT CONFIGURED
          </span>
        )}
      </div>

      {/* ═══ Section 1: API Key Management ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5" />
          API Key
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={status?.configured ? 'Enter new key to replace...' : 'Enter your ServeManager API key...'}
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300"
            >
              {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={savingKey || !apiKey.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
          >
            {savingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Save
          </button>
          {status?.configured && (
            <>
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Test
              </button>
              <button
                onClick={handleClearKey}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            </>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            testResult.success
              ? 'bg-green-950/30 border border-green-800/40 text-green-400'
              : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {testResult.success
              ? `Connected to ${testResult.account?.company_name || 'ServeManager'}`
              : `Connection failed: ${testResult.error}`
            }
          </div>
        )}
      </div>

      {/* ═══ Section 2: Sync Controls ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
              <RefreshCw className="w-3.5 h-3.5" />
              Data Sync
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSync('incremental')}
                disabled={syncing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Incremental Sync
              </button>
              <button
                onClick={() => handleSync('full')}
                disabled={syncing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Full Sync
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[10px] text-rmpg-400">Cached Jobs</div>
              <div className="text-lg font-bold font-mono text-rmpg-100">{status.cached_jobs}</div>
            </div>
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[10px] text-rmpg-400">Cached Attempts</div>
              <div className="text-lg font-bold font-mono text-rmpg-100">{status.cached_attempts}</div>
            </div>
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[10px] text-rmpg-400">Last Sync</div>
              <div className="text-xs font-mono text-rmpg-200">
                {status.last_sync
                  ? new Date(status.last_sync.completed_at || status.last_sync.started_at).toLocaleString()
                  : 'Never'}
              </div>
              {status.last_sync && (
                <div className={`text-[9px] mt-0.5 ${status.last_sync.status === 'completed' ? 'text-green-400' : status.last_sync.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>
                  {status.last_sync.status} — {status.last_sync.jobs_synced} jobs
                </div>
              )}
            </div>
          </div>

          {/* Sync history */}
          {syncLog.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-rmpg-400 font-bold">Sync History</div>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {syncLog.slice(0, 10).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 text-[10px] bg-surface-sunken px-2 py-1 rounded-sm">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      entry.status === 'completed' ? 'bg-green-400' : entry.status === 'failed' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'
                    }`} />
                    <span className="text-rmpg-300 font-mono">{entry.sync_type}</span>
                    <span className="text-rmpg-500">{entry.jobs_synced} jobs, {entry.attempts_synced} attempts</span>
                    <span className="ml-auto text-rmpg-500 whitespace-nowrap">{new Date(entry.started_at).toLocaleString()}</span>
                    {entry.error_message && (
                      <span className="text-red-400 truncate max-w-[200px]" title={entry.error_message}>
                        {entry.error_message}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 3: Jobs Browser ═══ */}
      {status?.configured && status.cached_jobs > 0 && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
              <Briefcase className="w-3.5 h-3.5" />
              Cached Jobs ({jobTotal})
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
                <input
                  type="text"
                  value={jobSearch}
                  onChange={(e) => { setJobSearch(e.target.value); setJobPage(1); }}
                  placeholder="Search jobs..."
                  className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] pl-7 pr-2 py-1 rounded-sm w-48 focus:border-brand-500 focus:outline-none"
                />
              </div>
              <button onClick={fetchJobs} className="toolbar-btn text-[10px] flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${loadingJobs ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Selected job detail */}
          {selectedJob && (
            <div className="bg-surface-sunken border border-rmpg-600 p-3 rounded-sm space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-brand-400" />
                  <span className="text-xs font-bold text-rmpg-100">Job #{selectedJob.sm_job_number}</span>
                  <ServiceStatusBadge status={selectedJob.service_status} />
                </div>
                <button onClick={() => setSelectedJob(null)} className="text-rmpg-500 hover:text-rmpg-300">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
                <div><span className="text-rmpg-500">Recipient:</span> <span className="text-rmpg-200">{selectedJob.recipient_name || '—'}</span></div>
                <div><span className="text-rmpg-500">Client:</span> <span className="text-rmpg-200">{selectedJob.client_company_name || '—'}</span></div>
                <div><span className="text-rmpg-500">Status:</span> <span className="text-rmpg-200">{selectedJob.job_status || '—'}</span></div>
                <div><span className="text-rmpg-500">Due:</span> <span className="text-rmpg-200">{selectedJob.due_date || '—'}</span></div>
                <div><span className="text-rmpg-500">Server:</span> <span className="text-rmpg-200">{selectedJob.process_server_name || '—'}</span></div>
                <div><span className="text-rmpg-500">Court Case:</span> <span className="text-rmpg-200">{selectedJob.court_case_number || '—'}</span></div>
              </div>
              {selectedJob.service_instructions && (
                <div className="text-[10px]">
                  <span className="text-rmpg-500">Instructions:</span>
                  <span className="text-rmpg-300 ml-1">{selectedJob.service_instructions}</span>
                </div>
              )}
              {/* Attempts */}
              {selectedJob.attempts && selectedJob.attempts.length > 0 && (
                <div className="space-y-1 mt-2">
                  <div className="text-[10px] font-bold text-rmpg-400">Attempts ({selectedJob.attempts.length})</div>
                  {selectedJob.attempts.map((att) => (
                    <div key={att.id} className="flex items-center gap-2 text-[10px] bg-rmpg-800/50 px-2 py-1 rounded-sm">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${att.success ? 'bg-green-400' : 'bg-amber-400'}`} />
                      <span className="text-rmpg-300">{att.service_status || 'Attempted'}</span>
                      {att.serve_type && <span className="text-rmpg-500">({att.serve_type})</span>}
                      {att.server_name && <span className="text-rmpg-400">{att.server_name}</span>}
                      {att.lat && att.lng && <MapPin className="w-3 h-3 text-rmpg-500" />}
                      <span className="ml-auto text-rmpg-500">{att.served_at ? new Date(att.served_at).toLocaleString() : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Jobs table */}
          {loadingJobs ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-rmpg-700 text-rmpg-400 text-left">
                    <th className="pb-1 pr-2 font-bold">Job #</th>
                    <th className="pb-1 pr-2 font-bold">Recipient</th>
                    <th className="pb-1 pr-2 font-bold">Status</th>
                    <th className="pb-1 pr-2 font-bold">Service</th>
                    <th className="pb-1 pr-2 font-bold">Client</th>
                    <th className="pb-1 pr-2 font-bold">Due</th>
                    <th className="pb-1 pr-2 font-bold text-center">Attempts</th>
                    <th className="pb-1 font-bold">Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => handleViewJob(job.id)}
                      className="border-b border-rmpg-800 hover:bg-rmpg-800/50 cursor-pointer transition-colors"
                    >
                      <td className="py-1 pr-2 font-mono text-brand-400">{job.sm_job_number}</td>
                      <td className="py-1 pr-2 text-rmpg-200 max-w-[120px] truncate">{job.recipient_name || '—'}</td>
                      <td className="py-1 pr-2 text-rmpg-300">{job.job_status || '—'}</td>
                      <td className="py-1 pr-2"><ServiceStatusBadge status={job.service_status} /></td>
                      <td className="py-1 pr-2 text-rmpg-300 max-w-[100px] truncate">{job.client_company_name || '—'}</td>
                      <td className="py-1 pr-2 text-rmpg-400 whitespace-nowrap">{job.due_date || '—'}</td>
                      <td className="py-1 pr-2 text-center font-mono text-rmpg-300">{job.attempt_count}</td>
                      <td className="py-1 text-rmpg-500 whitespace-nowrap">{new Date(job.synced_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-rmpg-500">
                        {jobSearch ? 'No jobs match your search' : 'No cached jobs'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {jobTotalPages > 1 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-rmpg-500">
                Page {jobPage} of {jobTotalPages} ({jobTotal} total)
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setJobPage(p => Math.max(1, p - 1))}
                  disabled={jobPage <= 1}
                  className="toolbar-btn p-1 disabled:opacity-30"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setJobPage(p => Math.min(jobTotalPages, p + 1))}
                  disabled={jobPage >= jobTotalPages}
                  className="toolbar-btn p-1 disabled:opacity-30"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Not configured hint */}
      {!status?.configured && (
        <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-3 rounded-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          Enter your ServeManager API key above to enable the integration. You can find your API key in your ServeManager account settings.
        </div>
      )}
    </div>
  );
}

// ── Sub-component ────────────────────────────────────────

function ServiceStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-rmpg-500">—</span>;

  const colors: Record<string, string> = {
    'Served': 'bg-green-900/40 text-green-400 border-green-700/40',
    'Attempted': 'bg-amber-900/40 text-amber-400 border-amber-700/40',
    'Non-Service': 'bg-red-900/40 text-red-400 border-red-700/40',
  };

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${colors[status] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'}`}>
      {status}
    </span>
  );
}
