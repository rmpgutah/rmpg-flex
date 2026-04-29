// ============================================================
// RMPG Flex — AAR Replay
// ============================================================
// Post-incident review for a single driving_events row. Shows:
//   - Video clip (HTML5 player, range-streamed from server)
//   - Map with the unit's gps_breadcrumbs track in a ±2min
//     window around the event, event location pinned
//   - Sidebar with event metadata, call linkage, evidence chain
//
// Designed for IA review, training, and complaint defense — the
// kind of "show me what happened" workflow no commercial dashcam
// vendor can do because they don't know our CAD context.
// ============================================================

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Camera, Clock, FileText, MapPin, Shield, AlertTriangle,
  Activity, Cpu, Hash, Video,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import AarReplayMap from '../components/AarReplayMap';
import { apiFetch, authedImageUrl } from '../hooks/useApi';

interface DrivingEventDetail {
  id: number;
  source: string;
  source_event_id: string | null;
  device_id: string | null;
  unit_id: number | null;
  officer_id: number | null;
  event_type: string;
  severity: string;
  event_timestamp: string;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  speed_mph: number | null;
  address: string | null;
  call_id: number | null;
  call_number: string | null;
  call_type: string | null;
  has_video: number;
  clip_object_key: string | null;
  duration_sec: number | null;
  model_version: string | null;
  confidence: number | null;
  raw_json: string | null;
  call_sign: string | null;
  officer_name: string | null;
  badge_number: string | null;
}

interface EvidenceRow {
  id: number;
  artifact_type: string;
  artifact_id: number;
  sha256: string;
  size_bytes: number | null;
  storage_uri: string | null;
  captured_at: string;
  hashed_at: string;
  signer: string | null;
  prev_hash_id: number | null;
}

interface ChainAudit {
  ok: boolean;
  checked: number;
  broken_at_id: number | null;
}

interface DetailResponse {
  event: DrivingEventDetail;
  evidence: EvidenceRow[];
  chain_audit: ChainAudit | null;
}

interface Breadcrumb {
  id: number;
  recorded_at: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  gps_source: string | null;
  road_name: string | null;
  unit_status: string | null;
}

interface BreadcrumbsResponse {
  event_id: number;
  unit_id: number;
  from: string;
  to: string;
  breadcrumbs: Breadcrumb[];
}

const SEVERITY_BADGE: Record<string, string> = {
  info:     'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/40',
  warning:  'bg-amber-900/50 text-amber-300 border-amber-700/40',
  alert:    'bg-orange-900/60 text-orange-300 border-orange-700/40',
  critical: 'bg-red-900/70 text-red-200 border-red-600/50',
};

