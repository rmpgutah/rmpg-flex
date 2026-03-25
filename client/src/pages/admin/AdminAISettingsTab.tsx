import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, CheckCircle2, XCircle, Loader2, Eye, EyeOff, Save,
  Zap, Activity, Shield, Mic, Database, Monitor, RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface ProviderInfo {
  name: string;
  available: boolean;
  model: string;
}

interface AIConfig {
  provider: string;
  autoFallback: boolean;
  features: {
    callAnalysis: boolean;
    narrativeAssist: boolean;
    unitSuggestions: boolean;
    safetyBriefings: boolean;
    dataCleanup: boolean;
    systemMonitoring: boolean;
  };
  providers: {
    groq: { apiKey: string; model: string };
    gemini: { apiKey: string; model: string };
    openai: { apiKey: string; model: string; baseUrl: string };
    ollama: { url: string; model: string };
  };
}

interface UsageStats {
  requestsToday: number;
  requestsThisWeek: number;
  requestsThisMonth: number;
  avgResponseMs: number;
  cacheHitRate: number;
  totalRequests: number;
}

interface TestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  groq: 'Groq (LLaMA)',
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama (Local)',
  auto: 'Auto (Fallback)',
};

const FEATURE_LIST = [
  { key: 'callAnalysis', label: 'Call Analysis', desc: 'Auto-analyze new calls for risk factors', icon: Shield },
  { key: 'narrativeAssist', label: 'Narrative Assist', desc: 'AI-powered narrative generation for dispatchers', icon: Zap },
  { key: 'unitSuggestions', label: 'Unit Suggestions', desc: 'AI-suggested unit assignments', icon: Activity },
  { key: 'safetyBriefings', label: 'Safety Briefings', desc: 'Voice-announce AI safety alerts', icon: Mic },
  { key: 'dataCleanup', label: 'Data Cleanup', desc: 'AI-powered stale record detection (future)', icon: Database },
  { key: 'systemMonitoring', label: 'System Monitoring', desc: 'AI health checks (future)', icon: Monitor },
] as const;

