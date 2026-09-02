import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Terminal, RefreshCw, Download, Trash2, ChevronDown, ChevronRight, Monitor } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { parseTimestamp } from '../utils/dateUtils';
import { errorLogsToCsv, downloadTextFile } from '../utils/rmsListExport';
import { copyToClipboard } from '../utils/contextMenuActions';

interface ErrorLogEntry {
  id: number;
  severity: string;
  category: string;
  message: string;
  details?: unknown;
  trace_id?: string;
  source?: string;
  status_code?: number;
  created_at: string;
}

interface ErrorLogResponse {
  logs: ErrorLogEntry[];
}

type SeverityFilter = 'ALL' | 'ERROR' | 'WARN' | 'INFO';
type CategoryFilter = 'ALL' | 'route' | 'cron' | 'integration' | 'auth';
type ActiveTab = 'server' | 'desktop';

const SEVERITY_OPTIONS: SeverityFilter[] = ['ALL', 'ERROR', 'WARN', 'INFO'];
const CATEGORY_OPTIONS: CategoryFilter[] = ['ALL', 'route', 'cron', 'integration', 'auth'];
const PAGE_LIMIT = 50;

function timeAgo(isoString: string): string {
  const diff = Date.now() - parseTimestamp(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'error') return 'bg-sev-critical/20 text-sev-critical border border-sev-critical/30';
  if (s === 'warn') return 'bg-sev-warn/20 text-sev-warn border border-sev-warn/30';
  return 'bg-brand-400/10 text-brand-400 border border-brand-400/20';
}

function categoryClass(): string {
  return 'bg-surface-raised text-fg-secondary border border-rmpg-700/40';
}

interface LogRowProps {
  entry: ErrorLogEntry;
}

