import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Key, Eye, EyeOff, Loader2, CheckCircle2,
  Trash2, AlertTriangle, ExternalLink, Send, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import AdminEmailRulesTab from './AdminEmailRulesTab';
import AdminEmailAuditTab from './AdminEmailAuditTab';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

// Phase 3 cutover: email moved from one shared admin-owned mailbox to
// personal per-user mailboxes (see EmailPage.tsx's connect-gate, backed by
// GET/DELETE /email/connect/*). This tab is now scoped to the Azure AD app
// registration only — the shared "Authorize", "Enabled"/poll-interval, and
// "Connection Status" UI that used to live here described a single shared
// mailbox's OAuth grant, which no longer exists; each operator connects
// their own mailbox from the Email page instead.
interface EmailStatus {
  configured: boolean;
  smtpFallback: boolean;
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
  // happened" because they didn't notice anything change.
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

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<EmailStatus>('/email/status');
      setStatus(data);
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
      setTimeout(() => setSaveSuccess(false), 8000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClearCredentials = async () => {
    if (!confirm('Clear the Microsoft email app-registration credentials and cached emails? Users will need an admin to re-enter credentials before they can connect or reconnect their mailbox.')) return;
    try {
      await apiFetch('/email/admin/credentials', { method: 'DELETE' });
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

  // Set document title
  useEffect(() => { document.title = 'Admin - Email \u2014 RMPG Flex'; }, []);

  if (loading) return <div className="p-8 text-center"><LoadingSpinner /></div>;

  return (
    <div className="space-y-4">
      {/* ─── Sub-tab nav ─── */}
      <div className="flex gap-2 border-b border-border-default">
        <button
          onClick={() => setSubTab('config')}
          className={`px-3 py-1 text-xs ${subTab === 'config' ? 'text-accent-silver-500 border-b-2 border-accent-silver-500' : 'text-rmpg-400'}`}
        >
          CONFIG
        </button>
        <button
          onClick={() => setSubTab('rules')}
          className={`px-3 py-1 text-xs ${subTab === 'rules' ? 'text-accent-silver-500 border-b-2 border-accent-silver-500' : 'text-rmpg-400'}`}
        >
          RULES
        </button>
        <button
          onClick={() => setSubTab('audit')}
          className={`px-3 py-1 text-xs ${subTab === 'audit' ? 'text-accent-silver-500 border-b-2 border-accent-silver-500' : 'text-rmpg-400'}`}
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
            Credentials saved. Users can now connect their own mailbox from the Email page.
          </span>
          <button type="button" onClick={() => setSaveSuccess(false)} className="ml-auto text-green-400/60 hover:text-green-400">&times;</button>
        </div>
      )}

      {/* ─── Azure AD Credentials ─── */}
      <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
      <div className="panel-beveled p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-rmpg-100 flex items-center gap-2">
            <Key className="w-3.5 h-3.5 text-brand-400" />
            Azure AD Credentials
          </h3>
          <span className={`text-[10px] ${status?.configured ? 'text-green-400' : 'text-rmpg-500'}`}>
            {status?.configured ? 'Configured' : 'Not Configured'}
          </span>
        </div>
        <p className="text-[10px] text-rmpg-500">
          Register an app at{' '}
          <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
            target="_blank" rel="noopener" className="text-brand-400 hover:underline">
            Azure Portal <ExternalLink className="w-2.5 h-2.5 inline" />
          </a>
          {' '}with this redirect URI (each user connects their own mailbox from the Email page):{' '}
          <code className="text-rmpg-300 bg-surface-sunken px-1 rounded-sm">https://rmpgutah.us/api/email/connect/callback</code>
          . Credentials can also be set via Worker env (
          <code className="text-fg-muted">MS_EMAIL_CLIENT_ID</code>,{' '}
          <code className="text-fg-muted">MS_EMAIL_CLIENT_SECRET</code>,{' '}
          <code className="text-fg-muted">MS_EMAIL_TENANT_ID</code>
          ) — env bindings take precedence over values saved here.
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
            <button type="button" onClick={handleClearCredentials}
              className="btn-danger text-[10px] px-3 py-1 flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </div>
      </form>

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
