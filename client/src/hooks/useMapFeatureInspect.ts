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

import { useState, useCallback, useEffect, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import {
  isOverlayLayer, humanLayerLabel, layerGroupLabel, configIdFromLayerId, metresToUsDistance,
} from '../utils/osmLayerLabels';
import { OSM_VECTOR_CONFIGS } from './useVectorTileLayers';
import { OSM_GROUPS } from '../config/osmLayers.generated';
import { haversineDistance } from '../utils/unitRecommendation';
import { formatBearing } from '../utils/osmFeatureDescription';
import {
  collectCadGeoFeatures, collectCadMarkers,
  type CadCallHit, type CadUnitHit,
  type InspectedFeature, type InspectionResult,
} from '../pages/map/utils/mapCadInspect';

export type { InspectedFeature, InspectionResult };

/** Half-width of the hit box, in screen pixels. An exact-point query makes a
 *  5px miss on a hydrant read as "no hydrant". */
export const HIT_TOLERANCE_PX = 8;

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
      kind: 'osm',
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

/** Hit box half-widths, in screen pixels. The first is the normal path; the
 *  rest widen only when nothing was found, so a near-miss on a hydrant is not
 *  reported as "no hydrant". */
export const WIDEN_STEPS_PX = [HIT_TOLERANCE_PX, 40, 120];

const METRES_PER_MILE = 1609.344;

/** A single lng/lat standing in for any geometry, for distance purposes. */
export function representativePoint(geometry: GeoJSON.Geometry): [number, number] | null {
  const coords: number[][] = [];
  const walk = (c: any) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') { coords.push(c as number[]); return; }
    for (const child of c) walk(child);
  };
  walk((geometry as any)?.coordinates);
  if (!coords.length) return null;
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [lng, lat];
}

/** "90 ft NE" — distance and bearing from the click to a feature. */
export function awayLabelFor(
  from: [number, number],
  geometry: GeoJSON.Geometry,
): string | undefined {
  const to = representativePoint(geometry);
  if (!to) return undefined;
  // ⚠️ haversineDistance returns MILES; metresToUsDistance takes METRES.
  const metres = haversineDistance(from[1], from[0], to[1], to[0]) * METRES_PER_MILE;
  if (!Number.isFinite(metres)) return undefined;
  const dLng = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const dLat = to[1] - from[1];
  const deg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  const bearing = formatBearing(String(deg))?.replace(/\s*\(.*\)$/, '') ?? '';
  const dist = metresToUsDistance(metres);
  return dist ? `${dist}${bearing ? ` ${bearing}` : ''}` : undefined;
}

export function useMapFeatureInspect(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  cad?: { units: CadUnitHit[]; calls: CadCallHit[] },
) {
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const cadRef = useRef(cad);
  cadRef.current = cad;

  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    const handler = (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const from: [number, number] = [lng, lat];
      const project = typeof map.project === 'function'
        ? (ln: number, la: number) => map.project([ln, la])
        : undefined;

      for (let step = 0; step < WIDEN_STEPS_PX.length; step++) {
        const tol = WIDEN_STEPS_PX[step];
        const raw = map.queryRenderedFeatures(boxAround(e.point, tol)) as any[];
        const live = cadRef.current;
        const features = [
          ...collectCadMarkers(live?.units ?? [], live?.calls ?? [], project, e.point, tol),
          ...collectCadGeoFeatures(raw),
          ...collectOverlayFeatures(raw),
        ];
        if (!features.length) continue;
        const widened = step > 0;
        setResult({
          lngLat: from,
          features: widened
            ? features.map((f) => ({ ...f, awayLabel: awayLabelFor(from, f.geometry) }))
            : features,
          widened,
          timestamp: Date.now(),
        });
        setSelectedIndex(0);
        return;
      }

      // Nothing anywhere near. Report it explicitly — silence is
      // indistinguishable from the tool being broken or switched off.
      setResult({ lngLat: from, features: [], widened: false, timestamp: Date.now() });
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
