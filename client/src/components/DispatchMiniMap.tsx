// ============================================================
// RMPG Flex — Dispatch Mini-Map
// Lightweight embeddable Google Maps panel showing the selected
// call location and assigned unit positions. Used inline in the
// Dispatch right column.
//
// When Google Maps fails to load (vehicle WiFi dead zones), falls
// back to a compact Leaflet map using pre-cached offline tiles.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Maximize2, MapPin, RefreshCw, Navigation } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadGoogleMaps, DARK_MAP_STYLE, registerMapInstance, unregisterMapInstance, onOnlineRetryMaps, monitorTileLoading } from '../utils/googleMapsLoader';
import { getGoogleMapsApiKey, getGoogleMapsApiKeyErrorMessage } from '../utils/googleMapsApiKey';
import { useMapRouting } from '../hooks/useMapRouting';
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
}

const DEFAULT_CENTER = { lat: 40.7608, lng: -111.891 }; // Salt Lake City fallback
const MINI_ZOOM = 15;

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
  const [mapHeading, setMapHeading] = useState(0);
  const headingListenerRef = useRef<google.maps.MapsEventListener | null>(null);

  // Inject keyframes on mount
  useEffect(() => { injectMinimapKeyframes(); }, []);

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

      // Track heading for compass indicator
      headingListenerRef.current = google.maps.event.addListener(map, 'heading_changed', () => {
        setMapHeading(map.getHeading?.() || 0);
      });

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

    // Call marker (priority-colored pin)
    if (call?.latitude != null && call?.longitude != null && mapRef.current) {
      const m = createOverlay(mapRef.current, { lat: call.latitude, lng: call.longitude }, buildCallMarker(call.call_number || 'CALL', (call as any).priority), 100);
      markersRef.current.push(m);
    }

    // Assigned unit markers (status-colored)
    // assigned_units contains numeric unit IDs as strings (from mapDbCall parsing assigned_unit_ids)
    const assignedUnits = units.filter(u =>
      call?.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null
    );

    for (const unit of assignedUnits) {
      if (mapRef.current) {
        const m = createOverlay(mapRef.current, { lat: unit.latitude!, lng: unit.longitude! }, buildUnitMarker(unit.call_sign, (unit as any).status), 50);
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

  // Cleanup: unregister map instance + tile monitor + heading listener on unmount
  useEffect(() => {
    return () => {
      if (tileMonitorRef.current) { tileMonitorRef.current(); tileMonitorRef.current = null; }
      if (headingListenerRef.current) { google.maps.event.removeListener(headingListenerRef.current); headingListenerRef.current = null; }
      if (mapRef.current) unregisterMapInstance(mapRef.current);
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

      {/* Tile stall badge with signal indicator */}
      {loaded && tilesStalled && (
        <div style={{
          position: 'absolute', bottom: activeRoute ? 36 : 4, right: 4, zIndex: 10,
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.85)', border: '1px solid #f59e0b40',
            backdropFilter: 'blur(4px)',
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
