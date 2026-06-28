import mapboxgl from 'mapbox-gl';

export interface CircleOptions {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
}

export interface LineOptions {
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  dashArray?: number[];
  arrow?: boolean;
}

export interface MarkerOptions {
  element?: HTMLElement;
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  offset?: [number, number];
  draggable?: boolean;
  zIndex?: number;
  title?: string;
}

export class MapboxOverlayManager {
  private sources = new Set<string>();
  private layers = new Set<string>();
  private markers: mapboxgl.Marker[] = [];
  private popups: mapboxgl.Popup[] = [];

  constructor(private map: mapboxgl.Map) {}

  addSource(id: string, data: GeoJSON.GeoJSON): void {
    this.cleanupSource(id);
    if (this.map.getSource(id)) return;
    this.map.addSource(id, { type: 'geojson', data });
    this.sources.add(id);
  }

  updateSource(id: string, data: GeoJSON.GeoJSON): void {
    const src = this.map.getSource(id) as any;
    if (src) {
      src.setData(data);
    } else {
      this.addSource(id, data);
    }
  }

  removeSource(id: string): void {
    if (this.map.getSource(id)) {
      this.map.removeSource(id);
    }
    this.sources.delete(id);
  }

  addLayer(id: string, source: string, type: 'fill' | 'line' | 'circle' | 'symbol' | 'heatmap', paint: any, layout?: any): void {
    this.cleanupLayer(id);
    if (this.map.getLayer(id)) return;
    this.map.addLayer({ id, source, type, paint, layout });
    this.layers.add(id);
  }

  removeLayer(id: string): void {
    if (this.map.getLayer(id)) {
      this.map.removeLayer(id);
    }
    this.layers.delete(id);
  }

  private cleanupSource(id: string): void {
    for (const lid of this.layers) {
      try { if (this.map.getLayer(lid)) this.map.removeLayer(lid); } catch {}
    }
    this.layers.clear();
    try { if (this.map.getSource(id)) this.map.removeSource(id); } catch {}
    this.sources.clear();
  }

  private cleanupLayer(id: string): void {
    try { if (this.map.getLayer(id)) this.map.removeLayer(id); } catch {}
    this.layers.delete(id);
  }

  addMarker(m: mapboxgl.Marker): void {
    m.addTo(this.map);
    this.markers.push(m);
  }

  removeMarker(m: mapboxgl.Marker): void {
    m.remove();
    const idx = this.markers.indexOf(m);
    if (idx >= 0) this.markers.splice(idx, 1);
  }

  addPopup(p: mapboxgl.Popup): void {
    p.addTo(this.map);
    this.popups.push(p);
  }

  removePopup(p: mapboxgl.Popup): void {
    p.remove();
    const idx = this.popups.indexOf(p);
    if (idx >= 0) this.popups.splice(idx, 1);
  }

  removeAll(): void {
    for (const lid of [...this.layers]) {
      try { if (this.map.getLayer(lid)) this.map.removeLayer(lid); } catch {}
    }
    this.layers.clear();
    for (const sid of [...this.sources]) {
      try { if (this.map.getSource(sid)) this.map.removeSource(sid); } catch {}
    }
    this.sources.clear();
    this.markers.forEach(m => m.remove());
    this.markers = [];
    this.popups.forEach(p => p.remove());
    this.popups = [];
  }
}

export function circleGeoJSON(center: [number, number], radiusKm: number, steps = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = center;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i * 360) / steps;
    const brng = (angle * Math.PI) / 180;
    const d = radiusKm / 6371;
    const lat1 = (lat * Math.PI) / 180;
    const lng1 = (lng * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

export function lineGeoJSON(coords: [number, number][]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  };
}

export function pointGeoJSON(coords: [number, number]): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: coords },
  };
}

export function multiPointGeoJSON(points: [number, number][]): GeoJSON.Feature<GeoJSON.MultiPoint> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPoint', coordinates: points },
  };
}

export function polygonGeoJSON(coords: [number, number][][]): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: coords },
  };
}

export function collectionGeoJSON(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

export function makePopup(html: string, lngLat: [number, number]): mapboxgl.Popup {
  return new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
    .setLngLat(lngLat)
    .setHTML(html);
}

export function makeMarker(element: HTMLElement, lngLat: [number, number], options?: MarkerOptions): mapboxgl.Marker {
  return new mapboxgl.Marker({
    element,
    anchor: options?.anchor || 'center',
    offset: options?.offset,
    draggable: options?.draggable,
  })
    .setLngLat(lngLat)
    .addTo(window.mapInstance || ({} as any));
}

export const circlePaint = (color: string, opacity: number, strokeColor?: string, strokeWeight?: number): any => ({
  'fill-color': color,
  'fill-opacity': opacity,
  ...(strokeColor ? {
    'fill-outline-color': strokeColor,
  } : {}),
});

export const linePaint = (color: string, width: number, opacity: number, dash?: number[]): any => ({
  'line-color': color,
  'line-width': width,
  'line-opacity': opacity,
  ...(dash ? { 'line-dasharray': dash } : {}),
});

export const METERS_PER_MILE = 1609.34;
export const MILES_PER_KM = 0.621371;
export const KM_PER_MILE = 1.60934;

export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}
