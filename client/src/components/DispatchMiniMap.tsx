// ============================================================
// RMPG Flex — Dispatch Mini-Map
// Lightweight embeddable Mapbox GL JS panel showing the selected
// call location and assigned unit positions. Used inline in the
// Dispatch right column.
//
// Mapbox GL JS handles its own offline caching via the browser's
// tile cache — no separate Leaflet fallback needed.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, MapPin, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../utils/mapboxApiKey';
import { useMapRouting } from '../hooks/useMapRouting';
import { speak } from '../utils/edgeTTS';
import type { CallForService, Unit } from '../types';

// Compact maneuver glyph for the nav banner, from the Mapbox maneuver
// type + modifier (e.g. turn + left → ↰, merge → ⤚, arrive → ◉).
function maneuverGlyph(type?: string, modifier?: string): string {
  if (type === 'arrive') return '◉';
  if (type === 'depart') return '▲';
  if (type === 'roundabout' || type === 'rotary') return '↻';
  if (modifier?.includes('left')) return modifier === 'slight left' ? '↖' : '↰';
  if (modifier?.includes('right')) return modifier === 'slight right' ? '↗' : '↱';
  if (modifier === 'uturn') return '⤺';
  return '↑';
}

// `call.assigned_units` can arrive as id strings/numbers OR as full unit
// objects (the call-detail endpoint returns objects). Normalize to a Set of
// id-strings so assigned-unit matching works either way. Previously the code
// did `assigned_units.includes(String(u.id))`, which is always false when the
// array holds objects — so the assigned unit never matched, and the unit
// marker, route line, and turn-by-turn directions never appeared.
function assignedUnitIdSet(call: { assigned_units?: unknown } | null | undefined): Set<string> {
  const a = (call as { assigned_units?: unknown } | null | undefined)?.assigned_units;
  if (!Array.isArray(a)) return new Set();
  return new Set(a.map((x) => String(x && typeof x === 'object' ? (x as { id: unknown }).id : x)));
}

interface DispatchMiniMapProps {
  call: CallForService | null;
  units: Unit[];
  onClose?: () => void;
  /** When true, fills parent container height instead of fixed 180px */
  fullHeight?: boolean;
  /** Called when route ETA changes (for parent to display inline) */
  onRouteUpdate?: (info: { unitCallSign: string; callNumber: string; eta: string; distance: string } | null) => void;
}

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608]; // Salt Lake City fallback [lng, lat]
const MINI_ZOOM = 15;

