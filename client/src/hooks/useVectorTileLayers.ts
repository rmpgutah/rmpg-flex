// ============================================================
// RMPG Flex — Vector Tile (PMTiles) Layer Manager Hook
// ============================================================
// Renders large statewide datasets (Utah address points, road
// centerlines) as Mapbox GL JS *vector* sources backed by PMTiles
// archives served from R2 via /api/tiles/*.
//
// These datasets are ~1–2 GB of raw GeoJSON each — far too large for
// the whole-file `geojson` source pattern in useGeoJsonLayers. PMTiles
// streams only the tiles in the current viewport over HTTP range
// requests (protocol registered in utils/mapboxLoader.ts), so memory
// and transfer stay tiny regardless of statewide extent.
//
// Layers are OFF by default (statewide point clutter is opt-in) and
// zoom-gated so they only draw when zoomed in enough to be useful.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';

export type VectorLayerKind = 'line' | 'point';

export interface VectorTileLayerConfig {
  id: string;
  label: string;
  description: string;
  /** PMTiles source URL (pmtiles:// protocol, relative same-origin /api path). */
  url: string;
  /** The vector source-layer name inside the PMTiles archive. */
  sourceLayer: string;
  kind: VectorLayerKind;
  /** Don't draw below this zoom (statewide clutter control). */
  minzoom: number;
  /** Legend swatch / primary draw color. */
  color: string;
  /** Property used for the click popup title. */
  labelProp: string;
  /** Extra properties shown in the popup. */
  detailProps: { key: string; label: string }[];
}

// pmtiles:// + relative same-origin path. In prod the SPA reaches the
// Worker via same-origin /api/* (CSP connect-src 'self'); the tiles
// route is served by the rewrite worker through the proxy.
const TILE_BASE = 'pmtiles:///api/tiles';

export const VECTOR_TILE_CONFIGS: VectorTileLayerConfig[] = [
  {
    id: 'utah_roads',
    label: 'Utah Roads',
    description: 'Statewide road centerlines (UGRC)',
    url: `${TILE_BASE}/utah-roads.pmtiles`,
    sourceLayer: 'roads',
    kind: 'line',
    minzoom: 9,
    color: '#d4a017',
    labelProp: 'FULLNAME',
    detailProps: [
      { key: 'CARTOCODE', label: 'Class' },
      { key: 'ADDRSYS_L', label: 'Addr System' },
      { key: 'ZIPCODE_L', label: 'ZIP' },
      { key: 'COUNTY_L', label: 'County' },
    ],
  },
  {
    id: 'utah_addresses',
    label: 'Utah Address Points',
    description: 'Statewide address points (UGRC)',
    url: `${TILE_BASE}/utah-address-points.pmtiles`,
    sourceLayer: 'address_points',
    kind: 'point',
    minzoom: 14,
    color: '#e8b84b',
    labelProp: 'FullAdd',
    detailProps: [
      { key: 'AddSystem', label: 'Addr System' },
      { key: 'City', label: 'City' },
      { key: 'ZipCode', label: 'ZIP' },
      { key: 'PtType', label: 'Type' },
      { key: 'ParcelID', label: 'Parcel' },
    ],
  },
];

export interface VectorLayerState {
  visible: boolean;
  loaded: boolean;
}

interface UseVectorTileLayersOptions {
  map: mapboxgl.Map | null;
  popup: mapboxgl.Popup | null;
}

function srcId(id: string) { return `vt-${id}`; }
function lineLayerId(id: string) { return `vt-${id}-line`; }
function circleLayerId(id: string) { return `vt-${id}-circle`; }
function labelLayerId(id: string) { return `vt-${id}-label`; }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// UGRC CARTOCODE road-class -> readable name (popup only).
const CARTO_NAMES: Record<string, string> = {
  '1': 'Interstate', '2': 'US Highway', '3': 'State Highway', '4': 'Ramp',
  '5': 'Major Road', '6': 'Arterial', '7': 'Collector', '8': 'Local',
  '9': 'Local', '10': 'Service', '11': 'Local Street', '12': 'Driveway',
};