function LogRow({ entry }: LogRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-rmpg-800/50 last:border-0">
      <button
        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-surface-raised/50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="mt-0.5 text-fg-muted shrink-0">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span
          className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-[1px] rounded-[2px] ${severityClass(entry.severity)}`}
        >
          {entry.severity}
        </span>
        <span
          className={`shrink-0 text-[10px] px-1.5 py-[1px] rounded-[2px] ${categoryClass()}`}
        >
          {entry.category}
        </span>
        <span className="flex-1 text-[11px] text-rmpg-100 truncate">{entry.message}</span>
        {entry.source && (
          <span className="shrink-0 text-[10px] text-fg-secondary hidden md:block truncate max-w-[140px]">
            {entry.source}
          </span>
        )}
        {entry.trace_id && (
          <span className="shrink-0 text-[10px] font-mono text-fg-muted hidden lg:block">
            {entry.trace_id.slice(0, 12)}…
          </span>
        )}
        <span className="shrink-0 text-[10px] text-fg-muted">{timeAgo(entry.created_at)}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pt-1 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            {entry.status_code !== undefined && (
              <>
                <span className="text-fg-secondary">Status Code</span>
                <span className="text-rmpg-200">{entry.status_code}</span>
              </>
            )}
            {entry.trace_id && (
              <>
                <span className="text-fg-secondary">Trace ID</span>
                <span className="text-rmpg-200 font-mono flex items-center gap-2">
                  {entry.trace_id}
                  <button
                    type="button"
                    className="text-[10px] text-fg-secondary border border-rmpg-700/50 px-1.5 py-[1px]"
                    onClick={(e) => { e.stopPropagation(); void copyToClipboard(entry.trace_id!); }}
                  >
                    Copy
                  </button>
                </span>
              </>
            )}
            {entry.source && (
              <>
                <span className="text-fg-secondary">Source</span>
                <span className="text-rmpg-200 font-mono">{entry.source}</span>
              </>
            )}
            <span className="text-fg-secondary">Timestamp</span>
            <span className="text-rmpg-200">{parseTimestamp(entry.created_at).toLocaleString('en-US', { timeZone: 'America/Denver' })}</span>
          </div>
          {entry.details !== undefined && entry.details !== null && (
            <pre className="bg-surface-sunken rounded-[2px] p-2 text-[10px] font-mono text-rmpg-200 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}


export default function SystemLogsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('server');
  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [searchText, setSearchText] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [desktopLogs, setDesktopLogs] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const isAdmin = user?.role === 'admin';

  const fetchLogs = useCallback(async (reset = false) => {
    setLoading(true);
    setError(null);
    const currentOffset = reset ? 0 : offset;
    try {
      const data = await apiFetch<ErrorLogResponse>(
        `/admin/error-log?limit=${PAGE_LIMIT}&offset=${currentOffset}`
      );
      const incoming = data.logs ?? [];
      if (reset) {
        setLogs(incoming);
        setOffset(incoming.length);
      } else {
        setLogs(prev => [...prev, ...incoming]);
        setOffset(prev => prev + incoming.length);
      }
      setHasMore(incoming.length === PAGE_LIMIT);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    fetchLogs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => fetchLogs(true), 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    if (activeTab === 'desktop') {
      (async () => {
        const lines = (await window.electron?.getAppLogs?.()) ?? [];
        setDesktopLogs(lines);
      })();
    }
  }, [activeTab]);

  const handleClear = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      setTimeout(() => setClearConfirm(false), 4000);
      return;
    }
    setClearConfirm(false);
    try {
      await apiFetch('/admin/error-log', { method: 'DELETE' });
      setLogs([]);
      setOffset(0);
      setHasMore(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear logs');
    }
  };

  const handleExportCsv = () => {
    downloadTextFile(`system-logs-${new Date().toISOString().slice(0, 10)}.csv`, errorLogsToCsv(filtered));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && activeTab === 'server') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = logs.filter(entry => {
    if (severityFilter !== 'ALL' && entry.severity.toUpperCase() !== severityFilter) return false;
    if (categoryFilter !== 'ALL' && entry.category !== categoryFilter) return false;
    if (searchText && !entry.message.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  if (!isAdmin) {
    return (
      <div className="p-6 text-fg-secondary text-sm">Access restricted to administrators.</div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-base">
      <PanelTitleBar title="SYSTEM LOGS" icon={Terminal} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-rmpg-800/60 bg-surface-raised/30">
        {/* Tabs */}
        <div className="flex rounded-[2px] overflow-hidden border border-rmpg-700/50 mr-2">
          {(['server', 'desktop'] as ActiveTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-[11px] font-semibold uppercase transition-colors ${
                activeTab === tab
                  ? 'bg-brand-600 text-rmpg-50'
                  : 'bg-surface-base text-fg-secondary hover:text-rmpg-200'
              }`}
            >
              {tab === 'server' ? 'Server' : (
                <span className="flex items-center gap-1"><Monitor size={11} />Desktop</span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'server' && (
          <>
            {/* Severity */}
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value as SeverityFilter)}
              className="bg-surface-base border border-rmpg-700/50 text-rmpg-200 text-[11px] rounded-[2px] px-2 py-1"
            >
              {SEVERITY_OPTIONS.map(o => (
                <option key={o} value={o}>{o === 'ALL' ? 'All Severities' : o}</option>
              ))}
            </select>

            {/* Category */}
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value as CategoryFilter)}
              className="bg-surface-base border border-rmpg-700/50 text-rmpg-200 text-[11px] rounded-[2px] px-2 py-1"
            >
              {CATEGORY_OPTIONS.map(o => (
                <option key={o} value={o}>{o === 'ALL' ? 'All Categories' : o}</option>
              ))}
            </select>

            {/* Search */}
            <input
              ref={searchRef}
              type="text"
              placeholder="Filter by message… (/)"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="bg-surface-base border border-rmpg-700/50 text-rmpg-200 text-[11px] rounded-[2px] px-2 py-1 w-44 placeholder:text-fg-muted"
            />

            <div className="flex-1" />

            {/* Auto-refresh */}
            <label className="flex items-center gap-1.5 text-[11px] text-fg-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                className="accent-brand-500"
              />
              Auto-refresh
            </label>

            {/* Refresh */}
            <button
              onClick={() => fetchLogs(true)}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-fg-secondary border border-rmpg-700/50 rounded-[2px] hover:bg-surface-raised transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>

            {/* Export */}
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-fg-secondary border border-rmpg-700/50 rounded-[2px] hover:bg-surface-raised transition-colors"
            >
              <Download size={11} />
              JSON
            </button>
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-fg-secondary border border-rmpg-700/50 rounded-[2px] hover:bg-surface-raised transition-colors"
            >
              <Download size={11} />
              CSV
            </button>

            {/* Clear */}
            <button
              onClick={handleClear}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-[2px] border transition-colors ${
                clearConfirm
                  ? 'bg-sev-critical/20 border-sev-critical text-sev-critical'
                  : 'text-fg-secondary border-rmpg-700/50 hover:bg-surface-raised'
              }`}
            >
              <Trash2 size={11} />
              {clearConfirm ? 'Confirm Clear' : 'Clear Logs'}
            </button>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'server' && (
          <>
            {error && (
              <div className="mx-3 mt-3 px-3 py-2 bg-sev-critical/10 border border-sev-critical/30 rounded-[2px] text-[11px] text-sev-critical flex items-center justify-between">
                <span>{error}</span>
                <button type="button" className="toolbar-btn" style={{ height: 24 }} onClick={() => fetchLogs(true)}>Retry</button>
              </div>
            )}

            {/* Column headers */}
            <div className="flex items-center gap-2 px-3 py-1 border-b border-rmpg-800/50 bg-surface-sunken/30 sticky top-0">
              <span className="w-4 shrink-0" />
              <span className="w-14 shrink-0 text-[9px] font-semibold uppercase text-fg-muted">Severity</span>
              <span className="w-20 shrink-0 text-[9px] font-semibold uppercase text-fg-muted">Category</span>
              <span className="flex-1 text-[9px] font-semibold uppercase text-fg-muted">Message</span>
              <span className="w-36 shrink-0 text-[9px] font-semibold uppercase text-fg-muted hidden md:block">Source</span>
              <span className="w-24 shrink-0 text-[9px] font-semibold uppercase text-fg-muted hidden lg:block">Trace ID</span>
              <span className="w-14 shrink-0 text-[9px] font-semibold uppercase text-fg-muted">Time</span>
            </div>

            {filtered.length === 0 && !loading && (
              <div className="text-center py-12 text-fg-muted text-[11px]">
                {logs.length === 0
                  ? 'No log entries loaded.'
                  : 'No log entries match the current filters.'}
              </div>
            )}

            {filtered.map(entry => (
              <LogRow key={entry.id} entry={entry} />
            ))}

            {hasMore && (
              <div className="px-3 py-3 flex justify-center">
                <button
                  onClick={() => fetchLogs(false)}
                  disabled={loading}
                  className="px-4 py-1.5 text-[11px] text-fg-secondary border border-rmpg-700/50 rounded-[2px] hover:bg-surface-raised transition-colors disabled:opacity-50"
                >
                  {loading ? 'Loading…' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}

        {activeTab === 'desktop' && (
          <div className="p-3">
            {desktopLogs.length === 0 ? (
              <div className="text-center py-12 text-fg-muted text-[11px]">
                {window.electron?.getAppLogs
                  ? 'No desktop log lines available.'
                  : 'Desktop log bridge unavailable (not running in Electron).'}
              </div>
            ) : (
              <pre className="bg-surface-sunken rounded-[2px] p-3 text-[10px] font-mono text-rmpg-200 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {desktopLogs.join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-rmpg-800/60 bg-surface-raised/20 flex items-center gap-4 text-[10px] text-fg-muted">
        <span>{filtered.length} {filtered.length === 1 ? 'entry' : 'entries'} shown</span>
        {logs.length !== filtered.length && (
          <span>({logs.length} total loaded)</span>
        )}
        {autoRefresh && <span className="text-brand-400">● Auto-refreshing every 30s</span>}
      </div>
    </div>
  );
}
