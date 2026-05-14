import React from 'react';
import {
  CheckCircle2, XCircle, Loader2, Eye, EyeOff, Zap,
  ChevronDown, ChevronRight,
} from 'lucide-react';

// ── Types shared across AI panels ──

export interface ProviderInfo {
  name: string;
  available: boolean;
  model: string;
}

export interface AIConfig {
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

export interface UsageStats {
  requestsToday: number;
  requestsThisWeek: number;
  requestsThisMonth: number;
  avgResponseMs: number;
  cacheHitRate: number;
  totalRequests: number;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export const PROVIDER_LABELS: Record<string, string> = {
  groq: 'Groq (LLaMA)',
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama (Local)',
  auto: 'Auto (Fallback)',
};

export const PROVIDER_OPTIONS = ['auto', 'groq', 'gemini', 'openai', 'ollama'] as const;

export const FEATURE_LIST = [
  { key: 'callAnalysis', label: 'Call Analysis', desc: 'Auto-analyze new calls for risk factors' },
  { key: 'narrativeAssist', label: 'Narrative Assist', desc: 'AI-powered narrative generation for dispatchers' },
  { key: 'unitSuggestions', label: 'Unit Suggestions', desc: 'AI-suggested unit assignments' },
  { key: 'safetyBriefings', label: 'Safety Briefings', desc: 'Voice-announce AI safety alerts' },
  { key: 'dataCleanup', label: 'Data Cleanup', desc: 'AI-powered stale record detection and auto-fix' },
  { key: 'systemMonitoring', label: 'System Monitoring', desc: 'AI-powered system health monitoring' },
] as const;

// ── Sub-components ──

export function ProviderCard({
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
    <div className="bg-[#0b0b0b] border border-[#1c1c1c] rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isAvailable ? 'bg-green-500' : 'bg-rmpg-600'}`} />
        <span className="text-xs font-medium text-white flex-1">{label}</span>
        <button
          onClick={onTest}
          disabled={testResult === 'loading'}
          className="flex items-center gap-1 text-[10px] px-2 py-1 bg-[#121212] border border-[#1c1c1c] text-rmpg-300 hover:text-white hover:border-brand-500/50 rounded transition-colors disabled:opacity-50"
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

export function KeyInput({
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
          className="w-full bg-[#0b0b0b] border border-[#1c1c1c] text-white text-xs rounded px-2 py-1.5 pr-8 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600 font-mono"
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

export function ModelInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-rmpg-500 w-20 shrink-0">Model</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-[#0b0b0b] border border-[#1c1c1c] text-white text-xs rounded px-2 py-1.5 focus:border-brand-500 focus:outline-none placeholder:text-rmpg-600 font-mono"
      />
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-white font-mono">{value}</div>
      <div className="text-[10px] text-rmpg-500 mt-0.5">{label}</div>
    </div>
  );
}

export function HealthMetric({
  label,
  value,
  status,
  icon,
}: {
  label: string;
  value: string;
  status: 'green' | 'yellow' | 'red';
  icon: React.ReactNode;
}) {
  const colors = {
    green: 'text-green-400 border-green-900/30 bg-green-900/10',
    yellow: 'text-yellow-400 border-yellow-900/30 bg-yellow-900/10',
    red: 'text-red-400 border-red-900/30 bg-red-900/10',
  };
  const dotColors = { green: 'bg-green-500', yellow: 'bg-yellow-500', red: 'bg-red-500' };

  return (
    <div className={`px-3 py-2 border rounded ${colors[status]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-rmpg-500">{icon}</span>
        <span className="text-[10px] text-rmpg-500 uppercase">{label}</span>
        <span className={`w-1.5 h-1.5 rounded-full ml-auto ${dotColors[status]}`} />
      </div>
      <div className="text-sm font-bold font-mono">{value}</div>
    </div>
  );
}

export function CleanupSection({
  title,
  expanded,
  onToggle,
  empty,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left py-1"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-rmpg-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-rmpg-500" />
        )}
        <span className="text-xs text-white font-medium">{title}</span>
        {empty && <span className="text-[10px] text-green-500 ml-1">All clear</span>}
      </button>
      {expanded && !empty && (
        <div className="space-y-1.5 mt-1.5 ml-5">
          {children}
        </div>
      )}
    </div>
  );
}

export function ProviderSelect({
  value,
  onChange,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-[#0b0b0b] border border-[#1c1c1c] text-white text-xs rounded px-2 py-1.5 focus:border-brand-500 focus:outline-none ${className}`}
    >
      <option value="auto">Auto (Fallback)</option>
      <option value="groq">Groq (LLaMA)</option>
      <option value="gemini">Google Gemini</option>
      <option value="openai">OpenAI</option>
      <option value="ollama">Ollama (Local)</option>
    </select>
  );
}
