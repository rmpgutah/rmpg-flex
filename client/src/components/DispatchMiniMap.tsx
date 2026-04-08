// ============================================================
// RMPG Flex — Dispatch Mini-Map
// Lightweight embeddable Google Maps panel showing the selected
// call location and assigned unit positions. Used inline in the
// Dispatch right column.
//
// When Google Maps fails to load (vehicle WiFi dead zones), falls
// back to a compact Leaflet map using pre-cached offline tiles.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, MapPin, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadGoogleMaps, DARK_MAP_STYLE, registerMapInstance, unregisterMapInstance, onOnlineRetryMaps, monitorTileLoading } from '../utils/googleMapsLoader';
import { getGoogleMapsApiKey, getGoogleMapsApiKeyErrorMessage } from '../utils/googleMapsApiKey';
import { useMapRouting } from '../hooks/useMapRouting';
import OfflineMapFallback from './OfflineMapFallback';
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

const DEFAULT_CENTER = { lat: 40.7608, lng: -111.891 }; // Salt Lake City fallback
const MINI_ZOOM = 15;

/** Build a call marker DOM element (red label with caret) */
function buildCallMarker(label: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;';

  const tag = document.createElement('div');
  /* #54: Call marker with subtle shadow for depth */
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
  /* #55: Unit marker with shadow */
  el.style.cssText =
    'background:#3b82f6;color:#fff;font-size:8px;font-weight:900;' +
    "padding:1px 4px;border:1px solid #1e3a5f;white-space:nowrap;font-family:'JetBrains Mono',monospace;border-radius:2px;box-shadow:0 2px 6px rgba(0,0,0,0.4);";
  el.textContent = callSign;
  return el;
}

