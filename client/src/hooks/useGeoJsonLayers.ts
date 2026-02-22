// ============================================================
// RMPG Flex — GeoJSON Layer Manager Hook
// ============================================================
// Loads split GeoJSON layer files from /geojson/ and renders
// them as Google Maps Data layers. Supports lazy loading,
// per-layer toggle, click info windows, style theming,
// and interactive selection mode for shift planning.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';

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
}

export interface GeoLayerState {
  visible: boolean;
  loaded: boolean;
  featureCount: number;
}

export function useGeoJsonLayers({
  map,
  infoWindow,
  selectionMode = false,
  onFeatureClick,
  selectedFeatures,
  assignedFeatures,
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

  // Refs for latest callback/selection state (avoids re-creating data layers)
  const selectionModeRef = useRef(selectionMode);
  const onFeatureClickRef = useRef(onFeatureClick);
  const selectedFeaturesRef = useRef(selectedFeatures);
  const assignedFeaturesRef = useRef(assignedFeatures);

  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);
  useEffect(() => { onFeatureClickRef.current = onFeatureClick; }, [onFeatureClick]);
  useEffect(() => { selectedFeaturesRef.current = selectedFeatures; }, [selectedFeatures]);
  useEffect(() => { assignedFeaturesRef.current = assignedFeatures; }, [assignedFeatures]);

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

        const activeStyle = isSelected ? SELECTION_STYLE : isAssigned ? ASSIGNED_STYLE : cfg.style;

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
  useEffect(() => {
    restyleLayers();
  }, [selectedFeatures, assignedFeatures, selectionMode, restyleLayers]);

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
      html += `<div style="font-weight:bold;font-size:12px;color:#fff;margin-bottom:4px;border-bottom:1px solid #444;padding-bottom:3px;">${escapeForHtml(String(name))}</div>`;
      html += `<div style="color:#888;font-size:9px;text-transform:uppercase;margin-bottom:4px;">${cfg.label}</div>`;

      if (cfg.detailProps) {
        for (const p of cfg.detailProps) {
          if (props[p] !== undefined && props[p] !== null && props[p] !== '') {
            const label = p.replace(/_/g, ' ').replace(/^(POP_CURRESTIMATE|POPLASTESTIMATE)$/i, 'Population');
            html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">${escapeForHtml(label)}:</span> ${escapeForHtml(String(props[p]))}</div>`;
          }
        }
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

        if (cfg.minZoom && zoom < cfg.minZoom) {
          dl.setMap(null);
        } else {
          dl.setMap(map);
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
      dataLayersRef.current = {};
      listenersRef.current = [];
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
