// ============================================================
// RMPG Flex — Geo Data Map View
// Renders the active GeoDataViewerPage layer as real Mapbox GL geometry
// (fill+outline for polygons, line for linestrings, circles for points)
// instead of just a property table. Click a feature to select it — feeds
// the same FeatureDetailPanel the table view uses. Reuses the established
// mapboxLoader init pattern (see SightingsMap / ForensicTrackMap).
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../utils/mapboxApiKey';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { hasSource, safeRemoveLayer, safeRemoveSource, upsertGeoJsonSource } from '../utils/mapboxSafeLayer';
import { useWebglMapRecovery } from '../hooks/useWebglMapRecovery';

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}
interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

const SOURCE_ID = 'geo-viewer-layer';
const FILL_LAYER = 'geo-viewer-fill';
const LINE_LAYER = 'geo-viewer-line';
const POINT_LAYER = 'geo-viewer-point';
const HIGHLIGHT_SOURCE = 'geo-viewer-highlight';
const HIGHLIGHT_LINE = 'geo-viewer-highlight-line';
const HIGHLIGHT_POINT = 'geo-viewer-highlight-point';

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608]; // Salt Lake City
const CLICKABLE_LAYERS = [FILL_LAYER, LINE_LAYER, POINT_LAYER];

export default function GeoDataMapView({
  fc,
  color,
  selectedFeature,
  onSelectFeature,
  height,
}: {
  fc: FeatureCollection | undefined;
  color: string;
  selectedFeature: GeoFeature | null;
  onSelectFeature: (f: GeoFeature | null) => void;
  height?: number | string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();

  // Init once (and again after a WebGL context-loss rebuild).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        initMapbox(token);
        if (cancelled || !containerRef.current || mapRef.current) { setLoaded(true); return; }
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAPBOX_STYLE_DARK,
          center: DEFAULT_CENTER,
          zoom: 6.2,
          projection: 'mercator',
          attributionControl: false,
        });
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        map.on('load', () => { if (!cancelled) { onMapLoaded(map); setLoaded(true); } });
        mapRef.current = map;
        registerMapInstance(map);
        webglRecoveryCleanupRef.current = attach(map, 'GeoDataMapView');
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || getMapboxTokenErrorMessage());
      }
    })();
    return () => {
      cancelled = true;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
      setLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNonce]);

  // Render the active layer's features whenever the data, color, or
  // selection changes. Feature index is baked into properties (Mapbox
  // strips object identity through the GeoJSON source round-trip) so a
  // click handler can look the clicked feature back up in `fc.features`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    if (!fc || !fc.features.length) {
      [FILL_LAYER, LINE_LAYER, POINT_LAYER].forEach((id) => safeRemoveLayer(map, id));
      safeRemoveSource(map, SOURCE_ID);
      return;
    }

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: fc.features.map((f, i) => ({
        type: 'Feature',
        properties: { ...f.properties, __idx: i },
        geometry: f.geometry as GeoJSON.Geometry,
      })),
    };

    if (!hasSource(map, SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });

      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        paint: { 'fill-color': color, 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'], true, false],
        paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: POINT_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        paint: {
          'circle-color': color,
          'circle-radius': 5,
          'circle-stroke-color': '#0a0a0a',
          'circle-stroke-width': 1,
        },
      });
      map.addSource(HIGHLIGHT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: HIGHLIGHT_LINE,
        type: 'line',
        source: HIGHLIGHT_SOURCE,
        filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'], true, false],
        paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.95 },
      });
      map.addLayer({
        id: HIGHLIGHT_POINT,
        type: 'circle',
        source: HIGHLIGHT_SOURCE,
        filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        paint: { 'circle-color': '#ffffff', 'circle-radius': 8, 'circle-stroke-color': color, 'circle-stroke-width': 2 },
      });

      // Fit to the layer's extent once, on first render for this layer.
      try {
        const bounds = new mapboxgl.LngLatBounds();
        let has = false;
        const extend = (coords: any): void => {
          if (typeof coords[0] === 'number') { bounds.extend(coords as [number, number]); has = true; }
          else coords.forEach(extend);
        };
        geojson.features.forEach((f) => { if (f.geometry && 'coordinates' in f.geometry) extend((f.geometry as any).coordinates); });
        if (has) map.fitBounds(bounds, { padding: 40, maxZoom: 13, duration: 0 });
      } catch { /* malformed geometry — keep default view */ }
    } else {
      upsertGeoJsonSource(map, SOURCE_ID, geojson);
    }

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: CLICKABLE_LAYERS });
      const idx = feats[0]?.properties?.__idx;
      if (typeof idx === 'number' && fc.features[idx]) onSelectFeature(fc.features[idx]);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    CLICKABLE_LAYERS.forEach((id) => {
      map.on('click', id, onClick);
      map.on('mouseenter', id, onEnter);
      map.on('mouseleave', id, onLeave);
    });

    return () => {
      CLICKABLE_LAYERS.forEach((id) => {
        map.off('click', id, onClick);
        map.off('mouseenter', id, onEnter);
        map.off('mouseleave', id, onLeave);
      });
    };
  }, [fc, color, loaded, onSelectFeature]);

  // Highlight the selected feature (from either the map click or a table row click).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !hasSource(map, HIGHLIGHT_SOURCE)) return;
    const data: GeoJSON.FeatureCollection = selectedFeature
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: selectedFeature.geometry as GeoJSON.Geometry }] }
      : { type: 'FeatureCollection', features: [] };
    upsertGeoJsonSource(map, HIGHLIGHT_SOURCE, data);
  }, [selectedFeature, loaded]);

  if (error) {
    return (
      <div style={{ height }} className="flex items-center justify-center bg-surface-sunken border border-border-default text-[10px] text-fg-muted">
        {error}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height }}>
      <div ref={containerRef} role="application" aria-label="Geo data layer map" style={{ width: '100%', height: '100%' }} />
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0 }} className="flex items-center justify-center bg-surface-sunken">
          <RefreshCw className="w-3.5 h-3.5 text-fg-muted animate-spin" />
        </div>
      )}
    </div>
  );
}
