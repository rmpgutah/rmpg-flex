// ============================================================
// RMPG Flex — useMapPredictions Hook
// Predictive hotspot zones — renders circles on the map for
// areas with high predicted incident activity.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

export interface PredictedHotspot {
  latitude: number;
  longitude: number;
  score: number;
  incident_count: number;
  top_types: string;
  weapons_count: number;
  dv_count: number;
}

interface UseMapPredictionsReturn {
  hotspots: PredictedHotspot[];
  loading: boolean;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapPredictions(
  map: google.maps.Map | null,
  enabled: boolean,
  shift?: 'day' | 'swing' | 'night',
): UseMapPredictionsReturn {
  const [hotspots, setHotspots] = useState<PredictedHotspot[]>([]);
  const [loading, setLoading] = useState(false);

  const circlesRef = useRef<google.maps.Circle[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // ── Fetch predictions ───────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      setHotspots([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const qs = shift ? `?shift=${shift}` : '';
    apiFetch<PredictedHotspot[]>(`/dispatch/heatmap/predictions${qs}`)
      .then((data) => {
        if (!cancelled) {
          setHotspots(data || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHotspots([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled, shift]);

  // ── Render circles ──────────────────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Clear existing
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    if (!enabled || hotspots.length === 0) return;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    hotspots.forEach((hs) => {
      if (hs.latitude == null || hs.longitude == null) return;

      const isHigh = hs.score > 50;
      const color = isHigh ? '#dc2626' : '#f59e0b';

      const circle = new google.maps.Circle({
        center: { lat: hs.latitude, lng: hs.longitude },
        radius: 200,
        fillColor: color,
        fillOpacity: 0.15,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 0.6,
        map,
        clickable: true,
        zIndex: 10,
      });

      circle.addListener('click', () => {
        const html = `
          <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a">
            <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">
              Predicted Hotspot
            </div>
            <table style="width:100%;font-size:11px;border-collapse:collapse">
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Score</td><td style="font-weight:bold;color:#fff">${hs.score}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Incidents</td><td style="color:#e0e0e0">${hs.incident_count}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Top Types</td><td style="color:#e0e0e0">${hs.top_types || '—'}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Weapons</td><td style="color:#ef4444">${hs.weapons_count}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">DV</td><td style="color:#f59e0b">${hs.dv_count}</td></tr>
            </table>
          </div>
        `;
        infoWindowRef.current?.setContent(html);
        infoWindowRef.current?.setPosition({ lat: hs.latitude, lng: hs.longitude });
        infoWindowRef.current?.open(map);
      });

      circlesRef.current.push(circle);
    });

    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
    };
  }, [map, enabled, hotspots]);

  // ── Cleanup on unmount ──────────────────────────────────

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

  return { hotspots, loading };
}
