// ============================================================
// RMPG Flex — useMapPredictions Hook
// Predictive hotspot zones — renders circles on the map for
// areas with high predicted incident activity.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { escapeHtml } from '../../../utils/sanitize';

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
    apiFetch<{ hotspots: PredictedHotspot[]; shift: string; total: number } | PredictedHotspot[]>(`/dispatch/heatmap/predictions${qs}`)
      .then((data) => {
        if (cancelled) return;
        // Handle both { hotspots: [...] } and [...] response formats
        const list = Array.isArray(data) ? data : (data?.hotspots || []);
        console.log(`[Predictions] Fetched ${list.length} hotspots`);
        setHotspots(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[Predictions] Fetch error:', err);
        setHotspots([]);
        setLoading(false);
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
      // Fix: validate finite coordinates
      if (!isFinite(hs.latitude) || !isFinite(hs.longitude)) return;

      const isHigh = hs.score > 50;
      const color = isHigh ? '#dc2626' : '#f59e0b';

      // Fix 54: confidence-based opacity (higher score = more opaque)
      const normalizedScore = Math.min(100, Math.max(0, hs.score));
      const fillOpacity = 0.08 + (normalizedScore / 100) * 0.2;
      const strokeOpacity = 0.3 + (normalizedScore / 100) * 0.5;

      // Fix 56: scale prediction circle radius based on hotspot data
      const radius = Math.max(150, Math.min(400, 150 + hs.incident_count * 10));

      const circle = new google.maps.Circle({
        center: { lat: hs.latitude, lng: hs.longitude },
        radius,
        fillColor: color,
        fillOpacity,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity,
        map,
        clickable: true,
        zIndex: 10,
      });

      // Fix 55: pulsing animation on high-confidence predictions
      if (isHigh && hs.score > 70) {
        let opacity = strokeOpacity;
        let dir = -1;
        const pulseInterval = setInterval(() => {
          opacity += dir * 0.04;
          if (opacity <= 0.2) { opacity = 0.2; dir = 1; }
          if (opacity >= 0.8) { opacity = 0.8; dir = -1; }
          circle.setOptions({ strokeOpacity: opacity });
        }, 600);
        // Store cleanup handle
        (circle as any)._pulseInterval = pulseInterval;
      }

      circle.addListener('click', () => {
        // Fix 58: format prediction scores as percentages in info window
        const pctScore = `${Math.round(normalizedScore)}%`;
        const html = `
          <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a">
            <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">
              Predicted Hotspot
            </div>
            <table style="width:100%;font-size:11px;border-collapse:collapse">
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Confidence</td><td style="font-weight:bold;color:#fff">${pctScore}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Raw Score</td><td style="color:#9ca3af">${hs.score}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Incidents</td><td style="color:#e0e0e0">${hs.incident_count}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Top Types</td><td style="color:#e0e0e0">${hs.top_types ? escapeHtml(hs.top_types) : '—'}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Weapons</td><td style="color:#ef4444">${hs.weapons_count}</td></tr>
              <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">DV</td><td style="color:#f59e0b">${hs.dv_count}</td></tr>
            </table>
          </div>
        `;
        infoWindowRef.current?.setContent(html);
        infoWindowRef.current?.setPosition({ lat: hs.latitude, lng: hs.longitude });
        infoWindowRef.current?.open(map);

        // Fix 57: click handler to zoom into prediction area
        map.panTo({ lat: hs.latitude, lng: hs.longitude });
        const currentZoom = map.getZoom();
        if (currentZoom != null && currentZoom < 14) {
          map.setZoom(14);
        }
      });

      circlesRef.current.push(circle);
    });

    return () => {
      circlesRef.current.forEach((c) => {
        // Fix 55: clean up pulse intervals
        if ((c as any)._pulseInterval) clearInterval((c as any)._pulseInterval);
        google.maps.event.clearInstanceListeners(c);
        c.setMap(null);
      });
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
