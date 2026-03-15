// ============================================================
// Map Page — Types & Constants
// ============================================================

import type { UnitStatus } from '../../../types';
import { UNIT_STATUS_HEX, UNIT_STATUS_ABBREV, PRIORITY_HEX } from '../../../utils/statusColors';

// Re-export from consolidated source
export { UNIT_STATUS_HEX as UNIT_STATUS_COLORS, UNIT_STATUS_ABBREV as UNIT_STATUS_LABELS, PRIORITY_HEX as PRIORITY_COLORS };

// ── Types ────────────────────────────────────────────────────

export interface MapUnit {
  id: string;
  call_sign: string;
  officer_name: string;
  status: UnitStatus;
  latitude: number | null;
  longitude: number | null;
  vehicle: string;
  current_call_id: string | null;
  call_number: string | null;
  current_call_type: string | null;
  current_call_location: string | null;
}

export interface ActiveCall {
  id: string;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
  latitude: number | null;
  longitude: number | null;
  property_name: string | null;
}

export interface MapProperty {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  client_name: string | null;
}

// ── Constants ────────────────────────────────────────────────

// Map style options
export type MapStyleId = 'dark' | 'satellite' | 'hybrid' | 'streets' | 'terrain' | 'night_nav';

export const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
  dark: 'Dark',
  satellite: 'Satellite',
  hybrid: 'Hybrid',
  streets: 'Streets',
  terrain: 'Terrain',
  night_nav: 'Night Nav',
};

export const MAP_STYLE_DESCRIPTIONS: Record<MapStyleId, string> = {
  dark: 'Low-light tactical',
  satellite: 'Aerial imagery',
  hybrid: 'Satellite + labels',
  streets: 'Standard roads',
  terrain: 'Elevation contours',
  night_nav: 'High-contrast night',
};

/** Whether a map style uses a light background (affects overlay contrast) */
export function isLightMapStyle(style: MapStyleId): boolean {
  return style === 'streets' || style === 'terrain';
}

/** Whether a map style uses satellite imagery */
export function isSatelliteStyle(style: MapStyleId): boolean {
  return style === 'satellite' || style === 'hybrid';
}

// ── Incident Category Icons ──────────────────────────────────

export function getIncidentCategory(type: string): { symbol: string; category: string } {
  const t = type.toLowerCase();
  if (t.includes('theft') || t.includes('burglary') || t.includes('robbery') || t.includes('larceny') || t.includes('shoplifting'))
    return { symbol: '\u{1F511}', category: 'THEFT' };
  if (t.includes('assault') || t.includes('battery') || t.includes('fight'))
    return { symbol: '\u270A', category: 'ASLT' };
  if (t.includes('traffic') || t.includes('accident') || t.includes('crash') || t.includes('mvc') || t.includes('hit_and_run') || t.includes('dui'))
    return { symbol: '\u{1F697}', category: 'TRFC' };
  if (t.includes('fire') || t.includes('arson'))
    return { symbol: '\u{1F525}', category: 'FIRE' };
  if (t.includes('medical') || t.includes('ems') || t.includes('injury') || t.includes('overdose') || t.includes('death'))
    return { symbol: '\u271A', category: 'MED' };
  if (t.includes('suspicious') || t.includes('welfare') || t.includes('prowler'))
    return { symbol: '\u{1F441}', category: 'SUSP' };
  if (t.includes('alarm') || t.includes('intrusion'))
    return { symbol: '\u{1F514}', category: 'ALM' };
  if (t.includes('trespass') || t.includes('unwanted'))
    return { symbol: '\u2298', category: 'TRSP' };
  if (t.includes('domestic') || t.includes('dv'))
    return { symbol: '\u{1F3E0}', category: 'DV' };
  if (t.includes('drug') || t.includes('narcotics') || t.includes('paraphernalia'))
    return { symbol: '\u{1F48A}', category: 'DRUG' };
  if (t.includes('vandal') || t.includes('damage') || t.includes('criminal_mischief') || t.includes('graffiti'))
    return { symbol: '\u2716', category: 'VNDL' };
  if (t.includes('patrol') || t.includes('foot') || t.includes('check') || t.includes('escort') || t.includes('assist'))
    return { symbol: '\u{1F6E1}', category: 'PTRL' };
  if (t.includes('noise') || t.includes('disturbance') || t.includes('disorderly'))
    return { symbol: '\u{1F50A}', category: 'NOIS' };
  if (t.includes('fraud') || t.includes('forgery') || t.includes('identity') || t.includes('counterfeit'))
    return { symbol: '\u{1F4C4}', category: 'FRAD' };
  if (t.includes('missing') || t.includes('runaway') || t.includes('amber'))
    return { symbol: '\u2753', category: 'MISP' };
  if (t.includes('weapon') || t.includes('gun') || t.includes('shots') || t.includes('armed') || t.includes('shooting'))
    return { symbol: '\u2295', category: 'WPNS' };
  if (t.includes('warrant') || t.includes('wanted') || t.includes('fugitive'))
    return { symbol: '\u{1F4CB}', category: 'WRNT' };
  if (t.includes('hazmat') || t.includes('spill') || t.includes('environmental'))
    return { symbol: '\u26A0', category: 'HZMT' };
  if (t.includes('animal'))
    return { symbol: '\u{1F43E}', category: 'ANML' };
  return { symbol: '\u25CF', category: 'CALL' };
}
