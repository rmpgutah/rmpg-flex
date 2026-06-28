import type { RawWarrantHit } from '../types';
import { parseSocrata, type FieldMap } from './socrata';

interface ArcgisResponse { features?: { attributes?: Record<string, unknown> }[] }

/** ArcGIS FeatureServer query responses wrap rows in features[].attributes.
 *  Once unwrapped, the same field-map mapping as Socrata applies (parseSocrata's
 *  normalizeDate already converts ArcGIS epoch-ms dates to ISO). */
export function parseArcgis(body: unknown, map: FieldMap, sourceKey: string): RawWarrantHit[] {
  const b = (body ?? {}) as ArcgisResponse;
  const rows = (b.features ?? []).map((f) => f.attributes ?? {});
  return parseSocrata(rows, map, sourceKey);
}
