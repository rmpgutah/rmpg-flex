// ============================================================
// AarReplayMap — Mapbox GL embed for AAR replay page
// ============================================================
// Shows the cruiser's gps_breadcrumbs as a polyline plus two
// markers:
//   - Pivot marker: the event location (red circle)
//   - Scrub marker: where the unit was at the current video time;
//     parent updates via prop, marker animates without re-rendering
//     the whole map
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { createMapboxMap, addMapboxTrail, removeMapboxTrail, injectMapboxStyles } from '../utils/mapboxLoader';
import { getMapboxToken } from '../utils/mapboxApiKey';

export interface AarMapBreadcrumb {
  recorded_at: string;
  latitude: number;
  longitude: number;
}

interface Props {
  /** Event location — anchor + camera focus when no breadcrumbs */
  pivot: { lat: number; lng: number } | null;
  /** Track points; ordered oldest → newest */
  breadcrumbs: AarMapBreadcrumb[];
  /** Live position from video onTimeUpdate; null = no scrub marker */
  scrubLat: number | null;
  scrubLng: number | null;
}

const TRAIL_ID = 'aar-breadcrumb-trail';

/** Create a circle marker element */
function createCircleEl(color: string, size: number, borderColor = '#fff', borderWidth = 2): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${borderWidth}px solid ${borderColor};box-shadow:0 0 6px ${color}80;`;
  return el;
}

/** Create an arrow marker element */
function createArrowEl(color: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid ${color};filter:drop-shadow(0 0 4px ${color}80);`;
  return el;
}

export default function AarReplayMap({ pivot, breadcrumbs, scrubLat, scrubLng }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pivotMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const scrubMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // ── Load + initialize map (once) ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getMapboxToken();
        if (!token) {
          if (!cancelled) setError('Mapbox access token not configured');
          return;
        }
        if (cancelled || !containerRef.current) return;

        injectMapboxStyles();

        const center: [number, number] = pivot
          ? [pivot.lng, pivot.lat]
          : breadcrumbs[0]
            ? [breadcrumbs[0].longitude, breadcrumbs[0].latitude]
            : [-111.89, 40.76]; // SLC fallback

        const map = createMapboxMap({
          container: containerRef.current,
          center,
          zoom: 16,
          accessToken: token,
        });
        mapRef.current = map;

        map.on('load', () => {
          if (!cancelled) setReady(true);
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Map load failed');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Draw polyline + pivot marker + fit bounds when data changes ──
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;

    // Clean prior trail
    removeMapboxTrail(map, TRAIL_ID);
    pivotMarkerRef.current?.remove();
    pivotMarkerRef.current = null;

    if (breadcrumbs.length >= 2) {
      const coords: [number, number][] = breadcrumbs.map(b => [b.longitude, b.latitude]);
      addMapboxTrail(map, TRAIL_ID, coords, '#d4a017', 4);
    }

    if (pivot) {
      pivotMarkerRef.current = new mapboxgl.Marker({ element: createCircleEl('#dc2626', 18) })
        .setLngLat([pivot.lng, pivot.lat])
        .addTo(map);
    }

    // Fit bounds to all points (track + pivot)
    if (breadcrumbs.length > 0 || pivot) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const b of breadcrumbs) bounds.extend([b.longitude, b.latitude]);
      if (pivot) bounds.extend([pivot.lng, pivot.lat]);
      map.fitBounds(bounds, { padding: 60 });
      // If only one point, zoom is too tight — pull back
      if (breadcrumbs.length <= 1) map.setZoom(16);
    }
  }, [ready, pivot, breadcrumbs]);

  // ── Update scrub marker on every prop change ──────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;

    if (scrubLat == null || scrubLng == null) {
      scrubMarkerRef.current?.remove();
      scrubMarkerRef.current = null;
      return;
    }

    if (!scrubMarkerRef.current) {
      scrubMarkerRef.current = new mapboxgl.Marker({ element: createArrowEl('#22c55e') })
        .setLngLat([scrubLng, scrubLat])
        .addTo(map);
    } else {
      scrubMarkerRef.current.setLngLat([scrubLng, scrubLat]);
    }
  }, [ready, scrubLat, scrubLng]);

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      pivotMarkerRef.current?.remove();
      scrubMarkerRef.current?.remove();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-rmpg-500 text-[11px] p-4 bg-surface-sunken border border-[#222]">
        Map unavailable — {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-surface-sunken" aria-label="AAR replay map" />
  );
}
