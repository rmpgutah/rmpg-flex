import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import dissolve from '@turf/dissolve';

/**
 * Dissolves a set of beat polygons grouped by area_id into one outer-ring
 * LineString feature per area. Beats not present in `beatToArea` are
 * dropped before the dissolve.
 *
 * The output features carry `properties.area_id` so the renderer can
 * look up the per-area color.
 */
export function dissolveBeatsByArea(
  beats: Feature<Polygon>[],
  beatToArea: Map<string, number | string>,
): Feature<LineString>[] {
  // Tag each beat with its area_id and drop those without one.
  const tagged: Feature<Polygon>[] = beats
    .map((f) => {
      const beatCode = (f.properties as any)?.beat_code as string | undefined;
      if (!beatCode) return null;
      const areaId = beatToArea.get(beatCode);
      if (areaId == null) return null;
      return {
        ...f,
        properties: { ...(f.properties || {}), area_id: areaId },
      } as Feature<Polygon>;
    })
    .filter((f): f is Feature<Polygon> => f !== null);

  if (tagged.length === 0) return [];

  const fc: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: tagged };
  const dissolved = dissolve(fc, { propertyName: 'area_id' });

  // Convert each dissolved polygon to its outer-ring linestring.
  return dissolved.features.map((p) => ({
    type: 'Feature',
    properties: p.properties,
    geometry: { type: 'LineString', coordinates: (p.geometry as Polygon).coordinates[0] },
  }));
}
