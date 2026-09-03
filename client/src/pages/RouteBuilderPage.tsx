// ============================================================
// RMPG Flex — Dispatch CFS Route Builder Page
//
// Automatic multi-stop route planner for officers handling
// multiple active CFS calls. Uses Mapbox Directions API
// for client-side routing, plus server-side nearest-neighbor
// + 2-opt for initial ordering.
//
// Features:
//   • Auto-detects active calls for selected unit
//   • Optimizes stop order for shortest driving route
//   • Priority-weighted routing (P1 calls visited first)
//   • Live Mapbox GL with Directions polyline rendering
//   • Drag-to-reorder stops manually
//   • Save/load routes per unit
//   • WebSocket-driven live call updates
//   • ETA, distance, and fuel cost estimates
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import {
  Route, MapPin, Navigation, Clock, ChevronUp, ChevronDown,
  Play, Save, Trash2, RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, Circle, Crosshair, Fuel, ArrowRight,
} from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../hooks/useApi';
import { useWebSocket } from '../context/WebSocketContext';
import { useNavTrip } from '../context/NavTripContext';
import { getMapboxToken } from '../utils/mapboxApiKey';
import { createMapboxMap, addMapboxTrail, removeMapboxTrail, injectMapboxStyles } from '../utils/mapboxLoader';
import { useWebglMapRecovery } from '../hooks/useWebglMapRecovery';
import { getDirections } from '../utils/mapboxServices';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { escapeHtml } from '../utils/sanitize';
import { withAlpha } from '../utils/withAlpha';
import { isValidLngLat } from './map/utils/mapMarkers';
import { downloadTextFile, routeStopsToCsv } from '../utils/rmsListExport';

// ─── Types ──────────────────────────────────────────────────

interface Unit {
  id: string;
  call_sign: string;
  officer_name: string;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface RouteWaypoint {
  stop_number: number;
  call_id: number;
  call_number: string;
  incident_type: string;
  priority: string;
  latitude: number;
  longitude: number;
  location_address: string;
  status: string;
  description?: string;
  distance_from_prev_miles?: number;
  completed?: boolean;
  completed_at?: string;
}

interface OptimizeResponse {
  unit_id: string;
  origin: { lat: number; lng: number };
  optimized_order: number[];
  waypoints: RouteWaypoint[];
  total_distance_miles: number;
  estimated_time_minutes: number;
  algorithm: string;
  priority_weighted: boolean;
  warning?: string;
}

interface SavedRoute {
  id: number;
  unit_id: string;
  origin_lat: number;
  origin_lng: number;
  waypoints_json: string;
  total_distance_miles: number;
  estimated_time_minutes: number;
  notes: string;
  status: string;
  created_at: string;
}

// ─── Constants ──────────────────────────────────────────────

const IRS_MILEAGE_RATE = 0.67; // $/mile 2024 rate

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#ef4444', // red
  P2: '#f97316', // orange
  P3: '#eab308', // yellow
  P4: '#22c55e', // green
};

const PRIORITY_LABELS: Record<string, string> = {
  P1: 'EMERGENCY',
  P2: 'URGENT',
  P3: 'ROUTINE',
  P4: 'LOW',
};

// ─── Component ──────────────────────────────────────────────

