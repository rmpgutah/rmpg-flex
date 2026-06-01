// ============================================================
// Map Page — Types & Constants (Mapbox GL JS)
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
  gps_speed?: number | null;       // m/s from GPS tracker
  gps_heading?: number | null;     // degrees 0-360
  battery_level?: number | null;   // 0-100 from mobile device
  dispatched_at?: string | null;   // timestamp when dispatched to current call
  onscene_at?: string | null;      // timestamp when arrived on scene
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
  created_at?: string | null;
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
  if (!type) return { symbol: '\u25CF', category: 'CALL' };
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

// ── Map Style Icons ──────────────────────────────────────────

export const MAP_STYLE_ICONS: Record<MapStyleId, string> = {
  dark: '\u{1F319}',        // crescent moon
  satellite: '\u{1F6F0}',   // satellite
  hybrid: '\u{1F30D}',      // globe
  streets: '\u{1F6E3}',     // motorway
  terrain: '\u26F0',        // mountain
  night_nav: '\u{1F5FA}',   // world map
};

export function getMapStyleIcon(style: MapStyleId): string {
  return MAP_STYLE_ICONS[style] || '\u{1F5FA}';
}

// ── Incident Category Colors ─────────────────────────────────

export const INCIDENT_CATEGORY_COLORS: Record<string, string> = {
  THEFT: '#f59e0b',
  ASLT: '#ef4444',
  TRFC: '#888888',
  FIRE: '#f97316',
  MED: '#22c55e',
  SUSP: '#a855f7',
  ALM: '#eab308',
  TRSP: '#888888',
  DV: '#ec4899',
  DRUG: '#14b8a6',
  VNDL: '#f43f5e',
  PTRL: '#aaaaaa',
  NOIS: '#84cc16',
  FRAD: '#8b5cf6',
  MISP: '#fb923c',
  WPNS: '#dc2626',
  WRNT: '#7c3aed',
  HZMT: '#fbbf24',
  ANML: '#a3e635',
  CALL: '#666666',
};

export function getIncidentCategoryColor(type: string): string {
  const { category } = getIncidentCategory(type);
  return INCIDENT_CATEGORY_COLORS[category] || '#666666';
}

// ── Incident Category Glyphs (lucide-style monochrome SVG) ───────
// One or more SVG <path d="..."> strings per category, drawn in a 0 0 24 24
// viewBox, meant to render as a stroked monochrome glyph (no fill). Replaces
// the OS-dependent emoji set so call markers read crisply at any zoom and
// match the rest of the app's lucide iconography. Keys match getIncidentCategory's
// `category` codes; CALL is the generic fallback.
export const INCIDENT_CATEGORY_GLYPHS: Record<string, string[]> = {
  // key (lucide key-round)
  THEFT: ['M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z', 'M16.5 7.5h.01'],
  // zap (lightning strike → reads as violence/assault; distinct from the bell)
  ASLT: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
  // car
  TRFC: ['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.5 8h-13L4 11.1C3.2 11.3 2.5 12.1 2.5 13v3c0 .6.4 1 1 1h2', 'M5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0', 'M15 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0', 'M5 11h14'],
  // flame
  FIRE: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
  // plus/cross (medical)
  MED: ['M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2z'],
  // eye (suspicious)
  SUSP: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6'],
  // bell (alarm)
  ALM: ['M10.268 21a2 2 0 0 0 3.464 0', 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326'],
  // circle-slash (trespass)
  TRSP: ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'm4.9 4.9 14.2 14.2'],
  // home (domestic)
  DV: ['M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  // pill (drugs)
  DRUG: ['M10.5 20.5 21 10a2.5 2.5 0 0 0-3.5-3.5L7 17a2.5 2.5 0 1 0 3.5 3.5Z', 'm8.5 8.5 7 7'],
  // x (vandalism)
  VNDL: ['M18 6 6 18', 'm6 6 12 12'],
  // shield (patrol)
  PTRL: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
  // volume (noise)
  NOIS: ['M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z', 'M16 9a5 5 0 0 1 0 6', 'M19.364 18.364a9 9 0 0 0 0-12.728'],
  // file (fraud)
  FRAD: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M9 13h6', 'M9 17h6'],
  // help (missing)
  MISP: ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
  // crosshair (weapons)
  WPNS: ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'M22 12h-4', 'M6 12H2', 'M12 6V2', 'M12 22v-4'],
  // clipboard (warrant)
  WRNT: ['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1', 'M9 12h6', 'M9 16h6'],
  // triangle-alert (hazmat)
  HZMT: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  // paw (animal)
  ANML: ['M11 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4', 'M18 5a2 2 0 1 0 0 4 2 2 0 1 0 0-4', 'M20 11a2 2 0 1 0 0 4 2 2 0 1 0 0-4', 'M6 5a2 2 0 1 0 0 4 2 2 0 1 0 0-4', 'M5.4 18.3A4 4 0 0 1 9 16h6a4 4 0 0 1 3.6 2.3 2.5 2.5 0 0 1-2.4 3.7c-1.4 0-2.8-.5-4.2-.5s-2.8.5-4.2.5a2.5 2.5 0 0 1-2.4-3.7'],
  // dot (generic call) — circle
  CALL: ['M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10'],
};

export function getIncidentCategoryGlyph(type: string): string[] {
  const { category } = getIncidentCategory(type);
  return INCIDENT_CATEGORY_GLYPHS[category] || INCIDENT_CATEGORY_GLYPHS.CALL;
}

// ── Map Zoom Breakpoints ─────────────────────────────────────

export const MAP_ZOOM_BREAKPOINTS = { overview: 10, neighborhood: 13, street: 15, building: 18 } as const;

export function getZoomLevel(zoom: number): 'overview' | 'neighborhood' | 'street' | 'building' {
  if (!Number.isFinite(zoom)) return 'overview';
  if (zoom >= MAP_ZOOM_BREAKPOINTS.building) return 'building';
  if (zoom >= MAP_ZOOM_BREAKPOINTS.street) return 'street';
  if (zoom >= MAP_ZOOM_BREAKPOINTS.neighborhood) return 'neighborhood';
  return 'overview';
}
