import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';
import { whenStyleReady } from '../utils/safeAddSource';

interface EnforcementCluster {
  lat: number;
  lng: number;
  total: number;
  top_statutes: string;
  first_date: string;
  last_date: string;
}

interface UseMapEnforcementClustersReturn {
  clusters: EnforcementCluster[];
  loading: boolean;
  totalRecords: number;
}

const TYPE_COLORS: Record<string, string> = {
  citations: '#888888',
  arrests: '#dc2626',
  warnings: '#f59e0b',
};

export function useMapEnforcementClusters(
  map: mapboxgl.Map | null,
  enabled: boolean,
  type: 'citations' | 'arrests',
  days: number,
): UseMapEnforcementClustersReturn {
  const [clusters, setClusters] = useState<EnforcementCluster[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'enforcement-clusters';

  useEffect(() => {
    if (!enabled) {
      setClusters([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<EnforcementCluster[]>(`/dispatch/heatmap/enforcement?type=${type}&days=${days}`)
      .then((data) => {
        if (!cancelled) {
          setClusters(data || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[useMapEnforcementClusters] Enforcement data fetch failed:', err);
          setClusters([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled, type, days]);

  useEffect(() => {
    if (!map) return;

    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    if (!enabled || clusters.length === 0) return;

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const color = TYPE_COLORS[type] || '#888888';

    const features = clusters
      .filter((cluster) => cluster.lat != null && cluster.lng != null)
      .map((cluster) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [cluster.lng, cluster.lat] as [number, number] },
        properties: {
          total: cluster.total,
          top_statutes: cluster.top_statutes,
          first_date: cluster.first_date,
          last_date: cluster.last_date,
          radius: Math.max(100, Math.min(500, cluster.total * 30)),
        },
      }));

    if (features.length === 0) return;

    whenStyleReady(map, () => {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: sourceId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': color,
          'circle-radius': ['get', 'radius'],
          'circle-opacity': 0.2,
          'circle-stroke-color': color,
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.6,
        },
      });

      map.on('click', sourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const p = feature.properties;
        const statutes = p.top_statutes ? (p.top_statutes as string).split(',').slice(0, 5).join(', ') : 'N/A';
        const firstDate = p.first_date ? parseTimestamp(p.first_date as string).toLocaleDateString() : 'Unknown';
        const lastDate = p.last_date ? parseTimestamp(p.last_date as string).toLocaleDateString() : 'Unknown';
        const label = type === 'citations' ? 'Citation Cluster' : 'Arrest Cluster';

        const html = `
          <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
            <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">${label}</div>
            <table style="width:100%;font-size:11px;border-collapse:collapse">
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Count</td><td style="color:#e0e0e0">${p.total}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Top Statutes</td><td style="color:#e0e0e0">${statutes}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Date Range</td><td style="color:#e0e0e0">${firstDate} \u2014 ${lastDate}</td></tr>
            </table>
          </div>
        `;
        if (popupRef.current) {
          popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
        }
      });
    });

    return () => {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, enabled, clusters, type]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  const totalRecords = clusters.reduce((sum, c) => sum + c.total, 0);

  return { clusters, loading, totalRecords };
}
