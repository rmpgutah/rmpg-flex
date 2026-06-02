// ============================================================
// RMPG Flex — District Hierarchy Layer Manager (Area/Section/Zone)
// ============================================================
// Area, Section, and Zone have no geometry of their own — they are
// groupings of the ~719 beat polygons (beat.geojson). This hook builds
// each level as a selectable layer two ways at once (per the operator's
// spec): a FILL that colors the shared beat geometry by that level, plus
// a dissolved OUTLINE (via @turf/dissolve) that draws the merged boundary
// for the level. Beat itself stays in useGeoJsonLayers.
//
// The Area›Section›Zone›Beat mapping comes from
// /dispatch/geography/districts (dispatch_areas › sectors › zones › beats),
// joined to each beat polygon on city_code == zone_id (zone_code) — the
// established key the rest of the map already assumes.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { getTaggedBeats } from '../pages/map/utils/districtGeoData';
import { dissolve } from '@turf/dissolve';

export type HierarchyLevelId = 'area' | 'section' | 'zone';

export interface HierarchyLayerConfig {
  id: HierarchyLevelId;
  label: string;
  description: string;
  minzoom: number;
}

export const HIERARCHY_CONFIGS: HierarchyLayerConfig[] = [
  { id: 'area', label: 'Area', description: 'Top-level patrol areas', minzoom: 7 },
  { id: 'section', label: 'Section', description: 'Spillman sections (SL1, DV1…)', minzoom: 8 },
  { id: 'zone', label: 'Zone', description: 'Zones / communities', minzoom: 9 },
];

// Per-level feature-property names baked onto each beat at tag time.
const FIELD: Record<HierarchyLevelId, { key: string; name: string; color: string }> = {
  area: { key: '_area', name: '_areaName', color: '_areaColor' },
  section: { key: '_section', name: '_sectionName', color: '_sectionColor' },
  zone: { key: '_zone', name: '_zoneName', color: '_zoneColor' },
};

