// ============================================================
// RMPG Flex — IncidentReportsPanel Component
// Floating summary panel shown when the Incident Reports
// toggle is active on the map. Displays count, days filter,
// status breakdown, top incident types, and recent reports.
// ============================================================

import React, { useMemo } from 'react';
import { X, FileText, Info, Navigation, Clock } from 'lucide-react';
import { parseTimestamp } from '../../../utils/dateUtils';

interface IncidentReport {
  id: number;
  incident_type: string;
  status: string;
  latitude?: number;
  longitude?: number;
  created_at: string;
  officer_name?: string | null;
}

interface IncidentReportsPanelProps {
  count: number;
  loading: boolean;
  days: number;
  onClose: () => void;
  reports?: IncidentReport[];
  onDaysChange?: (d: number) => void;
  onNavigate?: (lat: number, lng: number) => void;
}

// ─── Status colors ──────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:        { label: 'Draft',        color: '#999999', bg: '#999999' },
  submitted:    { label: 'Submitted',    color: '#aaaaaa', bg: '#888888' },
  under_review: { label: 'Under Review', color: '#fbbf24', bg: '#f59e0b' },
  approved:     { label: 'Approved',     color: '#4ade80', bg: '#22c55e' },
  returned:     { label: 'Returned',     color: '#f87171', bg: '#ef4444' },
};

function getStatusStyle(status: string) {
  return STATUS_CONFIG[status] || { label: status, color: '#999999', bg: '#666666' };
}

// ─── Time-ago helper ────────────────────────────────────────

