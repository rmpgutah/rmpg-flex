import React, { useState, useEffect } from 'react';
import {
  Loader2, RefreshCw, Zap, Clock, Monitor, Wifi, Brain,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { ProviderInfo, UsageStats, TestResult } from './AISharedComponents';
import { PROVIDER_LABELS, StatCard } from './AISharedComponents';

interface ActivityEntry {
  id: number;
  task_type: string;
  provider: string;
  latency_ms: number;
  status: string;
  prompt_preview: string;
  created_at: string;
}

interface Props {
  providerStatus: ProviderInfo[];
  activeProvider: string;
  stats: UsageStats | null;
  setError: (e: string | null) => void;
}

export default function AICommandCenterPanel({ providerStatus, activeProvider, stats, setError }: Props) {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult | 'loading'>>({});
  const [healthSnap, setHealthSnap] = useState<any>(null);

  useEffect(() => {
    fetchActivity();
    fetchQuickHealth();
  }, []);

  const fetchActivity = async () => {
    setActivityLoading(true);
    try {
      const data = await apiFetch<ActivityEntry[]>('/ai/activity?limit=5');
      setActivity(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally {
      setActivityLoading(false);
    }
  };

  const fetchQuickHealth = async () => {
    try {
      const report = await apiFetch<any>('/ai/health');
      setHealthSnap(report);
    } catch { /* ignore */ }
  };

  const testAllProviders = async () => {
    setTestingAll(true);
    const providers = ['groq', 'gemini', 'openai', 'ollama'];
    for (const p of providers) {
      setTestResults(prev => ({ ...prev, [p]: 'loading' }));
    }
    await Promise.all(
      providers.map(async (p) => {
        try {
          const result = await apiFetch<TestResult>(`/ai/test/${p}`);
          setTestResults(prev => ({ ...prev, [p]: result }));
        } catch {
          setTestResults(prev => ({ ...prev, [p]: { ok: false, latencyMs: 0, error: 'Failed' } }));
        }
      })
    );
    setTestingAll(false);
  };

  return (
    <div className="space-y-4">
      {/* Provider Status Grid */}
      <div>
        <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2 flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-brand-400" />
          Provider Status
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {(['groq', 'gemini', 'openai', 'ollama'] as const).map(name => {
            const info = providerStatus.find(p => p.name === name);
            const isActive = activeProvider === name || (activeProvider === 'auto' && info?.available);
            const tr = testResults[name];
            return (
              <div
                key={name}
                className={`px-3 py-2.5 border rounded-lg ${
                  isActive && activeProvider === name
                    ? 'border-brand-500/50 bg-brand-900/10'
                    : 'border-[#1a1a2e] bg-[#0a0a12]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${info?.available ? 'bg-green-500' : 'bg-gray-500'}`} />
                  <span className="text-xs font-medium text-white">{PROVIDER_LABELS[name] || name}</span>
                </div>
                <div className="text-[10px] text-rmpg-500 font-mono truncate">{info?.model || 'Not configured'}</div>
                {activeProvider === name && (
                  <div className="text-[10px] text-brand-400 font-medium mt-1">Active</div>
                )}
                {tr && tr !== 'loading' && (
                  <div className={`text-[10px] mt-1 ${tr.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {tr.ok ? `OK (${tr.latencyMs}ms)` : (tr.error || 'Failed')}
                  </div>
                )}
                {tr === 'loading' && (
                  <div className="text-[10px] text-rmpg-500 mt-1 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Testing...
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-end">
          <button
            onClick={testAllProviders}
            disabled={testingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            {testingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Test All Providers
          </button>
        </div>
      </div>

      {/* Quick Health Summary */}
      {healthSnap && (
        <div>
          <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2 flex items-center gap-2">
            <Monitor className="w-3.5 h-3.5 text-brand-400" />
            Quick Health
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="px-3 py-2 bg-[#0a0a12] border border-[#1a1a2e] rounded text-center">
              <Clock className="w-3.5 h-3.5 text-rmpg-500 mx-auto mb-1" />
              <div className="text-sm font-bold text-white font-mono">{healthSnap.server?.uptime_hours || 0}h</div>
              <div className="text-[10px] text-rmpg-500">Uptime</div>
            </div>
            <div className="px-3 py-2 bg-[#0a0a12] border border-[#1a1a2e] rounded text-center">
              <Monitor className="w-3.5 h-3.5 text-rmpg-500 mx-auto mb-1" />
              <div className="text-sm font-bold text-white font-mono">{healthSnap.server?.memory_rss_mb || 0}MB</div>
              <div className="text-[10px] text-rmpg-500">Memory</div>
            </div>
            <div className="px-3 py-2 bg-[#0a0a12] border border-[#1a1a2e] rounded text-center">
              <Wifi className="w-3.5 h-3.5 text-rmpg-500 mx-auto mb-1" />
              <div className="text-sm font-bold text-white font-mono">{healthSnap.websocket?.active_connections || 0}</div>
              <div className="text-[10px] text-rmpg-500">Connections</div>
            </div>
          </div>
        </div>
      )}

      {/* Usage Stats */}
      {stats && (
        <div>
          <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-brand-400" />
            Usage
          </h3>
          <div className="bg-[#0f1218] border border-[#1a1a2e] rounded p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <StatCard label="Today" value={stats.requestsToday} />
              <StatCard label="This Week" value={stats.requestsThisWeek} />
              <StatCard label="This Month" value={stats.requestsThisMonth} />
              <StatCard label="Avg Response" value={`${stats.avgResponseMs}ms`} />
              <StatCard label="Cache Hit Rate" value={`${stats.cacheHitRate}%`} />
              <StatCard label="Total Requests" value={stats.totalRequests} />
            </div>
          </div>
        </div>
      )}

      {/* Mini Activity Feed */}
      <div>
        <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2 flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 text-brand-400" />
          Recent Activity
          <button type="button" onClick={fetchActivity} disabled={activityLoading} className="ml-auto p-1 text-rmpg-500 hover:text-white transition-colors">
            {activityLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </button>
        </h3>
        <div className="bg-[#0f1218] border border-[#1a1a2e] rounded divide-y divide-[#1a1a2e]">
          {activity.length > 0 ? activity.map((a, i) => (
            <div key={a.id || i} className="flex items-center gap-3 px-3 py-2">
              <div className={`w-1.5 h-1.5 rounded-full ${a.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white font-mono truncate">{a.task_type}</div>
                <div className="text-[10px] text-rmpg-500 truncate">{a.prompt_preview}</div>
              </div>
              <div className="text-[10px] text-rmpg-500 shrink-0">{a.provider}</div>
              <div className="text-[10px] text-rmpg-500 shrink-0 font-mono">{a.latency_ms}ms</div>
            </div>
          )) : (
            <div className="px-3 py-4 text-xs text-rmpg-500 text-center">No recent activity</div>
          )}
        </div>
      </div>
    </div>
  );
}
