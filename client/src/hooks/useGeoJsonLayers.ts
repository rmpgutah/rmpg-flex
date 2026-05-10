// ============================================================
// RMPG Flex — GeoJSON Layer Manager Hook (Mapbox GL JS)
// ============================================================
// Loads split GeoJSON layer files from /geojson/ and renders
// them as Mapbox GL sources + layers. Supports lazy loading,
// per-layer toggle, click popups, style theming, and
// interactive selection mode for shift planning.
// ============================================================

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { dissolveBeatsByArea } from '../utils/dissolveAreas';

// ── Layer Configuration ──────────────────────────────────────

export interface GeoLayerConfig {
  id: string;
  label: string;
  file: string;
  visible: boolean;
  /** Whether features in this layer can be selected for shift planning */
  selectable: boolean;
  style: {
    fillColor: string;
    fillOpacity: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeWeight: number;
    /** For Point geometry */
    iconScale?: number;
  };
  /** Which property to display as the primary label in info windows */
  labelProp: string;
  /** Property used as the unique feature key for selection tracking */
  featureKeyProp: string;
  /** Optional secondary detail props */
  detailProps?: string[];
  /** Minimum zoom to show this layer (performance) */
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

// ── Selection highlight colors ───────────────────────────────

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

// ── Municipality color palette (hash-based for 257 municipalities) ──
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

// ── Section color palette (12 distinct hues for beat sections) ──

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

/** Per-city color — 24 medium-bright hues visible on dark map tiles */
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

// ── Beat-District enrichment data ────────────────────────────

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

/** Pre-computed style for a beat polygon, keyed by "city_code::district_letter" */
interface BeatStyleEntry {
  style: GeoLayerConfig['style'];
  entry: BeatDistrictEntry;
}

// ── Exported Feature Info type ───────────────────────────────

export interface GeoFeatureInfo {
  layerId: string;
  featureKey: string;
  label: string;
  properties: Record<string, any>;
}

// ── Hook ─────────────────────────────────────────────────────

interface UseGeoJsonLayersOptions {
  map: mapboxgl.Map | null;
  /** When true, clicking a selectable feature calls onFeatureClick instead of showing popup */
  selectionMode?: boolean;
  /** Called when a feature is clicked in selection mode */
  onFeatureClick?: (info: GeoFeatureInfo) => void;
  /** Set of "layerId::featureKey" strings currently selected */
  selectedFeatures?: Set<string>;
  /** Set of "layerId::featureKey" strings that have been assigned */
  assignedFeatures?: Set<string>;
  /** Beat-district enrichment: Map<city_code, Map<district_letter, BeatDistrictEntry>> */
  beatDistrictMap?: Map<string, Map<string, BeatDistrictEntry>>;
  /** Hierarchy color lookups for tier-aware beat polygon styling */
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

// ── Shared district lookup helper ────────────────────────────

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

// ── Default popup HTML builder ───────────────────────────────

function buildDefaultInfoHtml(name: string, cfg: GeoLayerConfig, props: Record<string, any>): string {
  let html = `<div style="font-weight:bold;font-size:12px;color:#fff;margin-bottom:4px;border-bottom:1px solid #444;padding-bottom:3px;">${escapeForHtml(String(name))}</div>`;
  html += `<div style="color:#888;font-size:9px;text-transform:uppercase;margin-bottom:4px;">${cfg.label}</div>`;
  if (cfg.detailProps) {
    for (const p of cfg.detailProps) {
      if (props[p] !== undefined && props[p] !== null && props[p] !== '') {
        const label = p.replace(/_/g, ' ').toUpperCase().replace(/^(POP_CURRESTIMATE|POPLASTESTIMATE)$/i, 'Population');
        html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">${escapeForHtml(label)}:</span> ${escapeForHtml(String(props[p]))}</div>`;
      }
    }
  }
  return html;
}

// ── Mapbox layer ID helpers ──────────────────────────────────

function fillLayerId(cfgId: string) { return `geolayer-fill-${cfgId}`; }
function lineLayerId(cfgId: string) { return `geolayer-line-${cfgId}`; }
function circleLayerId(cfgId: string) { return `geolayer-circle-${cfgId}`; }
function sourceId(cfgId: string) { return `geolayer-src-${cfgId}`; }

const AREA_BOUNDARY_SOURCE = 'geolayer-area-boundary-src';
const AREA_BOUNDARY_LINE = 'geolayer-area-boundary-line';

// ── Centroid calculation from GeoJSON coordinates ────────────

function computeCentroid(feature: Feature): [number, number] | null {
  const geom = feature.geometry;
  if (!geom) return null;
  let lngSum = 0, latSum = 0, count = 0;
  const addCoords = (coords: number[]) => { lngSum += coords[0]; latSum += coords[1]; count++; };
  const walkRing = (ring: number[][]) => ring.forEach(addCoords);
  const walkPolygon = (rings: number[][][]) => rings.forEach(walkRing);
  if (geom.type === 'Polygon') walkPolygon(geom.coordinates);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(walkPolygon);
  else if (geom.type === 'Point') { addCoords(geom.coordinates); }
  else if (geom.type === 'LineString') geom.coordinates.forEach(addCoords);
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(walkRing);
  if (count === 0) return null;
  return [lngSum / count, latSum / count];
}

// ── Create a label marker (HTML div) ─────────────────────────

function createLabelMarker(
  lngLat: [number, number],
  text: string,
  color: string,
  fontSize: string,
  map: mapboxgl.Map,
): mapboxgl.Marker {
  const el = document.createElement('div');
  el.style.cssText = `font-family:JetBrains Mono,Courier New,monospace;font-size:${fontSize};font-weight:bold;color:${color};white-space:nowrap;pointer-events:none;text-shadow:0 0 3px rgba(0,0,0,0.8);`;
  el.textContent = text;
  return new mapboxgl.Marker({ element: el, anchor: 'center' })
    .setLngLat(lngLat)
    .addTo(map);
}

// ── Safe layer/source removal ────────────────────────────────

function safeRemoveLayer(map: mapboxgl.Map, id: string) {
  try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* noop */ }
}
function safeRemoveSource(map: mapboxgl.Map, id: string) {
  try { if (map.getSource(id)) map.removeSource(id); } catch { /* noop */ }
}

export function useGeoJsonLayers({
  map,
  selectionMode = false,
  onFeatureClick,
  selectedFeatures,
  assignedFeatures,
  beatDistrictMap,
  hierarchyColors,
}: UseGeoJsonLayersOptions) {
  // Per-layer visibility state
  const [layerStates, setLayerStates] = useState<Record<string, GeoLayerState>>(() => {
    const initial: Record<string, GeoLayerState> = {};
    for (const cfg of GEO_LAYER_CONFIGS) {
      initial[cfg.id] = { visible: cfg.visible, loaded: false, featureCount: 0 };
    }
    return initial;
  });

  // Track which Mapbox sources/layers we've added
  const addedSourcesRef = useRef<Set<string>>(new Set());
  // Cache loaded GeoJSON objects so we don't re-fetch
  const geojsonCacheRef = useRef<Record<string, FeatureCollection>>({});
  // Label markers for beat/zone text overlays
  const labelMarkersRef = useRef<Record<string, mapboxgl.Marker[]>>({});
  // Active popup ref
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  // Cached beat features for area boundary overlay
  const beatFeaturesCacheRef = useRef<Feature<Polygon>[] | null>(null);
  // Track whether area boundary overlay exists
  const areaBoundaryAddedRef = useRef(false);

  // Refs for latest callback/selection state (avoids re-creating layers)
  const selectionModeRef = useRef(selectionMode);
  const onFeatureClickRef = useRef(onFeatureClick);
  const selectedFeaturesRef = useRef(selectedFeatures);
  const assignedFeaturesRef = useRef(assignedFeatures);

  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);
  useEffect(() => { onFeatureClickRef.current = onFeatureClick; }, [onFeatureClick]);
  useEffect(() => { selectedFeaturesRef.current = selectedFeatures; }, [selectedFeatures]);
  useEffect(() => { assignedFeaturesRef.current = assignedFeatures; }, [assignedFeatures]);

