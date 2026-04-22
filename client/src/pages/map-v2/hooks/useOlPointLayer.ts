import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Cluster from 'ol/source/Cluster';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import StrokeStyle from 'ol/style/Stroke';
import FillStyle from 'ol/style/Fill';
import TextStyle from 'ol/style/Text';
import { fromLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';

export interface OlPointLayerOptions<T> {
  /** Whether the layer is visible (cheap toggle, no refetch) */
  visible: boolean;
  /** API endpoint to fetch from */
  url: string;
  /** Z-index (default 85: above tactical, below live unit/call markers) */
  zIndex?: number;
  /** Marker fill color (hex with optional alpha) */
  color: string;
  /** Marker radius in px (default 5) */
  radius?: number;
  /** Stable feature kind tag set on each feature for click handlers */
  kind: string;
  /** Map a row to (lat, lng) — return null to skip */
  extractCoords: (row: T) => { lat: number; lng: number } | null;
  /** Optional log tag for debug warnings */
  debugTag?: string;
  /** Optional adapter to extract the row array from an envelope response.
   *  Default: treat the response as the array directly. */
  extractRows?: (raw: any) => T[];
  /** Enable cluster bubbling at low zoom. Default false.
   *  Pass `{ distance: 50 }` to override pixel distance. */
  cluster?: boolean | { distance?: number };
}

/**
 * Generic point-marker overlay for /map-v2.
 *
 * Pattern shared by FI, incident reports, patrol checkpoints, fleet
 * vehicles, etc — fetch a list endpoint, render Point features with a
 * solid color circle, toggle visibility cheaply, refetch when params
 * change.
 *
 * When `cluster: true` is passed, points are grouped via ol/source/Cluster
 * by pixel distance. Cluster bubbles render with a count label and scale
 * with size; clicking a cluster zooms the map to fit. Singletons fall
 * through to the underlying point style.
 *
 * Each rendered feature carries kind + payload props so the shared
 * useOlFeaturePopup hook surfaces details on click.
 */
export function useOlPointLayer<T>(map: OlMap | null, opts: OlPointLayerOptions<T>): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const clusterEnabled = !!opts.cluster;
  const clusterDistance = (typeof opts.cluster === 'object' && opts.cluster?.distance) || 50;

  const pointStyle = new Style({
    image: new CircleStyle({
      radius: opts.radius ?? 5,
      fill: new FillStyle({ color: opts.color }),
      stroke: new StrokeStyle({ color: '#0a0a0a', width: 1 }),
    }),
  });

  // Mount once
  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;

    const layerSource = clusterEnabled
      ? new Cluster({ distance: clusterDistance, source })
      : source;

    const layer = new VectorLayer({
      source: layerSource,
      style: clusterEnabled
        ? (feature: any) => {
            const inner = feature.get('features') as Feature<Geometry>[] | undefined;
            const count = inner ? inner.length : 1;
            if (count <= 1) {
              // Singleton — pass through the underlying point style.
              return inner?.[0]?.getStyle() as Style | undefined ?? pointStyle;
            }
            // Cluster bubble: radius scales 12-24 with count.
            const r = Math.min(24, 12 + Math.log2(count) * 3);
            return new Style({
              image: new CircleStyle({
                radius: r,
                fill: new FillStyle({ color: `${opts.color.slice(0, 7)}cc` }),
                stroke: new StrokeStyle({ color: '#0a0a0a', width: 2 }),
              }),
              text: new TextStyle({
                text: String(count),
                font: '700 11px ui-monospace, monospace',
                fill: new FillStyle({ color: '#0a0a0a' }),
              }),
            });
          }
        : pointStyle,
      visible: opts.visible,
      zIndex: opts.zIndex ?? 85,
    });
    layerRef.current = layer;
    map.addLayer(layer);

    // Cluster click → zoom-to-fit. Only attached when clustering enabled
    // so non-clustered layers don't double-handle clicks.
    let clickKey: any = null;
    if (clusterEnabled) {
      const onClick = (evt: any) => {
        const feature = map.forEachFeatureAtPixel(
          evt.pixel,
          (f) => (f.get('features') ? f : undefined),
          { hitTolerance: 4, layerFilter: (l) => l === layer },
        );
        if (!feature) return;
        const inner = feature.get('features') as Feature<Geometry>[] | undefined;
        if (!inner || inner.length <= 1) return;
        // Compute the bounding extent of the underlying features and fit
        const coords: number[][] = [];
        for (const f of inner) {
          const g: any = f.getGeometry();
          if (g && typeof g.getCoordinates === 'function') {
            coords.push(g.getCoordinates());
          }
        }
        if (coords.length < 2) return;
        const ext = boundingExtent(coords);
        map.getView().fit(ext, { padding: [80, 80, 80, 80], duration: 400, maxZoom: 16 });
      };
      clickKey = map.on('click', onClick);
    }

    return () => {
      if (clickKey) map.un('click', clickKey.listener);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Visibility toggle
  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(opts.visible);
  }, [opts.visible]);

  // Fetch when visible (and on URL change)
  useEffect(() => {
    if (!opts.visible || !sourceRef.current) return;
    let cancelled = false;
    apiFetch<any>(opts.url)
      .then((data) => {
        if (cancelled || !sourceRef.current) return;
        const rows: T[] = opts.extractRows
          ? opts.extractRows(data)
          : (Array.isArray(data) ? data : []);
        const feats: Feature<Geometry>[] = [];
        for (const r of rows) {
          const coords = opts.extractCoords(r);
          if (!coords) continue;
          if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) continue;
          const f = new Feature({ geometry: new Point(fromLonLat([coords.lng, coords.lat])) });
          f.setStyle(pointStyle);
          f.set('kind', opts.kind);
          f.set('payload', r);
          feats.push(f);
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      })
      .catch((err) => devWarn(`[map-v2] ${opts.debugTag || opts.url} fetch failed:`, err));
    return () => { cancelled = true; };
  }, [opts.visible, opts.url]);
}
