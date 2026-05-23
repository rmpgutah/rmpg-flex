// ============================================================
// RMPG Flex — GeoJSON Layer Manager Hook (Mapbox GL JS)
// ============================================================
// Loads split GeoJSON layer files from /geojson/ and renders
// them as Mapbox GL JS source + layer pairs. Supports lazy
// loading, per-layer toggle, click popups, style theming,
// and interactive selection mode for shift planning.
// ============================================================

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';

// ── Layer Configuration ──────────────────────────────────────

export interface GeoLayerConfig {
  id: string;
  label: string;
  file: string;
  visible: boolean;
  selectable: boolean;
  style: {
    fillColor: string;
    fillOpacity: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeWeight: number;
    iconScale?: number;
  };
  labelProp: string;
  featureKeyProp: string;
  detailProps?: string[];
  minZoom?: number;
}

export const GEO_LAYER_CONFIGS: GeoLayerConfig[] = [
  {
    id: 'state_boundary',
    label: 'State Boundary',
    file: 'state_boundary.geojson',
    visible: false,
    selectable: false,
    style: { fillColor: 'transparent', fillOpacity: 0, strokeColor: '#ffffff', strokeOpacity: 0.3, strokeWeight: 2 },
    labelProp: 'name',
    featureKeyProp: 'name',
  },
  {
    id: 'county',
    label: 'Counties',
    file: 'county.geojson',
    visible: true,
    selectable: true,
    style: { fillColor: '#141414', fillOpacity: 0.15, strokeColor: '#444444', strokeOpacity: 0.5, strokeWeight: 1.5 },
    labelProp: 'NAME',
    featureKeyProp: 'NAME',
    detailProps: ['POP_CURRESTIMATE', 'STATEPLANE'],
    minZoom: 8,
  },
  {
    id: 'municipality',
    label: 'Municipalities',
    file: 'municipality.geojson',
    visible: false,
    selectable: true,
    style: { fillColor: '#a855f7', fillOpacity: 0.06, strokeColor: '#a855f7', strokeOpacity: 0.35, strokeWeight: 1 },
    labelProp: 'NAME',
    featureKeyProp: 'NAME',
    detailProps: ['city_code', 'POPLASTESTIMATE'],
    minZoom: 9,
  },
  {
    id: 'beat',
    label: 'Beats',
    file: 'beat.geojson',
    visible: true,
    selectable: true,
    style: { fillColor: '#22c55e', fillOpacity: 0.20, strokeColor: '#22c55e', strokeOpacity: 0.6, strokeWeight: 1.2 },
    labelProp: 'beat_code',
    featureKeyProp: 'beat_code',
    detailProps: ['city', 'beat_id', 'district_letter', 'beat_number'],
    minZoom: 10,
  },
  {
    id: 'highway',
    label: 'Highways',
    file: 'highway.geojson',
    visible: false,
    selectable: false,
    style: { fillColor: 'transparent', fillOpacity: 0, strokeColor: '#ef4444', strokeOpacity: 0.6, strokeWeight: 3 },
    labelProp: 'route_name',
    featureKeyProp: 'route_name',
    detailProps: ['route_type'],
  },
  {
    id: 'place',
    label: 'Places',
    file: 'place.geojson',
    visible: false,
    selectable: false,
    style: { fillColor: '#22c55e', fillOpacity: 0.7, strokeColor: '#22c55e', strokeOpacity: 0.9, strokeWeight: 1, iconScale: 4 },
    labelProp: 'NAME',
    featureKeyProp: 'NAME',
    detailProps: ['COUNTY', 'POPULATION', 'TYPE'],
    minZoom: 10,
  },
];

const SELECTION_FILL_COLOR = '#f59e0b';
const SELECTION_FILL_OPACITY = 0.25;
const SELECTION_STROKE_COLOR = '#f59e0b';
const SELECTION_STROKE_OPACITY = 0.9;
const SELECTION_STROKE_WEIGHT = 2.5;

