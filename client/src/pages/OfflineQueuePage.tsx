import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { WifiOff, RefreshCw, Trash2, CheckCircle } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { withAlpha } from '../utils/withAlpha';
import { parseTimestamp } from '../utils/dateUtils';
import { filterByQuery, syncItemsToCsv } from '../utils/queueWorkbench';
import { downloadTextFile } from '../utils/intelHitExport';
import { useSlashFocus } from '../hooks/useSlashFocus';

interface SyncQueueItem {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | string;
  endpoint: string;
  body?: unknown;
  created_at: string;
  retry_count: number;
  status: 'pending' | 'failed' | 'syncing';
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--sev-ok)',
  POST: 'var(--brand-400)',
  PUT: 'var(--sev-warn)',
  DELETE: 'var(--sev-critical)',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--sev-warn)',
  failed: 'var(--sev-critical)',
  syncing: 'var(--brand-400)',
};

function formatTime(iso: string): string {
  try {
    const d = parseTimestamp(iso);
    return d.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function getLocalQueueCount(): number {
  try {
    const raw = localStorage.getItem('rmpg_offline_queue');
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
    return 0;
  } catch {
    return 0;
  }
}

export default function OfflineQueuePage() {
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const [localCount, setLocalCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [q, setQ] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [queueError, setQueueError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  const fetchQueue = useCallback(async () => {
    try {
      const electronQueue = await window.electron?.getSyncQueueDetail?.();
      if (Array.isArray(electronQueue)) {
        setQueue(electronQueue as SyncQueueItem[]);
      } else {
        setQueue([]);
      }
      setLocalCount(getLocalQueueCount());
      setQueueError(false);
    } catch {
      setQueueError(true);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 10_000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const handleRetry = useCallback(async (id: string) => {
    setRetryingId(id);
    try {
      await window.electron?.retryFailedSyncItem?.(id);
      await fetchQueue();
    } finally {
      setRetryingId(null);
    }
  }, [fetchQueue]);

  const handleRetryAll = useCallback(async () => {
    setRetryingAll(true);
    try {
      const failed = queue.filter(i => i.status === 'failed');
      for (const item of failed) {
        await window.electron?.retryFailedSyncItem?.(item.id);
      }
      await fetchQueue();
    } finally {
      setRetryingAll(false);
    }
  }, [fetchQueue, queue]);

  const handleClearFailed = useCallback(async () => {
    setClearing(true);
    try {
      await window.electron?.clearFailedSyncItems?.();
      await fetchQueue();
    } finally {
      setClearing(false);
    }
  }, [fetchQueue]);

  const totalPending = queue.length > 0 ? queue.length : localCount;
  const failedCount = queue.filter(i => i.status === 'failed').length;
  const visible = useMemo(() => {
    const byMethod = methodFilter ? queue.filter((i) => i.method === methodFilter) : queue;
    return filterByQuery(byMethod, q, (i) => `${i.method} ${i.endpoint} ${i.status}`);
  }, [queue, q, methodFilter]);

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: 'var(--surface-base)', color: 'var(--text-primary)' }}
    >
      <PanelTitleBar title="OFFLINE SYNC QUEUE" icon={WifiOff} />

      {/* Connection banner */}
      <div
        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold"
        style={{
          background: isOnline ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          borderBottom: `1px solid ${isOnline ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
          color: isOnline ? 'var(--sev-ok)' : 'var(--sev-critical)',
        }}
      >
        {isOnline ? (
          <>
            <CheckCircle size={13} />
            Connected — syncing
          </>
        ) : (
          <>
            <WifiOff size={13} />
            Offline — {totalPending} {totalPending === 1 ? 'item' : 'items'} queued
          </>
        )}
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2 gap-2"
        style={{
          borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.07))',
          background: 'var(--surface-raised)',
        }}
      >
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Total pending: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{totalPending}</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium transition-opacity"
            style={{
              background: 'var(--brand-700)',
              color: 'var(--brand-200)',
              borderRadius: 2,
              border: '1px solid var(--brand-500)',
              opacity: retryingAll ? 0.6 : 1,
              cursor: retryingAll ? 'not-allowed' : 'pointer',
            }}
            onClick={handleRetryAll}
            disabled={retryingAll || queue.length === 0}
            aria-label="Retry all sync items"
          >
            <RefreshCw size={11} className={retryingAll ? 'animate-spin' : ''} />
            Retry All
          </button>
          <button
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium transition-opacity"
            style={{
              background: 'rgba(239,68,68,0.12)',
              color: 'var(--sev-critical)',
              borderRadius: 2,
              border: '1px solid rgba(var(--sev-critical-rgb), 0.3)',
              opacity: clearing ? 0.6 : 1,
              cursor: clearing || failedCount === 0 ? 'not-allowed' : 'pointer',
            }}
            onClick={handleClearFailed}
            disabled={clearing || failedCount === 0}
            aria-label="Clear all failed sync items"
          >
            <Trash2 size={11} />
            Clear Failed
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs transition-opacity"
            style={{
              color: 'var(--text-secondary)',
              borderRadius: 2,
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.07))',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onClick={fetchQueue}
            aria-label="Refresh sync queue"
          >
            <RefreshCw size={11} />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => downloadTextFile('offline-queue.csv', syncItemsToCsv(visible))}
          >
            CSV
          </button>
        </div>
      </div>

      <div className="flex gap-2 px-4 py-2 items-center">
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter endpoint… (/)"
          aria-label="Filter sync queue"
          className="flex-1 text-[11px] px-2 py-1 bg-surface-sunken border border-border-subtle rounded-[2px] text-rmpg-100"
        />
        {['', 'POST', 'PUT', 'DELETE', 'GET'].map((m) => (
          <button
            key={m || 'all'}
            type="button"
            onClick={() => setMethodFilter(m)}
            className="text-[8px] px-2 py-0.5 border border-border-subtle rounded-[2px]"
            style={{ background: methodFilter === m ? 'var(--brand-400)' : 'transparent', color: methodFilter === m ? 'var(--surface-base)' : 'var(--text-secondary)' }}
          >
            {m || 'ALL'}
          </button>
        ))}
      </div>

      {queueError && (
        <div className="px-4 py-2 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load sync queue.</span>
          <button type="button" className="toolbar-btn" onClick={() => { void fetchQueue(); }}>Retry</button>
        </div>
      )}
      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
            <CheckCircle size={36} style={{ color: 'var(--sev-ok)', opacity: 0.7 }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              All data synchronized
            </span>
            {localCount > 0 && (
              <span className="text-xs" style={{ color: 'var(--sev-warn)' }}>
                {localCount} {localCount === 1 ? 'item' : 'items'} in local storage queue
              </span>
            )}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            No queue items match the current filter
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr
                style={{
                  background: 'var(--surface-sunken)',
                  color: 'var(--field-label-color)',
                  fontWeight: 600,
                  fontSize: 9,
                  letterSpacing: '0.06em',
                }}
              >
                <th className="text-left px-4 py-[3px]">METHOD</th>
                <th className="text-left px-3 py-1">ENDPOINT</th>
                <th className="text-left px-3 py-[3px]">CREATED</th>
                <th className="text-left px-3 py-[3px]">RETRIES</th>
                <th className="text-left px-3 py-[3px]">STATUS</th>
                <th className="px-3 py-[3px]" />
              </tr>
            </thead>
            <tbody>
              {visible.map((item, idx) => (
                <tr
                  key={item.id}
                  style={{
                    background: idx % 2 === 0 ? 'var(--surface-base)' : 'var(--surface-raised)',
                    borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.04))',
                    fontSize: 11,
                  }}
                >
                  <td className="px-4 py-[2px]">
                    <span
                      className="inline-block font-bold px-2 py-[1px] text-[10px]"
                      style={{
                        background: withAlpha(METHOD_COLORS[item.method] ?? 'var(--text-secondary)', '22'),
                        color: METHOD_COLORS[item.method] ?? 'var(--text-secondary)',
                        borderRadius: 2,
                        border: `1px solid ${withAlpha(METHOD_COLORS[item.method] ?? 'var(--text-secondary)', '44')}`,
                        minWidth: 44,
                        textAlign: 'center',
                      }}
                    >
                      {item.method}
                    </span>
                  </td>
                  <td
                    className="px-3 py-[2px] font-mono"
                    style={{ color: 'var(--text-primary)', maxWidth: 320, wordBreak: 'break-all' }}
                  >
                    {item.endpoint}
                  </td>
                  <td className="px-3 py-[2px]" style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {formatTime(item.created_at)}
                  </td>
                  <td className="px-3 py-[2px]" style={{ color: 'var(--text-secondary)' }}>
                    {item.retry_count}
                  </td>
                  <td className="px-3 py-[2px]">
                    <span
                      className="inline-block text-[10px] font-semibold px-2 py-[1px]"
                      style={{
                        background: withAlpha(STATUS_COLORS[item.status] ?? 'var(--text-secondary)', '18'),
                        color: STATUS_COLORS[item.status] ?? 'var(--text-secondary)',
                        borderRadius: 2,
                        border: `1px solid ${withAlpha(STATUS_COLORS[item.status] ?? 'var(--text-secondary)', '44')}`,
                      }}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-3 py-[2px] text-right">
                    {item.status === 'failed' && (
                      <button
                        className="flex items-center gap-1 px-2 py-[2px] text-[10px] font-medium ml-auto"
                        style={{
                          background: 'var(--brand-700)',
                          color: 'var(--brand-200)',
                          borderRadius: 2,
                          border: '1px solid var(--brand-500)',
                          opacity: retryingId === item.id ? 0.5 : 1,
                          cursor: retryingId === item.id ? 'not-allowed' : 'pointer',
                        }}
                        onClick={() => handleRetry(item.id)}
                        disabled={retryingId === item.id}
                        aria-label={`Retry sync for ${item.endpoint}`}
                      >
                        <RefreshCw size={9} className={retryingId === item.id ? 'animate-spin' : ''} />
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
