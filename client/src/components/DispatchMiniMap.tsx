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
import { Maximize2, MapPin, RefreshCw, Car } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { installWebglContextRecovery, type MapCamera } from '../utils/webglRecovery';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../utils/mapboxApiKey';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { buildUnitMarker, buildCallMarker, isValidLngLat, STATUS_COLORS } from '../utils/mapMarkers';
import { useMapRouting } from '../hooks/useMapRouting';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { apiFetch } from '../hooks/useApi';
import { speak } from '../utils/edgeTTS';
import ManeuverArrow from './ManeuverArrow';
import type { CallForService, Unit } from '../types';

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
  /** Serve route jobs to overlay on the mini map (for PSO calls) */
  serveRouteJobs?: any[];
  /** Serve route polyline data (optimized_order_json from serve_routes) */
  serveRouteOrder?: number[] | null;
}

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608]; // Salt Lake City fallback [lng, lat]
const MINI_ZOOM = 15;

export default function DispatchMiniMap({ call, units, onClose, fullHeight, onRouteUpdate }: DispatchMiniMapProps) {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const callMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const unitMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tilesStalled, setTilesStalled] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [mapTokenRetry, setMapTokenRetry] = useState(0);
  // Bumped to true the moment the Mapbox instance is created. mapRef is a ref
  // (assigning it does NOT re-render), so without this the useMapRouting hook
  // below would stay bound to map=null forever and queryRoute would bail before
  // ever fetching the Directions API — no route line, no turn-by-turn banner.
  const [mapReady, setMapReady] = useState(false);
  // WebGL context-loss recovery (see installWebglContextRecovery below).
  const [recovering, setRecovering] = useState(false);
  const [recoverNonce, setRecoverNonce] = useState(0);
  const recoverCamRef = useRef<MapCamera | null>(null);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);

  // Always-visible assigned vehicle (independent of dispatch)
  interface AssignedVehicle {
    id: number;
    vehicle_number: string;
    plate_number: string | null;
    gps_lat: number | null;
    gps_lon: number | null;
    status: string;
    current_mileage: number | null;
  }
  const [assignedVehicle, setAssignedVehicle] = useState<AssignedVehicle | null>(null);
  const assignedVehicleMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Classify error: auth/config vs connectivity
  const isAuthError = error != null && (error.includes('token') || error.includes('configured'));

  // Routing (auto-route when a single assigned unit has GPS)
  const { activeRoute, showRoute, clearRoute, updateOrigin } = useMapRouting({ map: mapReady ? mapRef.current : null });
  const lastAutoRouteRef = useRef<string>(''); // track last auto-routed unit+call combo

  // Device's OWN live GPS (read-only — Layout owns the upload). Drives
  // continuous, phone-maps-style route recomputation from watchPosition
  // (~1/sec) when THIS device is the unit being routed, instead of waiting
  // for the server units feed to round-trip on a tab switch.
  const devGps = useGpsTracking({ upload: false });

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

  // Initialize the map ONCE, then re-center + re-pin the call only when the
  // SELECTED CALL changes. Deliberately does NOT depend on `units`, so a unit
  // GPS poll never re-centers the map ("reload while the unit moves") or
  // disturbs the static call pin.
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const map = mapRef.current;

    // isValidLngLat rejects NaN/Infinity and the exact (0,0) no-fix signature
    // so a call with bad coordinates never anchors the map / drops a teardrop.
    const hasCallLoc = isValidLngLat(call?.longitude, call?.latitude);
    // A WebGL-loss rebuild reopens at the captured view; otherwise center on the
    // call (or the SLC fallback). One-shot: cleared after the new map is built.
    const recoverCam = recoverCamRef.current;
    const center: [number, number] = recoverCam
      ? recoverCam.center
      : hasCallLoc
        ? [call!.longitude!, call!.latitude!]
        : DEFAULT_CENTER;
    const zoom = recoverCam ? recoverCam.zoom : MINI_ZOOM;

    if (!mapRef.current) {
      recoverCamRef.current = null;
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE_DARK,
        center,
        zoom,
        attributionControl: false,
      });
      map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
      mapRef.current = map;
      registerMapInstance(map);
      setMapReady(true); // re-render so useMapRouting picks up the real map instance
      setRecovering(false);

      // WebGL context-loss recovery: rebuild this map in place if the GPU drops
      // its context (long shift / Toughbook GPU pressure / sleep-wake). We null
      // mapRef + bump recoverNonce so THIS effect re-creates the map; the marker
      // and routing effects (keyed on mapReady) re-attach to the new instance.
      webglRecoveryCleanupRef.current = installWebglContextRecovery(map, {
        label: 'DispatchMiniMap',
        onContextLost: () => setRecovering(true),
        onContextRestored: () => setRecovering(false),
        onRebuild: (camera) => {
          recoverCamRef.current = camera;
          if (webglRecoveryCleanupRef.current) { webglRecoveryCleanupRef.current(); webglRecoveryCleanupRef.current = null; }
          callMarkerRef.current?.remove(); callMarkerRef.current = null;
          unitMarkersRef.current.forEach((m) => m.remove()); unitMarkersRef.current.clear();
          if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
          setMapReady(false);
          setRecovering(true);
          setRecoverNonce((n) => n + 1);
        },
        onGiveUp: () => setRecovering(false),
      });

      // Monitor tile loading
      map.on('idle', () => setTilesStalled(false));
      const stallCheck = setInterval(() => {
        if (!map.loaded()) setTilesStalled(true);
      }, 15000);

      map.on('remove', () => clearInterval(stallCheck));
    } else if (hasCallLoc) {
      // Only re-center when a new call is selected (this effect's deps), never
      // on a unit GPS update — preserves the dispatcher's pan/zoom.
      mapRef.current.setCenter(center);
    }

    // Call marker (red) — static per call. Move the existing marker in place
    // rather than tearing it down so it never flickers / "flies around".
    if (hasCallLoc && mapRef.current) {
      if (callMarkerRef.current) {
        callMarkerRef.current.setLngLat([call!.longitude!, call!.latitude!]);
        // The builder nests the label in a <span>; update it in place so the
        // teardrop shape/rotation isn't wiped by setting textContent on the root.
        const label = callMarkerRef.current.getElement()?.querySelector('span');
        if (label) label.textContent = call!.call_number || 'CALL';
      } else {
        const el = buildCallMarker({ priority: call!.priority, label: call!.call_number || 'CALL' });
        callMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([call!.longitude!, call!.latitude!])
          .addTo(mapRef.current);
      }
    } else if (!hasCallLoc && callMarkerRef.current) {
      callMarkerRef.current.remove();
      callMarkerRef.current = null;
    }
  }, [loaded, call?.id, call?.latitude, call?.longitude, recoverNonce]);

  // Fetch assigned vehicle — always visible, independent of dispatch
  useEffect(() => {
    let cancelled = false;
    const fetchAssignedVehicle = () => {
      apiFetch<AssignedVehicle | null>('/dispatch/gps/my-vehicle')
        .then((v) => {
          if (cancelled || !v) return;
          setAssignedVehicle(v);
        })
        .catch(() => { /* no assigned vehicle — normal */ });
    };
    fetchAssignedVehicle();
    const interval = setInterval(fetchAssignedVehicle, 60_000); // refresh every 60s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Render assigned vehicle marker on map (always visible)
  useEffect(() => {
    if (!loaded || !mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const av = assignedVehicle;

    // Remove existing marker if vehicle info changed or GPS lost
    if (assignedVehicleMarkerRef.current) {
      assignedVehicleMarkerRef.current.remove();
      assignedVehicleMarkerRef.current = null;
    }

    if (!av || !isValidLngLat(av.gps_lon, av.gps_lat)) return;

    // Take-home vehicle: no dispatch status in scope, so render the shared unit
    // pin with the vehicle number as its label (gold-ring 'onscene' tone keeps
    // the original gold-branded accent the plain neutral ring would have lost).
    const el = buildUnitMarker({ label: av.vehicle_number || 'V', status: 'onscene' });
    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([av.gps_lon!, av.gps_lat!])
      .addTo(map);
    assignedVehicleMarkerRef.current = marker;

    return () => {
      if (assignedVehicleMarkerRef.current) {
        assignedVehicleMarkerRef.current.remove();
        assignedVehicleMarkerRef.current = null;
      }
    };
  }, [loaded, mapReady, assignedVehicle?.gps_lat, assignedVehicle?.gps_lon, assignedVehicle?.vehicle_number]);

  // Assigned-unit markers — keyed by unit id and MOVED in place on each GPS
  // update so the pin glides to its new position instead of being destroyed and
  // recreated (which made it flicker / jump around the map). Match by the
  // call's assigned_units OR the unit's current_call_id (list/WS payloads omit
  // assigned_units).
  useEffect(() => {
    if (!loaded || !mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const assignedIds = assignedUnitIdSet(call);
    const assignedUnits = units.filter(u =>
      (assignedIds.has(String(u.id)) ||
        (u.current_call_id != null && String(u.current_call_id) === String(call?.id))) &&
      isValidLngLat(u.longitude, u.latitude)
    );

    const liveIds = new Set<string>();
    for (const unit of assignedUnits) {
      const id = String(unit.id);
      liveIds.add(id);
      const existing = unitMarkersRef.current.get(id);
      if (existing) {
        existing.setLngLat([unit.longitude!, unit.latitude!]);
        // Label lives in the builder's <span>; update it (not the root) in place.
        const label = existing.getElement()?.querySelector('span');
        if (label && label.textContent !== unit.call_sign) label.textContent = unit.call_sign;
      } else {
        const el = buildUnitMarker({ label: unit.call_sign, status: unit.status });
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([unit.longitude!, unit.latitude!])
          .addTo(map);
        unitMarkersRef.current.set(id, marker);
      }
    }
    // Drop markers for units no longer assigned / no longer in the feed.
    for (const [id, marker] of unitMarkersRef.current) {
      if (!liveIds.has(id)) { marker.remove(); unitMarkersRef.current.delete(id); }
    }
  }, [loaded, mapReady, units, call?.id]);

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
      (assignedIds.has(String(u.id)) ||
        (u.current_call_id != null && String(u.current_call_id) === String(call.id))) &&
      u.latitude != null && u.longitude != null
    );

    if (assignedWithGps.length === 1) {
      const u = assignedWithGps[0];
      const combo = `${u.call_sign}:${call.call_number}`;

      if (combo !== lastAutoRouteRef.current) {
        // Set the combo eagerly to avoid spamming the Directions API across
        // rapid re-renders, but clear it again if the query actually failed
        // (e.g. the map wasn't ready yet) so the next render retries instead
        // of falling through to the throttled updateOrigin path forever.
        lastAutoRouteRef.current = combo;
        showRoute(u.call_sign, call.call_number || 'CALL', u.latitude!, u.longitude!, call.latitude, call.longitude)
          .then((info) => { if (!info) lastAutoRouteRef.current = ''; });
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

  // ── Live turn-by-turn recompute from the DEVICE's own GPS ──
  // Standard phone-GPS behavior: when the officer viewing this map IS the unit
  // routed to the call (call-sign match), recompute the route from the device's
  // continuous watchPosition fixes (~1/sec) rather than the server units poll.
  // useMapRouting.updateOrigin re-snaps progress, advances the turn-by-turn
  // step, and auto-reroutes when off-corridor — so directions + ETA stay live
  // without ever leaving the page. Dispatchers watching ANOTHER unit are
  // unaffected (the call-sign guard fails, server position keeps driving it).
  useEffect(() => {
    if (!activeRoute) return;
    const { latitude: lat, longitude: lng, unitCallSign } = devGps;
    if (lat == null || lng == null) return;
    if (!unitCallSign || unitCallSign !== activeRoute.unitCallSign) return;
    updateOrigin(lat, lng);
  }, [devGps.latitude, devGps.longitude, devGps.unitCallSign, activeRoute, updateOrigin]);

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
  //
  // AUDIBLE nav is gated to the EN-ROUTE phase only: it starts speaking when
  // the call goes 'enroute' and stops once the unit is 'onscene' (and never
  // speaks while pending/dispatched/cleared). The route line + on-screen
  // maneuver banner still render at any status — this gate is voice-only, so
  // simply opening the dispatch screen no longer triggers spoken directions.
  // Resetting the throttle ref outside en-route means the first instruction is
  // announced the instant status flips to 'enroute'.
  const lastSpokenRef = useRef<string>('');
  useEffect(() => {
    const isEnRoute = call?.status === 'enroute';
    const current = activeRoute?.steps?.[0]?.instruction?.trim();
    if (!isEnRoute || !current) { lastSpokenRef.current = ''; return; }
    if (current === lastSpokenRef.current) return;
    lastSpokenRef.current = current;
    // distanceText gives the lead-in ("In 0.3 mi, turn left …") for natural cadence.
    const dist = activeRoute?.steps?.[0]?.distanceText;
    const phrase = dist ? `In ${dist}, ${current}` : current;
    void speak(phrase, 'moderate', 'conversational');
  }, [activeRoute?.steps, call?.status]);

  // Cleanup: remove persistent markers + unregister map instance on unmount
  useEffect(() => {
    return () => {
      if (webglRecoveryCleanupRef.current) { webglRecoveryCleanupRef.current(); webglRecoveryCleanupRef.current = null; }
      callMarkerRef.current?.remove();
      callMarkerRef.current = null;
      unitMarkersRef.current.forEach((m) => m.remove());
      unitMarkersRef.current.clear();
      if (mapRef.current) unregisterMapInstance(mapRef.current);
    };
  }, []);

  // Auth error (config problem, not connectivity)
  if (isAuthError) {
    return (
      <div className="dispatch-minimap-container" style={{ height: fullHeight ? '100%' : 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-base)' }}>
        <span className="text-[9px] text-rmpg-500">{error}</span>
      </div>
    );
  }

  const priorityColor = MINI_PRIORITY_COLORS[(call as any)?.priority] || '#888888';

  return (
    <div className="dispatch-minimap-container" style={{ position: 'relative', height: fullHeight ? '100%' : 180, borderTop: fullHeight ? undefined : '1px solid var(--border-subtle)' }}>
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
        </div>
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          <button type="button"
            onClick={() => navigate('/map')}
            className="text-rmpg-400 hover:text-rmpg-100"
            style={{ background: 'rgba(0,0,0,0.7)', padding: '2px 4px', border: 'none', cursor: 'pointer' }}
            title="Open full map"
          >
            <Maximize2 style={{ width: 10, height: 10 }} />
          </button>
          {onClose && (
            <button type="button"
              onClick={onClose}
              className="text-rmpg-400 hover:text-rmpg-100"
              style={{ background: 'rgba(0,0,0,0.7)', padding: '2px 4px', border: 'none', cursor: 'pointer' }}
              title="Close mini-map"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Compass indicator (top-right, below buttons) */}
      {loaded && mapHeading !== 0 && (
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
              style={{ transform: `rotate(${-mapHeading}deg)`, transition: 'transform 0.3s ease' }}>
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
          <span style={{ fontSize: 8, color: 'var(--rmpg-400)', fontWeight: 900, fontFamily: "'JetBrains Mono', monospace" }}>
            {activeRoute.unitCallSign}→{activeRoute.callNumber}
          </span>
          <span style={{ fontSize: 9, color: '#fff', fontWeight: 900 }}>{activeRoute.eta}</span>
          <span style={{ fontSize: 8, color: 'var(--rmpg-500)' }}>{activeRoute.distance}</span>
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
          background: 'rgba(0,0,0,0.94)', borderTop: '1px solid var(--border-default)', pointerEvents: 'auto',
        }}>
          {/* ETA + miles, above */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            padding: '2px 6px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-base)',
          }}>
            <span style={{ fontSize: 8, color: STATUS_COLORS.offline, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {activeRoute.unitCallSign}→{activeRoute.callNumber}
            </span>
            <span style={{ fontSize: 13, color: STATUS_COLORS.online, fontWeight: 900, letterSpacing: '0.02em' }}>
              {activeRoute.eta} <span style={{ fontSize: 8, color: '#16a34a' }}>ETA</span>
            </span>
            <span style={{ fontSize: 12, color: STATUS_COLORS.warning, fontWeight: 900 }}>{activeRoute.distance}</span>
          </div>
          {/* Current direction, one at a time */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px' }}>
            <ManeuverArrow
              type={activeRoute.steps[0].maneuverType}
              modifier={activeRoute.steps[0].modifier}
              size={28}
            />
            <span style={{ fontSize: 13, color: '#ffffff', fontWeight: 700, flex: 1, lineHeight: 1.25 }}>
              {activeRoute.steps[0].instruction}
            </span>
            {activeRoute.steps[0].distanceMeters > 0 && (
              <span style={{ fontSize: 11, color: 'var(--rmpg-400)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {activeRoute.steps[0].distanceText}
              </span>
            )}
          </div>
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
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface-overlay)',
        }}>
          <RefreshCw style={{ width: 14, height: 14, color: 'var(--rmpg-500)' }} className="animate-spin" />
        </div>
      )}

      {/* WebGL recovery badge — map briefly rebuilding after a GPU context drop */}
      {recovering && (
        <div style={{
          position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', zIndex: 12,
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.9)', border: `1px solid ${STATUS_COLORS.warning}55`,
            padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4,
            borderRadius: 2,
          }}>
            <RefreshCw style={{ width: 8, height: 8, color: STATUS_COLORS.warning }} className="animate-spin" />
            <span style={{ fontSize: 8, color: STATUS_COLORS.warning, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              RECONNECTING
            </span>
          </div>
        </div>
      )}

      {/* Tile stall badge with signal indicator */}
      {loaded && tilesStalled && (
        <div style={{
          position: 'absolute', bottom: activeRoute ? 36 : 4, right: 4, zIndex: 10,
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.85)', border: `1px solid ${STATUS_COLORS.caution}40`,
            padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4,
            borderRadius: 2,
          }}>
            <RefreshCw style={{ width: 8, height: 8, color: STATUS_COLORS.caution }} className="animate-spin" />
            <span style={{ fontSize: 8, color: STATUS_COLORS.caution, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              OFFLINE
            </span>
          </div>
        </div>
      )}

      {/* Connected indicator (green dot when tiles loaded and not stalled) */}
      {loaded && !tilesStalled && (
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
