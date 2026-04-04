// ============================================================
// RMPG Flex — GeoJSON Layer Manager Hook
// ============================================================
// Loads split GeoJSON layer files from /geojson/ and renders
// them as Google Maps Data layers. Supports lazy loading,
// per-layer toggle, click info windows, style theming,
// and interactive selection mode for shift planning.
// ============================================================

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

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
    style: { fillColor: '#3b82f6', fillOpacity: 0.06, strokeColor: '#3b82f6', strokeOpacity: 0.4, strokeWeight: 1.5 },
    labelProp: 'NAME',
    featureKeyProp: 'NAME',
    detailProps: ['POP_CURRESTIMATE', 'STATEPLANE'],
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
    style: { fillColor: '#22c55e', fillOpacity: 0.08, strokeColor: '#22c55e', strokeOpacity: 0.45, strokeWeight: 1 },
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
    style: { fillColor: '#06b6d4', fillOpacity: 0.7, strokeColor: '#06b6d4', strokeOpacity: 0.9, strokeWeight: 1, iconScale: 4 },
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

// ── Section color palette (12 distinct hues for beat sections) ──

export const SECTION_COLORS: Record<string, string> = {
  SL1: '#22c55e', SL2: '#3b82f6', SL3: '#a855f7', SL4: '#f59e0b', SL5: '#ef4444', SL6: '#06b6d4',
  DV1: '#ec4899', DV2: '#14b8a6', DV3: '#f97316',
  WB1: '#8b5cf6', WB2: '#10b981',
  UC1: '#6366f1', UC2: '#eab308', UC3: '#f43f5e',
};
const SECTION_COLOR_FALLBACKS = ['#64748b', '#78716c', '#a3a3a3', '#71717a', '#737373', '#6b7280'];

