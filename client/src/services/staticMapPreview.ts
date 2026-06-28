// ============================================================
// RMPG Flex — Static Map Preview Utility
// ============================================================
// Generates Mapbox Static Image URLs and fetches map thumbnails
// for embedding in incident reports, PDFs, and record previews.
// Uses the server-side /api/mapbox/static proxy.
// ============================================================

import { mapboxStaticImageUrl } from './mapboxApiService';

export interface StaticMapOptions {
  lng: number;
  lat: number;
  zoom?: number;
  width?: number;
  height?: number;
  style?: 'dark' | 'satellite' | 'streets';
  markers?: Array<{
    lng: number;
    lat: number;
    color?: string;
    label?: string;
  }>;
  retina?: boolean;
}

const STYLE_MAP: Record<string, string> = {
  dark: 'mapbox/dark-v11',
  satellite: 'mapbox/satellite-streets-v12',
  streets: 'mapbox/streets-v12',
};

/**
 * Generate a static map image URL for an incident location.
 * Perfect for embedding in PDF reports or record cards.
 */
export async function getIncidentMapUrl(options: StaticMapOptions): Promise<string> {
  return mapboxStaticImageUrl({
    lng: options.lng,
    lat: options.lat,
    zoom: options.zoom ?? 15,
    width: options.width ?? 600,
    height: options.height ?? 300,
    style: STYLE_MAP[options.style ?? 'dark'] ?? 'mapbox/dark-v11',
    markers: options.markers ?? [{ lng: options.lng, lat: options.lat, color: 'ef4444', label: '' }],
    retina: options.retina ?? true,
  });
}

/**
 * Generate a static map URL for a call with unit positions shown.
 */
export async function getDispatchMapUrl(
  call: { lng: number; lat: number },
  units: Array<{ lng: number; lat: number; callSign: string }>
): Promise<string> {
  const markers = [
    { lng: call.lng, lat: call.lat, color: 'ef4444', label: 'c' },
    ...units.map(u => ({
      lng: u.lng, lat: u.lat, color: 'd4a017', label: u.callSign.charAt(0).toLowerCase(),
    })),
  ];

  return mapboxStaticImageUrl({
    lng: call.lng,
    lat: call.lat,
    zoom: 13,
    width: 800,
    height: 500,
    style: 'mapbox/dark-v11',
    markers,
    retina: true,
  });
}

/**
 * Get the binary image URL for embedding directly in an <img> tag.
 * Returns the server-proxied URL that streams the PNG.
 */
export function getStaticMapImageSrc(options: StaticMapOptions): string {
  const params = new URLSearchParams({
    lng: String(options.lng),
    lat: String(options.lat),
    zoom: String(options.zoom ?? 15),
    width: String(options.width ?? 600),
    height: String(options.height ?? 300),
    style: STYLE_MAP[options.style ?? 'dark'] ?? 'mapbox/dark-v11',
  });
  if (options.retina) params.set('retina', 'true');
  if (options.markers?.length) {
    params.set('markers', options.markers.map(m =>
      `${m.lng},${m.lat},${m.color ?? 'd4a017'},${m.label ?? ''}`
    ).join(';'));
  }
  return `/api/mapbox/static/image?${params}`;
}
