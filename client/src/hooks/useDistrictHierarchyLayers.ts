// ============================================================
// RMPG Flex — District Hierarchy Layer Manager (Area/Sector/Zone)
// ============================================================
// Area, Section, and Zone have no geometry of their own — they are
// groupings of the ~719 beat polygons (beat.geojson). This hook builds
// each level as a selectable layer: a FILL that colors the shared beat
// geometry by that level, plus a single text LABEL per level anchored on
// the level's largest member beat. A/S/Z carry no outline of their own —
// the County + Municipality overlays supply the reference boundaries.
// Beat itself stays in useGeoJsonLayers.
//
// The Area›Sector›Zone›Beat mapping comes from
// /dispatch/geography/districts (dispatch_areas › sectors › zones › beats),
// joined to each beat polygon on city_code == zone_id (zone_code) — the
// established key the rest of the map already assumes.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { getTaggedBeats } from '../pages/map/utils/districtGeoData';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { escapeHtml } from '../utils/sanitize';

export type HierarchyLevelId = 'area' | 'sector' | 'zone';

export interface HierarchyLayerConfig {
  id: HierarchyLevelId;
  label: string;
  description: string;
  minzoom: number;
}

export const HIERARCHY_CONFIGS: HierarchyLayerConfig[] = [
  { id: 'area', label: 'Area', description: 'Top-level patrol areas', minzoom: 7 },
  { id: 'sector', label: 'Sector', description: 'Spillman sectors (SL1, DV1…)', minzoom: 8 },
  { id: 'zone', label: 'Zone', description: 'Zones / communities', minzoom: 9 },
];

// Per-level feature-property names baked onto each beat at tag time.
const FIELD: Record<HierarchyLevelId, { key: string; name: string; color: string }> = {
  area: { key: '_area', name: '_areaName', color: '_areaColor' },
  sector: { key: '_sector', name: '_sectorName', color: '_sectorColor' },
  zone: { key: '_zone', name: '_zoneName', color: '_zoneColor' },
};

const SRC_FILL = 'dh-beats';
const dissolveSrc = (id: string) => `dh-dissolve-${id}`;
const fillLayer = (id: string) => `dh-${id}-fill`;
const outlineLayer = (id: string) => `dh-${id}-outline`;
const labelLayer = (id: string) => `dh-${id}-label`;

// Ancestor chain per level, for the popup breadcrumb — mirrors Beat's
// Sector/Zone breadcrumb in useGeoJsonLayers.ts. Area has no ancestor;
// Sector's ancestor is Area; Zone's ancestors are Sector then Area.
const ANCESTORS: Record<HierarchyLevelId, HierarchyLevelId[]> = {
  area: [],
  sector: ['area'],
  zone: ['sector', 'area'],
};

