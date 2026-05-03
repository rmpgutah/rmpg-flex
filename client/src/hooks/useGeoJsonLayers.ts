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
// No blues (#3b82f6, #06b6d4, #6366f1, #0ea5e9 removed) per Spillman pure-black
// theme — replaced with gold/amber/orange/magenta variants.
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
  // Label markers for beat/zone text overlays
  const labelMarkersRef = useRef<Record<string, google.maps.Marker[]>>({});

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
    }

    // ── County label overlays — show county names at polygon centroids ──
    if (cfg.id === 'county') {
      dataLayer.forEach((feature) => {
        const name = feature.getProperty('NAME') as string;
        if (!name) return;
        const geom = feature.getGeometry();
        if (!geom) return;
        let latSum = 0, lngSum = 0, pointCount = 0;
        geom.forEachLatLng((latLng) => { latSum += latLng.lat(); lngSum += latLng.lng(); pointCount++; });
        if (pointCount === 0) return;
        const centroid = new google.maps.LatLng(latSum / pointCount, lngSum / pointCount);
        const marker = new google.maps.Marker({
          position: centroid,
          map,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
          label: {
            text: name.toUpperCase() + ' CO.',
            color: '#88888880',
            fontSize: '10px',
            fontWeight: 'bold',
            fontFamily: 'JetBrains Mono, Courier New, monospace',
          },
          clickable: false,
          zIndex: 0,
        });
        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      });
    }

    // ── Municipality label overlays — show municipality names at polygon centroids ──
    if (cfg.id === 'municipality') {
      dataLayer.forEach((feature) => {
        const name = feature.getProperty('NAME') as string;
        if (!name) return;
        const geom = feature.getGeometry();
        if (!geom) return;
        let latSum = 0, lngSum = 0, pointCount = 0;
        geom.forEachLatLng((latLng) => { latSum += latLng.lat(); lngSum += latLng.lng(); pointCount++; });
        if (pointCount === 0) return;
        const centroid = new google.maps.LatLng(latSum / pointCount, lngSum / pointCount);
        const mc = getMuniColor(name);
        const marker = new google.maps.Marker({
          position: centroid,
          map,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
          label: { text: name.toUpperCase(), color: mc, fontSize: '8px', fontWeight: 'bold', fontFamily: 'JetBrains Mono, Courier New, monospace' },
          clickable: false,
          zIndex: 0,
        });
        if (!labelMarkersRef.current[cfg.id]) labelMarkersRef.current[cfg.id] = [];
        labelMarkersRef.current[cfg.id].push(marker);
      });
    }

    // Apply current styles after load
    restyleLayers();
  }, [map, infoWindow, getFeatureKey, restyleLayers]);

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

      // Show/hide label markers for this layer
      const labels = labelMarkersRef.current[layerId];
      if (labels) {
        for (const m of labels) m.setMap(nowVisible ? map : null);
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

    const zoomListener = map.addListener('zoom_changed', () => {
      const zoom = map.getZoom() ?? 12;
      for (const cfg of GEO_LAYER_CONFIGS) {
        const state = layerStates[cfg.id];
        const dl = dataLayersRef.current[cfg.id];
        if (!dl || !state?.visible) continue;

        const visible = !cfg.minZoom || zoom >= cfg.minZoom;
        dl.setMap(visible ? map : null);

        // Also toggle label markers visibility with zoom
        const labels = labelMarkersRef.current[cfg.id];
        if (labels) {
          // Show labels at zoom 10+ (same as beat layer minZoom)
          const showLabels = visible && zoom >= 10;
          for (const m of labels) m.setMap(showLabels ? map : null);
        }
      }
    });

    return () => {
      google.maps.event.removeListener(zoomListener);
    };
  }, [map, layerStates]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      for (const listener of listenersRef.current) {
        google.maps.event.removeListener(listener);
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
