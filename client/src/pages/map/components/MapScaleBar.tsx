import React, { useEffect, useState, useRef } from 'react';

interface MapScaleBarProps {
  mapInstance: google.maps.Map | null;
}

/** Meters per pixel at a given latitude and zoom level */
function getMetersPerPixel(lat: number, zoom: number): number {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

/** Pick a nice round distance value (in feet) for the scale bar */
function pickNiceDistance(maxFeet: number): number {
  const niceValues = [50, 100, 200, 500, 1000, 2000, 2640, 5280, 10560, 26400, 52800, 132000, 264000, 528000];
  for (const v of niceValues) {
    if (v <= maxFeet) continue;
    // Return the previous nice value that fits
  }
  // Find the largest nice value that fits within maxFeet
  let best = niceValues[0];
  for (const v of niceValues) {
    if (v <= maxFeet) best = v;
    else break;
  }
  return best;
}

/** Format feet as a human-readable label */
function formatDistance(feet: number): string {
  if (feet >= 5280) {
    const miles = feet / 5280;
    return miles === Math.floor(miles) ? `${miles} mi` : `${miles.toFixed(1)} mi`;
  }
  return `${feet} ft`;
}

const TARGET_BAR_WIDTH = 120; // pixels - target width for the bar

export default function MapScaleBar({ mapInstance }: MapScaleBarProps) {
  const [barWidth, setBarWidth] = useState(0);
  const [label, setLabel] = useState('');
  const listenerRefs = useRef<google.maps.MapsEventListener[]>([]);

  useEffect(() => {
    if (!mapInstance) return;

    const update = () => {
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      if (!center || zoom == null) return;

      const lat = center.lat();
      const metersPerPixel = getMetersPerPixel(lat, zoom);
      const feetPerPixel = metersPerPixel * 3.28084;

      // How many feet would TARGET_BAR_WIDTH pixels represent?
      const maxFeet = feetPerPixel * TARGET_BAR_WIDTH;
      const niceFeet = pickNiceDistance(maxFeet);

      // Compute exact pixel width for the nice distance
      const exactWidth = niceFeet / feetPerPixel;

      setBarWidth(Math.round(exactWidth));
      setLabel(formatDistance(niceFeet));
    };

    update();

    const zoomListener = google.maps.event.addListener(mapInstance, 'zoom_changed', update);
    const boundsListener = google.maps.event.addListener(mapInstance, 'bounds_changed', update);
    listenerRefs.current = [zoomListener, boundsListener];

    return () => {
      listenerRefs.current.forEach((l) => google.maps.event.removeListener(l));
      listenerRefs.current = [];
    };
  }, [mapInstance]);

  if (!mapInstance || barWidth === 0) return null;

  const segments = 4;
  const segWidth = barWidth / segments;

  return (
    <div
      role="img"
      aria-label={`Map scale: ${label}`}
      className="backdrop-blur-md shadow-lg"
      style={{
        borderRadius: 2,
        background: 'rgba(13, 21, 32, 0.85)',
        border: '1px solid #1e3048',
        padding: '4px 8px 5px',
      }}
    >
      {/* Distance label */}
      <div className="text-[8px] font-mono font-bold text-rmpg-200 tracking-wider text-center mb-1" style={{ width: barWidth }}>
        {label}
      </div>
      {/* Alternating bar segments */}
      <div className="flex" style={{ width: barWidth, height: 4 }}>
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            style={{
              width: segWidth,
              height: '100%',
              backgroundColor: i % 2 === 0 ? '#ffffff' : '#000000',
              borderTop: '1px solid #ffffff',
              borderBottom: '1px solid #ffffff',
            }}
          />
        ))}
      </div>
      {/* End ticks */}
      <div className="relative" style={{ width: barWidth, height: 3 }}>
        <div className="absolute left-0 top-0 w-px h-full bg-white" />
        <div className="absolute right-0 top-0 w-px h-full bg-white" />
      </div>
    </div>
  );
}
