import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import { devWarn } from '../../../utils/devLog';

interface PanicAlert {
  id: number;
  user_id: number;
  officer_name?: string | null;
  officer_badge?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: 'active' | 'acknowledged' | 'resolved' | 'cancelled' | 'false_alarm' | 'escalated';
  created_at?: string;
  alert_type?: string | null;
}

const PANIC_STYLE = new Style({
  image: new CircleStyle({
    radius: 9,
    fill: new Fill({ color: '#ef4444' }),
    stroke: new Stroke({ color: '#fef2f2', width: 2 }),
  }),
});

/** Halo style is regenerated on each pulse-tick frame via setHaloPulse(). */
function makeHaloStyle(radius: number, opacity: number): Style {
  // Hex alpha 00-FF from 0..1 opacity
  const a = Math.max(0, Math.min(255, Math.round(opacity * 255))).toString(16).padStart(2, '0');
  return new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color: `#ef4444${Math.round(opacity * 0x33).toString(16).padStart(2, '0')}` }),
      stroke: new Stroke({ color: `#ef4444${a}`, width: 1.5 }),
    }),
  });
}

/**
 * Active panic-alert overlay for /map-v2.
 *
 * Fetches /dispatch/panic/active on first visibility (admin/supervisor/
 * manager/dispatcher only — protected by requireRole on the server),
 * then listens for live updates via WS:
 *   - panic_alert:           new active panic
 *   - panic_acknowledged:    state change
 *   - panic_resolved/cancelled/false_alarm/escalated: removal triggers
 *
 * Each active alert renders as a red CircleStyle with a translucent
 * halo for visibility against busy maps. z=110 (above live unit/call
 * markers) so panic alerts are always on top.
 *
 * Click opens the shared popup with kind='panic' (registered in
 * useOlFeaturePopup). Acknowledged alerts dim slightly.
 */
export function useOlAlerts(map: OlMap | null, opts: { visible: boolean }): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const haloLayerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const haloSourceRef = useRef<VectorSource | null>(null);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (!map || layerRef.current) return;
    const haloSource = new VectorSource();
    haloSourceRef.current = haloSource;
    const haloLayer = new VectorLayer({ source: haloSource, style: makeHaloStyle(14, 0.55), visible: opts.visible, zIndex: 109 });
    haloLayerRef.current = haloLayer;
    map.addLayer(haloLayer);

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({ source, style: PANIC_STYLE, visible: opts.visible, zIndex: 110 });
    layerRef.current = layer;
    map.addLayer(layer);

    // Pulse loop: oscillate halo radius 14↔22, opacity 0.6↔0.15, ~1.2 Hz
    const startMs = Date.now();
    const tick = () => {
      if (!haloLayerRef.current) return;
      const t = (Date.now() - startMs) / 1000;
      const phase = (Math.sin(t * 2 * Math.PI / 0.85) + 1) / 2; // 0..1, ~1.2Hz
      const radius = 14 + phase * 8;
      const opacity = 0.55 - phase * 0.4;
      haloLayerRef.current.setStyle(makeHaloStyle(radius, Math.max(0.1, opacity)));
    };
    const pulseTimer = setInterval(tick, 60);

    return () => {
      clearInterval(pulseTimer);
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
      if (haloLayerRef.current) { map.removeLayer(haloLayerRef.current); haloLayerRef.current = null; }
      sourceRef.current = null;
      haloSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.setVisible(opts.visible);
    if (haloLayerRef.current) haloLayerRef.current.setVisible(opts.visible);
  }, [opts.visible]);

  useEffect(() => {
    if (!opts.visible) return;
    let cancelled = false;

    const renderAll = (panics: PanicAlert[]) => {
      const source = sourceRef.current;
      const halo = haloSourceRef.current;
      if (!source || !halo) return;
      source.clear();
      halo.clear();
      for (const p of panics) {
        if (p.latitude == null || p.longitude == null) continue;
        const coord = fromLonLat([p.longitude, p.latitude]);
        const haloFeat = new Feature({ geometry: new Point(coord) });
        halo.addFeature(haloFeat);
        const f = new Feature({ geometry: new Point(coord) });
        f.setId(`panic:${p.id}`);
        f.set('kind', 'panic');
        f.set('payload', p);
        source.addFeature(f);
      }
    };

    apiFetch<PanicAlert[]>('/dispatch/panic/active')
      .then((panics) => { if (!cancelled) renderAll(Array.isArray(panics) ? panics : []); })
      .catch((err) => devWarn('[map-v2] panic/active fetch failed:', err));

    // Refetch on any panic-related event (debounced)
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        apiFetch<PanicAlert[]>('/dispatch/panic/active')
          .then((panics) => { if (!cancelled) renderAll(Array.isArray(panics) ? panics : []); })
          .catch(() => { /* swallow — already showing what we have */ });
      }, 500);
    };
    const unsubs = [
      subscribe('panic_alert', debounced),
      subscribe('panic_acknowledged', debounced),
      subscribe('panic_resolved', debounced),
      subscribe('panic_cancelled', debounced),
      subscribe('panic_false_alarm', debounced),
      subscribe('panic_escalated', debounced),
    ];

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubs.forEach((u) => u());
    };
  }, [opts.visible, subscribe]);
}
