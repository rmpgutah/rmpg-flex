// ============================================================
// CALL HISTORY LOG drawer — the "LOG" overlay on the NAVIGATE screen.
//
// A unit's RUN LOG: the chronological list of calls this unit has been
// dispatched to in a rolling window, with the full status lifecycle
// (received → dispatched → enroute → on-scene → cleared), response /
// on-scene durations, disposition, and distance from the unit now.
//
// This is intentionally SEPARATE from the CFS report (the authoritative
// calls_for_service record). It's an operational activity view derived
// from GET /dispatch/calls (windowed → returns cleared/closed too) and
// filtered to this unit — no new endpoint, no schema change.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  History, X, RefreshCw, Navigation2, MapPin, Clock, CheckCircle2, Timer, Loader2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface RawCall {
  id: number;
  call_number: string;
  incident_type: string;
  secondary_type?: string | null;
  priority: string;
  status: string;
  created_at?: string | null;
  received_at?: string | null;
  dispatched_at?: string | null;
  enroute_at?: string | null;
  onscene_at?: string | null;
  cleared_at?: string | null;
  closed_at?: string | null;
  response_time_seconds?: number | null;
  onscene_duration_seconds?: number | null;
  location_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  disposition?: string | null;
  assigned_unit_ids?: string | null;
  unit_call_signs?: string | null;
}

const PRIO_COLOR: Record<string, string> = { P1: '#ef4444', P2: '#f59e0b', P3: '#d4a017', P4: '#888888' };

const STATUS_COLOR: Record<string, string> = {
  pending: '#888888', open: '#888888', dispatched: '#f59e0b', enroute: '#f59e0b',
  onscene: '#ef4444', cleared: '#22c55e', closed: '#6b7280', cancelled: '#6b7280', archived: '#4b5563',
};

const WINDOWS = [
  { key: '1', label: 'Today', ms: 0 },
  { key: '3', label: '3d', ms: 3 * 86400000 },
  { key: '7', label: '7d', ms: 7 * 86400000 },
  { key: '14', label: '14d', ms: 14 * 86400000 },
] as const;

// Live text columns store literal "None"/"N/A"/"0" rather than NULL — guard so
// we don't render a sentinel as if it were a real disposition.
const SENTINELS = new Set(['', 'none', 'n/a', 'na', '0', '-', 'null', 'undefined', 'unknown']);
function meaningful(v: string | null | undefined): v is string {
  return !!v && !SENTINELS.has(v.trim().toLowerCase());
}

function parseUnitIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch {
    return String(json).split(/[,\s]+/).filter(Boolean);
  }
}

function callBelongsToUnit(c: RawCall, unitId: number | null, callSign: string | null): boolean {
  if (unitId != null && parseUnitIds(c.assigned_unit_ids).includes(String(unitId))) return true;
  if (callSign && c.unit_call_signs) {
    const signs = c.unit_call_signs.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (signs.includes(callSign.trim().toLowerCase())) return true;
  }
  return false;
}

function fmtHM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDurSec(s: number | null | undefined): string | null {
  if (s == null || !Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function toRad(d: number) { return (d * Math.PI) / 180; }
function distMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return (2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)))) / 1609.34;
}

// Response time: prefer the server's computed seconds, else dispatched→onscene.
function responseSec(c: RawCall): number | null {
  if (c.response_time_seconds != null && c.response_time_seconds > 0) return c.response_time_seconds;
  if (c.dispatched_at && c.onscene_at) {
    const d = (Date.parse(c.onscene_at) - Date.parse(c.dispatched_at)) / 1000;
    return Number.isFinite(d) && d > 0 ? d : null;
  }
  return null;
}
function onsceneSec(c: RawCall): number | null {
  if (c.onscene_duration_seconds != null && c.onscene_duration_seconds > 0) return c.onscene_duration_seconds;
  if (c.onscene_at && c.cleared_at) {
    const d = (Date.parse(c.cleared_at) - Date.parse(c.onscene_at)) / 1000;
    return Number.isFinite(d) && d > 0 ? d : null;
  }
  return null;
}

interface Props {
  unitId: number | null;
  unitCallSign: string | null;
  myLat: number | null;
  myLng: number | null;
  onRouteToCall: (lat: number, lng: number, label: string) => void;
  onClose: () => void;
}

