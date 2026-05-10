// ============================================================
// RMPG Flex — Mapbox Dispatch Mini-Map
// ============================================================
// Lightweight embeddable Mapbox GL panel showing the selected
// call location and assigned unit positions. Used inline in the
// Dispatch right column when Mapbox is the active map engine.
//
// This is a companion to DispatchMiniMap.tsx (Google Maps version).
// The dispatch page auto-selects based on the active map engine.
// ============================================================

import { useEffect, useRef, useState, useMemo } from 'react';
import { Maximize2, MapPin, Navigation, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '../utils/mapboxApiKey';
import { injectMapboxStyles } from '../utils/mapboxLoader';
import { UNIT_STATUS_HEX, PRIORITY_HEX } from '../utils/statusColors';
import IconButton from './IconButton';
import type { CallForService, Unit, UnitStatus } from '../types';

const MINI_PRIORITY_COLORS: Record<string, string> = PRIORITY_HEX;

interface MapboxMiniMapProps {
  call: CallForService | null;
  units: Unit[];
  onClose?: () => void;
  fullHeight?: boolean;
  onRouteUpdate?: (info: { unitCallSign: string; callNumber: string; eta: string; distance: string } | null) => void;
}

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608];
const MINI_ZOOM = 15;

/** Build a call marker DOM element with priority-colored badge */
function buildCallMarkerEl(label: string, priority?: string): HTMLElement {
  const color = MINI_PRIORITY_COLORS[priority || ''] || '#ef4444';
  const el = document.createElement('div');
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;
    filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6));cursor:pointer;
  `;

  const tag = document.createElement('div');
  tag.style.cssText = `
    background:${color};color:#fff;font-size:7px;font-weight:900;
    padding:2px 4px;border:1.5px solid rgba(255,255,255,0.9);
    white-space:nowrap;font-family:'JetBrains Mono',monospace;
    letter-spacing:0.03em;border-radius:1px;
    box-shadow:0 0 8px ${color}50;
  `;
  tag.textContent = label;

  const caret = document.createElement('div');
  caret.style.cssText = `
    width:0;height:0;border-left:5px solid transparent;
    border-right:5px solid transparent;border-top:7px solid ${color};
  `;

  el.appendChild(tag);
  el.appendChild(caret);
  return el;
}

/** Build a unit marker DOM element */
function buildUnitMarkerEl(callSign: string, status?: UnitStatus): HTMLElement {
  const color = UNIT_STATUS_HEX[status || 'available'] || '#888888';
  const el = document.createElement('div');
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;
    filter:drop-shadow(0 1px 4px rgba(0,0,0,0.5));cursor:pointer;
  `;

  const tag = document.createElement('div');
  tag.style.cssText = `
    background:${color};color:#fff;font-size:8px;font-weight:900;
    padding:2px 5px;border:1.5px solid rgba(255,255,255,0.8);
    white-space:nowrap;font-family:'JetBrains Mono',monospace;
    border-radius:1px;box-shadow:0 0 6px ${color}40;
  `;
  tag.textContent = callSign;

  const caret = document.createElement('div');
  caret.style.cssText = `
    width:0;height:0;border-left:4px solid transparent;
    border-right:4px solid transparent;border-top:5px solid ${color};
  `;

  el.appendChild(tag);
  el.appendChild(caret);
  return el;
}

export default function MapboxMiniMap({ call, units, onClose, fullHeight, onRouteUpdate }: MapboxMiniMapProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignedUnits = useMemo(() =>
    units.filter(u =>
      call?.assigned_units?.includes(String(u.id)) && u.latitude != null && u.longitude != null
    ),
    [units, call?.assigned_units],
  );

  // Initialize Mapbox map
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    injectMapboxStyles();

    const init = async () => {
      try {
        const token = await getMapboxToken();
        if (!token || cancelled) {
          if (!cancelled) setError('Mapbox token not configured');
          return;
        }

        mapboxgl.accessToken = token;

        const map = new mapboxgl.Map({
          container: containerRef.current!,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: DEFAULT_CENTER,
          zoom: MINI_ZOOM,
          interactive: true,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
        });

        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        map.on('load', () => {
          if (!cancelled) {
            setLoaded(true);
            setError(null);
          }
        });

        map.on('error', (e: mapboxgl.ErrorEvent) => {
          if (!cancelled) {
            setError(e.error?.message || 'Map error');
          }
        });

        mapRef.current = map;
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load map');
      }
    };

    init();

    return () => {
      cancelled = true;
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setLoaded(false);
    };
  }, []);

  // Update markers when call/units change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    // Clear existing markers
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;

    // Call marker
    if (call?.latitude && call?.longitude) {
      const el = buildCallMarkerEl(
        call.call_number || call.incident_type || 'CALL',
        call.priority
      );
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([call.longitude, call.latitude])
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([call.longitude, call.latitude]);
      hasPoints = true;
    }

    // Unit markers
    for (const unit of assignedUnits) {
      if (unit.latitude == null || unit.longitude == null) continue;
      const el = buildUnitMarkerEl(unit.call_sign, unit.status as UnitStatus);
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([unit.longitude!, unit.latitude!])
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([unit.longitude!, unit.latitude!]);
      hasPoints = true;
    }

    // Fit bounds
    if (hasPoints) {
      if (markersRef.current.length === 1) {
        const lngLat = markersRef.current[0].getLngLat();
        map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: MINI_ZOOM, duration: 800 });
      } else {
        map.fitBounds(bounds, { padding: 40, duration: 800, maxZoom: 16 });
      }
    }
  }, [call, assignedUnits, loaded]);

  return (
    <div className={`relative bg-[#0a0a0a] border border-[#222] overflow-hidden ${fullHeight ? 'h-full' : 'h-[180px]'}`}>
      {/* Map container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-b from-[#0a0a0a]/90 to-transparent z-10">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3 h-3 text-[#d4a017]" />
          <span className="text-[9px] font-semibold text-[#ccc] tracking-wide">
            MAPBOX
          </span>
          {assignedUnits.length > 0 && (
            <span className="text-[8px] text-[#888]">
              · {assignedUnits.length} unit{assignedUnits.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            onClick={() => navigate('/map')}
            aria-label="Open full map"
            className="p-0.5 text-[#888] hover:text-[#d4a017] transition-colors"
          >
            <Maximize2 className="w-3 h-3" />
          </IconButton>
        </div>
      </div>

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/90 z-20">
          <div className="text-center px-4">
            <WifiOff className="w-5 h-5 text-[#666] mx-auto mb-1" />
            <p className="text-[9px] text-[#888] leading-tight">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a] z-20">
          <RefreshCw className="w-4 h-4 text-[#d4a017] animate-spin" />
        </div>
      )}
    </div>
  );
}
