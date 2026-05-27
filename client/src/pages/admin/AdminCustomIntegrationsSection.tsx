// ============================================================
// RMPG Flex — Custom External Integrations (Admin)
// ------------------------------------------------------------
// Admin-managed registry of OUTBOUND HTTP integrations the app
// can call into. Distinct from the inbound API-keys section
// above: those are keys other systems use to call Flex; these
// are credentials Flex uses to call other systems.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus, Trash2, CheckCircle2, XCircle, Loader2, Save,
  Activity, Pencil, Power, PowerOff, ServerCog,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';

interface ExternalIntegration {
  id: string;
  name: string;
  description: string;
  base_url: string;
  auth_type: 'none' | 'api_key' | 'bearer' | 'basic' | 'header';
  auth_header_name: string;
  has_credential: boolean;
  default_headers: Record<string, string>;
  enabled: boolean;
  last_tested_at: string | null;
  last_test_status: 'ok' | 'error' | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
}

interface FormState {
  id?: string;
  name: string;
  description: string;
  base_url: string;
  auth_type: ExternalIntegration['auth_type'];
  auth_header_name: string;
  auth_value: string;
  default_headers: string;  // JSON-as-string for textarea
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  name: '', description: '', base_url: '',
  auth_type: 'none', auth_header_name: '', auth_value: '',
  default_headers: '{}', enabled: true,
};

const AUTH_HINTS: Record<ExternalIntegration['auth_type'], string> = {
  none: 'No authentication header sent',
  api_key: 'Sent as a custom header (e.g. X-API-Key)',
  bearer: 'Sent as Authorization: Bearer <token>',
  basic: 'Sent as Authorization: Basic base64(<credential>) — credential should already be "user:pass"',
  header: 'Sent as a custom header you name (e.g. X-Auth-Token)',
};

