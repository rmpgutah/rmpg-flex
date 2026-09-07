import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  TACTICAL_INFO,
  TACTICAL_TEXT_PRIMARY,
} from '../utils/tacticalPalette';

interface GpsState {
  latitude: number | null;
  longitude: number | null;
  /** Raw compass heading from the device */
  heading: number | null;
  /** EMA-smoothed heading (preferred over raw) */
  headingSmoothed: number | null;
  /** GPS course-over-ground heading */
  course: number | null;
  accuracy: number | null;
  speed: number | null;
}

interface UseMapGpsOptions {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  selfPosVisible: boolean;
  gps: GpsState;
}

interface UseMapGpsResult {
  selfMarkerReady: boolean;
}

/**
 * Manages the officer's own GPS position marker on the Mapbox map.
 * Renders a directional arrow (when heading is available) or a pulsing dot,
 * plus an accuracy ring and speed readout label.
 */
export function useMapGps({
  map,
  mapLoaded,
  selfPosVisible,
  gps,
}: UseMapGpsOptions): UseMapGpsResult {
  const selfMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [selfMarkerReady, setSelfMarkerReady] = useState(false);

  // ── Create / update / remove self-position marker ──────────────────────────
  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!selfPosVisible || gps.latitude == null || gps.longitude == null) {
      selfMarkerRef.current?.remove();
      selfMarkerRef.current = null;
      setSelfMarkerReady(false);
      return;
    }

    const heading = gps.headingSmoothed ?? gps.course ?? gps.heading;
    const hasHeading = heading != null && Number.isFinite(heading);
    const speedMph = gps.speed != null ? Math.round(gps.speed * 2.237) : null;
    const accM = gps.accuracy;

    if (selfMarkerRef.current) {
      // Update existing marker position and visual state
      selfMarkerRef.current.setLngLat([gps.longitude, gps.latitude]);
      const el = selfMarkerRef.current.getElement();

      const arrow = el.querySelector<SVGSVGElement>('[data-role="self-arrow"]');
      if (arrow) arrow.style.transform = hasHeading ? `rotate(${heading}deg)` : 'rotate(0deg)';

      const dot = el.querySelector<HTMLElement>('[data-role="self-dot"]');
      if (dot) dot.style.display = hasHeading ? 'none' : 'block';
      if (arrow) arrow.style.display = hasHeading ? 'block' : 'none';

      const speedLabel = el.querySelector<HTMLElement>('[data-role="self-speed"]');
      if (speedLabel) {
        speedLabel.textContent = speedMph != null && speedMph > 0 ? `${speedMph}` : '';
        speedLabel.style.display = speedMph != null && speedMph > 0 ? 'block' : 'none';
      }

      const ring = el.querySelector<HTMLElement>('[data-role="self-accuracy"]');
      if (ring && accM != null && accM > 0) {
        const px = Math.min(80, Math.max(12, accM / 1.5));
        ring.style.width = ring.style.height = `${px * 2}px`;
        ring.style.marginLeft = ring.style.marginTop = `-${px}px`;
        ring.style.display = 'block';
      } else if (ring) {
        ring.style.display = 'none';
      }
    } else {
      // Build the marker element from scratch
      try {
        const el = document.createElement('div');
        el.className = 'rmpg-mbx-self';
        el.style.cssText =
          'display:flex;flex-direction:column;align-items:center;gap:1px;pointer-events:none;position:relative;';

        // Accuracy ring
        const ring = document.createElement('div');
        ring.setAttribute('data-role', 'self-accuracy');
        const accPx =
          accM != null && accM > 0 ? Math.min(80, Math.max(12, accM / 1.5)) : 20;
        // NOTE: uses var(--sev-info-rgb), never a literal blue hex/rgba, in this
        // inline style — the app's global "BLUE-KILLSWITCH" CSS (index.css) forces
        // any element whose raw style ATTRIBUTE TEXT contains a legacy blue
        // hex/rgba substring (e.g. "#3b82f6", "rgba(59,130,246") to a near-black
        // background with !important. A literal rgba() here silently turned this
        // translucent accuracy ring into a solid opaque black circle.
        ring.style.cssText = `
          position:absolute;top:50%;left:50%;
          width:${accPx * 2}px;height:${accPx * 2}px;
          margin-left:-${accPx}px;margin-top:-${accPx}px;
          border-radius:50%;background:rgb(var(--sev-info-rgb) / 0.10);
          border:1.5px solid rgb(var(--sev-info-rgb) / 0.25);
          pointer-events:none;z-index:0;
          animation:rmpg-pulse-ring 3s ease-in-out infinite;
        `;
        if (!accM || accM <= 0) ring.style.display = 'none';
        el.appendChild(ring);

        // Directional arrow (shown when heading is available)
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('data-role', 'self-arrow');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '28');
        svg.setAttribute('height', '28');
        svg.style.transform = hasHeading ? `rotate(${heading}deg)` : 'rotate(0deg)';
        svg.style.transition = 'transform 0.4s ease-out';
        // See ring's note above re: BLUE-KILLSWITCH — literal rgba() here would
        // let the killswitch grey out this filter (and the arrow's fill, via CSS
        // cascade) since it's still text inside the style attribute.
        svg.style.filter = 'drop-shadow(0 0 6px rgb(var(--sev-info-rgb) / 0.7))';
        svg.style.display = hasHeading ? 'block' : 'none';
        svg.style.position = 'relative';
        svg.style.zIndex = '2';
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M12 2 20 20 12 15 4 20Z');
        path.setAttribute('fill', TACTICAL_INFO);
        path.setAttribute('stroke', TACTICAL_TEXT_PRIMARY);
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        el.appendChild(svg);

        // Blue dot (shown when no heading available)
        const dot = document.createElement('div');
        dot.setAttribute('data-role', 'self-dot');
        // See ring's BLUE-KILLSWITCH note above — var(--sev-info*) here, never a
        // literal hex/rgba, or the killswitch forces this dot near-black.
        dot.style.cssText = `
          width:18px;height:18px;border-radius:50%;
          background:var(--sev-info);border:3px solid var(--text-primary);
          box-shadow:0 0 10px rgb(var(--sev-info-rgb) / 0.5), 0 0 20px rgb(var(--sev-info-rgb) / 0.25);
          animation:rmpg-pulse 2s ease-in-out infinite;
          position:relative;z-index:2;
        `;
        dot.style.display = hasHeading ? 'none' : 'block';
        el.appendChild(dot);

        // Speed readout label
        const speedEl = document.createElement('div');
        speedEl.setAttribute('data-role', 'self-speed');
        // See ring's BLUE-KILLSWITCH note above — var(--sev-info*) here, never a
        // literal hex/rgba, or the killswitch forces the border/text near-black.
        speedEl.style.cssText = `
          background:rgb(0 0 0 / 0.75);border:1px solid rgb(var(--sev-info-rgb) / 0.5);
          border-radius:2px;padding:0 4px;
          font:700 9px/13px ui-monospace,monospace;color:var(--sev-info);
          white-space:nowrap;position:relative;z-index:2;
        `;
        speedEl.textContent = speedMph != null && speedMph > 0 ? `${speedMph}` : '';
        speedEl.style.display = speedMph != null && speedMph > 0 ? 'block' : 'none';
        el.appendChild(speedEl);

        selfMarkerRef.current = new mapboxgl.Marker({ element: el, occludedOpacity: 1 })
          .setLngLat([gps.longitude, gps.latitude])
          .addTo(map);
        setSelfMarkerReady(true);
      } catch (err) {
        console.error('[useMapGps] failed to create self-position marker', err);
      }
    }
  }, [
    map,
    mapLoaded,
    selfPosVisible,
    gps.latitude,
    gps.longitude,
    gps.headingSmoothed,
    gps.course,
    gps.heading,
    gps.speed,
    gps.accuracy,
  ]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      selfMarkerRef.current?.remove();
      selfMarkerRef.current = null;
    };
  }, []);

  return { selfMarkerReady };
}
