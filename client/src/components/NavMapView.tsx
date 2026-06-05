// ============================================================
// RMPG Flex — Nav Map View
// Lightweight Mapbox mini-map for the NavPage. Shows the officer's
// current GPS position, breadcrumb trail, and recenter / style
// controls. No dispatch data, no routing — just "where am I, where
// have I been".
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Crosshair, Layers, ZoomIn, ZoomOut, Trash2, MapPin, AlertCircle,
} from 'lucide-react';
import {
  initMapbox, mapboxgl, MAPBOX_STYLE_DARK, MAPBOX_STYLE_SATELLITE,
  MAPBOX_STYLE_STREETS,
} from '../utils/mapboxLoader';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../utils/mapboxApiKey';
import type { NavRoutePoint } from '../types';

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608]; // Salt Lake City [lng, lat]
const DEFAULT_ZOOM = 15;
const TRAIL_SOURCE_ID = 'nav-trail-src';
const TRAIL_LAYER_ID = 'nav-trail-line';
const POSITION_SOURCE_ID = 'nav-pos-src';
const POSITION_LAYER_ID = 'nav-pos-dot';
const POSITION_HALO_LAYER_ID = 'nav-pos-halo';
const PIN_SOURCE_ID = 'nav-pin-src';
const PIN_LAYER_ID = 'nav-pin-dot';
const PIN_HALO_LAYER_ID = 'nav-pin-halo';

const STYLE_OPTIONS: { value: 'dark' | 'satellite' | 'streets'; label: string; url: string }[] = [
  { value: 'dark', label: 'Dark', url: MAPBOX_STYLE_DARK },
  { value: 'satellite', label: 'Satellite', url: MAPBOX_STYLE_SATELLITE },
  { value: 'streets', label: 'Streets', url: MAPBOX_STYLE_STREETS },
];

export interface DroppedPin {
  lat: number;
  lng: number;
  label: string;
  color: string;
  created_at: string;
}

export interface NavMapViewProps {
  /** Current GPS position (live from useGpsTracking) */
  position: { latitude: number; longitude: number; accuracy?: number | null } | null;
  /** Breadcrumb points from the active trip (optional) */
  routePoints?: NavRoutePoint[];
  /** Fixed height in pixels (default 240) */
  height?: number;
  /** Show style toggle / recenter / drop-pin controls (default true) */
  showControls?: boolean;
  /** Initial map style (default 'dark') */
  initialStyle?: 'dark' | 'satellite' | 'streets';
  /** Called when a quick pin is dropped at the current position */
  onDropPin?: (pin: DroppedPin) => void;
  /** Pinned dropped during this session (for visualization) */
  pins?: DroppedPin[];
  /** Optional: a polyline to show beyond breadcrumbs (e.g. recent trip end → start) */
  extraPath?: Array<{ lat: number; lng: number }>;
}

