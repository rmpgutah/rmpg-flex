import { useEffect, useRef, useState } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import CircleStyle from 'ol/style/Circle';
import RegularShape from 'ol/style/RegularShape';
import Fill from 'ol/style/Fill';
import TextStyle from 'ol/style/Text';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';
import { UNIT_STATUS_HEX } from '../../../utils/statusColors';
import type { UnitStatus } from '../../../types';
import {
  summarizeTrail, findSpeedWarnings, findHardBrakes, findStatusChanges,
  findStops, findArrowAnchors, findMilestones, convexHull, filterByHourRange,
  type TrailSummary,
} from '../utils/breadcrumbAnalysis';

export interface BreadcrumbPoint {
  lat: number;
  lng: number;
  /** m/s */
  speed?: number | null;
  heading?: number | null;
  status?: string | null;
  call_number?: string | null;
  call_type?: string | null;
  time?: string;
  road_name?: string | null;
  intersection?: string | null;
  /** Set on render so the popup builder can show the unit context */
  call_sign?: string;
  officer_name?: string;
}

interface Trail {
  unit_id: number;
  call_sign: string;
  officer_name?: string;
  points: BreadcrumbPoint[];
}

export type BreadcrumbColorMode = 'unit' | 'speed' | 'status';

const TRAIL_COLORS = [
  '#22c55e', '#60a5fa', '#f59e0b', '#a855f7', '#ec4899',
  '#14b8a6', '#fb923c', '#8b5cf6', '#10b981', '#fbbf24',
  '#ef4444', '#06b6d4',
];

function colorForUnit(callSign: string): string {
  let hash = 0;
  for (let i = 0; i < callSign.length; i++) {
    hash = ((hash << 5) - hash + callSign.charCodeAt(i)) | 0;
  }
  return TRAIL_COLORS[Math.abs(hash) % TRAIL_COLORS.length];
}

function colorForSpeed(mps: number | null | undefined): string {
  if (mps == null || !Number.isFinite(mps)) return '#666666';
  const mph = mps * 2.237;
  if (mph < 5) return '#3b82f6';
  if (mph < 25) return '#22c55e';
  if (mph < 50) return '#f59e0b';
  return '#ef4444';
}

function colorForStatus(status: string | null | undefined): string {
  if (!status) return '#888888';
  return UNIT_STATUS_HEX[status as UnitStatus] || '#888888';
}

const MAX_POINTS_PER_TRAIL = 5000;

function decimate<T>(arr: T[], target: number): T[] {
  if (arr.length <= target) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (target - 1);
  for (let i = 0; i < target; i++) {
    const idx = Math.min(arr.length - 1, Math.round(i * step));
    out.push(arr[idx]);
  }
  return out;
}

// ─── Per-feature styles for derived layers ────────────────────

const STOP_STYLE = new Style({
  image: new RegularShape({
    points: 4,
    radius: 8,
    angle: Math.PI / 4,
    fill: new Fill({ color: '#fbbf24cc' }),
    stroke: new Stroke({ color: '#0a0a0a', width: 1.5 }),
  }),
});
const SPEED_WARNING_STYLE = new Style({
  image: new RegularShape({
    points: 3,
    radius: 6,
    fill: new Fill({ color: '#ef4444cc' }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
  }),
});
const HARD_BRAKE_STYLE = new Style({
  image: new RegularShape({
    points: 3,
    radius: 7,
    rotation: Math.PI,
    fill: new Fill({ color: '#dc2626cc' }),
    stroke: new Stroke({ color: '#fef2f2', width: 1.5 }),
  }),
});
const STATUS_CHANGE_STYLE = new Style({
  image: new RegularShape({
    points: 4,
    radius: 6,
    angle: 0,
    fill: new Fill({ color: '#a855f7cc' }),
    stroke: new Stroke({ color: '#0a0a0a', width: 1 }),
  }),
});
const HULL_STYLE = new Style({
  fill: new Fill({ color: '#14b8a611' }),
  stroke: new Stroke({ color: '#14b8a6', width: 1.5, lineDash: [3, 3] }),
});

function arrowStyle(headingDeg: number, color: string): Style {
  return new Style({
    image: new RegularShape({
      points: 3,
      radius: 5,
      rotation: headingDeg * Math.PI / 180,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#0a0a0a', width: 1 }),
    }),
  });
}

function milestoneStyle(mile: number, color: string): Style {
  return new Style({
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: '#0a0a0a' }),
      stroke: new Stroke({ color, width: 1.5 }),
    }),
    text: new TextStyle({
      text: String(mile),
      font: '700 9px ui-monospace, monospace',
      fill: new Fill({ color }),
    }),
  });
}

