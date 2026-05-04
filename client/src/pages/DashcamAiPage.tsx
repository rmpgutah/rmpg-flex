// ============================================================
// RMPG Flex — Dashcam AI Console
// ============================================================
// Source-agnostic browse over driving_events: ClearPathGPS,
// Traccar, Freematics, and Flex Dashcam AI all surface here in
// a single normalized view. Top strip is fleet-health LEDs;
// main grid is filtered events; right pane shows detail + clip
// + evidence-chain audit when a row is selected.
//
// Designed to work with the simulator output as well as real
// data — `flex-edge simulate --unit-ids 12,7,3 --rate 1` will
// fill this page within seconds.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Camera,
  Cpu,
  Filter,
  MapPin,
  PlayCircle,
  RefreshCw,
  Shield,
  Signal,
  Video,
  Zap,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import usePersistedState from '../hooks/usePersistedState';
import useLiveSync from '../hooks/useLiveSync';

// ── Types ───────────────────────────────────────────────────

interface DrivingEvent {
  id: number;
  source: 'clearpathgps' | 'traccar' | 'freematics' | 'flex_ai' | 'manual';
  source_event_id: string | null;
  device_id: string | null;
  unit_id: number | null;
  officer_id: number | null;
  event_type: string;
  severity: 'info' | 'warning' | 'alert' | 'critical';
  event_timestamp: string;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  speed_mph: number | null;
  address: string | null;
  call_id: number | null;
  incident_id: number | null;
  beat_code: string | null;
  has_video: number;
  video_url: string | null;
  clip_object_key: string | null;
  duration_sec: number | null;
  model_version: string | null;
  confidence: number | null;
  created_at: string;
  call_sign: string | null;
  unit_status: string | null;
  officer_name: string | null;
  badge_number: string | null;
  call_number: string | null;
}

interface FleetHealthRow {
  id: number;
  unit_id: number;
  device_id: string | null;
  device_kind: string | null;
  last_heartbeat_at: string | null;
  firmware_version: string | null;
  model_version: string | null;
  gpu_temp_c: number | null;
  cpu_temp_c: number | null;
  disk_used_pct: number | null;
  ram_used_pct: number | null;
  network_status: string | null;
  lte_rssi_dbm: number | null;
  uptime_sec: number | null;
  call_sign: string | null;
  officer_name: string | null;
  status: 'healthy' | 'stale' | 'down';
}

interface EventListResponse {
  events: DrivingEvent[];
  total: number;
  limit: number;
  offset: number;
}

// ── Style helpers (Spillman black theme) ────────────────────

const SOURCE_BADGE: Record<string, string> = {
  clearpathgps: 'bg-green-900/40 text-green-300 border-green-700/40',
  traccar:      'bg-cyan-900/40  text-cyan-300  border-cyan-700/40',
  freematics:   'bg-purple-900/40 text-purple-300 border-purple-700/40',
  flex_ai:      'bg-amber-900/40 text-amber-300 border-amber-700/40',
  manual:       'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/40',
};

const SEVERITY_BADGE: Record<string, string> = {
  info:     'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/40',
  warning:  'bg-amber-900/50 text-amber-300 border-amber-700/40',
  alert:    'bg-orange-900/60 text-orange-300 border-orange-700/40',
  critical: 'bg-red-900/70 text-red-200 border-red-600/50',
};

const HEALTH_LED: Record<string, string> = {
  healthy: 'bg-green-500 shadow-[0_0_6px_2px_rgba(34,197,94,0.6)]',
  stale:   'bg-amber-500 shadow-[0_0_6px_2px_rgba(245,158,11,0.5)]',
  down:    'bg-red-600 shadow-[0_0_6px_2px_rgba(220,38,38,0.5)]',
};

function formatLocalDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s.includes('T') ? s : s.replace(' ', 'T')).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return s; }
}

