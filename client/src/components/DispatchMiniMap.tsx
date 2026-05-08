// ============================================================
// RMPG Flex — Dispatch Mini-Map
// Lightweight embeddable Google Maps panel showing the selected
// call location and assigned unit positions. Used inline in the
// Dispatch right column.
//
// When Google Maps fails to load (vehicle WiFi dead zones), falls
// back to a compact Leaflet map using pre-cached offline tiles.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, MapPin, RefreshCw, Radar, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadGoogleMaps, DARK_MAP_STYLE, registerMapInstance, unregisterMapInstance, onOnlineRetryMaps, monitorTileLoading } from '../utils/googleMapsLoader';
import { getGoogleMapsApiKey, getGoogleMapsApiKeyErrorMessage } from '../utils/googleMapsApiKey';
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

const DEFAULT_CENTER = { lat: 40.7608, lng: -111.891 }; // Salt Lake City fallback
const MINI_ZOOM = 15;

// Inject pulse keyframes once
function injectPulseStyle() {
  if (document.querySelector('style[data-rmpg-minimap-anim]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-rmpg-minimap-anim', 'true');
  style.textContent = `
    @keyframes rmpg-call-pulse {
      0% { transform:scale(1); opacity:0.7; }
      100% { transform:scale(2.2); opacity:0; }
    }
    @keyframes rmpg-radar-sweep {
      0% { transform:rotate(0deg); }
      100% { transform:rotate(360deg); }
    }
    @keyframes rmpg-eta-fill {
      0% { width:0%; }
      100% { width:100%; }
    }
  `;
  document.head.appendChild(style);
}

/** Build a call marker DOM element (red label with pulsing ring + caret) */
function buildCallMarker(label: string): HTMLElement {
  injectPulseStyle();
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;position:relative;';

  // Pulsing ring behind marker
  const pulse = document.createElement('div');
  pulse.style.cssText =
    'position:absolute;top:50%;left:50%;width:16px;height:16px;' +
    'border:2px solid rgba(239,68,68,0.6);border-radius:50%;' +
    'transform:translate(-50%,-50%);' +
    'animation:rmpg-call-pulse 1.8s ease-out infinite;pointer-events:none;';
  wrapper.appendChild(pulse);

  const tag = document.createElement('div');
  tag.style.cssText =
    'background:#ef4444;color:#fff;font-size:7px;font-weight:900;' +
    "padding:1px 3px;border:1px solid #fff;white-space:nowrap;font-family:'JetBrains Mono',monospace;" +
    'letter-spacing:0.03em;box-shadow:0 1px 6px rgba(239,68,68,0.5);position:relative;z-index:1;';
  tag.textContent = label;

  const caret = document.createElement('div');
  caret.style.cssText =
    'width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;' +
    'border-top:6px solid #ef4444;position:relative;z-index:1;';

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

/** Build a unit marker DOM element (status-tinted chip with glow) */
function buildUnitMarker(callSign: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'background:linear-gradient(180deg,#2a2a2a,#1a1a1a);color:#e0e0e0;font-size:8px;font-weight:900;' +
    "padding:1px 5px;border:1px solid #d4a01780;white-space:nowrap;font-family:'JetBrains Mono',monospace;" +
    'border-radius:2px;box-shadow:0 0 6px rgba(212,160,23,0.25),0 2px 4px rgba(0,0,0,0.5);' +
    'letter-spacing:0.03em;';
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
  const [gmapsRetry, setGmapsRetry] = useState(0);
  const tileMonitorRef = useRef<(() => void) | null>(null);

  const visibleUnitCount = useMemo(() =>
    units.filter(u =>
      call?.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null
    ).length,
    [units, call?.assigned_units],
  );

  // Classify error: auth/config vs connectivity
  // Google Maps is the sole map surface — every error becomes an auth/config
  // error placeholder (Leaflet/CartoDB fallback retired 2026-04-29).
  const isAuthError = error != null;

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
      // Auth/quota failure leaves a stub Map whose getDiv() is undefined —
      // route to the offline fallback rather than crashing the error boundary.
      if (!map || typeof map.getDiv !== 'function' || !map.getDiv()) {
        setError('Map load failed — check connection');
        return;
      }
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
        <div style={{
          background: 'rgba(0,0,0,0.85)', pointerEvents: 'auto',
          padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4,
          border: '1px solid #141414', borderRadius: 2,
        }}>
          <Radar style={{
            width: 10, height: 10, color: '#d4a017',
            animation: 'rmpg-radar-sweep 3s linear infinite',
          }} />
          <span style={{
            fontSize: 8, fontWeight: 900, color: '#d4a017',
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em',
          }}>
            {call?.call_number || 'TACT-MAP'}
          </span>
          {visibleUnitCount > 0 && (
            <span style={{
              fontSize: 7, color: '#888', fontFamily: "'JetBrains Mono', monospace",
              borderLeft: '1px solid #333', paddingLeft: 4,
            }}>
              {visibleUnitCount}U
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          <button type="button"
            onClick={() => navigate('/map')}
            className="text-rmpg-400 hover:text-white"
            style={{ background: 'rgba(0,0,0,0.85)', padding: '2px 4px', border: '1px solid #141414', cursor: 'pointer', borderRadius: 2 }}
            title="Open full map"
          >
            <Maximize2 style={{ width: 10, height: 10 }} />
          </button>
          {onClose && (
            <button type="button"
              onClick={onClose}
              className="text-rmpg-400 hover:text-white"
              style={{ background: 'rgba(0,0,0,0.85)', padding: '2px 4px', border: '1px solid #141414', cursor: 'pointer', borderRadius: 2 }}
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
          background: 'rgba(0,0,0,0.92)', borderLeft: '2px solid #d4a017',
          border: '1px solid #1a1a1a', borderRadius: 2,
          padding: '3px 8px 5px 8px', display: 'flex', flexDirection: 'column', gap: 2,
          minWidth: 80,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin style={{ width: 7, height: 7, color: '#d4a017', flexShrink: 0 }} />
            <span style={{ fontSize: 8, color: '#aaaaaa', fontWeight: 900, fontFamily: "'JetBrains Mono', monospace" }}>
              {activeRoute.unitCallSign}→{activeRoute.callNumber}
            </span>
            <span style={{ fontSize: 9, color: '#fff', fontWeight: 900, marginLeft: 'auto' }}>{activeRoute.eta}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              flex: 1, height: 2, background: '#1a1a1a', borderRadius: 1, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', background: 'linear-gradient(90deg, #d4a017, #ef4444)',
                animation: 'rmpg-eta-fill 8s ease-in-out infinite alternate',
                borderRadius: 1,
              }} />
            </div>
            <span style={{ fontSize: 7, color: '#555', fontFamily: "'JetBrains Mono', monospace" }}>{activeRoute.distance}</span>
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

      {/* Tile stall badge with signal indicator */}
      {loaded && tilesStalled && (
        <div style={{
          position: 'absolute', bottom: activeRoute ? 36 : 4, right: 4, zIndex: 10,
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.9)', border: '1px solid #f59e0b40',
            padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4,
            borderRadius: 2,
          }}>
            <WifiOff style={{ width: 8, height: 8, color: '#f59e0b' }} />
            <span style={{ fontSize: 8, color: '#f59e0b', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
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
