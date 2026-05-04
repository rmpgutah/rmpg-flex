import { useState, useEffect } from 'react';
import { Save, Loader2, Zap } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { AIConfig } from './AISharedComponents';
import { FEATURE_LIST } from './AISharedComponents';

interface Props {
  config: AIConfig;
  setConfig: (c: AIConfig) => void;
  onSaved: () => void;
  setError: (e: string | null) => void;
}

export default function AICapabilitiesPanel({ config, setConfig, onSaved, setError }: Props) {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [routingRules, setRoutingRules] = useState<Record<string, { provider: string }>>({});

  useEffect(() => {
    apiFetch<any>('/ai/master-config').then(mc => {
      if (mc.routingRules) setRoutingRules(mc.routingRules);
    }).catch(() => {});
  }, []);

  const toggleFeature = (key: string) => {
    setConfig({
      ...config,
      features: { ...config.features, [key]: !(config.features as any)[key] },
    });
    setDirty(true);
  };

  const updateRouting = (key: string, provider: string) => {
    setRoutingRules(prev => ({
      ...prev,
      [key]: { ...prev[key], provider },
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save features via config endpoint
      await apiFetch('/ai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: config.provider,
          autoFallback: config.autoFallback,
          features: config.features,
          providers: config.providers,
        }),
      });

      // Save routing rules via master-config endpoint
      await apiFetch('/ai/master-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routingRules }),
      });

      setDirty(false);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Failed to save capabilities');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-white uppercase tracking-wide flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-brand-400" />
        AI Capabilities
      </h3>

      <div className="bg-[#121212] border border-[#1c1c1c] rounded divide-y divide-[#1c1c1c]">
        {FEATURE_LIST.map(feat => {
          const enabled = (config.features as any)[feat.key] ?? false;
          const override = routingRules[feat.key]?.provider || 'auto';
          return (
            <div key={feat.key} className="flex items-center gap-3 px-4 py-3">
              {/* Toggle */}
              <button
                onClick={() => toggleFeature(feat.key)}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                  enabled ? 'bg-brand-600' : 'bg-[#1c1c1c]'
                }`}
                aria-label={`Toggle ${feat.label}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>

              {/* Name + description */}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white font-medium">{feat.label}</div>
                <p className="text-[10px] text-rmpg-500 mt-0.5">{feat.desc}</p>
              </div>

              {/* Provider override */}
              <select
                value={override}
                onChange={e => updateRouting(feat.key, e.target.value)}
                className="bg-[#0b0b0b] border border-[#1c1c1c] text-white text-[10px] rounded px-2 py-1 focus:border-brand-500 focus:outline-none shrink-0"
              >
                <option value="auto">Auto</option>
                <option value="groq">Groq</option>
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
          );
        })}
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Capabilities
        </button>
      </div>
    </div>
  );
}