  // Beat-district enrichment ref
  const beatDistrictMapRef = useRef(beatDistrictMap);
  useEffect(() => { beatDistrictMapRef.current = beatDistrictMap; }, [beatDistrictMap]);

  // Hierarchy color lookup ref
  const hierarchyColorsRef = useRef<typeof hierarchyColors>(null);
  useEffect(() => { hierarchyColorsRef.current = hierarchyColors ?? null; }, [hierarchyColors]);

  // ── Area-boundary overlay rebuild (late-arriving hierarchyColors) ──

  const addAreaBoundaryOverlay = useCallback((m: mapboxgl.Map, hc: NonNullable<typeof hierarchyColors>) => {
    if (!beatFeaturesCacheRef.current) return;
    // Tear down existing
    safeRemoveLayer(m, AREA_BOUNDARY_LINE);
    safeRemoveSource(m, AREA_BOUNDARY_SOURCE);
    areaBoundaryAddedRef.current = false;

    const lines = dissolveBeatsByArea(beatFeaturesCacheRef.current, hc.beatToArea);
    if (lines.length === 0) return;

    // Build per-feature color expressions
    const colorExpr: any[] = ['match', ['get', 'area_id']];
    const seenAreas = new Set<string>();
    for (const f of lines) {
      const aId = String(f.properties?.area_id ?? '');
      if (seenAreas.has(aId)) continue;
      seenAreas.add(aId);
      colorExpr.push(aId, hc.areaColors.get(f.properties?.area_id) ?? '#fff');
    }
    colorExpr.push('#fff'); // fallback

    m.addSource(AREA_BOUNDARY_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: lines } as FeatureCollection,
    });
    m.addLayer({
      id: AREA_BOUNDARY_LINE,
      type: 'line',
      source: AREA_BOUNDARY_SOURCE,
      paint: {
        'line-color': colorExpr as any,
        'line-width': 3,
        'line-opacity': 0.85,
      },
    });
    areaBoundaryAddedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hierarchyColors || !beatFeaturesCacheRef.current || !map) return;
    addAreaBoundaryOverlay(map, hierarchyColors);
  }, [hierarchyColors, map, addAreaBoundaryOverlay]);

  // Pre-compute flat beat style lookup: "city_code::district_letter" → BeatStyleEntry
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

  // ── Compute per-feature paint properties for Mapbox data-driven styling ──

  const computeLayerPaint = useCallback((cfg: GeoLayerConfig, geojson: FeatureCollection) => {
    // For polygon/line layers we build data-driven fill+line paint.
    // We mutate feature properties in-place to embed resolved colors,
    // then use ['get', '_fill'] etc. as data-driven paint expressions.
    for (const feature of geojson.features) {
      const props = feature.properties ?? {};
      const geomType = feature.geometry?.type ?? '';
      const isLine = geomType === 'LineString' || geomType === 'MultiLineString';
      const fKey = props[cfg.featureKeyProp] != null ? String(props[cfg.featureKeyProp]) : '';
      const compositeKey = makeCompositeKey(cfg.id, fKey);
      const isSelected = selectionModeRef.current && selectedFeaturesRef.current?.has(compositeKey);
      const isAssigned = assignedFeaturesRef.current?.has(compositeKey);

      let fillColor = cfg.style.fillColor;
      let fillOpacity = cfg.style.fillOpacity;
      let strokeColor = cfg.style.strokeColor;
      let strokeOpacity = cfg.style.strokeOpacity;
      let strokeWeight = cfg.style.strokeWeight;

      // Tier-aware beat styling
      if (cfg.id === 'beat' && !isSelected && !isAssigned && hierarchyColorsRef.current) {
        const hc = hierarchyColorsRef.current;
        const entry = lookupBeatDistrict(beatDistrictMapRef.current, props.city_code, props.district_letter);
        const sectorCode = entry?.sectionId;
        const zoneCode = entry?.zoneId;
        fillColor = sectorCode ? (hc.sectionColors.get(sectorCode) ?? '#3a3a3a') : '#3a3a3a';
        fillOpacity = 0.30;
        strokeColor = zoneCode ? (hc.zoneColors.get(zoneCode) ?? '#666') : '#666';
        strokeWeight = 1.5;
        strokeOpacity = 0.85;
      } else if (cfg.id === 'beat' && !isSelected && !isAssigned) {
        const cityCode = props.city_code as string;
        const distLetter = props.district_letter as string;
        if (cityCode && distLetter && beatStyleLookupRef.current) {
          const cached = beatStyleLookupRef.current.get(`${cityCode}::${distLetter}`);
          if (cached) {
            fillColor = cached.style.fillColor;
            fillOpacity = cached.style.fillOpacity;
            strokeColor = cached.style.strokeColor;
            strokeOpacity = cached.style.strokeOpacity;
            strokeWeight = cached.style.strokeWeight;
          }
        }
        if (fillColor === cfg.style.fillColor && cityCode) {
          const cc = getCityColor(cityCode);
          fillColor = cc; strokeColor = cc; fillOpacity = 0.12; strokeOpacity = 0.5; strokeWeight = 1;
        }
      } else if (cfg.id === 'municipality' && !isSelected && !isAssigned) {
        const name = props.NAME as string;
        if (name) {
          const mc = getMuniColor(name);
          fillColor = mc; strokeColor = mc; fillOpacity = 0.10; strokeOpacity = 0.5;
        }
      }

      if (isSelected) {
        fillColor = SELECTION_STYLE.fillColor; fillOpacity = SELECTION_STYLE.fillOpacity;
        strokeColor = SELECTION_STYLE.strokeColor; strokeOpacity = SELECTION_STYLE.strokeOpacity;
        strokeWeight = SELECTION_STYLE.strokeWeight;
      } else if (isAssigned) {
        fillColor = ASSIGNED_STYLE.fillColor; fillOpacity = ASSIGNED_STYLE.fillOpacity;
        strokeColor = ASSIGNED_STYLE.strokeColor; strokeOpacity = ASSIGNED_STYLE.strokeOpacity;
        strokeWeight = ASSIGNED_STYLE.strokeWeight;
      }

      if (isLine) { fillColor = 'transparent'; fillOpacity = 0; }

      props._fill = fillColor;
      props._fillOp = fillOpacity;
      props._stroke = strokeColor;
      props._strokeOp = strokeOpacity;
      props._strokeW = strokeWeight;
      feature.properties = props;
    }
  }, []);

  // ── Restyle all loaded layers ──────────────────────────────

  const restyleLayers = useCallback(() => {
    if (!map) return;
    for (const cfg of GEO_LAYER_CONFIGS) {
      const sid = sourceId(cfg.id);
      const src = map.getSource(sid) as mapboxgl.GeoJSONSource | undefined;
      if (!src) continue;
      const geojson = geojsonCacheRef.current[cfg.id];
      if (!geojson) continue;
      computeLayerPaint(cfg, geojson);
      src.setData(geojson);
    }
  }, [map, computeLayerPaint]);

  // Re-style when selection/assigned sets change
  useEffect(() => { restyleLayers(); }, [selectedFeatures, assignedFeatures, selectionMode, restyleLayers]);
  useEffect(() => { if (beatStyleLookup) restyleLayers(); }, [beatStyleLookup, restyleLayers]);

  // ── Click handler factory ──────────────────────────────────

  const handleLayerClick = useCallback((cfg: GeoLayerConfig, e: mapboxgl.MapLayerMouseEvent) => {
    if (!map || !e.features || e.features.length === 0) return;
    const feature = e.features[0];
    const props = { ...(feature.properties ?? {}) };
    const fKey = props[cfg.featureKeyProp] != null ? String(props[cfg.featureKeyProp]) : '';
    const name = props[cfg.labelProp] || props.name || props.NAME || cfg.label;

    // Selection mode — delegate to callback
    if (selectionModeRef.current && cfg.selectable && onFeatureClickRef.current) {
      onFeatureClickRef.current({
        layerId: cfg.id,
        featureKey: fKey,
        label: String(name),
        properties: props,
      });
      return;
    }

    // Normal mode — show popup
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

    popupRef.current?.remove();
    popupRef.current = new mapboxgl.Popup({ closeButton: true, className: 'geolayer-popup' })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  }, [map]);

  // ── Load a single GeoJSON layer onto the map ───────────────

  const loadLayer = useCallback(async (cfg: GeoLayerConfig) => {
    if (!map) return;
    const sid = sourceId(cfg.id);

    // Already added? Just toggle visibility
    if (addedSourcesRef.current.has(cfg.id)) {
      const vis = 'visible' as const;
      if (map.getLayer(fillLayerId(cfg.id))) map.setLayoutProperty(fillLayerId(cfg.id), 'visibility', vis);
      if (map.getLayer(lineLayerId(cfg.id))) map.setLayoutProperty(lineLayerId(cfg.id), 'visibility', vis);
      if (map.getLayer(circleLayerId(cfg.id))) map.setLayoutProperty(circleLayerId(cfg.id), 'visibility', vis);
      return;
    }

    // Fetch the GeoJSON
    let geojson = geojsonCacheRef.current[cfg.id];
    if (!geojson) {
      try {
        const resp = await fetch(`/geojson/${cfg.file}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        geojson = (await resp.json()) as FeatureCollection;
        geojsonCacheRef.current[cfg.id] = geojson;
      } catch (err) {
        console.error(`[GeoJSON] Failed to load ${cfg.file}:`, err);
        return;
      }
    }

    // Compute per-feature paint properties
    computeLayerPaint(cfg, geojson);

    // Add source
    map.addSource(sid, { type: 'geojson', data: geojson });

    // Add fill layer (for polygon features)
    map.addLayer({
      id: fillLayerId(cfg.id),
      type: 'fill',
      source: sid,
      filter: ['any',
        ['==', ['geometry-type'], 'Polygon'],
        ['==', ['geometry-type'], 'MultiPolygon'],
      ],
      paint: {
        'fill-color': ['coalesce', ['get', '_fill'], cfg.style.fillColor],
        'fill-opacity': ['coalesce', ['get', '_fillOp'], cfg.style.fillOpacity],
      },
      ...(cfg.minZoom ? { minzoom: cfg.minZoom } : {}),
    });

    // Add line layer (for polygon outlines + linestring features)
    map.addLayer({
      id: lineLayerId(cfg.id),
      type: 'line',
      source: sid,
      filter: ['any',
        ['==', ['geometry-type'], 'Polygon'],
        ['==', ['geometry-type'], 'MultiPolygon'],
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['geometry-type'], 'MultiLineString'],
      ],
      paint: {
        'line-color': ['coalesce', ['get', '_stroke'], cfg.style.strokeColor],
        'line-width': ['coalesce', ['get', '_strokeW'], cfg.style.strokeWeight],
        'line-opacity': ['coalesce', ['get', '_strokeOp'], cfg.style.strokeOpacity],
      },
      ...(cfg.minZoom ? { minzoom: cfg.minZoom } : {}),
    });

    // Add circle layer (for point features)
    map.addLayer({
      id: circleLayerId(cfg.id),
      type: 'circle',
      source: sid,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': ['coalesce', ['get', '_fill'], cfg.style.fillColor],
        'circle-opacity': ['coalesce', ['get', '_fillOp'], cfg.style.fillOpacity],
        'circle-radius': cfg.style.iconScale ?? 4,
        'circle-stroke-color': ['coalesce', ['get', '_stroke'], cfg.style.strokeColor],
        'circle-stroke-width': ['coalesce', ['get', '_strokeW'], cfg.style.strokeWeight],
        'circle-stroke-opacity': ['coalesce', ['get', '_strokeOp'], cfg.style.strokeOpacity],
      },
      ...(cfg.minZoom ? { minzoom: cfg.minZoom } : {}),
    });

    // Click handlers
    const clickableIds = [fillLayerId(cfg.id), lineLayerId(cfg.id), circleLayerId(cfg.id)];
    for (const layerId of clickableIds) {
      map.on('click', layerId, (e) => handleLayerClick(cfg, e));
      map.on('mouseenter', layerId, () => {
        if (selectionModeRef.current && cfg.selectable) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    }

    addedSourcesRef.current.add(cfg.id);

    // Update feature count
    const count = geojson.features?.length ?? 0;
    setLayerStates((prev) => ({
      ...prev,
      [cfg.id]: { ...prev[cfg.id], loaded: true, featureCount: count },
    }));

    // ── Beat label overlays ──
    if (cfg.id === 'beat') {
      for (const feature of geojson.features) {
        const props = feature.properties ?? {};
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
        const marker = createLabelMarker(centroid, labelText, labelColor, '9px', map);
        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      }

      // Cache beat features for area boundary overlay
      if (!beatFeaturesCacheRef.current) {
        beatFeaturesCacheRef.current = geojson.features.filter(
          (f): f is Feature<Polygon> => f.geometry?.type === 'Polygon'
        );
      }

      // Build area boundary overlay if hierarchyColors already available
      if (hierarchyColorsRef.current && !areaBoundaryAddedRef.current) {
        addAreaBoundaryOverlay(map, hierarchyColorsRef.current);
      }
    }

    // ── County label overlays ──
    if (cfg.id === 'county') {
      for (const feature of geojson.features) {
        const name = (feature.properties?.NAME as string) ?? '';
        if (!name) continue;
        const centroid = computeCentroid(feature);
        if (!centroid) continue;
        const marker = createLabelMarker(centroid, name.toUpperCase() + ' CO.', '#88888880', '10px', map);
        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      }
    }

    // ── Municipality label overlays ──
    if (cfg.id === 'municipality') {
      for (const feature of geojson.features) {
        const name = (feature.properties?.NAME as string) ?? '';
        if (!name) continue;
        const centroid = computeCentroid(feature);
        if (!centroid) continue;
        const mc = getMuniColor(name);
        const marker = createLabelMarker(centroid, name.toUpperCase(), mc, '8px', map);
        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      }
    }

    // Apply current styles after load
    restyleLayers();
  }, [map, computeLayerPaint, handleLayerClick, restyleLayers, addAreaBoundaryOverlay]);

  // ── Ensure layer is loaded (for shift planning) ────────────

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

      if (map) {
        const vis = nowVisible ? 'visible' : 'none';
        const ids = [fillLayerId(layerId), lineLayerId(layerId), circleLayerId(layerId)];
        for (const id of ids) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
        }
      }

      // Show/hide label markers for this layer
      const labels = labelMarkersRef.current[layerId];
      if (labels) {
        for (const m of labels) {
          if (nowVisible) m.addTo(map!);
          else m.remove();
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

  // ── Zoom-based label visibility ────────────────────────────

  useEffect(() => {
    if (!map) return;

    const handleZoom = () => {
      const zoom = map.getZoom();
      for (const cfg of GEO_LAYER_CONFIGS) {
        const state = layerStates[cfg.id];
        if (!state?.visible) continue;
        const labels = labelMarkersRef.current[cfg.id];
        if (!labels) continue;
        const showLabels = (!cfg.minZoom || zoom >= cfg.minZoom) && zoom >= 10;
        for (const m of labels) {
          if (showLabels) m.addTo(map);
          else m.remove();
        }
      }
    };

    map.on('zoom', handleZoom);
    return () => { map.off('zoom', handleZoom); };
  }, [map, layerStates]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      if (map) {
        // Remove all layers and sources we added
        for (const cfgId of addedSourcesRef.current) {
          safeRemoveLayer(map, fillLayerId(cfgId));
          safeRemoveLayer(map, lineLayerId(cfgId));
          safeRemoveLayer(map, circleLayerId(cfgId));
          safeRemoveSource(map, sourceId(cfgId));
        }
        safeRemoveLayer(map, AREA_BOUNDARY_LINE);
        safeRemoveSource(map, AREA_BOUNDARY_SOURCE);
      }
      // Clean up label markers
      for (const markers of Object.values(labelMarkersRef.current)) {
        for (const m of markers) m.remove();
      }
      popupRef.current?.remove();
      addedSourcesRef.current = new Set();
      labelMarkersRef.current = {};
      beatFeaturesCacheRef.current = null;
      areaBoundaryAddedRef.current = false;
    };
  }, []);

  return {
    layerStates,
    toggleGeoLayer,
    ensureLayerLoaded,
    configs: GEO_LAYER_CONFIGS,
  };
}

// ── Utility ──────────────────────────────────────────────────

function escapeForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
