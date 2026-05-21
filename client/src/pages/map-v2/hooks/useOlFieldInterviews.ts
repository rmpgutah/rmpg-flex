import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import StrokeStyle from 'ol/style/Stroke';
import FillStyle from 'ol/style/Fill';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';

interface FIRecord {
  id: number;
  fi_number: string;
  subject_first_name: string | null;
  subject_last_name: string | null;
  latitude: number;
  longitude: number;
  contact_reason?: string;
  officer_name?: string | null;
  created_at?: string;
  location?: string | null;
}

const FI_STYLE = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new FillStyle({ color: '#06b6d4cc' }),
    stroke: new StrokeStyle({ color: '#0a0a0a', width: 1 }),
  }),
});

/**
 * Field interview contact-card markers for /map-v2.
 *
 * Fetches /field-interviews/map?days=N and renders Point features at
 * the FI location. Cyan dots distinguish from unit markers (green) and
 * call markers (priority colors). Click to popup is wired through the
 * shared useOlLiveMarkers click handler — this hook just adds features
 * with kind='fi' + payload, and the popup builder picks it up.
 *
 * Wait — actually the popup builder is currently only wired for kind
 * unit/call. To keep this PR small, FI markers are visible-only here;
 * a follow-up extends the popup builder to handle 'fi' (showing
 * fi_number, subject name, officer, contact reason).
 */
export function useOlFieldInterviews(
  map: OlMap | null,
  opts: { visible: boolean; days?: number },
): void {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const days = opts.days ?? 30;

  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      visible: opts.visible,
      zIndex: 90, // just below live markers (100)
    });
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

  useEffect(() => {
    if (!opts.visible || !sourceRef.current) return;
    let cancelled = false;
    apiFetch<FIRecord[]>(`/field-interviews/map?days=${days}`)
      .then((data) => {
        if (cancelled || !sourceRef.current) return;
        const records = Array.isArray(data) ? data : [];
        const feats: Feature<Geometry>[] = [];
        for (const r of records) {
          if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
          const f = new Feature({ geometry: new Point(fromLonLat([r.longitude, r.latitude])) });
          f.setStyle(FI_STYLE);
          f.setId(`fi:${r.id}`);
          f.set('kind', 'fi');
          f.set('payload', r);
          feats.push(f);
        }
        sourceRef.current.clear();
        sourceRef.current.addFeatures(feats);
      })
      .catch((err) => devWarn('[map-v2] field interviews fetch failed:', err));
    return () => { cancelled = true; };
  }, [opts.visible, days]);
}
