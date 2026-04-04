import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Key, ToggleLeft, ToggleRight, Save, DollarSign, BarChart3,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface SourceInfo {
  name: string;
  displayName: string;
  category: string;
  costPerLookup: number;
  configured: boolean;
  enabled: boolean;
  healthy: boolean;
}

interface SourceEdit {
  enabled?: boolean;
  apiKey?: string;
}

export default function AdminSkipTracerV2Tab({ LoadingSpinner, error, setError }: Props) {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, SourceEdit>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<any>(null);

  const fetchSources = useCallback(async () => {
    try {
      const data = await apiFetch<SourceInfo[]>('/skiptracer-v2/sources');
      setSources(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/skiptracer-v2/stats');
      setStats(data);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    fetchSources();
    fetchStats();
  }, [fetchSources, fetchStats]);

  const handleToggle = (name: string, current: boolean) => {
    setEdits(prev => ({
      ...prev,
      [name]: { ...prev[name], enabled: !current },
    }));
  };

  const handleApiKeyChange = (name: string, value: string) => {
    setEdits(prev => ({
      ...prev,
      [name]: { ...prev[name], apiKey: value },
    }));
  };

  const handleSave = async (name: string) => {
    const edit = edits[name];
    if (!edit) return;

    setSaving(name);
    try {
      await apiFetch(`/skiptracer-v2/sources/${name}/config`, {
        method: 'PUT',
        body: JSON.stringify(edit),
      });
      // Clear edits for this source
      setEdits(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      await fetchSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to update ${name}`);
    } finally {
      setSaving(null);
    }
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case 'people': return '#aaaaaa';
      case 'court': return '#f59e0b';
      case 'property': return '#34d399';
      case 'business': return '#a78bfa';
      case 'registry': return '#f472b6';
      case 'osint': return '#aaaaaa';
      default: return '#888';
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4 p-4 animate-fade-in">
      {/* Header */}
      <div className="panel-beveled bg-surface-base p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-sm" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
              <Search className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-rmpg-100 tracking-wider uppercase">
                Skip Tracker 3.5 — Sources
              </h2>
              <p className="text-[10px] text-rmpg-500 mt-0.5">
                Multi-source dossier builder — configure and manage data source adapters
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <BarChart3 className="w-3.5 h-3.5" />
            Usage Statistics
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-surface-sunken p-2 text-center">
              <div className="text-sm font-bold text-rmpg-100">{stats.totalSearches?.today ?? 0}</div>
              <div className="text-[9px] text-rmpg-500 uppercase">Today</div>
            </div>
            <div className="bg-surface-sunken p-2 text-center">
              <div className="text-sm font-bold text-rmpg-100">{stats.totalSearches?.week ?? 0}</div>
              <div className="text-[9px] text-rmpg-500 uppercase">This Week</div>
            </div>
            <div className="bg-surface-sunken p-2 text-center">
              <div className="text-sm font-bold text-rmpg-100">{stats.totalSearches?.allTime ?? 0}</div>
              <div className="text-[9px] text-rmpg-500 uppercase">All Time</div>
            </div>
            <div className="bg-surface-sunken p-2 text-center">
              <div className="text-sm font-bold text-rmpg-100">${stats.totalCost ?? '0.00'}</div>
              <div className="text-[9px] text-rmpg-500 uppercase">Total Cost</div>
            </div>
          </div>
        </div>
      )}

      {/* Source List */}
      <div className="panel-beveled bg-surface-base p-4 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Search className="w-3.5 h-3.5" />
          Data Sources ({sources.length})
        </div>

        {sources.length === 0 && (
          <div className="text-center text-[10px] text-rmpg-500 py-4">No sources registered</div>
        )}

        <div className="space-y-2">
          {sources.map((source) => {
            const edit = edits[source.name];
            const isEnabled = edit?.enabled ?? source.enabled;
            const hasEdits = edit !== undefined;
            const isSaving = saving === source.name;

            return (
              <div
                key={source.name}
                className="bg-surface-sunken border border-rmpg-700 p-3 space-y-2"
              >
                {/* Source header row */}
                <div className="flex items-center gap-3">
                  {/* Enable/disable toggle */}
                  <button type="button"
                    onClick={() => handleToggle(source.name, isEnabled)}
                    className="shrink-0"
                    title={isEnabled ? 'Disable source' : 'Enable source'}
                  >
                    {isEnabled ? (
                      <ToggleRight className="w-6 h-6 text-green-400" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-rmpg-600" />
                    )}
                  </button>

                  {/* Source name + info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-rmpg-100">{source.displayName}</span>
                      <span
                        className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider border"
                        style={{ color: getCategoryColor(source.category), borderColor: getCategoryColor(source.category) + '44' }}
                      >
                        {source.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[9px] text-rmpg-500 font-mono">{source.name}</span>
                      {source.costPerLookup > 0 && (
                        <span className="flex items-center gap-0.5 text-[9px] text-yellow-500">
                          <DollarSign className="w-2.5 h-2.5" />
                          {source.costPerLookup.toFixed(2)}/lookup
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-2 shrink-0">
                    {source.configured ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-green-900/30 text-green-400 border border-green-700/50">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Configured
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-yellow-900/30 text-yellow-400 border border-yellow-700/50">
                        Needs Config
                      </span>
                    )}
                    {source.healthy ? (
                      <span className="w-2 h-2 rounded-full bg-green-500" title="Healthy" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-red-500" title="Unhealthy" />
                    )}
                  </div>
                </div>

                {/* API Key input (always show for unconfigured sources) */}
                {!source.configured && (
                  <div className="flex items-center gap-2 mt-2">
                    <Key className="w-3 h-3 text-rmpg-500 shrink-0" />
                    <div className="relative flex-1">
                      <input
                        type={showKeys[source.name] ? 'text' : 'password'}
                        value={edit?.apiKey ?? ''}
                        onChange={(e) => handleApiKeyChange(source.name, e.target.value)}
                        placeholder="Enter API key"
                        className="w-full bg-surface-base border border-rmpg-600 text-white text-[10px] px-2 py-1 pr-7 font-mono focus:border-gray-500 focus:outline-none"
                      />
                      <button type="button"
                        onClick={() => setShowKeys(prev => ({ ...prev, [source.name]: !prev[source.name] }))}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white"
                        aria-label="Toggle API key visibility"
                      >
                        {showKeys[source.name] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Save button when edits exist */}
                {hasEdits && (
                  <div className="flex justify-end">
                    <button type="button"
                      onClick={() => handleSave(source.name)}
                      disabled={isSaving}
                      className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wider bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Save className="w-3 h-3" />}
                      Save
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info */}
      <div className="text-[9px] text-rmpg-600 px-1">
        Skip Tracker 3.5 queries multiple data sources in parallel and merges results into unified dossier profiles.
        Enable/disable sources here and configure API keys where required. Costs shown are per-lookup estimates.
      </div>
    </div>
  );
}