export default function DispatchMiniMap({ call, units, onClose, fullHeight, onRouteUpdate }: DispatchMiniMapProps) {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tilesStalled, setTilesStalled] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [mapTokenRetry, setMapTokenRetry] = useState(0);

  // Classify error: auth/config vs connectivity
  const isAuthError = error != null && (error.includes('token') || error.includes('configured'));

  // Routing (auto-route when a single assigned unit has GPS)
  const { activeRoute, showRoute, clearRoute, updateOrigin } = useMapRouting({ map: mapRef.current });
  const lastAutoRouteRef = useRef<string>(''); // track last auto-routed unit+call combo

  // Load Mapbox token + init map
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoaded(false);

    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        initMapbox(token);
        if (cancelled) return;
        setLoaded(true);
        setError(null);
      } catch (err: any) {
        if (!cancelled) {
          setLoaded(false);
          setError(err?.message || getMapboxTokenErrorMessage());
        }
      }
    })();

    return () => { cancelled = true; };
  }, [mapTokenRetry]);

  // Initialize or update map
  useEffect(() => {
    if (!loaded || !mapContainerRef.current) return;

    const center: [number, number] = call?.latitude != null && call?.longitude != null
      ? [call.longitude, call.latitude]
      : DEFAULT_CENTER;

    if (!mapRef.current) {
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE_DARK,
        center,
        zoom: MINI_ZOOM,
        attributionControl: false,
      });
      mapRef.current = map;
      registerMapInstance(map);

      // Monitor tile loading
      map.on('idle', () => setTilesStalled(false));
      const stallCheck = setInterval(() => {
        if (!map.loaded()) setTilesStalled(true);
      }, 15000);

      map.on('remove', () => clearInterval(stallCheck));
    } else {
      mapRef.current.setCenter(center);
    }

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Call marker (red)
    if (call?.latitude != null && call?.longitude != null && mapRef.current) {
      const el = document.createElement('div');
      el.style.cssText =
        'background:#ef4444;color:#fff;font-size:9px;font-weight:900;' +
        "padding:1px 4px;border:1px solid #fff;white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.03em;box-shadow:0 1px 4px rgba(0,0,0,0.4);";
      el.textContent = call.call_number || 'CALL';
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([call.longitude, call.latitude])
        .addTo(mapRef.current);
      markersRef.current.push(marker);
    }

    // Assigned unit markers
    const assignedIds = assignedUnitIdSet(call);
    const assignedUnits = units.filter(u =>
      assignedIds.has(String(u.id)) && u.latitude != null && u.longitude != null
    );

    for (const unit of assignedUnits) {
      if (!mapRef.current) continue;
      const el = document.createElement('div');
      el.style.cssText =
        'background:#888888;color:#fff;font-size:8px;font-weight:900;' +
        "padding:1px 4px;border:1px solid #363636;white-space:nowrap;font-family:'JetBrains Mono',monospace;border-radius:2px;box-shadow:0 2px 6px rgba(0,0,0,0.4);";
      el.textContent = unit.call_sign;
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([unit.longitude!, unit.latitude!])
        .addTo(mapRef.current);
      markersRef.current.push(marker);
    }
  }, [loaded, call?.id, call?.latitude, call?.longitude, units]);

  // Auto-route: show driving route when exactly 1 assigned unit has GPS
  const hasActiveRouteRef = useRef(false);
  hasActiveRouteRef.current = !!activeRoute;

  useEffect(() => {
    if (!loaded || !mapRef.current || call?.latitude == null || call?.longitude == null) {
      if (hasActiveRouteRef.current) clearRoute();
      return;
    }

    const assignedIds = assignedUnitIdSet(call);
    const assignedWithGps = units.filter(u =>
      assignedIds.has(String(u.id)) && u.latitude != null && u.longitude != null
    );

    if (assignedWithGps.length === 1) {
      const u = assignedWithGps[0];
      const combo = `${u.call_sign}:${call.call_number}`;

      if (combo !== lastAutoRouteRef.current) {
        lastAutoRouteRef.current = combo;
        showRoute(u.call_sign, call.call_number || 'CALL', u.latitude!, u.longitude!, call.latitude, call.longitude);
      } else {
        updateOrigin(u.latitude!, u.longitude!);
      }
    } else {
      if (hasActiveRouteRef.current) {
        clearRoute();
        lastAutoRouteRef.current = '';
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

  // Voice-announce the current driving direction at the appropriate time.
  // Because useMapRouting recomputes from the unit's live origin, steps[0]
  // becomes the next maneuver as the unit drives — so we speak whenever that
  // instruction CHANGES (the moment it becomes current). Throttled to one
  // utterance per distinct instruction so we don't repeat on every re-render.
  const lastSpokenRef = useRef<string>('');
  useEffect(() => {
    const current = activeRoute?.steps?.[0]?.instruction?.trim();
    if (!current) { lastSpokenRef.current = ''; return; }
    if (current === lastSpokenRef.current) return;
    lastSpokenRef.current = current;
    // distanceText gives the lead-in ("In 0.3 mi, turn left …") for natural cadence.
    const dist = activeRoute?.steps?.[0]?.distanceText;
    const phrase = dist ? `In ${dist}, ${current}` : current;
    void speak(phrase, 'moderate', 'conversational');
  }, [activeRoute?.steps]);

  // Cleanup: unregister map instance on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) unregisterMapInstance(mapRef.current);
    };
  }, []);

  // Auth error (config problem, not connectivity)
  if (isAuthError) {
    return (
      <div className="dispatch-minimap-container" style={{ height: fullHeight ? '100%' : 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0b0b' }}>
        <span className="text-[9px] text-rmpg-500">{error}</span>
      </div>
    );
  }

  return (
    <div className="dispatch-minimap-container" style={{ position: 'relative', height: fullHeight ? '100%' : 180, borderTop: fullHeight ? undefined : '1px solid #141414' }}>
      {/* Toolbar */}
      <div style={{
        position: 'absolute', top: 4, left: 4, right: 4, zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        pointerEvents: 'none',
      }}>
        <span className="text-[8px] font-bold text-rmpg-400 uppercase tracking-wider px-1 py-0.5"
          style={{ background: 'rgba(0,0,0,0.7)', pointerEvents: 'auto' }}>
          <MapPin style={{ width: 8, height: 8, display: 'inline', marginRight: 3 }} />
          Mini-Map
        </span>
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          <button type="button"
            onClick={() => navigate('/map')}
            className="text-rmpg-400 hover:text-white"
            style={{ background: 'rgba(0,0,0,0.7)', padding: '2px 4px', border: 'none', cursor: 'pointer' }}
            title="Open full map"
          >
            <Maximize2 style={{ width: 10, height: 10 }} />
          </button>
          {onClose && (
            <button type="button"
              onClick={onClose}
              className="text-rmpg-400 hover:text-white"
              style={{ background: 'rgba(0,0,0,0.7)', padding: '2px 4px', border: 'none', cursor: 'pointer' }}
              title="Close mini-map"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Route ETA badge (bottom-left) */}
      {activeRoute && (
        <div style={{
          position: 'absolute', bottom: 4, left: 4, zIndex: 10,
          background: 'rgba(0,0,0,0.9)', border: '1px solid #88888850',
          padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ fontSize: 8, color: '#aaaaaa', fontWeight: 900, fontFamily: "'JetBrains Mono', monospace" }}>
            {activeRoute.unitCallSign}→{activeRoute.callNumber}
          </span>
          <span style={{ fontSize: 9, color: '#fff', fontWeight: 900 }}>{activeRoute.eta}</span>
          <span style={{ fontSize: 8, color: '#666666' }}>{activeRoute.distance}</span>
        </div>
      )}

      {/* Turn-by-turn nav banner — ONE direction at a time, pinned to the bottom
          of the map. ETA + remaining miles sit above the current instruction.
          useMapRouting recomputes the route from the unit's live origin, so
          steps[0] is always the current/next maneuver; it auto-advances as the
          unit drives, and each new instruction is announced by voice (effect
          below). */}
      {activeRoute?.steps && activeRoute.steps.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 11,
          background: 'rgba(0,0,0,0.94)', borderTop: '1px solid #2e2e2e', pointerEvents: 'auto',
        }}>
          {/* ETA + miles, above */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            padding: '2px 6px', borderBottom: '1px solid #1a1a1a', background: '#141414',
          }}>
            <span style={{ fontSize: 8, color: '#888888', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {activeRoute.unitCallSign}→{activeRoute.callNumber}
            </span>
            <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 900, letterSpacing: '0.02em' }}>
              {activeRoute.eta} <span style={{ fontSize: 8, color: '#16a34a' }}>ETA</span>
            </span>
            <span style={{ fontSize: 12, color: '#d4a017', fontWeight: 900 }}>{activeRoute.distance}</span>
          </div>
          {/* Current direction, one at a time */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px' }}>
            <span aria-hidden style={{ fontSize: 22, color: '#d4a017', lineHeight: 1, minWidth: 24, textAlign: 'center' }}>
              {maneuverGlyph(activeRoute.steps[0].maneuverType, activeRoute.steps[0].modifier)}
            </span>
            <span style={{ fontSize: 13, color: '#ffffff', fontWeight: 700, flex: 1, lineHeight: 1.25 }}>
              {activeRoute.steps[0].instruction}
            </span>
            {activeRoute.steps[0].distanceMeters > 0 && (
              <span style={{ fontSize: 11, color: '#aaaaaa', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {activeRoute.steps[0].distanceText}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Map container */}
      <div ref={mapContainerRef} role="application" aria-label="Dispatch mini map" style={{ width: '100%', height: '100%' }} />

      {/* Loading overlay */}
      {!loaded && !error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0b0b0b',
        }}>
          <RefreshCw style={{ width: 14, height: 14, color: '#383838' }} className="animate-spin" />
        </div>
      )}

      {/* Tile stall badge */}
      {loaded && tilesStalled && (
        <div style={{
          position: 'absolute', bottom: activeRoute ? 28 : 4, right: 4, zIndex: 10,
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.85)', border: '1px solid #f59e0b40',
            padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <RefreshCw style={{ width: 8, height: 8, color: '#f59e0b' }} className="animate-spin" />
            <span style={{ fontSize: 8, color: '#f59e0b', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              OFFLINE
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