const SRC_FILL = 'dh-beats';
const dissolveSrc = (id: string) => `dh-dissolve-${id}`;
const fillLayer = (id: string) => `dh-${id}-fill`;
const outlineLayer = (id: string) => `dh-${id}-outline`;
const labelLayer = (id: string) => `dh-${id}-label`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  // toggles share the single fetch/parse), and per-level dissolved outlines.
  const dataPromiseRef = useRef<Promise<any> | null>(null);
  const taggedRef = useRef<any>(null);
  const dissolvedRef = useRef<Record<string, any>>({});
  // Per-map add/click tracking — cleared on style switch so layers re-add.
  const addedRef = useRef<Set<string>>(new Set());
  const clickBoundRef = useRef<Set<string>>(new Set());

  const ensureData = useCallback(() => {
    if (!dataPromiseRef.current) {
      dataPromiseRef.current = getTaggedBeats().then((fc) => { taggedRef.current = fc; return fc; });
    }
    return dataPromiseRef.current;
  }, []);

  // Merge adjacent beats sharing a level value into one boundary polygon.
  // @turf/dissolve REJECTS the whole collection if any feature is a
  // MultiPolygon (51 of the 719 beats are), so flatten every MultiPolygon
  // into its component Polygons first. Falls back to null (fill-only, no
  // outline) if dissolve still throws.
  const ensureDissolved = useCallback((id: HierarchyLevelId) => {
    if (dissolvedRef.current[id]) return dissolvedRef.current[id];
    const tagged = taggedRef.current;
    if (!tagged) return null;
    const f = FIELD[id];
    try {
      const flatFeats: any[] = [];
      for (const ft of tagged.features) {
        const g = ft.geometry;
        if (!g) continue;
        if (g.type === 'Polygon') {
          flatFeats.push(ft);
        } else if (g.type === 'MultiPolygon') {
          for (const poly of g.coordinates) {
            flatFeats.push({ type: 'Feature', properties: ft.properties, geometry: { type: 'Polygon', coordinates: poly } });
          }
        }
      }
      const merged: any = dissolve({ type: 'FeatureCollection', features: flatFeats } as any, { propertyName: f.key });
      for (const mf of merged.features) {
        const val = mf.properties?.[f.key];
        const src = tagged.features.find((x: any) => x.properties[f.key] === val);
        mf.properties = {
          ...(mf.properties || {}),
          _val: val,
          _name: src?.properties?.[f.name] || val,
          _color: src?.properties?.[f.color] || '#d4a017',
        };
      }
      dissolvedRef.current[id] = merged;
      return merged;
    } catch (e) {
      console.warn('[hierarchy] dissolve failed for', id, e);
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
        if (!map.getSource(SRC_FILL)) map.addSource(SRC_FILL, { type: 'geojson', data: tagged });

        // Fill: shared beat geometry colored by this level. Added first/sync so
        // toggling feels instant — the heavier dissolve runs deferred below.
        if (!map.getLayer(fillLayer(id))) {
          map.addLayer({
            id: fillLayer(id),
            type: 'fill',
            source: SRC_FILL,
            minzoom: cfg.minzoom,
            layout: { visibility: 'none' },
            paint: { 'fill-color': ['get', f.color] as any, 'fill-opacity': 0.18 },
          });
        }

        // Outline + label: dissolved level boundary. The dissolve is ~1–2s of
        // CPU, so defer it a tick — the fill is already on screen by then.
        setTimeout(() => {
          if (!map.getLayer(fillLayer(id))) return; // removed by a style switch mid-defer
          const dissolved = ensureDissolved(id);
          if (!dissolved) return;
          try {
            if (!map.getSource(dissolveSrc(id))) map.addSource(dissolveSrc(id), { type: 'geojson', data: dissolved });
            if (!map.getLayer(outlineLayer(id))) {
              map.addLayer({
                id: outlineLayer(id),
                type: 'line',
                source: dissolveSrc(id),
                minzoom: cfg.minzoom,
                layout: { visibility: 'none', 'line-join': 'round' },
                paint: {
                  'line-color': ['get', '_color'] as any,
                  'line-width': ['interpolate', ['linear'], ['zoom'], cfg.minzoom, 1.5, 14, 3] as any,
                  'line-opacity': 0.9,
                },
              });
            }
            if (!map.getLayer(labelLayer(id))) {
              map.addLayer({
                id: labelLayer(id),
                type: 'symbol',
                source: dissolveSrc(id),
                minzoom: cfg.minzoom,
                layout: {
                  visibility: 'none',
                  'text-field': ['get', '_name'] as any,
                  'text-size': 11,
                  'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
                },
                paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.4 },
              });
            }
            // Match the level's current visibility (it may have been toggled
            // on while the dissolve was still computing).
            const vis = statesRef.current[id]?.visible ? 'visible' : 'none';
            if (map.getLayer(outlineLayer(id))) map.setLayoutProperty(outlineLayer(id), 'visibility', vis);
            if (map.getLayer(labelLayer(id))) map.setLayoutProperty(labelLayer(id), 'visibility', vis);
          } catch (err) {
            console.warn('[hierarchy] outline add failed', id, err);
          }
        }, 0);

        if (!clickBoundRef.current.has(id)) {
          clickBoundRef.current.add(id);
          map.on('click', fillLayer(id), (e) => {
            const pop = popupRef.current;
            if (!pop || !e.features || e.features.length === 0) return;
            const p = e.features[0].properties || {};
            const color = p[f.color] || '#d4a017';
            const html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:150px;">`
              + `<div style="font-weight:bold;font-size:12px;color:${color};margin-bottom:3px;border-bottom:1px solid #444;padding-bottom:3px;">${esc(String(p[f.name] || cfg.label))}</div>`
              + `<div style="color:#888;font-size:9px;text-transform:uppercase;margin-bottom:4px;">${cfg.label}</div>`
              + `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Area:</span> ${esc(String(p._areaName || '—'))}</div>`
              + `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Section:</span> ${esc(String(p._sectionName || '—'))}</div>`
              + `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Zone:</span> ${esc(String(p._zoneName || '—'))}</div>`
              + `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Beat:</span> ${esc(String(p.beat_code || p.beat_id || '—'))}</div>`
              + `</div>`;
            pop.setLngLat(e.lngLat).setHTML(html).addTo(map);
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
  }, [map, ensureData, ensureDissolved]);

  const setVis = useCallback((id: HierarchyLevelId, visible: boolean) => {
    if (!map) return;
    const v = visible ? 'visible' : 'none';
    for (const lid of [fillLayer(id), outlineLayer(id), labelLayer(id)]) {
      try { if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', v); } catch { /* style not ready */ }
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

  // Basemap-switch / print resilience — setStyle wipes custom layers; re-add
  // whatever was visible when the new style finishes loading.
  useEffect(() => {
    if (!map) return;
    const onLoad = () => {
      addedRef.current.clear();
      clickBoundRef.current.clear();
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
