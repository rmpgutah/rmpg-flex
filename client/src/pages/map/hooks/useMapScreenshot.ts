import { useCallback, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

export function useMapScreenshot(mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>) {
  const busyRef = useRef(false);

  const captureMapImage = useCallback(async (): Promise<string | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    try {
      const map = mapInstanceRef.current;
      if (!map) return null;
      const canvas = map.getCanvas();
      return canvas.toDataURL('image/png');
    } catch (err) {
      console.error('[useMapScreenshot] capture failed:', err);
      return null;
    } finally { busyRef.current = false; }
  }, [mapInstanceRef]);

  const downloadMapImage = useCallback(async (filename?: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;

    try {
      const map = mapInstanceRef.current;
      if (!map) return false;

      const canvas = map.getCanvas();
      const dataUrl = canvas.toDataURL('image/png');

      const center = map.getCenter();
      const zoom = map.getZoom();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const coords = center ? `_${center.lat.toFixed(4)}_${center.lng.toFixed(4)}` : '';
      const zStr = zoom != null ? `_z${zoom}` : '';
      const name = filename || `map-export_${ts}${coords}${zStr}.png`;

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (err) {
      console.error('[useMapScreenshot] download failed:', err);
      return false;
    } finally { busyRef.current = false; }
  }, [mapInstanceRef]);

  const printMap = useCallback(() => { window.print(); }, []);

  return { captureMapImage, downloadMapImage, printMap };
}