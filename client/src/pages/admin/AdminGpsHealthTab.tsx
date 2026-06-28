import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, Navigation, AlertTriangle, AlertOctagon, Battery,
  Wifi, WifiOff, RefreshCw, CheckCircle2, MoonStar,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// ============================================================
// Admin → GPS Health Dashboard
// ============================================================
// Per-unit snapshot of authoritative-source freshness. One row
// per unit, color-coded by classification:
//
//   healthy   green    — authoritative source < 5 min stale,
//                        and live source matches authoritative
//   warning   amber    — authoritative 5-15 min stale (alert
//                        warning tier currently active)
//   critical  red      — authoritative >= 15 min stale (alert
//                        critical tier currently active)
//   silent    gray     — never reported authoritative source
//                        OR > 24 hours stale (off the air)
//   fallback  blue     — authoritative source healthy but a
//                        lower-priority browser source is currently
//                        writing (e.g. dispatcher pinned the unit
//                        from the console)
//   off_duty  muted    — status is OFD / off_duty / out_of_service
//
// Polls every 5 seconds while the tab is visible. Refresh button
// for explicit refresh. Auto-pauses when the tab is backgrounded.
// ============================================================

interface UnitRow {
  id: number;
  call_sign: string;
  status: string;
  gps_source: string | null;
  gps_updated_at: string | null;
  last_authoritative_gps_at: string | null;
  last_authoritative_gps_source: string | null;
  latitude: number | null;
  longitude: number | null;
  officer_name: string | null;
  badge_number: string | null;
  authoritative_points_24h: number;
  total_points_24h: number;
  auth_age_seconds: number | null;
  live_age_seconds: number | null;
  classification: 'healthy' | 'warning' | 'critical' | 'silent' | 'fallback' | 'off_duty';
}

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

