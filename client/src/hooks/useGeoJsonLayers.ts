// ============================================================
// RMPG Flex — GeoJSON Layer Manager Hook (Mapbox GL JS)
// ============================================================
// Loads split GeoJSON layer files from /geojson/ and renders
// them as Mapbox GL JS source + layer pairs. Supports lazy
// loading, per-layer toggle, click popups, style theming,
// and interactive selection mode for shift planning.
// ============================================================

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import { mapboxgl } from '../utils/mapboxLoader';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { hasLayer, hasSource, safeMapboxColor, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { getSectorColor, getZoneColor, getBeatColor, formatBeatLabel } from '../utils/geographyLabels';
import { toDisplayLabel } from '../utils/formatters';

// Tactical-dark fallback when a config color won't parse as a Mapbox color
// (most commonly a leaked `var(--…)` string). Keeps the layer rendered while
// the upstream value is repaired. Matches AdminMapSettingsTab default.
const COLOR_FALLBACK_FILL = '#0d1722';
const COLOR_FALLBACK_STROKE = '#444444';

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
    // fillColor: steel-blue tactical-dark surface. NEVER use a CSS var string
    // here — mapbox.addLayer's style-spec validator rejects var(...) and the
    // whole layer fails to render. Tactical map stays dark always.
    style: { fillColor: '#0d1722', fillOpacity: 0.15, strokeColor: '#444444', strokeOpacity: 0.5, strokeWeight: 1.5 },
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
    // No minZoom — Beat is part of the A/S/Z/B coverage system and must stay
    // visible at every zoom once selected (no pop in/out while zooming).
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
  '#22c55e', '#3b82f6', '#ef4444', '#f59e0b', '#a855f7', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#10b981', '#facc15', '#e11d48',
  '#84cc16', '#fb923c', '#d946ef', '#fde047', '#eab308', '#fbbf24',
];

function getMuniColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return MUNI_COLORS[Math.abs(hash) % MUNI_COLORS.length];
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
        const label = toDisplayLabel(p).toUpperCase().replace(/^(POP_CURRESTIMATE|POPLASTESTIMATE)$/i, 'Population');
        html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">${escapeForHtml(label)}:</span> ${escapeForHtml(String(props[p]))}</div>`;
      }
    }
  }
  return html;
}

function getLayerSourceId(layerId: string): string { return `geojson-${layerId}`; }
function getFillLayerId(layerId: string): string { return `geojson-${layerId}-fill`; }
function getLineLayerId(layerId: string): string { return `geojson-${layerId}-line`; }
const BEAT_LABEL_LAYER = 'geojson-beat-label';

