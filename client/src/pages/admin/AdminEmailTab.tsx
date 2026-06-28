import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mail, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, AlertTriangle, ToggleLeft, ToggleRight, RefreshCw,
  ExternalLink, Shield, Clock, Wifi, WifiOff, Send,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import AdminEmailRulesTab from './AdminEmailRulesTab';
import AdminEmailAuditTab from './AdminEmailAuditTab';

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
  const [subTab, setSubTab] = useState<'config' | 'rules' | 'audit'>('config');
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Credentials form
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  // Explicit success signal so the operator gets unambiguous feedback after
  // Save. The form clearing is too subtle; users were reporting "nothing
  // happened" because they didn't notice the connection-status pill move
  // from "Not Configured" → "Not Authorized".
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Password-manager autofill races React: Chrome/Safari can populate the
  // DOM value without firing a synthetic onChange, so controlled state
  // stays empty and the form appears "blank" even though the inputs are
  // visibly filled. Keep refs so handleSaveCredentials can fall back to
  // the live DOM value when state is empty.
  const clientIdRef = useRef<HTMLInputElement>(null);
  const clientSecretRef = useRef<HTMLInputElement>(null);
  const tenantIdRef = useRef<HTMLInputElement>(null);

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

  // Azure AD GUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  // tenantId may also be 'common', 'organizations', or 'consumers'.
  const AZURE_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SPECIAL_TENANTS = new Set(['common', 'organizations', 'consumers']);

  const handleSaveCredentials = async () => {
    // Fall back to the live DOM value when controlled state is empty —
    // catches password-manager autofill that bypasses React's onChange.
    const liveCid = clientIdRef.current?.value ?? '';
    const liveCsec = clientSecretRef.current?.value ?? '';
    const liveTid = tenantIdRef.current?.value ?? '';
    // Re-sync state if the DOM has a value the controlled input missed.
    if (!clientId && liveCid) setClientId(liveCid);
    if (!clientSecret && liveCsec) setClientSecret(liveCsec);
    if (!tenantId && liveTid) setTenantId(liveTid);

    // Trim to defend against trailing-space paste — a frequent Azure copy-paste foot-gun.
    const cid = (clientId || liveCid).trim();
    const csec = (clientSecret || liveCsec).trim();
    const tid = (tenantId || liveTid).trim();

    if (!cid || !csec || !tid) {
      setError('All three Azure AD fields are required.');
      return;
    }
    if (!AZURE_GUID.test(cid)) {
      setError('Application (Client) ID must be a GUID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. Copy it from Azure Portal → App registrations → Overview.');
      return;
    }
    if (!AZURE_GUID.test(tid) && !SPECIAL_TENANTS.has(tid.toLowerCase())) {
      setError('Directory (Tenant) ID must be a GUID, or one of: common, organizations, consumers. Copy it from Azure Portal → App registrations → Overview.');
      return;
    }
    if (AZURE_GUID.test(csec)) {
      setError('That looks like the Client Secret ID (a GUID). Paste the Secret VALUE instead — Azure shows it only once, right after you create the secret.');
      return;
    }
    if (csec.length < 20) {
      setError('Client Secret looks too short. Paste the full secret VALUE from Azure (typically 40+ characters).');
      return;
    }

    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await apiFetch('/email/admin/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: cid, clientSecret: csec, tenantId: tid }),
      });
      setClientId(''); setClientSecret(''); setTenantId('');
      setSaveSuccess(true);
      await fetchStatus();
      // Auto-dismiss after 8s; the persistent "Authorization Required"
      // panel below carries the long-lived state cue.
      setTimeout(() => setSaveSuccess(false), 8000);
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
      {/* ─── Sub-tab nav ─── */}
      <div className="flex gap-2 border-b border-border-default">
        <button
          onClick={() => setSubTab('config')}
          className={`px-3 py-1 text-xs ${subTab === 'config' ? 'text-[#d4a017] border-b-2 border-[#d4a017]' : 'text-rmpg-400'}`}
        >
          CONFIG
        </button>
        <button
          onClick={() => setSubTab('rules')}
          className={`px-3 py-1 text-xs ${subTab === 'rules' ? 'text-[#d4a017] border-b-2 border-[#d4a017]' : 'text-rmpg-400'}`}
        >
          RULES
        </button>
        <button
          onClick={() => setSubTab('audit')}
          className={`px-3 py-1 text-xs ${subTab === 'audit' ? 'text-[#d4a017] border-b-2 border-[#d4a017]' : 'text-rmpg-400'}`}
        >
          AUDIT
        </button>
      </div>

      {subTab === 'rules' && <AdminEmailRulesTab />}
      {subTab === 'audit' && <AdminEmailAuditTab />}
      {subTab === 'config' && <>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-sm bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400">&times;</button>
        </div>
      )}

      {saveSuccess && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-sm bg-green-500/10 border border-green-500/30 text-green-400">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            Credentials saved. Click <strong>Authorize with Microsoft</strong> below to complete setup.
          </span>
          <button type="button" onClick={() => setSaveSuccess(false)} className="ml-auto text-green-400/60 hover:text-green-400">&times;</button>
        </div>
      )}

      {/* ─── Connection Status ─── */}
      <div className="panel-beveled p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-rmpg-100 flex items-center gap-2">
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
              <span className="ml-1 text-rmpg-100 font-mono">{status.mailbox || '—'}</span>
            </div>
            <div>
              <span className="text-rmpg-500">Cached:</span>
              <span className="ml-1 text-rmpg-100">{status.cachedMessages} messages</span>
            </div>
            <div>
              <span className="text-rmpg-500">Last Sync:</span>
              <span className="ml-1 text-rmpg-100">{status.lastSync || 'Never'}</span>
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
      <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
      <div className="panel-beveled p-3 space-y-3">
        <h3 className="text-xs font-semibold text-rmpg-100 flex items-center gap-2">
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
            <div className="flex items-center justify-between mb-0.5">
              <label htmlFor="ff-adminemailtab-0" className="block text-[10px] text-rmpg-400">Application (Client) ID</label>
              {clientId.trim() && (
                AZURE_GUID.test(clientId.trim())
                  ? <span className="text-[9px] text-green-400">✓ valid GUID</span>
                  : <span className="text-[9px] text-red-400">✗ not a GUID</span>
              )}
            </div>
            <input id="ff-adminemailtab-0"
              ref={clientIdRef}
              type="text"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              onPaste={e => {
                // Capture pasted text directly — defends against React's
                // controlled-input race when paste triggers autofill heuristics.
                const text = e.clipboardData.getData('text');
                if (text) setTimeout(() => setClientId(text.trim()), 0);
              }}
              onBlur={e => { if (e.target.value !== clientId) setClientId(e.target.value); }}
              placeholder={status?.configured ? '••••••••••••••••' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
              className={`input-dark w-full text-xs font-mono min-h-[36px] ${clientId.trim() && !AZURE_GUID.test(clientId.trim()) ? 'border-red-500/60' : ''}`}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label htmlFor="ff-adminemailtab-1" className="block text-[10px] text-rmpg-400">Client Secret <span className="text-rmpg-600">(the VALUE, not the ID)</span></label>
              {clientSecret.trim() && (
                AZURE_GUID.test(clientSecret.trim())
                  ? <span className="text-[9px] text-red-400">✗ looks like the Secret ID — paste the VALUE</span>
                  : clientSecret.trim().length < 20
                    ? <span className="text-[9px] text-amber-400">⚠ unusually short</span>
                    : <span className="text-[9px] text-green-400">✓ looks ok</span>
              )}
            </div>
            <div className="relative">
              <input id="ff-adminemailtab-1"
                ref={clientSecretRef}
                type={showSecret ? 'text' : 'password'}
                value={clientSecret}
                onChange={e => setClientSecret(e.target.value)}
                onPaste={e => {
                  const text = e.clipboardData.getData('text');
                  if (text) setTimeout(() => setClientSecret(text.trim()), 0);
                }}
                onBlur={e => { if (e.target.value !== clientSecret) setClientSecret(e.target.value); }}
                placeholder={status?.configured ? '••••••••••••••••' : 'Enter client secret VALUE'}
                className={`input-dark w-full text-xs font-mono pr-8 min-h-[36px] ${clientSecret.trim() && (AZURE_GUID.test(clientSecret.trim()) || clientSecret.trim().length < 20) ? 'border-red-500/60' : ''}`}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-100">
                {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label htmlFor="ff-adminemailtab-2" className="block text-[10px] text-rmpg-400">Directory (Tenant) ID</label>
              {tenantId.trim() && (
                (AZURE_GUID.test(tenantId.trim()) || SPECIAL_TENANTS.has(tenantId.trim().toLowerCase()))
                  ? <span className="text-[9px] text-green-400">✓ valid</span>
                  : <span className="text-[9px] text-red-400">✗ not a GUID</span>
              )}
            </div>
            <input id="ff-adminemailtab-2"
              ref={tenantIdRef}
              type="text"
              value={tenantId}
              onChange={e => setTenantId(e.target.value)}
              onPaste={e => {
                const text = e.clipboardData.getData('text');
                if (text) setTimeout(() => setTenantId(text.trim()), 0);
              }}
              onBlur={e => { if (e.target.value !== tenantId) setTenantId(e.target.value); }}
              placeholder={status?.configured ? '••••••••••••••••' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
              className={`input-dark w-full text-xs font-mono min-h-[36px] ${tenantId.trim() && !AZURE_GUID.test(tenantId.trim()) && !SPECIAL_TENANTS.has(tenantId.trim().toLowerCase()) ? 'border-red-500/60' : ''}`}
              spellCheck={false}
              autoComplete="off"
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
      </form>

      {/* ─── OAuth Authorization ─── */}
      {status?.configured && !status?.authorized && (
        <div className="panel-beveled p-3 space-y-3">
          <h3 className="text-xs font-semibold text-rmpg-100 flex items-center gap-2">
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
            <h3 className="text-xs font-semibold text-rmpg-100 flex items-center gap-2">
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
            <label htmlFor="ff-adminemailtab-3" className="text-[10px] text-rmpg-400">Poll Interval:</label>
            <select id="ff-adminemailtab-3"
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
      <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
      <div className="panel-beveled p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-rmpg-100 flex items-center gap-2">
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
            <input id="ff-adminemailtab-4"
              type={showSmtpPassword ? 'text' : 'password'}
              value={smtpPassword}
              onChange={e => setSmtpPassword(e.target.value)}
              placeholder={status?.smtpFallback ? '••••••••••••' : 'Enter app password'}
              className="input-dark w-full text-xs font-mono pr-8 min-h-[36px]"
            />
            <button type="button" onClick={() => setShowSmtpPassword(!showSmtpPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-100">
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
      </form>
      </>}
    </div>
  );
}
