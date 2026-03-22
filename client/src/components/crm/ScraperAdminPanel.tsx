// ============================================================
// RMPG Flex — CRM Overwatch: Scraper Admin Panel
// Manage lead scrape sources, view logs, trigger manual polls
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  X,
  ToggleLeft,
  ToggleRight,
  Database,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import type { LeadScrapeSource } from '../../types';

interface ScrapeLog {
  id: number;
  source_key: string;
  status: 'success' | 'error' | 'partial';
  records_found: number;
  records_imported: number;
  records_skipped: number;
  error_message?: string;
  duration_ms: number;
  created_at: string;
}

interface ScraperAdminPanelProps {
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDateTime(d?: string | null): string {
  if (!d) return '\u2014';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ScraperAdminPanel({ onClose }: ScraperAdminPanelProps) {
  const { addToast } = useToast();
  const [sources, setSources] = useState<LeadScrapeSource[]>([]);
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pollingKey, setPollingKey] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    try {
      const data = await apiFetch<LeadScrapeSource[]>('/crm/scrape-sources');
      if (data) setSources(data);
    } catch { /* silent */ }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await apiFetch<ScrapeLog[]>('/crm/scrape-log');
      if (data) setLogs(data.slice(0, 20));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSources(), fetchLogs()]).finally(() => setLoading(false));
  }, [fetchSources, fetchLogs]);

  const handleToggle = async (key: string, enabled: boolean) => {
    try {
      await apiFetch(`/crm/scrape-sources/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: enabled ? 1 : 0 }),
      });
      addToast(`Source ${enabled ? 'enabled' : 'disabled'}`, 'success');
      fetchSources();
    } catch {
      addToast('Failed to update source', 'error');
    }
  };

  const handlePollNow = async (key: string) => {
    setPollingKey(key);
    try {
      await apiFetch(`/crm/scrape-sources/${key}/poll-now`, { method: 'POST' });
      addToast('Poll triggered', 'success');
      // Refresh after short delay to let poll complete
      setTimeout(() => {
        fetchSources();
        fetchLogs();
        setPollingKey(null);
      }, 3000);
    } catch {
      addToast('Poll failed', 'error');
      setPollingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="px-3 py-4 bg-[#0d1520] border-b border-rmpg-700 flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-[#0d1520] border-b border-rmpg-700 max-h-[350px] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-rmpg-700/50">
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-xs font-bold text-white">Lead Scraper Sources</span>
        </div>
        <button onClick={onClose} className="text-rmpg-400 hover:text-white">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sources table */}
      <div className="px-3 py-2">
        <table className="w-full">
          <thead>
            <tr className="border-b border-rmpg-700/50">
              <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-left">Source</th>
              <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-center">Enabled</th>
              <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-left">Last Poll</th>
              <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-left">Last Success</th>
              <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-center">Failures</th>
              <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-right">Imported</th>
              <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-right">Interval</th>
              <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {sources.map(src => (
              <tr key={src.id} className="border-b border-rmpg-700/30 hover:bg-[#141e2b]">
                <td className="px-2 py-1.5">
                  <div className="text-xs text-white font-medium">{src.display_name}</div>
                  {src.base_url && (
                    <div className="text-[10px] text-rmpg-500 truncate max-w-[180px]">{src.base_url}</div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => handleToggle(src.source_key, !src.is_enabled)}
                    className={`${src.is_enabled ? 'text-green-400' : 'text-rmpg-500'}`}
                  >
                    {src.is_enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                </td>
                <td className="px-2 py-1.5 text-[10px] text-rmpg-400">{formatDateTime(src.last_poll_at)}</td>
                <td className="px-2 py-1.5 text-[10px] text-rmpg-400">{formatDateTime(src.last_success_at)}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`text-[10px] font-mono ${src.consecutive_failures > 0 ? 'text-red-400' : 'text-rmpg-500'}`}>
                    {src.consecutive_failures}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-[10px] text-rmpg-300 text-right font-mono">{src.total_leads_imported}</td>
                <td className="px-2 py-1.5 text-[10px] text-rmpg-400 text-right font-mono">{Math.round(src.poll_interval_seconds / 3600)}h</td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => handlePollNow(src.source_key)}
                    disabled={pollingKey === src.source_key}
                    className="bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 text-[10px] font-bold px-2 py-0.5 rounded-sm border border-brand-700/50 disabled:opacity-40"
                  >
                    {pollingKey === src.source_key ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Poll Now'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent logs */}
      {logs.length > 0 && (
        <div className="px-3 py-2 border-t border-rmpg-700/50">
          <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Recent Scrape Runs</div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-rmpg-700/30">
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-left">Source</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-center">Status</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-right">Found</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-right">Imported</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-right">Skipped</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-right">Duration</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-rmpg-700/20">
                  <td className="px-2 py-1 text-[10px] text-rmpg-300">{log.source_key}</td>
                  <td className="px-2 py-1 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${
                      log.status === 'success' ? 'text-green-400 bg-green-900/30 border-green-700/50' :
                      log.status === 'error' ? 'text-red-400 bg-red-900/30 border-red-700/50' :
                      'text-amber-400 bg-amber-900/30 border-amber-700/50'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-[10px] text-rmpg-300 text-right font-mono">{log.records_found}</td>
                  <td className="px-2 py-1 text-[10px] text-rmpg-300 text-right font-mono">{log.records_imported}</td>
                  <td className="px-2 py-1 text-[10px] text-rmpg-300 text-right font-mono">{log.records_skipped}</td>
                  <td className="px-2 py-1 text-[10px] text-rmpg-400 text-right font-mono">{formatDuration(log.duration_ms)}</td>
                  <td className="px-2 py-1 text-[10px] text-rmpg-400">{formatDateTime(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
