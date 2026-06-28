// Pure helpers for the intel geo endpoint. No I/O — easy to unit-test.
export interface GeoFeature {
  entity_type: string; entity_id: number; lat: number; lng: number; label: string;
  when?: string | null; geocoded?: boolean;
}

export function finiteCoord(lat: unknown, lng: unknown): boolean {
  if (lat == null || lng == null || lat === '' || lng === '') return false;
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 0 && b === 0) return false; // null island = missing data
  return true;
}

// ISO yyyy-mm-dd N days before `now`.
export function daysCutoffISO(days: number, now: Date): string {
  const d = new Date(now.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function geoFeature(
  entity_type: string, entity_id: number, lat: unknown, lng: unknown, label: string,
  extra: { when?: string | null; geocoded?: boolean } = {},
): GeoFeature {
  return { entity_type, entity_id, lat: Number(lat), lng: Number(lng), label, ...extra };
}
