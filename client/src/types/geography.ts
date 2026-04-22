// ============================================================
// TypeScript shapes for /api/dispatch/geography/* endpoints
// Mirrors the server response fields + JOINed parent names +
// child rollup counts.
// ============================================================

export interface Area {
  id: number;
  area_code: string;
  area_name: string;
  color: string;
  description: string | null;
  commander: string | null;
  notes: string | null;
  sort_order: number;
  active: 0 | 1;
  sector_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Sector {
  id: number;
  sector_code: string;
  sector_name: string;
  area_id: number | null;
  area_code?: string | null;
  area_name?: string | null;
  county_nbr: string | null;
  fips_code: string | null;
  color: string;
  description: string | null;
  supervisor: string | null;
  radio_channel: string | null;
  notes: string | null;
  sort_order: number;
  active: 0 | 1;
  zone_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Zone {
  id: number;
  zone_code: string;
  zone_name: string;
  sector_id: number | null;
  sector_code?: string | null;
  sector_name?: string | null;
  zone_type: 'municipality' | 'unincorporated';
  ugrc_code: string | null;
  color: string | null;
  description: string | null;
  primary_unit: string | null;
  backup_unit: string | null;
  radio_channel: string | null;
  hazard_notes: string | null;
  notes: string | null;
  population_estimate: number | null;
  sq_miles: number | null;
  sort_order: number;
  active: 0 | 1;
  beat_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Beat {
  id: number;
  beat_code: string;
  beat_name: string;
  beat_descriptor: string | null;
  zone_id: number | null;
  zone_code?: string | null;
  zone_name?: string | null;
  sector_code?: string | null;
  sector_name?: string | null;
  district_letter: string | null;
  beat_number: number | null;
  dispatch_code: string | null;
  color: string | null;
  assigned_unit: string | null;
  backup_unit: string | null;
  hazard_notes: string | null;
  premise_alerts: string;
  patrol_frequency: string;
  priority_modifier: number;
  population_estimate: number | null;
  sq_miles: number | null;
  notes: string | null;
  sort_order: number;
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

// Nested tree as returned by GET /api/dispatch/geography/tree
export interface GeographyTree {
  areas: (Area & {
    sectors: (Sector & {
      zones: (Zone & { beats: Beat[] })[];
    })[];
  })[];
  unassigned_sectors?: (Sector & {
    zones: (Zone & { beats: Beat[] })[];
  })[];
}

export type TierId = 'area' | 'sector' | 'zone' | 'beat';
