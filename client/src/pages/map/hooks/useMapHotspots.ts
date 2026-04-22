// ============================================================
// RMPG Flex — useMapHotspots
// Renders numbered pins at the top-N peaks of the current
// heatmap dataset. The heatmap itself shows "there's activity
// here"; the hotspots label the strongest points so officers
// can patrol the highest-impact spots without eyeballing the
// blob.
//
// Peaks are found by spatially clustering raw heatmap points
// with a radius grid (~150m cells) and picking the top buckets
// by summed weight. This is way cheaper than a real k-means or
// DBSCAN for ≤10k points and gives stable results between
// renders. No server round-trip — reuses the data the heatmap
// layer already fetched.
// ============================================================

import { useEffect, useRef } from 'react';

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  count?: number;
  risk_weight?: number;
  address?: string;
}

interface UseMapHotspotsParams {
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  /** Heatmap dataset — typically the same array fed to HeatmapLayer */
  data: HeatmapPoint[];
  /** Whether to render the hotspot pins at all */
  enabled: boolean;
  /** Which weight field to sum when ranking peaks */
  mode?: 'calls' | 'risk';
  /** How many pins to show. 5 keeps the map readable; increasing is fine. */
  topN?: number;
  /** Grid cell size in meters. Larger = fewer, more spread-out peaks. */
  cellMeters?: number;
}

/** Minimal HTML escaper so user-supplied addresses can't break the
 *  info-window HTML. Same whitelist as the rest of the map page uses. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

/** Convert meters to approximate decimal degrees at a latitude. */
function metersToDeg(meters: number, atLat: number): { lat: number; lng: number } {
  // 111,320m per degree latitude everywhere; longitude shrinks with cos(lat).
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
  // Keep rendered marker refs so we can clear between renders.
  const markersRef = useRef<google.maps.Marker[]>([]);
  // Dedicated InfoWindow for drill-down — reused across clicks so we don't
  // leak windows if a dispatcher clicks several pins in quick succession.
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    const map = mapInstanceRef.current;

    // Always clear previous markers first; covers the case where
    // the hook re-runs with enabled=false or data=[] after having
    // been rendered.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (!map || !enabled || !data || data.length === 0) return;

    // ── 1. Grid-bucket raw points ──────────────────────────────
    //
    // We center the cell grid at Utah's rough middle latitude for
    // deterministic bucketing. Any fixed anchor works — the point
    // is that the same input produces the same bucket assignment
    // across renders.
    const anchorLat = 40.5;
    const { lat: cellLat, lng: cellLng } = metersToDeg(cellMeters, anchorLat);

    interface Bucket {
      weight: number;
      lat: number;
      lng: number;
      count: number;
      /** Raw points that fell into this cell — used for drill-down. */
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
        // Running weighted average of position so the pin sits at
        // the centroid of its cluster, not on an arbitrary point.
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

    // ── 2. Pick top-N buckets by summed weight ────────────────
    const peaks = [...buckets.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, topN);

    // ── 3. Render pins ─────────────────────────────────────────
    peaks.forEach((peak, idx) => {
      const rank = idx + 1;
      const marker = new google.maps.Marker({
        position: { lat: peak.lat, lng: peak.lng },
        map,
        zIndex: 1500, // Above beat polygons, below unit markers.
        icon: {
          // Inline SVG so the pin has the rank number baked in — no
          // dependency on icon fonts or asset files. Red circle with
          // white number is readable on both dark and light map styles.
          path: google.maps.SymbolPath.CIRCLE,
          scale: 14,
          fillColor: '#ef4444',
          fillOpacity: 0.95,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        } as google.maps.Symbol,
        label: {
          text: String(rank),
          color: '#ffffff',
          fontSize: '12px',
          fontWeight: '900',
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        },
        title: `Hotspot #${rank}: ${peak.count} event${peak.count === 1 ? '' : 's'} (weight ${peak.weight.toFixed(0)})`,
      });

      // Drill-down: click the pin to see a summary of what's in the cluster.
      // Top-5 unique addresses (if the server provided any) + overall count
      // and weight. No extra fetch — all data comes from the heatmap payload
      // we already have.
      marker.addListener('click', () => {
        const addresses = peak.members
          .map((m) => (m.address || '').trim())
          .filter((a) => a.length > 0);
        const addrCounts = new Map<string, number>();
        for (const a of addresses) addrCounts.set(a, (addrCounts.get(a) || 0) + 1);
        const topAddrs = [...addrCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        const addrHtml = topAddrs.length
          ? topAddrs
              .map(
                ([a, n]) =>
                  `<div style="font-size:10px;color:#d1d5db;display:flex;justify-content:space-between;gap:8px;padding:1px 0;">
                     <span style="text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">${escapeHtml(a)}</span>
                     <span style="color:#6b7280;flex-shrink:0;">×${n}</span>
                   </div>`,
              )
              .join('')
          : `<div style="font-size:10px;color:#6b7280;font-style:italic;">No street addresses in this cluster's payload.</div>`;

        if (!infoWindowRef.current) {
          infoWindowRef.current = new google.maps.InfoWindow();
        }
        infoWindowRef.current.setContent(
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
           </div>`,
        );
        infoWindowRef.current.setPosition({ lat: peak.lat, lng: peak.lng });
        infoWindowRef.current.open(map);
      });

      markersRef.current.push(marker);
    });

    return () => {
      // Teardown on deps change — same cleanup as top of effect so
      // we never leak markers. Idempotent because we overwrite the
      // ref immediately after.
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      // InfoWindow lives across renders; close it if open. Kept alive
      // so the same instance handles the next set of hotspot clicks.
      infoWindowRef.current?.close();
    };
    // mapInstanceRef is a mutable ref — stable identity but lint rule
    // disagrees. Adding it to the dep array would cause no-op reruns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, data, mode, topN, cellMeters]);
}
