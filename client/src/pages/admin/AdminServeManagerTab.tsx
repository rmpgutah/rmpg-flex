import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Link2, Key, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Clock, Search, Eye, EyeOff, Trash2, Zap, Play, Save,
  ChevronLeft, ChevronRight, FileText, Briefcase, MapPin, ToggleLeft, ToggleRight,
  Settings, Bell, BellOff, Webhook, Copy, Check, Lock,
} from 'lucide-react';
import { apiFetch, apiFetchBlob } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';
import { safeDateStr, safeDateTimeStr, parseTimestamp } from '../../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import type {
  SMIntegrationStatus, SMConnectionTestResult, SMSyncResult,
  SMSyncLogEntry, SMCachedJob, SMPaginatedResponse, SMCachedAttempt,
  SMPollerStatus, SMCachedDocument,
} from '../../types/servemanager';
import { formatEnumValue } from '../../utils/formatters';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
  /** Enabling/toggling the always-on poller is admin-only (server-enforced
   * on PUT /servemanager/poller/settings) — a manager can still trigger a
   * one-off Poll Now / sync, but cannot arm the unattended cron feed. */
  isAdmin: boolean;
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// ─── Webhook Configuration Panel ──────────────────────────────────────────────
// Shows the Worker webhook URL for pasting into ServeManager's webhook settings,
// and lets the admin set the shared HMAC secret used to verify SM's signatures.
function WebhookConfigPanel() {
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [hasSecret, setHasSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    apiFetch<{ webhook_url: string; has_secret: boolean }>('/servemanager/webhook-url')
      .then((d) => { setWebhookUrl(d.webhook_url); setHasSecret(d.has_secret); })
      .catch(() => {});
  }, []);

  const handleCopy = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSaveSecret = async () => {
    if (!secret.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/servemanager/webhook-secret', { method: 'PUT', body: JSON.stringify({ secret }) });
      setSecret('');
      setHasSecret(true);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <div className="panel-beveled bg-surface-base p-3 space-y-3">
      <div className="flex items-center gap-2 text-[10px] font-bold text-[color:var(--panel-header-color)] uppercase tracking-wider">
        <Webhook className="w-3.5 h-3.5" />
        Webhook — Real-Time Push
      </div>
      <p className="text-[10px] text-rmpg-400 leading-relaxed">
        Paste this URL into ServeManager → My Account → Settings → Manage Webhooks (Endpoint field).
        Copy the webhook&apos;s Secret from that same page into the field below — ServeManager signs each POST with HMAC-SHA-256 in the <span className="font-mono">X-SM-HMAC-SHA256</span> header.
        Disable any leftover webhook pointing at <span className="font-mono">rmpgutahps.us</span>: that zone sits behind Cloudflare&apos;s managed challenge and ServeManager cannot complete it (HTTP 403).
      </p>

      {/* Webhook URL copy row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-surface-sunken border border-rmpg-700 rounded-[2px] px-2.5 py-1.5 font-mono text-[10px] text-rmpg-300 truncate select-all">
          {webhookUrl ?? '…'}
        </div>
        <button type="button" onClick={handleCopy}
          className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 shrink-0"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Webhook secret row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={showSecret ? 'text' : 'password'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={hasSecret ? 'Set new webhook secret…' : 'Webhook secret from ServeManager…'}
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-[2px] focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 font-mono transition-colors"
          />
          <button type="button" onClick={() => setShowSecret(!showSecret)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300"
          >
            {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <button type="button" onClick={handleSaveSecret} disabled={saving || !secret.trim()}
          className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-50 shrink-0"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Saving" /> : saveOk ? <Check className="w-3 h-3 text-green-400" /> : <Lock className="w-3 h-3" />}
          {saveOk ? 'Saved' : 'Set Secret'}
        </button>
      </div>
      {hasSecret && !saveOk && (
        <div className="text-[10px] text-green-400/80 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Webhook secret is configured
        </div>
      )}
    </div>
  );
}

export default function AdminServeManagerTab({ LoadingSpinner, error, setError, isAdmin }: Props) {
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
  const [syncResult, setSyncResult] = useState<{ jobs: number; attempts: number } | null>(null);
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

  // ── Auto-Poller ──
  const [pollerStatus, setPollerStatus] = useState<SMPollerStatus | null>(null);
  const [pollerEnabled, setPollerEnabled] = useState(false);
  const [pollerInterval, setPollerInterval] = useState('300');
  const [pollerTargetClient, setPollerTargetClient] = useState('ICU Investigations, LLC');
  const [pollerAutoCreate, setPollerAutoCreate] = useState(true);
  const [pollerSaving, setPollerSaving] = useState(false);
  const [pollerPolling, setPollerPolling] = useState(false);
  const [pollerPollResult, setPollerPollResult] = useState<{ synced: number; callsCreated: number; attemptsSynced?: number; error?: string } | null>(null);
  const [pollerDirty, setPollerDirty] = useState(false);

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
      setSyncLog(asArray<SMSyncLogEntry>(res?.data));
    } catch (e) { console.error('Failed to fetch sync log:', e); }
  }, []);

  // ── Route & Mileage settings ──
  const [mileageRate, setMileageRate] = useState<string>('0.67');
  const [bizHoursStart, setBizHoursStart] = useState<string>('08:00');
  const [bizHoursEnd, setBizHoursEnd] = useState<string>('20:00');
  const [bizHoursDays, setBizHoursDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [autoGeocodeOnIntake, setAutoGeocodeOnIntake] = useState<boolean>(true);
  const [geocodeConfidenceMin, setGeocodeConfidenceMin] = useState<number>(0.6);

  // ── Per-section save state: null = idle, 'saving', 'saved', or error string ──
  const [routeSaveState, setRouteSaveState] = useState<null | 'saving' | 'saved' | string>(null);
  const [notifSaveState, setNotifSaveState] = useState<null | 'saving' | 'saved' | string>(null);
  const [intakeSaveState, setIntakeSaveState] = useState<null | 'saving' | 'saved' | string>(null);

  // ── Nudge settings (attempt scheduling + notification config) ──
  const [nudgeSettings, setNudgeSettings] = useState<{
    approaching_hours: number;
    diligence_gap_days: number;
    unassigned_window_hours: number;
    renotify_hours: number;
    notify_supervisor_email: number;
    digest_sender_user_id: number | null;
  } | null>(null);
  const [nudgeSaving, setNudgeSaving] = useState(false);
  const [nudgeDirty, setNudgeDirty] = useState(false);

  const fetchNudgeSettings = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: any }>('/process-server/assignments/settings');
      if (res?.data) {
        setNudgeSettings({
          approaching_hours: res.data.approaching_hours ?? 48,
          diligence_gap_days: res.data.diligence_gap_days ?? 3,
          unassigned_window_hours: res.data.unassigned_window_hours ?? 72,
          renotify_hours: res.data.renotify_hours ?? 24,
          notify_supervisor_email: res.data.notify_supervisor_email ?? 1,
          digest_sender_user_id: res.data.digest_sender_user_id ?? null,
        });
        if (res.data.mileage_rate !== undefined) setMileageRate(String(res.data.mileage_rate));
        if (res.data.business_hours_start) setBizHoursStart(res.data.business_hours_start);
        if (res.data.business_hours_end) setBizHoursEnd(res.data.business_hours_end);
        if (res.data.business_hours_days) {
          const days = typeof res.data.business_hours_days === 'string'
            ? JSON.parse(res.data.business_hours_days)
            : res.data.business_hours_days;
          setBizHoursDays(days);
        }
        if (res.data.auto_geocode_on_intake !== undefined) setAutoGeocodeOnIntake(res.data.auto_geocode_on_intake !== 0);
        if (res.data.geocode_confidence_min !== undefined) setGeocodeConfidenceMin(res.data.geocode_confidence_min);
      }
    } catch { /* settings table may not exist yet */ }
  }, []);

  useEffect(() => { fetchNudgeSettings(); }, [fetchNudgeSettings]);

  const nudgeSet = useCallback((patch: Partial<typeof nudgeSettings>) => {
    setNudgeSettings((prev) => prev ? { ...prev, ...patch as any } : prev);
    setNudgeDirty(true);
  }, []);

  const handleNudgeSave = async () => {
    if (!nudgeSettings) return;
    setNudgeSaving(true);
    try {
      await apiFetch('/process-server/assignments/settings', {
        method: 'PUT',
        body: JSON.stringify(nudgeSettings),
      });
      setNudgeDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setNudgeSaving(false);
    }
  };

  const saveRouteSettings = async () => {
    setRouteSaveState('saving');
    try {
      await apiFetch('/process-server/assignments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          mileage_rate: parseFloat(mileageRate) || 0.67,
          business_hours_start: bizHoursStart,
          business_hours_end: bizHoursEnd,
          business_hours_days: bizHoursDays,
        }),
      });
      setRouteSaveState('saved');
      setTimeout(() => setRouteSaveState(null), 3000);
    } catch (err: any) {
      setRouteSaveState(err?.message || 'Save failed');
    }
  };

  const saveNotifSettings = async () => {
    if (!nudgeSettings) return;
    setNotifSaveState('saving');
    try {
      await apiFetch('/process-server/assignments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          approaching_hours: nudgeSettings.approaching_hours,
          diligence_gap_days: nudgeSettings.diligence_gap_days,
          unassigned_window_hours: nudgeSettings.unassigned_window_hours,
          renotify_hours: nudgeSettings.renotify_hours,
          notify_supervisor_email: nudgeSettings.notify_supervisor_email,
        }),
      });
      setNotifSaveState('saved');
      setTimeout(() => setNotifSaveState(null), 3000);
    } catch (err: any) {
      setNotifSaveState(err?.message || 'Save failed');
    }
  };

  const saveIntakeSettings = async () => {
    setIntakeSaveState('saving');
    try {
      await apiFetch('/process-server/assignments/settings', {
        method: 'PUT',
        body: JSON.stringify({
          auto_geocode_on_intake: autoGeocodeOnIntake,
          geocode_confidence_min: geocodeConfidenceMin,
        }),
      });
      setIntakeSaveState('saved');
      setTimeout(() => setIntakeSaveState(null), 3000);
    } catch (err: any) {
      setIntakeSaveState(err?.message || 'Save failed');
    }
  };

  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const params = new URLSearchParams({ page: String(jobPage), per_page: '25' });
      if (jobSearch) params.set('q', jobSearch);
      const res = await apiFetch<SMPaginatedResponse<SMCachedJob>>(`/servemanager/jobs?${params}`);
      setJobs(asArray<SMCachedJob>(res?.data));
      setJobTotal(res.pagination?.total || 0);
      setJobTotalPages(res.pagination?.totalPages || 0);
    } catch (err) {
      console.error('Failed to fetch SM jobs:', err);
    } finally {
      setLoadingJobs(false);
    }
  }, [jobSearch, jobPage]);

  const fetchPollerStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SMPollerStatus>('/servemanager/poller/status');
      setPollerStatus(data);
      setPollerEnabled(data.enabled);
      setPollerInterval(String(data.poll_interval));
      setPollerTargetClient(data.target_client);
      setPollerAutoCreate(data.auto_create_calls);
      setPollerDirty(false);
    } catch (e) { console.error('Failed to fetch poller status:', e); }
  }, []);

  useEffect(() => { fetchStatus(); fetchSyncLog(); }, [fetchStatus, fetchSyncLog]);
  useEffect(() => { if (status?.configured) { fetchJobs(); fetchPollerStatus(); } }, [status?.configured, fetchJobs, fetchPollerStatus]);

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
    setSyncResult(null);
    try {
      const res = await apiFetch<SMSyncResult>('/servemanager/sync', { method: 'POST', body: JSON.stringify({ type }) });
      setSyncResult({ jobs: (res as any)?.jobs_synced ?? 0, attempts: (res as any)?.attempts_synced ?? 0 });
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

  const [downloadingDocId, setDownloadingDocId] = useState<number | null>(null);

  const handleDownloadDocument = async (doc: SMCachedDocument) => {
    setDownloadingDocId(doc.id);
    try {
      const blob = await apiFetchBlob(`/servemanager/documents/${doc.id}/download`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download document');
    } finally {
      setDownloadingDocId(null);
    }
  };

  const [creatingDispatchFor, setCreatingDispatchFor] = useState<number | null>(null);

  const handleCreateDispatch = async (jobId: number) => {
    setCreatingDispatchFor(jobId);
    try {
      const res = await apiFetch<{ success?: boolean; call_id?: number; code?: string }>(`/servemanager/jobs/${jobId}/create-dispatch`, { method: 'POST' });
      if ((res as any)?.code === 'ALREADY_LINKED' && (res as any)?.call_id) {
        // Job already has a dispatch call — navigate directly to it instead of showing a generic error.
        window.location.hash = `#/dispatch/calls/${(res as any).call_id}`;
        return;
      }
      await fetchJobs();
      if (selectedJob?.id === jobId) await handleViewJob(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create dispatch call');
    } finally {
      setCreatingDispatchFor(null);
    }
  };

  // ── Poller handlers ──

  const handlePollerSave = async () => {
    setPollerSaving(true);
    try {
      await apiFetch('/servemanager/poller/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: pollerEnabled,
          poll_interval: parseInt(pollerInterval, 10) || 300,
          target_client: pollerTargetClient,
          auto_create_calls: pollerAutoCreate,
        }),
      });
      await fetchPollerStatus();
      setPollerDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save poller settings');
    } finally {
      setPollerSaving(false);
    }
  };

  const handlePollerPollNow = async () => {
    setPollerPolling(true);
    setPollerPollResult(null);
    try {
      const result = await apiFetch<{ synced: number; callsCreated: number; attemptsSynced?: number; error?: string }>('/servemanager/poller/poll-now', { method: 'POST' });
      setPollerPollResult(result);
      await fetchPollerStatus();
      await fetchJobs();
    } catch (err) {
      setPollerPollResult({ synced: 0, callsCreated: 0, error: err instanceof Error ? err.message : 'Poll failed' });
    } finally {
      setPollerPolling(false);
    }
  };

  // \u2500\u2500 Right-click context menu (jobs table) \u2500\u2500
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const buildJobMenu = (job: SMCachedJob): ContextMenuItem[] => [
    m.action('Open job details', () => handleViewJob(job.id), { icon: <Eye size={12} /> }),
    m.separator(),
    m.copy('Copy job #', job.sm_job_number, <FileText size={12} />),
    m.copyId(job.id),
    ...(job.recipient_name ? [m.copy('Copy recipient', job.recipient_name)] : []),
    ...(job.client_company_name ? [m.copy('Copy client', job.client_company_name)] : []),
    ...(job.court_case_number ? [m.copy('Copy court case #', job.court_case_number)] : []),
  ];

  // Set document title (must be before early return to preserve hook order)
  useEffect(() => { document.title = 'Admin - Serve Manager \u2014 RMPG Flex'; }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-accent-silver-500" />
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
      <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-[color:var(--panel-header-color)] uppercase tracking-wider">
          <Key className="w-3.5 h-3.5" />
          API Key
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input id="ff-adminservemanagertab-0"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={status?.configured ? 'Enter new key to replace...' : 'Enter your ServeManager API key...'}
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-[2px] focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 font-mono transition-colors"
            />
            <button type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300"
            >
              {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button type="button"
            onClick={handleSaveKey}
            disabled={savingKey || !apiKey.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-50"
          >
            {savingKey ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle2 className="w-3 h-3" />}
            Save
          </button>
          {status?.configured && (
            <>
              <button type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Zap className="w-3 h-3" />}
                Test
              </button>
              <button type="button"
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
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-[2px] animate-in fade-in duration-200 ${
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
      </form>

      {/* ═══ Section 1b: Webhook Configuration ═══ */}
      {status?.configured && (
        <WebhookConfigPanel />
      )}

      {/* ═══ Section 2: Sync Controls ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-[color:var(--panel-header-color)] uppercase tracking-wider">
              <RefreshCw className="w-3.5 h-3.5" />
              Data Sync
            </div>
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => handleSync('incremental')}
                disabled={syncing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {syncing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <RefreshCw className="w-3 h-3" />}
                Incremental Sync
              </button>
              <button type="button"
                onClick={() => handleSync('full')}
                disabled={syncing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {syncing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <RefreshCw className="w-3 h-3" />}
                Full Sync
              </button>
            </div>
          </div>

          {syncResult && (
            <div className="text-[10px] text-green-400 bg-green-900/20 border border-green-800/30 rounded-[2px] px-2 py-1">
              Sync complete — {syncResult.jobs} job{syncResult.jobs !== 1 ? 's' : ''}, {syncResult.attempts} attempt{syncResult.attempts !== 1 ? 's' : ''} synced
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="bg-surface-sunken p-2 rounded-[2px]">
              <div className="text-[10px] text-rmpg-400">Cached Jobs</div>
              <div className="text-lg font-bold font-mono text-rmpg-100">{status.cached_jobs}</div>
            </div>
            <div className="bg-surface-sunken p-2 rounded-[2px]">
              <div className="text-[10px] text-rmpg-400">Cached Attempts</div>
              <div className="text-lg font-bold font-mono text-rmpg-100">{status.cached_attempts}</div>
            </div>
            <div className="bg-surface-sunken p-2 rounded-[2px]">
              <div className="text-[10px] text-rmpg-400">Last Sync</div>
              <div className="text-xs font-mono text-rmpg-200">
                {status.last_sync
                  ? parseTimestamp(status.last_sync.completed_at || status.last_sync.started_at).toLocaleString()
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
              <div className="text-[10px] text-[color:var(--panel-header-color)] font-bold uppercase tracking-wider">Sync History</div>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {syncLog.slice(0, 10).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 text-[10px] bg-surface-sunken px-2 py-1 rounded-[2px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      entry.status === 'completed' ? 'bg-green-400' : entry.status === 'failed' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'
                    }`} />
                    <span className="text-rmpg-300 font-mono">{formatEnumValue(entry.sync_type)}</span>
                    <span className="text-rmpg-500">{entry.jobs_synced} jobs, {entry.attempts_synced} attempts</span>
                    <span className="ml-auto text-rmpg-500 whitespace-nowrap">{safeDateTimeStr(entry.started_at)}</span>
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

      {/* ═══ Section 2b: Auto-Poller — Job-to-Dispatch ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-[color:var(--panel-header-color)] uppercase tracking-wider">
              <Play className="w-3.5 h-3.5" />
              Auto-Poller — Job-to-Dispatch
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button"
                onClick={handlePollerPollNow}
                disabled={pollerPolling}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-50"
              >
                {pollerPolling ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Zap className="w-3 h-3" />}
                Poll Now
              </button>
              <button type="button"
                onClick={handlePollerSave}
                disabled={!isAdmin || pollerSaving || !pollerDirty}
                title={!isAdmin ? 'Only an admin can change poller settings' : undefined}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 disabled:opacity-50"
              >
                {pollerSaving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save className="w-3 h-3" />}
                Save
              </button>
            </div>
          </div>

          {!isAdmin && (
            <div className="flex items-center gap-2 text-[10px] text-amber-400 bg-amber-950/20 border border-amber-800/40 px-2 py-1.5 rounded-[2px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Only an admin can enable/disable the poller or change its settings. You can still run Poll Now.
            </div>
          )}

          {/* Poll result feedback */}
          {pollerPollResult && (
            <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-[2px] animate-in fade-in duration-200 ${
              pollerPollResult.error
                ? 'bg-red-950/30 border border-red-800/40 text-red-400'
                : pollerPollResult.callsCreated > 0
                  ? 'bg-green-950/30 border border-green-800/40 text-green-400'
                  : 'bg-surface-sunken border border-rmpg-600 text-rmpg-300'
            }`}>
              {pollerPollResult.error ? (
                <><XCircle className="w-3.5 h-3.5 shrink-0" /> Poll error: {pollerPollResult.error}</>
              ) : (
                <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Synced {pollerPollResult.synced} jobs
                  {pollerPollResult.attemptsSynced ? `, ${pollerPollResult.attemptsSynced} attempt(s)` : ''}, created {pollerPollResult.callsCreated} dispatch call(s)</>
              )}
            </div>
          )}

          {/* Poller settings grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Enable/Disable toggle */}
            <div className="flex items-center justify-between bg-surface-sunken p-2.5 rounded-[2px]">
              <div>
                <div className="text-[10px] font-bold text-rmpg-200">Poller Enabled</div>
                <div className="text-[9px] text-rmpg-500">Automatically sync jobs on interval</div>
              </div>
              <button type="button"
                onClick={() => { setPollerEnabled(!pollerEnabled); setPollerDirty(true); }}
                disabled={!isAdmin}
                className="text-rmpg-300 hover:text-rmpg-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pollerEnabled
                  ? <ToggleRight className="w-7 h-7 text-green-400" />
                  : <ToggleLeft className="w-7 h-7 text-rmpg-600" />
                }
              </button>
            </div>

            {/* Auto-create dispatch calls toggle */}
            <div className="flex items-center justify-between bg-surface-sunken p-2.5 rounded-[2px]">
              <div>
                <div className="text-[10px] font-bold text-rmpg-200">Auto-Create Dispatch Calls</div>
                <div className="text-[9px] text-rmpg-500">Create calls for unlinked target jobs</div>
              </div>
              <button type="button"
                onClick={() => { setPollerAutoCreate(!pollerAutoCreate); setPollerDirty(true); }}
                disabled={!isAdmin}
                className="text-rmpg-300 hover:text-rmpg-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pollerAutoCreate
                  ? <ToggleRight className="w-7 h-7 text-green-400" />
                  : <ToggleLeft className="w-7 h-7 text-rmpg-600" />
                }
              </button>
            </div>

            {/* Poll interval */}
            <div className="bg-surface-sunken p-2.5 rounded-[2px] space-y-1">
              <div className="text-[10px] font-bold text-rmpg-200">Poll Interval (seconds)</div>
              <input id="ff-adminservemanagertab-1"
                type="number"
                min={60}
                max={1800}
                value={pollerInterval}
                onChange={(e) => { setPollerInterval(e.target.value); setPollerDirty(true); }}
                disabled={!isAdmin}
                className="w-full bg-rmpg-800 border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors font-mono disabled:opacity-50"
              />
              <div className="text-[9px] text-rmpg-500">Min 60s, max 1800s (30 min)</div>
            </div>

            {/* Target client */}
            <div className="bg-surface-sunken p-2.5 rounded-[2px] space-y-1">
              <div className="text-[10px] font-bold text-rmpg-200">Target Client</div>
              <input id="ff-adminservemanagertab-2"
                type="text"
                value={pollerTargetClient}
                onChange={(e) => { setPollerTargetClient(e.target.value); setPollerDirty(true); }}
                disabled={!isAdmin}
                className="w-full bg-rmpg-800 border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors disabled:opacity-50"
              />
              <div className="text-[9px] text-rmpg-500">Only jobs from this client trigger auto-dispatch</div>
            </div>
          </div>

          {/* Last poll info */}
          <div className="flex items-center gap-3 text-[10px] text-rmpg-400">
            <Clock className="w-3 h-3" />
            <span>Last poll: {pollerStatus?.last_poll_at ? parseTimestamp(pollerStatus.last_poll_at).toLocaleString() : 'Never'}</span>
            <span className="text-rmpg-600">|</span>
            <span>Status: {pollerEnabled
              ? <span className="text-green-400">Active</span>
              : <span className="text-rmpg-500">Disabled</span>
            }</span>
          </div>
        </div>
      )}

      {/* ═══ Section 3: Jobs Browser ═══ */}
      {status?.configured && status.cached_jobs > 0 && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-[color:var(--panel-header-color)] uppercase tracking-wider">
              <Briefcase className="w-3.5 h-3.5" />
              Cached Jobs ({jobTotal})
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
                <input id="ff-adminservemanagertab-3"
                  type="text"
                  value={jobSearch}
                  onChange={(e) => { setJobSearch(e.target.value); setJobPage(1); }}
                  placeholder="Search jobs..." aria-label="Search jobs..."
                  className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] pl-7 pr-2 py-1 rounded-[2px] w-48 focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors"
                />
              </div>
              <button type="button" onClick={fetchJobs} className="toolbar-btn text-[10px] flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${loadingJobs ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Selected job detail */}
          {selectedJob && (
            <div className="bg-surface-sunken border border-rmpg-600 p-3 rounded-[2px] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-brand-400" />
                  <span className="text-xs font-bold text-rmpg-100">Job #{selectedJob.sm_job_number}</span>
                  <ServiceStatusBadge status={selectedJob.service_status} />
                </div>
                <div className="flex items-center gap-2">
                  {!selectedJob.linked_call_id && (
                    <button type="button"
                      onClick={() => handleCreateDispatch(selectedJob.id)}
                      disabled={creatingDispatchFor === selectedJob.id}
                      className="toolbar-btn text-[10px] flex items-center gap-1 px-2 py-1 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-50"
                    >
                      {creatingDispatchFor === selectedJob.id
                        ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
                        : <Zap className="w-3 h-3" />}
                      Create Dispatch
                    </button>
                  )}
                  <button aria-label="Close" type="button" onClick={() => setSelectedJob(null)} className="text-rmpg-500 hover:text-rmpg-300">
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
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
              {/* Documents */}
              {(() => {
                let docs: SMCachedDocument[] = [];
                try { docs = asArray(JSON.parse(selectedJob.documents_json || '[]')); } catch { /* malformed cache row */ }
                if (docs.length === 0) return null;
                return (
                  <div className="space-y-1 mt-2">
                    <div className="text-[10px] font-bold text-fg-muted">Documents ({docs.length})</div>
                    {docs.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => handleDownloadDocument(doc)}
                        disabled={downloadingDocId === doc.id}
                        className="flex items-center gap-2 w-full text-left text-[10px] bg-rmpg-800/50 hover:bg-rmpg-800 px-2 py-1 rounded-[2px] disabled:opacity-50"
                      >
                        <FileText className="w-3 h-3 text-fg-muted shrink-0" />
                        <span className="text-rmpg-200">{doc.title || 'Document'}</span>
                        {doc.document_type && <span className="text-fg-muted">({formatEnumValue(doc.document_type)})</span>}
                        {downloadingDocId === doc.id && <Loader2 className="w-3 h-3 animate-spin text-fg-muted ml-auto" />}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {/* Attempts */}
              {selectedJob.attempts && selectedJob.attempts.length > 0 && (
                <div className="space-y-1 mt-2">
                  <div className="text-[10px] font-bold text-rmpg-400">Attempts ({selectedJob.attempts.length})</div>
                  {selectedJob.attempts.map((att) => (
                    <div key={att.id} className="flex items-center gap-2 text-[10px] bg-rmpg-800/50 px-2 py-1 rounded-[2px]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${att.success ? 'bg-green-400' : 'bg-amber-400'}`} />
                      <span className="text-rmpg-300">{att.service_status || 'Attempted'}</span>
                      {att.serve_type && <span className="text-rmpg-500">({att.serve_type})</span>}
                      {att.server_name && <span className="text-rmpg-400">{att.server_name}</span>}
                      {att.lat != null && att.lng != null && <MapPin className="w-3 h-3 text-rmpg-500" />}
                      <span className="ml-auto text-rmpg-500">{att.served_at ? parseTimestamp(att.served_at).toLocaleString() : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Jobs table */}
          {loadingJobs ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" />
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
                    <th className="pb-1 pr-2 font-bold">Synced</th>
                    <th className="pb-1 font-bold">Dispatch</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => handleViewJob(job.id)}
                      onContextMenu={(e) => openMenu(e, buildJobMenu(job))}
                      className="border-b border-rmpg-800 hover:bg-surface-raised/60 cursor-pointer transition-all duration-100"
                    >
                      <td className="py-1 pr-2 font-mono text-brand-400">{job.sm_job_number}</td>
                      <td className="py-1 pr-2 text-rmpg-200 max-w-[120px] truncate">{job.recipient_name || '—'}</td>
                      <td className="py-1 pr-2 text-rmpg-300">{job.job_status || '—'}</td>
                      <td className="py-1 pr-2"><ServiceStatusBadge status={job.service_status} /></td>
                      <td className="py-1 pr-2 text-rmpg-300 max-w-[100px] truncate">{job.client_company_name || '—'}</td>
                      <td className="py-1 pr-2 text-rmpg-400 whitespace-nowrap">{job.due_date || '—'}</td>
                      <td className="py-1 pr-2 text-center font-mono text-rmpg-300">{job.attempt_count}</td>
                      <td className="py-1 pr-2 text-rmpg-500 whitespace-nowrap">{safeDateStr(job.synced_at)}</td>
                      <td className="py-1 whitespace-nowrap">
                        {job.linked_call_id ? (
                          <span className="text-[9px] text-green-400">Linked</span>
                        ) : (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); handleCreateDispatch(job.id); }}
                            disabled={creatingDispatchFor === job.id}
                            className="toolbar-btn text-[9px] flex items-center gap-1 px-1.5 py-0.5 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-50"
                          >
                            {creatingDispatchFor === job.id
                              ? <Loader2 className="w-2.5 h-2.5 animate-spin" role="status" aria-label="Loading" />
                              : <Zap className="w-2.5 h-2.5" />}
                            Create
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-4 text-center text-rmpg-500">
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
                <button aria-label="Previous" type="button"
                  onClick={() => setJobPage(p => Math.max(1, p - 1))}
                  disabled={jobPage <= 1}
                  className="toolbar-btn p-1 disabled:opacity-30"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <button aria-label="Next" type="button"
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

      {/* ═══ Section: Route & Mileage ═══ */}
      <details>
        <summary className="text-xs font-semibold text-rmpg-200 cursor-pointer py-2 select-none list-none flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-accent-silver-500" />
          Route &amp; Mileage
        </summary>
        <div className="panel-beveled bg-surface-base p-3 space-y-3 mt-1">
          <div>
            <label className="text-[11px] text-[color:var(--field-label-color)]">Mileage Rate (USD/mi)</label>
            <input
              type="number" step="0.01" min="0" max="2"
              value={mileageRate}
              onChange={e => setMileageRate(e.target.value)}
              className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] w-24 ml-2 focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors font-mono"
            />
            <span className="text-[9px] text-fg-muted ml-1">IRS standard: $0.67</span>
          </div>
          <div>
            <label className="text-[11px] text-[color:var(--field-label-color)]">Business Hours</label>
            <div className="flex items-center gap-2 mt-1">
              <input type="time" value={bizHoursStart} onChange={e => setBizHoursStart(e.target.value)}
                className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] w-28 focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors" />
              <span className="text-fg-muted text-xs">–</span>
              <input type="time" value={bizHoursEnd} onChange={e => setBizHoursEnd(e.target.value)}
                className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] w-28 focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-[color:var(--field-label-color)]">Active Days</label>
            <div className="flex gap-1 mt-1">
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d, i) => (
                <button
                  key={d} type="button"
                  onClick={() => setBizHoursDays(prev =>
                    prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].sort((a, b) => a - b)
                  )}
                  className={`text-[10px] px-2 py-0.5 rounded-[2px] border transition-colors ${
                    bizHoursDays.includes(i)
                      ? 'bg-brand-600/40 border-brand-500/60 text-rmpg-100'
                      : 'bg-surface-sunken border-border-default text-fg-muted'
                  }`}
                >{d}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={saveRouteSettings} disabled={routeSaveState === 'saving'}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-50">
              {routeSaveState === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save className="w-3 h-3" />}
              Save
            </button>
            <SaveBadge state={routeSaveState} />
          </div>
        </div>
      </details>

      {/* ═══ Section: Notifications ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold text-[color:var(--panel-header-color)] uppercase tracking-wider">
            <Settings className="w-3.5 h-3.5" />
            Attempt Notification Settings
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={saveNotifSettings}
              disabled={notifSaveState === 'saving'}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 disabled:opacity-50"
            >
              {notifSaveState === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save className="w-3 h-3" />}
              Save
            </button>
            <SaveBadge state={notifSaveState} />
          </div>
        </div>
        {nudgeSettings && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-surface-sunken p-2.5 rounded-[2px] space-y-1">
              <div className="text-[10px] font-bold text-rmpg-200">Deadline Approaching (hours)</div>
              <input
                type="number" min={1} max={720}
                value={nudgeSettings.approaching_hours}
                onChange={(e) => nudgeSet({ approaching_hours: parseInt(e.target.value, 10) || 48 })}
                className="w-full bg-rmpg-800 border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors font-mono"
              />
              <div className="text-[9px] text-rmpg-500">Flag jobs this many hours before court deadline</div>
            </div>
            <div className="bg-surface-sunken p-2.5 rounded-[2px] space-y-1">
              <div className="text-[10px] font-bold text-rmpg-200">Diligence Gap (days)</div>
              <input
                type="number" min={1} max={30}
                value={nudgeSettings.diligence_gap_days}
                onChange={(e) => nudgeSet({ diligence_gap_days: parseInt(e.target.value, 10) || 3 })}
                className="w-full bg-rmpg-800 border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors font-mono"
              />
              <div className="text-[9px] text-rmpg-500">Days without a logged attempt before flagging</div>
            </div>
            <div className="bg-surface-sunken p-2.5 rounded-[2px] space-y-1">
              <div className="text-[10px] font-bold text-rmpg-200">Unassigned Window (hours)</div>
              <input
                type="number" min={1} max={720}
                value={nudgeSettings.unassigned_window_hours}
                onChange={(e) => nudgeSet({ unassigned_window_hours: parseInt(e.target.value, 10) || 72 })}
                className="w-full bg-rmpg-800 border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors font-mono"
              />
              <div className="text-[9px] text-rmpg-500">Hours an unassigned job remains before escalating</div>
            </div>
            <div className="bg-surface-sunken p-2.5 rounded-[2px] space-y-1">
              <div className="text-[10px] font-bold text-rmpg-200">Re-notify (hours)</div>
              <input
                type="number" min={1} max={168}
                value={nudgeSettings.renotify_hours}
                onChange={(e) => nudgeSet({ renotify_hours: parseInt(e.target.value, 10) || 24 })}
                className="w-full bg-rmpg-800 border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1 rounded-[2px] focus:border-accent-silver-500 focus:outline-none focus:ring-1 focus:ring-accent-silver-500/40 transition-colors font-mono"
              />
              <div className="text-[9px] text-rmpg-500">Minimum hours between repeated notifications</div>
            </div>
            <div className="flex items-center justify-between bg-surface-sunken p-2.5 rounded-[2px]">
              <div>
                <div className="text-[10px] font-bold text-rmpg-200">Supervisor Email Digest</div>
                <div className="text-[9px] text-rmpg-500">Email supervisors with daily digest</div>
              </div>
              <button type="button"
                onClick={() => nudgeSet({ notify_supervisor_email: nudgeSettings.notify_supervisor_email ? 0 : 1 })}
                className="text-rmpg-300 hover:text-rmpg-100 transition-colors"
              >
                {nudgeSettings.notify_supervisor_email
                  ? <Bell className="w-5 h-5 text-green-400" />
                  : <BellOff className="w-5 h-5 text-rmpg-600" />
                }
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Section: Intake Rules ═══ */}
      <details>
        <summary className="text-xs font-semibold text-rmpg-200 cursor-pointer py-2 select-none list-none flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-accent-silver-500" />
          Intake Rules
        </summary>
        <div className="panel-beveled bg-surface-base p-3 space-y-3 mt-1">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-[color:var(--field-label-color)]">Auto-geocode on intake</label>
            <button type="button"
              onClick={() => setAutoGeocodeOnIntake(v => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoGeocodeOnIntake ? 'bg-brand-600' : 'bg-rmpg-700'}`}
              role="switch" aria-checked={autoGeocodeOnIntake}
            >
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoGeocodeOnIntake ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>
          <div>
            <label className="text-[11px] text-[color:var(--field-label-color)]">
              Geocode confidence minimum: <span className="text-rmpg-100">{geocodeConfidenceMin.toFixed(2)}</span>
            </label>
            <input
              type="range" min="0" max="1" step="0.05"
              value={geocodeConfidenceMin}
              onChange={e => setGeocodeConfidenceMin(parseFloat(e.target.value))}
              className="w-full mt-1 accent-brand-500"
            />
            <div className="flex justify-between text-[9px] text-fg-muted"><span>0.0 (any)</span><span>1.0 (exact)</span></div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={saveIntakeSettings} disabled={intakeSaveState === 'saving'}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-50">
              {intakeSaveState === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save className="w-3 h-3" />}
              Save
            </button>
            <SaveBadge state={intakeSaveState} />
          </div>
        </div>
      </details>

      {/* Not configured hint */}
      {!status?.configured && (
        <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-3 rounded-[2px]">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          Enter your ServeManager API key above to enable the integration. You can find your API key in your ServeManager account settings.
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function SaveBadge({ state }: { state: null | 'saving' | 'saved' | string }) {
  if (!state) return null;
  if (state === 'saving') return <span className="text-[10px] text-fg-muted ml-2">Saving…</span>;
  if (state === 'saved') return <span className="text-[10px] text-green-400 ml-2">✓ Saved</span>;
  return <span className="text-[10px] text-red-400 ml-2">{state}</span>;
}

function ServiceStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-rmpg-500">—</span>;

  const colors: Record<string, string> = {
    'Served': 'bg-green-900/40 text-green-400 border-green-700/40',
    'Attempted': 'bg-amber-900/40 text-amber-400 border-amber-700/40',
    'Non-Service': 'bg-red-900/40 text-red-400 border-red-700/40',
  };

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-[2px] border ${colors[status] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'}`}>
      {status}
    </span>
  );
}
