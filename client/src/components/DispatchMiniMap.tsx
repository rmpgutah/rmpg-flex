// ============================================================
// RMPG Flex — Dispatch Mini-Map
// Lightweight embeddable Mapbox GL panel showing the selected
// call location and assigned unit positions. Used inline in the
// Dispatch right column.
// ============================================================

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Maximize2, MapPin, Navigation, Wifi } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { createMapboxMap, addMapboxTrail, removeMapboxTrail, injectMapboxStyles } from '../utils/mapboxLoader';
import { getMapboxToken } from '../utils/mapboxApiKey';
import { UNIT_STATUS_HEX, PRIORITY_HEX } from '../utils/statusColors';
import type { CallForService, Unit, UnitStatus } from '../types';

/** Priority color mapping — uses shared PRIORITY_HEX tokens */
const MINI_PRIORITY_COLORS: Record<string, string> = PRIORITY_HEX;

interface DispatchMiniMapProps {
  call: CallForService | null;
  units: Unit[];
  onClose?: () => void;
  /** When true, fills parent container height instead of fixed 180px */
  fullHeight?: boolean;
  /** Called when route ETA changes (for parent to display inline) */
  onRouteUpdate?: (info: { unitCallSign: string; callNumber: string; eta: string; distance: string } | null) => void;
  /** Serve route jobs to overlay on the mini map (for PSO calls) */
  serveRouteJobs?: any[];
  /** Serve route polyline data (optimized_order_json from serve_routes) */
  serveRouteOrder?: number[] | null;
}

/** Active route info returned by inline routing */
interface ActiveRouteInfo {
  unitCallSign: string;
  callNumber: string;
  eta: string;
  distance: string;
}

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608]; // [lng, lat]
const MINI_ZOOM = 15;
const ROUTE_TRAIL_ID = 'dispatch-minimap-route';
const SERVE_TRAIL_ID = 'dispatch-minimap-serve-route';