export default function CallHistoryDrawer({ unitId, unitCallSign, myLat, myLng, onRouteToCall, onClose }: Props) {
  const [winKey, setWinKey] = useState<string>('7');
  const [calls, setCalls] = useState<RawCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const win = WINDOWS.find((w) => w.key === winKey) ?? WINDOWS[2];
      const start = win.ms === 0 ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(Date.now() - win.ms);
      const startIso = start.toISOString().slice(0, 19).replace('T', ' ');
      const res = await apiFetch<{ data?: RawCall[] } | RawCall[]>(`/dispatch/calls?startDate=${encodeURIComponent(startIso)}&limit=500`);
      const rows = Array.isArray(res) ? res : res?.data ?? [];
      setCalls(rows.filter((c) => callBelongsToUnit(c, unitId, unitCallSign)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, [winKey, unitId, unitCallSign]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const ts = (c: RawCall) => Date.parse(c.dispatched_at || c.created_at || c.received_at || '') || 0;
    return [...calls].sort((a, b) => ts(b) - ts(a));
  }, [calls]);

  const summary = useMemo(() => {
    const byPrio: Record<string, number> = {};
    let respTot = 0, respN = 0, sceneTot = 0;
    for (const c of calls) {
      byPrio[c.priority] = (byPrio[c.priority] || 0) + 1;
      const r = responseSec(c); if (r != null) { respTot += r; respN += 1; }
      const s = onsceneSec(c); if (s != null) sceneTot += s;
    }
    return { count: calls.length, byPrio, avgResp: respN ? respTot / respN : null, sceneTot };
  }, [calls]);

  return (
    <div
      className="absolute z-30 panel-beveled bg-surface-deep/95 backdrop-blur-md border border-rmpg-600 shadow-2xl flex flex-col"
      style={{ top: 44, bottom: 8, left: 8, width: 372, maxWidth: 'calc(100vw - 16px)', borderRadius: 2 }}
    >
      {/* header */}
      <div className="relative flex items-center gap-2 px-3 py-2 border-b border-rmpg-700 shrink-0">
        <div className="absolute bottom-0 inset-x-0 h-px" style={{ background: 'linear-gradient(90deg, #d4a01766, transparent)' }} />
        <History className="w-4 h-4 text-brand-400" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-rmpg-100 flex-1">Call History</span>
        {unitCallSign && <span className="text-[9px] font-mono font-bold text-brand-300">UNIT {unitCallSign}</span>}
        <button onClick={load} className="text-rmpg-500 hover:text-white" aria-label="Refresh call history" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={onClose} className="text-rmpg-500 hover:text-white" aria-label="Close call history"><X className="w-4 h-4" /></button>
      </div>

      {/* window selector + summary */}
      <div className="px-3 py-1.5 border-b border-rmpg-800 shrink-0 space-y-1.5">
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWinKey(w.key)}
              className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border"
              style={{
                borderRadius: 2,
                color: winKey === w.key ? '#0a0a0a' : '#a0a0a0',
                background: winKey === w.key ? '#d4a017' : 'transparent',
                borderColor: winKey === w.key ? '#d4a017' : '#2e2e2e',
              }}
            >
              {w.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] font-mono text-rmpg-400">{summary.count} runs</span>
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono">
          {(['P1', 'P2', 'P3', 'P4'] as const).map((p) =>
            summary.byPrio[p] ? (
              <span key={p} className="flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: PRIO_COLOR[p] }} />
                <span className="text-rmpg-400">{p} {summary.byPrio[p]}</span>
              </span>
            ) : null,
          )}
          <span className="ml-auto flex items-center gap-2 text-rmpg-500">
            {summary.avgResp != null && <span title="Average response time"><Timer className="w-2.5 h-2.5 inline mr-0.5" />{fmtDurSec(summary.avgResp)}</span>}
            {summary.sceneTot > 0 && <span title="Total on-scene time"><Clock className="w-2.5 h-2.5 inline mr-0.5" />{fmtDurSec(summary.sceneTot)}</span>}
          </span>
        </div>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto scrollbar-dark px-2 py-2 space-y-1.5">
        {loading && calls.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-rmpg-500 py-6">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading runs…
          </div>
        )}
        {error && <div className="text-[10px] text-red-400 px-2 py-2">{error}</div>}
        {!loading && !error && sorted.length === 0 && (
          <div className="text-[11px] text-rmpg-600 px-2 py-6 text-center">
            No runs for {unitCallSign ? `unit ${unitCallSign}` : 'this unit'} in this window.
          </div>
        )}

        {sorted.map((c) => {
          const resp = fmtDurSec(responseSec(c));
          const scene = fmtDurSec(onsceneSec(c));
          const d = myLat != null && myLng != null && c.latitude != null && c.longitude != null
            ? distMi(myLat, myLng, c.latitude, c.longitude) : null;
          const stages: { k: string; t: string | null }[] = [
            { k: 'RCV', t: fmtHM(c.received_at || c.created_at) },
            { k: 'DSP', t: fmtHM(c.dispatched_at) },
            { k: 'ENR', t: fmtHM(c.enroute_at) },
            { k: 'O/S', t: fmtHM(c.onscene_at) },
            { k: 'CLR', t: fmtHM(c.cleared_at || c.closed_at) },
          ];
          return (
            <div key={c.id} className="bg-surface-raised/40 border border-rmpg-800 px-2 py-1.5" style={{ borderRadius: 2 }}>
              {/* top line */}
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PRIO_COLOR[c.priority] || '#888' }} />
                <span className="text-[11px] font-mono font-bold text-rmpg-100 shrink-0">{c.call_number}</span>
                <span className="text-[10px] text-rmpg-300 truncate flex-1" title={c.incident_type}>{c.incident_type?.replace(/_/g, ' ')}</span>
                <span className="text-[8px] font-bold uppercase px-1 py-0.5 shrink-0" style={{ borderRadius: 2, color: STATUS_COLOR[c.status] || '#888', background: `${STATUS_COLOR[c.status] || '#888'}22` }}>{c.status}</span>
                <span className="text-[8px] font-mono text-rmpg-600 shrink-0">{fmtDateShort(c.dispatched_at || c.created_at)}</span>
              </div>

              {/* lifecycle timeline */}
              <div className="flex items-center gap-0.5 mt-1.5">
                {stages.map((s, i) => (
                  <div key={s.k} className="flex items-center flex-1 min-w-0">
                    <div className="flex flex-col items-center flex-1 min-w-0">
                      <span className="text-[7px] uppercase tracking-wider leading-none" style={{ color: s.t ? '#d4a017' : '#444' }}>{s.k}</span>
                      <span className="text-[8px] font-mono leading-tight" style={{ color: s.t ? '#bdbdbd' : '#3a3a3a' }}>{s.t || '··'}</span>
                    </div>
                    {i < stages.length - 1 && <div className="h-px w-2 shrink-0" style={{ background: stages[i + 1].t ? '#d4a01755' : '#222' }} />}
                  </div>
                ))}
              </div>

              {/* metrics row */}
              <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-rmpg-500">
                {resp && <span title="Response (dispatch → on-scene)"><Timer className="w-2.5 h-2.5 inline mr-0.5 text-brand-500" />{resp}</span>}
                {scene && <span title="On-scene duration"><Clock className="w-2.5 h-2.5 inline mr-0.5 text-brand-500" />{scene}</span>}
                {meaningful(c.disposition) && (
                  <span className="flex items-center gap-0.5 text-green-400/80" title="Disposition"><CheckCircle2 className="w-2.5 h-2.5" />{c.disposition}</span>
                )}
                {d != null && <span className="ml-auto text-rmpg-500">{d < 0.1 ? `${Math.round(d * 5280)} ft` : `${d.toFixed(1)} mi`}</span>}
              </div>

              {/* location + route action */}
              {(meaningful(c.location_address) || (c.latitude != null && c.longitude != null)) && (
                <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-rmpg-800/60">
                  <MapPin className="w-2.5 h-2.5 text-rmpg-600 shrink-0" />
                  <span className="text-[9px] text-rmpg-400 truncate flex-1" title={c.location_address || ''}>{meaningful(c.location_address) ? c.location_address : 'Mapped location'}</span>
                  {c.latitude != null && c.longitude != null && (
                    <button
                      onClick={() => onRouteToCall(c.latitude!, c.longitude!, `${c.call_number} · ${c.incident_type?.replace(/_/g, ' ')}`)}
                      className="flex items-center gap-0.5 text-[8px] font-bold uppercase px-1 py-0.5 border border-rmpg-700 text-brand-300 hover:border-brand-500 hover:text-white shrink-0"
                      style={{ borderRadius: 2 }}
                      title="Route to this call"
                    >
                      <Navigation2 className="w-2.5 h-2.5" /> Route
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
