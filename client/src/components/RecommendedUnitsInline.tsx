// ============================================================
// RMPG Flex — Recommended Units (inline)
// Always-visible top-N closest available units pulled from
// server-authoritative GPS history (10-min freshness window).
// Lives next to the call detail Auto-Assign / Suggest buttons.
// Click a row to one-click attach the unit to the call.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import { Navigation, Clock, MapPin, RefreshCw, Loader2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export interface RecommendedUnit {
  callSign: string;
  distanceMeters: number;
  distanceMiles: number;
  etaMinutes: number;
  status: string;
  unitType: string | null;
  officerName: string | null;
  badgeNumber: string | null;
  currentCallId: string | null;
}

interface RecommendResponse {
  callId: number;
  callNumber: string;
  callPriority?: string;
  recommended: RecommendedUnit[];
  reason?: string;
}

interface Props {
  callId: string | number | null | undefined;
  /** Called when dispatcher clicks a unit row. Receives the call_sign. */
  onAssign?: (callSign: string) => void;
  /** Hard-cap. Defaults to 3. */
  limit?: number;
  /** Auto-refresh on a timer in ms (0 disables). */
  refreshIntervalMs?: number;
}

const STATUS_COLOR: Record<string, string> = {
  available: '#22c55e',
  on_patrol: '#22c55e',
  in_service: '#22c55e',
  dispatched: '#f59e0b',
  enroute: '#fbbf24',
  onscene: '#a855f7',
  busy: '#ef4444',
};

function statusColor(s: string): string {
  return STATUS_COLOR[s] || '#888';
}

export default function RecommendedUnitsInline({
  callId,
  onAssign,
  limit = 3,
  refreshIntervalMs = 30000,
}: Props) {
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async () => {
    if (!callId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch<RecommendResponse>(`/api/dispatch/calls/${callId}/recommended-units?limit=${limit}`);
      setData(r);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }, [callId, limit]);

  useEffect(() => {
    fetchRecommendations();
    if (!refreshIntervalMs) return;
    const t = setInterval(fetchRecommendations, refreshIntervalMs);
    return () => clearInterval(t);
  }, [fetchRecommendations, refreshIntervalMs]);

  if (!callId) return null;

  const rows = data?.recommended ?? [];
  const noGps = data?.reason === 'NO_CALL_GPS';

  return (
    <div
      className="border p-1.5 space-y-1"
      style={{ background: '#0a0a0a', borderColor: '#222', borderRadius: 2 }}
      data-testid="recommended-units-inline"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Navigation className="w-3 h-3 text-brand-gold-500" />
          <span className="text-[9px] font-bold uppercase tracking-wider text-brand-gold-500">
            Closest Available {limit > rows.length ? `(${rows.length})` : `(top ${limit})`}
          </span>
        </div>
        <button
          type="button"
          onClick={fetchRecommendations}
          aria-label="Refresh recommended units"
          className="text-rmpg-400 hover:text-white"
          title="Refresh"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
        </button>
      </div>

      {err && (
        <div className="text-[9px] text-red-400 px-1">{err}</div>
      )}

      {noGps && (
        <div className="text-[9px] text-rmpg-400 italic px-1">
          Call has no GPS — set lat/lng to enable ranking.
        </div>
      )}

      {!err && !noGps && rows.length === 0 && !loading && (
        <div className="text-[9px] text-rmpg-400 italic px-1">
          No available units with fresh GPS (last 10 min).
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-0.5">
          {rows.map((u) => (
            <button
              key={u.callSign}
              type="button"
              onClick={() => onAssign?.(u.callSign)}
              className="w-full text-left flex items-center gap-1.5 px-1.5 py-1 hover:bg-[#1a1a1a] transition-colors"
              style={{ borderLeft: `2px solid ${statusColor(u.status)}`, borderRadius: 2 }}
              disabled={!onAssign}
              title={onAssign ? `Attach ${u.callSign} to this call` : undefined}
            >
              <span className="text-[10px] font-bold text-white font-mono w-12">
                {u.callSign}
              </span>
              <span className="text-[9px] text-rmpg-300 flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" />
                {u.distanceMiles.toFixed(1)}mi
              </span>
              <span className="text-[9px] text-rmpg-300 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {u.etaMinutes < 1 ? '<1' : Math.round(u.etaMinutes)}m
              </span>
              {u.officerName && (
                <span className="text-[9px] text-rmpg-400 truncate flex-1">
                  {u.badgeNumber ? `#${u.badgeNumber} ` : ''}{u.officerName}
                </span>
              )}
              <span
                className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5"
                style={{ background: statusColor(u.status), color: '#0a0a0a', borderRadius: 2 }}
              >
                {u.status.replace('_', ' ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
