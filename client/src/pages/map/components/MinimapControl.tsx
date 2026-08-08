import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { saveMapPref } from '../../../utils/mapPreferences';
import { applyRmpgBasemap } from '../../../utils/mapboxBasemap';
import { useWebglMapRecovery } from '../../../hooks/useWebglMapRecovery';

interface Props {
  parentMap: mapboxgl.Map;
  onClose: () => void;
}

export default function MinimapControl({ parentMap, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { rebuildNonce, attach } = useWebglMapRecovery();

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

    // Continuously synced to the parent's camera, so a post-context-loss
    // rebuild just needs a resync (via the parent's next 'move', or
    // immediately here) rather than the captured-camera restore other
    // surfaces use.
    const detachRecovery = attach(minimap, 'MinimapControl');
    minimap.once('load', syncToParent);

    parentMap.on('move', syncToParent);
    return () => {
      parentMap.off('move', syncToParent);
      detachRecovery();
      minimap.remove();
    };
  }, [parentMap, rebuildNonce, attach]);

  return (
    <div
      className="absolute bottom-4 right-4 z-40 tactical-dark border border-surface-raised shadow-lg overflow-hidden"
      style={{ width: 180, height: 140, borderRadius: 2 }}
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