/** Format seconds into a human-readable ETA */
function formatEta(seconds: number): string {
  if (seconds < 60) return '<1 min';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

/** Format meters into a human-readable distance */
function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${Math.round(meters)} ft` : `${miles.toFixed(1)} mi`;
}

/** Build a call marker DOM element with priority-colored badge */
function buildCallMarker(label: string, priority?: string): HTMLElement {
  const color = MINI_PRIORITY_COLORS[priority || ''] || '#ef4444';
  const isP1 = priority === 'P1';
  const isP2 = priority === 'P2';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6));';

  // Priority pulse animation for P1/P2
  if (isP1 || isP2) {
    wrapper.style.animation = isP1 ? 'minimap-pulse 1.2s ease-in-out infinite' : 'minimap-pulse 2.5s ease-in-out infinite';
  }

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:7px;font-weight:900;` +
    "padding:2px 4px;border:1.5px solid rgba(255,255,255,0.9);white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.03em;" +
    `box-shadow:0 0 8px ${color}50, inset 0 1px 0 rgba(255,255,255,0.15);display:flex;align-items:center;gap:3px;border-radius:1px;`;

  // Priority badge
  if (priority) {
    const priBadge = document.createElement('span');
    priBadge.style.cssText = 'font-size:6px;opacity:0.85;letter-spacing:0.5px;';
    priBadge.textContent = priority;
    tag.appendChild(priBadge);

    const sep = document.createElement('span');
    sep.style.cssText = 'opacity:0.4;font-size:5px;';
    sep.textContent = '\u00b7';
    tag.appendChild(sep);
  }

  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  tag.appendChild(labelSpan);

  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${color};`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

/** Build a unit marker DOM element with status-colored indicator */
function buildUnitMarker(callSign: string, status?: UnitStatus): HTMLElement {
  const color = UNIT_STATUS_HEX[status || 'available'] || '#888888';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.5));';

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:8px;font-weight:900;` +
    "padding:2px 5px;border:1.5px solid rgba(255,255,255,0.8);white-space:nowrap;font-family:'JetBrains Mono',monospace;border-radius:1px;" +
    `box-shadow:0 0 6px ${color}40, inset 0 1px 0 rgba(255,255,255,0.12);display:flex;align-items:center;gap:2px;`;

  const csSpan = document.createElement('span');
  csSpan.textContent = callSign;
  tag.appendChild(csSpan);

  // Tiny caret pointing down
  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid ${color};`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

/** Inject minimap-specific keyframe animation (idempotent) */
function injectMinimapKeyframes() {
  if (document.getElementById('minimap-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'minimap-keyframes';
  style.textContent = `
    @keyframes minimap-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.9; } }
  `;
  document.head.appendChild(style);
}

export default function DispatchMiniMap({ call, units, onClose, fullHeight, onRouteUpdate, serveRouteJobs, serveRouteOrder }: DispatchMiniMapProps) {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const serveMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const tokenRef = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapBearing, setMapBearing] = useState(0);

  // Inline routing state (replaces useMapRouting)
  const [activeRoute, setActiveRoute] = useState<ActiveRouteInfo | null>(null);
  const lastAutoRouteRef = useRef<string>('');

  // Inject keyframes + Mapbox styles on mount
  useEffect(() => { injectMinimapKeyframes(); injectMapboxStyles(); }, []);

  const visibleUnitCount = useMemo(() =>
    units.filter(u =>
      call?.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null
    ).length,
    [units, call?.assigned_units],
  );

  const isAuthError = error != null;

  // ── Inline routing functions ──

  const clearRoute = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      try { removeMapboxTrail(map, ROUTE_TRAIL_ID); } catch { /* layer may not exist */ }
    }
    setActiveRoute(null);
    lastAutoRouteRef.current = '';
  }, []);

  const showRoute = useCallback(async (
    unitCallSign: string, callNumber: string,
    originLat: number, originLng: number,
    destLat: number, destLng: number,
  ) => {
    const map = mapRef.current;
    const token = tokenRef.current;
    if (!map || !token) return;

    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destLng},${destLat}?access_token=${token}&geometries=geojson&overview=full`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      const route = data.routes?.[0];
      if (!route) return;

      const coords: [number, number][] = route.geometry.coordinates;
      // Remove old route trail then add new one
      try { removeMapboxTrail(map, ROUTE_TRAIL_ID); } catch { /* ok */ }
      addMapboxTrail(map, ROUTE_TRAIL_ID, coords, '#22c55e', 3);

      setActiveRoute({
        unitCallSign,
        callNumber,
        eta: formatEta(route.duration),
        distance: formatDistance(route.distance),
      });
    } catch {
      // Routing fetch failed — silently ignore
    }
  }, []);

  const updateOrigin = useCallback(async (lat: number, lng: number) => {
    // Re-fetch route with new origin keeping same destination from call
    if (!call?.latitude || !call?.longitude) return;
    const map = mapRef.current;
    const token = tokenRef.current;
    if (!map || !token) return;

    // Find the active route's unit callsign from current state
    const currentRoute = activeRoute;
    if (!currentRoute) return;

    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng},${lat};${call.longitude},${call.latitude}?access_token=${token}&geometries=geojson&overview=full`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      const route = data.routes?.[0];
      if (!route) return;

      const coords: [number, number][] = route.geometry.coordinates;
      try { removeMapboxTrail(map, ROUTE_TRAIL_ID); } catch { /* ok */ }
      addMapboxTrail(map, ROUTE_TRAIL_ID, coords, '#22c55e', 3);

      setActiveRoute({
        unitCallSign: currentRoute.unitCallSign,
        callNumber: currentRoute.callNumber,
        eta: formatEta(route.duration),
        distance: formatDistance(route.distance),
      });
    } catch {
      // Silently ignore routing errors
    }
  }, [call?.latitude, call?.longitude, activeRoute]);

  // ── Load Mapbox token and create map ──
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoaded(false);

    (async () => {
      try {
        const token = await getMapboxToken();
        if (cancelled) return;
        if (!token) {
          setError('Mapbox token not configured');
          return;
        }
        tokenRef.current = token;
        setLoaded(true);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load Mapbox token');
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Initialize or update map
  useEffect(() => {
    if (!loaded || !mapContainerRef.current || !tokenRef.current) return;

    const center: [number, number] = call?.latitude != null && call?.longitude != null
      ? [call.longitude, call.latitude]
      : DEFAULT_CENTER;

    if (!mapRef.current) {
      const map = createMapboxMap({
        container: mapContainerRef.current,
        center,
        zoom: MINI_ZOOM,
        style: 'dark',
        accessToken: tokenRef.current,
      });

      mapRef.current = map;

      // Track bearing for compass indicator
      map.on('rotate', () => {
        setMapBearing(map.getBearing());
      });
    } else {
      mapRef.current.setCenter(center);
    }

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Call marker (priority-colored pin)
    if (call?.latitude != null && call?.longitude != null && mapRef.current) {
      const el = buildCallMarker(call.call_number || 'CALL', (call as any).priority);
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([call.longitude, call.latitude])
        .addTo(mapRef.current);
      markersRef.current.push(marker);
    }

    // Assigned unit markers (status-colored)
    const assignedUnitsWithGps = units.filter(u =>
      call?.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null
    );

    for (const unit of assignedUnitsWithGps) {
      if (mapRef.current) {
        const el = buildUnitMarker(unit.call_sign, (unit as any).status);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([unit.longitude!, unit.latitude!])
          .addTo(mapRef.current);
        markersRef.current.push(marker);
      }
    }
  }, [loaded, call?.id, call?.latitude, call?.longitude, units]);

  // Track whether we have an active route via ref to avoid double-render from state dependency
  const hasActiveRouteRef = useRef(false);
  hasActiveRouteRef.current = !!activeRoute;

  // Auto-route: show driving route when exactly 1 assigned unit has GPS
  useEffect(() => {
    if (!loaded || !mapRef.current || call?.latitude == null || call?.longitude == null) {
      if (hasActiveRouteRef.current) clearRoute();
      return;
    }

    const assignedWithGps = units.filter(u =>
      call.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null
    );

    if (assignedWithGps.length === 1) {
      const u = assignedWithGps[0];
      const combo = `${u.call_sign}:${call.call_number}`;

      // Only re-show if the assignment changed
      if (combo !== lastAutoRouteRef.current) {
        lastAutoRouteRef.current = combo;
        showRoute(u.call_sign, call.call_number || 'CALL', u.latitude!, u.longitude!, call.latitude, call.longitude);
      } else {
        // Same unit+call — just update GPS origin for re-routing
        updateOrigin(u.latitude!, u.longitude!);
      }
    } else {
      // Multiple or zero assigned units — clear route
      if (hasActiveRouteRef.current) {
        clearRoute();
      }
    }
  }, [loaded, call?.id, call?.latitude, call?.longitude, call?.assigned_units, units, showRoute, clearRoute, updateOrigin]);

  // Notify parent of route changes
  useEffect(() => {
    if (onRouteUpdate) {
      onRouteUpdate(activeRoute ? {
        unitCallSign: activeRoute.unitCallSign,
        callNumber: activeRoute.callNumber,
        eta: activeRoute.eta,
        distance: activeRoute.distance,
      } : null);
    }
  }, [activeRoute, onRouteUpdate]);

  // Serve route overlay — show numbered markers + polyline for PSO calls
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    // Clean up previous serve overlays
    serveMarkersRef.current.forEach(m => m.remove());
    serveMarkersRef.current = [];
    try { removeMapboxTrail(map, SERVE_TRAIL_ID); } catch { /* ok */ }

    if (!serveRouteJobs || serveRouteJobs.length === 0) return;

    // Order jobs by route order if available
    let orderedJobs = serveRouteJobs;
    if (serveRouteOrder && serveRouteOrder.length > 0) {
      const jobMap = new Map(serveRouteJobs.map((j: any) => [j.id, j]));
      const ordered = serveRouteOrder.map(id => jobMap.get(id)).filter(Boolean);
      const orderedIdSet = new Set(serveRouteOrder);
      const remaining = serveRouteJobs.filter((j: any) => !orderedIdSet.has(j.id));
      orderedJobs = [...ordered, ...remaining];
    }

    // Build coordinate path for polyline
    const coords: [number, number][] = orderedJobs
      .filter((j: any) => j.recipient_lat != null && j.recipient_lng != null)
      .map((j: any) => [j.recipient_lng, j.recipient_lat] as [number, number]);

    if (coords.length > 1) {
      addMapboxTrail(map, SERVE_TRAIL_ID, coords, '#d4a017', 2);
    }

    // Numbered markers
    orderedJobs.forEach((job: any, idx: number) => {
      if (job.recipient_lat == null || job.recipient_lng == null) return;
      const statusColor = job.status === 'served' ? '#22c55e'
        : job.status === 'failed' ? '#ef4444'
        : job.status === 'in_progress' ? '#eab308'
        : '#d4a017';
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));';
      const badge = document.createElement('div');
      badge.style.cssText = `width:16px;height:16px;border-radius:50%;background:${statusColor};color:#000;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;font-family:'JetBrains Mono',monospace;border:1px solid #fff;`;
      badge.textContent = String(idx + 1);
      const caret = document.createElement('div');
      caret.style.cssText = `width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-top:4px solid ${statusColor};`;
      el.appendChild(badge);
      el.appendChild(caret);

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([job.recipient_lng, job.recipient_lat])
        .addTo(map);
      serveMarkersRef.current.push(marker);
    });

    // Fit bounds to include serve jobs + call location
    if (coords.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      if (call?.latitude != null && call?.longitude != null) {
        bounds.extend([call.longitude, call.latitude]);
      }
      coords.forEach(c => bounds.extend(c));
      map.fitBounds(bounds, { padding: 40 });
    }
  }, [loaded, serveRouteJobs, serveRouteOrder, call?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      markersRef.current.forEach(m => m.remove());
      serveMarkersRef.current.forEach(m => m.remove());
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Derive assigned unit count for status display
  const assignedUnits = units.filter(u => call?.assigned_units?.includes(String(u.id)));
  const assignedWithGpsCount = assignedUnits.filter(u => u.latitude != null && u.longitude != null).length;

  // ── Map error placeholder (sole error surface) ──
  if (isAuthError) {
    return (
      <div className="dispatch-minimap-container" style={{ height: fullHeight ? '100%' : 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0b0b' }}>
        <span className="text-[9px] text-rmpg-500">{error}</span>
      </div>
    );
  }

  const priorityColor = MINI_PRIORITY_COLORS[(call as any)?.priority] || '#888888';

  return (
    <div className="dispatch-minimap-container" style={{ position: 'relative', height: fullHeight ? '100%' : 180, borderTop: fullHeight ? undefined : '1px solid #141414' }}>
      {/* Toolbar */}
      <div style={{
        position: 'absolute', top: 4, left: 4, right: 4, zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, pointerEvents: 'auto' }}>
          {/* Title badge with priority accent */}
          <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5"
            style={{
              background: 'rgba(0,0,0,0.8)',
              backdropFilter: 'blur(4px)',
              borderLeft: `2px solid ${priorityColor}`,
              color: '#aaaaaa',
              fontFamily: "'JetBrains Mono', monospace",
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
            <MapPin style={{ width: 8, height: 8, color: priorityColor }} />
            Mini-Map
            {(call as any)?.priority && (
              <span style={{ fontSize: 7, color: priorityColor, fontWeight: 900 }}>{(call as any).priority}</span>
            )}
          </span>
          {/* Unit count badge */}
          {assignedUnits.length > 0 && (
            <span className="text-[7px] font-bold px-1.5 py-0.5"
              style={{
                background: 'rgba(0,0,0,0.8)',
                backdropFilter: 'blur(4px)',
                color: '#666666',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
              {assignedWithGpsCount}/{assignedUnits.length} UNITS
              {assignedWithGpsCount > 0 && <span style={{ color: '#22c55e', marginLeft: 3 }}>●</span>}
            </span>
          )}
          {/* Serve route badge */}
          {serveRouteJobs && serveRouteJobs.length > 0 && (
            <span className="text-[7px] font-bold px-1.5 py-0.5"
              style={{
                background: 'rgba(0,0,0,0.8)',
                backdropFilter: 'blur(4px)',
                color: '#d4a017',
                fontFamily: "'JetBrains Mono', monospace",
                borderLeft: '2px solid #d4a017',
              }}>
              {serveRouteJobs.length} STOPS
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          <button type="button"
            onClick={() => navigate('/map')}
            className="text-rmpg-400 hover:text-white transition-colors"
            style={{ background: 'rgba(0,0,0,0.8)', padding: '3px 5px', border: 'none', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
            title="Open full map"
          >
            <Maximize2 style={{ width: 10, height: 10 }} />
          </button>
          {onClose && (
            <button type="button"
              onClick={onClose}
              className="text-rmpg-400 hover:text-white transition-colors"
              style={{ background: 'rgba(0,0,0,0.8)', padding: '3px 5px', border: 'none', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
              title="Close mini-map"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Compass indicator (top-right, below buttons) */}
      {loaded && mapBearing !== 0 && (
        <div style={{
          position: 'absolute', top: 36, right: 4, zIndex: 10,
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: 'rgba(0,0,0,0.8)',
            border: '1px solid #2b2b2b',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16"
              style={{ transform: `rotate(${-mapBearing}deg)`, transition: 'transform 0.3s ease' }}>
              <polygon points="8,2 6.5,9 8,7.5 9.5,9" fill="#d4a017" />
              <polygon points="8,14 6.5,7 8,8.5 9.5,7" fill="#555555" />
              <text x="8" y="1.5" textAnchor="middle" fill="#d4a017" fontSize="3" fontFamily="monospace" fontWeight="bold">N</text>
            </svg>
          </div>
        </div>
      )}

      {/* Route ETA badge (bottom-left) — enhanced */}
      {activeRoute && (
        <div style={{
          position: 'absolute', bottom: 4, left: 4, zIndex: 10,
          background: 'rgba(0,0,0,0.92)', border: '1px solid #88888830',
          backdropFilter: 'blur(4px)',
          padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 6,
          borderLeft: '2px solid #22c55e',
        }}>
          <Navigation style={{ width: 8, height: 8, color: '#22c55e', transform: 'rotate(45deg)' }} />
          <span style={{ fontSize: 8, color: '#aaaaaa', fontWeight: 900, fontFamily: "'JetBrains Mono', monospace" }}>
            {activeRoute.unitCallSign}→{activeRoute.callNumber}
          </span>
          <span style={{ fontSize: 10, color: '#fff', fontWeight: 900, fontFamily: "'JetBrains Mono', monospace" }}>{activeRoute.eta}</span>
          <span style={{ fontSize: 8, color: '#666666', fontFamily: "'JetBrains Mono', monospace" }}>{activeRoute.distance}</span>
        </div>
      )}

      {/* Map container with tactical grid overlay */}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div ref={mapContainerRef} role="application" aria-label="Dispatch mini map" style={{ width: '100%', height: '100%' }} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(212,160,23,0.04) 39px, rgba(212,160,23,0.04) 40px),' +
            'repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(212,160,23,0.04) 39px, rgba(212,160,23,0.04) 40px)',
        }} />
      </div>

      {/* Loading overlay — tactical radar sweep */}
      {!loaded && !error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6,
          background: '#0b0b0b',
        }}>
          <div style={{ position: 'relative', width: 32, height: 32 }}>
            {/* Radar ring */}
            <div style={{
              position: 'absolute', inset: 0,
              border: '1px solid #d4a01740', borderRadius: '50%',
            }} />
            {/* Sweep line */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%', width: 14, height: 1,
              background: 'linear-gradient(90deg, #d4a017, transparent)',
              transformOrigin: '0 0',
              animation: 'rmpg-radar-sweep 2s linear infinite',
            }} />
            {/* Center dot */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              width: 3, height: 3, borderRadius: '50%',
              background: '#d4a017', transform: 'translate(-50%,-50%)',
            }} />
          </div>
          <span style={{
            fontSize: 7, color: '#333', fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em',
          }}>
            ACQUIRING
          </span>
        </div>
      )}

      {/* Connected indicator (green dot when map loaded) */}
      {loaded && (
        <div style={{
          position: 'absolute', bottom: activeRoute ? 36 : 4, right: 4, zIndex: 10,
          pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 3,
          background: 'rgba(0,0,0,0.7)', padding: '2px 5px', borderRadius: 2,
        }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: '#22c55e', boxShadow: '0 0 4px rgba(34,197,94,0.5)',
          }} />
          <Wifi style={{ width: 7, height: 7, color: '#22c55e60' }} />
        </div>
      )}
    </div>
  );
}