function fmtAge(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

const CLASSIFICATION_STYLES: Record<UnitRow['classification'], { bg: string; border: string; text: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  healthy:  { bg: 'bg-green-900/20',   border: 'border-green-700/40',   text: 'text-green-400',  icon: CheckCircle2,    label: 'HEALTHY' },
  warning:  { bg: 'bg-amber-900/20',   border: 'border-amber-700/40',   text: 'text-amber-400',  icon: AlertTriangle,   label: 'WARN' },
  critical: { bg: 'bg-red-900/30',     border: 'border-red-700/50',    text: 'text-red-400',    icon: AlertOctagon,    label: 'CRITICAL' },
  silent:   { bg: 'bg-[#1a1a1a]',      border: 'border-[#444]',         text: 'text-[#888]',     icon: WifiOff,         label: 'SILENT' },
  fallback: { bg: 'bg-blue-900/20',    border: 'border-blue-700/40',    text: 'text-blue-400',   icon: Wifi,            label: 'FALLBACK' },
  off_duty: { bg: 'bg-[#0d0d0d]',      border: 'border-[#222]',         text: 'text-[#666]',     icon: MoonStar,        label: 'OFF DUTY' },
};

export default function AdminGpsHealthTab({ LoadingSpinner, setError }: Props) {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ units: UnitRow[]; generated_at: string }>('/admin/gps-health');
      setUnits(data.units || []);
      setGeneratedAt(data.generated_at);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load GPS health');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh while the tab is visible. Pauses when hidden so we
  // don't burn cycles on a backgrounded admin window. The 5s cadence
  // matches the WebSocket heartbeat — fast enough to feel real-time,
  // slow enough to not hammer the API.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      id = setInterval(load, 5000);
    };
    const stop = () => {
      if (id) { clearInterval(id); id = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { load(); start(); } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  if (loading && units.length === 0) return <LoadingSpinner />;

  // Group counts for the header.
  const counts = units.reduce((acc, u) => {
    acc[u.classification] = (acc[u.classification] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-4 space-y-4">
      {/* Summary strip */}
      <div className="flex items-start gap-3 p-3 border border-[#222] bg-surface-raised" style={{ borderRadius: 2 }}>
        <Activity className="w-5 h-5 text-[#d4a017] flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-white mb-1">GPS Health — Authoritative Source Snapshot</h2>
          <p className="text-[11px] text-[#aaa]">
            Live freshness of OwnTracks / Traccar / ClearPathGPS heartbeats per unit. Browser fallback sources do not stamp authoritative freshness, so this view shows when the dominant tracker actually went silent — not when any source last wrote.
          </p>
          <div className="flex gap-3 mt-2 flex-wrap">
            {(['healthy', 'fallback', 'warning', 'critical', 'silent', 'off_duty'] as const).map(k => (
              <span key={k} className={`text-[10px] font-mono px-2 py-0.5 ${CLASSIFICATION_STYLES[k].bg} ${CLASSIFICATION_STYLES[k].text}`} style={{ borderRadius: 2 }}>
                {CLASSIFICATION_STYLES[k].label}: {counts[k] || 0}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-2 py-1 text-[11px] font-mono border border-[#2e2e2e] hover:border-[#d4a017] hover:text-[#d4a017] text-[#aaa] flex items-center gap-1"
          style={{ borderRadius: 2 }}
          title="Refresh now"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Unit grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {units.map(u => {
          const style = CLASSIFICATION_STYLES[u.classification];
          const Icon = style.icon;
          // Inline pulse on critical so it grabs attention even from peripheral vision.
          const pulse = u.classification === 'critical' ? 'animate-pulse' : '';
          return (
            <div
              key={u.id}
              className={`border ${style.border} ${style.bg} p-3 ${pulse}`}
              style={{ borderRadius: 2 }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${style.text}`} aria-hidden="true" />
                  <span className="font-bold text-white text-sm">{u.call_sign}</span>
                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 ${style.text}`} style={{ borderRadius: 2 }}>
                    {style.label}
                  </span>
                </div>
                <span className="text-[10px] text-[#888] uppercase">{u.status || '—'}</span>
              </div>
              <div className="text-[11px] text-[#bbb] mb-2 truncate">
                {u.officer_name || 'Unassigned'}{u.badge_number ? ` · #${u.badge_number}` : ''}
              </div>
              <table className="w-full text-[10px] font-mono text-[#aaa]">
                <tbody>
                  <tr>
                    <td className="py-0.5 pr-2 text-[#666]">Authoritative</td>
                    <td className="py-0.5 text-white">
                      {u.last_authoritative_gps_source || <span className="text-[#666]">none</span>}
                      {u.auth_age_seconds != null && (
                        <span className="ml-1 text-[#888]">({fmtAge(u.auth_age_seconds)} ago)</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pr-2 text-[#666]">Live source</td>
                    <td className="py-0.5 text-white">
                      {u.gps_source || <span className="text-[#666]">none</span>}
                      {u.live_age_seconds != null && (
                        <span className="ml-1 text-[#888]">({fmtAge(u.live_age_seconds)} ago)</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pr-2 text-[#666]">24h points</td>
                    <td className="py-0.5 text-white">
                      <span className={u.authoritative_points_24h > 0 ? 'text-green-400' : 'text-red-400'}>
                        {u.authoritative_points_24h}
                      </span>
                      <span className="text-[#666]"> auth / </span>
                      <span>{u.total_points_24h}</span>
                      <span className="text-[#666]"> total</span>
                    </td>
                  </tr>
                  {u.latitude != null && u.longitude != null && (
                    <tr>
                      <td className="py-0.5 pr-2 text-[#666]">Position</td>
                      <td className="py-0.5 text-[10px]">{u.latitude.toFixed(5)}, {u.longitude.toFixed(5)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {generatedAt && (
        <div className="text-[10px] text-[#666] text-right font-mono">
          Last refresh: {new Date(generatedAt).toLocaleTimeString()} · Auto-refreshes every 5s while tab is visible
        </div>
      )}
      {/* Suppress unused-import warning; reserved for future battery indicator. */}
      <span className="hidden"><Battery /><Navigation /></span>
    </div>
  );
}