const ASSIGNED_FILL_COLOR = '#22c55e';
const ASSIGNED_FILL_OPACITY = 0.18;
const ASSIGNED_STROKE_COLOR = '#22c55e';
const ASSIGNED_STROKE_OPACITY = 0.8;
const ASSIGNED_STROKE_WEIGHT = 2;

const MUNI_COLORS = [
  '#22c55e', '#d4a017', '#ef4444', '#f59e0b', '#a855f7', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#10b981', '#facc15', '#e11d48',
  '#84cc16', '#fb923c', '#d946ef', '#fde047', '#eab308', '#fbbf24',
];

function getMuniColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return MUNI_COLORS[Math.abs(hash) % MUNI_COLORS.length];
}

export const SECTION_COLORS: Record<string, string> = {
  SL1: '#22c55e', SL2: '#d4a017', SL3: '#a855f7', SL4: '#f59e0b', SL5: '#ef4444', SL6: '#fbbf24',
  DV1: '#ec4899', DV2: '#14b8a6', DV3: '#f97316',
  WB1: '#8b5cf6', WB2: '#10b981',
  UC1: '#facc15', UC2: '#eab308', UC3: '#f43f5e',
};
const SECTION_COLOR_FALLBACKS = ['#fb923c', '#d946ef', '#84cc16', '#facc15', '#e11d48', '#14b8a6', '#f59e0b', '#8b5cf6'];

export function getSectionColor(sectionId: string): string {
  if (!sectionId) return SECTION_COLOR_FALLBACKS[0];
  if (SECTION_COLORS[sectionId]) return SECTION_COLORS[sectionId];
  let hash = 0;
  for (let i = 0; i < sectionId.length; i++) hash = ((hash << 5) - hash + sectionId.charCodeAt(i)) | 0;
  return SECTION_COLOR_FALLBACKS[Math.abs(hash) % SECTION_COLOR_FALLBACKS.length];
}

const CITY_COLORS = [
  '#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6',
  '#2dd4bf', '#fb923c', '#a78bfa', '#34d399', '#22d3ee', '#fb7185',
  '#a3e635', '#818cf8', '#e879f9', '#38bdf8', '#fde047', '#fdba74',
  '#5eead4', '#f9a8d4', '#bef264', '#93c5fd', '#fcd34d', '#7dd3fc',
];

export function getCityColor(cityCode: string): string {
  let hash = 0;
  for (let i = 0; i < cityCode.length; i++) hash = ((hash << 5) - hash + cityCode.charCodeAt(i)) | 0;
  return CITY_COLORS[Math.abs(hash) % CITY_COLORS.length];
}

export interface BeatDistrictEntry {
  sectionId: string;
  sectionName: string;
  zoneId: string;
  zoneName: string;
  beatId: string;
  beatName: string;
  beatDescriptor: string;
  dispatchCode: string;
}

interface BeatStyleEntry {
  style: GeoLayerConfig['style'];
  entry: BeatDistrictEntry;
}

export interface GeoFeatureInfo {
  layerId: string;
  featureKey: string;
  label: string;
  properties: Record<string, any>;
}

interface UseGeoJsonLayersOptions {
  map: mapboxgl.Map | null;
  popup: mapboxgl.Popup | null;
  selectionMode?: boolean;
  onFeatureClick?: (info: GeoFeatureInfo) => void;
  selectedFeatures?: Set<string>;
  assignedFeatures?: Set<string>;
  beatDistrictMap?: Map<string, Map<string, BeatDistrictEntry>>;
}

export interface GeoLayerState {
  visible: boolean;
  loaded: boolean;
  featureCount: number;
}

function lookupBeatDistrict(
  beatDistrictMap: Map<string, Map<string, BeatDistrictEntry>> | undefined,
  cityCode: string | undefined,
  distLetter: string | undefined,
): BeatDistrictEntry | undefined {
  if (!beatDistrictMap || !cityCode) return undefined;
  const zoneMap = beatDistrictMap.get(cityCode);
  if (!zoneMap) return undefined;
  return distLetter ? zoneMap.get(distLetter) : undefined;
}

