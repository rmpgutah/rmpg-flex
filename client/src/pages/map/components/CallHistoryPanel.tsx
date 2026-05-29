// ============================================================
// RMPG Flex — CallHistoryPanel Component
// Floating summary panel for historical calls plotted on the
// map. Shows stats, priority breakdown, top incident types,
// and a scrollable list of recent calls.
// ============================================================

import React, { useMemo } from 'react';
import { X, Clock, Phone, TrendingUp, MapPin } from 'lucide-react';
import { parseTimestamp } from '../../../utils/dateUtils';

interface CallHistoryPanelProps {
  calls: {
    id: number;
    call_number: string;
    incident_type: string;
    priority: string;
    status: string;
    disposition: string | null;
    location_address: string;
    created_at: string;
    response_time_min: number | null;
  }[];
  loading: boolean;
  days: number;
  onClose: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#ef4444',
  P2: '#f59e0b',
  P3: '#888888',
  P4: '#666666',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - parseTimestamp(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatMinutes(min: number): string {
  if (min < 1) return '<1m';
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export default function CallHistoryPanel({
  calls,
  loading,
  days,
  onClose,
}: CallHistoryPanelProps) {
  const stats = useMemo(() => {
    const total = calls.length;

    // Average response time
    const withResponse = calls.filter((c) => c.response_time_min != null);
    const avgResponse =
      withResponse.length > 0
        ? Math.round(
            withResponse.reduce((sum, c) => sum + (c.response_time_min ?? 0), 0) /
              withResponse.length,
          )
        : null;

    // Priority breakdown
    const priorities: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
    for (const c of calls) {
      const p = c.priority?.toUpperCase();
      if (p && p in priorities) priorities[p]++;
    }

    // Top 5 incident types
    const typeCounts: Record<string, number> = {};
    for (const c of calls) {
      const t = c.incident_type || 'Unknown';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const maxTypeCount = topTypes.length > 0 ? topTypes[0][1] : 1;

    // Recent 10 calls (sorted newest first)
    const recent = [...calls]
      .sort((a, b) => parseTimestamp(b.created_at).getTime() - parseTimestamp(a.created_at).getTime())
      .slice(0, 10);

    return { total, avgResponse, priorities, topTypes, maxTypeCount, recent };
  }, [calls]);

  return (
    <div
      className="panel-beveled bg-surface-base overflow-hidden shadow-xl transition-all duration-200 ease-out"
      style={{ width: 300 }}
      role="complementary"
      aria-label="Call history panel"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#050505', borderBottom: '1px solid #282828' }}
      >
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-gray-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-300">
            Call History
          </span>
          {/* #40: Call count badge with border */}
          <span
            className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm tabular-nums"
            style={{ background: '#444444', color: '#22c55e', border: '1px solid #4a4a4a' }}
          >
            {loading ? '...' : stats.total}
          </span>
        </div>
        <button type="button"
          onClick={onClose}
          className="toolbar-btn p-1 hover:bg-[#181818] transition-all duration-150 active:scale-[0.97] rounded-sm"
          aria-label="Close call history panel"
          title="Close"
        >
          <X size={12} className="text-rmpg-400" />
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-8 text-rmpg-500 gap-2">
          <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-[9px] font-mono animate-pulse">Loading {days}d history...</span>
          <div className="space-y-1.5 w-full px-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-sm h-10" style={{ background: '#050505', opacity: 1 - i * 0.2 }} />
            ))}
          </div>
        </div>
      )}

      {!loading && (
        <div className="p-2 space-y-2">
          {/* Summary stats row */}
          <div
            className="rounded-sm p-2 flex items-center gap-3"
            style={{ background: '#050505', border: '1px solid #282828' }}
          >
            <div className="flex items-center gap-1">
              <Phone size={10} className="text-gray-400" />
              <span className="text-[9px] font-mono text-rmpg-300">
                {stats.total} calls
              </span>
            </div>
            {stats.avgResponse != null && (
              <div className="flex items-center gap-1">
                <TrendingUp size={10} className="text-gray-400" />
                <span className="text-[9px] font-mono text-rmpg-300">
                  Avg {formatMinutes(stats.avgResponse)}
                </span>
              </div>
            )}
          </div>

          {/* Priority breakdown */}
          <div
            className="rounded-sm p-2"
            style={{ background: '#050505', border: '1px solid #282828' }}
          >
            <div className="text-[10px] uppercase tracking-wider text-rmpg-500 mb-1.5">
              Priority
            </div>
            <div className="flex items-center gap-1.5">
              {Object.entries(stats.priorities).map(([p, count]) => (
                <span
                  key={p}
                  className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm"
                  style={{
                    background: `${PRIORITY_COLORS[p]}20`,
                    color: PRIORITY_COLORS[p],
                    border: `1px solid ${PRIORITY_COLORS[p]}40`,
                  }}
                >
                  {p}: {count}
                </span>
              ))}
            </div>
          </div>

          {/* Top 5 incident types */}
          {stats.topTypes.length > 0 && (
            <div
              className="rounded-sm p-2"
              style={{ background: '#050505', border: '1px solid #282828' }}
            >
              <div className="text-[10px] uppercase tracking-wider text-rmpg-500 mb-1.5">
                Top Types
              </div>
              <div className="space-y-1">
                {stats.topTypes.map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-rmpg-300 truncate flex-1 min-w-0">
                      {type}
                    </span>
                    <span className="text-[9px] font-mono text-rmpg-500 w-5 text-right shrink-0">
                      {count}
                    </span>
                    <div
                      className="h-1 rounded-full shrink-0"
                      style={{
                        width: `${Math.max((count / stats.maxTypeCount) * 60, 4)}px`,
                        background: '#22c55e',
                        opacity: 0.6,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent calls list */}
          {stats.recent.length > 0 && (
            <div
              className="rounded-sm"
              style={{ background: '#050505', border: '1px solid #282828' }}
            >
              <div className="text-[10px] uppercase tracking-wider text-rmpg-500 px-2 pt-2 pb-1">
                Recent Calls
              </div>
              <div
                className="max-h-48 overflow-y-auto space-y-px px-1 pb-1 scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent"
              >
                {stats.recent.map((call) => {
                  const pColor =
                    PRIORITY_COLORS[call.priority?.toUpperCase()] || '#666666';

                  return (
                    <div
                      key={call.id}
                      className="rounded-sm px-2 py-1.5 hover:bg-[#181818]/50 transition-colors duration-100"
                      style={{ borderLeft: `2px solid ${pColor}` }}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[9px] font-mono font-bold text-gray-300">
                          {call.call_number}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-[8px] font-mono font-bold px-1 py-px rounded-sm"
                            style={{
                              background: `${pColor}20`,
                              color: pColor,
                              border: `1px solid ${pColor}40`,
                            }}
                          >
                            {call.priority?.toUpperCase() || '—'}
                          </span>
                          <span className="text-[8px] font-mono text-rmpg-600">
                            {timeAgo(call.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="text-[9px] font-mono text-rmpg-300 truncate">
                        {(call.incident_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin size={8} className="text-rmpg-600 shrink-0" />
                        <span className="text-[8px] font-mono text-rmpg-600 truncate">
                          {call.location_address}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {calls.length === 0 && (
            <div className="flex flex-col items-center gap-2 text-center py-8">
              <Phone size={20} className="text-rmpg-600/40" />
              <span className="text-rmpg-600 text-[9px] font-mono">
                No calls found for the past {days} day{days !== 1 ? 's' : ''}.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