export interface OlBreadcrumbsAdvancedOpts {
  visible: boolean;
  hours?: number;
  colorMode?: BreadcrumbColorMode;
  /** Show parked-location markers (>5 min stationary) */
  showStops?: boolean;
  /** Show >80 mph warning markers */
  showSpeedWarnings?: boolean;
  /** Show hard-braking event markers (Δspeed >15 mph in <5s) */
  showHardBrakes?: boolean;
  /** Show status-change diamonds */
  showStatusChanges?: boolean;
  /** Show small chevron arrows along the trail at every Nth point */
  showArrows?: boolean;
  /** Show numbered milestone circles every 1 mile */
  showMilestones?: boolean;
  /** Show convex-hull polygon containing all trail points */
  showHull?: boolean;
  /** Filter to only show points within this hour range, [from, to]. If
   *  both are 0 (default), no filter. */
  hourRangeFrom?: number;
  hourRangeTo?: number;
  /** Hide segments where unit status is off_duty / out_of_service */
  hideOffDuty?: boolean;
}

/** Reference to the latest fetched trails — set by the data effect,
 *  read by exported hooks like getLastTrails for the GPX export button. */
let lastFetchedTrails: Trail[] = [];
export function getLastBreadcrumbTrails(): Trail[] { return lastFetchedTrails; }

/**
 * GPS breadcrumb trails for /map-v2 with advanced derived overlays.
 *
 * Per-trail rendering:
 *  - N-1 short LineString segments (per-segment colored by colorMode)
 *  - Per-point click-to-popup Circle markers (start=green, end=red)
 *  - Optional derived layers (stops, speed warnings, hard brakes,
 *    status changes, arrows, milestones, hull) toggled via opts
 *
 * Refetches from /dispatch/gps/trails on visible/hours change. Per-
 * point analyses (findStops, findSpeedWarnings, etc.) live in
 * utils/breadcrumbAnalysis and are pure functions — re-running them
 * on toggle change is cheap (<10ms for a 5000-point trail).
 */
