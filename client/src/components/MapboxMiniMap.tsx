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
import { useNavigate } from 'react-router';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '../utils/mapboxApiKey';
import { injectMapboxStyles, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { UNIT_STATUS_HEX, priorityHex, CALL_MARKER_INK } from '../utils/statusColors';
import { withAlpha } from '../utils/withAlpha';
import { isValidLngLat } from '../pages/map/utils/mapMarkers';
import IconButton from './IconButton';
import { useWebglMapRecovery } from '../hooks/useWebglMapRecovery';
import type { CallForService, Unit, UnitStatus } from '../types';

// `call.assigned_units` can arrive as id strings/numbers OR as full unit
// objects (the call-detail endpoint returns objects). Normalize to a Set of
// id-strings so assigned-unit matching works either way — `.includes(String(u.id))`
// is always false when the array holds objects, which silently dropped every
// assigned unit marker (and the map's fit-bounds) for a selected call. Mirrors
// assignedUnitIdSet() in DispatchMiniMap.tsx.
function assignedUnitIdSet(call: { assigned_units?: unknown } | null | undefined): Set<string> {
  const a = (call as { assigned_units?: unknown } | null | undefined)?.assigned_units;
  if (!Array.isArray(a)) return new Set();
  return new Set(a.map((x) => String(x && typeof x === 'object' ? (x as { id: unknown }).id : x)));
}

interface MapboxMiniMapProps {
  call: CallForService | null;
  units: Unit[];
  onClose?: () => void;
  fullHeight?: boolean;
  onRouteUpdate?: (info: { unitCallSign: string; callNumber: string; eta: string; distance: string } | null) => void;
}

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608];
const MINI_ZOOM = 15;
const TOKEN_TIMEOUT_MS = 8_000;
const MAX_INIT_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 3_000;