function timeAgo(ts: string): string {
  const diff = Date.now() - parseTimestamp(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Days filter options ────────────────────────────────────

const DAYS_OPTIONS = [7, 14, 30, 60, 90];

// ─── Component ──────────────────────────────────────────────

export default function IncidentReportsPanel({
  count,
  loading,
  days,
  onClose,
  reports,
  onDaysChange,
  onNavigate,
}: IncidentReportsPanelProps) {

  // Status breakdown counts
  const statusCounts = useMemo(() => {
    if (!reports || reports.length === 0) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const r of reports) {
      map.set(r.status, (map.get(r.status) || 0) + 1);
    }
    return map;
  }, [reports]);

  // Top 3 incident types
  const topTypes = useMemo(() => {
    if (!reports || reports.length === 0) return [];
    const map = new Map<string, number>();
    for (const r of reports) {
      const t = r.incident_type || 'Unknown';
      map.set(t, (map.get(t) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [reports]);

  // Recent 5 reports (newest first)
  const recentReports = useMemo(() => {
    if (!reports || reports.length === 0) return [];
    return [...reports]
      .sort((a, b) => parseTimestamp(b.created_at).getTime() - parseTimestamp(a.created_at).getTime())
      .slice(0, 5);
  }, [reports]);

  const totalForBar = reports?.length || count || 1;

  return (
    <div className="panel-beveled bg-surface-base overflow-hidden transition-all duration-200 ease-out shadow-lg" style={{ maxWidth: 280 }} role="complementary" aria-label="Incident reports panel">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#050505', borderBottom: '1px solid #282828' }}
      >
        <div className="flex items-center gap-2">
          <FileText size={12} className="text-emerald-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-200 font-mono">
            Incident Reports
          </span>
          {/* #41: Incident count badge with border */}
          {!loading && (
            <span
              className="text-[9px] font-mono font-bold text-emerald-300 bg-emerald-900/40 px-1.5 py-0.5 rounded-sm tabular-nums"
              style={{ minWidth: 20, textAlign: 'center', border: '1px solid rgba(16,185,129,0.3)' }}
            >
              {count}
            </span>
          )}
        </div>
        <button type="button"
          onClick={onClose}
          className="toolbar-btn p-1 hover:bg-[#181818] transition-all duration-150 active:scale-[0.97] rounded-sm"
          aria-label="Close incident reports panel"
          title="Close"
        >
          <X size={12} className="text-rmpg-400" />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        {loading ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] font-mono text-rmpg-500 animate-pulse">Loading reports...</span>
            <div className="space-y-1 w-full">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse rounded-sm h-8" style={{ background: '#050505', opacity: 1 - i * 0.2 }} />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Days filter */}
            {onDaysChange && (
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-rmpg-500 uppercase">Range</span>
                <div className="flex items-center gap-0.5">
                  {DAYS_OPTIONS.map((d) => (
                    <button type="button"
                      key={d}
                      onClick={() => onDaysChange(d)}
                      className={`toolbar-btn px-1.5 py-0.5 text-[9px] font-mono transition-all duration-150 active:scale-[0.97] ${
                        days === d
                          ? 'text-emerald-300 bg-emerald-900/40'
                          : 'text-rmpg-500 hover:bg-[#181818]/50'
                      }`}
                      title={`Show last ${d} days`}
                      aria-label={`Show last ${d} days`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Summary row */}
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] font-mono text-rmpg-500 uppercase">Total</span>
                <span className="text-[9px] font-mono font-bold text-emerald-300">{count}</span>
              </div>
              {!onDaysChange && (
                <div className="flex items-baseline justify-between">
                  <span className="text-[9px] font-mono text-rmpg-500 uppercase">Range</span>
                  <span className="text-[9px] font-mono text-rmpg-300">
                    Last {days} day{days !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>

            {/* Status breakdown */}
            {reports && reports.length > 0 && statusCounts.size > 0 && (
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-rmpg-500 uppercase">By Status</span>
                <div className="space-y-0.5">
                  {Object.keys(STATUS_CONFIG).map((key) => {
                    const cnt = statusCounts.get(key) || 0;
                    if (cnt === 0) return null;
                    const style = getStatusStyle(key);
                    const pct = Math.max(4, (cnt / totalForBar) * 100);
                    return (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono w-[60px] text-right" style={{ color: style.color }}>
                          {style.label}
                        </span>
                        <div className="flex-1 h-1.5 rounded-sm overflow-hidden" style={{ background: '#0a0a0a' }}>
                          <div
                            className="h-full rounded-sm"
                            style={{ width: `${pct}%`, background: style.bg, opacity: 0.7 }}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-rmpg-400 w-[18px] text-right">{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top incident types */}
            {topTypes.length > 0 && (
              <div className="space-y-0.5">
                <span className="text-[9px] font-mono text-rmpg-500 uppercase">Top Types</span>
                {topTypes.map(([type, cnt]) => (
                  <div
                    key={type}
                    className="flex items-center justify-between text-[9px] font-mono px-1.5 py-0.5 rounded-sm hover:bg-[#181818]/50 transition-colors duration-100"
                    style={{ background: '#0a0a0a' }}
                  >
                    <span className="text-rmpg-300 truncate">{type}</span>
                    <span className="text-emerald-400 font-bold ml-2 flex-shrink-0">{cnt}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Recent reports */}
            {recentReports.length > 0 && (
              <div className="space-y-0.5">
                <span className="text-[9px] font-mono text-rmpg-500 uppercase">Recent</span>
                <div className="max-h-[140px] overflow-y-auto space-y-0.5 scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent">
                  {recentReports.map((r) => {
                    const ss = getStatusStyle(r.status);
                    const hasCoords = r.latitude != null && r.longitude != null;
                    return (
                      <div
                        key={r.id}
                        className="rounded-sm px-1.5 py-1 space-y-0.5 hover:bg-[#181818]/50 transition-colors duration-100"
                        style={{ background: '#050505', border: '1px solid #282828', borderLeft: `2px solid ${ss.bg}` }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-rmpg-200 truncate flex items-center gap-1">
                            <FileText size={8} className="shrink-0 text-rmpg-500" />
                            {(r.incident_type || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          </span>
                          <span
                            className="text-[8px] font-mono px-1 py-0.5 rounded-sm flex-shrink-0 ml-1"
                            style={{
                              background: `${ss.bg}22`,
                              border: `1px solid ${ss.bg}44`,
                              color: ss.color,
                            }}
                          >
                            {ss.label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[9px] font-mono text-rmpg-600">
                          <span className="flex items-center gap-1">
                            {r.officer_name && (
                              <span className="text-rmpg-400">{r.officer_name}</span>
                            )}
                            <Clock size={8} />
                            {timeAgo(r.created_at)}
                          </span>
                          {onNavigate && hasCoords && (
                            <button type="button"
                              onClick={() => onNavigate(r.latitude!, r.longitude!)}
                              className="toolbar-btn p-0.5 text-emerald-400 hover:text-emerald-300 transition-all duration-150 active:scale-[0.97]"
                              title="Navigate to location"
                              aria-label={`Navigate to ${r.incident_type || 'incident'} location`}
                            >
                              <Navigation size={9} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Info note */}
            <div
              className="flex items-start gap-1.5 px-2 py-1.5 rounded"
              style={{ background: '#050505', border: '1px solid #282828' }}
            >
              <Info size={10} className="text-emerald-500 mt-0.5 shrink-0" />
              <span className="text-[9px] font-mono text-rmpg-500 leading-tight">
                Click markers on map for details
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
