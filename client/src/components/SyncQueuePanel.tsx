// ============================================================
// RMPG Flex — Sync Queue Panel (Electron Desktop Only)
// Popover showing offline sync queue details above status bar
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';

const electron = typeof window !== 'undefined' ? (window as any).electron : null;

interface SyncItem {
  id: string;
  type: 'citation' | 'fi_card' | 'evidence' | 'call' | string;
  created_at: string;
  retry_count: number;
  status: 'pending' | 'failed' | 'in_progress';
  summary?: string;
}

interface SyncStatus {
  pending: number;
  items?: SyncItem[];
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  citation: { label: 'CITATION', color: '#d4a017' },
  fi_card: { label: 'FI CARD', color: '#3b82f6' },
  evidence: { label: 'EVIDENCE', color: '#a855f7' },
  call: { label: 'CALL', color: '#22c55e' },
};

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface SyncQueuePanelProps {
  onClose: () => void;
}

export default function SyncQueuePanel({ onClose }: SyncQueuePanelProps) {
  const [items, setItems] = useState<SyncItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    if (!electron?.getSyncStatus) return;
    const status: SyncStatus = electron.getSyncStatus();
    if (status?.items) {
      setItems(status.items);
    }
  }, []);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSyncNow = async () => {
    if (!electron?.triggerSync) return;
    setSyncing(true);
    try {
      await electron.triggerSync();
    } catch {
      // ignore — sync status will reflect outcome
    }
    setTimeout(() => {
      refresh();
      setSyncing(false);
    }, 2000);
  };

  const handleClearFailed = () => {
    if (!electron?.clearFailedSync) return;
    electron.clearFailedSync();
    setTimeout(refresh, 500);
  };

  const failedItems = items.filter((i) => i.status === 'failed');
  const pendingItems = items.filter((i) => i.status !== 'failed');

  return (
    <>
      {/* Backdrop to close on outside click */}
      <div
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="absolute bottom-full mb-1 z-[9999] bg-[#141e2b] border border-[#1e3048] rounded-sm shadow-lg"
        style={{ width: 340, maxHeight: 300, left: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3048]">
          <span className="text-[11px] font-semibold tracking-wider text-[#8ba2b8] uppercase">
            Sync Queue
          </span>
          <div className="flex items-center gap-2">
            {failedItems.length > 0 && (
              <button
                onClick={handleClearFailed}
                className="px-2 py-0.5 text-[10px] font-medium bg-[#3b1111] text-[#ef4444] border border-[#5c1a1a] rounded-sm hover:bg-[#4a1515] transition-colors"
              >
                CLEAR FAILED ({failedItems.length})
              </button>
            )}
            <button
              onClick={handleSyncNow}
              disabled={syncing || items.length === 0}
              className="px-2 py-0.5 text-[10px] font-medium bg-[#0d2847] text-[#4a9eed] border border-[#1a5a9e] rounded-sm hover:bg-[#133660] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {syncing ? 'SYNCING...' : 'SYNC NOW'}
            </button>
          </div>
        </div>

        {/* Item list */}
        <div className="overflow-y-auto" style={{ maxHeight: 252 }}>
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-[#5a6e80]">
              No pending sync items
            </div>
          ) : (
            <div className="divide-y divide-[#1e3048]">
              {[...pendingItems, ...failedItems].map((item) => {
                const typeInfo = TYPE_LABELS[item.type] || { label: item.type.toUpperCase(), color: '#8ba2b8' };
                const isFailed = item.status === 'failed';

                return (
                  <div
                    key={item.id}
                    className={`px-3 py-2 flex items-center gap-2 ${isFailed ? 'bg-[#1a0a0a]' : ''}`}
                  >
                    {/* Type badge */}
                    <span
                      className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded-sm tracking-wider flex-shrink-0"
                      style={{
                        color: typeInfo.color,
                        background: `${typeInfo.color}15`,
                        border: `1px solid ${typeInfo.color}30`,
                      }}
                    >
                      {typeInfo.label}
                    </span>

                    {/* Summary / ID */}
                    <span className="text-[11px] text-[#c4d3e0] truncate flex-1">
                      {item.summary || `#${item.id.slice(0, 8)}`}
                    </span>

                    {/* Retry count */}
                    {item.retry_count > 0 && (
                      <span className="text-[9px] text-[#5a6e80] flex-shrink-0">
                        x{item.retry_count}
                      </span>
                    )}

                    {/* Status indicator */}
                    {isFailed ? (
                      <span className="text-[9px] text-[#ef4444] font-semibold flex-shrink-0">FAIL</span>
                    ) : item.status === 'in_progress' ? (
                      <span className="led-dot led-yellow animate-led-blink flex-shrink-0" />
                    ) : (
                      <span className="led-dot led-green flex-shrink-0" style={{ opacity: 0.5 }} />
                    )}

                    {/* Age */}
                    <span className="text-[9px] text-[#5a6e80] flex-shrink-0 w-12 text-right">
                      {formatAge(item.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