export default function DispatchMiniMap({ call, units, onClose, fullHeight, onRouteUpdate }: DispatchMiniMapProps) {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tilesStalled, setTilesStalled] = useState(false);
  const [retryingGmaps, setRetryingGmaps] = useState(false);
  const [gmapsRetry, setGmapsRetry] = useState(0);
  const tileMonitorRef = useRef<(() => void) | null>(null);

  // Classify error: auth/config vs connectivity
  const isAuthError = error != null && (error.includes('key') || error.includes('configured'));
  const showLeafletFallback = error != null && !isAuthError;

  // Routing (auto-route when a single assigned unit has GPS)
  const { activeRoute, showRoute, clearRoute, updateOrigin } = useMapRouting({ map: mapRef.current });
  const lastAutoRouteRef = useRef<string>(''); // track last auto-routed unit+call combo

  // Load Google Maps script with retry + online auto-recovery
  useEffect(() => {
    let cancelled = false;
    let unsubOnline = () => {};
    setError(null);
    setLoaded(false);

    function attemptLoad(apiKey: string, attempt: number) {
      if (cancelled) return;
      loadGoogleMaps(apiKey)
        .then(() => { if (!cancelled) { setLoaded(true); setError(null); } })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 3) {
            setTimeout(() => attemptLoad(apiKey, attempt + 1), [3000, 6000, 12000][attempt]);
          } else {
            setError('Map load failed — check connection');
          }
        });
    }

    (async () => {
      try {
        const apiKey = await getGoogleMapsApiKey();
        if (cancelled) return;
        attemptLoad(apiKey, 0);
        unsubOnline = onOnlineRetryMaps(apiKey, () => {
          if (!cancelled) {
            setError(null);
            setLoaded(true);
          }
        });
      } catch (err: any) {
        if (!cancelled) {
          setLoaded(false);
          setError(err?.message || getGoogleMapsApiKeyErrorMessage());
        }
      }
    })();

    return () => { cancelled = true; unsubOnline(); };
  }, [gmapsRetry]);

  // Initialize or update map
  useEffect(() => {
    if (!loaded || !mapContainerRef.current) return;

    const center = call?.latitude != null && call?.longitude != null
      ? { lat: call.latitude, lng: call.longitude }
      : DEFAULT_CENTER;

    if (!mapRef.current) {
      const map = new google.maps.Map(mapContainerRef.current, {
        center,
        zoom: MINI_ZOOM,
        styles: DARK_MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
        gestureHandling: 'cooperative',
      });
      mapRef.current = map;
      registerMapInstance(map);

      // Monitor tile loading for vehicle WiFi resilience
      if (tileMonitorRef.current) tileMonitorRef.current();
      tileMonitorRef.current = monitorTileLoading(map, {
        onStalled: () => setTilesStalled(true),
        onLoaded: () => setTilesStalled(false),
        onRecovering: () => {},
      });
    } else {
      mapRef.current.setCenter(center);
    }

    // Clear old markers
    markersRef.current.forEach(m => {
      if (typeof m.setMap === 'function') m.setMap(null);
      else if (typeof m.remove === 'function') m.remove();
    });
    markersRef.current = [];

    // Helper: create an OverlayView-based marker
    const createOverlay = (map: google.maps.Map, pos: google.maps.LatLngLiteral, content: HTMLElement, zIndex: number) => {
      const overlay = new google.maps.OverlayView();
      let container: HTMLDivElement | null = null;
      overlay.onAdd = () => {
        container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.zIndex = String(zIndex);
        container.appendChild(content);
        overlay.getPanes()?.overlayMouseTarget.appendChild(container);
      };
      overlay.draw = () => {
        if (!container) return;
        const proj = overlay.getProjection();
        if (!proj) return;
        const pt = proj.fromLatLngToDivPixel(new google.maps.LatLng(pos.lat, pos.lng));
        if (pt) {
          container.style.left = `${pt.x}px`;
          container.style.top = `${pt.y}px`;
          container.style.transform = 'translate(-50%, -100%)';
        }
      };
      overlay.onRemove = () => { container?.parentElement?.removeChild(container); container = null; };
      overlay.setMap(map);
      return overlay;
    };

    // Call marker (red pin)
    if (call?.latitude != null && call?.longitude != null && mapRef.current) {
      const m = createOverlay(mapRef.current, { lat: call.latitude, lng: call.longitude }, buildCallMarker(call.call_number || 'CALL'), 100);
      markersRef.current.push(m);
    }

    // Assigned unit markers (blue dots)
    // assigned_units contains numeric unit IDs as strings (from mapDbCall parsing assigned_unit_ids)
    const assignedUnits = units.filter(u =>
      call?.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null
    );

    for (const unit of assignedUnits) {
      if (mapRef.current) {
        const m = createOverlay(mapRef.current, { lat: unit.latitude!, lng: unit.longitude! }, buildUnitMarker(unit.call_sign), 50);
        markersRef.current.push(m);
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

  // Cleanup: unregister map instance + tile monitor on unmount
  useEffect(() => {
    return () => {
      if (tileMonitorRef.current) { tileMonitorRef.current(); tileMonitorRef.current = null; }
      if (mapRef.current) unregisterMapInstance(mapRef.current);
    };
  }, []);

  // ── Leaflet fallback when Google Maps fails (connectivity) ──
  if (showLeafletFallback) {
    // Build assigned unit positions for the fallback
    const assignedUnits = units
      .filter(u => call?.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null)
      .map(u => ({
        call_sign: u.call_sign,
        lat: u.latitude!,
        lng: u.longitude!,
        status: u.status,
      }));

    // Build active call for the fallback
    const fallbackCalls = call?.latitude != null && call?.longitude != null
      ? [{
          id: String(call.id),
          call_number: call.call_number || 'CALL',
          incident_type: call.incident_type || '',
          location_address: call.location || '',
          latitude: call.latitude,
          longitude: call.longitude,
          priority: call.priority || 'P3',
        }]
      : [];

    return (
      <div className="dispatch-minimap-container" style={{ position: 'relative', height: fullHeight ? '100%' : 180, borderTop: fullHeight ? undefined : '1px solid #161b21' }}>
        {/* Toolbar (same as online mode) */}
        <div style={{
          position: 'absolute', top: 4, left: 4, right: 4, zIndex: 1001,
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

        <OfflineMapFallback
          className="absolute inset-0"
          compact
          unitPositions={assignedUnits}
          activeCalls={fallbackCalls}
          onRetry={() => {
            setRetryingGmaps(true);
            setError(null);
            setLoaded(false);
            setGmapsRetry(n => n + 1);
            setTimeout(() => setRetryingGmaps(false), 5000);
          }}
          retrying={retryingGmaps}
        />
      </div>
    );
  }

  // ── Auth error (config problem, not connectivity) ──
  if (isAuthError) {
    return (
      <div className="dispatch-minimap-container" style={{ height: fullHeight ? '100%' : 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060c14' }}>
        <span className="text-[9px] text-rmpg-500">{error}</span>
      </div>
    );
  }

  return (
    <div className="dispatch-minimap-container" style={{ position: 'relative', height: fullHeight ? '100%' : 180, borderTop: fullHeight ? undefined : '1px solid #161b21' }}>
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
          background: 'rgba(0,0,0,0.9)', border: '1px solid #3b82f650',
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
          background: '#060c14',
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
