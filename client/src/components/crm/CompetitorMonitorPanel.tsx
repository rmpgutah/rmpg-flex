// ============================================================
// RMPG Flex — CRM Overwatch: Competitor Monitor Panel
// Firecrawl-powered competitor URL monitoring + change detection
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Eye, Plus, Trash2, RefreshCw, Check, Globe, Clock, X, ChevronDown, ChevronUp,
  Loader2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import { useWebSocket } from '../../context/WebSocketContext';
import PanelTitleBar from '../PanelTitleBar';

// ── Types ────────────────────────────────────────────────────

interface MonitoredUrl {
  id: number;
  url: string;
  label: string;
  check_interval: string;
  last_checked: string | null;
  status: 'active' | 'error' | 'paused';
  unacknowledged_count: number;
}

interface ChangeEntry {
  id: number;
  monitor_id: number;
  diff_summary: string;
  significance: 'minor' | 'moderate' | 'major';
  acknowledged: boolean;
  created_at: string;
}

const INTERVAL_OPTIONS = [
  { value: '1h', label: 'Every hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '24h', label: 'Daily' },
  { value: '7d', label: 'Weekly' },
];

// ── Component ────────────────────────────────────────────────

export default function CompetitorMonitorPanel() {
  const { addToast } = useToast();
  const { subscribe } = useWebSocket();

  // Firecrawl connection
  const [firecrawlConnected, setFirecrawlConnected] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);

  // Monitors
  const [monitors, setMonitors] = useState<MonitoredUrl[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addInterval, setAddInterval] = useState('24h');
  const [adding, setAdding] = useState(false);

  // Expanded row → change history
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);

  // Per-row check-now loading
  const [checkingMap, setCheckingMap] = useState<Record<number, boolean>>({});
  const [deletingMap, setDeletingMap] = useState<Record<number, boolean>>({});

  // ── Firecrawl status ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ connected: boolean }>('/crm/firecrawl/status');
        setFirecrawlConnected(!!data?.connected);
      } catch {
        setFirecrawlConnected(false);
      } finally {
        setStatusChecked(true);
      }
    })();
  }, []);

  // ── Fetch monitors ────────────────────────────────────────
  const fetchMonitors = useCallback(async () => {
    try {
      const data = await apiFetch<MonitoredUrl[]>('/crm/firecrawl/monitors');
      setMonitors(Array.isArray(data) ? data : []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMonitors(); }, [fetchMonitors]);

  // ── WebSocket: competitor change detected ─────────────────
  useEffect(() => {
    const unsub = subscribe('competitor:change_detected' as any, (msg) => {
      addToast('Competitor change detected!', 'warning');
      fetchMonitors();
    });
    return unsub;
  }, [subscribe, addToast, fetchMonitors]);

  // ── Fetch change history for a monitor ────────────────────
  const fetchChanges = useCallback(async (monitorId: number) => {
    setChangesLoading(true);
    try {
      const data = await apiFetch<ChangeEntry[]>(`/crm/firecrawl/monitors/${monitorId}/changes`);
      setChanges(Array.isArray(data) ? data : []);
    } catch {
      setChanges([]);
    } finally {
      setChangesLoading(false);
    }
  }, []);

  // ── Toggle expand row ─────────────────────────────────────
  const toggleExpand = useCallback((id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setChanges([]);
    } else {
      setExpandedId(id);
      fetchChanges(id);
    }
  }, [expandedId, fetchChanges]);

  // ── Add monitor ───────────────────────────────────────────
  const handleAdd = useCallback(async () => {
    const url = addUrl.trim();
    const label = addLabel.trim();
    if (!url) return;
    setAdding(true);
    try {
      await apiFetch('/crm/firecrawl/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label: label || url, check_interval: addInterval }),
      });
      addToast('Monitor added', 'success');
      setAddUrl('');
      setAddLabel('');
      setAddInterval('24h');
      setShowAddForm(false);
      fetchMonitors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add monitor';
      addToast(msg, 'error');
    } finally {
      setAdding(false);
    }
  }, [addUrl, addLabel, addInterval, addToast, fetchMonitors]);

  // ── Check now ─────────────────────────────────────────────
  const handleCheckNow = useCallback(async (id: number) => {
    setCheckingMap(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/crm/firecrawl/monitors/${id}/check`, { method: 'POST' });
      addToast('Check initiated', 'info');
      fetchMonitors();
      if (expandedId === id) fetchChanges(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Check failed';
      addToast(msg, 'error');
    } finally {
      setCheckingMap(p => ({ ...p, [id]: false }));
    }
  }, [addToast, fetchMonitors, expandedId, fetchChanges]);

  // ── Delete monitor ────────────────────────────────────────
  const handleDelete = useCallback(async (id: number) => {
    setDeletingMap(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/crm/firecrawl/monitors/${id}`, { method: 'DELETE' });
      addToast('Monitor removed', 'success');
      if (expandedId === id) { setExpandedId(null); setChanges([]); }
      fetchMonitors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      addToast(msg, 'error');
    } finally {
      setDeletingMap(p => ({ ...p, [id]: false }));
    }
  }, [addToast, fetchMonitors, expandedId]);

  // ── Acknowledge change ────────────────────────────────────
  const handleAcknowledge = useCallback(async (changeId: number, monitorId: number) => {
    try {
      await apiFetch(`/crm/firecrawl/monitors/changes/${changeId}/acknowledge`, { method: 'POST' });
      setChanges(prev => prev.map(c => c.id === changeId ? { ...c, acknowledged: true } : c));
      fetchMonitors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Acknowledge failed';
      addToast(msg, 'error');
    }
  }, [addToast, fetchMonitors]);

  // ── Helpers ───────────────────────────────────────────────
  function relativeTime(dateStr: string | null): string {
    if (!dateStr) return 'never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function significanceStyle(sig: string): string {
    switch (sig) {
      case 'major': return 'text-red-400 bg-red-900/30 border-red-700/50';
      case 'moderate': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
      default: return 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50';
    }
  }

  function statusLedColor(status: string): string {
    switch (status) {
      case 'active': return 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]';
      case 'error': return 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]';
      default: return 'bg-rmpg-500';
    }
  }

  function truncateUrl(url: string, max = 40): string {
    if (url.length <= max) return url;
    return url.slice(0, max) + '...';
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="panel-beveled bg-surface-base">
        <PanelTitleBar title="COMPETITOR MONITOR" icon={Eye}>
          <button type="button"
            className="toolbar-btn flex items-center gap-1 px-2 text-xs ml-auto"
            onClick={() => setShowAddForm(p => !p)}
          >
            <Plus className="w-3 h-3" />
            Add URL
          </button>
        </PanelTitleBar>

        {/* Status indicator */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              !statusChecked
                ? 'bg-rmpg-500 animate-pulse'
                : firecrawlConnected
                  ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'
                  : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]'
            }`}
          />
          <span className="text-xs text-rmpg-400 font-mono">
            Firecrawl {!statusChecked ? 'checking...' : firecrawlConnected ? 'connected' : 'disconnected'}
          </span>
          <span className="text-[10px] text-rmpg-500 font-mono ml-auto">
            {monitors.length} monitor{monitors.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Add URL Form */}
      {showAddForm && (
        <div className="panel-beveled bg-surface-base p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-rmpg-400" />
            <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider">Add Monitored URL</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="url"
              className="input-dark col-span-full"
              placeholder="https://competitor-website.com"
              value={addUrl}
              onChange={e => setAddUrl(e.target.value)}
            />
            <input
              type="text"
              className="input-dark"
              placeholder="Label (optional)"
              value={addLabel}
              onChange={e => setAddLabel(e.target.value)}
            />
            <select
              className="input-dark"
              value={addInterval}
              onChange={e => setAddInterval(e.target.value)}
            >
              {INTERVAL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button"
              className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5 px-3 text-xs"
              disabled={adding || !addUrl.trim()}
              onClick={handleAdd}
            >
              {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Add Monitor
            </button>
            <button type="button"
              className="toolbar-btn flex items-center gap-1 px-2 text-xs"
              onClick={() => { setShowAddForm(false); setAddUrl(''); setAddLabel(''); }}
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Monitors table */}
      {loading ? (
        <div className="panel-beveled bg-surface-base p-6 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
          <span className="text-sm text-rmpg-300">Loading monitors...</span>
        </div>
      ) : monitors.length === 0 ? (
        <div className="panel-beveled bg-surface-base p-6 text-center">
          <Eye className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
          <p className="text-sm text-rmpg-400">No competitor URLs being monitored.</p>
          <p className="text-xs text-rmpg-500 mt-1">Add a URL above to start tracking changes.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {monitors.map(m => {
            const isExpanded = expandedId === m.id;
            const isChecking = checkingMap[m.id];
            const isDeleting = deletingMap[m.id];

            return (
              <div key={m.id} className="panel-beveled bg-surface-base">
                {/* Monitor row */}
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-rmpg-700/10 transition-colors"
                  onClick={() => toggleExpand(m.id)}
                >
                  {/* Status LED */}
                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusLedColor(m.status)}`} />

                  {/* Label */}
                  <span className="text-xs font-medium text-rmpg-100 truncate min-w-0 flex-shrink">{m.label}</span>

                  {/* URL */}
                  <span className="text-[10px] font-mono text-rmpg-500 truncate hidden sm:inline" title={m.url}>
                    {truncateUrl(m.url)}
                  </span>

                  {/* Interval badge */}
                  <span className="text-[9px] font-mono text-rmpg-400 bg-rmpg-800/40 border border-rmpg-700/50 px-1.5 py-0.5 rounded-sm shrink-0">
                    {INTERVAL_OPTIONS.find(o => o.value === m.check_interval)?.label || m.check_interval}
                  </span>

                  {/* Last checked */}
                  <span className="text-[9px] font-mono text-rmpg-500 shrink-0 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {relativeTime(m.last_checked)}
                  </span>

                  {/* Unacknowledged badge */}
                  {m.unacknowledged_count > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 bg-red-900/30 text-red-400 border border-red-700/50 rounded-sm shrink-0">
                      {m.unacknowledged_count}
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 ml-auto shrink-0" onClick={e => e.stopPropagation()}>
                    <button type="button"
                      className="toolbar-btn flex items-center px-1.5 py-0.5"
                      disabled={isChecking}
                      onClick={() => handleCheckNow(m.id)}
                      title="Check now"
                    >
                      {isChecking ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                    </button>
                    <button type="button"
                      className="toolbar-btn flex items-center px-1.5 py-0.5 text-red-400 hover:text-red-300"
                      disabled={isDeleting}
                      onClick={() => handleDelete(m.id)}
                      title="Delete monitor"
                    >
                      {isDeleting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  {/* Expand chevron */}
                  {isExpanded ? <ChevronUp className="w-3 h-3 text-rmpg-500 shrink-0" /> : <ChevronDown className="w-3 h-3 text-rmpg-500 shrink-0" />}
                </div>

                {/* Expanded: change history */}
                {isExpanded && (
                  <div className="border-t border-rmpg-700 bg-surface-sunken p-3">
                    {changesLoading ? (
                      <div className="flex items-center gap-2 justify-center py-3">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                        <span className="text-xs text-rmpg-400">Loading changes...</span>
                      </div>
                    ) : changes.length === 0 ? (
                      <p className="text-xs text-rmpg-500 text-center py-2">No changes detected yet.</p>
                    ) : (
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider">Change History</h4>
                        {changes.map(c => (
                          <div
                            key={c.id}
                            className={`p-2 rounded-sm border ${c.acknowledged ? 'border-rmpg-700/50 bg-surface-base/50' : 'border-rmpg-600 bg-surface-base'}`}
                          >
                            <div className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-rmpg-200 leading-relaxed">{c.diff_summary}</p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className={`text-[9px] font-mono px-1.5 py-0.5 border rounded-sm ${significanceStyle(c.significance)}`}>
                                    {c.significance}
                                  </span>
                                  <span className="text-[9px] font-mono text-rmpg-500">
                                    {relativeTime(c.created_at)}
                                  </span>
                                </div>
                              </div>
                              {!c.acknowledged && (
                                <button type="button"
                                  className="toolbar-btn flex items-center gap-1 px-2 py-0.5 text-[10px] shrink-0"
                                  onClick={() => handleAcknowledge(c.id, m.id)}
                                >
                                  <Check className="w-3 h-3" />
                                  Ack
                                </button>
                              )}
                              {c.acknowledged && (
                                <span className="text-[9px] text-green-500 flex items-center gap-0.5 shrink-0">
                                  <Check className="w-2.5 h-2.5" /> Acked
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