export default function NavMapView({
  position, routePoints, height = 240, showControls = true,
  initialStyle = 'dark', onDropPin, pins = [], extraPath,
}: NavMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<'dark' | 'satellite' | 'streets'>(initialStyle);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [userPanned, setUserPanned] = useState(false);
  const positionMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // ── Initialize mapbox + create map ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        if (!token) {
          setError(getMapboxTokenErrorMessage());
          return;
        }
        initMapbox(token);
        if (!mapContainerRef.current) return;

        const initialUrl = STYLE_OPTIONS.find((s) => s.value === style)?.url ?? MAPBOX_STYLE_DARK;
        const initialCenter: [number, number] = position
          ? [position.longitude, position.latitude]
          : DEFAULT_CENTER;

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: initialUrl,
          center: initialCenter,
          zoom: DEFAULT_ZOOM,
          attributionControl: false,
          // 2D-only — no pitch, no rotation, no 3D. The NavPage mini-map is for
          // glanceable position + breadcrumb, not a chase cam.
          pitch: 0,
          bearing: 0,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });

        map.addControl(new mapboxgl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        // Track when user pans so we know to stop auto-recentering
        map.on('dragstart', () => setUserPanned(true));

        map.on('load', () => {
          if (cancelled) return;
          // Breadcrumb trail
          map.addSource(TRAIL_SOURCE_ID, {
            type: 'geojson',
            lineMetrics: true,
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
          });
          map.addLayer({
            id: TRAIL_LAYER_ID,
            type: 'line',
            source: TRAIL_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#d4a017',
              'line-width': 3,
              'line-opacity': 0.85,
            },
          });
          // Position dot (gold pulse halo)
          map.addSource(POSITION_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: initialCenter } },
          });
          map.addLayer({
            id: POSITION_HALO_LAYER_ID,
            type: 'circle',
            source: POSITION_SOURCE_ID,
            paint: {
              'circle-radius': 16,
              'circle-color': '#d4a017',
              'circle-opacity': 0.18,
              'circle-stroke-color': '#d4a017',
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.4,
            },
          });
          map.addLayer({
            id: POSITION_LAYER_ID,
            type: 'circle',
            source: POSITION_SOURCE_ID,
            paint: {
              'circle-radius': 6,
              'circle-color': '#d4a017',
              'circle-stroke-color': '#000',
              'circle-stroke-width': 2,
            },
          });
          // Dropped pins
          map.addSource(PIN_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: PIN_HALO_LAYER_ID,
            type: 'circle',
            source: PIN_SOURCE_ID,
            paint: {
              'circle-radius': 14,
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.2,
            },
          });
          map.addLayer({
            id: PIN_LAYER_ID,
            type: 'circle',
            source: PIN_SOURCE_ID,
            paint: {
              'circle-radius': 7,
              'circle-color': ['get', 'color'],
              'circle-stroke-color': '#000',
              'circle-stroke-width': 2,
            },
          });

          if (cancelled) {
            map.remove();
            return;
          }
          mapRef.current = map;
          setMapReady(true);
        });

        map.on('error', (e) => {
          console.warn('[NavMapView] mapbox error:', e?.error?.message || e);
        });
      } catch (err: any) {
        if (cancelled) return;
        console.error('[NavMapView] init failed:', err);
        setError(err?.message || 'Map failed to load');
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Style change ───────────────────────────────────────────
  const handleStyleChange = useCallback((next: 'dark' | 'satellite' | 'streets') => {
    const target = STYLE_OPTIONS.find((s) => s.value === next)?.url;
    if (!target || !mapRef.current) return;
    setStyle(next);
    setStyleMenuOpen(false);
    try {
      mapRef.current.setStyle(target);
      // Layers need to be re-added after setStyle; the load handler won't fire
      // for the same map instance. We add them on the next 'styledata' event.
      const onStyledata = () => {
        if (!mapRef.current) return;
        const m = mapRef.current;
        if (!m.getSource(TRAIL_SOURCE_ID)) {
          m.addSource(TRAIL_SOURCE_ID, {
            type: 'geojson',
            lineMetrics: true,
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
          });
          m.addLayer({
            id: TRAIL_LAYER_ID, type: 'line', source: TRAIL_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#d4a017', 'line-width': 3, 'line-opacity': 0.85 },
          });
        }
        if (!m.getSource(POSITION_SOURCE_ID)) {
          m.addSource(POSITION_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: m.getCenter().toArray() } },
          });
          m.addLayer({ id: POSITION_HALO_LAYER_ID, type: 'circle', source: POSITION_SOURCE_ID, paint: { 'circle-radius': 16, 'circle-color': '#d4a017', 'circle-opacity': 0.18, 'circle-stroke-color': '#d4a017', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.4 } });
          m.addLayer({ id: POSITION_LAYER_ID, type: 'circle', source: POSITION_SOURCE_ID, paint: { 'circle-radius': 6, 'circle-color': '#d4a017', 'circle-stroke-color': '#000', 'circle-stroke-width': 2 } });
        }
        if (!m.getSource(PIN_SOURCE_ID)) {
          m.addSource(PIN_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          m.addLayer({ id: PIN_HALO_LAYER_ID, type: 'circle', source: PIN_SOURCE_ID, paint: { 'circle-radius': 14, 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 } });
          m.addLayer({ id: PIN_LAYER_ID, type: 'circle', source: PIN_SOURCE_ID, paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#000', 'circle-stroke-width': 2 } });
        }
        m.off('styledata', onStyledata);
      };
      mapRef.current.on('styledata', onStyledata);
    } catch (err) {
      console.warn('[NavMapView] setStyle failed:', err);
    }
  }, []);

  // ── Update position dot ────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || !position) return;
    const src = mapRef.current.getSource(POSITION_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
    });
    if (!userPanned) {
      mapRef.current.easeTo({
        center: [position.longitude, position.latitude],
        duration: 600,
      });
    }
  }, [mapReady, position, userPanned]);

  // ── Update breadcrumb trail ────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource(TRAIL_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const coords: Array<[number, number]> = [];
    if (routePoints && routePoints.length) {
      for (const p of routePoints) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          coords.push([p.lng, p.lat]);
        }
      }
    }
    if (extraPath && extraPath.length) {
      for (const p of extraPath) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          coords.push([p.lng, p.lat]);
        }
      }
    }
    if (position && coords.length) {
      coords.push([position.longitude, position.latitude]);
    }
    src.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    });
  }, [mapReady, routePoints, extraPath, position]);

  // ── Update dropped pins ────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource(PIN_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: pins.map((p) => ({
        type: 'Feature',
        properties: { color: p.color, label: p.label },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    });
  }, [mapReady, pins]);

  // ── Recenter ───────────────────────────────────────────────
  const handleRecenter = useCallback(() => {
    if (!mapRef.current || !position) return;
    mapRef.current.flyTo({
      center: [position.longitude, position.latitude],
      zoom: 16,
      essential: true,
    });
    setUserPanned(false);
  }, [position]);

  // ── Zoom in / out ──────────────────────────────────────────
  const handleZoom = useCallback((delta: number) => {
    if (!mapRef.current) return;
    mapRef.current.zoomTo(mapRef.current.getZoom() + delta, { duration: 200 });
  }, []);

  // ── Drop pin at current position ───────────────────────────
  const handleDropPin = useCallback(() => {
    if (!position || !onDropPin) return;
    const palette = ['#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f59e0b'];
    const pin: DroppedPin = {
      lat: position.latitude,
      lng: position.longitude,
      label: `Pin ${new Date().toLocaleTimeString()}`,
      color: palette[Math.floor(Math.random() * palette.length)],
      created_at: new Date().toISOString(),
    };
    onDropPin(pin);
  }, [position, onDropPin]);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="relative rounded-sm border border-subtle overflow-hidden" style={{ height, background: '#0a0a0a' }}>
      <div ref={mapContainerRef} className="absolute inset-0" />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center" style={{ background: 'rgba(10,10,10,0.85)' }}>
          <div>
            <AlertCircle size={20} className="mx-auto mb-1" style={{ color: '#ef4444' }} />
            <p className="text-[10px]" style={{ color: '#888' }}>{error}</p>
          </div>
        </div>
      )}

      {!position && !error && mapReady && (
        <div className="absolute top-2 left-2 right-2 px-2 py-1 text-center rounded-sm text-[10px] font-mono" style={{ background: 'rgba(0,0,0,0.65)', color: '#888' }}>
          Waiting for GPS fix…
        </div>
      )}

      {showControls && !error && (
        <>
          {/* Recenter (top-left) */}
          {position && (
            <button
              type="button"
              onClick={handleRecenter}
              className={`absolute top-2 left-2 w-8 h-8 flex items-center justify-center rounded-sm border transition-colors ${userPanned ? 'border-rmpg-400' : 'border-subtle opacity-50'}`}
              style={{ background: 'rgba(10,10,10,0.85)', color: userPanned ? '#d4a017' : '#888' }}
              title={userPanned ? 'Recenter on me' : 'Following'}
            >
              <Crosshair size={14} />
            </button>
          )}

          {/* Zoom in/out (left side, below recenter) */}
          <div className="absolute top-12 left-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => handleZoom(1)}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: '#e0e0e0' }}
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: '#e0e0e0' }}
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
          </div>

          {/* Style toggle (bottom-left) */}
          <div className="absolute bottom-2 left-2">
            <button
              type="button"
              onClick={() => setStyleMenuOpen((v) => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: '#d4a017' }}
              title="Map style"
            >
              <Layers size={14} />
            </button>
            {styleMenuOpen && (
              <div className="absolute bottom-10 left-0 rounded-sm border border-subtle overflow-hidden" style={{ background: '#0a0a0a', minWidth: 110 }}>
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleStyleChange(opt.value)}
                    className="block w-full text-left px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors hover:bg-rmpg-800"
                    style={{ color: style === opt.value ? '#d4a017' : '#e0e0e0', borderBottom: '1px solid #1a1a1a' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Drop pin (bottom-left, next to style) */}
          {onDropPin && position && (
            <button
              type="button"
              onClick={handleDropPin}
              className="absolute bottom-2 left-12 w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: '#22c55e' }}
              title="Drop a pin at your current position"
            >
              <MapPin size={14} />
            </button>
          )}

          {/* Legend (bottom-right, above attribution) */}
          <div className="absolute bottom-2 right-12 px-1.5 py-0.5 rounded-sm text-[8px] font-mono uppercase tracking-wider" style={{ background: 'rgba(10,10,10,0.85)', color: '#888' }}>
            <span style={{ color: '#d4a017' }}>●</span> You
            {pins.length > 0 && <span className="ml-1.5"><span style={{ color: '#22c55e' }}>●</span> Pin</span>}
          </div>
        </>
      )}
    </div>
  );
}