export default function AdminCustomIntegrationsSection() {
  const [items, setItems] = useState<ExternalIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiFetch<ExternalIntegration[]>('/api/admin/external-integrations');
      setItems(asArray<ExternalIntegration>(list));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const beginCreate = () => {
    setForm(EMPTY_FORM); setEditing(null); setShowForm(true);
  };
  const beginEdit = (it: ExternalIntegration) => {
    setForm({
      id: it.id,
      name: it.name,
      description: it.description,
      base_url: it.base_url,
      auth_type: it.auth_type,
      auth_header_name: it.auth_header_name,
      auth_value: '',  // never pre-fill credential — user supplies fresh value to update
      default_headers: JSON.stringify(it.default_headers || {}, null, 2),
      enabled: it.enabled,
    });
    setEditing(it.id); setShowForm(true);
  };
  const cancel = () => { setForm(EMPTY_FORM); setEditing(null); setShowForm(false); };

  const submit = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.base_url.trim()) { setError('Base URL is required'); return; }
    let parsedHeaders: Record<string, string> = {};
    try {
      const v = JSON.parse(form.default_headers || '{}');
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k, val] of Object.entries(v)) parsedHeaders[k] = String(val);
      }
    } catch {
      setError('Default headers must be valid JSON object'); return;
    }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        base_url: form.base_url.trim(),
        auth_type: form.auth_type,
        auth_header_name: form.auth_header_name.trim() || null,
        default_headers: parsedHeaders,
        enabled: form.enabled,
      };
      // Only send auth_value if user filled it. On edit, blank = leave existing.
      if (form.auth_value.length > 0) body.auth_value = form.auth_value;

      if (editing) {
        await apiFetch(`/api/admin/external-integrations/${editing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/api/admin/external-integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      cancel();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (it: ExternalIntegration) => {
    if (!confirm(`Delete integration "${it.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/admin/external-integrations/${it.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const toggleEnabled = async (it: ExternalIntegration) => {
    try {
      await apiFetch(`/api/admin/external-integrations/${it.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !it.enabled }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed');
    }
  };

  const test = async (it: ExternalIntegration) => {
    setTestingId(it.id);
    try {
      await apiFetch(`/api/admin/external-integrations/${it.id}/test`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-[#141414] border border-[#222] rounded-sm">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#222]">
          <div className="flex items-center gap-2">
            <ServerCog className="w-4 h-4 text-[#d4a017]" />
            <h2 className="text-sm font-semibold text-rmpg-300">Custom External Integrations</h2>
          </div>
          {!showForm && (
            <button
              type="button"
              onClick={beginCreate}
              aria-label="Add new integration"
              className="text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-[#d4a017] text-black rounded-sm hover:bg-[#f0bf38] flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add Integration
            </button>
          )}
        </div>
        <div className="px-4 py-2 text-[10px] text-rmpg-500 border-b border-[#1a1a1a] leading-snug">
          Outbound HTTP credentials for calling other software from Flex. Distinct
          from API keys above (which are inbound). Credentials are encrypted at rest
          using the same AES-256-GCM scheme as system_config.
        </div>

        {showForm && (
          <div className="px-4 py-3 border-b border-[#1a1a1a] bg-[#0c0c0c] space-y-3">
            <h3 className="text-xs font-bold text-rmpg-200 uppercase">
              {editing ? 'Edit Integration' : 'New Integration'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase text-rmpg-400">Name</span>
                <input
                  type="text" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs text-white"
                  placeholder="e.g. PaymentProcessor v2"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase text-rmpg-400">Base URL</span>
                <input
                  type="url" value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs text-white"
                  placeholder="https://api.example.com/v1"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase text-rmpg-400">Description</span>
              <input
                type="text" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs text-white"
                placeholder="What this integration is used for"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase text-rmpg-400">Auth Type</span>
                <select
                  value={form.auth_type}
                  onChange={(e) => setForm({ ...form, auth_type: e.target.value as FormState['auth_type'] })}
                  className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs text-white"
                >
                  <option value="none">None</option>
                  <option value="api_key">API Key (custom header)</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="basic">Basic Auth</option>
                  <option value="header">Custom Header</option>
                </select>
              </label>
              {(form.auth_type === 'api_key' || form.auth_type === 'header') && (
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase text-rmpg-400">Header Name</span>
                  <input
                    type="text" value={form.auth_header_name}
                    onChange={(e) => setForm({ ...form, auth_header_name: e.target.value })}
                    className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs text-white"
                    placeholder="X-API-Key"
                  />
                </label>
              )}
              <label className="block sm:col-span-1">
                <span className="text-[10px] font-semibold uppercase text-rmpg-400">
                  {editing ? 'Credential (leave blank to keep existing)' : 'Credential'}
                </span>
                <input
                  type="password" value={form.auth_value}
                  onChange={(e) => setForm({ ...form, auth_value: e.target.value })}
                  className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs text-white font-mono"
                  placeholder={form.auth_type === 'basic' ? 'user:pass' : 'token / api key'}
                  disabled={form.auth_type === 'none'}
                />
              </label>
            </div>
            <div className="text-[10px] text-rmpg-500 italic">{AUTH_HINTS[form.auth_type]}</div>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase text-rmpg-400">
                Default Headers (JSON, applied to every call)
              </span>
              <textarea
                value={form.default_headers}
                onChange={(e) => setForm({ ...form, default_headers: e.target.value })}
                rows={3}
                className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs text-white font-mono"
                placeholder='{"Accept": "application/json"}'
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-rmpg-300">
              <input
                type="checkbox" checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="flex gap-2">
              <button
                type="button" onClick={submit} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a017] text-black text-[11px] uppercase font-bold rounded-sm disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editing ? 'Save Changes' : 'Create'}
              </button>
              <button
                type="button" onClick={cancel}
                className="px-3 py-1.5 text-[11px] uppercase font-bold text-rmpg-300 hover:text-white border border-[#222] rounded-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="px-4 py-2 text-[11px] text-red-300 bg-red-900/20 border-b border-red-800/30">
            {error}
          </div>
        )}

        {loading ? (
          <div className="px-4 py-6 text-center text-rmpg-500 text-xs">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-6 text-center text-rmpg-500 text-xs italic">
            No external integrations configured. Click "Add Integration" to set one up.
          </div>
        ) : (
          <div className="divide-y divide-[#1a1a1a]">
            {items.map((it) => (
              <div key={it.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-white">{it.name}</span>
                    {!it.enabled && (
                      <span className="text-[9px] uppercase font-bold text-amber-300 bg-amber-900/30 px-1.5 py-0.5 rounded-sm">
                        Disabled
                      </span>
                    )}
                    {it.last_test_status === 'ok' && (
                      <span className="text-[9px] uppercase font-bold text-emerald-300 bg-emerald-900/30 px-1.5 py-0.5 rounded-sm flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> OK
                      </span>
                    )}
                    {it.last_test_status === 'error' && (
                      <span className="text-[9px] uppercase font-bold text-red-300 bg-red-900/30 px-1.5 py-0.5 rounded-sm flex items-center gap-1">
                        <XCircle className="w-2.5 h-2.5" /> Error
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-rmpg-400 font-mono break-all">{it.base_url}</div>
                  {it.description && (
                    <div className="text-[11px] text-rmpg-500 mt-0.5">{it.description}</div>
                  )}
                  <div className="text-[10px] text-rmpg-600 mt-1 flex flex-wrap gap-3">
                    <span>Auth: <span className="text-rmpg-400">{it.auth_type}</span></span>
                    {it.has_credential && <span className="text-emerald-400">credential set</span>}
                    {it.last_tested_at && (
                      <span>
                        Tested: <span className="text-rmpg-400">{new Date(it.last_tested_at).toLocaleString()}</span>
                        {it.last_test_message && <span className="text-rmpg-500"> — {it.last_test_message}</span>}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button" onClick={() => test(it)} disabled={testingId === it.id}
                    title="Test connection (GET base_url)"
                    aria-label={`Test connection to ${it.name}`}
                    className="p-1.5 text-rmpg-400 hover:text-[#d4a017] disabled:opacity-50"
                  >
                    {testingId === it.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                  </button>
                  <button
                    type="button" onClick={() => toggleEnabled(it)}
                    title={it.enabled ? 'Disable' : 'Enable'}
                    aria-label={`${it.enabled ? 'Disable' : 'Enable'} ${it.name}`}
                    className="p-1.5 text-rmpg-400 hover:text-white"
                  >
                    {it.enabled ? <Power className="w-4 h-4 text-emerald-400" /> : <PowerOff className="w-4 h-4" />}
                  </button>
                  <button
                    type="button" onClick={() => beginEdit(it)}
                    title="Edit"
                    aria-label={`Edit ${it.name}`}
                    className="p-1.5 text-rmpg-400 hover:text-[#d4a017]"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button" onClick={() => remove(it)}
                    title="Delete"
                    aria-label={`Delete ${it.name}`}
                    className="p-1.5 text-rmpg-400 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
