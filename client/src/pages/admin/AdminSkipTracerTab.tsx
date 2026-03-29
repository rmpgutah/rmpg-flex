import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, ExternalLink, User, MapPin, Phone, Mail, Hash,
  Clock, BarChart3,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface SkipTracerStatus {
  configured: boolean;
  enabled: boolean;
  host: string;
}

interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
  statusCode?: number;
}

interface SearchStats {
  total_searches: number;
  total_results: number;
  unique_users: number;
  last_search: string | null;
  byType: { search_type: string; count: number }[];
}

interface SearchHistoryRow {
  id: number;
  search_type: string;
  query_params: string;
  result_count: number;
  searched_by_name: string | null;
  created_at: string;
}

// Search type display labels
const SEARCH_TYPE_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  byname: { label: 'Name', icon: User, color: '#60a5fa' },
  byaddress: { label: 'Address', icon: MapPin, color: '#34d399' },
  bynameandaddress: { label: 'Name + Address', icon: Search, color: '#a78bfa' },
  byphone: { label: 'Phone', icon: Phone, color: '#f59e0b' },
  byemail: { label: 'Email', icon: Mail, color: '#f472b6' },
  personDetailsByID: { label: 'Person ID', icon: Hash, color: '#818cf8' },
};

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function AdminSkipTracerTab({ LoadingSpinner, error, setError }: Props) {
  // Status
  const [status, setStatus] = useState<SkipTracerStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // API Key
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // Connection test
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Stats & history
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [history, setHistory] = useState<SearchHistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SkipTracerStatus>('/skiptracer/status');
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch Skip Tracker status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<SearchStats>('/skiptracer/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch Skip Tracker stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchStats();
  }, [fetchStatus, fetchStats]);

  // Save API key
  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setTestResult(null);
    try {
      await apiFetch('/skiptracer/config', {
        method: 'PUT',
        body: JSON.stringify({ apiKey, enabled: true }),
      });
      setApiKey('');
      setShowKey(false);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  // Clear credentials
  const handleClear = async () => {
    try {
      await apiFetch('/skiptracer/config', { method: 'DELETE' });
      setTestResult(null);
      await fetchStatus();
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear credentials');
    }
  };

  // Test connection
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<TestResult>('/skiptracer/test', { method: 'POST' });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  // Fetch search history
  const handleLoadHistory = async () => {
    try {
      const data = await apiFetch<{ searches: SearchHistoryRow[] }>('/skiptracer/history?limit=20');
      setHistory(data.searches || []);
      setShowHistory(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4 p-4 animate-fade-in">
      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="panel-beveled bg-surface-base p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-blue-900/25 border border-blue-700/40" aria-hidden="true">
              <Search className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-rmpg-100 tracking-wider uppercase">
                Skip Tracker
              </h2>
              <p className="text-[10px] text-rmpg-500 mt-0.5">
                Locate individuals by name, address, phone, or email via RapidAPI
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status?.configured ? (
              <span className="flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider bg-green-900/25 text-green-400 border border-green-700/40" role="status">
                <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider bg-yellow-900/25 text-yellow-400 border border-yellow-700/40" role="status">
                Not Configured
              </span>
            )}
            <a
              href="https://rapidapi.com/oneapiproject/api/skip-tracing-working-api"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-rmpg-400 hover:text-blue-400 border border-rmpg-700 hover:border-blue-700"
            >
              <ExternalLink className="w-3 h-3" /> RapidAPI
            </a>
          </div>
        </div>
      </div>

      {/* ─── API Key Configuration ──────────────────────────── */}
      <div className="panel-beveled bg-surface-base p-4 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5" />
          API Configuration
        </div>

        {status?.configured ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-green-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              API key is configured and encrypted
            </div>

            <div className="flex gap-2">
              <button type="button"
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-700/20 text-blue-400 border border-blue-700/50 hover:bg-blue-700/40 disabled:opacity-50"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Search className="w-3 h-3" />}
                Test Connection
              </button>

              <button type="button"
                onClick={handleClear}
                className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-red-900/20 text-red-400 border border-red-700/50 hover:bg-red-900/40"
              >
                <Trash2 className="w-3 h-3" />
                Remove Key
              </button>
            </div>

            {testResult && (
              <div className={`flex items-center gap-2 px-3 py-2 text-xs ${
                testResult.success
                  ? 'bg-green-900/20 text-green-400 border border-green-700/50'
                  : 'bg-red-900/20 text-red-400 border border-red-700/50'
              }`}>
                {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                {testResult.success ? testResult.message : testResult.error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] text-rmpg-500">
              Enter your RapidAPI key to enable Skip Tracing searches. Subscribe at{' '}
              <a
                href="https://rapidapi.com/oneapiproject/api/skip-tracing-working-api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                RapidAPI
              </a>{' '}
              to get your API key.
            </p>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                RapidAPI Key
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your x-rapidapi-key"
                    className="w-full bg-surface-sunken border border-rmpg-600 text-white text-xs px-3 py-1.5 pr-8 font-mono focus:border-blue-500 focus:outline-none"
                  />
                  <button type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <button type="button"
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim() || saving}
                  className="flex items-center gap-1 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Key className="w-3 h-3" />}
                  Save Key
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Available Search Methods ───────────────────────── */}
      <div className="panel-beveled bg-surface-base p-4 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Search className="w-3.5 h-3.5" />
          Available Search Methods
        </div>
        <p className="text-[10px] text-rmpg-500">
          These search methods are available through the Skip Tracker panel in Records. All searches are logged and auditable.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {Object.entries(SEARCH_TYPE_LABELS).map(([key, { label, icon: Icon, color }]) => (
            <div key={key} className="flex items-center gap-2 px-3 py-2 bg-surface-sunken border border-rmpg-700">
              <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
              <div>
                <div className="text-[10px] font-bold text-rmpg-200 uppercase">{label}</div>
                <div className="text-[9px] text-rmpg-500 font-mono">/search/{key === 'personDetailsByID' ? 'person/:id' : key}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Usage Statistics ───────────────────────────────── */}
      {stats && (
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <BarChart3 className="w-3.5 h-3.5" />
            Usage Statistics
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Total Searches', value: stats.total_searches || 0 },
              { label: 'Total Results', value: stats.total_results || 0 },
              { label: 'Unique Users', value: stats.unique_users || 0 },
              { label: 'Last Search', value: stats.last_search
                ? new Date(stats.last_search).toLocaleDateString()
                : 'Never' },
            ].map(stat => (
              <div key={stat.label} className="bg-surface-sunken p-2 text-center">
                <div className="text-sm font-bold text-rmpg-100">{stat.value}</div>
                <div className="text-[9px] text-rmpg-500 uppercase">{stat.label}</div>
              </div>
            ))}
          </div>

          {stats.byType && stats.byType.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {stats.byType.map(({ search_type, count }) => {
                const meta = SEARCH_TYPE_LABELS[search_type];
                return (
                  <span
                    key={search_type}
                    className="px-2 py-0.5 text-[9px] font-bold uppercase bg-surface-sunken border border-rmpg-700"
                    style={{ color: meta?.color || '#888' }}
                  >
                    {meta?.label || search_type}: {count}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Recent Search History ──────────────────────────── */}
      <div className="panel-beveled bg-surface-base p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5" />
            Recent Search History
          </div>
          <button type="button"
            onClick={handleLoadHistory}
            className="text-[10px] text-blue-400 hover:text-blue-300 uppercase tracking-wider font-bold"
          >
            {showHistory ? 'Refresh' : 'Load History'}
          </button>
        </div>

        {showHistory && history.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {history.map((row) => {
              const meta = SEARCH_TYPE_LABELS[row.search_type];
              const Icon = meta?.icon || Search;
              let queryDisplay = '';
              try {
                const params = JSON.parse(row.query_params);
                queryDisplay = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ');
              } catch { queryDisplay = row.query_params; }

              return (
                <div
                  key={row.id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-surface-sunken border border-rmpg-700 text-xs"
                >
                  <Icon className="w-3 h-3 shrink-0" style={{ color: meta?.color || '#888' }} />
                  <span className="text-[9px] font-bold uppercase" style={{ color: meta?.color || '#888', minWidth: 70 }}>
                    {meta?.label || row.search_type}
                  </span>
                  <span className="text-rmpg-300 font-mono text-[10px] flex-1 truncate">{queryDisplay}</span>
                  <span className="text-rmpg-500 text-[9px]">{row.result_count} results</span>
                  <span className="text-rmpg-600 text-[9px]">{row.searched_by_name || '—'}</span>
                  <span className="text-rmpg-600 text-[9px] tabular-nums">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {showHistory && history.length === 0 && (
          <div className="text-center text-[10px] text-rmpg-500 py-4">No search history yet</div>
        )}
      </div>

      {/* ─── Info ───────────────────────────────────────────── */}
      <div className="text-[9px] text-rmpg-600 px-1">
        Skip Tracker uses the Skip Tracing Working API on RapidAPI.
        All searches are logged with the operator's identity for audit compliance.
        Results are cached locally for review. API subscription billed separately through RapidAPI.
      </div>
    </div>
  );
}
