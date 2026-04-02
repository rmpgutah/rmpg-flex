import React, { useState } from 'react';
import {
  Save, Loader2, ChevronUp, ChevronDown, Server,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { AIConfig, ProviderInfo, TestResult } from './AISharedComponents';
import { ProviderCard, KeyInput, ModelInput, ProviderSelect } from './AISharedComponents';

interface Props {
  config: AIConfig;
  providerStatus: ProviderInfo[];
  setConfig: (c: AIConfig) => void;
  onSaved: () => void;
  setError: (e: string | null) => void;
}

export default function AIProvidersPanel({ config, providerStatus, setConfig, onSaved, setError }: Props) {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult | 'loading'>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // Local key state (masked from server)
  const [groqKey, setGroqKey] = useState(config.providers.groq.apiKey || '');
  const [geminiKey, setGeminiKey] = useState(config.providers.gemini.apiKey || '');
  const [openaiKey, setOpenaiKey] = useState(config.providers.openai.apiKey || '');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(config.providers.openai.baseUrl || '');
  const [ollamaUrl, setOllamaUrl] = useState(config.providers.ollama.url || 'http://localhost:11434');

  // Provider priority
  const [priority, setPriority] = useState<string[]>(() => {
    // We'll fetch this from master-config on mount
    return ['groq', 'gemini', 'openai', 'ollama'];
  });

  // Fetch priority on mount
  React.useEffect(() => {
    apiFetch<any>('/ai/master-config').then(mc => {
      if (mc.providerPriority && Array.isArray(mc.providerPriority)) {
        setPriority(mc.providerPriority);
      }
    }).catch(() => {});
  }, []);

  const updateProvider = (val: string) => {
    setConfig({ ...config, provider: val });
    setDirty(true);
  };

  const toggleFallback = () => {
    setConfig({ ...config, autoFallback: !config.autoFallback });
    setDirty(true);
  };

  const updateModel = (provider: 'groq' | 'gemini' | 'openai' | 'ollama', model: string) => {
    setConfig({
      ...config,
      providers: {
        ...config.providers,
        [provider]: { ...config.providers[provider], model },
      },
    });
    setDirty(true);
  };

  const testProvider = async (name: string) => {
    setTestResults(prev => ({ ...prev, [name]: 'loading' }));
    try {
      const result = await apiFetch<TestResult>(`/ai/test/${name}`);
      setTestResults(prev => ({ ...prev, [name]: result }));
    } catch {
      setTestResults(prev => ({ ...prev, [name]: { ok: false, latencyMs: 0, error: 'Request failed' } }));
    }
  };

  const movePriority = (index: number, direction: -1 | 1) => {
    const newPriority = [...priority];
    const target = index + direction;
    if (target < 0 || target >= newPriority.length) return;
    [newPriority[index], newPriority[target]] = [newPriority[target], newPriority[index]];
    setPriority(newPriority);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        provider: config.provider,
        autoFallback: config.autoFallback,
        features: config.features,
        providers: {
          groq: { model: config.providers.groq.model },
          gemini: { model: config.providers.gemini.model },
          openai: { model: config.providers.openai.model, baseUrl: openaiBaseUrl },
          ollama: { url: ollamaUrl, model: config.providers.ollama.model },
        },
      };
      if (groqKey && !groqKey.includes('\u2022')) payload.providers.groq.apiKey = groqKey;
      if (geminiKey && !geminiKey.includes('\u2022')) payload.providers.gemini.apiKey = geminiKey;
      if (openaiKey && !openaiKey.includes('\u2022')) payload.providers.openai.apiKey = openaiKey;

      const result = await apiFetch<{ success: boolean; config: AIConfig }>('/ai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (result.config) {
        setConfig(result.config);
        setGroqKey(result.config.providers.groq.apiKey || '');
        setGeminiKey(result.config.providers.gemini.apiKey || '');
        setOpenaiKey(result.config.providers.openai.apiKey || '');
      }

      // Save priority
      await apiFetch('/ai/master-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerPriority: priority }),
      });

      setDirty(false);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Failed to save provider configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Active provider + fallback */}
      <div className="bg-[#0f1218] border border-[#1a1a2e] rounded p-4 space-y-3">
        <div className="flex items-center gap-3">
          <label className="text-xs text-rmpg-400 w-32 shrink-0">Active Provider</label>
          <ProviderSelect
            value={config.provider}
            onChange={updateProvider}
            className="flex-1 max-w-xs"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.autoFallback}
            onChange={toggleFallback}
            className="rounded border-[#1a1a2e] bg-[#0a0a12] text-brand-500 focus:ring-brand-500 focus:ring-offset-0"
          />
          <span className="text-xs text-rmpg-300">Enable auto-fallback to other providers if primary fails</span>
        </label>
      </div>

      {/* Provider Priority */}
      <div>
        <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2 flex items-center gap-2">
          <Server className="w-3.5 h-3.5 text-brand-400" />
          Fallback Priority Order
        </h3>
        <div className="bg-[#0f1218] border border-[#1a1a2e] rounded divide-y divide-[#1a1a2e]">
          {priority.map((p, i) => {
            const info = providerStatus.find(s => s.name === p);
            return (
              <div key={p} className="flex items-center gap-3 px-3 py-2">
                <span className="text-xs text-rmpg-500 font-mono w-5">{i + 1}.</span>
                <div className={`w-2 h-2 rounded-full ${info?.available ? 'bg-green-500' : 'bg-[#2a3e58]'}`} />
                <span className="text-xs text-white flex-1">{p.charAt(0).toUpperCase() + p.slice(1)}</span>
                <div className="flex gap-0.5">
                  <button
                    onClick={() => movePriority(i, -1)}
                    disabled={i === 0}
                    className="p-0.5 text-rmpg-500 hover:text-white disabled:opacity-20 transition-colors"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => movePriority(i, 1)}
                    disabled={i === priority.length - 1}
                    className="p-0.5 text-rmpg-500 hover:text-white disabled:opacity-20 transition-colors"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Provider Cards */}
      <div className="grid gap-3">
        <ProviderCard
          name="groq" label="Groq"
          status={providerStatus.find(p => p.name === 'groq')}
          testResult={testResults.groq} onTest={() => testProvider('groq')}
        >
          <KeyInput label="API Key" value={groqKey}
            onChange={v => { setGroqKey(v); setDirty(true); }}
            show={!!showKeys.groq} onToggle={() => setShowKeys(p => ({ ...p, groq: !p.groq }))} />
          <ModelInput value={config.providers.groq.model || ''} onChange={v => updateModel('groq', v)} placeholder="llama-3.3-70b-versatile" />
        </ProviderCard>

        <ProviderCard
          name="gemini" label="Google Gemini"
          status={providerStatus.find(p => p.name === 'gemini')}
          testResult={testResults.gemini} onTest={() => testProvider('gemini')}
        >
          <KeyInput label="API Key" value={geminiKey}
            onChange={v => { setGeminiKey(v); setDirty(true); }}
            show={!!showKeys.gemini} onToggle={() => setShowKeys(p => ({ ...p, gemini: !p.gemini }))} />
          <ModelInput value={config.providers.gemini.model || ''} onChange={v => updateModel('gemini', v)} placeholder="gemini-2.0-flash" />
        </ProviderCard>

        <ProviderCard
          name="openai" label="OpenAI"
          status={providerStatus.find(p => p.name === 'openai')}
          testResult={testResults.openai} onTest={() => testProvider('openai')}
        >
          <KeyInput label="API Key" value={openaiKey}
            onChange={v => { setOpenaiKey(v); setDirty(true); }}
            show={!!showKeys.openai} onToggle={() => setShowKeys(p => ({ ...p, openai: !p.openai }))} />
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-rmpg-500 w-20 shrink-0">Base URL</label>
            <input
              type="text" value={openaiBaseUrl}
              onChange={e => { setOpenaiBaseUrl(e.target.value); setDirty(true); }}
              placeholder="https://api.openai.com/v1"
              className="flex-1 bg-[#0a0a12] border border-[#1a1a2e] text-white text-xs rounded px-2 py-1.5 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600"
            />
          </div>
          <ModelInput value={config.providers.openai.model || ''} onChange={v => updateModel('openai', v)} placeholder="gpt-4o-mini" />
        </ProviderCard>

        <ProviderCard
          name="ollama" label="Ollama (Local)"
          status={providerStatus.find(p => p.name === 'ollama')}
          testResult={testResults.ollama} onTest={() => testProvider('ollama')}
        >
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-rmpg-500 w-20 shrink-0">Server URL</label>
            <input
              type="text" value={ollamaUrl}
              onChange={e => { setOllamaUrl(e.target.value); setDirty(true); }}
              placeholder="http://localhost:11434"
              className="flex-1 bg-[#0a0a12] border border-[#1a1a2e] text-white text-xs rounded px-2 py-1.5 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600"
            />
          </div>
          <ModelInput value={config.providers.ollama.model || ''} onChange={v => updateModel('ollama', v)} placeholder="llama3.1" />
        </ProviderCard>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Providers
        </button>
      </div>
    </div>
  );
}
