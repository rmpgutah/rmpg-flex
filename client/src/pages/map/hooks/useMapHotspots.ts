import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  count?: number;
  risk_weight?: number;
  address?: string;
}

interface UseMapHotspotsParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  data: HeatmapPoint[];
  enabled: boolean;
  mode?: 'calls' | 'risk';
  topN?: number;
  cellMeters?: number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) { case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;'; case '"': return '&quot;'; case "'": return '&#39;'; default: return c; }
  });
}

function metersToDeg(meters: number, atLat: number): { lat: number; lng: number } {
  const latDeg = meters / 111320;
  const lngDeg = meters / (111320 * Math.cos((atLat * Math.PI) / 180));
  return { lat: latDeg, lng: lngDeg };
}

export function useMapHotspots({
  mapInstanceRef,
  data,
  enabled,
  mode = 'calls',
  topN = 5,
  cellMeters = 150,
}: UseMapHotspotsParams) {
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!map || !enabled || !data || data.length === 0) return;

    const anchorLat = 40.5;
    const { lat: cellLat, lng: cellLng } = metersToDeg(cellMeters, anchorLat);

    interface Bucket {
      weight: number;
      lat: number;
      lng: number;
      count: number;
      members: HeatmapPoint[];
    }
    const buckets = new Map<string, Bucket>();

    for (const p of data) {
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
      const yKey = Math.floor(p.latitude / cellLat);
      const xKey = Math.floor(p.longitude / cellLng);
      const key = `${yKey}:${xKey}`;
      const weight = mode === 'risk' ? (p.risk_weight ?? p.count ?? 1) : (p.count ?? 1);
      const existing = buckets.get(key);
      if (existing) {
        const totalWeight = existing.weight + weight;
        existing.lat = (existing.lat * existing.weight + p.latitude * weight) / totalWeight;
        existing.lng = (existing.lng * existing.weight + p.longitude * weight) / totalWeight;
        existing.weight = totalWeight;
        existing.count += 1;
        existing.members.push(p);
      } else {
        buckets.set(key, { weight, lat: p.latitude, lng: p.longitude, count: 1, members: [p] });
      }
    }

    const peaks = [...buckets.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, topN);

    peaks.forEach((peak, idx) => {
      const rank = idx + 1;
      const el = document.createElement('div');
      el.style.cssText = `
        width: 28px; height: 28px;
        background: #ef4444;
        border: 2px solid #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 12px;
        font-weight: 900;
        font-family: 'JetBrains Mono', 'Courier New', monospace;
        cursor: pointer;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      `;
      el.textContent = String(rank);
      el.title = `Hotspot #${rank}: ${peak.count} event${peak.count === 1 ? '' : 's'} (weight ${peak.weight.toFixed(0)})`;

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([peak.lng, peak.lat])
        .addTo(map);

      el.addEventListener('click', () => {
        const addresses = peak.members
          .map((m) => (m.address || '').trim())
          .filter((a) => a.length > 0);
        const addrCounts = new Map<string, number>();
        for (const a of addresses) addrCounts.set(a, (addrCounts.get(a) || 0) + 1);
        const topAddrs = [...addrCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        const addrHtml = topAddrs.length
          ? topAddrs.map(([a, n]) =>
              `<div style="font-size:10px;color:#d1d5db;display:flex;justify-content:space-between;gap:8px;padding:1px 0;">
                 <span style="text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">${escapeHtml(a)}</span>
                 <span style="color:#6b7280;flex-shrink:0;">×${n}</span>
               </div>`
            ).join('')
          : `<div style="font-size:10px;color:#6b7280;font-style:italic;">No street addresses in this cluster's payload.</div>`;

        new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '300px', offset: 15 })
          .setLngLat([peak.lng, peak.lat])
          .setHTML(
            `<div style="font-family:'JetBrains Mono','Courier New',monospace;background:#0c0c0c;color:#e5e7eb;padding:8px 12px;min-width:220px;max-width:300px;border:1px solid #ef4444;">
               <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                 <span style="background:#ef4444;color:#fff;padding:1px 6px;font-size:10px;font-weight:900;border-radius:2px;">#${rank}</span>
                 <span style="font-size:11px;font-weight:900;color:#ef4444;letter-spacing:0.1em;">HOTSPOT</span>
               </div>
               <div style="font-size:10px;color:#9ca3af;margin-bottom:6px;">
                 ${peak.count} event${peak.count === 1 ? '' : 's'} · weight ${peak.weight.toFixed(0)}
               </div>
               <div style="border-top:1px solid #2b2b2b;padding-top:6px;">
                 <div style="font-size:8px;color:#5a6e80;font-weight:900;letter-spacing:0.15em;margin-bottom:4px;">TOP ADDRESSES</div>
                 ${addrHtml}
               </div>
             </div>`
          )
          .addTo(map);
      });

      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, data, mode, topN, cellMeters]);
}