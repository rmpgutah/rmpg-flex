import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, AlertTriangle, ToggleLeft, ToggleRight, RefreshCw,
  ExternalLink, Shield, Clock, Wifi, WifiOff, Send,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface EmailStatus {
  configured: boolean;
  enabled: boolean;
  authorized: boolean;
  mailbox: string | null;
  lastSync: string | null;
  pollInterval: number;
  smtpFallback: boolean;
  cachedMessages: number;
}

export default function AdminEmailTab({ LoadingSpinner, error, setError }: Props) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Credentials form
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  // SMTP form
  const [smtpPassword, setSmtpPassword] = useState('');
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);

  // Test results
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ graph?: any; smtp?: any } | null>(null);

  // Syncing
  const [syncing, setSyncing] = useState(false);

  // Poll interval
  const [pollInterval, setPollInterval] = useState(300);

  // Check for OAuth callback status
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get('status');
    if (oauthStatus === 'authorized') {
      setError(null);
      // Clean URL
      window.history.replaceState({}, '', '/admin?tab=email');
    } else if (oauthStatus === 'error') {
      setError(`OAuth Error: ${params.get('message') || 'Unknown error'}`);
      window.history.replaceState({}, '', '/admin?tab=email');
    }
  }, [setError]);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<EmailStatus>('/email/status');
      setStatus(data);
      setPollInterval(data.pollInterval || 300);
    } catch (err: any) {
      console.error('Failed to fetch email status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ─── Handlers ───

  const handleSaveCredentials = async () => {
    if (!clientId || !clientSecret || !tenantId) {
      setError('All three Azure AD fields are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/email/admin/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, tenantId }),
      });
      setClientId(''); setClientSecret(''); setTenantId('');
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClearCredentials = async () => {
    if (!confirm('Clear all Microsoft email credentials and cached emails?')) return;
    try {
      await apiFetch('/email/admin/credentials', { method: 'DELETE' });
      setTestResult(null);
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAuthorize = async () => {
    try {
      const data = await apiFetch<{ url: string }>('/email/admin/oauth/authorize');
      // Validate redirect URL is a legitimate OAuth provider
      const url = new URL(data.url);
      const allowedHosts = new Set(['login.microsoftonline.com', 'accounts.google.com', 'login.live.com']);
      if (!allowedHosts.has(url.hostname)) {
        throw new Error('Unexpected OAuth redirect domain');
      }
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await apiFetch<{ graph?: any; smtp?: any }>('/email/admin/test-connection', { method: 'POST' });
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ graph: { success: false, error: err.message } });
    } finally {
      setTesting(false);
    }
  };

  const handleToggleEnabled = async () => {
    try {
      await apiFetch('/email/admin/enable', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status?.enabled }),
      });
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePollIntervalChange = async (seconds: number) => {
    setPollInterval(seconds);
    try {
      await apiFetch('/email/admin/enable', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollInterval: seconds }),
      });
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSmtpSettings = async (enabled: boolean) => {
    try {
      const reqBody: any = { enabled };
      if (smtpPassword) reqBody.password = smtpPassword;
      await apiFetch('/email/admin/smtp-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      setSmtpPassword('');
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await apiFetch('/email/admin/sync-now', { method: 'POST' });
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  // Set document title
  useEffect(() => { document.title = 'Admin - Email \u2014 RMPG Flex'; }, []);



  if (loading) return <div className="p-8 text-center"><LoadingSpinner /></div>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-sm bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400">&times;</button>
        </div>
      )}

      {/* ─── Connection Status ─── */}
      <div className="panel-beveled p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-white flex items-center gap-2">
            <Mail className="w-3.5 h-3.5 text-brand-400" />
            Connection Status
          </h3>
          <div className="flex items-center gap-2">
            {status?.authorized ? (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <Wifi className="w-3 h-3" /> Connected
              </span>
            ) : status?.configured ? (
              <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                <WifiOff className="w-3 h-3" /> Not Authorized
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-rmpg-500">
                <WifiOff className="w-3 h-3" /> Not Configured
              </span>
            )}
          </div>
        </div>

        {status?.authorized && (
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-rmpg-500">Mailbox:</span>
              <span className="ml-1 text-white font-mono">{status.mailbox || '—'}</span>
            </div>
            <div>
              <span className="text-rmpg-500">Cached:</span>
              <span className="ml-1 text-white">{status.cachedMessages} messages</span>
            </div>
            <div>
              <span className="text-rmpg-500">Last Sync:</span>
              <span className="ml-1 text-white">{status.lastSync || 'Never'}</span>
            </div>
            <div>
              <span className="text-rmpg-500">SMTP Fallback:</span>
              <span className={`ml-1 ${status.smtpFallback ? 'text-green-400' : 'text-rmpg-500'}`}>
                {status.smtpFallback ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Azure AD Credentials ─── */}
      <div className="panel-beveled p-3 space-y-3">
        <h3 className="text-xs font-semibold text-white flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-brand-400" />
          Azure AD Credentials
        </h3>
        <p className="text-[10px] text-rmpg-500">
          Register an app at{' '}
          <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
            target="_blank" rel="noopener" className="text-brand-400 hover:underline">
            Azure Portal <ExternalLink className="w-2.5 h-2.5 inline" />
          </a>
          {' '}with redirect URI: <code className="text-rmpg-300 bg-surface-sunken px-1 rounded-sm">https://rmpgutah.us/api/email/oauth/callback</code>
        </p>

        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Application (Client) ID</label>
            <input
              type="text"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              placeholder={status?.configured ? '••••••••••••••••' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
              className="input-dark w-full text-xs font-mono min-h-[36px]"
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Client Secret</label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={clientSecret}
                onChange={e => setClientSecret(e.target.value)}
                placeholder={status?.configured ? '••••••••••••••••' : 'Enter client secret'}
                className="input-dark w-full text-xs font-mono pr-8 min-h-[36px]"
              />
              <button type="button" onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white">
                {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Directory (Tenant) ID</label>
            <input
              type="text"
              value={tenantId}
              onChange={e => setTenantId(e.target.value)}
              placeholder={status?.configured ? '••••••••••••••••' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
              className="input-dark w-full text-xs font-mono min-h-[36px]"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={handleSaveCredentials} disabled={saving}
            className="btn-primary text-[10px] px-3 py-1 flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle2 className="w-3 h-3" />}
            Save Credentials
          </button>
          {status?.configured && (
            <>
              <button type="button" onClick={handleClearCredentials}
                className="btn-danger text-[10px] px-3 py-1 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
              <button type="button" onClick={handleTestConnection} disabled={testing}
                className="btn-secondary text-[10px] px-3 py-1 flex items-center gap-1">
                {testing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Wifi className="w-3 h-3" />}
                Test Connection
              </button>
            </>
          )}
        </div>

        {/* Test Results */}
        {testResult && (
          <div className="space-y-1 text-[10px]">
            <div className={`flex items-center gap-1 ${testResult.graph?.success ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.graph?.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              Graph API: {testResult.graph?.success ? `Connected — ${testResult.graph.mailbox}` : testResult.graph?.error}
            </div>
            <div className={`flex items-center gap-1 ${testResult.smtp?.success ? 'text-green-400' : 'text-rmpg-500'}`}>
              {testResult.smtp?.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              SMTP: {testResult.smtp?.success ? 'Connected' : testResult.smtp?.error || 'Not configured'}
            </div>
          </div>
        )}
      </div>

      {/* ─── OAuth Authorization ─── */}
      {status?.configured && !status?.authorized && (
        <div className="panel-beveled p-3 space-y-3">
          <h3 className="text-xs font-semibold text-white flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-brand-400" />
            Authorization Required
          </h3>
          <p className="text-[10px] text-rmpg-400">
            Click below to sign in with Microsoft and grant RMPG Flex access to the mailbox.
            You will be redirected to Microsoft's login page.
          </p>
          <button type="button" onClick={handleAuthorize}
            className="btn-primary text-[10px] px-4 py-1.5 flex items-center gap-1.5">
            <ExternalLink className="w-3 h-3" />
            Authorize with Microsoft
          </button>
        </div>
      )}

      {/* ─── Polling Control ─── */}
      {status?.configured && status?.authorized && (
        <div className="panel-beveled p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-brand-400" />
              Inbox Sync
            </h3>
            <button type="button" onClick={handleToggleEnabled}
              className="flex items-center gap-1.5 text-[10px]">
              {status.enabled ? (
                <><ToggleRight className="w-5 h-5 text-green-400" /> <span className="text-green-400">Enabled</span></>
              ) : (
                <><ToggleLeft className="w-5 h-5 text-rmpg-500" /> <span className="text-rmpg-500">Disabled</span></>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[10px] text-rmpg-400">Poll Interval:</label>
            <select
              value={pollInterval}
              onChange={e => handlePollIntervalChange(Number(e.target.value))}
              className="select-dark text-[10px] px-2 py-0.5"
            >
              <option value={60}>1 minute</option>
              <option value={120}>2 minutes</option>
              <option value={300}>5 minutes</option>
              <option value={600}>10 minutes</option>
            </select>
            <button type="button" onClick={handleSyncNow} disabled={syncing}
              className="btn-secondary text-[10px] px-2 py-0.5 flex items-center gap-1">
              {syncing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <RefreshCw className="w-3 h-3" />}
              Sync Now
            </button>
          </div>
        </div>
      )}

      {/* ─── SMTP Fallback ─── */}
      <div className="panel-beveled p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-white flex items-center gap-2">
            <Send className="w-3.5 h-3.5 text-brand-400" />
            SMTP Fallback (Send-Only)
          </h3>
          <button type="button" onClick={() => handleSmtpSettings(!status?.smtpFallback)}
            className="flex items-center gap-1.5 text-[10px]">
            {status?.smtpFallback ? (
              <><ToggleRight className="w-5 h-5 text-green-400" /> <span className="text-green-400">Enabled</span></>
            ) : (
              <><ToggleLeft className="w-5 h-5 text-rmpg-500" /> <span className="text-rmpg-500">Disabled</span></>
            )}
          </button>
        </div>
        <p className="text-[10px] text-rmpg-500">
          Uses smtp.office365.com:587 as a fallback when Graph API is unavailable.
          Requires an app password from the Microsoft account.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showSmtpPassword ? 'text' : 'password'}
              value={smtpPassword}
              onChange={e => setSmtpPassword(e.target.value)}
              placeholder={status?.smtpFallback ? '••••••••••••' : 'Enter app password'}
              className="input-dark w-full text-xs font-mono pr-8 min-h-[36px]"
            />
            <button type="button" onClick={() => setShowSmtpPassword(!showSmtpPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white">
              {showSmtpPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button type="button" onClick={() => handleSmtpSettings(true)}
            disabled={!smtpPassword}
            className="btn-primary text-[10px] px-3 py-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
