// ============================================================
// RMPG Flex — useMapEnforcementClusters Hook
// Enforcement cluster overlays for citations and arrests,
// showing geographic concentration of enforcement activity.
// ============================================================

import { useEffect, useRef, useState } from 'react';
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
// Fix 70: color code by enforcement type (citations vs arrests vs warnings)

const TYPE_COLORS: Record<string, string> = {
  citations: '#3b82f6',   // blue
  arrests: '#dc2626',     // red
  warnings: '#f59e0b',    // amber
};

// ─── Hook ───────────────────────────────────────────────────

export function useMapEnforcementClusters(
  map: google.maps.Map | null,
  enabled: boolean,
  type: 'citations' | 'arrests',
  days: number,
): UseMapEnforcementClustersReturn {
  const [clusters, setClusters] = useState<EnforcementCluster[]>([]);
  const [loading, setLoading] = useState(false);

  const circlesRef = useRef<google.maps.Circle[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

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
      .catch(() => {
        if (!cancelled) {
          setClusters([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled, type, days]);

  // ── Render circles ────────────────────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Clear existing
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    if (!enabled || clusters.length === 0) return;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    const color = TYPE_COLORS[type] || '#3b82f6';

    clusters.forEach((cluster) => {
      if (cluster.lat == null || cluster.lng == null) return;

      const radius = Math.max(100, Math.min(500, cluster.total * 30));

      const circle = new google.maps.Circle({
        center: { lat: cluster.lat, lng: cluster.lng },
        radius,
        fillColor: color,
        fillOpacity: 0.2,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 0.6,
        map,
        clickable: true,
        zIndex: 7,
      });

      circle.addListener('click', () => {
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
        container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a';

        const heading = document.createElement('div');
        heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
        heading.textContent = label;
        container.appendChild(heading);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

        const addRow = (lbl: string, val: string) => {
          const tr = document.createElement('tr');
          const tdLabel = document.createElement('td');
          tdLabel.style.cssText = 'color:#6b7b8d;padding:1px 6px 1px 0';
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
        addRow('Date Range', `${firstDate} — ${lastDate}`);

        container.appendChild(table);

        infoWindowRef.current?.setContent(container);
        infoWindowRef.current?.setPosition({ lat: cluster.lat, lng: cluster.lng });
        infoWindowRef.current?.open(map);
      });

      circlesRef.current.push(circle);
    });

    return () => {
      circlesRef.current.forEach((c) => {
        google.maps.event.clearInstanceListeners(c);
        c.setMap(null);
      });
      circlesRef.current = [];
    };
  }, [map, enabled, clusters, type]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
    };
  }, []);

  const totalRecords = clusters.reduce((sum, c) => sum + c.total, 0);

  return { clusters, loading, totalRecords };
}