function formatRelative(s: string | null): string {
  if (!s) return '—';
  const ms = Date.now() - new Date(s.includes('T') ? s : s.replace(' ', 'T')).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

// ── Page ────────────────────────────────────────────────────

export default function DashcamAiPage(): React.ReactElement {
  const navigate = useNavigate();
  const [events, setEvents] = useState<DrivingEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fleet, setFleet] = useState<FleetHealthRow[]>([]);
  const [selected, setSelected] = useState<DrivingEvent | null>(null);

  const [filters, setFilters] = usePersistedState('rmpg_dashcam_ai_filters', {
    source: '',
    severity: '',
    event_type: '',
    has_video: '',
  });

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.source)     p.set('source', filters.source);
    if (filters.severity)   p.set('severity', filters.severity);
    if (filters.event_type) p.set('event_type', filters.event_type);
    if (filters.has_video)  p.set('has_video', filters.has_video);
    p.set('limit', '200');
    return p.toString();
  }, [filters]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, fleetRes] = await Promise.all([
        apiFetch<EventListResponse>(`/api/driving-events?${queryString}`),
        apiFetch<{ units: FleetHealthRow[] }>(`/api/driving-events/fleet-health`),
      ]);
      setEvents(evRes.events);
      setTotal(evRes.total);
      setFleet(fleetRes.units);
    } catch (err) {
      console.error('[DashcamAiPage] refresh failed', err);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    refresh();
    // Background safety net — even if the WebSocket drops, we still
    // pick up changes within 30s. The interval is longer now that
    // useLiveSync handles the common case at sub-second latency.
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Live push: server broadcasts data_changed{module:'dashcam-ai'}
  // on every event ingest + heartbeat. useLiveSync filters and
  // debounces (500ms default) so a burst of heartbeats from a
  // 15-cruiser fleet doesn't trigger 15 simultaneous refreshes.
  useLiveSync('dashcam-ai', refresh, { entities: ['event', 'heartbeat'] });

  const totalsByStatus = useMemo(() => {
    const acc = { healthy: 0, stale: 0, down: 0 };
    for (const u of fleet) acc[u.status]++;
    return acc;
  }, [fleet]);

  return (
    <div className="flex flex-col h-full bg-surface-base text-rmpg-100">
      <PanelTitleBar icon={Cpu} title="Dashcam AI Console">
        <div className="flex items-center gap-3 text-[11px] text-rmpg-400">
          <span className="inline-flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-full ${HEALTH_LED.healthy}`} />
            {totalsByStatus.healthy}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-full ${HEALTH_LED.stale}`} />
            {totalsByStatus.stale}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-full ${HEALTH_LED.down}`} />
            {totalsByStatus.down}
          </span>
          <button
            onClick={refresh}
            disabled={loading}
            className="ml-2 inline-flex items-center gap-1 px-2 py-1 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] disabled:opacity-50 transition-colors"
            type="button"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </PanelTitleBar>

      {/* Fleet health LED strip */}
      <div className="px-3 py-2 border-b border-[#222] bg-surface-sunken">
        <div className="flex items-center gap-2 mb-1.5 text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold">
          <Activity className="w-3 h-3" aria-hidden="true" /> Fleet health
        </div>
        {fleet.length === 0 ? (
          <div className="text-[11px] text-rmpg-500 italic">
            No edge devices reporting yet. Configure DASHCAM_FORWARD_SECRET on the server,
            then run <code className="text-[#d4a017]">flex-edge heartbeat</code> from a unit.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {fleet.map(u => (
              <div
                key={u.id}
                title={`${u.call_sign ?? `unit-${u.unit_id}`} — ${u.status} — last: ${formatRelative(u.last_heartbeat_at)}`}
                className="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-raised border border-[#222] text-[10px]"
              >
                <span className={`inline-block w-2 h-2 rounded-full ${HEALTH_LED[u.status]}`} aria-hidden="true" />
                <span className="font-mono">{u.call_sign ?? `U${u.unit_id}`}</span>
                {u.gpu_temp_c != null && <span className="text-rmpg-500">{u.gpu_temp_c.toFixed(0)}°C</span>}
                {u.network_status === 'degraded' && <Signal className="w-3 h-3 text-amber-400" aria-hidden="true" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="px-3 py-2 border-b border-[#222] bg-surface-base flex flex-wrap items-center gap-2 text-[11px]">
        <Filter className="w-3 h-3 text-rmpg-500" aria-hidden="true" />
        <select
          value={filters.source}
          onChange={e => setFilters({ ...filters, source: e.target.value })}
          className="bg-surface-sunken border border-[#222] px-2 py-1 text-rmpg-200"
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          <option value="flex_ai">Flex Dashcam AI</option>
          <option value="clearpathgps">ClearPathGPS</option>
          <option value="traccar">Traccar</option>
          <option value="freematics">Freematics</option>
          <option value="manual">Manual</option>
        </select>
        <select
          value={filters.severity}
          onChange={e => setFilters({ ...filters, severity: e.target.value })}
          className="bg-surface-sunken border border-[#222] px-2 py-1 text-rmpg-200"
          aria-label="Filter by severity"
        >
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="alert">Alert</option>
          <option value="critical">Critical</option>
        </select>
        <select
          value={filters.event_type}
          onChange={e => setFilters({ ...filters, event_type: e.target.value })}
          className="bg-surface-sunken border border-[#222] px-2 py-1 text-rmpg-200"
          aria-label="Filter by event type"
        >
          <option value="">All types</option>
          <option value="hard_brake">Hard brake</option>
          <option value="hard_accel">Hard accel</option>
          <option value="hard_turn">Hard turn</option>
          <option value="fcw">FCW</option>
          <option value="ldw">LDW</option>
          <option value="tailgate">Tailgate</option>
          <option value="drowsy">Drowsy</option>
          <option value="distracted">Distracted</option>
          <option value="speeding">Speeding</option>
          <option value="impact">Impact</option>
          <option value="sos">SOS</option>
          <option value="ignition_on">Ignition on</option>
          <option value="ignition_off">Ignition off</option>
          <option value="custom">Custom</option>
        </select>
        <select
          value={filters.has_video}
          onChange={e => setFilters({ ...filters, has_video: e.target.value })}
          className="bg-surface-sunken border border-[#222] px-2 py-1 text-rmpg-200"
          aria-label="Filter by video presence"
        >
          <option value="">With or without video</option>
          <option value="1">With video</option>
          <option value="0">No video</option>
        </select>
        <span className="ml-auto text-rmpg-500">
          {events.length} of {total.toLocaleString()} events
        </span>
      </div>

      {/* Main content: list (left) + detail (right) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Events table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-surface-raised border-b border-[#222] text-[10px] uppercase tracking-wider text-rmpg-400">
              <tr>
                <th className="text-left py-1.5 px-2 font-semibold">Time</th>
                <th className="text-left py-1.5 px-2 font-semibold">Unit</th>
                <th className="text-left py-1.5 px-2 font-semibold">Source</th>
                <th className="text-left py-1.5 px-2 font-semibold">Type</th>
                <th className="text-left py-1.5 px-2 font-semibold">Severity</th>
                <th className="text-left py-1.5 px-2 font-semibold">Speed</th>
                <th className="text-left py-1.5 px-2 font-semibold">Location</th>
                <th className="text-left py-1.5 px-2 font-semibold">Call</th>
                <th className="text-center py-1.5 px-2 font-semibold w-8"><Video className="w-3 h-3 inline" aria-hidden="true" /></th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-rmpg-500 italic">
                    No events match the current filters.
                    <div className="mt-2 text-[10px]">
                      Try <code className="text-[#d4a017]">flex-edge simulate --unit-ids 1,2,3 --rate 1</code> to populate test data.
                    </div>
                  </td>
                </tr>
              )}
              {events.map(ev => (
                <tr
                  key={ev.id}
                  onClick={() => setSelected(ev)}
                  className={`border-b border-[#1a1a1a] cursor-pointer hover:bg-surface-raised transition-colors ${selected?.id === ev.id ? 'bg-[#1a2030]' : ''}`}
                >
                  <td className="py-1 px-2 font-mono text-rmpg-300">{formatLocalDate(ev.event_timestamp)}</td>
                  <td className="py-1 px-2">
                    <span className="font-mono text-[#d4a017]">{ev.call_sign ?? `U${ev.unit_id ?? '?'}`}</span>
                    {ev.officer_name && <span className="text-rmpg-500 ml-1">/ {ev.officer_name}</span>}
                  </td>
                  <td className="py-1 px-2">
                    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono uppercase border ${SOURCE_BADGE[ev.source] ?? SOURCE_BADGE.manual}`}>
                      {ev.source}
                    </span>
                  </td>
                  <td className="py-1 px-2 font-mono">{ev.event_type}</td>
                  <td className="py-1 px-2">
                    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono uppercase border ${SEVERITY_BADGE[ev.severity] ?? SEVERITY_BADGE.info}`}>
                      {ev.severity}
                    </span>
                  </td>
                  <td className="py-1 px-2 font-mono text-rmpg-300">
                    {ev.speed_mph != null ? `${ev.speed_mph.toFixed(0)} mph` : '—'}
                  </td>
                  <td className="py-1 px-2 text-rmpg-400 truncate max-w-[200px]" title={ev.address ?? ''}>
                    {ev.address ?? (ev.latitude != null ? `${ev.latitude.toFixed(4)}, ${ev.longitude?.toFixed(4)}` : '—')}
                  </td>
                  <td className="py-1 px-2 font-mono text-rmpg-300">{ev.call_number ?? '—'}</td>
                  <td className="py-1 px-2 text-center">
                    {ev.has_video ? <Video className="w-3 h-3 text-[#d4a017] inline" aria-hidden="true" /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail pane (right) */}
        {selected && (
          <aside className="w-[420px] border-l border-[#222] bg-surface-raised overflow-auto">
            <div className="p-3 border-b border-[#222] flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-rmpg-500">Event #{selected.id}</div>
                <div className="text-base font-mono text-[#d4a017] mt-0.5">{selected.event_type}</div>
                <div className="text-[11px] text-rmpg-300 mt-0.5">{formatLocalDate(selected.event_timestamp)}</div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-rmpg-500 hover:text-[#d4a017] text-xl leading-none"
                type="button"
                aria-label="Close detail"
              >×</button>
            </div>
            <div className="px-3 pt-3">
              <button
                onClick={() => navigate(`/dashcam-ai/${selected.id}`)}
                className="w-full px-3 py-2 border border-[#d4a017] text-[#d4a017] hover:bg-[#d4a017] hover:text-black transition-colors text-[11px] uppercase tracking-wider font-semibold inline-flex items-center justify-center gap-2"
                type="button"
                aria-label="Open AAR replay for this event"
              >
                <PlayCircle className="w-4 h-4" aria-hidden="true" />
                AAR Replay
              </button>
            </div>
            <div className="p-3 space-y-2 text-[11px]">
              <DetailRow icon={Shield} label="Source"   value={selected.source} />
              <DetailRow icon={AlertTriangle} label="Severity" value={selected.severity} />
              <DetailRow icon={MapPin} label="Unit" value={`${selected.call_sign ?? `unit-${selected.unit_id}`}${selected.officer_name ? ` / ${selected.officer_name}` : ''}`} />
              {selected.confidence != null && (
                <DetailRow icon={Cpu} label="Confidence" value={`${(selected.confidence * 100).toFixed(1)}%`} />
              )}
              {selected.model_version && (
                <DetailRow icon={Cpu} label="Model" value={selected.model_version} />
              )}
              {selected.call_number && (
                <DetailRow icon={Zap} label="Call" value={selected.call_number} />
              )}
              {selected.address && (
                <DetailRow icon={MapPin} label="Address" value={selected.address} />
              )}
              {selected.latitude != null && (
                <DetailRow icon={MapPin} label="Coords" value={`${selected.latitude.toFixed(6)}, ${selected.longitude?.toFixed(6)}`} />
              )}
              {selected.speed_mph != null && (
                <DetailRow icon={Activity} label="Speed" value={`${selected.speed_mph.toFixed(1)} mph`} />
              )}
              {selected.has_video ? (
                <div className="mt-3 pt-3 border-t border-[#222]">
                  <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold mb-1.5 flex items-center gap-1">
                    <Camera className="w-3 h-3" aria-hidden="true" /> Video evidence
                  </div>
                  <div className="text-rmpg-300 text-[10px] font-mono break-all">
                    {selected.clip_object_key ?? selected.video_url ?? '—'}
                  </div>
                  {selected.clip_object_key?.startsWith('file://') && (
                    <div className="mt-2 text-[10px] text-rmpg-500 italic">
                      File-system storage. Download via prosecutor-export tool (Phase 4).
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3 h-3 text-rmpg-500 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <div className="text-[9px] uppercase tracking-wider text-rmpg-500">{label}</div>
        <div className="text-rmpg-200 font-mono">{value}</div>
      </div>
    </div>
  );
}
