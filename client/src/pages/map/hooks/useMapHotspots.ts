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

    interface Bucket { weight: number; lat: number; lng: number; count: number; address?: string }
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
      } else {
        buckets.set(key, { weight, lat: p.latitude, lng: p.longitude, count: 1, address: p.address });
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
      markersRef.current.push(marker);
    });

    return () => {
      // Teardown on deps change — same cleanup as top of effect so
      // we never leak markers. Idempotent because we overwrite the
      // ref immediately after.
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
    // mapInstanceRef is a mutable ref — stable identity but lint rule
    // disagrees. Adding it to the dep array would cause no-op reruns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, data, mode, topN, cellMeters]);
}
