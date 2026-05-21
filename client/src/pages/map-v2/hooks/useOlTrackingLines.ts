import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import RegularShape from 'ol/style/RegularShape';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import { devWarn } from '../../../utils/devLog';
import { PRIORITY_HEX } from '../../../utils/statusColors';
import type { Unit, CallForService, CallPriority } from '../../../types';

/**
 * Tracking lines connecting each dispatched unit to its assigned call.
 *
 * For every unit whose current_call_id resolves to a call with a known
 * lat/lng, draw a dashed LineString from the unit position to the call
 * position. Color matches the call's priority so dispatchers can see
 * at a glance which units are responding to P1s vs lower priorities.
 *
 * Refetches via the same WS-driven debounce as useOlLiveMarkers so the
 * lines stay in sync with unit movement and call assignment changes.
 * z=45 (above breadcrumbs at 40, below drawing at 50).
 */
export function useOlTrackingLines(map: OlMap | null, opts: { visible: boolean }): void {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const { subscribe } = useWebSocket();

  // Mount once
  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({ source, visible: opts.visible, zIndex: 45 });
    layerRef.current = layer;
    map.addLayer(layer);
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(opts.visible);
  }, [opts.visible]);

  // Refetch whenever the layer becomes visible or any dispatch event fires.
  useEffect(() => {
    if (!opts.visible || !sourceRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refetch = async () => {
      if (!sourceRef.current) return;
      try {
        const [callsRes, unitsRes] = await Promise.all([
          apiFetch<any>('/dispatch/calls?limit=200'),
          apiFetch<Unit[]>('/dispatch/units'),
        ]);
        if (cancelled || !sourceRef.current) return;
        const callsRaw: any[] = Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : [];
        // Index calls by id for quick lookup
        const callsById = new Map<string, CallForService>();
        for (const c of callsRaw) callsById.set(String(c.id), c as CallForService);

        const feats: Feature<Geometry>[] = [];
        for (const u of (unitsRes || [])) {
          if (!u.current_call_id) continue;
          if (u.latitude == null || u.longitude == null) continue;
          const c = callsById.get(String(u.current_call_id));
          if (!c || c.latitude == null || c.longitude == null) continue;
          const color = PRIORITY_HEX[c.priority as CallPriority] || '#888888';
          const f = new Feature({
            geometry: new LineString([
              fromLonLat([u.longitude, u.latitude]),
              fromLonLat([c.longitude, c.latitude]),
            ]),
          });
          // Compute heading from unit→call so the arrowhead points the
          // direction of dispatch (where the unit is heading).
          const dx = c.longitude - u.longitude;
          const dy = c.latitude - u.latitude;
          const headingRad = Math.atan2(dx, dy); // 0 = north
          const lineFeature = f;
          lineFeature.setStyle(new Style({
            stroke: new Stroke({ color, width: 1.5, lineDash: [4, 4] }),
          }));
          feats.push(lineFeature);
          // Arrowhead at the call (destination) end
          const arrow = new Feature({
            geometry: new Point(fromLonLat([c.longitude, c.latitude])),
          });
          arrow.setStyle(new Style({
            image: new RegularShape({
              points: 3,
              radius: 6,
              rotation: headingRad,
              fill: new Fill({ color }),
              stroke: new Stroke({ color: '#0a0a0a', width: 1 }),
            }),
          }));
          feats.push(arrow);
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      } catch (err) {
        devWarn('[map-v2] tracking lines refetch failed:', err);
      }
    };

    refetch();
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refetch, 1000);
    };
    const unsubUnit = subscribe('unit_update', debounced);
    const unsubDispatch = subscribe('dispatch_update', debounced);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubUnit();
      unsubDispatch();
    };
  }, [opts.visible, subscribe]);
}
