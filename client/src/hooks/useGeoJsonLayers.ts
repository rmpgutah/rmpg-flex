import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import { dissolveBeatsByArea } from '../utils/dissolveAreas';

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
    visible: false,
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
    visible: false,
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

const SELECTION_STYLE = {
  fillColor: '#f59e0b',
  fillOpacity: 0.25,
  strokeColor: '#f59e0b',
  strokeOpacity: 0.9,
  strokeWeight: 2.5,
};

const ASSIGNED_STYLE = {
  fillColor: '#22c55e',
  fillOpacity: 0.18,
  strokeColor: '#22c55e',
  strokeOpacity: 0.8,
  strokeWeight: 2,
};

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
  infoWindow: mapboxgl.Popup | null;
  selectionMode?: boolean;
  onFeatureClick?: (info: GeoFeatureInfo) => void;
  selectedFeatures?: Set<string>;
  assignedFeatures?: Set<string>;
  beatDistrictMap?: Map<string, Map<string, BeatDistrictEntry>>;
  hierarchyColors?: {
    sectionColors: Map<string, string>;
    zoneColors: Map<string, string>;
    areaColors: Map<string | number, string>;
    beatToArea: Map<string, string | number>;
  } | null;
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

// ── Helper: enrich a feature with style properties ──────────

function enrichFeature(
  feature: GeoJSON.Feature,
  cfg: GeoLayerConfig,
  beatStyleLookupRef: React.MutableRefObject<Map<string, BeatStyleEntry> | undefined>,
  beatDistrictMapRef: React.MutableRefObject<Map<string, Map<string, BeatDistrictEntry>> | undefined>,
  hierarchyColorsRef: React.MutableRefObject<UseGeoJsonLayersOptions['hierarchyColors']>,
): GeoJSON.Feature {
  const props = feature.properties || {};
  const fId = `${cfg.id}::${props[cfg.featureKeyProp] || ''}`;

  const geometryType = feature.geometry?.type;
  const isPoint = geometryType === 'Point' || geometryType === 'MultiPoint';
  const isLine = geometryType === 'LineString' || geometryType === 'MultiLineString';

  let fillColor: string;
  let fillOpacity: number;
  let strokeColor: string;
  let strokeOpacity: number;
  let strokeWeight: number;
  let iconScale = cfg.style.iconScale ?? 1;

  // Tier-aware beat styling
  if (cfg.id === 'beat' && hierarchyColorsRef.current) {
    const hc = hierarchyColorsRef.current;
    const cityCode = props.city_code as string | undefined;
    const distLetter = props.district_letter as string | undefined;
    const entry = lookupBeatDistrict(beatDistrictMapRef.current, cityCode, distLetter);
    const sectorCode = entry?.sectionId;
    const zoneCode = entry?.zoneId;
    fillColor = sectorCode ? (hc.sectionColors.get(sectorCode) ?? '#3a3a3a') : '#3a3a3a';
    fillOpacity = 0.30;
    strokeColor = zoneCode ? (hc.zoneColors.get(zoneCode) ?? '#666') : '#666';
    strokeOpacity = 0.85;
    strokeWeight = 1.5;
  } else if (cfg.id === 'beat') {
    const cityCode = props.city_code as string;
    const distLetter = props.district_letter as string;
    let baseStyle = cfg.style;
    if (cityCode && distLetter && beatStyleLookupRef.current) {
      const cached = beatStyleLookupRef.current.get(`${cityCode}::${distLetter}`);
      if (cached) baseStyle = cached.style;
    }
    if (baseStyle === cfg.style && cityCode) {
      const cc = getCityColor(cityCode);
      baseStyle = { ...cfg.style, fillColor: cc, strokeColor: cc, fillOpacity: 0.12, strokeOpacity: 0.5, strokeWeight: 1 };
    }
    fillColor = isLine ? 'transparent' : baseStyle.fillColor;
    fillOpacity = isLine ? 0 : baseStyle.fillOpacity;
    strokeColor = baseStyle.strokeColor;
    strokeOpacity = baseStyle.strokeOpacity;
    strokeWeight = baseStyle.strokeWeight;
  } else if (cfg.id === 'municipality') {
    const name = props.NAME as string;
    if (name) {
      const mc = getMuniColor(name);
      fillColor = mc;
      fillOpacity = 0.10;
      strokeColor = mc;
      strokeOpacity = 0.5;
      strokeWeight = cfg.style.strokeWeight;
    } else {
      fillColor = cfg.style.fillColor;
      fillOpacity = cfg.style.fillOpacity;
      strokeColor = cfg.style.strokeColor;
      strokeOpacity = cfg.style.strokeOpacity;
      strokeWeight = cfg.style.strokeWeight;
    }
  } else {
    fillColor = isLine ? 'transparent' : cfg.style.fillColor;
    fillOpacity = isLine ? 0 : cfg.style.fillOpacity;
    strokeColor = cfg.style.strokeColor;
    strokeOpacity = cfg.style.strokeOpacity;
    strokeWeight = cfg.style.strokeWeight;
  }

  (feature.properties as any)['_fid'] = fId;
  (feature.properties as any)['_isPoint'] = isPoint;
  (feature.properties as any)['_isLine'] = isLine;
  (feature.properties as any)['_fillColor'] = fillColor;
  (feature.properties as any)['_fillOpacity'] = fillOpacity;
  (feature.properties as any)['_strokeColor'] = strokeColor;
  (feature.properties as any)['_strokeOpacity'] = strokeOpacity;
  (feature.properties as any)['_strokeWeight'] = strokeWeight;
  (feature.properties as any)['_iconScale'] = iconScale;

  return feature;
}

