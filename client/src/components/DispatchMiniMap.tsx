// ============================================================
// RMPG Flex — Dispatch Mini-Map
// Lightweight embeddable Google Maps panel showing the selected
// call location and assigned unit positions. Used inline in the
// Dispatch right column.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, MapPin, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadGoogleMaps, DARK_MAP_STYLE, registerMapInstance, unregisterMapInstance, onOnlineRetryMaps } from '../utils/googleMapsLoader';
import type { CallForService, Unit } from '../types';

interface DispatchMiniMapProps {
  call: CallForService | null;
  units: Unit[];
  onClose?: () => void;
  /** When true, fills parent container height instead of fixed 180px */
  fullHeight?: boolean;
}

const DEFAULT_CENTER = { lat: 40.7608, lng: -111.891 }; // Salt Lake City fallback
const MINI_ZOOM = 15;

/** Build a call marker DOM element (red label with caret) */
function buildCallMarker(label: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;';

  const tag = document.createElement('div');
  tag.style.cssText =
    'background:#ef4444;color:#fff;font-size:9px;font-weight:900;' +
    "padding:2px 5px;border:1px solid #fff;white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;";
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
    'background:#3b82f6;color:#fff;font-size:8px;font-weight:900;' +
    "padding:1px 4px;border:1px solid #1e3a5f;white-space:nowrap;font-family:'JetBrains Mono',monospace;border-radius:2px;";
  el.textContent = callSign;
  return el;
}

export default function DispatchMiniMap({ call, units, onClose, fullHeight }: DispatchMiniMapProps) {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Google Maps script with retry + online auto-recovery
  useEffect(() => {
    const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string;
    if (!apiKey) {
      setError('Map key not configured');
      return;
    }

    let cancelled = false;

    function attemptLoad(attempt: number) {
      if (cancelled) return;
      loadGoogleMaps(apiKey)
        .then(() => { if (!cancelled) setLoaded(true); })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 3) {
            setTimeout(() => attemptLoad(attempt + 1), [3000, 6000, 12000][attempt]);
          } else {
            setError('Map load failed — check connection');
          }
        });
    }
    attemptLoad(0);

    // Auto-retry when device comes back online
    const unsubOnline = onOnlineRetryMaps(apiKey, () => {
      if (!cancelled && !loaded) { setError(null); setLoaded(true); }
    });

    return () => { cancelled = true; unsubOnline(); };
  }, []);

  // Initialize or update map
  useEffect(() => {
    if (!loaded || !mapContainerRef.current) return;

    const center = call?.latitude && call?.longitude
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
    if (call?.latitude && call?.longitude && mapRef.current) {
      const m = createOverlay(mapRef.current, { lat: call.latitude, lng: call.longitude }, buildCallMarker(call.call_number || 'CALL'), 100);
      markersRef.current.push(m);
    }

    // Assigned unit markers (blue dots)
    const assignedUnits = units.filter(u =>
      call?.assigned_units?.includes(u.call_sign) && u.latitude && u.longitude
    );

    for (const unit of assignedUnits) {
      if (mapRef.current) {
        const m = createOverlay(mapRef.current, { lat: unit.latitude!, lng: unit.longitude! }, buildUnitMarker(unit.call_sign), 50);
        markersRef.current.push(m);
      }
    }
  }, [loaded, call?.id, call?.latitude, call?.longitude, units]);

  // Cleanup: unregister map instance on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) unregisterMapInstance(mapRef.current);
    };
  }, []);

  if (error) {
    return (
      <div className="dispatch-minimap-container" style={{ height: fullHeight ? '100%' : 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="text-[9px] text-rmpg-500">{error}</span>
      </div>
    );
  }

  return (
    <div className="dispatch-minimap-container" style={{ position: 'relative', height: fullHeight ? '100%' : 180, borderTop: fullHeight ? undefined : '1px solid #141e2b' }}>
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
          <button
            onClick={() => navigate('/map')}
            className="text-rmpg-400 hover:text-white"
            style={{ background: 'rgba(0,0,0,0.7)', padding: '2px 4px', border: 'none', cursor: 'pointer' }}
            title="Open full map"
          >
            <Maximize2 style={{ width: 10, height: 10 }} />
          </button>
          {onClose && (
            <button
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

      {/* Map container */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Loading overlay */}
      {!loaded && !error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#060c14',
        }}>
          <RefreshCw style={{ width: 14, height: 14, color: '#555' }} className="animate-spin" />
        </div>
      )}
    </div>
  );
}
