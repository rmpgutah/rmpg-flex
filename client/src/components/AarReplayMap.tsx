// ============================================================
// AarReplayMap — Google Maps embed for AAR replay page
// ============================================================
// Shows the cruiser's gps_breadcrumbs as a polyline plus two
// markers:
//   - Pivot marker: the event location (gold for AAR consistency)
//   - Scrub marker: where the unit was at the current video time;
//     parent updates via prop, marker animates without re-rendering
//     the whole map
//
// Loads Google Maps via the existing shared loader so the dark
// theme + offline-tile behavior matches MapPage. Falls back
// gracefully on API-key-missing or load-failure.

import React, { useEffect, useRef, useState } from 'react';
import {
  loadGoogleMaps,
  DARK_MAP_STYLE,
  resolveGoogleMapsApiKey,
} from '../utils/googleMapsLoader';

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

export default function AarReplayMap({ pivot, breadcrumbs, scrubLat, scrubLng }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const pivotMarkerRef = useRef<google.maps.Marker | null>(null);
  const scrubMarkerRef = useRef<google.maps.Marker | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // ── Load + initialize map (once) ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiKey = await resolveGoogleMapsApiKey();
        if (!apiKey) {
          if (!cancelled) setError('Google Maps API key not configured');
          return;
        }
        await loadGoogleMaps(apiKey);
        if (cancelled || !containerRef.current) return;

        const center = pivot ?? (breadcrumbs[0]
          ? { lat: breadcrumbs[0].latitude, lng: breadcrumbs[0].longitude }
          : { lat: 40.76, lng: -111.89 }); // SLC fallback

        const map = new google.maps.Map(containerRef.current, {
          center,
          zoom: 16,
          styles: DARK_MAP_STYLE,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
          clickableIcons: false,
        });
        mapRef.current = map;
        setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Map load failed');
      }
    })();

    return () => { cancelled = true; };
    // Intentionally only run once — pivot/breadcrumbs handled in
    // separate effects below to avoid re-instantiating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Draw polyline + pivot marker + fit bounds when data changes ──
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;

    // Clean prior
    polylineRef.current?.setMap(null);
    polylineRef.current = null;
    pivotMarkerRef.current?.setMap(null);
    pivotMarkerRef.current = null;

    if (breadcrumbs.length >= 2) {
      polylineRef.current = new google.maps.Polyline({
        path: breadcrumbs.map(b => ({ lat: b.latitude, lng: b.longitude })),
        geodesic: true,
        strokeColor: '#d4a017', // RMPG gold
        strokeOpacity: 0.95,
        strokeWeight: 4,
        map,
        zIndex: 1,
      });
    }

    if (pivot) {
      pivotMarkerRef.current = new google.maps.Marker({
        position: pivot,
        map,
        title: 'Event location',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#dc2626', // alert red
          fillOpacity: 0.95,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 3,
      });
    }

    // Fit bounds to all points (track + pivot)
    if (breadcrumbs.length > 0 || pivot) {
      const bounds = new google.maps.LatLngBounds();
      for (const b of breadcrumbs) bounds.extend({ lat: b.latitude, lng: b.longitude });
      if (pivot) bounds.extend(pivot);
      map.fitBounds(bounds, 60); // 60px padding
      // If only one point, zoom is too tight — pull back
      if (breadcrumbs.length <= 1) map.setZoom(16);
    }
  }, [ready, pivot, breadcrumbs]);

  // ── Update scrub marker on every prop change ──────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;

    if (scrubLat == null || scrubLng == null) {
      scrubMarkerRef.current?.setMap(null);
      scrubMarkerRef.current = null;
      return;
    }

    if (!scrubMarkerRef.current) {
      scrubMarkerRef.current = new google.maps.Marker({
        position: { lat: scrubLat, lng: scrubLng },
        map,
        title: 'Unit position at video time',
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: '#22c55e', // green = "live cursor"
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 4,
      });
    } else {
      scrubMarkerRef.current.setPosition({ lat: scrubLat, lng: scrubLng });
    }
  }, [ready, scrubLat, scrubLng]);

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      polylineRef.current?.setMap(null);
      pivotMarkerRef.current?.setMap(null);
      scrubMarkerRef.current?.setMap(null);
      mapRef.current = null;
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