function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s.includes('T') ? s : s.replace(' ', 'T')).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return s; }
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function AarReplayPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);

    Promise.all([
      apiFetch<DetailResponse>(`/api/driving-events/${id}`),
      apiFetch<BreadcrumbsResponse>(`/api/driving-events/${id}/breadcrumbs?pad=120`).catch(e => {
        // Breadcrumbs optional — event detail still useful without
        console.warn('[AarReplay] breadcrumbs unavailable', e);
        return { breadcrumbs: [] } as any;
      }),
    ])
      .then(([d, b]) => {
        if (cancelled) return;
        setDetail(d);
        setBreadcrumbs(b.breadcrumbs ?? []);
      })
      .catch(e => {
        if (cancelled) return;
        setErr(e?.message ?? String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id]);

  const ev = detail?.event;
  const clipUrl = useMemo(() => {
    if (!ev?.has_video) return null;
    // authedImageUrl appends ?token=<jwt> for /api/* paths so the
    // <video> tag (which can't set Authorization) still authenticates.
    return authedImageUrl(`/api/driving-events/${ev.id}/clip`);
  }, [ev]);

  // Compute path-bounds for the breadcrumb track (used by static map URL).
  const trackBounds = useMemo(() => {
    if (breadcrumbs.length === 0) {
      if (ev?.latitude != null && ev.longitude != null) {
        return { lat: ev.latitude, lng: ev.longitude, count: 0 };
      }
      return null;
    }
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const b of breadcrumbs) {
      if (b.latitude < minLat) minLat = b.latitude;
      if (b.latitude > maxLat) maxLat = b.latitude;
      if (b.longitude < minLng) minLng = b.longitude;
      if (b.longitude > maxLng) maxLng = b.longitude;
    }
    return {
      minLat, maxLat, minLng, maxLng,
      lat: (minLat + maxLat) / 2,
      lng: (minLng + maxLng) / 2,
      count: breadcrumbs.length,
    };
  }, [breadcrumbs, ev]);

  // Find breadcrumb closest to the current video time. Lets the
  // sidebar show "where the unit was" as the clip plays.
  const [currentBreadcrumb, setCurrentBreadcrumb] = useState<Breadcrumb | null>(null);
  const onTimeUpdate = useCallback(() => {
    if (!videoRef.current || !ev || breadcrumbs.length === 0) return;
    const eventStartMs = new Date(ev.event_timestamp.replace(' ', 'T')).getTime();
    const nowMs = eventStartMs + videoRef.current.currentTime * 1000;
    let best = breadcrumbs[0];
    let bestDelta = Math.abs(new Date(best.recorded_at.replace(' ', 'T')).getTime() - nowMs);
    for (const b of breadcrumbs) {
      const delta = Math.abs(new Date(b.recorded_at.replace(' ', 'T')).getTime() - nowMs);
      if (delta < bestDelta) { best = b; bestDelta = delta; }
    }
    setCurrentBreadcrumb(best);
  }, [breadcrumbs, ev]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-rmpg-500 text-sm">
        Loading event #{id}…
      </div>
    );
  }

  if (err || !ev) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertTriangle className="w-8 h-8 text-amber-500 mb-3" aria-hidden="true" />
        <div className="text-amber-300 mb-2">Failed to load event #{id}</div>
        <div className="text-rmpg-500 text-[11px] mb-4">{err ?? 'Unknown error'}</div>
        <button
          onClick={() => navigate('/dashcam-ai')}
          className="px-3 py-1.5 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] text-[11px] inline-flex items-center gap-1"
          type="button"
        >
          <ArrowLeft className="w-3 h-3" aria-hidden="true" /> Back to Console
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-base text-rmpg-100">
      <PanelTitleBar icon={Video} title={`AAR Replay — Event #${ev.id}`}>
        <button
          onClick={() => navigate('/dashcam-ai')}
          className="px-2 py-1 border border-[#222] hover:border-[#d4a017] hover:text-[#d4a017] text-[11px] inline-flex items-center gap-1"
          type="button"
          aria-label="Back to Dashcam AI Console"
        >
          <ArrowLeft className="w-3 h-3" aria-hidden="true" /> Console
        </button>
      </PanelTitleBar>

      <div className="flex flex-1 overflow-hidden">
        {/* Main: video + track panel */}
        <div className="flex-1 flex flex-col overflow-auto bg-surface-sunken">
          {/* Video player */}
          <div className="border-b border-[#222] bg-black flex items-center justify-center min-h-[300px]">
            {clipUrl ? (
              <video
                ref={videoRef}
                src={clipUrl}
                controls
                preload="metadata"
                onTimeUpdate={onTimeUpdate}
                className="max-w-full max-h-[60vh]"
              />
            ) : (
              <div className="text-rmpg-500 text-[12px] py-12">
                No video clip for this event.
              </div>
            )}
          </div>

          {/* Live map embed — Google Maps + breadcrumb polyline +
              event pivot marker + green "@ scrub" cursor that
              follows the video time. */}
          <div className="border-b border-[#222]" style={{ height: 360 }}>
            <AarReplayMap
              pivot={ev.latitude != null && ev.longitude != null ? { lat: ev.latitude, lng: ev.longitude } : null}
              breadcrumbs={breadcrumbs}
              scrubLat={currentBreadcrumb?.latitude ?? null}
              scrubLng={currentBreadcrumb?.longitude ?? null}
            />
          </div>

          {/* Track summary */}
          <div className="p-3 border-b border-[#222]">
            <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold mb-1.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" aria-hidden="true" /> GPS track
            </div>
            {trackBounds == null ? (
              <div className="text-[11px] text-rmpg-500 italic">No location data for this event.</div>
            ) : (
              <div className="text-[11px] text-rmpg-300">
                <div>
                  <span className="text-rmpg-500">Pivot:</span>{' '}
                  <span className="font-mono">
                    {ev.latitude?.toFixed(6) ?? '—'}, {ev.longitude?.toFixed(6) ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-rmpg-500">Breadcrumbs in window:</span>{' '}
                  <span className="font-mono">{trackBounds.count}</span>
                </div>
                {breadcrumbs.length > 0 && (
                  <>
                    <div>
                      <span className="text-rmpg-500">Window:</span>{' '}
                      <span className="font-mono">
                        {formatDate(breadcrumbs[0].recorded_at)} → {formatDate(breadcrumbs[breadcrumbs.length - 1].recorded_at)}
                      </span>
                    </div>
                    {currentBreadcrumb && (
                      <div className="mt-2 p-2 border border-[#d4a017]/40 bg-[#d4a017]/10 font-mono text-[10px]">
                        <span className="text-[#d4a017]">@ scrub:</span>{' '}
                        {currentBreadcrumb.latitude.toFixed(6)}, {currentBreadcrumb.longitude.toFixed(6)}{' '}
                        — {currentBreadcrumb.speed != null ? `${(currentBreadcrumb.speed * 2.23694).toFixed(0)} mph` : '— mph'}{' '}
                        {currentBreadcrumb.road_name && <>on {currentBreadcrumb.road_name}</>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Inline track listing — sortable later if useful */}
            {breadcrumbs.length > 0 && (
              <details className="mt-3">
                <summary className="text-[10px] uppercase tracking-wider text-rmpg-500 cursor-pointer hover:text-[#d4a017]">
                  Show all {breadcrumbs.length} points
                </summary>
                <div className="mt-2 max-h-[200px] overflow-auto border border-[#222]">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="bg-surface-raised text-rmpg-400">
                      <tr>
                        <th className="text-left py-1 px-2">Time</th>
                        <th className="text-left py-1 px-2">Lat</th>
                        <th className="text-left py-1 px-2">Lng</th>
                        <th className="text-left py-1 px-2">Speed</th>
                        <th className="text-left py-1 px-2">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breadcrumbs.map(b => (
                        <tr key={b.id} className="border-b border-[#1a1a1a]">
                          <td className="py-0.5 px-2 text-rmpg-300">{b.recorded_at.slice(11, 19)}</td>
                          <td className="py-0.5 px-2 text-rmpg-300">{b.latitude.toFixed(5)}</td>
                          <td className="py-0.5 px-2 text-rmpg-300">{b.longitude.toFixed(5)}</td>
                          <td className="py-0.5 px-2 text-rmpg-300">{b.speed != null ? `${(b.speed * 2.23694).toFixed(0)}` : '—'}</td>
                          <td className="py-0.5 px-2 text-rmpg-500">{b.gps_source ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        </div>

        {/* Sidebar: event + evidence */}
        <aside className="w-[360px] border-l border-[#222] bg-surface-raised overflow-auto">
          <div className="p-3 border-b border-[#222]">
            <div className="text-[10px] uppercase tracking-wider text-rmpg-500">Event</div>
            <div className="text-base font-mono text-[#d4a017] mt-0.5">{ev.event_type}</div>
            <div className="text-[11px] text-rmpg-300 mt-0.5 flex items-center gap-2">
              <span>{formatDate(ev.event_timestamp)}</span>
              <span className={`inline-block px-1.5 py-0.5 text-[9px] font-mono uppercase border ${SEVERITY_BADGE[ev.severity] ?? SEVERITY_BADGE.info}`}>
                {ev.severity}
              </span>
            </div>
          </div>

          <div className="p-3 space-y-2 text-[11px] border-b border-[#222]">
            <DetailRow icon={Shield}    label="Source"    value={ev.source} />
            <DetailRow icon={MapPin}    label="Unit"      value={`${ev.call_sign ?? `unit-${ev.unit_id}`}${ev.officer_name ? ` / ${ev.officer_name}` : ''}`} />
            {ev.confidence != null && <DetailRow icon={Cpu} label="AI confidence" value={`${(ev.confidence * 100).toFixed(1)}%`} />}
            {ev.model_version && <DetailRow icon={Cpu} label="Model" value={ev.model_version} />}
            {ev.duration_sec != null && <DetailRow icon={Clock} label="Duration" value={`${ev.duration_sec}s`} />}
            {ev.address && <DetailRow icon={MapPin} label="Address" value={ev.address} />}
            {ev.speed_mph != null && <DetailRow icon={Activity} label="Speed at event" value={`${ev.speed_mph.toFixed(1)} mph`} />}
            {ev.call_number && (
              <DetailRow
                icon={FileText}
                label="Linked call"
                value={`${ev.call_number}${ev.call_type ? ` (${ev.call_type})` : ''}`}
              />
            )}
          </div>

          {/* Evidence chain */}
          {detail!.evidence.length > 0 && (
            <div className="p-3 border-b border-[#222]">
              <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold mb-1.5 flex items-center gap-1">
                <Hash className="w-3 h-3" aria-hidden="true" /> Evidence chain
                {detail!.chain_audit && (
                  <span className={`ml-auto px-1.5 py-0.5 text-[9px] font-mono border ${detail!.chain_audit.ok ? 'border-green-700 text-green-400' : 'border-red-700 text-red-400'}`}>
                    {detail!.chain_audit.ok ? `OK (${detail!.chain_audit.checked})` : 'BROKEN'}
                  </span>
                )}
              </div>
              {detail!.evidence.map(e => (
                <div key={e.id} className="text-[10px] font-mono mb-2">
                  <div className="text-rmpg-500">#{e.id} • {formatBytes(e.size_bytes)} • {formatDate(e.hashed_at)}</div>
                  <div className="text-rmpg-300 break-all">SHA-256 {e.sha256}</div>
                  {e.prev_hash_id && <div className="text-rmpg-500">prev: #{e.prev_hash_id}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Raw vendor payload (forensic) */}
          {ev.raw_json && (
            <details className="p-3">
              <summary className="text-[10px] uppercase tracking-wider text-rmpg-500 cursor-pointer hover:text-[#d4a017]">
                Vendor raw payload
              </summary>
              <pre className="mt-2 text-[9px] font-mono text-rmpg-400 bg-surface-sunken p-2 overflow-auto max-h-[300px]">
                {(() => {
                  try { return JSON.stringify(JSON.parse(ev.raw_json), null, 2); }
                  catch { return ev.raw_json; }
                })()}
              </pre>
            </details>
          )}
        </aside>
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
        <div className="text-rmpg-200 font-mono break-words">{value}</div>
      </div>
    </div>
  );
}
