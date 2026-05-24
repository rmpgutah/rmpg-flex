// ============================================================
// RMPG Flex — useMapEnforcementClusters Hook
// Enforcement cluster overlays for citations and arrests,
// showing geographic concentration of enforcement activity.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Color config ───────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  citations: '#888888',
  arrests: '#dc2626',
  warnings: '#f59e0b',
};

// ─── Hook ───────────────────────────────────────────────────

export function useMapEnforcementClusters(
  map: mapboxgl.Map | null,
  enabled: boolean,
  type: 'citations' | 'arrests',
  days: number,
): UseMapEnforcementClustersReturn {
  const [clusters, setClusters] = useState<EnforcementCluster[]>([]);
  const [loading, setLoading] = useState(false);

  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  // ── Fetch enforcement data ────────────────────────────────

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

  // ── Render circles ────────────────────────────────────────

  useEffect(() => {
    if (!map) return;

    // Clear existing
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!enabled || clusters.length === 0) return;

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 });
    }

    const color = TYPE_COLORS[type] || '#888888';

    clusters.forEach((cluster) => {
      if (cluster.lat == null || cluster.lng == null) return;

      const radiusPx = Math.max(10, Math.min(50, cluster.total * 3));

      const el = document.createElement('div');
      el.style.cssText = `
        width: ${radiusPx * 2}px;
        height: ${radiusPx * 2}px;
        border-radius: 50%;
        background: ${color}33;
        border: 2px solid ${color};
        cursor: pointer;
      `;
      el.style.zIndex = '7';

      el.addEventListener('click', () => {
        const label = type === 'citations' ? 'Citation Cluster' : 'Arrest Cluster';
        const statutes = cluster.top_statutes
          ? cluster.top_statutes.split(',').slice(0, 5).join(', ')
          : 'N/A';
        const firstDate = cluster.first_date
          ? new Date(cluster.first_date).toLocaleDateString()
          : 'Unknown';
        const lastDate = cluster.last_date
          ? new Date(cluster.last_date).toLocaleDateString()
          : 'Unknown';

        const container = document.createElement('div');
        container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222';

        const heading = document.createElement('div');
        heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
        heading.textContent = label;
        container.appendChild(heading);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

        const addRow = (lbl: string, val: string) => {
          const tr = document.createElement('tr');
          const tdLabel = document.createElement('td');
          tdLabel.style.cssText = 'color:#888888;padding:1px 6px 1px 0';
          tdLabel.textContent = lbl;
          const tdVal = document.createElement('td');
          tdVal.style.cssText = 'color:#e0e0e0';
          tdVal.textContent = val;
          tr.appendChild(tdLabel);
          tr.appendChild(tdVal);
          table.appendChild(tr);
        };

        addRow('Count', String(cluster.total));
        addRow('Top Statutes', statutes);
        addRow('Date Range', `${firstDate} \u2014 ${lastDate}`);

        container.appendChild(table);

        popupRef.current?.setLngLat([cluster.lng, cluster.lat]).setDOMContent(container).addTo(map);
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([cluster.lng, cluster.lat])
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [map, enabled, clusters, type]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  const totalRecords = clusters.reduce((sum, c) => sum + c.total, 0);

  return { clusters, loading, totalRecords };
}