// Build a Mapbox `match` expression that assigns a distinct color to every
// individual beat, keyed on the `beat_code` feature property. Colors are
// deterministic (same beat_code → same color across reloads) and come from
// the 32-color BEAT_COLOR_PALETTE via getBeatColor(). Falls back to the
// static fallback string when no GeoJSON features are available.
function buildPerBeatColorExpression(
  geojson: object | undefined,
  fallback: string,
): string | unknown[] {
  if (!geojson) return fallback;
  const features: any[] = (geojson as any).features;
  if (!Array.isArray(features) || features.length === 0) return fallback;
  const expr: unknown[] = ['match', ['to-string', ['get', 'beat_code']]];
  const seen = new Set<string>();
  for (const f of features) {
    const bc = f?.properties?.beat_code;
    if (!bc || seen.has(String(bc))) continue;
    seen.add(String(bc));
    expr.push(String(bc), getBeatColor(String(bc)));
  }
  if (seen.size === 0) return fallback;
  expr.push(fallback);
  return expr;
}

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
  // Concurrency guard: prevents two parallel loadLayer() calls for the same
  // layer from both passing the getSource() check and racing to addSource().
  // The async fetch on /geojson/<file>.json creates a window where multiple
  // effects (auto-load + ensureLayerLoaded) can interleave and double-add.
  const inFlightLayersRef = useRef<Set<string>>(new Set());
  // Track which layers we've already bound the click handler for. Without
  // this, every successful loadLayer() call stacks another listener on the
  // same fill layer, so a remount produces N popups per click.
  const clickHandlerRegisteredRef = useRef<Set<string>>(new Set());

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
      const cColor = getZoneColor(cityCode);
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

    if (hasLayer(map, fillId)) {
      map.setPaintProperty(fillId, 'fill-color', fillColor);
      map.setPaintProperty(fillId, 'fill-opacity', fillOpacity);
    }
    if (hasLayer(map, lineId)) {
      map.setPaintProperty(lineId, 'line-color', strokeColor);
      map.setPaintProperty(lineId, 'line-opacity', strokeOpacity);
      map.setPaintProperty(lineId, 'line-width', strokeWeight);
    }
  }, [map]);

  const loadLayer = useCallback(async (cfg: GeoLayerConfig) => {
    if (!map) return;

    // Concurrency guard — bail if another invocation is already mid-load
    // for this layer. Without this, the async fetch creates a window where
    // a second call (from auto-load effect, toggle, or ensureLayerLoaded)
    // can race past the getSource() check and double-add the source.
    if (inFlightLayersRef.current.has(cfg.id)) return;

    const sourceId = getLayerSourceId(cfg.id);
    if (hasSource(map, sourceId)) {
      // Safe check: If layers were somehow removed but source remained, or vice versa, handle it
      if (!hasLayer(map, getFillLayerId(cfg.id)) && !hasLayer(map, getLineLayerId(cfg.id))) {
        // Let it fall through or clean up the source first to re-add safely
        safeRemoveSource(map, sourceId);
      } else {
        // Already fully loaded — just set visibility
        setLayerStates(prev => ({ ...prev, [cfg.id]: { ...prev[cfg.id], visible: true } }));
        return;
      }
    }

    inFlightLayersRef.current.add(cfg.id);
    let geojson = geojsonCacheRef.current[cfg.id];
    if (!geojson) {
      try {
        const resp = await fetch(`/geojson/${cfg.file}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        geojson = (await resp.json()) as FeatureCollection;
        geojsonCacheRef.current[cfg.id] = geojson;
      } catch (err) {
        console.error(`[GeoJSON] Failed to load ${cfg.file}:`, err);
        inFlightLayersRef.current.delete(cfg.id);
        return;
      }
    }

      // Defensive re-check before each side-effect — a sibling caller could
      // have completed between our fetch starting and finishing. Guard on
      // STYLE readiness — addSource/addLayer throw "Style is not done loading"
      // when the basemap style hasn't finished, even if map.loaded() is true.
      whenStyleReady(map, () => {
      if (!hasSource(map, sourceId)) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: geojson as any,
        });
      }

      // For beats specifically, use a data-driven color expression keyed
      // on beat_code so each individual beat renders in its own distinct
      // color (32-color palette, deterministic via getBeatColor). All other
      // layers use the static config color.
      //
      // safeMapboxColor is the boundary guard: a leaked `var(--…)` string
      // or empty value here crashes the whole layer and renders nothing.
      // 'transparent' is fine — only invalid colors fall back.
      const safeFill = safeMapboxColor(cfg.style.fillColor, COLOR_FALLBACK_FILL);
      const safeStroke = safeMapboxColor(cfg.style.strokeColor, COLOR_FALLBACK_STROKE);
      const fillColorExpr = cfg.id === 'beat'
        ? buildPerBeatColorExpression(geojson, safeFill)
        : safeFill;
      const lineColorExpr = cfg.id === 'beat'
        ? buildPerBeatColorExpression(geojson, safeStroke)
        : safeStroke;

      // Add fill layer for polygon features
      if (!hasLayer(map, getFillLayerId(cfg.id))) {
        map.addLayer({
          id: getFillLayerId(cfg.id),
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': fillColorExpr as any,
            'fill-opacity': cfg.style.fillOpacity,
          },
          layout: {
            visibility: cfg.visible ? 'visible' : 'none',
          },
        });
      }

      // Add line layer for stroke. Beats use a slight dash pattern for a
      // cleaner polygon-border look that distinguishes them from solid fills.
      if (!hasLayer(map, getLineLayerId(cfg.id))) {
        const linePaint: Record<string, unknown> = {
          'line-color': lineColorExpr as any,
          'line-opacity': cfg.style.strokeOpacity,
          'line-width': cfg.style.strokeWeight,
        };
        if (cfg.id === 'beat') {
          (linePaint as any)['line-dasharray'] = [4, 2];
        }
        map.addLayer({
          id: getLineLayerId(cfg.id),
          type: 'line',
          source: sourceId,
          paint: linePaint as any,
          layout: {
            visibility: cfg.visible ? 'visible' : 'none',
          },
        });
      }

      // Beat label symbol layer — renders the beat code centered on each
      // polygon. Shown at z9+ to avoid label crowding at city-level zoom.
      if (cfg.id === 'beat' && !hasLayer(map, BEAT_LABEL_LAYER)) {
        map.addLayer({
          id: BEAT_LABEL_LAYER,
          type: 'symbol',
          source: sourceId,
          minzoom: 9,
          layout: {
            'text-field': ['get', 'beat_code'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 12, 12, 14, 14],
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-anchor': 'center',
            'text-max-width': 6,
            'symbol-placement': 'point',
            'visibility': cfg.visible ? 'visible' : 'none',
          } as any,
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#0a1525',
            'text-halo-width': 1.5,
            'text-opacity': 0.92,
          },
        });
      }

      // Click handler — gate registration so a re-invocation of loadLayer
      // (after Mapbox style reload, layer cleanup, etc.) doesn't stack
      // listeners. The handler reads from refs so it stays current without
      // needing re-registration when callbacks/state change.
      if (!clickHandlerRegisteredRef.current.has(cfg.id)) {
        clickHandlerRegisteredRef.current.add(cfg.id);
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

          let html = `<div style="font-family:system-ui,sans-serif;color:#d4d4d4;font-size:11px;min-width:160px;max-width:240px;">`;

          const entry = cfg.id === 'beat'
            ? lookupBeatDistrict(beatDistrictMapRef.current, props.city_code, props.district_letter)
            : undefined;

          if (cfg.id === 'beat') {
            const beatCode = String(props.beat_code || fKey || '');
            const beatColor = getBeatColor(beatCode);
            // Beat header: color swatch + beat code
            html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;border-bottom:1px solid #333;padding-bottom:5px;">`;
            html += `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${beatColor};flex-shrink:0;"></span>`;
            html += `<span style="font-weight:700;font-size:13px;color:#fff;letter-spacing:0.5px;">${escapeForHtml(beatCode)}</span>`;
            if (entry) {
              html += `<span style="margin-left:auto;font-size:9px;font-weight:700;color:${beatColor};letter-spacing:1px;text-transform:uppercase;">${escapeForHtml(entry.dispatchCode)}</span>`;
            }
            html += `</div>`;

            if (entry) {
              const sColor = getSectorColor(entry.sectionId);
              const beatLabel = formatBeatLabel(entry.beatName, entry.beatDescriptor);
              if (beatLabel) {
                html += `<div style="color:#f0f4f9;font-size:11px;font-weight:600;margin-bottom:5px;">${escapeForHtml(beatLabel)}</div>`;
              }
              html += `<div style="font-size:10px;margin-top:3px;display:flex;gap:4px;align-items:baseline;">`;
              html += `<span style="color:${sColor};font-weight:600;min-width:40px;">Sector</span>`;
              html += `<span style="color:#e0e0e0;">${escapeForHtml(entry.sectionId)} — ${escapeForHtml(entry.sectionName)}</span>`;
              html += `</div>`;
              html += `<div style="font-size:10px;margin-top:2px;display:flex;gap:4px;align-items:baseline;">`;
              html += `<span style="color:#a0adbd;min-width:40px;">Zone</span>`;
              html += `<span style="color:#c3ccd6;">${escapeForHtml(entry.zoneId)} — ${escapeForHtml(entry.zoneName)}</span>`;
              html += `</div>`;
            } else {
              // BeatDistrictEntry not yet loaded — show what we have from GeoJSON props
              if (props.city) {
                html += `<div style="font-size:10px;color:#a0adbd;margin-top:2px;">${escapeForHtml(String(props.city))}</div>`;
              }
              if (props.district_letter) {
                html += `<div style="font-size:10px;color:#a0adbd;margin-top:1px;">District ${escapeForHtml(String(props.district_letter))}</div>`;
              }
            }
          } else {
            html += buildDefaultInfoHtml(name, cfg, props);
          }

          const compositeKey = makeCompositeKey(cfg.id, fKey);
          if (assignedFeaturesRef.current?.has(compositeKey)) {
            html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #333;font-size:9px;color:#22c55e;font-weight:700;letter-spacing:0.5px;">● ASSIGNED</div>`;
          }

          html += `</div>`;
          popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        });
      }
      }); // end whenStyleReady

      // REGRESSION-GUARD: in-flight flag cleared INSIDE whenStyleReady (not
      // in a finally block outside it). whenStyleReady may defer via
      // map.once('style.load') — clearing the flag before the callback fires
      // allows a second loadLayer() invocation to enter before the first
      // callback's addSource/addLayer mutations complete, causing a
      // "Layer with id '...' already exists" duplicate-layer error.
      inFlightLayersRef.current.delete(cfg.id);

      setLayerStates((prev) => ({
        ...prev,
        [cfg.id]: { ...prev[cfg.id], loaded: true, featureCount: 0 },
    }));
  }, [map, popup]);

  // Beat colors are set per-beat-code from the GeoJSON at load time and are
  // stable — no runtime sync needed. beatStyleLookup is retained for popup
  // data (BeatDistrictEntry lookup) only.

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
        try { if (hasLayer(map, fillId)) map.setLayoutProperty(fillId, 'visibility', vis); } catch {}
        try { if (hasLayer(map, lineId)) map.setLayoutProperty(lineId, 'visibility', vis); } catch {}
        if (layerId === 'beat') {
          try { if (hasLayer(map, BEAT_LABEL_LAYER)) map.setLayoutProperty(BEAT_LABEL_LAYER, 'visibility', vis); } catch {}
        }
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

  // Zoom-based visibility management.
  // Uses `zoomend` (fires once at gesture end) instead of `zoom` (fires
  // continuously at ~60Hz during a pinch) — running per-config setLayoutProperty
  // loops every frame was a meaningful frame-time cost. Reads layerStates via
  // ref so the listener doesn't re-bind on every state change.
  const layerStatesRef = useRef(layerStates);
  useEffect(() => { layerStatesRef.current = layerStates; }, [layerStates]);

  useEffect(() => {
    if (!map) return;
    const onZoomEnd = () => {
      const zoom = map.getZoom();
      const states = layerStatesRef.current;
      for (const cfg of GEO_LAYER_CONFIGS) {
        const state = states[cfg.id];
        if (!state?.visible) continue;
        const fillId = getFillLayerId(cfg.id);
        const lineId = getLineLayerId(cfg.id);
        const viz = !cfg.minZoom || zoom >= cfg.minZoom ? 'visible' : 'none';
        try { if (hasLayer(map, fillId)) map.setLayoutProperty(fillId, 'visibility', viz); } catch {}
        try { if (hasLayer(map, lineId)) map.setLayoutProperty(lineId, 'visibility', viz); } catch {}
        // Beat label layer has its own minzoom (9) baked into the layer spec;
        // additionally respect the beat layer's own visibility toggle.
        if (cfg.id === 'beat') {
          const labelViz = zoom >= 9 ? viz : 'none';
          try { if (hasLayer(map, BEAT_LABEL_LAYER)) map.setLayoutProperty(BEAT_LABEL_LAYER, 'visibility', labelViz); } catch {}
        }
      }
    };
    map.on('zoomend', onZoomEnd);
    // Apply once on bind so initial zoom state is respected without waiting for a gesture.
    onZoomEnd();
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const markers of Object.values(labelMarkerRefs.current)) {
        for (const m of markers) m.remove();
      }
      labelMarkerRefs.current = {};
      if (map && hasLayer(map, BEAT_LABEL_LAYER)) {
        try { safeRemoveLayer(map, BEAT_LABEL_LAYER); } catch {}
      }
    };
  }, [map]);

  // Reset per-map registration tracking when the map instance changes.
  // Mapbox handlers live on the map; a new map needs fresh bindings.
  useEffect(() => {
    clickHandlerRegisteredRef.current.clear();
    inFlightLayersRef.current.clear();
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
