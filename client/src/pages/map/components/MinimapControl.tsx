import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { saveMapPref } from '../../../utils/mapPreferences';
import { applyRmpgBasemap } from '../../../utils/mapboxBasemap';

interface Props {
  parentMap: mapboxgl.Map;
  onClose: () => void;
}

export default function MinimapControl({ parentMap, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const minimap = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: parentMap.getCenter(),
      zoom: Math.max(parentMap.getZoom() - 4, 1),
      attributionControl: false,
      interactive: true,
    });
    minimap.on('style.load', () => applyRmpgBasemap(minimap, { variant: 'dark' }));

    const syncToParent = () => {
      minimap.setCenter(parentMap.getCenter());
      minimap.setZoom(Math.max(parentMap.getZoom() - 4, 1));
    };

    parentMap.on('move', syncToParent);
    return () => {
      parentMap.off('move', syncToParent);
      minimap.remove();
    };
  }, [parentMap]);

  return (
    <div
      className="fixed bottom-4 right-4 z-40 tactical-dark border border-surface-raised rounded shadow-lg overflow-hidden"
      style={{ width: 180, height: 140 }}
    >
      <div ref={containerRef} className="w-full h-full" />
      <button
        aria-label="Close minimap"
        onClick={() => { saveMapPref('minimap_visible', false); onClose(); }}
        className="absolute top-1 right-1 text-rmpg-300 hover:text-white text-xs bg-surface-base rounded px-1"
      >
        ✕
      </button>
    </div>
  );
}