// Popup content for an Area/Sector/Zone fill click: a color-swatch header
// (matching Beat's swatch + name header) followed by a breadcrumb of the
// clicked level's ancestors (e.g. a Zone shows its Sector and Area), instead
// of the previous flat Area/Sector/Zone/Beat dump on every level.
function buildHierarchyPopupHtml(id: HierarchyLevelId, cfg: HierarchyLayerConfig, p: Record<string, any>): string {
  const f = FIELD[id];
  const color = String(p[f.color] || '#c3ccd6');
  const name = String(p[f.name] || cfg.label);

  let html = `<div style="font-family:system-ui,sans-serif;color:#d4d4d4;font-size:11px;min-width:160px;max-width:240px;">`;
  html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;border-bottom:1px solid #333;padding-bottom:5px;">`;
  html += `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeHtml(color)};flex-shrink:0;"></span>`;
  html += `<span style="font-weight:700;font-size:13px;color:#fff;letter-spacing:0.5px;">${escapeHtml(name)}</span>`;
  html += `<span style="margin-left:auto;font-size:9px;font-weight:700;color:${escapeHtml(color)};letter-spacing:1px;text-transform:uppercase;">${escapeHtml(cfg.label)}</span>`;
  html += `</div>`;

  for (const ancestorId of ANCESTORS[id]) {
    const af = FIELD[ancestorId];
    const aColor = String(p[af.color] || '#a0adbd');
    const aName = String(p[af.name] || '—');
    const aLabel = HIERARCHY_CONFIGS.find((c) => c.id === ancestorId)?.label ?? ancestorId;
    html += `<div style="font-size:10px;margin-top:3px;display:flex;gap:4px;align-items:baseline;">`;
    html += `<span style="color:${escapeHtml(aColor)};font-weight:600;min-width:40px;">${escapeHtml(aLabel)}</span>`;
    html += `<span style="color:#e0e0e0;">${escapeHtml(aName)}</span>`;
    html += `</div>`;
  }

  if (p.beat_code || p.beat_id) {
    html += `<div style="font-size:10px;margin-top:3px;display:flex;gap:4px;align-items:baseline;">`;
    html += `<span style="color:#a0adbd;font-weight:600;min-width:40px;">Beat</span>`;
    html += `<span style="color:#c3ccd6;">${escapeHtml(String(p.beat_code || p.beat_id))}</span>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

export interface HierarchyLayerState { visible: boolean; loaded: boolean; }

interface Opts { map: mapboxgl.Map | null; popup: mapboxgl.Popup | null; }

export function useDistrictHierarchyLayers({ map, popup }: Opts) {
  const [states, setStates] = useState<Record<string, HierarchyLayerState>>(() => {
    const o: Record<string, HierarchyLayerState> = {};
    for (const c of HIERARCHY_CONFIGS) o[c.id] = { visible: false, loaded: false };
    return o;
  });

  const popupRef = useRef(popup);
  useEffect(() => { popupRef.current = popup; }, [popup]);
  const statesRef = useRef(states);
  useEffect(() => { statesRef.current = states; }, [states]);

  // Cached, built once: tagged beat FeatureCollection (a Promise so parallel
  // toggles share the single fetch/parse), and per-level label-anchor points.
  const dataPromiseRef = useRef<Promise<any> | null>(null);
  const taggedRef = useRef<any>(null);
  const labelPtsRef = useRef<Record<string, any>>({});
  // Per-map add/click tracking — cleared on style switch so layers re-add.
  const addedRef = useRef<Set<string>>(new Set());
  const clickBoundRef = useRef<Set<string>>(new Set());

  const ensureData = useCallback(() => {
    if (!dataPromiseRef.current) {
      dataPromiseRef.current = getTaggedBeats().then((fc) => { taggedRef.current = fc; return fc; });
    }
    return dataPromiseRef.current;
  }, []);

  // One label anchor per level value (Area/Section/Zone), computed in O(n).
  //
  // This used to @turf/dissolve all ~770 beat polygons into merged boundaries
  // purely to anchor a single label per level — a ~1–2s synchronous CPU burn
  // that froze the main thread (Chrome "'setTimeout' handler took ~2000ms").
  // Since A/S/Z render as fill COVERAGE with NO outline of their own, the
  // dissolved geometry was never drawn — only its label position mattered.
  // So we skip the merge entirely: group beats by the level key and drop one
  // label Point on each group's largest member beat (guaranteed to sit on
  // actual coverage). The fill layer still colors the real beat geometry.
  const ensureLabelPoints = useCallback((id: HierarchyLevelId) => {
    if (labelPtsRef.current[id]) return labelPtsRef.current[id];
    const tagged = taggedRef.current;
    if (!tagged) return null;
    const f = FIELD[id];
    try {
      // Largest outer ring per level value (bbox area is a cheap size proxy).
      const groups = new Map<any, { name: string; color: string; area: number; ring: number[][] | null }>();
      const consider = (g: any, get: (key: string) => any, val: any) => {
        let ring: number[][] | null = null;
        let area = 0;
        const tryRing = (coords: any) => {
          const outer = coords?.[0];
          if (!Array.isArray(outer) || outer.length < 3) return;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const c of outer) { const x = c[0], y = c[1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
          const a = (maxX - minX) * (maxY - minY);
          if (a > area) { area = a; ring = outer; }
        };
        if (g.type === 'Polygon') tryRing(g.coordinates);
        else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) tryRing(poly);
        const prev = groups.get(val);
        if (!prev || area > prev.area) {
          groups.set(val, { name: get(f.name) || String(val), color: get(f.color) || '#c3ccd6', area, ring });
        }
      };
      for (const ft of tagged.features) {
        const g = ft.geometry;
        if (!g) continue;
        const props = ft.properties || {};
        const val = props[f.key];
        if (val == null || val === '') continue;
        consider(g, (k) => props[k], val);
      }
      const features: any[] = [];
      for (const [val, info] of groups) {
        const ring = info.ring as number[][] | null;
        if (!ring || !ring.length) continue;
        // Simple vertex-average of the chosen ring — plenty accurate for a label.
        let sx = 0, sy = 0;
        for (const c of ring) { sx += c[0]; sy += c[1]; }
        features.push({
          type: 'Feature',
          properties: { _val: val, _name: info.name, _color: info.color },
          geometry: { type: 'Point', coordinates: [sx / ring.length, sy / ring.length] },
        });
      }
      const fc = { type: 'FeatureCollection', features };
      labelPtsRef.current[id] = fc;
      return fc;
    } catch (e) {
      console.warn('[hierarchy] label points failed for', id, e);
      return null;
    }
  }, []);

  const addLayer = useCallback(async (id: HierarchyLevelId) => {
    if (!map) return;
    if (addedRef.current.has(id)) return;
    await ensureData();
    const tagged = taggedRef.current;
    if (!tagged) return;
    const f = FIELD[id];
    const cfg = HIERARCHY_CONFIGS.find((c) => c.id === id)!;

    whenStyleReady(map, () => {
      if (addedRef.current.has(id)) return;
      try {
        if (!hasSource(map, SRC_FILL)) map.addSource(SRC_FILL, { type: 'geojson', data: tagged });

        // Fill: shared beat geometry colored by this level. Added first/sync so
        // toggling feels instant — the heavier dissolve runs deferred below.
        if (!hasLayer(map, fillLayer(id))) {
          map.addLayer({
            id: fillLayer(id),
            type: 'fill',
            source: SRC_FILL,
            // No minzoom — once selected, A/S/Z/B coverage stays visible at
            // every zoom (operator: must not pop in/out while zooming).
            layout: { visibility: 'none' },
            paint: { 'fill-color': ['get', f.color] as any, 'fill-opacity': 0.18 },
          });
        }

        // Outline: dashed border keyed on the SAME shared beat geometry/color
        // tags used for the fill — O(n), no dissolve. Matches Beat's dashed
        // look (useGeoJsonLayers.ts) so A/S/Z reads consistently with Beat
        // instead of as flat, borderless coverage.
        if (!hasLayer(map, outlineLayer(id))) {
          map.addLayer({
            id: outlineLayer(id),
            type: 'line',
            source: SRC_FILL,
            layout: { visibility: 'none' },
            paint: {
              'line-color': ['get', f.color] as any,
              'line-opacity': 0.65,
              'line-width': 1.2,
              'line-dasharray': [4, 2],
            },
          });
        }

        // Label: one symbol per level value, anchored on each group's largest
        // beat. This is O(n) now (was a ~1–2s @turf/dissolve that blocked the
        // main thread), so it runs inline right after the fill. Style (halo,
        // font, size) matches Beat's label layer (useGeoJsonLayers.ts) for
        // visual consistency across the coverage hierarchy.
        // NOTE: A/S/Z/B render as color COVERAGE (fill) only — no boundary
        // outline of their own. The boundary/reference role is filled by the
        // County + Municipality outline-only overlays. The point source exists
        // purely to anchor one label per level.
        try {
          const labelPts = ensureLabelPoints(id);
          if (labelPts) {
            if (!hasSource(map, dissolveSrc(id))) map.addSource(dissolveSrc(id), { type: 'geojson', data: labelPts });
            if (!hasLayer(map, labelLayer(id))) {
              map.addLayer({
                id: labelLayer(id),
                type: 'symbol',
                source: dissolveSrc(id),
                // No minzoom — label rides with its coverage at all zooms.
                layout: {
                  visibility: 'none',
                  'text-field': ['get', '_name'] as any,
                  'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 12, 12, 14, 14] as any,
                  'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                  'text-allow-overlap': false,
                  'text-ignore-placement': false,
                  'text-anchor': 'center',
                  'text-max-width': 6,
                },
                paint: { 'text-color': '#ffffff', 'text-halo-color': '#0a1525', 'text-halo-width': 1.5, 'text-opacity': 0.92 },
              });
            }
            const vis = statesRef.current[id]?.visible ? 'visible' : 'none';
            if (hasLayer(map, labelLayer(id))) map.setLayoutProperty(labelLayer(id), 'visibility', vis);
          }
        } catch (err) {
          console.warn('[hierarchy] label add failed', id, err);
        }

        if (!clickBoundRef.current.has(id)) {
          clickBoundRef.current.add(id);
          map.on('click', fillLayer(id), (e) => {
            const pop = popupRef.current;
            if (!pop || !e.features || e.features.length === 0) return;
            const p = e.features[0].properties || {};
            pop.setLngLat(e.lngLat).setHTML(buildHierarchyPopupHtml(id, cfg, p)).addTo(map);
          });
          map.on('mouseenter', fillLayer(id), () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', fillLayer(id), () => { map.getCanvas().style.cursor = ''; });
        }

        addedRef.current.add(id);
        setStates((prev) => ({ ...prev, [id]: { ...prev[id], loaded: true } }));
      } catch (err) {
        console.error('[hierarchy] add failed', id, err);
      }
    });
  }, [map, ensureData, ensureLabelPoints]);

  const setVis = useCallback((id: HierarchyLevelId, visible: boolean) => {
    if (!map) return;
    const v = visible ? 'visible' : 'none';
    for (const lid of [fillLayer(id), outlineLayer(id), labelLayer(id)]) {
      try { if (hasLayer(map, lid)) map.setLayoutProperty(lid, 'visibility', v); } catch { /* style not ready */ }
    }
  }, [map]);

  const toggleHierarchyLayer = useCallback((id: HierarchyLevelId) => {
    setStates((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      const now = !cur.visible;
      if (now && !cur.loaded) addLayer(id);
      setTimeout(() => setVis(id, now), 0);
      return { ...prev, [id]: { ...cur, visible: now } };
    });
  }, [addLayer, setVis]);

  // Basemap-switch / print resilience — setStyle() wipes custom sources +
  // layers (so addedRef must be cleared to re-add them) but Mapbox RETAINS
  // map-level delegated click/hover listeners across a style change. Do NOT
  // clear clickBoundRef here: re-running addLayer would then bind a SECOND
  // handler on the same fill id while the first is still attached, so each
  // basemap switch stacked another duplicate popup (N switches → N popups).
  // Keeping clickBoundRef means handlers bind exactly once per layer for the
  // life of the map instance. (Same fix as useVectorTileLayers.)
  useEffect(() => {
    if (!map) return;
    const onLoad = () => {
      addedRef.current.clear();
      for (const c of HIERARCHY_CONFIGS) {
        if (statesRef.current[c.id]?.visible) {
          addLayer(c.id);
          setVis(c.id, true);
        }
      }
    };
    map.on('style.load', onLoad);
    return () => { map.off('style.load', onLoad); };
  }, [map, addLayer, setVis]);

  useEffect(() => {
    addedRef.current.clear();
    clickBoundRef.current.clear();
  }, [map]);

  return { hierarchyStates: states, toggleHierarchyLayer, hierarchyConfigs: HIERARCHY_CONFIGS };
}