function computeCentroid(feature: GeoJSON.Feature): [number, number] | null {
  const geom = feature.geometry;
  if (!geom) return null;
  const coords = (geom as any).coordinates;
  if (!coords || !coords.length) return null;

  if (geom.type === 'Polygon') {
    const ring = coords[0];
    let lngSum = 0, latSum = 0, count = 0;
    for (const pt of ring) {
      lngSum += pt[0];
      latSum += pt[1];
      count++;
    }
    return count > 0 ? [lngSum / count, latSum / count] : null;
  }
  if (geom.type === 'MultiPolygon') {
    let lngSum = 0, latSum = 0, count = 0;
    for (const polygon of coords) {
      for (const ring of polygon) {
        for (const pt of ring) {
          lngSum += pt[0];
          latSum += pt[1];
          count++;
        }
      }
    }
    return count > 0 ? [lngSum / count, latSum / count] : null;
  }
  return null;
}

export function useGeoJsonLayers({
  map,
  infoWindow,
  selectionMode = false,
  onFeatureClick,
  selectedFeatures,
  assignedFeatures,
  beatDistrictMap,
  hierarchyColors,
}: UseGeoJsonLayersOptions) {
  const [layerStates, setLayerStates] = useState<Record<string, GeoLayerState>>(() => {
    const initial: Record<string, GeoLayerState> = {};
    for (const cfg of GEO_LAYER_CONFIGS) {
      initial[cfg.id] = { visible: cfg.visible, loaded: false, featureCount: 0 };
    }
    return initial;
  });

  // Track which sources/layers/markers exist
  const geojsonCacheRef = useRef<Record<string, any>>({});
  const labelMarkersRef = useRef<Record<string, mapboxgl.Marker[]>>({});
  const areaBoundarySourceId = useRef<string | null>(null);
  const areaBoundaryLayerId = useRef<string | null>(null);
  const beatFeaturesCacheRef = useRef<GeoJSON.Feature<GeoJSON.Polygon>[] | null>(null);
  const loadRunningRef = useRef<Set<string>>(new Set());

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

  const hierarchyColorsRef = useRef<typeof hierarchyColors>(null);
  useEffect(() => { hierarchyColorsRef.current = hierarchyColors ?? null; }, [hierarchyColors]);

  // Rebuild area-boundary overlay when hierarchyColors arrives after beats
  useEffect(() => {
    if (!hierarchyColors || !beatFeaturesCacheRef.current || !map) return;

    // Remove existing
    if (areaBoundaryLayerId.current) {
      try { if (map.getLayer(areaBoundaryLayerId.current)) map.removeLayer(areaBoundaryLayerId.current); } catch { /* ignore */ }
      areaBoundaryLayerId.current = null;
    }
    if (areaBoundarySourceId.current) {
      try { if (map.getSource(areaBoundarySourceId.current)) map.removeSource(areaBoundarySourceId.current); } catch { /* ignore */ }
      areaBoundarySourceId.current = null;
    }

    const lines = dissolveBeatsByArea(beatFeaturesCacheRef.current, hierarchyColors.beatToArea);
    if (lines.length === 0) return;

    // Enrich lines with resolved area colors
    const coloredLines = lines.map((l: any) => ({
      ...l,
      properties: {
        ...(l.properties || {}),
        _strokeColor: hierarchyColors.areaColors.get(l.properties?.area_id) ?? '#ffffff',
      },
    }));

    const sourceId = 'area-boundary-src';
    const layerId = 'area-boundary-layer';

    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: coloredLines },
    });

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': ['get', '_strokeColor'],
        'line-width': 3,
        'line-opacity': 0.85,
      },
    });

    areaBoundarySourceId.current = sourceId;
    areaBoundaryLayerId.current = layerId;
  }, [hierarchyColors, map]);

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

  const getFeatureKey = useCallback((feature: GeoJSON.Feature, cfg: GeoLayerConfig): string => {
    const val = feature.properties?.[cfg.featureKeyProp];
    return val != null ? String(val) : '';
  }, []);

  const makeCompositeKey = (layerId: string, featureKey: string) => `${layerId}::${featureKey}`;

  // ── Insert/update selection/assigned overlay layers ─────────

  const updateOverlays = useCallback((layerId: string) => {
    if (!map) return;
    const selSourceId = `${layerId}-sel`;
    const asnSourceId = `${layerId}-asn`;
    const selFillLayer = `${layerId}-sel-fill`;
    const asnFillLayer = `${layerId}-asn-fill`;
    const selLineLayer = `${layerId}-sel-line`;
    const asnLineLayer = `${layerId}-asn-line`;
    const selCircleLayer = `${layerId}-sel-circle`;
    const asnCircleLayer = `${layerId}-asn-circle`;
    const srcId = `geojson-src-${layerId}`;
    const src = map.getSource(srcId) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    const selected = selectedFeaturesRef.current;
    const assigned = assignedFeaturesRef.current;

    // Collect features matching selection/assigned
    const selFeatures: GeoJSON.Feature[] = [];
    const asnFeatures: GeoJSON.Feature[] = [];

    if (selected || assigned) {
      const cachedData = geojsonCacheRef.current[layerId];
      if (cachedData?.features) {
        for (const feat of cachedData.features) {
          const fKey = feat.properties?.[GEO_LAYER_CONFIGS.find(c => c.id === layerId)?.featureKeyProp || ''];
          if (!fKey) continue;
          const compositeKey = makeCompositeKey(layerId, String(fKey));
          if (selected?.has(compositeKey)) {
            selFeatures.push({ ...feat });
          }
          if (assigned?.has(compositeKey)) {
            asnFeatures.push({ ...feat });
          }
        }
      }
    }

    for (const [features, prefix, styleKey] of [
      [selFeatures, 'sel', 'selected'] as const,
      [asnFeatures, 'asn', 'assigned'] as const,
    ]) {
      const sourceId = `${layerId}-${prefix}`;
      const fillLayer = `${layerId}-${prefix}-fill`;
      const lineLayer = `${layerId}-${prefix}-line`;
      const circleLayer = `${layerId}-${prefix}-circle`;

      if (features.length === 0) {
        try { if (map.getLayer(fillLayer)) map.removeLayer(fillLayer); } catch { /* ignore */ }
        try { if (map.getLayer(lineLayer)) map.removeLayer(lineLayer); } catch { /* ignore */ }
        try { if (map.getLayer(circleLayer)) map.removeLayer(circleLayer); } catch { /* ignore */ }
        try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch { /* ignore */ }
        continue;
      }

      const styleDef = styleKey === 'selected' ? SELECTION_STYLE : ASSIGNED_STYLE;
      const circleRadius = layerId === 'place' ? (4 + (styleKey === 'selected' ? 3 : 2)) : 8;

      const geojsonData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: features.map((f) => ({
          ...f,
          properties: { ...f.properties },
        })),
      };

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: geojsonData,
        });
      } else {
        (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojsonData);
      }

      if (!map.getLayer(fillLayer)) {
        map.addLayer({
          id: fillLayer,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': styleDef.fillColor,
            'fill-opacity': styleDef.fillOpacity,
          },
        });
      } else {
        map.setPaintProperty(fillLayer, 'fill-color', styleDef.fillColor);
        map.setPaintProperty(fillLayer, 'fill-opacity', styleDef.fillOpacity);
      }

      if (!map.getLayer(lineLayer)) {
        map.addLayer({
          id: lineLayer,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': styleDef.strokeColor,
            'line-opacity': styleDef.strokeOpacity,
            'line-width': styleDef.strokeWeight,
          },
        });
      } else {
        map.setPaintProperty(lineLayer, 'line-color', styleDef.strokeColor);
        map.setPaintProperty(lineLayer, 'line-opacity', styleDef.strokeOpacity);
        map.setPaintProperty(lineLayer, 'line-width', styleDef.strokeWeight);
      }

      if (!map.getLayer(circleLayer)) {
        map.addLayer({
          id: circleLayer,
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-color': styleDef.fillColor,
            'circle-opacity': styleDef.fillOpacity,
            'circle-radius': circleRadius,
            'circle-stroke-color': styleDef.strokeColor,
            'circle-stroke-opacity': styleDef.strokeOpacity,
            'circle-stroke-width': styleDef.strokeWeight,
          },
        });
      } else {
        map.setPaintProperty(circleLayer, 'circle-color', styleDef.fillColor);
        map.setPaintProperty(circleLayer, 'circle-radius', circleRadius);
      }
    }
  }, [map]);

  // ── Restyle (called when selection/assigned changes) ───────

  const restyleLayers = useCallback(() => {
    for (const cfg of GEO_LAYER_CONFIGS) {
      updateOverlays(cfg.id);
    }
  }, [updateOverlays]);

  useEffect(() => {
    restyleLayers();
  }, [selectedFeatures, assignedFeatures, selectionMode, restyleLayers]);

  useEffect(() => {
    if (beatStyleLookup) restyleLayers();
  }, [beatStyleLookup, restyleLayers]);

  // ── Build layer id constants for a config ──────────────────

  function getLayerIds(cfg: GeoLayerConfig) {
    return {
      srcId: `geojson-src-${cfg.id}`,
      fillId: `geojson-fill-${cfg.id}`,
      lineId: `geojson-line-${cfg.id}`,
      circleId: `geojson-circle-${cfg.id}`,
    };
  }

  // ── Load a single GeoJSON layer onto the map ───────────────

  const loadLayer = useCallback(async (cfg: GeoLayerConfig) => {
    if (!map) return;
    if (loadRunningRef.current.has(cfg.id)) return;
    loadRunningRef.current.add(cfg.id);

    const { srcId, fillId, lineId, circleId } = getLayerIds(cfg);

    // Already loaded - just show
    if (geojsonCacheRef.current[cfg.id]) {
      if (map.getSource(srcId)) {
        const layers = [fillId, lineId, circleId];
        for (const lid of layers) {
          if (map.getLayer(lid)) {
            map.setLayoutProperty(lid, 'visibility', 'visible');
          }
        }
      }
      loadRunningRef.current.delete(cfg.id);
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
        loadRunningRef.current.delete(cfg.id);
        return;
      }
    }

    const typedGeojson = geojson as GeoJSON.FeatureCollection;

    // Enrich features with style properties
    const enrichedFeatures: GeoJSON.Feature[] = (typedGeojson.features || []).map((f) =>
      enrichFeature({ ...f }, cfg, beatStyleLookupRef, beatDistrictMapRef, hierarchyColorsRef),
    );

    const enrichedCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: enrichedFeatures,
    };

    // Update cache with enriched data
    geojsonCacheRef.current[cfg.id] = enrichedCollection;

    // Create source
    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: 'geojson',
        data: enrichedCollection,
      });
    }

    // Determine feature types
    const hasPolygons = enrichedFeatures.some(
      (f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
    );
    const hasLines = enrichedFeatures.some(
      (f) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString',
    );
    const hasPoints = enrichedFeatures.some(
      (f) => f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint',
    );

    // Create fill layer (for polygons)
    if (hasPolygons && !map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: srcId,
        filter: ['any',
          ['==', ['geometry-type'], 'Polygon'],
          ['==', ['geometry-type'], 'MultiPolygon'],
        ],
        paint: {
          'fill-color': ['get', '_fillColor'],
          'fill-opacity': ['get', '_fillOpacity'],
        },
      });

      // Click handler for polygon features
      map.on('click', fillId, (e) => {
        if (!e.features?.length) return;
        const feat = e.features[0];
        const props: Record<string, any> = feat.properties || {};
        const fKey = String(props[cfg.featureKeyProp] || '');
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

        if (!infoWindow) return;
        let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:140px;">`;

        const entry = cfg.id === 'beat'
          ? lookupBeatDistrict(beatDistrictMapRef.current, props.city_code as string, props.district_letter as string)
          : undefined;

        if (entry) {
          const sColor = getSectionColor(entry.sectionId);
          html += `<div style="font-weight:bold;font-size:13px;color:${sColor};margin-bottom:2px;letter-spacing:1px;">${escapeForHtml(entry.dispatchCode)}</div>`;
          html += `<div style="color:#fff;font-size:11px;margin-bottom:6px;border-bottom:1px solid #444;padding-bottom:4px;">${escapeForHtml(entry.beatName)}${entry.beatDescriptor ? ' — ' + escapeForHtml(entry.beatDescriptor) : ''}</div>`;
          html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:${sColor};">Section:</span> <span style="color:#ddd;">${escapeForHtml(entry.sectionId)} — ${escapeForHtml(entry.sectionName)}</span></div>`;
          html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Zone:</span> <span style="color:#ddd;">${escapeForHtml(entry.zoneId)} — ${escapeForHtml(entry.zoneName)}</span></div>`;
          html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Beat:</span> <span style="color:#ddd;">${escapeForHtml(entry.beatId)}</span></div>`;
        } else if (cfg.id === 'beat') {
          const cityCode = String(props.city_code || '').toUpperCase();
          const distLetter = String(props.district_letter || '').toUpperCase();
          const cityName = String(props.city || '');
          const isUninc = distLetter === 'U' || /unincorp/i.test(cityName);
          const chartLabel = cityCode && distLetter ? `${cityCode}/${distLetter}` : (props.beat_code || cityCode || 'Unknown');
          html += `<div style="font-weight:bold;font-size:13px;color:#d4a017;margin-bottom:2px;letter-spacing:1px;">${escapeForHtml(chartLabel)}</div>`;
          html += `<div style="color:#fff;font-size:11px;margin-bottom:6px;border-bottom:1px solid #444;padding-bottom:4px;">${escapeForHtml(cityName || 'Beat polygon')}${isUninc ? ' — Unincorporated' : ''}</div>`;
          html += `<div style="font-size:10px;color:#888;margin-top:2px;font-style:italic;">No canonical dispatch beat — assign manually</div>`;
        } else {
          html += buildDefaultInfoHtml(name, cfg, props);
        }

        const compositeKey = makeCompositeKey(cfg.id, fKey);
        if (assignedFeaturesRef.current?.has(compositeKey)) {
          html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #333;font-size:9px;color:#22c55e;font-weight:bold;">● ASSIGNED</div>`;
        }

        html += `</div>`;
        infoWindow.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    }

    // Create line layer (for strokes on polygons and for line features)
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        paint: {
          'line-color': ['get', '_strokeColor'],
          'line-opacity': ['get', '_strokeOpacity'],
          'line-width': ['get', '_strokeWeight'],
        },
      });

      map.on('click', lineId, (e) => {
        if (!e.features?.length) return;
        const feat = e.features[0];
        const props: Record<string, any> = feat.properties || {};
        const fKey = String(props[cfg.featureKeyProp] || '');
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

        if (!infoWindow) return;
        let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:140px;">`;
        if (cfg.id === 'beat') {
          const cityCode = String(props.city_code || '').toUpperCase();
          const distLetter = String(props.district_letter || '').toUpperCase();
          const cityName = String(props.city || '');
          const isUninc = distLetter === 'U' || /unincorp/i.test(cityName);
          const chartLabel = cityCode && distLetter ? `${cityCode}/${distLetter}` : (props.beat_code || cityCode || 'Unknown');
          html += `<div style="font-weight:bold;font-size:13px;color:#d4a017;margin-bottom:2px;letter-spacing:1px;">${escapeForHtml(chartLabel)}</div>`;
          html += `<div style="color:#fff;font-size:11px;margin-bottom:6px;border-bottom:1px solid #444;padding-bottom:4px;">${escapeForHtml(cityName || 'Beat polygon')}${isUninc ? ' — Unincorporated' : ''}</div>`;
          html += `<div style="font-size:10px;color:#888;margin-top:2px;font-style:italic;">No canonical dispatch beat — assign manually</div>`;
        } else {
          html += buildDefaultInfoHtml(name, cfg, props);
        }
        html += `</div>`;
        infoWindow.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    }

    // Create circle layer (for point features)
    if (hasPoints && !map.getLayer(circleId)) {
      map.addLayer({
        id: circleId,
        type: 'circle',
        source: srcId,
        filter: ['any',
          ['==', ['geometry-type'], 'Point'],
          ['==', ['geometry-type'], 'MultiPoint'],
        ],
        paint: {
          'circle-color': ['get', '_fillColor'],
          'circle-opacity': ['get', '_fillOpacity'],
          'circle-radius': ['get', '_iconScale'],
          'circle-stroke-color': ['get', '_strokeColor'],
          'circle-stroke-opacity': ['get', '_strokeOpacity'],
          'circle-stroke-width': ['get', '_strokeWeight'],
        },
      });

      map.on('click', circleId, (e) => {
        if (!e.features?.length) return;
        const feat = e.features[0];
        const props: Record<string, any> = feat.properties || {};
        const fKey = String(props[cfg.featureKeyProp] || '');
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

        if (!infoWindow) return;
        const html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:140px;">${buildDefaultInfoHtml(name, cfg, props)}</div>`;
        infoWindow.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    }

    // Update feature count
    const count = enrichedFeatures.length;
    setLayerStates((prev) => ({
      ...prev,
      [cfg.id]: { ...prev[cfg.id], loaded: true, featureCount: count },
    }));

    // ── Beat label overlays ──
    if (cfg.id === 'beat') {
      for (const feature of enrichedFeatures) {
        const props = feature.properties || {};
        const cityCode = props.city_code as string;
        const distLetter = props.district_letter as string;
        const beatCode = props.beat_code as string;
        if (!cityCode) continue;

        const entry = beatDistrictMapRef.current
          ? lookupBeatDistrict(beatDistrictMapRef.current, cityCode, distLetter)
          : null;
        const labelText = entry
          ? (entry.dispatchCode || `${entry.zoneId}/${entry.beatId}`)
          : (distLetter ? `${cityCode}/${distLetter}` : beatCode || cityCode);

        const centroid = computeCentroid(feature);
        if (!centroid) continue;

        const labelColor = getCityColor(cityCode);
        const el = document.createElement('div');
        el.style.cssText = `color:${labelColor};font-size:9px;font-weight:bold;font-family:'JetBrains Mono','Courier New',monospace;text-shadow:0 0 2px #000,0 0 2px #000;pointer-events:none;line-height:1;`;
        el.textContent = labelText;

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(centroid)
          .addTo(map);

        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      }

      // Cache beat features for area boundary
      if (!beatFeaturesCacheRef.current) {
        const beatFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
        for (const f of enrichedFeatures) {
          if (f.geometry?.type !== 'Polygon') continue;
          beatFeatures.push({
            type: 'Feature',
            properties: { beat_code: f.properties?.beat_code },
            geometry: { type: 'Polygon', coordinates: (f.geometry as GeoJSON.Polygon).coordinates },
          });
        }
        beatFeaturesCacheRef.current = beatFeatures;
      }

      // Area boundary on initial load if hierarchyColors available
      if (hierarchyColorsRef.current && !areaBoundaryLayerId.current && beatFeaturesCacheRef.current) {
        const lines = dissolveBeatsByArea(beatFeaturesCacheRef.current, hierarchyColorsRef.current.beatToArea);
        if (lines.length > 0) {
          const coloredLines = lines.map((l: any) => ({
            ...l,
            properties: {
              ...(l.properties || {}),
              _strokeColor: hierarchyColorsRef.current!.areaColors.get(l.properties?.area_id) ?? '#ffffff',
            },
          }));
          const srcId = 'area-boundary-src';
          const layerId = 'area-boundary-layer';
          if (!map.getSource(srcId)) {
            map.addSource(srcId, {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: coloredLines },
            });
          }
          if (!map.getLayer(layerId)) {
            map.addLayer({
              id: layerId,
              type: 'line',
              source: srcId,
              paint: {
                'line-color': ['get', '_strokeColor'],
                'line-width': 3,
                'line-opacity': 0.85,
              },
            });
          }
          areaBoundarySourceId.current = srcId;
          areaBoundaryLayerId.current = layerId;
        }
      }
    }

    // ── County label overlays ──
    if (cfg.id === 'county') {
      for (const feature of enrichedFeatures) {
        const props = feature.properties || {};
        const name = props.NAME as string;
        if (!name) continue;
        const centroid = computeCentroid(feature);
        if (!centroid) continue;

        const el = document.createElement('div');
        el.style.cssText = `color:#88888880;font-size:10px;font-weight:bold;font-family:'JetBrains Mono','Courier New',monospace;text-shadow:0 0 2px #000;pointer-events:none;line-height:1;text-transform:uppercase;`;
        el.textContent = name.toUpperCase() + ' CO.';

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(centroid)
          .addTo(map);

        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      }
    }

    // ── Municipality label overlays ──
    if (cfg.id === 'municipality') {
      for (const feature of enrichedFeatures) {
        const props = feature.properties || {};
        const name = props.NAME as string;
        if (!name) continue;
        const centroid = computeCentroid(feature);
        if (!centroid) continue;

        const mc = getMuniColor(name);
        const el = document.createElement('div');
        el.style.cssText = `color:${mc};font-size:8px;font-weight:bold;font-family:'JetBrains Mono','Courier New',monospace;text-shadow:0 0 2px #000;pointer-events:none;line-height:1;`;
        el.textContent = name.toUpperCase();

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(centroid)
          .addTo(map);

        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      }
    }

    // Apply current selection/assigned overlays
    updateOverlays(cfg.id);
    loadRunningRef.current.delete(cfg.id);
  }, [map, infoWindow, getFeatureKey, updateOverlays]);

  // ── Ensure layer is loaded ─────────────────────────────────

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

  // ── Toggle layer visibility ────────────────────────────────

  const toggleGeoLayer = useCallback((layerId: string) => {
    setLayerStates((prev) => {
      const curr = prev[layerId];
      if (!curr) return prev;
      const nowVisible = !curr.visible;

      const { srcId, fillId, lineId, circleId } = getLayerIds({ id: layerId } as GeoLayerConfig);
      // We'll derive from the actual config
      const cfg = GEO_LAYER_CONFIGS.find((c) => c.id === layerId);
      if (!cfg) return prev;

      const lids = getLayerIds(cfg);
      const layersToToggle = [lids.fillId, lids.lineId, lids.circleId];

      // Also toggle selection/assigned layers
      if (cfg.selectable) {
        layersToToggle.push(`${layerId}-sel-fill`, `${layerId}-sel-line`, `${layerId}-sel-circle`);
        layersToToggle.push(`${layerId}-asn-fill`, `${layerId}-asn-line`, `${layerId}-asn-circle`);
      }

      if (map) {
        const visibility = nowVisible ? 'visible' : 'none';
        for (const lid of layersToToggle) {
          try {
            if (map.getLayer(lid)) {
              map.setLayoutProperty(lid, 'visibility', visibility as any);
            }
          } catch { /* ignore layer might not exist yet */ }
        }
      }

      // Toggle label markers
      const labels = labelMarkersRef.current[layerId];
      if (labels) {
        for (const m of labels) {
          if (nowVisible) {
            m.addTo(map!);
          } else {
            m.remove();
          }
        }
      }

      return { ...prev, [layerId]: { ...curr, visible: nowVisible } };
    });
  }, [map]);

  // ── Auto-load visible layers when map is ready ─────────────

  useEffect(() => {
    if (!map) return;

    for (const cfg of GEO_LAYER_CONFIGS) {
      const state = layerStates[cfg.id];
      if (state?.visible && !state.loaded) {
        loadLayer(cfg);
      }
    }
  }, [map, layerStates, loadLayer]);

  // ── Zoom-based visibility management ───────────────────────

  useEffect(() => {
    if (!map) return;

    const handler = () => {
      const zoom = map.getZoom();
      for (const cfg of GEO_LAYER_CONFIGS) {
        const state = layerStates[cfg.id];
        if (!state?.visible) continue;

        const visible = !cfg.minZoom || zoom >= cfg.minZoom;
        const layers = getLayerIds(cfg);
        const visibility = visible ? 'visible' : 'none';

        for (const lid of [layers.fillId, layers.lineId, layers.circleId]) {
          try {
            if (map.getLayer(lid)) {
              map.setLayoutProperty(lid, 'visibility', visibility as any);
            }
          } catch { /* ignore */ }
        }

        // Also toggle selection/assigned layers
        for (const suffix of ['-sel-fill', '-sel-line', '-sel-circle', '-asn-fill', '-asn-line', '-asn-circle']) {
          const lid = `${cfg.id}${suffix}`;
          try {
            if (map.getLayer(lid)) {
              map.setLayoutProperty(lid, 'visibility', visibility as any);
            }
          } catch { /* ignore */ }
        }

        // Toggle labels based on zoom
        const labels = labelMarkersRef.current[cfg.id];
        if (labels) {
          const showLabels = visible && zoom >= 10;
          for (const m of labels) {
            if (showLabels) {
              if (!m.getLngLat()) m.addTo(map);
            } else {
              m.remove();
            }
          }
        }
      }
    };

    map.on('zoom', handler);
    return () => { map.off('zoom', handler); };
  }, [map, layerStates]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      if (!map) return;

      // Remove all geo layers
      for (const cfg of GEO_LAYER_CONFIGS) {
        const lids = getLayerIds(cfg);
        for (const lid of [lids.fillId, lids.lineId, lids.circleId]) {
          try { if (map.getLayer(lid)) map.removeLayer(lid); } catch { /* ignore */ }
        }
        try { if (map.getSource(lids.srcId)) map.removeSource(lids.srcId); } catch { /* ignore */ }

        // Remove selection/assigned overlays
        for (const suffix of ['-sel-fill', '-sel-line', '-sel-circle', '-asn-fill', '-asn-line', '-asn-circle']) {
          try { if (map.getLayer(`${cfg.id}${suffix}`)) map.removeLayer(`${cfg.id}${suffix}`); } catch { /* ignore */ }
        }
        for (const suffix of ['-sel', '-asn']) {
          try { if (map.getSource(`${cfg.id}${suffix}`)) map.removeSource(`${cfg.id}${suffix}`); } catch { /* ignore */ }
        }
      }

      // Clean up label markers
      for (const markers of Object.values(labelMarkersRef.current)) {
        for (const m of markers) m.remove();
      }
      labelMarkersRef.current = {};
      geojsonCacheRef.current = {};
      beatFeaturesCacheRef.current = null;

      // Remove area boundary
      if (areaBoundaryLayerId.current) {
        try { if (map.getLayer(areaBoundaryLayerId.current)) map.removeLayer(areaBoundaryLayerId.current); } catch { /* ignore */ }
      }
      if (areaBoundarySourceId.current) {
        try { if (map.getSource(areaBoundarySourceId.current)) map.removeSource(areaBoundarySourceId.current); } catch { /* ignore */ }
      }
    };
  }, [map]);

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
