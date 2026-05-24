import { useCallback, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

const STYLE_URL_MAP: Record<string, string> = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  night_nav: 'mapbox://styles/mapbox/navigation-night-v1',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  light: 'mapbox://styles/mapbox/light-v11',
};

/**
 * Hook providing map screenshot capabilities via Mapbox Static Images API.
 * Returns functions to capture and download map images.
 */
export function useMapScreenshot(
  map: mapboxgl.Map | null,
  styleId: string = 'dark',
) {
  const busyRef = useRef(false);

  const buildStaticUrl = useCallback(async (width = 1280, height = 720): Promise<string | null> => {
    if (!map) return null;

    const center = map.getCenter();
    const zoom = map.getZoom();
    if (!center || zoom == null) return null;

    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token) return null;

    const lat = center.lat.toFixed(6);
    const lng = center.lng.toFixed(6);

    const w = Math.min(width, 1280);
    const h = Math.min(height, 1280);

    const styleUrl = STYLE_URL_MAP[styleId] || 'mapbox://styles/mapbox/dark-v11';
    const stylePath = styleUrl.replace('mapbox://styles/', '');
    return `https://api.mapbox.com/styles/v1/${stylePath}/static/${lng},${lat},${zoom},0/${w}x${h}@2x?access_token=${token}`;
  }, [map, styleId]);

  const captureMapImage = useCallback(async (): Promise<string | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;

    try {
      const url = await buildStaticUrl(1280, 720);
      if (!url) return null;

      const resp = await fetch(url);
      if (!resp.ok) return null;

      const blob = await resp.blob();
      return new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('[useMapScreenshot] capture failed:', err);
      return null;
    } finally {
      busyRef.current = false;
    }
  }, [buildStaticUrl]);

  const downloadMapImage = useCallback(async (filename?: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;

    try {
      const url = await buildStaticUrl(1280, 720);
      if (!url) return false;

      const resp = await fetch(url);
      if (!resp.ok) return false;

      const blob = await resp.blob();
      const center = map?.getCenter();
      const zoom = map?.getZoom();

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const coords = center ? `_${center.lat.toFixed(4)}_${center.lng.toFixed(4)}` : '';
      const zStr = zoom != null ? `_z${zoom}` : '';
      const name = filename || `map-export_${ts}${coords}${zStr}.png`;

      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      return true;
    } catch (err) {
      console.error('[useMapScreenshot] download failed:', err);
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [buildStaticUrl, map]);

  const printMap = useCallback(() => { window.print(); }, []);

  return { captureMapImage, downloadMapImage, printMap, buildStaticUrl };
}
