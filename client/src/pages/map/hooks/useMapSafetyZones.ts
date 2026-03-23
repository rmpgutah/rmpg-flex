// ============================================================
// RMPG Flex — useMapSafetyZones Hook
// Auto-generated danger zone overlays based on incident data
// showing high and moderate risk areas.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

export interface SafetyZone {
  latitude: number;
  longitude: number;
  risk_level: 'high' | 'moderate';
  weapons_count: number;
  dv_count: number;
  injuries_count: number;
  total_flagged: number;
  last_incident: string;
}

interface UseMapSafetyZonesReturn {
  zones: SafetyZone[];
  loading: boolean;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapSafetyZones(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapSafetyZonesReturn {
  const [zones, setZones] = useState<SafetyZone[]>([]);
  const [loading, setLoading] = useState(false);

  const circlesRef = useRef<google.maps.Circle[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // ── Fetch safety zones ──────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      setZones([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<SafetyZone[]>('/dispatch/heatmap/safety-zones')
      .then((data) => {
        if (!cancelled) {
          setZones(data || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setZones([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled]);

  // ── Render circles ──────────────────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Clear existing
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    if (!enabled || zones.length === 0) return;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    zones.forEach((zone) => {
      if (zone.latitude == null || zone.longitude == null) return;
      // Validate finite coordinates
      if (!isFinite(zone.latitude) || !isFinite(zone.longitude)) return;

      const isHigh = zone.risk_level === 'high';
      // Fix 59: zone type indicator (color by risk level)
      const color = isHigh ? '#dc2626' : '#f59e0b';
      const radius = isHigh ? 200 : 150;

      // Fix 61: scale zone opacity by severity (more flagged = more opaque)
      const severity = Math.min(1, zone.total_flagged / 20);
      const fillOpacity = 0.06 + severity * 0.15;
      const strokeOpacity = 0.3 + severity * 0.4;

      const circle = new google.maps.Circle({
        center: { lat: zone.latitude, lng: zone.longitude },
        radius,
        fillColor: color,
        fillOpacity,
        strokeColor: color,
        strokeWeight: isHigh ? 3 : 2,
        strokeOpacity,
        map,
        clickable: true,
        zIndex: 8,
      });

      // Fix 62: pulsing border on active (high-risk) safety zones
      if (isHigh) {
        let pulseOp = strokeOpacity;
        let dir = -1;
        const pulseInterval = setInterval(() => {
          pulseOp += dir * 0.04;
          if (pulseOp <= 0.2) { pulseOp = 0.2; dir = 1; }
          if (pulseOp >= 0.9) { pulseOp = 0.9; dir = -1; }
          circle.setOptions({ strokeOpacity: pulseOp });
        }, 500);
        (circle as any)._pulseInterval = pulseInterval;
      }

      circle.addListener('click', () => {
        const riskLabel = isHigh ? 'HIGH' : 'MODERATE';
        const lastDate = zone.last_incident
          ? new Date(zone.last_incident).toLocaleDateString()
          : 'Unknown';

        const container = document.createElement('div');
        container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a';

        const heading = document.createElement('div');
        heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
        heading.textContent = `${riskLabel} Risk Zone`;
        container.appendChild(heading);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

        const addRow = (lbl: string, val: string, valColor?: string) => {
          const tr = document.createElement('tr');
          const tdLabel = document.createElement('td');
          tdLabel.style.cssText = 'color:#6b7b8d;padding:1px 6px 1px 0';
          tdLabel.textContent = lbl;
          const tdVal = document.createElement('td');
          tdVal.style.cssText = `color:${valColor || '#e0e0e0'}`;
          tdVal.textContent = val;
          tr.appendChild(tdLabel);
          tr.appendChild(tdVal);
          table.appendChild(tr);
        };

        addRow('Weapons', String(zone.weapons_count), '#ef4444');
        addRow('DV Incidents', String(zone.dv_count), '#f59e0b');
        addRow('Injuries', String(zone.injuries_count), '#fb923c');
        addRow('Total Flagged', String(zone.total_flagged));
        addRow('Last Incident', lastDate);

        container.appendChild(table);

        infoWindowRef.current?.setContent(container);
        infoWindowRef.current?.setPosition({ lat: zone.latitude, lng: zone.longitude });
        infoWindowRef.current?.open(map);
      });

      circlesRef.current.push(circle);
    });

    return () => {
      circlesRef.current.forEach((c) => {
        // Fix 62: clean up pulse intervals
        if ((c as any)._pulseInterval) clearInterval((c as any)._pulseInterval);
        google.maps.event.clearInstanceListeners(c);
        c.setMap(null);
      });
      circlesRef.current = [];
    };
  }, [map, enabled, zones]);

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

  return { zones, loading };
}