export default function RouteBuilderPage() {
  const [searchParams] = useSearchParams();
  const preselectedUnit = searchParams.get('unit') || '';

  // State
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>(preselectedUnit);
  const [waypoints, setWaypoints] = useState<RouteWaypoint[]>([]);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [totalDistance, setTotalDistance] = useState(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState(0);
  const [optimizing, setOptimizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedRouteId, setSavedRouteId] = useState<number | null>(null);
  const [startingRoute, setStartingRoute] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [useMapboxDirections, setUseMapboxDirections] = useState(true);
  const [priorityWeighted, setPriorityWeighted] = useState(true);
  const [directionsDistance, setDirectionsDistance] = useState<string | null>(null);
  const [directionsDuration, setDirectionsDuration] = useState<string | null>(null);

  const { rebuildNonce, attach: attachWebglRecovery, onMapLoaded } = useWebglMapRecovery();
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);

  // Refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const mapboxTokenRef = useRef<string>('');
  const renderRouteRef = useRef<((origin: { lat: number; lng: number }, stops: RouteWaypoint[]) => void) | undefined>(undefined);

  const { subscribe } = useWebSocket();
  const navigate = useNavigate();
  const navTrip = useNavTrip();

  // ─── Load Units ─────────────────────────────────────────

  useEffect(() => {
    apiFetch<Unit[]>('/api/dispatch/units')
      .then((data) => {
        const active = data.filter(
          (u) => u.status !== 'off_duty' && u.status !== 'out_of_service',
        );
        setUnits(active);
      })
      .catch(console.error);
  }, []);

  // ─── Initialize Map ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getMapboxToken();
        if (cancelled || !mapContainerRef.current || !token) return;
        mapboxTokenRef.current = token;
        injectMapboxStyles();

        const map = createMapboxMap(mapContainerRef.current!, token);
        mapRef.current = map;
        webglRecoveryCleanupRef.current = attachWebglRecovery(map, 'RouteBuilderPage');
        map.on('load', () => {
          if (!cancelled) { onMapLoaded(map); setMapReady(true); }
        });
      } catch (err) {
        console.error('Failed to load Mapbox:', err);
        setError('Failed to load map. Route visualization unavailable.');
      }
    })();

    return () => {
      cancelled = true;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNonce]);

  // ─── WebSocket: live call updates ───────────────────────

  useEffect(() => {
    const unsub = subscribe('dispatch_update', (msg: any) => {
      const data = msg.data || msg;
      if (
        data.action === 'call_updated' &&
        data.call &&
        waypoints.some((w) => w.call_id === data.call.id)
      ) {
        // Update waypoint status in place
        setWaypoints((prev) =>
          prev.map((w) =>
            w.call_id === data.call.id
              ? { ...w, status: data.call.status, priority: data.call.priority }
              : w,
          ),
        );
      }
      // If a call was cleared/closed, remove from active route
      if (
        data.action === 'call_updated' &&
        data.call &&
        ['cleared', 'closed', 'cancelled'].includes(data.call.status)
      ) {
        setWaypoints((prev) =>
          prev
            .filter((w) => w.call_id !== data.call.id)
            .map((w, i) => ({ ...w, stop_number: i + 1 })),
        );
      }
    });

    return unsub;
  }, [subscribe]);

  // ─── Optimize Route ─────────────────────────────────────

  const optimizeRoute = useCallback(async () => {
    if (!selectedUnitId) {
      setError('Select a unit first');
      return;
    }

    setOptimizing(true);
    setError(null);
    setSavedRouteId(null);

    try {
      const result = await apiFetch<OptimizeResponse>('/api/dispatch/routing/optimize', {
        method: 'POST',
        body: JSON.stringify({
          unit_id: selectedUnitId,
          priority_weighted: priorityWeighted,
        }),
      });

      if (result.warning) {
        setError(result.warning);
      }

      setWaypoints(result.waypoints);
      setOrigin(result.origin);
      setTotalDistance(result.total_distance_miles);
      setEstimatedMinutes(result.estimated_time_minutes);

      // Render on map
      if (mapRef.current && result.waypoints.length > 0) {
        renderRouteRef.current?.(result.origin, result.waypoints);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to optimize route');
    } finally {
      setOptimizing(false);
    }
  }, [selectedUnitId, priorityWeighted]);

  // ─── Render Route on Map ────────────────────────────────

  const renderRoute = useCallback(
    (routeOrigin: { lat: number; lng: number }, stops: RouteWaypoint[]) => {
      const map = mapRef.current;
      if (!map) return;

      // Clear existing markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      originMarkerRef.current?.remove();
      removeMapboxTrail(map);

      // Fit bounds
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([routeOrigin.lng, routeOrigin.lat]);
      stops.forEach((s) => bounds.extend([s.longitude, s.latitude]));
      map.fitBounds(bounds, { padding: 60 });

      // Origin marker
      const originEl = document.createElement('div');
      originEl.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#3b82f6;border:3px solid #1d4ed8;box-shadow:0 0 8px #3b82f680;';
      originMarkerRef.current = new mapboxgl.Marker({ element: originEl })
        .setLngLat([routeOrigin.lng, routeOrigin.lat])
        .addTo(map);

      if (useMapboxDirections && stops.length <= 25) {
        renderMapboxDirections(map, routeOrigin, stops);
      } else {
        renderSimpleRoute(map, routeOrigin, stops);
      }
    },
    [useMapboxDirections],
  );
  renderRouteRef.current = renderRoute;

  const renderMapboxDirections = useCallback(
    async (map: mapboxgl.Map, routeOrigin: { lat: number; lng: number }, stops: RouteWaypoint[]) => {
      // Directions go through the Worker proxy (/api/mapbox/directions) —
      // server-side MAPBOX_ACCESS_TOKEN secret, auth'd, no direct
      // api.mapbox.com egress from the browser.
      const allPoints: [number, number][] = [
        [routeOrigin.lng, routeOrigin.lat],
        ...stops.map((s) => [s.longitude, s.latitude] as [number, number]),
      ];

      try {
        const data = await getDirections(allPoints, 'driving-traffic');

        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const coords = route.geometry.coordinates as [number, number][];

          // Draw route polyline
          removeMapboxTrail(map);
          addMapboxTrail(map, coords, '#d4a017');

          // Calculate distance/duration
          const distMiles = (route.distance / 1609.344).toFixed(1);
          const durMin = Math.round(route.duration / 60);
          setDirectionsDistance(`${distMiles} mi`);
          setDirectionsDuration(`${durMin} min`);
          setTotalDistance(parseFloat(distMiles));
          setEstimatedMinutes(durMin);

          addStopMarkers(map, stops);
        } else {
          renderSimpleRoute(map, routeOrigin, stops);
        }
      } catch {
        renderSimpleRoute(map, routeOrigin, stops);
      }
    },
    [],
  );

  const renderSimpleRoute = useCallback(
    (map: mapboxgl.Map, routeOrigin: { lat: number; lng: number }, stops: RouteWaypoint[]) => {
      const coords: [number, number][] = [
        [routeOrigin.lng, routeOrigin.lat],
        ...stops.map((s) => [s.longitude, s.latitude] as [number, number]),
      ];
      removeMapboxTrail(map);
      addMapboxTrail(map, coords, '#d4a017');

      addStopMarkers(map, stops);
      setDirectionsDistance(null);
      setDirectionsDuration(null);
    },
    [],
  );

  const addStopMarkers = useCallback(
    (map: mapboxgl.Map, stops: RouteWaypoint[]) => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      stops.forEach((stop, idx) => {
        if (!isValidLngLat(stop.longitude, stop.latitude)) return;
        const color = stop.completed ? '#22c55e' : (PRIORITY_COLORS[stop.priority] || '#888888');

        // Create custom marker element
        const el = document.createElement('div');
        el.style.cssText = `
          width:24px;height:30px;position:relative;cursor:pointer;
        `;
        el.innerHTML = `
          <svg width="24" height="30" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 18 12 18s12-9 12-18c0-6.63-5.37-12-12-12z" fill="${color}" stroke="#000" stroke-width="1"/>
            <text x="12" y="14" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold" font-family="system-ui">${idx + 1}</text>
          </svg>
        `;
        el.title = `Stop ${idx + 1}: ${stop.call_number} — ${stop.incident_type}`;

        const popup = new mapboxgl.Popup({ offset: 25, closeButton: false, className: 'mapbox-popup-dark' })
          .setHTML(`
            <div style="background:#141414;color:#e5e5e5;padding:8px 12px;border-radius:2px;min-width:200px;font-family:system-ui;">
              <div style="font-weight:600;color:#d4a017;margin-bottom:4px;">
                Stop ${idx + 1} — ${escapeHtml(stop.call_number)}
              </div>
              <div style="font-size:12px;margin-bottom:2px;">
                <span style="color:${color};font-weight:600;">${escapeHtml(stop.priority)}</span>
                &nbsp;${escapeHtml(stop.incident_type)}
              </div>
              <div style="font-size:11px;color:#888;">${escapeHtml(stop.location_address)}</div>
              ${stop.description ? `<div style="font-size:11px;color:#666;margin-top:4px;">${escapeHtml(stop.description.slice(0, 100))}</div>` : ''}
              ${stop.completed ? '<div style="color:#22c55e;font-size:11px;margin-top:4px;">✓ Completed</div>' : ''}
            </div>
          `);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([stop.longitude, stop.latitude])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);
      });
    },
    [],
  );

  // ─── Move Stop Up/Down ──────────────────────────────────

  const moveStop = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newWaypoints = [...waypoints];
      const swapIdx = direction === 'up' ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= newWaypoints.length) return;

      [newWaypoints[index], newWaypoints[swapIdx]] = [
        newWaypoints[swapIdx],
        newWaypoints[index],
      ];

      // Renumber
      newWaypoints.forEach((w, i) => (w.stop_number = i + 1));
      setWaypoints(newWaypoints);

      // Re-render
      if (mapRef.current && origin) {
        renderRoute(origin, newWaypoints);
      }
    },
    [waypoints, origin, renderRoute],
  );

  // ─── Complete Stop ──────────────────────────────────────

  const completeStop = useCallback(
    async (callId: number) => {
      if (savedRouteId) {
        try {
          await apiFetch(`/api/dispatch/routing/${savedRouteId}/complete-stop`, {
            method: 'POST',
            body: JSON.stringify({ call_id: callId }),
          });
        } catch {
          // Continue locally — warn so user knows persistence may be stale
          console.warn('Failed to persist stop completion to server');
        }
      }

      setWaypoints((prev) =>
        prev.map((w) =>
          w.call_id === callId
            ? { ...w, completed: true, completed_at: new Date().toISOString() }
            : w,
        ),
      );
    },
    [savedRouteId],
  );

  // ─── Save Route ─────────────────────────────────────────

  const saveRoute = useCallback(async () => {
    if (!selectedUnitId || waypoints.length === 0) return;

    setSaving(true);
    try {
      const result = await apiFetch<{ success: boolean; id: number }>(
        '/api/dispatch/routing/save',
        {
          method: 'POST',
          body: JSON.stringify({
            unit_id: selectedUnitId,
            origin_lat: origin?.lat,
            origin_lng: origin?.lng,
            waypoints_json: waypoints,
            optimized_order_json: waypoints.map((w) => w.call_id),
            total_distance_miles: totalDistance,
            estimated_time_minutes: estimatedMinutes,
          }),
        },
      );
      setSavedRouteId(result.id);
    } catch (err: any) {
      setError(err.message || 'Failed to save route');
    } finally {
      setSaving(false);
    }
  }, [selectedUnitId, waypoints, origin, totalDistance, estimatedMinutes]);

  // ─── Start Route (live multi-stop nav HUD) ──────────────
  // Saves first if the current stop list hasn't been persisted yet — the
  // guidance engine's loadUnitRoute reads the ACTIVE saved row from
  // /api/dispatch/routing/unit/:unitId, so an unsaved edit here would be
  // invisible to it.

  const startRoute = useCallback(async () => {
    if (!selectedUnitId || waypoints.length === 0 || !navTrip) return;

    setStartingRoute(true);
    setError(null);
    try {
      if (!savedRouteId) {
        await saveRoute();
      }
      await navTrip.loadUnitRoute(selectedUnitId);
      navigate('/navigation');
    } catch (err: any) {
      setError(err.message || 'Failed to start route');
    } finally {
      setStartingRoute(false);
    }
  }, [selectedUnitId, waypoints, navTrip, savedRouteId, saveRoute, navigate]);

  // ─── Load Saved Route ───────────────────────────────────

  useEffect(() => {
    if (!selectedUnitId) return;

    apiFetch<SavedRoute[]>(`/api/dispatch/routing/unit/${selectedUnitId}`)
      .then((routes) => {
        if (routes.length > 0) {
          const route = routes[0];
          try {
            const wps = JSON.parse(route.waypoints_json) as RouteWaypoint[];
            setWaypoints(wps);
            setOrigin({ lat: route.origin_lat, lng: route.origin_lng });
            setTotalDistance(route.total_distance_miles || 0);
            setEstimatedMinutes(route.estimated_time_minutes || 0);
            setSavedRouteId(route.id);

            if (mapRef.current && wps.length > 0) {
              renderRoute({ lat: route.origin_lat, lng: route.origin_lng }, wps);
            }
          } catch {
            console.warn('Failed to parse saved route waypoints JSON');
          }
        }
      })
      .catch(() => {
        // No saved routes — ok
      });
  }, [selectedUnitId, renderRoute]);

  // ─── Render ─────────────────────────────────────────────

  const fuelCost = totalDistance * IRS_MILEAGE_RATE;
  const completedCount = waypoints.filter((w) => w.completed).length;

  return (
    <div className="flex h-full" style={{ minHeight: 0 }}>
      {/* ── Left Panel: Controls + Stop List ── */}
      <div className="w-[420px] flex-shrink-0 bg-surface-deep border-r border-[#222222] flex flex-col overflow-hidden">
        <PanelTitleBar title="CFS ROUTE BUILDER" icon={Route}>
          <button
            type="button"
            className="toolbar-btn"
            disabled={waypoints.length === 0}
            onClick={() => downloadTextFile('route-stops.csv', routeStopsToCsv(waypoints.map((w) => ({
              sequence: w.stop_number,
              label: w.location_address || w.call_number,
              status: w.completed ? 'completed' : w.status,
            }))))}
          >CSV</button>
        </PanelTitleBar>

        {/* Unit Selector */}
        <div className="p-3 border-b border-[#222222] space-y-2">
          <label className="text-[10px] font-mono text-fg-muted uppercase tracking-wider">
            Select Unit
          </label>
          <select
            value={selectedUnitId}
            onChange={(e) => {
              setSelectedUnitId(e.target.value);
              setWaypoints([]);
              setOrigin(null);
              setSavedRouteId(null);
              setError(null);
              setDirectionsDistance(null);
              setDirectionsDuration(null);
            }}
            className="w-full bg-surface-deep border border-[#222222] text-[#e5e5e5] text-xs px-2 py-1.5 rounded-[2px] font-mono"
          >
            <option value="">— Select Unit —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.call_sign} — {u.officer_name} ({u.status})
              </option>
            ))}
          </select>

          {/* Options */}
          <div className="flex items-center gap-4 text-[10px] text-fg-muted">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={priorityWeighted}
                onChange={(e) => setPriorityWeighted(e.target.checked)}
                className="[accent-color:var(--field-label-color)]"
              />
              Priority-weighted
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={useMapboxDirections}
                onChange={(e) => setUseMapboxDirections(e.target.checked)}
                className="[accent-color:var(--field-label-color)]"
              />
              Traffic-aware
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={optimizeRoute}
              disabled={!selectedUnitId || optimizing}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#d4a017] text-rmpg-950 text-xs font-semibold rounded-[2px] hover:bg-[#e6b422] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {optimizing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {optimizing ? 'Optimizing…' : 'Build Route'}
            </button>
            <button
              onClick={saveRoute}
              disabled={waypoints.length === 0 || saving}
              className="flex items-center gap-1 px-3 py-1.5 bg-surface-deep border border-[#222222] text-[#e5e5e5] text-xs rounded-[2px] hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </button>
            <IconButton
              onClick={() => {
                setWaypoints([]);
                setOrigin(null);
                setSavedRouteId(null);
                setTotalDistance(0);
                setEstimatedMinutes(0);
                setDirectionsDistance(null);
                setDirectionsDuration(null);
                markersRef.current.forEach((m) => m.remove());
                markersRef.current = [];
                originMarkerRef.current?.remove();
                if (mapRef.current) {
                  removeMapboxTrail(mapRef.current);
                }
              }}
              aria-label="Clear route"
              className="px-2 py-1.5 bg-surface-deep border border-[#222222] text-fg-muted rounded-[2px] hover:bg-surface-sunken hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </IconButton>
          </div>

          {waypoints.length > 0 && (
            <button
              onClick={startRoute}
              disabled={startingRoute || !navTrip}
              title={!navTrip ? 'Navigation is unavailable on this page' : undefined}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-brand-500 text-surface-deep text-xs font-semibold rounded-[2px] hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {startingRoute ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Navigation className="w-3.5 h-3.5" />
              )}
              {startingRoute ? 'Starting…' : 'Start Route'}
            </button>
          )}

          {savedRouteId && (
            <div className="text-[10px] text-green-500 font-mono flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Route saved (#{savedRouteId})
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-3 py-2 bg-red-900/20 border-b border-red-800/30 text-red-400 text-[11px] flex items-center justify-between">
            <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}</span>
            <button type="button" className="toolbar-btn" onClick={() => setError(null)}>Retry</button>
          </div>
        )}

        {/* Route Summary */}
        {waypoints.length > 0 && (
          <div className="px-3 py-2 border-b border-[#222222] bg-[#050505]">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-[10px] text-fg-muted font-mono uppercase">Stops</div>
                <div className="text-sm font-semibold text-[#e5e5e5]">
                  {completedCount}/{waypoints.length}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-fg-muted font-mono uppercase">Distance</div>
                <div className="text-sm font-semibold [color:var(--panel-header-color)]">
                  {directionsDistance || `${totalDistance.toFixed(1)} mi`}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-fg-muted font-mono uppercase">ETA</div>
                <div className="text-sm font-semibold text-[#e5e5e5]">
                  {directionsDuration || `${estimatedMinutes} min`}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-fg-muted font-mono uppercase">Fuel $</div>
                <div className="text-sm font-semibold text-[#e5e5e5]">
                  ${fuelCost.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stop List */}
        <div className="flex-1 overflow-y-auto">
          {waypoints.length === 0 && !optimizing && (
            <div className="p-6 text-center text-fg-muted text-xs">
              <Route className="w-8 h-8 mx-auto mb-2 text-[#333333]" />
              <p>Select a unit and click <span className="[color:var(--panel-header-color)]">Build Route</span> to generate an optimized route for all active CFS calls.</p>
            </div>
          )}

          {optimizing && (
            <div className="p-6 text-center">
              <Loader2 className="w-6 h-6 mx-auto mb-2 [color:var(--panel-header-color)] animate-spin" />
              <p className="text-fg-muted text-xs">Computing optimal route…</p>
            </div>
          )}

          {waypoints.map((wp, idx) => (
            <div
              key={wp.call_id}
              className={`px-3 py-2 border-b border-[#1a1a1a] hover:bg-surface-deep transition-colors ${
                wp.completed ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start gap-2">
                {/* Stop number */}
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5"
                  style={{
                    backgroundColor: wp.completed
                      ? '#22c55e'
                      : (PRIORITY_COLORS[wp.priority] || '#888888'),
                    color: '#fff',
                  }}
                >
                  {wp.completed ? '✓' : idx + 1}
                </div>

                {/* Call info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono font-semibold [color:var(--panel-header-color)]">
                      {wp.call_number}
                    </span>
                    <span
                      className="text-[9px] font-mono font-bold px-1 rounded-[2px]"
                      style={{
                        color: PRIORITY_COLORS[wp.priority] || '#888',
                        backgroundColor: withAlpha(PRIORITY_COLORS[wp.priority] || '#888', '20'),
                      }}
                    >
                      {formatEnumValue(wp.priority)}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#e5e5e5] truncate">{toDisplayLabel(wp.incident_type)}</div>
                  <div className="text-[10px] text-fg-muted truncate flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                    {wp.location_address}
                  </div>
                  {wp.distance_from_prev_miles != null && (
                    <div className="text-[9px] text-[#555555] flex items-center gap-1 mt-0.5">
                      <ArrowRight className="w-2.5 h-2.5" />
                      {wp.distance_from_prev_miles.toFixed(1)} mi from previous
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <IconButton
                    onClick={() => moveStop(idx, 'up')}
                    disabled={idx === 0}
                    aria-label={`Move stop ${idx + 1} up`}
                    className="p-0.5 text-fg-muted hover:text-[#e5e5e5] disabled:opacity-20"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton
                    onClick={() => moveStop(idx, 'down')}
                    disabled={idx === waypoints.length - 1}
                    aria-label={`Move stop ${idx + 1} down`}
                    className="p-0.5 text-fg-muted hover:text-[#e5e5e5] disabled:opacity-20"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </IconButton>
                  {!wp.completed && (
                    <IconButton
                      onClick={() => completeStop(wp.call_id)}
                      aria-label={`Complete stop ${wp.call_number}`}
                      className="p-0.5 text-fg-muted hover:text-green-400"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </IconButton>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-[#222222] bg-[#050505] text-[9px] text-[#555555] font-mono">
          Route optimization: nearest-neighbor + 2-opt TSP solver
          {priorityWeighted && ' (priority-weighted)'}
          {useMapboxDirections && ' • Mapbox Directions traffic-aware'}
        </div>
      </div>

      {/* ── Right: Map ── */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="w-full h-full bg-surface-deep" />

        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-deep">
            <div className="text-center">
              <Loader2 className="w-8 h-8 mx-auto mb-2 [color:var(--panel-header-color)] animate-spin" />
              <p className="text-fg-muted text-xs">Loading map…</p>
            </div>
          </div>
        )}

        {/* Map legend overlay */}
        {waypoints.length > 0 && (
          <div className="absolute bottom-4 left-4 bg-surface-deep/90 border border-[#222222] rounded-[2px] p-2 text-[10px] space-y-1">
            <div className="text-fg-muted font-mono uppercase mb-1">Priority</div>
            {Object.entries(PRIORITY_COLORS).map(([p, color]) => (
              <div key={p} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[#e5e5e5]">{p}</span>
                <span className="text-fg-muted">{PRIORITY_LABELS[p]}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-[#e5e5e5]">Origin</span>
              <span className="text-fg-muted">Unit location</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
