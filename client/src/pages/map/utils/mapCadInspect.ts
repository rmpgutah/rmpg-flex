/**
 * CAD hits for Feature Inspect. HTML unit/call markers are invisible to
 * queryRenderedFeatures; beat/district fills are not OSM overlays. Both
 * belong in the inspector so "what is here?" includes live dispatch.
 */

export type CadInspectKind = 'unit' | 'call' | 'geo';

export interface InspectedFeature {
  key: string;
  layerId: string;
  categoryLabel: string;
  groupLabel: string | null;
  coverage?: string;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
  awayLabel?: string;
  /** OSM overlays vs live CAD (units, calls, beats). */
  kind?: 'osm' | 'cad';
  cadKind?: CadInspectKind;
}

export interface InspectionResult {
  lngLat: [number, number];
  features: InspectedFeature[];
  widened: boolean;
  timestamp: number;
}

export interface CadUnitHit {
  id: string;
  call_sign: string;
  officer_name: string;
  status: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  current_call_number?: string | null;
  badge_number?: string;
}

export interface CadCallHit {
  id: string;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
  latitude: number | null;
  longitude: number | null;
  beat_name?: string | null;
}

export function isCadGeoLayer(layerId: string): boolean {
  return /^(geojson-|dh-|beat-coverage-)/.test(layerId);
}

function geoMeta(layerId: string): { categoryLabel: string; groupLabel: string } {
  if (layerId.startsWith('beat-coverage')) {
    return { categoryLabel: 'Beat coverage', groupLabel: 'Risk & Coverage' };
  }
  if (layerId.startsWith('dh-')) {
    const level = layerId.replace(/^dh-/, '').replace(/-(fill|line|label)$/, '');
    const labels: Record<string, string> = { area: 'Area', sector: 'Sector', zone: 'Zone' };
    return { categoryLabel: labels[level] ?? level, groupLabel: 'Districts' };
  }
  const id = layerId.replace(/^geojson-/, '').replace(/-(fill|line)$/, '');
  const labels: Record<string, string> = {
    beat: 'Beat', county: 'County', municipality: 'Municipality',
    highway: 'Highway', place: 'Place', state_boundary: 'State',
  };
  return { categoryLabel: labels[id] ?? id.replace(/_/g, ' '), groupLabel: 'Boundaries' };
}

function geoTitle(props: Record<string, unknown>): string {
  const keys = [
    'dispatch_code', 'dispatchCode', 'beat_code', 'beat', 'BEAT', 'NAME', 'name',
    'route_name', 'label', 'zone_id', 'section_id', 'area_id',
  ];
  for (const k of keys) {
    const v = props[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return 'Unnamed';
}

/** Fill layers only — line duplicates the same polygon. */
export function collectCadGeoFeatures(raw: unknown[]): InspectedFeature[] {
  const byKey = new Map<string, InspectedFeature>();
  for (const item of raw) {
    const f = item as { layer?: { id?: string }; properties?: Record<string, unknown>; geometry?: GeoJSON.Geometry };
    const layerId = f?.layer?.id;
    if (!layerId || !isCadGeoLayer(layerId)) continue;
    if (layerId.endsWith('-line') || layerId.endsWith('-label')) continue;
    const props = f.properties ?? {};
    const title = geoTitle(props);
    const key = `cad:${layerId}:${title}`;
    if (byKey.has(key)) continue;
    const meta = geoMeta(layerId);
    byKey.set(key, {
      key,
      layerId,
      kind: 'cad',
      cadKind: 'geo',
      categoryLabel: meta.categoryLabel,
      groupLabel: meta.groupLabel,
      properties: { ...props, __cad_title: title },
      geometry: f.geometry ?? { type: 'Point', coordinates: [0, 0] },
    });
  }
  return [...byKey.values()];
}

function withinPx(
  project: (lng: number, lat: number) => { x: number; y: number },
  point: { x: number; y: number },
  lng: number,
  lat: number,
  tolPx: number,
): boolean {
  const p = project(lng, lat);
  const dx = p.x - point.x;
  const dy = p.y - point.y;
  return dx * dx + dy * dy <= tolPx * tolPx;
}

export function collectCadMarkers(
  units: CadUnitHit[],
  calls: CadCallHit[],
  project: ((lng: number, lat: number) => { x: number; y: number }) | undefined,
  point: { x: number; y: number },
  tolPx: number,
): InspectedFeature[] {
  if (!project) return [];
  const out: InspectedFeature[] = [];

  for (const unit of units) {
    if (unit.latitude == null || unit.longitude == null) continue;
    if (!withinPx(project, point, unit.longitude, unit.latitude, tolPx)) continue;
    out.push({
      key: `cad:unit:${unit.id}`,
      layerId: 'cad-unit',
      kind: 'cad',
      cadKind: 'unit',
      categoryLabel: 'Unit',
      groupLabel: 'Units & Calls',
      properties: {
        __cad_title: unit.call_sign,
        call_sign: unit.call_sign,
        officer_name: unit.officer_name,
        status: unit.status,
        location: unit.location ?? '',
        current_call_number: unit.current_call_number ?? '',
        badge_number: unit.badge_number ?? '',
      },
      geometry: { type: 'Point', coordinates: [unit.longitude, unit.latitude] },
    });
  }

  for (const call of calls) {
    if (call.latitude == null || call.longitude == null) continue;
    if (!withinPx(project, point, call.longitude, call.latitude, tolPx)) continue;
    out.push({
      key: `cad:call:${call.id}`,
      layerId: 'cad-call',
      kind: 'cad',
      cadKind: 'call',
      categoryLabel: 'Call',
      groupLabel: 'Units & Calls',
      properties: {
        __cad_title: call.call_number,
        call_number: call.call_number,
        incident_type: call.incident_type,
        priority: call.priority,
        status: call.status,
        location_address: call.location_address,
        beat_name: call.beat_name ?? '',
      },
      geometry: { type: 'Point', coordinates: [call.longitude, call.latitude] },
    });
  }

  return out;
}

export interface CadRow {
  key: string;
  label: string;
  value: string;
}

export function cadDetailRows(feature: InspectedFeature): CadRow[] {
  const p = feature.properties;
  const str = (k: string) => String(p[k] ?? '').trim();
  if (feature.cadKind === 'unit') {
    return [
      { key: 'officer', label: 'Officer', value: str('officer_name') },
      { key: 'status', label: 'Status', value: str('status') },
      { key: 'badge', label: 'Badge', value: str('badge_number') },
      { key: 'loc', label: 'Location', value: str('location') },
      { key: 'call', label: 'Call', value: str('current_call_number') },
    ].filter((r) => r.value);
  }
  if (feature.cadKind === 'call') {
    return [
      { key: 'type', label: 'Nature', value: str('incident_type') },
      { key: 'pri', label: 'Priority', value: str('priority') },
      { key: 'status', label: 'Status', value: str('status') },
      { key: 'addr', label: 'Address', value: str('location_address') },
      { key: 'beat', label: 'Beat', value: str('beat_name') },
    ].filter((r) => r.value);
  }
  const skip = new Set(['__cad_title']);
  return Object.entries(p)
    .filter(([k, v]) => !skip.has(k) && v != null && String(v).trim() !== '')
    .slice(0, 12)
    .map(([k, v]) => ({ key: k, label: k.replace(/_/g, ' '), value: String(v) }));
}