/** Build a call marker DOM element with priority-colored badge */
export function buildCallMarkerEl(label: string, priority?: string): HTMLElement {
  const color = priorityHex(priority);
  const el = document.createElement('div');
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;
    filter:drop-shadow(0 2px 6px rgba(var(--surface-overlay-rgb) / 0.8));cursor:pointer;
  `;

  const tag = document.createElement('div');
  tag.style.cssText = `
    background:${color};color:${CALL_MARKER_INK};font-size:7px;font-weight:900;
    padding:2px 4px;border:1.5px solid ${CALL_MARKER_INK};
    white-space:nowrap;font-family:'Arial, sans-serif';
    letter-spacing:0.03em;border-radius:1px;
    box-shadow:0 0 8px ${withAlpha(color, '50')};
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

/** Build a fixed-orientation photo-icon unit marker: vehicle photo + status ring + call-sign label. Never rotates. */
function buildUnitMarkerEl(callSign: string, status?: UnitStatus): HTMLElement {
  const color = UNIT_STATUS_HEX[status || 'available'] || 'var(--text-muted)';
  const el = document.createElement('div');
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;gap:2px;
    filter:drop-shadow(0 1px 4px rgba(var(--surface-overlay-rgb) / 0.7));cursor:pointer;
  `;

  const photoFrame = document.createElement('div');
  photoFrame.style.cssText = `
    width:40px;height:40px;border-radius:4px;overflow:hidden;
    border:3px solid ${color};box-shadow:0 0 6px ${withAlpha(color, '80')};
    background:var(--surface-overlay);
  `;
  const img = document.createElement('img');
  img.src = '/icons/unit-vehicle.png';
  img.alt = '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  img.onerror = () => {
    photoFrame.style.background = color;
    img.remove();
  };
  photoFrame.appendChild(img);
  el.appendChild(photoFrame);

  const tag = document.createElement('div');
  tag.style.cssText = `
    background:var(--surface-overlay);color:${color};font-size:8px;font-weight:900;
    padding:1px 5px;border:1.2px solid ${color};
    white-space:nowrap;font-family:'Arial, sans-serif';
    border-radius:1px;
  `;
  tag.textContent = callSign;
  el.appendChild(tag);

  return el;
}

// NOTE: this file used to define a local steel-blue theming helper that
// recolored 'background' and 'water' to near-black values. It ran on the map's
// 'load' event — i.e. AFTER applyRmpgBasemap() had already run on 'style.load' —
// so it silently overwrote two colors of the shared MAP_PALETTE with its own
// near-black values (see MAP_PALETTE in utils/mapboxBasemap.ts for canonical colors).
// The result was a dispatch mini-map noticeably darker than the Map module showing
// the same city. Deleted rather than reconciled: applyRmpgBasemap already sets
// background and water, plus the gold arterials, silver roads and label ramp
// that the local helper never touched. MAP_PALETTE in utils/mapboxBasemap.ts is
// the single source of map color truth.

export default function MapboxMiniMap({ call, units, onClose, fullHeight, onRouteUpdate }: MapboxMiniMapProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();

  // With a call selected, show only units assigned to it (existing
  // behavior). With no call selected — e.g. the CAD board before a call is
  // picked — fall back to every unit with a GPS fix so the map isn't blank.
  const assignedUnits = useMemo(() => {
    const assignedIds = assignedUnitIdSet(call);
    return units.filter(u => {
      if (u.latitude == null || u.longitude == null) return false;
      if (!call) return true;
      return assignedIds.has(String(u.id)) ||
        (u.current_call_id != null && String(u.current_call_id) === String(call.id));
    });
  }, [units, call]);

  // Initialize Mapbox map
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    injectMapboxStyles();

    const init = async (attempt = 1) => {
      try {
        // Timeout token fetch to prevent infinite hang
        const tokenPromise = getMapboxToken();
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS));
        const token = await Promise.race([tokenPromise, timeoutPromise]);
        if (!token || cancelled) {
          if (!cancelled) {
            if (attempt < MAX_INIT_ATTEMPTS) {
              setTimeout(() => { if (!cancelled) init(attempt + 1); }, attempt * BACKOFF_BASE_MS);
            } else {
              setError('Mapbox token not configured');
            }
          }
          return;
        }

        if (!containerRef.current || cancelled) return;

        mapboxgl.accessToken = token;

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: DEFAULT_CENTER,
          zoom: MINI_ZOOM,
          projection: 'mercator',
          interactive: true,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
        });

        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));

        map.on('load', () => {
          if (!cancelled) {
            onMapLoaded(map);
            setLoaded(true);
            setError(null);
          }
        });

        map.on('error', (e: mapboxgl.ErrorEvent) => {
          if (!cancelled) {
            setError(e.error instanceof Error ? e.error.message : 'Map error');
          }
        });

        mapRef.current = map;
        webglRecoveryCleanupRef.current = attach(map, 'MapboxMiniMap');
        // Registers this instance with mapboxLoader's shared print-swap
        // registry — its module-level `beforeprint`/`afterprint` listeners
        // (wired once at import time) swap every REGISTERED map to a light
        // style and back. This mini-map never called it, so its dark style
        // printed as-is (illegible dark tiles on white paper).
        registerMapInstance(map, 'mapbox://styles/mapbox/dark-v11');

        // Mapbox GL sizes its WebGL canvas to the container's dimensions AT
        // CONSTRUCTION TIME and never re-syncs on its own. This mini-map sits
        // inside a densely-nested, conditionally-rendered dispatch flex
        // layout (sibling panels — code quick-panel, detail pane — mount/
        // unmount and change how much width this panel actually gets), so
        // the container can settle to its real size on a LATER layout pass
        // than the one active when `new mapboxgl.Map()` ran above. Without
        // an explicit resize(), the canvas stays locked to whatever (often
        // zero/wrong) size it read at construction — Mapbox then renders a
        // solid black canvas, which is exactly what this fixes.
        const resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(containerRef.current);
        resizeObserverRef.current = resizeObserver;
      } catch (err) {
        if (!cancelled) {
          if (attempt < MAX_INIT_ATTEMPTS) {
            setTimeout(() => { if (!cancelled) init(attempt + 1); }, attempt * BACKOFF_BASE_MS);
          } else {
            setError(err instanceof Error ? err.message : 'Failed to load map');
          }
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      if (mapRef.current) {
        unregisterMapInstance(mapRef.current);
        mapRef.current.remove();
        mapRef.current = null;
      }
      setLoaded(false);
    };
  }, [rebuildNonce]);

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
    if (call != null && isValidLngLat(call.longitude, call.latitude)) {
      const el = buildCallMarkerEl(
        call.call_number || call.incident_type || 'CALL',
        call.priority
      );
      // `anchor: 'bottom'` — this builder renders a tag with a downward caret,
      // so the caret TIP is the thing claiming the coordinate. Left at Mapbox's
      // default ('center') the pin was centered on the tag instead, planting the
      // call roughly half a badge north of its real address and shifting it
      // again whenever the label text changed length (call_number vs the
      // incident_type fallback). DispatchMiniMap's identical caret pin already
      // anchors 'bottom'; this brings the two surfaces into agreement.
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([call.longitude!, call.latitude!])
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([call.longitude!, call.latitude!]);
      hasPoints = true;
    }

    // Unit markers
    for (const unit of assignedUnits) {
      if (!isValidLngLat(unit.longitude, unit.latitude)) continue;
      const el = buildUnitMarkerEl(unit.call_sign, unit.status as UnitStatus);
      // Explicit 'bottom' to match DispatchMiniMap's unit convention (and the
      // call pin above) rather than relying on the implicit 'center' default,
      // which silently re-centers the whole photo+label stack if the label ever
      // changes size.
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
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
    <div className={`relative bg-surface-overlay border border-border-default overflow-hidden ${fullHeight ? 'h-full' : 'h-[180px]'}`}>
      {/* Map container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* REMOVED 2026-07-31: a `.mapboxgl-canvas { filter: grayscale(.4)
          sepia(.6) hue-rotate(178deg) saturate(2.4) brightness(.85) }` block
          used to live here to fake a steel-blue basemap.

          It predated applyRmpgBasemap/MAP_PALETTE, which now produce that look
          natively and with MEASURED contrast (see MAP_PALETTE in mapboxBasemap.ts
          for the canonical navy/gold/silver values). Running a hue-rotate
          over the finished canvas destroyed every one of those values.

          Worse, the selector was global. A bare `.mapboxgl-canvas` inside JSX
          is not scoped to this component — while any dispatch mini-map was
          mounted it tinted EVERY Mapbox canvas in the document, the Map module
          included, and the tint appeared/vanished as mini-maps mounted and
          unmounted. Do not reintroduce canvas filters; change MAP_PALETTE. */}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-b from-surface-overlay/90 to-transparent z-10">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3 h-3 [color:var(--panel-header-color)]" />
          <span className="text-[9px] font-semibold text-rmpg-200 tracking-wide">
            MAPBOX
          </span>
          {assignedUnits.length > 0 && (
            <span className="text-[8px] text-fg-muted">
              · {assignedUnits.length} unit{assignedUnits.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            onClick={() => navigate('/map')}
            aria-label="Open full map"
            className="p-0.5 text-fg-muted hover:text-accent-silver-400 transition-colors"
          >
            <Maximize2 className="w-3 h-3" />
          </IconButton>
        </div>
      </div>

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-overlay/90 z-20">
          <div className="text-center px-4">
            <WifiOff className="w-5 h-5 text-fg-muted mx-auto mb-1" />
            <p className="text-[9px] text-fg-muted leading-tight">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-overlay z-20">
          <RefreshCw className="w-4 h-4 [color:var(--panel-header-color)] animate-spin" />
        </div>
      )}
    </div>
  );
}