export default function AdminAISettingsTab({ LoadingSpinner, error, setError }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderInfo[]>([]);
  const [testResults, setTestResults] = useState<Record<string, TestResult | 'loading'>>({});

  // Local edit state for API keys (since they come masked)
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);

  // ── Fetch config + stats ──
  const fetchAll = useCallback(async () => {
    try {
      const [cfg, st, status] = await Promise.all([
        apiFetch<AIConfig>('/ai/config'),
        apiFetch<UsageStats>('/ai/stats'),
        apiFetch<{ provider: string; available: boolean; model: string; providers: ProviderInfo[] }>('/ai/status'),
      ]);
      setConfig(cfg);
      setStats(st);
      setProviderStatus(status.providers);
      setGroqKey(cfg.providers.groq.apiKey || '');
      setGeminiKey(cfg.providers.gemini.apiKey || '');
      setOpenaiKey(cfg.providers.openai.apiKey || '');
      setOpenaiBaseUrl(cfg.providers.openai.baseUrl || '');
      setOllamaUrl(cfg.providers.ollama.url || 'http://localhost:11434');
    } catch (err: any) {
      setError(err?.message || 'Failed to load AI configuration');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Save config ──
  const handleSave = async () => {
    if (!config) return;
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
      // Only send API keys if they were actually changed (not masked)
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
      setDirty(false);
      // Refresh status
      const status = await apiFetch<{ providers: ProviderInfo[] }>('/ai/status');
      setProviderStatus(status.providers);
    } catch (err: any) {
      setError(err?.message || 'Failed to save AI configuration');
    } finally {
      setSaving(false);
    }
  };

  // ── Test provider ──
  const testProvider = async (name: string) => {
    setTestResults(prev => ({ ...prev, [name]: 'loading' }));
    try {
      const result = await apiFetch<TestResult>(`/ai/test/${name}`);
      setTestResults(prev => ({ ...prev, [name]: result }));
    } catch {
      setTestResults(prev => ({ ...prev, [name]: { ok: false, latencyMs: 0, error: 'Request failed' } }));
    }
  };

  // ── Update helpers ──
  const updateProvider = (val: string) => {
    if (!config) return;
    setConfig({ ...config, provider: val });
    setDirty(true);
  };

  const toggleFeature = (key: string) => {
    if (!config) return;
    setConfig({
      ...config,
      features: { ...config.features, [key]: !(config.features as any)[key] },
    });
    setDirty(true);
  };

  const toggleFallback = () => {
    if (!config) return;
    setConfig({ ...config, autoFallback: !config.autoFallback });
    setDirty(true);
  };

  const updateModel = (provider: 'groq' | 'gemini' | 'openai' | 'ollama', model: string) => {
    if (!config) return;
    setConfig({
      ...config,
      providers: {
        ...config.providers,
        [provider]: { ...config.providers[provider], model },
      },
    });
    setDirty(true);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      {/* ── Save bar ── */}
      {dirty && (
        <div className="flex items-center gap-3 px-4 py-2 bg-yellow-900/20 border border-yellow-700/40 rounded text-yellow-400 text-xs">
          <span className="flex-1">You have unsaved changes.</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Configuration
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          Section 1: AI Provider Configuration
         ══════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="text-sm font-bold text-white tracking-wide uppercase mb-3 flex items-center gap-2">
          <Brain className="w-4 h-4 text-brand-400" />
          AI Provider Configuration
        </h2>

        {/* Active provider dropdown */}
        <div className="bg-[#0f1218] border border-[#1a1a2e] rounded p-4 space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs text-rmpg-400 w-32 shrink-0">Active Provider</label>
            <select
              value={config?.provider || 'groq'}
              onChange={e => updateProvider(e.target.value)}
              className="flex-1 max-w-xs bg-[#0a0a12] border border-[#1a1a2e] text-white text-xs rounded px-3 py-2 focus:border-brand-500 focus:outline-none"
            >
              <option value="auto">Auto (Fallback)</option>
              <option value="groq">Groq (LLaMA)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (Local)</option>
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config?.autoFallback ?? true}
              onChange={toggleFallback}
              className="rounded border-[#1a1a2e] bg-[#0a0a12] text-brand-500 focus:ring-brand-500 focus:ring-offset-0"
            />
            <span className="text-xs text-rmpg-300">Enable auto-fallback to other providers if primary fails</span>
          </label>

          {/* Provider cards */}
          <div className="grid gap-3">
            {/* Groq */}
            <ProviderCard
              name="groq"
              label="Groq"
              status={providerStatus.find(p => p.name === 'groq')}
              testResult={testResults.groq}
              onTest={() => testProvider('groq')}
            >
              <KeyInput
                label="API Key"
                value={groqKey}
                onChange={v => { setGroqKey(v); setDirty(true); }}
                show={!!showKeys.groq}
                onToggle={() => setShowKeys(p => ({ ...p, groq: !p.groq }))}
              />
              <ModelInput
                value={config?.providers.groq.model || ''}
                onChange={v => updateModel('groq', v)}
                placeholder="llama-3.3-70b-versatile"
              />
            </ProviderCard>

            {/* Gemini */}
            <ProviderCard
              name="gemini"
              label="Google Gemini"
              status={providerStatus.find(p => p.name === 'gemini')}
              testResult={testResults.gemini}
              onTest={() => testProvider('gemini')}
            >
              <KeyInput
                label="API Key"
                value={geminiKey}
                onChange={v => { setGeminiKey(v); setDirty(true); }}
                show={!!showKeys.gemini}
                onToggle={() => setShowKeys(p => ({ ...p, gemini: !p.gemini }))}
              />
              <ModelInput
                value={config?.providers.gemini.model || ''}
                onChange={v => updateModel('gemini', v)}
                placeholder="gemini-2.0-flash"
              />
            </ProviderCard>

            {/* OpenAI */}
            <ProviderCard
              name="openai"
              label="OpenAI"
              status={providerStatus.find(p => p.name === 'openai')}
              testResult={testResults.openai}
              onTest={() => testProvider('openai')}
            >
              <KeyInput
                label="API Key"
                value={openaiKey}
                onChange={v => { setOpenaiKey(v); setDirty(true); }}
                show={!!showKeys.openai}
                onToggle={() => setShowKeys(p => ({ ...p, openai: !p.openai }))}
              />
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-rmpg-500 w-20 shrink-0">Base URL</label>
                <input
                  type="text"
                  value={openaiBaseUrl}
                  onChange={e => { setOpenaiBaseUrl(e.target.value); setDirty(true); }}
                  placeholder="https://api.openai.com/v1"
                  className="flex-1 bg-[#0a0a12] border border-[#1a1a2e] text-white text-xs rounded px-2 py-1.5 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600"
                />
              </div>
              <ModelInput
                value={config?.providers.openai.model || ''}
                onChange={v => updateModel('openai', v)}
                placeholder="gpt-4o-mini"
              />
            </ProviderCard>

            {/* Ollama */}
            <ProviderCard
              name="ollama"
              label="Ollama (Local)"
              status={providerStatus.find(p => p.name === 'ollama')}
              testResult={testResults.ollama}
              onTest={() => testProvider('ollama')}
            >
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-rmpg-500 w-20 shrink-0">Server URL</label>
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={e => { setOllamaUrl(e.target.value); setDirty(true); }}
                  placeholder="http://localhost:11434"
                  className="flex-1 bg-[#0a0a12] border border-[#1a1a2e] text-white text-xs rounded px-2 py-1.5 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600"
                />
              </div>
              <ModelInput
                value={config?.providers.ollama.model || ''}
                onChange={v => updateModel('ollama', v)}
                placeholder="llama3.1"
              />
            </ProviderCard>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          Section 2: AI Features
         ══════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="text-sm font-bold text-white tracking-wide uppercase mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-brand-400" />
          AI Features
        </h2>
        <div className="bg-[#0f1218] border border-[#1a1a2e] rounded divide-y divide-[#1a1a2e]">
          {FEATURE_LIST.map(feat => {
            const Icon = feat.icon;
            const enabled = config ? (config.features as any)[feat.key] : false;
            const isFuture = feat.key === 'dataCleanup' || feat.key === 'systemMonitoring';
            return (
              <div key={feat.key} className="flex items-center gap-3 px-4 py-3">
                <Icon className={`w-4 h-4 shrink-0 ${enabled ? 'text-brand-400' : 'text-rmpg-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white font-medium">{feat.label}</span>
                    {isFuture && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-rmpg-700/30 text-rmpg-400">COMING SOON</span>
                    )}
                  </div>
                  <p className="text-[10px] text-rmpg-500 mt-0.5">{feat.desc}</p>
                </div>
                <button
                  onClick={() => toggleFeature(feat.key)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    enabled ? 'bg-brand-600' : 'bg-[#1a1a2e]'
                  }`}
                  aria-label={`Toggle ${feat.label}`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          Section 3: Usage Stats
         ══════════════════════════════════════════════════════════ */}
      <section>
        <h2 className="text-sm font-bold text-white tracking-wide uppercase mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-400" />
          AI Usage Statistics
          <button
            onClick={async () => {
              try {
                const st = await apiFetch<UsageStats>('/ai/stats');
                setStats(st);
              } catch { /* ignore */ }
            }}
            className="ml-auto p-1 text-rmpg-500 hover:text-white transition-colors"
            title="Refresh stats"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </h2>
        <div className="bg-[#0f1218] border border-[#1a1a2e] rounded p-4">
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <StatCard label="Today" value={stats.requestsToday} />
              <StatCard label="This Week" value={stats.requestsThisWeek} />
              <StatCard label="This Month" value={stats.requestsThisMonth} />
              <StatCard label="Avg Response" value={`${stats.avgResponseMs}ms`} />
              <StatCard label="Cache Hit Rate" value={`${stats.cacheHitRate}%`} />
              <StatCard label="Total Requests" value={stats.totalRequests} />
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">No usage data available.</p>
          )}
        </div>
      </section>

      {/* ── Bottom save button ── */}
      <div className="flex justify-end pb-4">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Configuration
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──

function ProviderCard({
  name,
  label,
  status,
  testResult,
  onTest,
  children,
}: {
  name: string;
  label: string;
  status?: { available: boolean; model: string };
  testResult?: TestResult | 'loading';
  onTest: () => void;
  children: React.ReactNode;
}) {
  const isAvailable = status?.available ?? false;
  return (
    <div className="bg-[#0a0a12] border border-[#1a1a2e] rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isAvailable ? 'bg-green-500' : 'bg-rmpg-600'}`} />
        <span className="text-xs font-medium text-white flex-1">{label}</span>
        <button
          onClick={onTest}
          disabled={testResult === 'loading'}
          className="flex items-center gap-1 text-[10px] px-2 py-1 bg-[#0f1218] border border-[#1a1a2e] text-rmpg-300 hover:text-white hover:border-brand-500/50 rounded transition-colors disabled:opacity-50"
        >
          {testResult === 'loading' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Zap className="w-3 h-3" />
          )}
          Test
        </button>
        {testResult && testResult !== 'loading' && (
          <span className={`flex items-center gap-1 text-[10px] ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {testResult.ok ? `${testResult.latencyMs}ms` : (testResult.error || 'Failed')}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function KeyInput({
  label,
  value,
  onChange,
  show,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-rmpg-500 w-20 shrink-0">{label}</label>
      <div className="relative flex-1">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Enter API key..."
          className="w-full bg-[#0a0a12] border border-[#1a1a2e] text-white text-xs rounded px-2 py-1.5 pr-8 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600 font-mono"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-rmpg-500 hover:text-white"
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function ModelInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-rmpg-500 w-20 shrink-0">Model</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-[#0a0a12] border border-[#1a1a2e] text-white text-xs rounded px-2 py-1.5 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600 font-mono"
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-white font-mono">{value}</div>
      <div className="text-[10px] text-rmpg-500 mt-0.5">{label}</div>
    </div>
  );
}
