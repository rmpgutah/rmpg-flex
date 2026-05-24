// Static Map Generation — Mapbox Static Images API
// Generates a high-resolution map image URL for embedding in PDF reports,
// citations, incident records, and evidence packages.
import { useCallback, useState } from 'react';
import { getStaticMapUrl } from '../utils/mapboxServices';

export interface StaticMapOptions {
  lng: number;
  lat: number;
  zoom?: number;
  width?: number;
  height?: number;
  style?: string;
  // Optional overlay: pin, path, or GeoJSON
  overlay?: string;
}

export function useMapboxStaticMap() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateMapImage = useCallback(async (options: StaticMapOptions) => {
    setLoading(true);
    setError(null);
    try {
      const { url, attribution } = await getStaticMapUrl(
        options.lng,
        options.lat,
        options.zoom,
        options.width,
        options.height,
        options.style,
      );
      return { url, attribution };
    } catch (err: any) {
      setError(err.message || 'Static map generation failed');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Generate a map with a marker pin at the given coordinates
  const generatePinnedMap = useCallback(async (
    lng: number,
    lat: number,
    label?: string,
    width = 600,
    height = 400,
    zoom = 14,
  ) => {
    // Mapbox Static API supports pin overlays:
    // pin-l-circle+gold(lng,lat)/lng,lat,zoom/widthxheight@2x
    const overlay = `pin-l-${label ? label.charAt(0).toUpperCase() : 'marker'}+d4a017(${lng},${lat})`;
    return generateMapImage({ lng, lat, zoom, width, height, overlay });
  }, [generateMapImage]);

  // Generate an area overview with a path overlay
  const generateRouteMap = useCallback(async (
    waypoints: [number, number][],
    width = 600,
    height = 400,
  ) => {
    // Mapbox Static API supports path overlays:
    // path-2+d4a017-0.8(lng1,lat1;lng2,lat2)
    const pathStr = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
    const overlay = `path-3+d4a017-0.7(${pathStr})`;
    const center = waypoints[Math.floor(waypoints.length / 2)];
    return generateMapImage({
      lng: center[0], lat: center[1], zoom: 12, width, height, overlay,
    });
  }, [generateMapImage]);

  return { loading, error, generateMapImage, generatePinnedMap, generateRouteMap };
}