export function getSectionColor(sectionId: string): string {
  if (SECTION_COLORS[sectionId]) return SECTION_COLORS[sectionId];
  let hash = 0;
  for (let i = 0; i < sectionId.length; i++) hash = ((hash << 5) - hash + sectionId.charCodeAt(i)) | 0;
  return SECTION_COLOR_FALLBACKS[Math.abs(hash) % SECTION_COLOR_FALLBACKS.length];
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

/** Unit presence info for a beat */
export interface BeatUnitInfo {
  call_sign: string;
  status: string;
}

interface UseGeoJsonLayersOptions {
  map: google.maps.Map | null;
  infoWindow: google.maps.InfoWindow | null;
  /** When true, clicking a selectable feature calls onFeatureClick instead of showing info */
  selectionMode?: boolean;
  /** Called when a feature is clicked in selection mode */
  onFeatureClick?: (info: GeoFeatureInfo) => void;
  /** Set of "layerId::featureKey" strings currently selected */
  selectedFeatures?: Set<string>;
  /** Set of "layerId::featureKey" strings that have been assigned */
  assignedFeatures?: Set<string>;
  /** Beat-district enrichment: Map<city_code, Map<district_letter, BeatDistrictEntry>> */
  beatDistrictMap?: Map<string, Map<string, BeatDistrictEntry>>;
  /** Units currently in each beat, keyed by beat_code */
  unitsPerBeat?: Map<string, BeatUnitInfo[]>;
  /** Active call count per beat, keyed by beat_code (zone_beat) */
  callsPerBeat?: Map<string, number>;
  /** Heat map data: call density per beat (zone_beat → count) from /api/dispatch/districts/call-density */
  heatMapData?: Map<string, number>;
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

// ── Default info window HTML builder ─────────────────────────

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

export function useGeoJsonLayers({
  map,
  infoWindow,
  selectionMode = false,
  onFeatureClick,
  selectedFeatures,
  assignedFeatures,
  beatDistrictMap,
  unitsPerBeat,
  callsPerBeat,
  heatMapData,
}: UseGeoJsonLayersOptions) {
  // Per-layer visibility state
  const [layerStates, setLayerStates] = useState<Record<string, GeoLayerState>>(() => {
    const initial: Record<string, GeoLayerState> = {};
    for (const cfg of GEO_LAYER_CONFIGS) {
      initial[cfg.id] = { visible: cfg.visible, loaded: false, featureCount: 0 };
    }
    return initial;
  });

  // Google Maps Data layer instances (one per GeoJSON layer)
  const dataLayersRef = useRef<Record<string, google.maps.Data>>({});
  // Cache loaded GeoJSON objects so we don't re-fetch
  const geojsonCacheRef = useRef<Record<string, object>>({});
  // Track listeners for cleanup
  const listenersRef = useRef<google.maps.MapsEventListener[]>([]);
  // Beat label markers for centroid labels
  const beatLabelsRef = useRef<google.maps.Marker[]>([]);

  // Refs for latest callback/selection state (avoids re-creating data layers)
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

  // Unit/call overlay refs
  const unitsPerBeatRef = useRef(unitsPerBeat);
  useEffect(() => { unitsPerBeatRef.current = unitsPerBeat; }, [unitsPerBeat]);
  const callsPerBeatRef = useRef(callsPerBeat);
  useEffect(() => { callsPerBeatRef.current = callsPerBeat; }, [callsPerBeat]);

  // Heat map density ref
  const heatMapDataRef = useRef(heatMapData);
  useEffect(() => { heatMapDataRef.current = heatMapData; }, [heatMapData]);

  // Beat centroids — computed once when beat layer loads, exposed for unit-beat matching
  const [beatCentroids, setBeatCentroids] = useState<Map<string, { lat: number; lng: number }>>(new Map());

  // Pre-compute flat beat style lookup: "city_code::district_letter" → BeatStyleEntry
  // This avoids per-feature Map traversal + object spread in the hot-path setStyle callback
  const beatStyleLookup = useMemo(() => {
    if (!beatDistrictMap) return undefined;
    const beatCfg = GEO_LAYER_CONFIGS.find(c => c.id === 'beat');
    if (!beatCfg) return undefined;
    const lookup = new Map<string, BeatStyleEntry>();
    for (const [cityCode, zoneMap] of beatDistrictMap) {
      for (const [distLetter, entry] of zoneMap) {
        const sColor = getSectionColor(entry.sectionId);
        lookup.set(`${cityCode}::${distLetter}`, {
          style: { ...beatCfg.style, fillColor: sColor, strokeColor: sColor, fillOpacity: 0.12, strokeOpacity: 0.6 },
          entry,
        });
      }
    }
    return lookup;
  }, [beatDistrictMap]);

  const beatStyleLookupRef = useRef(beatStyleLookup);
  useEffect(() => { beatStyleLookupRef.current = beatStyleLookup; }, [beatStyleLookup]);

  // ── Build feature key from a Data.Feature ──────────────────

  const getFeatureKey = useCallback((feature: google.maps.Data.Feature, cfg: GeoLayerConfig): string => {
    const val = feature.getProperty(cfg.featureKeyProp);
    return val != null ? String(val) : '';
  }, []);

  const makeCompositeKey = (layerId: string, featureKey: string) => `${layerId}::${featureKey}`;

  // ── Restyle data layers when selection changes ─────────────

  const restyleLayers = useCallback(() => {
    for (const cfg of GEO_LAYER_CONFIGS) {
      const dl = dataLayersRef.current[cfg.id];
      if (!dl) continue;

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

        // For beat layer: use pre-computed section-based style (O(1) lookup, no object spread)
        let baseStyle = cfg.style;
        if (cfg.id === 'beat' && !isSelected && !isAssigned) {
          const beatCode = feature.getProperty('beat_code') as string;

          // Heat map density coloring — overrides section colors when active
          if (heatMapDataRef.current && heatMapDataRef.current.size > 0) {
            const count = beatCode ? (heatMapDataRef.current.get(beatCode) ?? 0) : 0;
            if (count === 0) {
              // Beats with no calls: very dim gray
              baseStyle = { ...cfg.style, fillColor: '#444444', fillOpacity: 0.02, strokeColor: '#444444', strokeOpacity: 0.15, strokeWeight: 0.5 };
            } else {
              // Find max count across all beats for normalization
              let maxCount = 1;
              for (const c of heatMapDataRef.current.values()) {
                if (c > maxCount) maxCount = c;
              }
              const ratio = count / maxCount;
              // Interpolate: blue (0) → yellow (0.5) → red (1.0)
              let r: number, g: number, b: number;
              if (ratio <= 0.5) {
                const t = ratio / 0.5;
                r = Math.round(30 + (240 - 30) * t);
                g = Math.round(100 + (200 - 100) * t);
                b = Math.round(200 + (0 - 200) * t);
              } else {
                const t = (ratio - 0.5) / 0.5;
                r = Math.round(240 + (220 - 240) * t);
                g = Math.round(200 + (40 - 200) * t);
                b = Math.round(0 + (40 - 0) * t);
              }
              const heatColor = `rgb(${r},${g},${b})`;
              // Fill opacity scales with density: low = 0.10, high = 0.25
              const fillOp = 0.10 + ratio * 0.15;
              baseStyle = { ...cfg.style, fillColor: heatColor, fillOpacity: fillOp, strokeColor: heatColor, strokeOpacity: 0.6, strokeWeight: 1 };
            }
          } else if (beatStyleLookupRef.current) {
            // Normal section-based coloring
            const cityCode = feature.getProperty('city_code') as string;
            const distLetter = feature.getProperty('district_letter') as string;
            if (cityCode && distLetter) {
              const cached = beatStyleLookupRef.current.get(`${cityCode}::${distLetter}`);
              if (cached) baseStyle = cached.style;
            }
            // Coverage dimming: reduce opacity for beats with no units
            if (beatCode && unitsPerBeatRef.current) {
              const beatUnits = unitsPerBeatRef.current.get(beatCode);
              if (!beatUnits || beatUnits.length === 0) {
                baseStyle = { ...baseStyle, fillOpacity: 0.04, strokeOpacity: 0.25 };
              }
            }
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
  }, [getFeatureKey]);

  // Re-style when selection/assigned sets change
  // Note: beatDistrictMap is static after initial load — restyleLayers reads it via ref
  useEffect(() => {
    restyleLayers();
  }, [selectedFeatures, assignedFeatures, selectionMode, restyleLayers]);

  // Re-style once when beat district data arrives (static, fires only once)
  useEffect(() => {
    if (beatStyleLookup) restyleLayers();
  }, [beatStyleLookup, restyleLayers]);

  // Re-style when unit coverage changes (for coverage dimming)
  useEffect(() => {
    if (unitsPerBeat) restyleLayers();
  }, [unitsPerBeat, restyleLayers]);

  // Re-style when heat map density data changes
  useEffect(() => {
    restyleLayers();
  }, [heatMapData, restyleLayers]);

  // ── Beat label overlay helpers ─────────────────────────────

  /** Remove all beat label markers from the map */
  const clearBeatLabels = useCallback(() => {
    for (const m of beatLabelsRef.current) m.setMap(null);
    beatLabelsRef.current = [];
  }, []);

  /** Create beat label markers at polygon centroids for the loaded beat layer */
  const createBeatLabels = useCallback(() => {
    clearBeatLabels();
    if (!map) return;
    const dl = dataLayersRef.current['beat'];
    if (!dl) return;

    const zoom = map.getZoom() ?? 12;
    dl.forEach((feature) => {
      const geom = feature.getGeometry();
      if (!geom) return;
      // Compute centroid from outer ring of the first polygon
      let coords: google.maps.LatLng[] = [];
      const gType = geom.getType();
      if (gType === 'Polygon') {
        const poly = geom as google.maps.Data.Polygon;
        const ring = poly.getAt(0); // outer ring
        for (let i = 0; i < ring.getLength(); i++) coords.push(ring.getAt(i));
      } else if (gType === 'MultiPolygon') {
        const mp = geom as google.maps.Data.MultiPolygon;
        if (mp.getLength() > 0) {
          const firstPoly = mp.getAt(0);
          const ring = firstPoly.getAt(0);
          for (let i = 0; i < ring.getLength(); i++) coords.push(ring.getAt(i));
        }
      }
      if (coords.length === 0) return;

      let latSum = 0, lngSum = 0;
      for (const c of coords) { latSum += c.lat(); lngSum += c.lng(); }
      const centroid = { lat: latSum / coords.length, lng: lngSum / coords.length };

      const beatCode = feature.getProperty('beat_code') as string | undefined;
      const distLetter = feature.getProperty('district_letter') as string | undefined;
      if (!beatCode && !distLetter) return;

      // Zoom-adaptive label text
      let labelText = '';
      if (zoom >= 13) {
        labelText = beatCode || distLetter || '';
      } else if (zoom >= 11) {
        labelText = distLetter || '';
      }
      // Below 11: no label (marker hidden)

      // Determine label color from section
      let labelColor = '#fff';
      const cityCode = feature.getProperty('city_code') as string | undefined;
      if (cityCode && distLetter && beatStyleLookupRef.current) {
        const cached = beatStyleLookupRef.current.get(`${cityCode}::${distLetter}`);
        if (cached) labelColor = cached.style.strokeColor;
      }

      const marker = new google.maps.Marker({
        position: centroid,
        map: zoom >= 11 ? map : null,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0, fillOpacity: 0 },
        label: labelText ? { text: labelText, color: labelColor, fontSize: '9px', fontWeight: 'bold' } : undefined,
        clickable: false,
        zIndex: 0,
      });
      beatLabelsRef.current.push(marker);
    });
  }, [map, clearBeatLabels]);

  /** Update beat label text & visibility for the current zoom */
  const updateBeatLabelVisibility = useCallback(() => {
    if (!map) return;
    const zoom = map.getZoom() ?? 12;
    const dl = dataLayersRef.current['beat'];
    if (!dl) return;
    const beatVisible = layerStates['beat']?.visible;

    // If beat layer is not visible or zoom too low, hide all labels
    if (!beatVisible || zoom < 11) {
      for (const m of beatLabelsRef.current) m.setMap(null);
      return;
    }

    // Iterate markers in parallel with features to get property data
    // Since markers were created in forEach order, we can re-iterate to match
    let idx = 0;
    dl.forEach((feature) => {
      const marker = beatLabelsRef.current[idx];
      if (!marker) { idx++; return; }

      const beatCode = feature.getProperty('beat_code') as string | undefined;
      const distLetter = feature.getProperty('district_letter') as string | undefined;

      let labelText = '';
      if (zoom >= 13) {
        labelText = beatCode || distLetter || '';
      } else if (zoom >= 11) {
        labelText = distLetter || '';
      }

      let labelColor = '#fff';
      const cityCode = feature.getProperty('city_code') as string | undefined;
      if (cityCode && distLetter && beatStyleLookupRef.current) {
        const cached = beatStyleLookupRef.current.get(`${cityCode}::${distLetter}`);
        if (cached) labelColor = cached.style.strokeColor;
      }

      if (labelText) {
        marker.setLabel({ text: labelText, color: labelColor, fontSize: '9px', fontWeight: 'bold' });
        marker.setMap(map);
      } else {
        marker.setMap(null);
      }
      idx++;
    });
  }, [map, layerStates]);

  // ── Load a single GeoJSON layer onto the map ───────────────

  const loadLayer = useCallback(async (cfg: GeoLayerConfig) => {
    if (!map) return;
    // Already have a Data layer for this id? Just show/style it.
    if (dataLayersRef.current[cfg.id]) {
      dataLayersRef.current[cfg.id].setMap(map);
      return;
    }

    // Fetch the GeoJSON
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

    // Create a Data layer
    const dataLayer = new google.maps.Data({ map });
    dataLayer.addGeoJson(geojson as object);

    // Initial style (will be overridden by restyleLayers)
    dataLayer.setStyle(() => ({ clickable: true }));

    // Click handler — either selection or info window
    const clickListener = dataLayer.addListener('click', (event: google.maps.Data.MouseEvent) => {
      if (!map) return;
      const feat = event.feature;
      const props: Record<string, any> = {};
      feat.forEachProperty((val, key) => { props[key] = val; });

      const fKey = getFeatureKey(feat, cfg);
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

      // Normal mode — show info window
      if (!infoWindow) return;
      let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:140px;">`;

      // Enhanced beat info window with district data
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

        // Units and calls overlay
        const beatCode = props.beat_code as string | undefined;
        if (beatCode) {
          html += `<div style="border-top:1px solid #333;padding-top:6px;margin-top:6px;font-size:10px;">`;
          const beatUnits = unitsPerBeatRef.current?.get(beatCode);
          if (beatUnits && beatUnits.length > 0) {
            const unitList = beatUnits.map(u => `<span style="color:#22c55e;">${escapeForHtml(u.call_sign)}</span> <span style="color:#666;">(${escapeForHtml(u.status)})</span>`).join(', ');
            html += `<div style="color:#bbb;"><b>Units:</b> ${unitList}</div>`;
          } else {
            html += `<div style="color:#666;"><b>Units:</b> None</div>`;
          }
          const callCount = callsPerBeatRef.current?.get(beatCode) ?? 0;
          html += `<div style="color:#bbb;margin-top:2px;"><b>Active Calls:</b> <span style="color:${callCount > 0 ? '#f59e0b' : '#666'};">${callCount}</span></div>`;
          html += `</div>`;
        }
      } else {
        html += buildDefaultInfoHtml(name, cfg, props);
      }

      // Show assigned officer info if available
      const compositeKey = makeCompositeKey(cfg.id, fKey);
      if (assignedFeaturesRef.current?.has(compositeKey)) {
        html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #333;font-size:9px;color:#22c55e;font-weight:bold;">● ASSIGNED</div>`;
      }

      html += `</div>`;
      infoWindow.setContent(html);
      infoWindow.setPosition(event.latLng!);
      infoWindow.open(map);
    });

    listenersRef.current.push(clickListener);
    dataLayersRef.current[cfg.id] = dataLayer;

    // Update feature count
    let count = 0;
    dataLayer.forEach(() => count++);
    setLayerStates((prev) => ({
      ...prev,
      [cfg.id]: { ...prev[cfg.id], loaded: true, featureCount: count },
    }));

    // Apply current styles after load
    restyleLayers();

    // Create beat labels if the beat layer just loaded and is visible
    if (cfg.id === 'beat' && layerStates['beat']?.visible) {
      createBeatLabels();
    }

    // Compute beat centroids when beat layer loads
    if (cfg.id === 'beat') {
      const centroids = new Map<string, { lat: number; lng: number }>();
      dataLayer.forEach((feature) => {
        const beatCode = feature.getProperty('beat_code') as string | undefined;
        if (!beatCode) return;
        const geom = feature.getGeometry();
        if (!geom) return;
        let coords: google.maps.LatLng[] = [];
        const gType = geom.getType();
        if (gType === 'Polygon') {
          const poly = geom as google.maps.Data.Polygon;
          const ring = poly.getAt(0);
          for (let i = 0; i < ring.getLength(); i++) coords.push(ring.getAt(i));
        } else if (gType === 'MultiPolygon') {
          const mp = geom as google.maps.Data.MultiPolygon;
          if (mp.getLength() > 0) {
            const firstPoly = mp.getAt(0);
            const ring = firstPoly.getAt(0);
            for (let i = 0; i < ring.getLength(); i++) coords.push(ring.getAt(i));
          }
        }
        if (coords.length === 0) return;
        let latSum = 0, lngSum = 0;
        for (const c of coords) { latSum += c.lat(); lngSum += c.lng(); }
        centroids.set(beatCode, { lat: latSum / coords.length, lng: lngSum / coords.length });
      });
      setBeatCentroids(centroids);
    }
  }, [map, infoWindow, getFeatureKey, restyleLayers, layerStates, createBeatLabels]);

  // ── Ensure layer is loaded (for shift planning) ────────────

  const ensureLayerLoaded = useCallback(async (layerId: string) => {
    const cfg = GEO_LAYER_CONFIGS.find((c) => c.id === layerId);
    if (!cfg || !map) return;
    const state = layerStates[cfg.id];
    if (state?.loaded) return;
    await loadLayer(cfg);
    // Also mark as visible
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

      // Show/hide the Data layer
      const dl = dataLayersRef.current[layerId];
      if (dl) {
        dl.setMap(nowVisible ? map : null);
      }

      // Manage beat labels when toggling beat layer
      if (layerId === 'beat') {
        if (nowVisible && dataLayersRef.current['beat']) {
          // Defer to after state update so layerStates reflects new visibility
          setTimeout(() => createBeatLabels(), 0);
        } else {
          clearBeatLabels();
        }
      }

      return { ...prev, [layerId]: { ...curr, visible: nowVisible } };
    });
  }, [map, createBeatLabels, clearBeatLabels]);

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

    const zoomListener = map.addListener('zoom_changed', () => {
      const zoom = map.getZoom() ?? 12;
      for (const cfg of GEO_LAYER_CONFIGS) {
        const state = layerStates[cfg.id];
        const dl = dataLayersRef.current[cfg.id];
        if (!dl || !state?.visible) continue;

        if (cfg.minZoom && zoom < cfg.minZoom) {
          dl.setMap(null);
        } else {
          dl.setMap(map);
        }
      }
      // Update beat label text/visibility based on new zoom
      updateBeatLabelVisibility();
    });

    return () => {
      google.maps.event.removeListener(zoomListener);
    };
  }, [map, layerStates, updateBeatLabelVisibility]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      for (const listener of listenersRef.current) {
        google.maps.event.removeListener(listener);
      }
      for (const dl of Object.values(dataLayersRef.current)) {
        dl.setMap(null);
      }
      // Clean up beat labels
      for (const m of beatLabelsRef.current) m.setMap(null);
      beatLabelsRef.current = [];
      dataLayersRef.current = {};
      listenersRef.current = [];
    };
  }, []);

  return {
    layerStates,
    toggleGeoLayer,
    ensureLayerLoaded,
    configs: GEO_LAYER_CONFIGS,
    /** Beat centroids keyed by beat_code — available after beat layer loads */
    beatCentroids,
  };
}

// ── Utility ──────────────────────────────────────────────────

function escapeForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
