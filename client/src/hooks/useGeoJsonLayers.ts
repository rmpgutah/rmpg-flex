// ============================================================
// RMPG Flex — GeoJSON Layer Manager Hook (Mapbox GL JS)
// ============================================================
// Loads split GeoJSON layer files from /geojson/ and renders
// them as Mapbox GL JS source + layer pairs. Supports lazy
// loading, per-layer toggle, click popups, style theming,
// and interactive selection mode for shift planning.
// ============================================================

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { dissolveBeatsByArea } from '../utils/dissolveAreas';

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
    // Off by default so the map opens clean (plain black Spillman base
    // + only the operational overlays the dispatcher has explicitly
    // enabled). Users opt-in via the layers panel; visibility is
    // session-only — not persisted yet.
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
    // Off by default (see county note). Most operational views want a
    // clean base; dispatchers who need beat polygons toggle them on.
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
  /** Hierarchy color lookups for tier-aware beat polygon styling (Section fill + Zone border). When null, falls back to existing single-color path. */
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
  hierarchyColors,
}: UseGeoJsonLayersOptions) {
  const [layerStates, setLayerStates] = useState<Record<string, GeoLayerState>>(() => {
    const initial: Record<string, GeoLayerState> = {};
    for (const cfg of GEO_LAYER_CONFIGS) {
      initial[cfg.id] = { visible: cfg.visible, loaded: false, featureCount: 0 };
    }
    return initial;
  });

  const geojsonCacheRef = useRef<Record<string, object>>({});
  // Track listeners for cleanup
  const listenersRef = useRef<google.maps.MapsEventListener[]>([]);
  // Label markers for beat/zone text overlays
  const labelMarkersRef = useRef<Record<string, google.maps.Marker[]>>({});
  // Area-boundary overlay (Task 7): dissolved 3px lines drawn above beats
  const areaBoundaryLayerRef = useRef<google.maps.Data | null>(null);
  // Cached beat features extracted from the data layer — populated on first
  // beat-layer load so the late-arrival rebuild effect (below) doesn't have
  // to re-walk the data layer when hierarchyColors resolves after beats.
  const beatFeaturesCacheRef = useRef<import('geojson').Feature<import('geojson').Polygon>[] | null>(null);

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

  // Hierarchy color lookup ref (Task 6) — when set, beat polygons render
  // Section fill (30% opacity) + Zone border (1.5px). When null, the existing
  // single-color path below remains the default.
  const hierarchyColorsRef = useRef<typeof hierarchyColors>(null);
  useEffect(() => { hierarchyColorsRef.current = hierarchyColors ?? null; }, [hierarchyColors]);

  // Rebuild area-boundary overlay when hierarchyColors arrives after the
  // beat layer has already loaded (race between /dispatch/districts and
  // the beat geojson fetch). Idempotent: tears down any stale overlay
  // before rebuild, bails if no cached beat features.
  useEffect(() => {
    if (!hierarchyColors || !beatFeaturesCacheRef.current || !map) return;
    if (areaBoundaryLayerRef.current) {
      areaBoundaryLayerRef.current.setMap(null);
      areaBoundaryLayerRef.current = null;
    }
    const lines = dissolveBeatsByArea(beatFeaturesCacheRef.current, hierarchyColors.beatToArea);
    if (lines.length === 0) return;
    const overlay = new google.maps.Data({ map });
    overlay.addGeoJson({ type: 'FeatureCollection', features: lines });
    overlay.setStyle((feat) => {
      const areaId = feat.getProperty('area_id') as string | number;
      return {
        strokeColor: hierarchyColors.areaColors.get(areaId) ?? '#fff',
        strokeWeight: 3,
        strokeOpacity: 0.85,
        fillOpacity: 0,
        clickable: false,
        zIndex: 5,
      };
    });
    areaBoundaryLayerRef.current = overlay;
  }, [hierarchyColors, map]);

  // Pre-compute flat beat style lookup: "city_code::district_letter" → BeatStyleEntry
  // This avoids per-feature Map traversal + object spread in the hot-path setStyle callback
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

      dl.setStyle((feature) => {
        if (!feature) return {};
        const geomType = feature.getGeometry()?.getType();
        const isPoint = geomType === 'Point';
        const isLine = geomType === 'LineString' || geomType === 'MultiLineString';

        // Determine if this feature is selected or assigned
        const fKey = getFeatureKey(feature, cfg);
        const compositeKey = makeCompositeKey(cfg.id, fKey);
        const isSelected = selectionModeRef.current && selectedFeaturesRef.current?.has(compositeKey);
        const isAssigned = assignedFeaturesRef.current?.has(compositeKey);

        if (isPoint) {
          const activeStyle = isSelected ? SELECTION_STYLE : isAssigned ? ASSIGNED_STYLE : cfg.style;
          return {
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: (isSelected || isAssigned) ? (cfg.style.iconScale ?? 4) + 3 : cfg.style.iconScale ?? 4,
              fillColor: activeStyle.fillColor,
              fillOpacity: activeStyle.fillOpacity,
              strokeColor: activeStyle.strokeColor,
              strokeOpacity: activeStyle.strokeOpacity,
              strokeWeight: activeStyle.strokeWeight,
            },
          };
        }

        // Tier-aware beat styling (Task 6): when hierarchyColors is provided,
        // encode Section via fill color (30% opacity) and Zone via stroke color
        // (1.5px). Falls through to the existing single-color path when null
        // or when the beat can't be resolved to section/zone.
        if (cfg.id === 'beat' && !isSelected && !isAssigned && hierarchyColorsRef.current) {
          const hc = hierarchyColorsRef.current;
          const cityCode = feature.getProperty('city_code') as string | undefined;
          const distLetter = feature.getProperty('district_letter') as string | undefined;
          const entry = lookupBeatDistrict(beatDistrictMapRef.current, cityCode, distLetter);
          const sectorCode = entry?.sectionId;
          const zoneCode = entry?.zoneId;
          const fillColor = sectorCode ? (hc.sectionColors.get(sectorCode) ?? '#3a3a3a') : '#3a3a3a';
          const strokeColor = zoneCode ? (hc.zoneColors.get(zoneCode) ?? '#666') : '#666';
          return {
            fillColor,
            fillOpacity: 0.30,
            strokeColor,
            strokeWeight: 1.5,
            strokeOpacity: 0.85,
            clickable: true,
            cursor: (selectionModeRef.current && cfg.selectable) ? 'pointer' : undefined,
          };
        }

        // For beat layer: use pre-computed section-based style (O(1) lookup, no object spread)
        let baseStyle = cfg.style;
        if (cfg.id === 'beat' && !isSelected && !isAssigned) {
          const cityCode = feature.getProperty('city_code') as string;
          const distLetter = feature.getProperty('district_letter') as string;
          if (cityCode && distLetter && beatStyleLookupRef.current) {
            const cached = beatStyleLookupRef.current.get(`${cityCode}::${distLetter}`);
            if (cached) baseStyle = cached.style;
          }
          // Fallback: color by city_code even without district map data
          if (baseStyle === cfg.style && cityCode) {
            const cc = getCityColor(cityCode);
            baseStyle = { ...cfg.style, fillColor: cc, strokeColor: cc, fillOpacity: 0.12, strokeOpacity: 0.5, strokeWeight: 1 };
          }
        }

        // For municipality layer: use hash-based per-municipality color
        if (cfg.id === 'municipality' && !isSelected && !isAssigned) {
          const name = feature.getProperty('NAME') as string;
          if (name) {
            const mc = getMuniColor(name);
            baseStyle = { ...cfg.style, fillColor: mc, strokeColor: mc, fillOpacity: 0.10, strokeOpacity: 0.5 };
          }
        }

        const activeStyle = isSelected ? SELECTION_STYLE : isAssigned ? ASSIGNED_STYLE : baseStyle;

        return {
          fillColor: isLine ? 'transparent' : activeStyle.fillColor,
          fillOpacity: isLine ? 0 : activeStyle.fillOpacity,
          strokeColor: activeStyle.strokeColor,
          strokeOpacity: activeStyle.strokeOpacity,
          strokeWeight: activeStyle.strokeWeight,
          clickable: true,
          cursor: (selectionModeRef.current && cfg.selectable) ? 'pointer' : undefined,
        };
      });
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
      // Safe check: If layers were somehow removed but source remained, or vice versa, handle it
      if (!map.getLayer(getFillLayerId(cfg.id)) && !map.getLayer(getLineLayerId(cfg.id))) {
        // Let it fall through or clean up the source first to re-add safely
        try { map.removeSource(sourceId); } catch { /* ignore */ }
      } else {
        // Already fully loaded — just set visibility
        setLayerStates(prev => ({ ...prev, [cfg.id]: { ...prev[cfg.id], visible: true } }));
        return;
      }
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
      } else if (cfg.id === 'beat') {
        // Beat polygon outside the canonical dispatch_beats set
        // (typically an unincorporated county area). Render a clean
        // chart-style label instead of leaking raw GeoJSON properties.
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
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });

    setLayerStates((prev) => ({
      ...prev,
      [cfg.id]: { ...prev[cfg.id], loaded: true, featureCount: 0 },
    }));

    // ── Beat label overlays — show dispatch codes at polygon centroids ──
    if (cfg.id === 'beat') {
      dataLayer.forEach((feature) => {
        const cityCode = feature.getProperty('city_code') as string;
        const distLetter = feature.getProperty('district_letter') as string;
        const beatCode = feature.getProperty('beat_code') as string;
        if (!cityCode) return;

        // Try district map lookup, fall back to GeoJSON properties
        const entry = beatDistrictMapRef.current
          ? lookupBeatDistrict(beatDistrictMapRef.current, cityCode, distLetter)
          : null;
        // Chart format: "{Section}-{Zone}/{Beat}" (e.g. "SL-SLC/A").
        // entry.dispatchCode is now synthesized in chart format upstream;
        // when the district map misses we fall back to bare GeoJSON props.
        const labelText = entry
          ? (entry.dispatchCode || `${entry.zoneId}/${entry.beatId}`)
          : (distLetter ? `${cityCode}/${distLetter}` : beatCode || cityCode);

        // Calculate polygon centroid
        const geom = feature.getGeometry();
        if (!geom) return;
        let latSum = 0, lngSum = 0, pointCount = 0;
        geom.forEachLatLng((latLng) => {
          latSum += latLng.lat();
          lngSum += latLng.lng();
          pointCount++;
        });
        if (pointCount === 0) return;
        const centroid = new google.maps.LatLng(latSum / pointCount, lngSum / pointCount);

        const labelColor = getCityColor(cityCode);
        const marker = new google.maps.Marker({
          position: centroid,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 0,
          },
          label: {
            text: labelText,
            color: labelColor,
            fontSize: '9px',
            fontWeight: 'bold',
            fontFamily: 'JetBrains Mono, Courier New, monospace',
          },
          clickable: false,
          zIndex: 1,
        });
        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      });

      // ── Area-boundary overlay (Task 7) ──
      // Cache beat features once on first beat-layer load — used by both
      // the initial overlay build below AND the late-arrival rebuild effect
      // when hierarchyColors resolves after the beat layer has already
      // loaded. Populated regardless of hierarchyColors so the rebuild
      // effect has data to work with.
      if (!beatFeaturesCacheRef.current) {
        const beatFeatures: import('geojson').Feature<import('geojson').Polygon>[] = [];
        dataLayer.forEach((f) => {
          const geom = f.getGeometry();
          if (!geom || geom.getType() !== 'Polygon') return;
          const coords: number[][][] = [];
          (geom as any).getArray().forEach((linear: google.maps.Data.LinearRing) => {
            coords.push(linear.getArray().map((ll) => [ll.lng(), ll.lat()]));
          });
          beatFeatures.push({
            type: 'Feature',
            properties: { beat_code: f.getProperty('beat_code') },
            geometry: { type: 'Polygon', coordinates: coords },
          });
        });
        beatFeaturesCacheRef.current = beatFeatures;
      }

      // Dissolve beat polygons by area_id and draw a 3px line above all
      // beats. Idempotent on areaBoundaryLayerRef — runs once per layer
      // load when hierarchyColors is provided.
      if (hierarchyColorsRef.current && !areaBoundaryLayerRef.current && beatFeaturesCacheRef.current) {
        const lines = dissolveBeatsByArea(beatFeaturesCacheRef.current, hierarchyColorsRef.current.beatToArea);
        if (lines.length > 0) {
          const overlay = new google.maps.Data({ map });
          overlay.addGeoJson({ type: 'FeatureCollection', features: lines });
          overlay.setStyle((feat) => {
            const areaId = feat.getProperty('area_id') as string | number;
            return {
              strokeColor: hierarchyColorsRef.current!.areaColors.get(areaId) ?? '#fff',
              strokeWeight: 3,
              strokeOpacity: 0.85,
              fillOpacity: 0,
              clickable: false,
              zIndex: 5,
            };
          });
          areaBoundaryLayerRef.current = overlay;
        }
      }
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
      for (const dl of Object.values(dataLayersRef.current)) {
        dl.setMap(null);
      }
      // Clean up label markers
      for (const markers of Object.values(labelMarkersRef.current)) {
        for (const m of markers) m.setMap(null);
      }
      dataLayersRef.current = {};
      listenersRef.current = [];
      labelMarkersRef.current = {};
      areaBoundaryLayerRef.current?.setMap(null);
      areaBoundaryLayerRef.current = null;
      beatFeaturesCacheRef.current = null;
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
