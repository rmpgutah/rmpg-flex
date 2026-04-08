import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Copy, CheckCircle2, XCircle, Key, AlertTriangle,
  Loader2, RotateCcw, ShieldCheck, ShieldOff, Globe, Eye, EyeOff, Save, Link2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { safeDateStr } from '../../utils/dateUtils';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  status: 'active' | 'revoked';
  last_used_at: string | null;
  request_count: number;
  created_at: string;
}

interface RequestLogEntry {
  id: number;
  created_at: string;
  details: string;
  ip_address: string | null;
  entity_id: string | null;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Third-Party API Keys Panel ──────────────────────────────
// Lets admins set RapidAPI keys for Lead Generation, DL OCR, etc.
const THIRD_PARTY_KEYS = [
  { key: 'lead_gen_rapidapi_key', label: 'Lead Generation (RapidAPI)', desc: 'Used by Overwatch → Firecrawl → Lead Gen tab' },
  { key: 'dl_ocr_rapidapi_key', label: 'DL OCR Scanner (RapidAPI)', desc: 'Used by Records → DL Search → Scan DL photo' },
] as const;

function ThirdPartyApiKeysPanel() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Check which keys are configured
    (async () => {
      try {
        const data = await apiFetch<Array<{ config_key: string; has_value: boolean }>>('/admin/third-party-keys');
        const map: Record<string, boolean> = {};
        for (const item of data) map[item.config_key] = item.has_value;
        setConfigured(map);
      } catch {
        // Endpoint may not exist yet — check individually
        for (const { key } of THIRD_PARTY_KEYS) {
          try {
            const resp = await apiFetch<{ configured: boolean }>(`/admin/third-party-keys/${key}`);
            setConfigured(prev => ({ ...prev, [key]: resp.configured }));
          } catch { /* silent */ }
        }
      }
    })();
  }, []);

  const handleSave = async (configKey: string) => {
    const value = values[configKey]?.trim();
    if (!value) return;
    setSaving(configKey);
    try {
      await apiFetch('/admin/third-party-keys', {
        method: 'PUT',
        body: JSON.stringify({ key: configKey, value }),
      });
      setConfigured(prev => ({ ...prev, [configKey]: true }));
      setValues(prev => ({ ...prev, [configKey]: '' }));
    } catch { /* silent */ }
    setSaving(null);
  };

  const handleClear = async (configKey: string) => {
    setSaving(configKey);
    try {
      await apiFetch('/admin/third-party-keys', {
        method: 'DELETE',
        body: JSON.stringify({ key: configKey }),
      });
      setConfigured(prev => ({ ...prev, [configKey]: false }));
    } catch { /* silent */ }
    setSaving(null);
  };

  return (
    <div className="panel-beveled bg-surface-base border border-[#1c2e42] rounded-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1c2e42]">
        <Key className="w-4 h-4 text-brand-400" />
        <h2 className="text-sm font-semibold text-rmpg-300">Third-Party API Keys</h2>
      </div>
      <div className="p-4 space-y-4">
        {THIRD_PARTY_KEYS.map(({ key, label, desc }) => (
<<<<<<< HEAD
          <div key={key} className="flex flex-col gap-2 p-3 bg-[#0c0f13] border border-[#1c2e42] rounded-sm">
=======
          <div key={key} className="flex flex-col gap-2 p-3 bg-[#0d1520] border border-[#1c2e42] rounded-sm">
>>>>>>> main
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-rmpg-300">{label}</div>
                <div className="text-[10px] text-rmpg-600">{desc}</div>
              </div>
              {configured[key] ? (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-sm bg-green-900/30 text-green-400 border border-green-700/40">
                  <CheckCircle2 className="w-3 h-3" />
                  Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-sm bg-yellow-900/30 text-yellow-400 border border-yellow-700/40">
                  <AlertTriangle className="w-3 h-3" />
                  Not Set
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey[key] ? 'text' : 'password'}
                  value={values[key] || ''}
                  onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={configured[key] ? '••••••••••••••••••••' : 'Paste API key here...'}
<<<<<<< HEAD
                  className="w-full px-3 py-2 pr-8 bg-[#161b21] border border-[#1c2e42] rounded-sm text-xs text-white font-mono placeholder-[#445566] focus:outline-none focus:border-brand-500"
=======
                  className="w-full px-3 py-2 pr-8 bg-[#141e2b] border border-[#1c2e42] rounded-sm text-xs text-white font-mono placeholder-[#445566] focus:outline-none focus:border-brand-500"
>>>>>>> main
                />
                <button type="button" onClick={() => setShowKey(prev => ({ ...prev, [key]: !prev[key] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-600 hover:text-rmpg-400">
                  {showKey[key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleSave(key)}
                disabled={!values[key]?.trim() || saving === key}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white rounded-sm transition-colors"
              >
                {saving === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
              {configured[key] && (
                <button
                  type="button"
                  onClick={() => handleClear(key)}
                  disabled={saving === key}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-700/30 rounded-sm transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="text-[9px] text-rmpg-700 font-mono">config_key: {key}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminIntegrationsTab({ LoadingSpinner, error, setError }: Props) {
  // ── Connected Service: rmpgutahps.us ──
  const [svcConfigured, setSvcConfigured] = useState(false);
  const [svcUrl, setSvcUrl] = useState('https://rmpgutahps.us');
  const [svcKeyPreview, setSvcKeyPreview] = useState<string | null>(null);
  const [svcApiKey, setSvcApiKey] = useState('');
  const [svcUrlInput, setSvcUrlInput] = useState('https://rmpgutahps.us');
  const [showSvcKey, setShowSvcKey] = useState(false);
  const [savingSvc, setSavingSvc] = useState(false);
  const [loadingSvc, setLoadingSvc] = useState(true);

  // ── API Keys ──
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);

  // ── Request Log ──
  const [requestLog, setRequestLog] = useState<RequestLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);

  // ── Create Modal ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Delete confirm ──
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // ── Data fetching ──

  const fetchSvcConfig = useCallback(async () => {
    try {
      const data = await apiFetch<{ configured: boolean; url: string; key_preview: string | null }>('/integrations/services/rmpgutahps');
      setSvcConfigured(data.configured);
      setSvcUrl(data.url);
      setSvcUrlInput(data.url);
      setSvcKeyPreview(data.key_preview);
    } catch (err) {
      console.error('Failed to fetch rmpgutahps config:', err);
    } finally {
      setLoadingSvc(false);
    }
  }, []);

  const handleSaveSvc = async () => {
    if (!svcApiKey.trim()) return;
    setSavingSvc(true);
    try {
      await apiFetch('/integrations/services/rmpgutahps', {
        method: 'PUT',
        body: JSON.stringify({ api_key: svcApiKey.trim(), url: svcUrlInput.trim() }),
      });
      setSvcApiKey('');
      setShowSvcKey(false);
      await fetchSvcConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSavingSvc(false);
    }
  };

  const handleClearSvc = async () => {
    try {
      await apiFetch('/integrations/services/rmpgutahps', { method: 'DELETE' });
      await fetchSvcConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear API key');
    }
  };

  const fetchKeys = useCallback(async () => {
    try {
      const data = await apiFetch<ApiKey[]>('/integrations/keys');
      setKeys(data);
    } catch (err) {
      console.error('Failed to fetch integration keys:', err);
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoadingKeys(false);
    }
  }, [setError]);

  const fetchRequestLog = useCallback(async () => {
    try {
      const data = await apiFetch<RequestLogEntry[]>('/integrations/keys/request-log');
      setRequestLog(data);
    } catch (err) {
      console.error('Failed to fetch request log:', err);
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    fetchSvcConfig();
    fetchKeys();
    fetchRequestLog();
  }, [fetchSvcConfig, fetchKeys, fetchRequestLog]);

  // ── Actions ──

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<{ key: string; id: number; name: string; key_prefix: string }>(
        '/integrations/keys',
        { method: 'POST', body: JSON.stringify({ name: newKeyName.trim() }) }
      );
      setCreatedKey(res.key);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: number) => {
    try {
      await apiFetch(`/integrations/keys/${id}/revoke`, { method: 'PATCH' });
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    }
  };

  const handleActivate = async (id: number) => {
    try {
      await apiFetch(`/integrations/keys/${id}/activate`, { method: 'PATCH' });
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate key');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/integrations/keys/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key');
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewKeyName('');
    setCreatedKey(null);
    setCopied(false);
  };

  // ── Render ──

  // Set document title
  useEffect(() => { document.title = 'Admin - Integrations \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreateModal(false); setShowCreateModal(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Connected Service: rmpgutahps.us ── */}
      <div className="panel-beveled bg-surface-base border border-[#1c2e42] rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1c2e42]">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-rmpg-300">rmpgutahps.us — Process Service Portal</h2>
          </div>
          <div className="flex items-center gap-2">
            {svcConfigured ? (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-green-900/30 text-green-400 border border-green-700/40">
                <CheckCircle2 className="w-3 h-3" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-yellow-900/30 text-yellow-400 border border-yellow-700/40">
                <AlertTriangle className="w-3 h-3" />
                Not Configured
              </span>
            )}
          </div>
        </div>

        {loadingSvc ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : (
          <div className="p-4 space-y-4">
            {/* URL */}
            <div>
              <label className="block text-xs text-rmpg-500 mb-1">Portal URL</label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1 px-3 py-2 bg-[#0c0f13] border border-[#1c2e42] rounded-sm">
                  <Link2 className="w-3.5 h-3.5 text-rmpg-500" />
                  <input
                    type="text"
                    value={svcUrlInput}
                    onChange={(e) => setSvcUrlInput(e.target.value)}
                    placeholder="https://rmpgutahps.us"
                    className="flex-1 bg-transparent text-sm text-rmpg-300 placeholder-rmpg-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-xs text-rmpg-500 mb-1">
                API Key {svcConfigured && svcKeyPreview && <span className="text-rmpg-600 ml-1">(current: {svcKeyPreview})</span>}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1 px-3 py-2 bg-[#0c0f13] border border-[#1c2e42] rounded-sm">
                  <Key className="w-3.5 h-3.5 text-rmpg-500" />
                  <input
                    type={showSvcKey ? 'text' : 'password'}
                    value={svcApiKey}
                    onChange={(e) => setSvcApiKey(e.target.value)}
                    placeholder={svcConfigured ? 'Enter new key to replace' : 'Paste API key from rmpgutahps.us'}
                    className="flex-1 bg-transparent text-sm text-rmpg-300 placeholder-rmpg-600 focus:outline-none font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveSvc()}
                  />
                  <button type="button"
                    onClick={() => setShowSvcKey(!showSvcKey)}
                    className="text-rmpg-500 hover:text-rmpg-300 transition-colors"
                  >
                    {showSvcKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <button type="button"
                  onClick={handleSaveSvc}
                  disabled={savingSvc || !svcApiKey.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors disabled:opacity-50"
                >
                  {savingSvc ? <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
                {svcConfigured && (
                  <button type="button"
                    onClick={handleClearSvc}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-700/30 rounded-sm transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </button>
                )}
              </div>
            </div>

            {svcConfigured && (
              <p className="text-xs text-rmpg-600">
                API key is encrypted and stored securely. The portal at {svcUrl} can submit process service requests to this system.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Third-Party RapidAPI Keys ── */}
      <ThirdPartyApiKeysPanel />

      {/* ── API Keys Panel ── */}
      <div className="panel-beveled bg-surface-base border border-[#1c2e42] rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1c2e42]">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-rmpg-300">Integration API Keys</h2>
          </div>
          <button type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create API Key
          </button>
        </div>

        {loadingKeys ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-8 text-rmpg-500 text-sm">
            No API keys created yet. Create one to enable integrations.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1c2e42] text-rmpg-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Key Prefix</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Last Used</th>
                  <th className="text-right px-4 py-2 font-medium">Requests</th>
                  <th className="text-left px-4 py-2 font-medium">Created</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k, idx) => (
                  <tr
                    key={k.id}
                    className={`border-b border-[#1c2e42]/50 hover:bg-[#1b2128] transition-colors ${
                      idx % 2 === 0 ? 'bg-transparent' : 'bg-[#0c0f13]/30'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-rmpg-300">{k.name}</td>
                    <td className="px-4 py-2.5">
                      <code className="text-xs font-mono text-rmpg-400 bg-[#0c0f13] px-1.5 py-0.5 rounded-sm">
                        {k.key_prefix}
                      </code>
                    </td>
                    <td className="px-4 py-2.5">
                      {k.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-green-900/30 text-green-400 border border-green-700/40">
                          <CheckCircle2 className="w-3 h-3" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-red-900/30 text-red-400 border border-red-700/40">
                          <XCircle className="w-3 h-3" />
                          Revoked
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-500 text-xs">
                      {k.last_used_at ? timeAgo(k.last_used_at) : 'Never'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-rmpg-400 font-mono text-xs">
                      {k.request_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-500 text-xs">
                      {safeDateStr(k.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {k.status === 'active' ? (
                          <button type="button"
                            onClick={() => handleRevoke(k.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-yellow-400 hover:text-yellow-300 bg-yellow-900/20 hover:bg-yellow-900/30 border border-yellow-700/30 rounded-sm transition-colors"
                            title="Revoke key"
                          >
                            <ShieldOff className="w-3 h-3" />
                            Revoke
                          </button>
                        ) : (
                          <button type="button"
                            onClick={() => handleActivate(k.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-900/30 border border-green-700/30 rounded-sm transition-colors"
                            title="Re-activate key"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            Activate
                          </button>
                        )}
                        {deletingId === k.id ? (
                          <div className="flex items-center gap-1">
                            <button type="button"
                              onClick={() => handleDelete(k.id)}
                              className="px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-900/30 hover:bg-red-900/40 border border-red-700/40 rounded-sm transition-colors"
                            >
                              Confirm
                            </button>
                            <button type="button"
                              onClick={() => setDeletingId(null)}
                              className="px-2 py-1 text-xs text-rmpg-500 hover:text-rmpg-400 bg-[#1b2128] rounded-sm transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button type="button"
                            onClick={() => setDeletingId(k.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-700/30 rounded-sm transition-colors"
                            title="Delete key"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Request Log Panel ── */}
      <div className="panel-beveled bg-surface-base border border-[#1c2e42] rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1c2e42]">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-rmpg-300">Recent Service Requests</h2>
          </div>
          <button type="button"
            onClick={() => { setLoadingLog(true); fetchRequestLog(); }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-rmpg-400 hover:text-rmpg-300 bg-[#1b2128] hover:bg-[#1b2128]/80 rounded-sm transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Refresh
          </button>
        </div>

        {loadingLog ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : requestLog.length === 0 ? (
          <div className="text-center py-8 text-rmpg-500 text-sm">
            No requests yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1c2e42] text-rmpg-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Time</th>
                  <th className="text-left px-4 py-2 font-medium">Details</th>
                  <th className="text-left px-4 py-2 font-medium">IP Address</th>
                  <th className="text-left px-4 py-2 font-medium">Call ID</th>
                </tr>
              </thead>
              <tbody>
                {requestLog.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    className={`border-b border-[#1c2e42]/50 hover:bg-[#1b2128] transition-colors ${
                      idx % 2 === 0 ? 'bg-transparent' : 'bg-[#0c0f13]/30'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-rmpg-500 text-xs whitespace-nowrap">
                      {timeAgo(entry.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-300 text-xs">
                      {entry.details}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-400 font-mono text-xs">
                      {entry.ip_address || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-400 font-mono text-xs">
                      {entry.entity_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create Key Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <div className="bg-surface-raised border border-[#1c2e42] rounded-sm shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1c2e42]">
              <h3 className="text-sm font-semibold text-rmpg-300">Create API Key</h3>
              {createdKey && (
                <button type="button"
                  onClick={closeCreateModal}
                  className="text-rmpg-500 hover:text-rmpg-300 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="p-4 space-y-4">
              {!createdKey ? (
                <>
                  <div>
                    <label className="block text-xs text-rmpg-500 mb-1">Key Name</label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. Process Service API"
                      className="w-full px-3 py-2 text-sm bg-[#0c0f13] border border-[#1c2e42] rounded-sm text-rmpg-300 placeholder-rmpg-600 focus:outline-none focus:border-brand-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button"
                      onClick={closeCreateModal}
                      className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-rmpg-300 bg-[#1b2128] rounded-sm transition-colors"
                    >
                      Cancel
                    </button>
                    <button type="button"
                      onClick={handleCreate}
                      disabled={creating || !newKeyName.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors disabled:opacity-50"
                    >
                      {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> : <Plus className="w-3.5 h-3.5" />}
                      Create
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-rmpg-500 mb-1">Your API Key</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2.5 text-sm font-mono bg-green-900/20 border border-green-700/40 rounded-sm text-green-300 break-all select-all">
                        {createdKey}
                      </code>
                      <button type="button"
                        onClick={() => handleCopy(createdKey)}
                        className="flex-shrink-0 flex items-center gap-1 px-3 py-2.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors"
                        title="Copy to clipboard"
                      >
                        {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-sm">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-300">
                      Save this API key now — it cannot be retrieved again.
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <button type="button"
                      onClick={closeCreateModal}
                      className="px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