export function useOlBreadcrumbs(map: OlMap | null, opts: OlBreadcrumbsAdvancedOpts): {
  trails: Trail[];
  summaries: { call_sign: string; summary: TrailSummary }[];
} {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pointLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const stopsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const warnLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const brakeLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const statusLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const arrowsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const milestonesLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const hullLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pointSourceRef = useRef<VectorSource | null>(null);
  const stopsSourceRef = useRef<VectorSource | null>(null);
  const warnSourceRef = useRef<VectorSource | null>(null);
  const brakeSourceRef = useRef<VectorSource | null>(null);
  const statusSourceRef = useRef<VectorSource | null>(null);
  const arrowsSourceRef = useRef<VectorSource | null>(null);
  const milestonesSourceRef = useRef<VectorSource | null>(null);
  const hullSourceRef = useRef<VectorSource | null>(null);

  const [trails, setTrailsState] = useState<Trail[]>([]);
  const [summaries, setSummariesState] = useState<{ call_sign: string; summary: TrailSummary }[]>([]);

  const hours = opts.hours ?? 8;
  const colorMode: BreadcrumbColorMode = opts.colorMode ?? 'unit';

  // Mount once
  useEffect(() => {
    if (!map || layerRef.current) return;

    const mk = (z: number, style?: any) => {
      const src = new VectorSource();
      const lyr = new VectorLayer({ source: src, visible: opts.visible, zIndex: z, style });
      map.addLayer(lyr);
      return { src, lyr };
    };

    const seg = mk(40); sourceRef.current = seg.src; layerRef.current = seg.lyr;
    const pts = mk(41); pointSourceRef.current = pts.src; pointLayerRef.current = pts.lyr;
    const hull = mk(38, HULL_STYLE); hullSourceRef.current = hull.src; hullLayerRef.current = hull.lyr;
    const arrows = mk(42); arrowsSourceRef.current = arrows.src; arrowsLayerRef.current = arrows.lyr;
    const stops = mk(43, STOP_STYLE); stopsSourceRef.current = stops.src; stopsLayerRef.current = stops.lyr;
    const warns = mk(44, SPEED_WARNING_STYLE); warnSourceRef.current = warns.src; warnLayerRef.current = warns.lyr;
    const brakes = mk(45, HARD_BRAKE_STYLE); brakeSourceRef.current = brakes.src; brakeLayerRef.current = brakes.lyr;
    const stat = mk(46, STATUS_CHANGE_STYLE); statusSourceRef.current = stat.src; statusLayerRef.current = stat.lyr;
    const ms = mk(47); milestonesSourceRef.current = ms.src; milestonesLayerRef.current = ms.lyr;

    return () => {
      [layerRef, pointLayerRef, hullLayerRef, arrowsLayerRef, stopsLayerRef,
       warnLayerRef, brakeLayerRef, statusLayerRef, milestonesLayerRef].forEach((r) => {
        if (r.current) { map.removeLayer(r.current); r.current = null; }
      });
      sourceRef.current = null;
      pointSourceRef.current = null;
      hullSourceRef.current = null;
      arrowsSourceRef.current = null;
      stopsSourceRef.current = null;
      warnSourceRef.current = null;
      brakeSourceRef.current = null;
      statusSourceRef.current = null;
      milestonesSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Visibility cascade — top-level + per-toggle
  useEffect(() => {
    layerRef.current?.setVisible(opts.visible);
    pointLayerRef.current?.setVisible(opts.visible);
    hullLayerRef.current?.setVisible(opts.visible && !!opts.showHull);
    arrowsLayerRef.current?.setVisible(opts.visible && !!opts.showArrows);
    stopsLayerRef.current?.setVisible(opts.visible && !!opts.showStops);
    warnLayerRef.current?.setVisible(opts.visible && !!opts.showSpeedWarnings);
    brakeLayerRef.current?.setVisible(opts.visible && !!opts.showHardBrakes);
    statusLayerRef.current?.setVisible(opts.visible && !!opts.showStatusChanges);
    milestonesLayerRef.current?.setVisible(opts.visible && !!opts.showMilestones);
  }, [opts.visible, opts.showHull, opts.showArrows, opts.showStops,
      opts.showSpeedWarnings, opts.showHardBrakes, opts.showStatusChanges,
      opts.showMilestones]);

  // Data + analysis effect — refires on opts that affect what's rendered.
  useEffect(() => {
    if (!opts.visible || !sourceRef.current) return;
    let cancelled = false;
    apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${hours}`)
      .then((apiTrails) => {
        if (cancelled || !sourceRef.current) return;
        const ts = (apiTrails || []) as Trail[];
        lastFetchedTrails = ts;
        setTrailsState(ts);

        const segFeats: Feature<Geometry>[] = [];
        const pointFeats: Feature<Geometry>[] = [];
        const stopsFeats: Feature<Geometry>[] = [];
        const warnFeats: Feature<Geometry>[] = [];
        const brakeFeats: Feature<Geometry>[] = [];
        const statusFeats: Feature<Geometry>[] = [];
        const arrowFeats: Feature<Geometry>[] = [];
        const milestoneFeats: Feature<Geometry>[] = [];
        const hullFeats: Feature<Geometry>[] = [];
        const computedSummaries: { call_sign: string; summary: TrailSummary }[] = [];

        for (const t of ts) {
          if (!Array.isArray(t.points) || t.points.length < 2) continue;
          // Apply filters BEFORE decimation so they reduce the work.
          let raw = t.points;
          if (opts.hideOffDuty) {
            raw = raw.filter((p) => p.status !== 'off_duty' && p.status !== 'out_of_service');
          }
          if (typeof opts.hourRangeFrom === 'number' && typeof opts.hourRangeTo === 'number'
              && opts.hourRangeFrom !== opts.hourRangeTo) {
            raw = filterByHourRange(raw, opts.hourRangeFrom, opts.hourRangeTo);
          }
          if (raw.length < 2) continue;

          const summary = summarizeTrail(raw);
          computedSummaries.push({ call_sign: t.call_sign, summary });

          const decimated = decimate(raw, MAX_POINTS_PER_TRAIL);
          const valid = decimated.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
          if (valid.length < 2) continue;

          const unitColor = colorForUnit(t.call_sign);

          // Trail segments
          for (let i = 1; i < valid.length; i++) {
            const a = valid[i - 1];
            const b = valid[i];
            const segColor = colorMode === 'speed' ? colorForSpeed(b.speed)
              : colorMode === 'status' ? colorForStatus(b.status)
              : unitColor;
            const seg = new Feature({
              geometry: new LineString([
                fromLonLat([a.lng, a.lat]),
                fromLonLat([b.lng, b.lat]),
              ]),
            });
            seg.setStyle(new Style({ stroke: new Stroke({ color: segColor, width: 2.5 }) }));
            segFeats.push(seg);
          }

          // Per-point click-to-popup with start/end visual distinction
          for (let i = 0; i < valid.length; i++) {
            const p = valid[i];
            const isStart = i === 0;
            const isEnd = i === valid.length - 1;
            const c = isStart ? '#22c55e'
              : isEnd ? '#ef4444'
              : colorMode === 'speed' ? colorForSpeed(p.speed)
              : colorMode === 'status' ? colorForStatus(p.status)
              : unitColor;
            const radius = isStart || isEnd ? 5 : 2.5;
            const strokeWidth = isStart || isEnd ? 1.5 : 0.5;
            const pt = new Feature({ geometry: new Point(fromLonLat([p.lng, p.lat])) });
            pt.setStyle(new Style({
              image: new CircleStyle({
                radius,
                fill: new Fill({ color: c }),
                stroke: new Stroke({ color: '#0a0a0a', width: strokeWidth }),
              }),
            }));
            pt.set('kind', 'breadcrumb');
            pt.set('payload', {
              ...p,
              call_sign: t.call_sign,
              officer_name: t.officer_name || '',
              isStart, isEnd,
              // Attach trail summary to start/end so the popup can show
              // "trail: 12.3 mi over 4h 12m, avg 38 mph" without an
              // extra round-trip.
              ...(isStart || isEnd ? { trailSummary: summary } : {}),
            } as BreadcrumbPoint & {
              isStart: boolean; isEnd: boolean; trailSummary?: TrailSummary;
            });
            pointFeats.push(pt);
          }

          // ─── Derived overlays (pure analyses on raw points) ───

          if (opts.showHull) {
            const hull = convexHull(raw);
            if (hull.length >= 4) {
              const ring = hull.map(([lng, lat]) => fromLonLat([lng, lat]));
              const f = new Feature({ geometry: new Polygon([ring]) });
              hullFeats.push(f);
            }
          }
          if (opts.showArrows) {
            for (const ap of findArrowAnchors(raw)) {
              const f = new Feature({ geometry: new Point(fromLonLat([ap.lng, ap.lat])) });
              f.setStyle(arrowStyle(ap.heading as number, unitColor));
              arrowFeats.push(f);
            }
          }
          if (opts.showStops) {
            for (const sp of findStops(raw)) {
              const f = new Feature({ geometry: new Point(fromLonLat([sp.lng, sp.lat])) });
              f.set('kind', 'stop');
              f.set('payload', { ...sp, call_sign: t.call_sign });
              stopsFeats.push(f);
            }
          }
          if (opts.showSpeedWarnings) {
            for (const sp of findSpeedWarnings(raw)) {
              const f = new Feature({ geometry: new Point(fromLonLat([sp.lng, sp.lat])) });
              f.set('kind', 'speed_warning');
              f.set('payload', { ...sp, call_sign: t.call_sign });
              warnFeats.push(f);
            }
          }
          if (opts.showHardBrakes) {
            for (const sp of findHardBrakes(raw)) {
              const f = new Feature({ geometry: new Point(fromLonLat([sp.lng, sp.lat])) });
              f.set('kind', 'hard_brake');
              f.set('payload', { ...sp, call_sign: t.call_sign });
              brakeFeats.push(f);
            }
          }
          if (opts.showStatusChanges) {
            for (const sp of findStatusChanges(raw)) {
              const f = new Feature({ geometry: new Point(fromLonLat([sp.lng, sp.lat])) });
              f.set('kind', 'status_change');
              f.set('payload', { ...sp, call_sign: t.call_sign });
              statusFeats.push(f);
            }
          }
          if (opts.showMilestones) {
            for (const mp of findMilestones(raw)) {
              const f = new Feature({ geometry: new Point(fromLonLat([mp.lng, mp.lat])) });
              f.setStyle(milestoneStyle(mp.mile, unitColor));
              f.set('kind', 'milestone');
              f.set('payload', { ...mp, call_sign: t.call_sign });
              milestoneFeats.push(f);
            }
          }
        }

        sourceRef.current.clear(); sourceRef.current.addFeatures(segFeats);
        pointSourceRef.current?.clear(); pointSourceRef.current?.addFeatures(pointFeats);
        stopsSourceRef.current?.clear(); stopsSourceRef.current?.addFeatures(stopsFeats);
        warnSourceRef.current?.clear(); warnSourceRef.current?.addFeatures(warnFeats);
        brakeSourceRef.current?.clear(); brakeSourceRef.current?.addFeatures(brakeFeats);
        statusSourceRef.current?.clear(); statusSourceRef.current?.addFeatures(statusFeats);
        arrowsSourceRef.current?.clear(); arrowsSourceRef.current?.addFeatures(arrowFeats);
        milestonesSourceRef.current?.clear(); milestonesSourceRef.current?.addFeatures(milestoneFeats);
        hullSourceRef.current?.clear(); hullSourceRef.current?.addFeatures(hullFeats);
        setSummariesState(computedSummaries);
      })
      .catch((err) => devWarn('[map-v2] breadcrumb trails fetch failed:', err));
    return () => { cancelled = true; };
  }, [
    opts.visible, hours, colorMode,
    opts.showStops, opts.showSpeedWarnings, opts.showHardBrakes,
    opts.showStatusChanges, opts.showArrows, opts.showMilestones, opts.showHull,
    opts.hourRangeFrom, opts.hourRangeTo, opts.hideOffDuty,
  ]);

  return { trails, summaries };
}
