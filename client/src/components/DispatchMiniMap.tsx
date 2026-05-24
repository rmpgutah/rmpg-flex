// ============================================================
// RMPG Flex — Dispatch Mini-Map
// Lightweight embeddable Mapbox panel showing the selected
// call location and assigned unit positions. Used inline in the
// Dispatch right column.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Maximize2, MapPin, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { getMapboxToken, resolveMapStyleUrl } from '../utils/mapboxClient';
import { createMapboxMap, registerMapInstance, unregisterMapInstance, monitorMapTiles, onOnlineRetryMaps, injectMapStyles } from '../utils/mapboxMap';
import { useMapRouting } from '../hooks/useMapRouting';
import type { CallForService, Unit } from '../types';

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

/** Build a call marker DOM element (red label with caret) */
function buildCallMarker(label: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;';

  const tag = document.createElement('div');
  tag.style.cssText =
    'background:#ef4444;color:#fff;font-size:7px;font-weight:900;' +
    "padding:1px 3px;border:1px solid #fff;white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.03em;box-shadow:0 1px 4px rgba(0,0,0,0.4);";
  tag.textContent = label;

  const caret = document.createElement('div');
  caret.style.cssText =
    'width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #ef4444;';

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

/** Build a unit marker DOM element (blue chip) */
function buildUnitMarker(callSign: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'background:#888888;color:#fff;font-size:8px;font-weight:900;' +
    "padding:1px 4px;border:1px solid #363636;white-space:nowrap;font-family:'JetBrains Mono',monospace;border-radius:2px;box-shadow:0 2px 6px rgba(0,0,0,0.4);";
  el.textContent = callSign;
  return el;
}

export default function DispatchMiniMap({ call, units, onClose, fullHeight, onRouteUpdate }: DispatchMiniMapProps) {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const callMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const unitMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tilesStalled, setTilesStalled] = useState(false);
  const [mapRetry, setMapRetry] = useState(0);
  const tileMonitorRef = useRef<(() => void) | null>(null);

  // Classify error: auth/config vs connectivity
  const isAuthError = error != null;

  // Routing (auto-route when a single assigned unit has GPS)
  const { activeRoute, showRoute, clearRoute, updateOrigin } = useMapRouting({ map: mapRef.current });
  const lastAutoRouteRef = useRef<string>('');

  // Load Mapbox token and initialize map with retry + online auto-recovery
  useEffect(() => {
    let cancelled = false;
    let unsubOnline = () => {};
    setError(null);
    setLoaded(false);

    function attemptInit(token: string, attempt: number) {
      if (cancelled || !mapContainerRef.current) return;
      try {
        const map = createMapboxMap(mapContainerRef.current, token, resolveMapStyleUrl('dark'));
        if (!map || typeof map.getContainer !== 'function' || !map.getContainer()) {
          setError('Map load failed — check connection');
          return;
        }
        mapRef.current = map;
        registerMapInstance(map);

        const center: [number, number] = (call?.latitude != null && call?.longitude != null)
          ? [call.longitude, call.latitude]
          : DEFAULT_CENTER;
        map.jumpTo({ center, zoom: MINI_ZOOM });

        map.addControl(new mapboxgl.NavigationControl({ showCompass: false, showZoom: true }), 'top-right');

        if (tileMonitorRef.current) tileMonitorRef.current();
        tileMonitorRef.current = monitorMapTiles(map, {
          onStalled: () => setTilesStalled(true),
          onLoaded: () => setTilesStalled(false),
          onRecovering: () => {},
        });

        if (!cancelled) { setLoaded(true); setError(null); }
      } catch {
        if (cancelled) return;
        if (attempt < 3) {
          setTimeout(() => attemptInit(token, attempt + 1), [3000, 6000, 12000][attempt]);
        } else {
          setError('Map load failed — check connection');
        }
      }
    }

    (async () => {
      try {
        injectMapStyles();
        const token = await getMapboxToken();
        if (cancelled) return;
        attemptInit(token, 0);
        unsubOnline = onOnlineRetryMaps(token, () => {
          if (!cancelled) {
            setError(null);
            setLoaded(true);
          }
        });
      } catch (err: any) {
        if (!cancelled) {
          setLoaded(false);
          setError(err?.message || 'Failed to get Mapbox token');
        }
      }
    })();

    return () => { cancelled = true; unsubOnline(); };
  }, [mapRetry, call?.latitude, call?.longitude]);

  // Update markers when call or units change
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const map = mapRef.current;

    // Update call marker
    if (callMarkerRef.current) {
      callMarkerRef.current.remove();
      callMarkerRef.current = null;
    }
    if (call?.latitude != null && call?.longitude != null) {
      const el = buildCallMarker(call.call_number || 'CALL');
      callMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([call.longitude, call.latitude])
        .addTo(map);
    }

    // Update unit markers
    unitMarkersRef.current.forEach(m => m.remove());
    unitMarkersRef.current = [];

    const assignedUnits = units.filter(u =>
      call?.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null
    );

    for (const unit of assignedUnits) {
      const el = buildUnitMarker(unit.call_sign);
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([unit.longitude!, unit.latitude!])
        .addTo(map);
      unitMarkersRef.current.push(marker);
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

  // Cleanup: unregister map instance + tile monitor + markers on unmount
  useEffect(() => {
    return () => {
      if (tileMonitorRef.current) { tileMonitorRef.current(); tileMonitorRef.current = null; }
      callMarkerRef.current?.remove();
      unitMarkersRef.current.forEach(m => m.remove());
      unitMarkersRef.current = [];
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // ── Map error placeholder (sole error surface) ──
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
