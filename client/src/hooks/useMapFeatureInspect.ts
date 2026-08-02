/**
 * useMapFeatureInspect — "what is HERE?", not "what geometry is under my cursor?"
 *
 * Click the map with Identify active to inspect RMPG's own overlay features at
 * that point. Basemap geometry (roads, landuse, buildings) and internal render
 * layers (the coverage-gap grid) are suppressed entirely: a click on a school
 * used to return twelve rows, eleven of which an officer had to read past.
 *
 * Synchronous by design. The old implementation also queried the Tilequery API
 * against mapbox.mapbox-streets-v8 — the BASEMAP tileset, which contains none
 * of our overlays — so every one of those rows was discarded by the filter
 * below. It was a billed round-trip per click that answered nothing.
 */

import { useState, useCallback, useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';
import {
  isOverlayLayer, humanLayerLabel, layerGroupLabel, configIdFromLayerId,
} from '../utils/osmLayerLabels';
import { OSM_VECTOR_CONFIGS } from './useVectorTileLayers';
import { OSM_GROUPS } from '../config/osmLayers.generated';

/** Half-width of the hit box, in screen pixels. An exact-point query makes a
 *  5px miss on a hydrant read as "no hydrant". */
export const HIT_TOLERANCE_PX = 8;

export interface InspectedFeature {
  /** Dedupe/React key. */
  key: string;
  layerId: string;
  categoryLabel: string;
  groupLabel: string | null;
  coverage?: string;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
  /** Set only on the widened nearest-feature path, e.g. "90 ft NE". */
  awayLabel?: string;
}

export interface InspectionResult {
  lngLat: [number, number];
  features: InspectedFeature[];
  /** True when nothing was found at the click point and the search widened. */
  widened: boolean;
  timestamp: number;
}

/** configId -> coverage caveat, so a hit can carry its layer's caveat. */
const COVERAGE_BY_CONFIG_ID: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const c of OSM_VECTOR_CONFIGS) if (c.coverage) out[c.id] = c.coverage;
  return out;
})();

/** configId -> catalog declaration order, so ranking matches the layer picker
 *  rather than whatever order Mapbox happened to return. */
const ORDER_BY_CONFIG_ID: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let i = 0;
  for (const g of OSM_GROUPS) for (const c of g.categories) out[`osm_${g.name}_${c.cat}`] = i++;
  return out;
})();

function boxAround(p: { x: number; y: number }, tol: number):
  [mapboxgl.PointLike, mapboxgl.PointLike] {
  return [[p.x - tol, p.y - tol], [p.x + tol, p.y + tol]];
}

/** Overlay hits only, deduped and ranked. */
export function collectOverlayFeatures(raw: any[]): InspectedFeature[] {
  const byKey = new Map<string, InspectedFeature>();
  for (const f of raw) {
    const layerId = f?.layer?.id;
    if (!layerId || !isOverlayLayer(layerId)) continue;
    const props = (f.properties || {}) as Record<string, unknown>;
    const cfgId = configIdFromLayerId(layerId) ?? layerId;
    // A polygon spanning several tiles comes back once per tile. osm_id is the
    // real identity; fall back to layer+name when the archive omits it.
    const osmId = String(props.osm_id ?? '').trim();
    const key = osmId || `${cfgId}:${String(props.name ?? '')}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      layerId,
      categoryLabel: humanLayerLabel(layerId) ?? layerId,
      groupLabel: layerGroupLabel(layerId),
      coverage: COVERAGE_BY_CONFIG_ID[cfgId],
      properties: props,
      geometry: f.geometry,
    });
  }
  return [...byKey.values()].sort((a, b) => {
    const ao = ORDER_BY_CONFIG_ID[configIdFromLayerId(a.layerId) ?? ''] ?? 999;
    const bo = ORDER_BY_CONFIG_ID[configIdFromLayerId(b.layerId) ?? ''] ?? 999;
    if (ao !== bo) return ao - bo;
    return String(a.properties.name ?? '').localeCompare(String(b.properties.name ?? ''));
  });
}

export function useMapFeatureInspect(map: mapboxgl.Map | null, mapLoaded: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    const handler = (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const raw = map.queryRenderedFeatures(boxAround(e.point, HIT_TOLERANCE_PX)) as any[];
      const features = collectOverlayFeatures(raw);
      setResult({ lngLat: [lng, lat], features, widened: false, timestamp: Date.now() });
      setSelectedIndex(0);
    };

    map.getCanvas().style.cursor = 'help';
    map.on('click', handler);
    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = '';
    };
  }, [map, mapLoaded, enabled]);

  const clear = useCallback(() => { setResult(null); setSelectedIndex(0); }, []);
  const select = useCallback((i: number) => setSelectedIndex(i), []);
  const toggle = useCallback(() => {
    setEnabled((v) => {
      if (v) { setResult(null); setSelectedIndex(0); }
      return !v;
    });
  }, []);

  return { enabled, result, selectedIndex, select, toggle, clear };
}
