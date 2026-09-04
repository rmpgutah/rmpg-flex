import React, { useState, useEffect, useCallback } from 'react';
import { Key, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Shield, Search, Globe, Database } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface ProviderDef {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  required?: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { key: 'microbilt_api_key', label: 'MicroBilt', description: 'People search, address, phone, background (primary OSINT)', icon: Database, required: true },
  { key: 'pipl_api_key', label: 'Pipl', description: 'Deep people search with relationship graph', icon: Shield },
  { key: 'spokeo_api_key', label: 'Spokeo', description: 'People search by name, phone, email, address', icon: Search },
  { key: 'numverify_api_key', label: 'NumVerify', description: 'Phone number validation and carrier lookup', icon: Key },
  { key: 'hunter_api_key', label: 'Hunter.io', description: 'Email verification and domain intelligence', icon: Globe },
  { key: 'clearbit_api_key', label: 'Clearbit', description: 'Email-based person and company enrichment', icon: Database },
];

interface ConfigRow { config_key: string; config_value?: string; is_active: number }

export default function AdminPersonIntelTab({ LoadingSpinner, error, setError }: Props) {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // /admin/config returns a flat Record<string,string> — not an array.
      // Use /admin/config-items (grouped by category) and flatten so we get
      // real ConfigRow objects with is_active values.
      const grouped = await apiFetch<Record<string, ConfigRow[]>>('/admin/config-items');
      const providerKeys = new Set(PROVIDERS.map(p => p.key));
      const data: ConfigRow[] = (Object.values(grouped) as ConfigRow[][])
        .flat()
        .filter(r => providerKeys.has(r.config_key));
      setRows(data);
      const init: Record<string, string> = {};
      data.forEach(r => { init[r.config_key] = r.config_value ?? ''; });
      setValues(init);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { load(); }, [load]);

  const save = async (key: string) => {
    setSaving(key);
    try {
      await apiFetch('/admin/config', {
        method: 'POST',
        body: JSON.stringify({ config_key: key, config_value: values[key] ?? '', is_active: 1 }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  };

  const isConfigured = (key: string) => rows.some(r => r.config_key === key && r.is_active && r.config_value);

  if (loading) return <div className="p-4"><LoadingSpinner /></div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5 text-brand-400" />
        <h2 className="text-sm font-semibold text-rmpg-100">Person Intelligence OSINT Keys</h2>
        <span className="text-xs text-rmpg-400 ml-2">Stored in system_config table (encrypted at rest via D1)</span>
      </div>
      <p className="text-xs text-rmpg-400 mb-4">
        These keys power the 3-phase Person Intelligence pipeline. MicroBilt is the primary source;
        all others add corroboration. Keys with 3+ sources achieve 76%+ confidence on merged data points.
        Firecrawl (Phase 3 webcrawl) is configured under API Integrations.
      </p>

      <div className="grid gap-3">
        {PROVIDERS.map(p => {
          const Icon = p.icon;
          const configured = isConfigured(p.key);
          const isSaving = saving === p.key;
          return (
            <div key={p.key} className="bg-surface-raised rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-semibold text-rmpg-100">{p.label}</span>
                {p.required && <span className="text-[10px] text-amber-400 border border-amber-400/40 rounded px-1">PRIMARY</span>}
                {configured
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 ml-auto" />
                  : <XCircle className="w-3.5 h-3.5 text-rmpg-500 ml-auto" />}
              </div>
              <p className="text-[11px] text-rmpg-400">{p.description}</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={shown[p.key] ? 'text' : 'password'}
                    className="w-full text-xs bg-surface-base border border-rmpg-700 rounded px-2 py-1 pr-7 text-rmpg-100 placeholder-rmpg-600 focus:outline-none focus:border-brand-400"
                    placeholder={configured ? '••••••••••••••••' : 'Paste API key…'}
                    value={values[p.key] ?? ''}
                    onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300"
                    onClick={() => setShown(s => ({ ...s, [p.key]: !s[p.key] }))}
                  >
                    {shown[p.key] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
                <button
                  className="text-xs bg-brand-600 hover:bg-brand-500 text-white rounded px-3 py-1 disabled:opacity-50"
                  disabled={isSaving || !values[p.key]}
                  onClick={() => save(p.key)}
                >
                  {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
