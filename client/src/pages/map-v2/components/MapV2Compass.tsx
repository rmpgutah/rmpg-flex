import { useEffect, useState } from 'react';
import type OlMap from 'ol/Map';
import { Navigation } from 'lucide-react';

interface MapV2CompassProps {
  map: OlMap | null;
}

/**
 * Compass + zoom indicator — top-left chrome. Navigation arrow rotates
 * with the map's view rotation; click resets to north (rotation 0).
 * Zoom level shown beneath as small monospace number.
 */
export default function MapV2Compass({ map }: MapV2CompassProps) {
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(11);

  useEffect(() => {
    if (!map) return;
    const view = map.getView();
    const onChange = () => {
      setRotation(view.getRotation());
      const z = view.getZoom();
      if (typeof z === 'number') setZoom(z);
    };
    onChange();
    view.on('change:rotation', onChange);
    view.on('change:resolution', onChange);
    return () => {
      view.un('change:rotation', onChange);
      view.un('change:resolution', onChange);
    };
  }, [map]);

  function resetNorth() {
    if (!map) return;
    map.getView().animate({ rotation: 0, duration: 300 });
  }

  return (
    <div className="absolute top-12 left-2 z-20 flex flex-col items-center gap-0.5 select-none">
      <button
        type="button"
        onClick={resetNorth}
        title="Reset to north"
        aria-label="Reset map rotation to north"
        className="p-1.5 bg-[#141414] border border-[#222222] hover:bg-[#1a1a1a] text-[#d4a017]"
      >
        <Navigation
          className="w-4 h-4"
          style={{ transform: `rotate(${-rotation}rad)`, transition: 'transform 100ms linear' }}
          aria-hidden="true"
        />
      </button>
      <div className="px-1.5 py-0 bg-[#141414] border border-[#222222] text-[#9ca3af] font-mono text-[9px] tabular-nums">
        Z{zoom.toFixed(1)}
      </div>
    </div>
  );
}
