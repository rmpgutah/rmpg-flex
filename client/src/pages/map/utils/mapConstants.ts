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
  gps_source?: string;
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

// ── Category SVG Icon Paths (16x16 viewBox, white fill) ─────
// Minimal inline SVGs for incident marker category icons.

export const CATEGORY_ICONS: Record<string, string> = {
  // Shield — law enforcement / default / patrol
  CALL: 'M8 1L2 4v4c0 4.4 2.6 8.5 6 9.5 3.4-1 6-5.1 6-9.5V4L8 1z',
  PTRL: 'M8 1L2 4v4c0 4.4 2.6 8.5 6 9.5 3.4-1 6-5.1 6-9.5V4L8 1z',
  // Car — traffic
  TRFC: 'M2.5 11h11l-1-4H3.5l-1 4zm1-5h9l-.5-2h-8l-.5 2zM4 12a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm8 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  // Flame — fire
  FIRE: 'M8 1C6.5 4 4 5.5 4 8.5a4 4 0 004 4 4 4 0 004-4C12 5.5 9.5 4 8 1zm0 10c-1.4 0-2.5-1.1-2.5-2.5 0-1.1.6-2.1 1.5-3 .9.9 1.5 1.9 1.5 3C8.5 9.9 9.4 11 8 11z',
  // Medical cross
  MED: 'M6 2h4v4h4v4h-4v4H6v-4H2V6h4V2z',
  // Eye — suspicious
  SUSP: 'M8 3C3 3 .5 8 .5 8S3 13 8 13s7.5-5 7.5-5S13 3 8 3zm0 8.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7zm0-5.5a2 2 0 100 4 2 2 0 000-4z',
  // Bell — alarm
  ALM: 'M8 1a1 1 0 00-1 1v.6C4.7 3.2 3 5.4 3 8v3l-1 2h12l-1-2V8c0-2.6-1.7-4.8-4-5.4V2a1 1 0 00-1-1zM6.5 14a1.5 1.5 0 003 0h-3z',
  // Alert triangle — disturbance / noise
  NOIS: 'M8 1L1 14h14L8 1zm0 4l4.5 8h-9L8 5zm-.75 2.5v3h1.5v-3h-1.5zm0 4v1.5h1.5V11.5h-1.5z',
  // Hand — theft
  THEFT: 'M11 1.5a1 1 0 00-2 0v5h-1V2a1 1 0 00-2 0v4.5H5V3a1 1 0 00-2 0v6c0 3.3 2.7 6 6 6h.5c2.5 0 4.5-2 4.5-4.5V4.5a1 1 0 00-2 0V6.5h-1V1.5z',
  // Trespass — no entry circle
  TRSP: 'M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a5 5 0 013.54 1.46L4.46 11.54A5 5 0 018 3zm0 10a5 5 0 01-3.54-1.46l7.08-7.08A5 5 0 018 13z',
  // Assault — fist
  ASLT: 'M4 4a2 2 0 014 0v1h1V3.5a1.5 1.5 0 013 0V5h1V3a1.5 1.5 0 013 0v5c0 3-2 5.5-5 5.5H9c-2.2 0-4-1.5-4.5-3.5L3 6a1.5 1.5 0 011-1.5V4z',
  // House — domestic violence
  DV: 'M8 2L1 8h2v6h4v-4h2v4h4V8h2L8 2z',
  // Pill — drugs
  DRUG: 'M4.5 2A2.5 2.5 0 002 4.5v7A2.5 2.5 0 004.5 14h7a2.5 2.5 0 002.5-2.5v-7A2.5 2.5 0 0011.5 2h-7zM4 7.5h8v1H4v-1z',
  // X mark — vandalism
  VNDL: 'M3.5 2L2 3.5 6.5 8 2 12.5 3.5 14 8 9.5l4.5 4.5L14 12.5 9.5 8 14 3.5 12.5 2 8 6.5 3.5 2z',
  // Document — fraud
  FRAD: 'M4 1h5l4 4v9H4V1zm5 0v4h4M6 8h5M6 10h5M6 12h3',
  // Question — missing person
  MISP: 'M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a2.5 2.5 0 012.5 2.5c0 1-.7 1.5-1.3 2-.3.2-.7.5-.7 1h-1c0-1 .5-1.5 1-2s.8-.8.8-1A1.3 1.3 0 008 5.2 1.3 1.3 0 006.7 6.5h-1A2.5 2.5 0 018 4zm-.75 7h1.5v1.5h-1.5V11z',
  // Crosshair — weapons
  WPNS: 'M8 1v3M8 12v3M1 8h3M12 8h3M8 5a3 3 0 100 6 3 3 0 000-6z',
  // Clipboard — warrant
  WRNT: 'M5 1v2H3v12h10V3h-2V1H5zm1 1h4v1H6V2zM5 7h6v1H5V7zm0 2h6v1H5V9zm0 2h4v1H5v-1z',
  // Warning triangle — hazmat
  HZMT: 'M8 1L1 14h14L8 1zm-.75 5h1.5v4h-1.5V6zm0 5h1.5v1.5h-1.5v-1.5z',
  // Paw — animal
  ANML: 'M4.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm7 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-5-3a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm3 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM8 14c2.2 0 4-1.8 4-4-1-2-3-3-4-3s-3 1-4 3c0 2.2 1.8 4 4 4z',
};

/** Build a 16x16 inline SVG string from a category code */
export function getCategoryIconSvg(category: string, fill: string = '#fff'): string {
  const path = CATEGORY_ICONS[category] || CATEGORY_ICONS.CALL;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="${fill}" style="flex-shrink:0;"><path d="${path}"/></svg>`;
}

/** Build a small shield SVG for unit markers */
export function getUnitBadgeSvg(fill: string = '#fff'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="10" height="10" fill="${fill}" style="flex-shrink:0;opacity:0.7;"><path d="M8 1L2 4v4c0 4.4 2.6 8.5 6 9.5 3.4-1 6-5.1 6-9.5V4L8 1z"/></svg>`;
}