function buildDefaultInfoHtml(name: string, cfg: GeoLayerConfig, props: Record<string, any>): string {
  let html = `<div style="font-weight:bold;font-size:12px;color:#fff;margin-bottom:4px;border-bottom:1px solid #444;padding-bottom:3px;">${escapeForHtml(String(name))}</div>`;
  html += `<div style="color:#888;font-size:9px;text-transform:uppercase;margin-bottom:4px;">${cfg.label}</div>`;
  if (cfg.detailProps) {
    for (const p of cfg.detailProps) {
      if (props[p] !== undefined && props[p] !== null && props[p] !== '') {
        const label = p.replace(/_/g, ' ').replace(/^(POP_CURRESTIMATE|POPLASTESTIMATE)$/i, 'Population');
        html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">${escapeForHtml(label)}:</span> ${escapeForHtml(String(props[p]))}</div>`;
      }
    }
  }
  return html;
}

function getLayerSourceId(layerId: string): string { return `geojson-${layerId}`; }
function getFillLayerId(layerId: string): string { return `geojson-${layerId}-fill`; }
function getLineLayerId(layerId: string): string { return `geojson-${layerId}-line`; }

export function useGeoJsonLayers({
  map,
  popup,
  selectionMode = false,
  onFeatureClick,
  selectedFeatures,
  assignedFeatures,
  beatDistrictMap,
}: UseGeoJsonLayersOptions) {
  const [layerStates, setLayerStates] = useState<Record<string, GeoLayerState>>(() => {
    const initial: Record<string, GeoLayerState> = {};
    for (const cfg of GEO_LAYER_CONFIGS) {
      initial[cfg.id] = { visible: cfg.visible, loaded: false, featureCount: 0 };
    }
    return initial;
  });

  const geojsonCacheRef = useRef<Record<string, object>>({});
  const labelMarkerRefs = useRef<Record<string, mapboxgl.Marker[]>>({});

  const selectionModeRef = useRef(selectionMode);
  const onFeatureClickRef = useRef(onFeatureClick);
  const selectedFeaturesRef = useRef(selectedFeatures);
  const assignedFeaturesRef = useRef(assignedFeatures);

  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);
  useEffect(() => { onFeatureClickRef.current = onFeatureClick; }, [onFeatureClick]);
  useEffect(() => { selectedFeaturesRef.current = selectedFeatures; }, [selectedFeatures]);
  useEffect(() => { assignedFeaturesRef.current = assignedFeatures; }, [assignedFeatures]);

  const beatDistrictMapRef = useRef(beatDistrictMap);
  useEffect(() => { beatDistrictMapRef.current = beatDistrictMap; }, [beatDistrictMap]);

  const beatStyleLookup = useMemo(() => {
    if (!beatDistrictMap) return undefined;
    const beatCfg = GEO_LAYER_CONFIGS.find(c => c.id === 'beat');
    if (!beatCfg) return undefined;
    const lookup = new Map<string, BeatStyleEntry>();
    for (const [cityCode, zoneMap] of beatDistrictMap) {
      const cColor = getCityColor(cityCode);
      for (const [distLetter, entry] of zoneMap) {
        lookup.set(`${cityCode}::${distLetter}`, {
          style: { ...beatCfg.style, fillColor: cColor, strokeColor: cColor, fillOpacity: 0.22, strokeOpacity: 0.65, strokeWeight: 1.2 },
          entry,
        });
      }
    }
    return lookup;
  }, [beatDistrictMap]);

  const beatStyleLookupRef = useRef(beatStyleLookup);
  useEffect(() => { beatStyleLookupRef.current = beatStyleLookup; }, [beatStyleLookup]);

  const makeCompositeKey = (layerId: string, featureKey: string) => `${layerId}::${featureKey}`;

  const setLayerPaint = useCallback((cfg: GeoLayerConfig, isSelected: boolean, isAssigned: boolean) => {
    if (!map) return;
    const fillId = getFillLayerId(cfg.id);
    const lineId = getLineLayerId(cfg.id);

    let fillColor = cfg.style.fillColor;
    let fillOpacity = cfg.style.fillOpacity;
    let strokeColor = cfg.style.strokeColor;
    let strokeOpacity = cfg.style.strokeOpacity;
    let strokeWeight = cfg.style.strokeWeight;

    if (isSelected) {
      fillColor = SELECTION_FILL_COLOR;
      fillOpacity = SELECTION_FILL_OPACITY;
      strokeColor = SELECTION_STROKE_COLOR;
      strokeOpacity = SELECTION_STROKE_OPACITY;
      strokeWeight = SELECTION_STROKE_WEIGHT;
    } else if (isAssigned) {
      fillColor = ASSIGNED_FILL_COLOR;
      fillOpacity = ASSIGNED_FILL_OPACITY;
      strokeColor = ASSIGNED_STROKE_COLOR;
      strokeOpacity = ASSIGNED_STROKE_OPACITY;
      strokeWeight = ASSIGNED_STROKE_WEIGHT;
    }

    if (map.getLayer(fillId)) {
      map.setPaintProperty(fillId, 'fill-color', fillColor);
      map.setPaintProperty(fillId, 'fill-opacity', fillOpacity);
    }
    if (map.getLayer(lineId)) {
      map.setPaintProperty(lineId, 'line-color', strokeColor);
      map.setPaintProperty(lineId, 'line-opacity', strokeOpacity);
      map.setPaintProperty(lineId, 'line-width', strokeWeight);
    }
  }, [map]);

  const loadLayer = useCallback(async (cfg: GeoLayerConfig) => {
    if (!map) return;

    const sourceId = getLayerSourceId(cfg.id);
    if (map.getSource(sourceId)) {
      // Already loaded — just set visibility
      setLayerStates(prev => ({ ...prev, [cfg.id]: { ...prev[cfg.id], visible: true } }));
      return;
    }

    let geojson = geojsonCacheRef.current[cfg.id];
    if (!geojson) {
      try {
        const resp = await fetch(`/geojson/${cfg.file}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        geojson = await resp.json();
        geojsonCacheRef.current[cfg.id] = geojson;
      } catch (err) {
        console.error(`[GeoJSON] Failed to load ${cfg.file}:`, err);
        return;
      }
    }

    map.addSource(sourceId, {
      type: 'geojson',
      data: geojson as any,
    });

    // Add fill layer for polygon features
    map.addLayer({
      id: getFillLayerId(cfg.id),
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': cfg.style.fillColor,
        'fill-opacity': cfg.style.fillOpacity,
      },
      layout: {
        visibility: cfg.visible ? 'visible' : 'none',
      },
    });

    // Add line layer for stroke
    map.addLayer({
      id: getLineLayerId(cfg.id),
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': cfg.style.strokeColor,
        'line-opacity': cfg.style.strokeOpacity,
        'line-width': cfg.style.strokeWeight,
      },
      layout: {
        visibility: cfg.visible ? 'visible' : 'none',
      },
    });

    // Click handler
    map.on('click', getFillLayerId(cfg.id), (e) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const props = feat.properties || {};
      const fKey = props[cfg.featureKeyProp] != null ? String(props[cfg.featureKeyProp]) : '';
      const name = props[cfg.labelProp] || props.name || props.NAME || cfg.label;

      if (selectionModeRef.current && cfg.selectable && onFeatureClickRef.current) {
        onFeatureClickRef.current({
          layerId: cfg.id,
          featureKey: fKey,
          label: String(name),
          properties: props,
        });
        return;
      }

      if (!popup) return;

      let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:140px;">`;

      const entry = cfg.id === 'beat'
        ? lookupBeatDistrict(beatDistrictMapRef.current, props.city_code, props.district_letter)
        : undefined;

      if (entry) {
        const sColor = getSectionColor(entry.sectionId);
        html += `<div style="font-weight:bold;font-size:13px;color:${sColor};margin-bottom:2px;letter-spacing:1px;">${escapeForHtml(entry.dispatchCode)}</div>`;
        html += `<div style="color:#fff;font-size:11px;margin-bottom:6px;border-bottom:1px solid #444;padding-bottom:4px;">${escapeForHtml(entry.beatName)}${entry.beatDescriptor ? ' — ' + escapeForHtml(entry.beatDescriptor) : ''}</div>`;
        html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:${sColor};">Section:</span> <span style="color:#ddd;">${escapeForHtml(entry.sectionId)} — ${escapeForHtml(entry.sectionName)}</span></div>`;
        html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Zone:</span> <span style="color:#ddd;">${escapeForHtml(entry.zoneId)} — ${escapeForHtml(entry.zoneName)}</span></div>`;
        html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Beat:</span> <span style="color:#ddd;">${escapeForHtml(entry.beatId)}</span></div>`;
      } else {
        html += buildDefaultInfoHtml(name, cfg, props);
      }

      const compositeKey = makeCompositeKey(cfg.id, fKey);
      if (assignedFeaturesRef.current?.has(compositeKey)) {
        html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #333;font-size:9px;color:#22c55e;font-weight:bold;">● ASSIGNED</div>`;
      }

      html += `</div>`;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });

    setLayerStates((prev) => ({
      ...prev,
      [cfg.id]: { ...prev[cfg.id], loaded: true, featureCount: 0 },
    }));

    // Apply beat-specific colors
    if (cfg.id === 'beat' && beatStyleLookupRef.current) {
      // Beat colors are handled statically — no per-feature styling in this approach
    }
  }, [map, popup]);

  const ensureLayerLoaded = useCallback(async (layerId: string) => {
    const cfg = GEO_LAYER_CONFIGS.find((c) => c.id === layerId);
    if (!cfg || !map) return;
    const state = layerStates[cfg.id];
    if (state?.loaded) return;
    await loadLayer(cfg);
    setLayerStates((prev) => ({
      ...prev,
      [cfg.id]: { ...prev[cfg.id], visible: true },
    }));
  }, [map, layerStates, loadLayer]);

  const toggleGeoLayer = useCallback((layerId: string) => {
    setLayerStates((prev) => {
      const curr = prev[layerId];
      if (!curr) return prev;
      const nowVisible = !curr.visible;

      const fillId = getFillLayerId(layerId);
      const lineId = getLineLayerId(layerId);
      const vis = nowVisible ? 'visible' : 'none';

      if (map) {
        try { if (map.getLayer(fillId)) map.setLayoutProperty(fillId, 'visibility', vis); } catch {}
        try { if (map.getLayer(lineId)) map.setLayoutProperty(lineId, 'visibility', vis); } catch {}
      }

      // Show/hide label markers
      const labels = labelMarkerRefs.current[layerId];
      if (labels) {
        for (const m of labels) {
          if (nowVisible) m.addTo(map!); else m.remove();
        }
      }

      return { ...prev, [layerId]: { ...curr, visible: nowVisible } };
    });
  }, [map]);

  // Auto-load visible layers when map is ready
  useEffect(() => {
    if (!map) return;
    for (const cfg of GEO_LAYER_CONFIGS) {
      const state = layerStates[cfg.id];
      if (state?.visible && !state.loaded) {
        loadLayer(cfg);
      }
    }
  }, [map, layerStates, loadLayer]);

  // Zoom-based visibility management
  useEffect(() => {
    if (!map) return;
    const onZoom = () => {
      const zoom = map.getZoom();
      for (const cfg of GEO_LAYER_CONFIGS) {
        const state = layerStates[cfg.id];
        if (!state?.visible) continue;
        const fillId = getFillLayerId(cfg.id);
        const lineId = getLineLayerId(cfg.id);
        const viz = !cfg.minZoom || zoom >= cfg.minZoom ? 'visible' : 'none';
        try { if (map.getLayer(fillId)) map.setLayoutProperty(fillId, 'visibility', viz); } catch {}
        try { if (map.getLayer(lineId)) map.setLayoutProperty(lineId, 'visibility', viz); } catch {}
      }
    };
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [map, layerStates]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const markers of Object.values(labelMarkerRefs.current)) {
        for (const m of markers) m.remove();
      }
      labelMarkerRefs.current = {};
    };
  }, []);

  return {
    layerStates,
    toggleGeoLayer,
    ensureLayerLoaded,
    configs: GEO_LAYER_CONFIGS,
  };
}

function escapeForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
