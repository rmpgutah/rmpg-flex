// ============================================================
// RMPG Flex — Activity Choropleth (calls × geography)
// ============================================================
// Colors the beat polygons by live call volume, aggregated at a selectable
// level (Beat / Zone / Section / Area). Each active call is binned into its
// containing beat via point-in-polygon (once), then beat counts are rolled
// up to the chosen level — so switching level is instant and only the calls
// changing triggers a re-bin.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { getTaggedBeats } from '../pages/map/utils/districtGeoData';

export type ChoroLevel = 'beat' | 'zone' | 'section' | 'area';
const LEVEL_PROP: Record<ChoroLevel, string> = { beat: 'beat_id', zone: '_zone', section: '_section', area: '_area' };

const SRC = 'choro-beats';
const FILL = 'choro-fill';

// Gold → red ramp (zero-blue theme). Index 0 is the near-zero bucket.
const RAMP = ['#2a2a2a', '#d4a017', '#f59e0b', '#fb923c', '#ef4444'];

export interface ChoroLegend { level: ChoroLevel; max: number; thresholds: number[]; colors: string[]; }

interface CallLike { latitude: number | null; longitude: number | null; }

interface Opts { map: mapboxgl.Map | null; calls: CallLike[]; level: ChoroLevel | null; }

export function useActivityChoropleth({ map, calls, level }: Opts) {
  const [legend, setLegend] = useState<ChoroLegend | null>(null);
  const taggedRef = useRef<any>(null);
  const countByBeatRef = useRef<Map<string, number>>(new Map());
  const levelRef = useRef(level);
  useEffect(() => { levelRef.current = level; }, [level]);

  // Bin calls -> beats once (re-runs when the call set changes).
  const callsKey = calls.map((c) => `${c.latitude},${c.longitude}`).join('|');
  useEffect(() => {
    let cancelled = false;
    getTaggedBeats().then((fc) => {
      if (cancelled) return;
      taggedRef.current = fc;
      const counts = new Map<string, number>();
      for (const c of calls) {
        if (c.latitude == null || c.longitude == null) continue;
        const pt = { type: 'Point', coordinates: [c.longitude, c.latitude] } as any;
        for (const f of fc.features) {
          const g = f.geometry;
          if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
          try {
            if (booleanPointInPolygon(pt, f as any)) {
              const bid = String(f.properties.beat_id ?? f.properties.beat_code ?? '');
              counts.set(bid, (counts.get(bid) || 0) + 1);
              break;
            }
          } catch { /* skip */ }
        }
      }
      countByBeatRef.current = counts;
      if (levelRef.current) applyLevel(levelRef.current);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsKey]);

  // Roll beat counts up to `lvl`, write _count onto a clone, update source +
  // color steps + legend.
  const applyLevel = useCallback((lvl: ChoroLevel) => {
    const tagged = taggedRef.current;
    if (!map || !tagged) return;
    const prop = LEVEL_PROP[lvl];
    const countByBeat = countByBeatRef.current;

    // group totals at the chosen level
    const groupTotal = new Map<string, number>();
    for (const f of tagged.features) {
      const key = String(f.properties[prop] ?? '');
      const bid = String(f.properties.beat_id ?? f.properties.beat_code ?? '');
      const c = lvl === 'beat' ? (countByBeat.get(bid) || 0) : (countByBeat.get(bid) || 0);
      groupTotal.set(key, (groupTotal.get(key) || 0) + c);
    }

    const features = tagged.features.map((f: any) => {
      const key = String(f.properties[prop] ?? '');
      const count = lvl === 'beat'
        ? (countByBeat.get(String(f.properties.beat_id ?? f.properties.beat_code ?? '')) || 0)
        : (groupTotal.get(key) || 0);
      return { ...f, properties: { ...f.properties, _count: count } };
    });
    const data = { type: 'FeatureCollection', features };

    const max = Math.max(0, ...Array.from(groupTotal.values()), ...features.map((f: any) => f.properties._count));
    // Mapbox 'step' inputs MUST be strictly ascending or addLayer throws. For low
    // maxima the 0.25/0.5/0.75 breakpoints collapse to the same value (e.g. max=3
    // → 1,1,2,3) which crashed the FILL layer. Build distinct, strictly-increasing
    // stops and pair each with the next ramp color.
    const stops: number[] = [];
    for (const v of [1, Math.round(max * 0.25), Math.round(max * 0.5), Math.round(max * 0.75)]) {
      const n = Math.max(1, v);
      if (stops.length === 0 || n > stops[stops.length - 1]) stops.push(n);
    }
    const fillColor: any = ['step', ['get', '_count'], RAMP[0]];
    stops.forEach((s, i) => { fillColor.push(s, RAMP[Math.min(i + 1, RAMP.length - 1)]); });

    whenStyleReady(map, () => {
      const src = map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(data as any);
      else map.addSource(SRC, { type: 'geojson', data: data as any });
      if (!map.getLayer(FILL)) {
        map.addLayer({
          id: FILL, type: 'fill', source: SRC,
          paint: {
            'fill-color': fillColor,
            'fill-opacity': ['case', ['>', ['get', '_count'], 0], 0.6, 0.04] as any,
            'fill-outline-color': '#000000',
          },
        });
      } else {
        map.setPaintProperty(FILL, 'fill-color', fillColor);
      }
    });
    setLegend({ level: lvl, max, thresholds: stops, colors: RAMP });
  }, [map]);

  // React to level on/off.
  useEffect(() => {
    if (!map) return;
    if (level) {
      applyLevel(level);
    } else {
      setLegend(null);
      try { if (map.getLayer(FILL)) map.removeLayer(FILL); } catch { /* */ }
    }
  }, [map, level, applyLevel]);

  // Re-add after a basemap switch / print.
  useEffect(() => {
    if (!map) return;
    const onLoad = () => { if (levelRef.current) applyLevel(levelRef.current); };
    map.on('style.load', onLoad);
    return () => { map.off('style.load', onLoad); };
  }, [map, applyLevel]);

  return { choroLegend: legend };
}
