import { useEffect, useState, useRef, useCallback } from 'react';

interface MapScaleBarProps {
  mapInstance: google.maps.Map | null;
}

/** Meters per pixel at a given latitude and zoom level */
function getMetersPerPixel(lat: number, zoom: number): number {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

/** Pick a nice round distance value (in feet) for the scale bar */
function pickNiceDistanceFeet(maxFeet: number): number {
  const niceValues = [50, 100, 200, 500, 1000, 2000, 2640, 5280, 10560, 26400, 52800, 132000, 264000, 528000];
  let best = niceValues[0];
  for (const v of niceValues) {
    if (v <= maxFeet) best = v;
    else break;
  }
  return best;
}

/** Pick a nice round distance value (in meters) for the scale bar */
function pickNiceDistanceMeters(maxMeters: number): number {
  const niceValues = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
  let best = niceValues[0];
  for (const v of niceValues) {
    if (v <= maxMeters) best = v;
    else break;
  }
  return best;
}

/** Format feet as a human-readable label */
function formatDistanceFeet(feet: number): string {
  if (feet >= 5280) {
    const miles = feet / 5280;
    return miles === Math.floor(miles) ? `${miles} mi` : `${miles.toFixed(1)} mi`;
  }
  return `${feet} ft`;
}

/** Format meters as a human-readable label */
function formatDistanceMetric(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return km === Math.floor(km) ? `${km} km` : `${km.toFixed(1)} km`;
  }
  return `${meters} m`;
}

const TARGET_BAR_WIDTH = 120; // pixels - target width for the bar

export default function MapScaleBar({ mapInstance }: MapScaleBarProps) {
  const [barWidth, setBarWidth] = useState(0);
  const [label, setLabel] = useState('');
  const [metricLabel, setMetricLabel] = useState('');
  const [metricBarWidth, setMetricBarWidth] = useState(0);
  const [showMetric, setShowMetric] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(0);
  const listenerRefs = useRef<google.maps.MapsEventListener[]>([]);

  const toggleUnit = useCallback(() => setShowMetric(prev => !prev), []);

  useEffect(() => {
    if (!mapInstance) return;

    const update = () => {
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      if (!center || zoom == null) return;

      const lat = center.lat();
      const metersPerPixel = getMetersPerPixel(lat, zoom);
      const feetPerPixel = metersPerPixel * 3.28084;

      setZoomLevel(Math.round(zoom));

      // Imperial
      const maxFeet = feetPerPixel * TARGET_BAR_WIDTH;
      const niceFeet = pickNiceDistanceFeet(maxFeet);
      const exactWidthFt = niceFeet / feetPerPixel;
      setBarWidth(Math.round(exactWidthFt));
      setLabel(formatDistanceFeet(niceFeet));

      // Metric
      const maxMeters = metersPerPixel * TARGET_BAR_WIDTH;
      const niceMeters = pickNiceDistanceMeters(maxMeters);
      const exactWidthM = niceMeters / metersPerPixel;
      setMetricBarWidth(Math.round(exactWidthM));
      setMetricLabel(formatDistanceMetric(niceMeters));
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

  const activeWidth = showMetric ? metricBarWidth : barWidth;
  const activeLabel = showMetric ? metricLabel : label;
  const segments = 4;
  const segWidth = activeWidth / segments;

  return (
    <div
      role="img"
      aria-label={`Map scale: ${activeLabel}`}
      className="backdrop-blur-md shadow-lg transition-all duration-200 border border-[#2b2b2b]/50 rounded-sm"
      style={{
        borderRadius: 2,
        background: 'rgba(13, 21, 32, 0.92)',
        padding: '4px 8px 5px',
      }}
    >
      {/* Top row: distance label + zoom level + unit toggle */}
      <div className="flex items-center justify-between mb-1" style={{ width: activeWidth, minWidth: 80 }}>
        <div
          className="font-mono text-[10px] font-bold text-rmpg-200 tracking-wider cursor-pointer hover:text-[#a0a0a0] transition-colors tabular-nums"
          onClick={toggleUnit}
          title={`Click to switch to ${showMetric ? 'imperial' : 'metric'}`}
        >
          {activeLabel}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[7px] text-rmpg-500 tabular-nums" title="Zoom level">Z{zoomLevel}</span>
          <button
            type="button"
            onClick={toggleUnit}
            className="font-mono text-[7px] font-bold px-1 py-0 transition-colors hover:text-rmpg-200"
            style={{
              color: '#666666',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid #333333',
              borderRadius: 1,
              cursor: 'pointer',
            }}
            title={`Switch to ${showMetric ? 'imperial' : 'metric'}`}
          >
            {showMetric ? 'MI' : 'KM'}
          </button>
        </div>
      </div>
      {/* Dual-tone alternating bar segments */}
      <div className="flex" style={{ width: activeWidth, height: 4 }}>
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            style={{
              width: segWidth,
              height: '100%',
              background: i % 2 === 0 ? 'linear-gradient(to bottom, #7a8a9a, #5a6e80)' : '#0a0a0a',
              borderTop: '1px solid rgba(255,255,255,0.7)',
              borderBottom: '1px solid rgba(255,255,255,0.7)',
            }}
          />
        ))}
      </div>
      {/* End ticks */}
      <div className="relative" style={{ width: activeWidth, height: 5 }}>
        <div className="absolute left-0 top-0 w-px h-full bg-white/80" />
        <div className="absolute right-0 top-0 w-px h-full bg-white/80" />
        {/* Half-way tick */}
        <div className="absolute top-0 w-px h-2/3 bg-white/40" style={{ left: activeWidth / 2 }} />
      </div>
    </div>
  );
}