export function useVectorTileLayers({ map, popup }: UseVectorTileLayersOptions) {
  const [layerStates, setLayerStates] = useState<Record<string, VectorLayerState>>(() => {
    const init: Record<string, VectorLayerState> = {};
    for (const cfg of VECTOR_TILE_CONFIGS) init[cfg.id] = { visible: false, loaded: false };
    return init;
  });

  const popupRef = useRef(popup);
  useEffect(() => { popupRef.current = popup; }, [popup]);

  // Guard against double-add when multiple effects race the style-ready gate.
  const addedRef = useRef<Set<string>>(new Set());
  const clickBoundRef = useRef<Set<string>>(new Set());

  const buildPopupHtml = useCallback((cfg: VectorTileLayerConfig, props: Record<string, any>): string => {
    const titleRaw = props[cfg.labelProp];
    const title = titleRaw != null && String(titleRaw).trim() !== '' ? String(titleRaw) : cfg.label;
    let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:150px;">`;
    html += `<div style="font-weight:bold;font-size:12px;color:${cfg.color};margin-bottom:3px;border-bottom:1px solid #444;padding-bottom:3px;">${escapeHtml(title)}</div>`;
    html += `<div style="color:#888;font-size:9px;text-transform:uppercase;margin-bottom:4px;">${escapeHtml(cfg.label)}</div>`;
    for (const d of cfg.detailProps) {
      let v = props[d.key];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      if (d.key === 'CARTOCODE') v = CARTO_NAMES[String(v)] || `Code ${v}`;
      html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">${escapeHtml(d.label)}:</span> ${escapeHtml(String(v))}</div>`;
    }
    html += `</div>`;
    return html;
  }, []);

  const addLayer = useCallback((cfg: VectorTileLayerConfig) => {
    if (!map) return;
    if (addedRef.current.has(cfg.id)) return;

    whenStyleReady(map, () => {
      if (addedRef.current.has(cfg.id)) return;
      const source = srcId(cfg.id);

      try {
        if (!map.getSource(source)) {
          map.addSource(source, { type: 'vector', url: cfg.url } as any);
        }

        if (cfg.kind === 'line') {
          if (!map.getLayer(lineLayerId(cfg.id))) {
            map.addLayer({
              id: lineLayerId(cfg.id),
              type: 'line',
              source,
              'source-layer': cfg.sourceLayer,
              minzoom: cfg.minzoom,
              layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                // Major classes (interstate/US/state) draw brighter + wider.
                'line-color': [
                  'match', ['to-string', ['get', 'CARTOCODE']],
                  '1', '#ef4444', '2', '#f59e0b', '3', '#e8b84b',
                  cfg.color,
                ] as any,
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  9, ['match', ['to-string', ['get', 'CARTOCODE']], '1', 2, '2', 1.6, '3', 1.2, 0.4],
                  14, ['match', ['to-string', ['get', 'CARTOCODE']], '1', 4, '2', 3, '3', 2.4, 1.2],
                  18, ['match', ['to-string', ['get', 'CARTOCODE']], '1', 7, '2', 6, '3', 5, 3],
                ] as any,
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.45, 14, 0.85] as any,
              },
            });
          }
          // Road name labels at high zoom.
          if (!map.getLayer(labelLayerId(cfg.id))) {
            map.addLayer({
              id: labelLayerId(cfg.id),
              type: 'symbol',
              source,
              'source-layer': cfg.sourceLayer,
              minzoom: 13,
              layout: {
                visibility: 'none',
                'symbol-placement': 'line',
                'text-field': ['coalesce', ['get', 'FULLNAME'], ['get', 'NAME'], ''] as any,
                'text-size': 10,
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
              },
              paint: {
                'text-color': '#e8d8a8',
                'text-halo-color': '#000000',
                'text-halo-width': 1.4,
              },
            });
          }
        } else {
          // Point layer — small gold dots + address labels at very high zoom.
          if (!map.getLayer(circleLayerId(cfg.id))) {
            map.addLayer({
              id: circleLayerId(cfg.id),
              type: 'circle',
              source,
              'source-layer': cfg.sourceLayer,
              minzoom: cfg.minzoom,
              layout: { visibility: 'none' },
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 5] as any,
                'circle-color': cfg.color,
                'circle-opacity': 0.9,
                'circle-stroke-color': '#1a1a1a',
                'circle-stroke-width': 0.6,
              },
            });
          }
          if (!map.getLayer(labelLayerId(cfg.id))) {
            map.addLayer({
              id: labelLayerId(cfg.id),
              type: 'symbol',
              source,
              'source-layer': cfg.sourceLayer,
              minzoom: 16,
              layout: {
                visibility: 'none',
                'text-field': ['get', 'FullAdd'] as any,
                'text-size': 9,
                'text-offset': [0, 0.9],
                'text-anchor': 'top',
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
                'text-allow-overlap': false,
              },
              paint: {
                'text-color': '#d8c890',
                'text-halo-color': '#000000',
                'text-halo-width': 1.2,
              },
            });
          }
        }

        // Click popup — bound once per layer. Read popup from ref so the
        // handler stays current without rebinding.
        const interactiveLayer = cfg.kind === 'line' ? lineLayerId(cfg.id) : circleLayerId(cfg.id);
        if (!clickBoundRef.current.has(cfg.id)) {
          clickBoundRef.current.add(cfg.id);
          map.on('click', interactiveLayer, (e) => {
            const pop = popupRef.current;
            if (!pop || !e.features || e.features.length === 0) return;
            const props = e.features[0].properties || {};
            pop.setLngLat(e.lngLat).setHTML(buildPopupHtml(cfg, props)).addTo(map);
          });
          map.on('mouseenter', interactiveLayer, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', interactiveLayer, () => { map.getCanvas().style.cursor = ''; });
        }

        addedRef.current.add(cfg.id);
        setLayerStates((prev) => ({ ...prev, [cfg.id]: { ...prev[cfg.id], loaded: true } }));
      } catch (err) {
        console.error(`[VectorTiles] Failed to add ${cfg.id}:`, err);
      }
    });
  }, [map, buildPopupHtml]);

  const setLayerVisibility = useCallback((cfg: VectorTileLayerConfig, visible: boolean) => {
    if (!map) return;
    const vis = visible ? 'visible' : 'none';
    const ids = cfg.kind === 'line'
      ? [lineLayerId(cfg.id), labelLayerId(cfg.id)]
      : [circleLayerId(cfg.id), labelLayerId(cfg.id)];
    for (const id of ids) {
      try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis); } catch { /* style not ready */ }
    }
  }, [map]);

  const toggleVectorLayer = useCallback((layerId: string) => {
    const cfg = VECTOR_TILE_CONFIGS.find((c) => c.id === layerId);
    if (!cfg) return;
    setLayerStates((prev) => {
      const curr = prev[layerId];
      if (!curr) return prev;
      const nowVisible = !curr.visible;
      if (nowVisible && !curr.loaded) addLayer(cfg);
      // Defer visibility flip a tick so addLayer's style-ready callback can
      // create the layers first on the very first toggle.
      setTimeout(() => setLayerVisibility(cfg, nowVisible), 0);
      return { ...prev, [layerId]: { ...curr, visible: nowVisible } };
    });
  }, [addLayer, setLayerVisibility]);

  // Reset per-map tracking when the map instance changes (handlers/layers
  // live on the map; a new map needs fresh adds).
  useEffect(() => {
    addedRef.current.clear();
    clickBoundRef.current.clear();
    if (map) {
      setLayerStates((prev) => {
        const next = { ...prev };
        for (const cfg of VECTOR_TILE_CONFIGS) next[cfg.id] = { ...next[cfg.id], loaded: false };
        return next;
      });
    }
  }, [map]);

  return {
    vectorLayerStates: layerStates,
    toggleVectorLayer,
    vectorConfigs: VECTOR_TILE_CONFIGS,
  };
}
