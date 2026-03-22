import { useCallback, useRef } from 'react';

/**
 * Hook providing map screenshot capabilities via Google Maps Static API.
 * Returns functions to capture and download map images.
 */
export function useMapScreenshot(
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>,
) {
  const busyRef = useRef(false);

  /** Build a Google Static Maps URL from current map state */
  const buildStaticUrl = useCallback((width = 1280, height = 720): string | null => {
    const map = mapInstanceRef.current;
    if (!map) return null;

    const center = map.getCenter();
    const zoom = map.getZoom();
    if (!center || zoom == null) return null;

    const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string;
    if (!apiKey) return null;

    const mapType = map.getMapTypeId() || 'roadmap';
    const lat = center.lat().toFixed(6);
    const lng = center.lng().toFixed(6);

    // Clamp dimensions to Static API max (2048 with scale=1)
    const w = Math.min(width, 2048);
    const h = Math.min(height, 2048);

    // Build dark style params for non-satellite types
    const styleParams: string[] = [];
    if (mapType === 'roadmap') {
      // Simplified dark style for Static API
      const darkStyles = [
        'feature:all|element:geometry|color:0x0a1220',
        'feature:all|element:labels.text.fill|color:0x8899aa',
        'feature:all|element:labels.text.stroke|color:0x0a1220',
        'feature:road|element:geometry|color:0x1a2636',
        'feature:road.highway|element:geometry|color:0x1e3048',
        'feature:water|element:geometry|color:0x0d1520',
        'feature:poi|visibility:off',
        'feature:transit|visibility:off',
      ];
      darkStyles.forEach(s => styleParams.push(`style=${encodeURIComponent(s)}`));
    }

    const params = [
      `center=${lat},${lng}`,
      `zoom=${zoom}`,
      `size=${w}x${h}`,
      `scale=2`,
      `maptype=${mapType === 'hybrid' ? 'hybrid' : mapType === 'satellite' ? 'satellite' : mapType === 'terrain' ? 'terrain' : 'roadmap'}`,
      `key=${apiKey}`,
      ...styleParams,
    ];

    return `https://maps.googleapis.com/maps/api/staticmap?${params.join('&')}`;
  }, [mapInstanceRef]);

  /** Capture the current map view as a data URL (PNG) */
  const captureMapImage = useCallback(async (): Promise<string | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;

    try {
      const url = buildStaticUrl(1280, 720);
      if (!url) return null;

      const resp = await fetch(url);
      if (!resp.ok) return null;

      const blob = await resp.blob();
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('[useMapScreenshot] capture failed:', err);
      return null;
    } finally {
      busyRef.current = false;
    }
  }, [buildStaticUrl]);

  /** Download the current map view as a PNG file */
  const downloadMapImage = useCallback(async (filename?: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;

    try {
      const url = buildStaticUrl(1280, 720);
      if (!url) return false;

      const resp = await fetch(url);
      if (!resp.ok) return false;

      const blob = await resp.blob();
      const map = mapInstanceRef.current;
      const center = map?.getCenter();
      const zoom = map?.getZoom();

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const coords = center ? `_${center.lat().toFixed(4)}_${center.lng().toFixed(4)}` : '';
      const zStr = zoom != null ? `_z${zoom}` : '';
      const name = filename || `map-export_${ts}${coords}${zStr}.png`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      return true;
    } catch (err) {
      console.error('[useMapScreenshot] download failed:', err);
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [buildStaticUrl, mapInstanceRef]);

  /** Open browser print dialog */
  const printMap = useCallback(() => {
    window.print();
  }, []);

  return {
    captureMapImage,
    downloadMapImage,
    printMap,
    buildStaticUrl,
  };
}
