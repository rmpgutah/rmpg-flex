import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Phone, Radio, AlertTriangle, Activity } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { timeAgo } from '../../utils/statusLabels';

interface ActivityEntry {
  id: number | string;
  action?: string;
  entity_type?: string;
  created_at: string;
  user_name?: string;
  details?: string;
}

interface ActivityFeedProps {
  isOpen: boolean;
  onClose: () => void;
}

function entryIcon(entry: ActivityEntry) {
  const action = (entry.action || '').toLowerCase();
  const entity = (entry.entity_type || '').toLowerCase();
  if (entity.includes('call') || action.includes('call')) return Phone;
  if (entity.includes('unit') || action.includes('unit')) return Radio;
  if (action.includes('panic') || action.includes('emergency')) return AlertTriangle;
  return Activity;
}

export default function ActivityFeed({ isOpen, onClose }: ActivityFeedProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    apiFetch<{ data: ActivityEntry[] }>('/admin/activity-feed?limit=30')
      .then((res) => {
        const items = Array.isArray(res) ? res : (res?.data ?? []);
        setEntries(items.slice(0, 30));
      })
      .catch(() => {/* non-fatal */});
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    load();
    intervalRef.current = setInterval(load, 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isOpen, load]);

  if (!isOpen) return null;

  return (
    <div
      className="flex flex-col border-l border-[var(--spm-border)] w-56 flex-shrink-0"
      style={{ background: 'var(--surface-base)' }}
      aria-label="Activity feed"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-2 py-1 border-b border-[var(--spm-border)] flex-shrink-0"
        style={{ background: 'var(--surface-sunken)' }}
      >
        <span className="text-[9px] font-bold uppercase tracking-wider text-fg-muted flex items-center gap-1">
          <Activity className="w-3 h-3" /> Activity
        </span>
        <button
          type="button"
          aria-label="Close activity feed"
          onClick={onClose}
          className="text-fg-muted hover:text-rmpg-200 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      {/* Feed */}
      <div className="flex-1 overflow-y-auto scrollbar-dark">
        {entries.length === 0 ? (
          <div className="p-3 text-[9px] text-fg-muted italic text-center">No recent activity</div>
        ) : (
          entries.map((entry, i) => {
            const Icon = entryIcon(entry);
            const label = entry.action
              ? entry.action.replace(/_/g, ' ')
              : entry.entity_type ?? 'event';
            return (
              <div
                key={entry.id ?? i}
                className="flex items-start gap-1.5 px-2 py-1.5 border-b border-[var(--spm-border)] hover:bg-surface-raised transition-colors"
              >
                <Icon className="w-3 h-3 mt-0.5 flex-shrink-0 text-fg-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-[9px] text-rmpg-200 truncate capitalize">{label}</div>
                  {entry.user_name && (
                    <div className="text-[8px] text-fg-muted truncate">{entry.user_name}</div>
                  )}
                  <div className="text-[8px] text-fg-muted tabular-nums">
                    {timeAgo(entry.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
