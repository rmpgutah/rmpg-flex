// Point-to-District Lookup — Mapbox Tilequery for feature identification
// Click any point on the map to identify the beat, district, zone, or sector
// it falls within. Essential for dispatch call location verification.
import { useCallback, useState } from 'react';
import { tileQuery } from '../utils/mapboxServices';

export interface TilequeryFeature {
  id: string;
  layer: string;
  type: string;
  properties: Record<string, any>;
  geometry: GeoJSON.Geometry;
}

export interface PointDistrictInfo {
  beat?: string;
  beatName?: string;
  zone?: string;
  zoneName?: string;
  sector?: string;
  sectorName?: string;
  area?: string;
  areaName?: string;
  city?: string;
  county?: string;
  state?: string;
  location: [number, number]; // [lng, lat]
  rawFeatures: TilequeryFeature[];
}

export function useMapboxTilequery(map: mapboxgl.Map | null) {
  const [pointInfo, setPointInfo] = useState<PointDistrictInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useCallback(async (
    lng: number,
    lat: number,
    radius = 50,
    layers?: string[],
  ) => {
    setLoading(true);
    try {
      // Query multiple layers for comprehensive district info
      const layerStr = layers?.join(',') || 'place_label,locality_label,neighborhood_label';
      const data = await tileQuery(lng, lat, radius, 10, layerStr);
      const features: TilequeryFeature[] = data.features || [];

      const info: PointDistrictInfo = {
        location: [lng, lat],
        rawFeatures: features,
      };

      // Extract district hierarchy from features
      for (const f of features) {
        const p = f.properties;
        const layer = f.layer;

        if (layer === 'place_label') {
          info.city = p.name || p.name_en;
          info.county = p.county;
          info.state = p.region || 'UT';
        }
        if (layer === 'locality_label') {
          if (!info.city) info.city = p.name || p.name_en;
        }
        if (layer === 'neighborhood_label') {
          info.sectorName = p.name || p.name_en;
        }
        // Custom district layers could be queried if published as tilesets
      }

      setPointInfo(info);
      return info;
    } catch (err) {
      console.warn('[useMapboxTilequery] query failed:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const queryFromMapClick = useCallback(async (e: mapboxgl.MapMouseEvent) => {
    const { lng, lat } = e.lngLat;
    return query(lng, lat);
  }, [query]);

  return { pointInfo, loading, query, queryFromMapClick };
}
