export interface GeoFeature {
  entity_type: string; entity_id: number; lat: number; lng: number; label: string;
  when?: string | null; geocoded?: boolean;
}
export interface LayerDef { key: string; label: string; color: string }

export const LAYER_DEFS: LayerDef[] = [
  { key: 'sightings', label: 'Plate Sightings', color: '#22d3ee' },
  { key: 'calls', label: 'Calls', color: '#d4a017' },
  { key: 'incidents', label: 'Incidents', color: '#f59e0b' },
  { key: 'field_interviews', label: 'Field Interviews', color: '#10b981' },
  { key: 'warrants', label: 'Warrants', color: '#ff6b5e' },
  { key: 'trespass', label: 'Trespass', color: '#888888' },
];

export function toGeoJSON(features: GeoFeature[]) {
  return {
    type: 'FeatureCollection' as const,
    features: features.map((f) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] },
      properties: { entity_type: f.entity_type, entity_id: f.entity_id, label: f.label, when: f.when ?? '' },
    })),
  };
}
