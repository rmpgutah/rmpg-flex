// ============================================================
// RMPG Flex — Statewide land/property & road taxonomy
// ============================================================
// SINGLE SOURCE OF TRUTH for how statewide UGRC data is color-coded across
// the whole map. Before this module the same hex literals were hand-copied
// into three places — the vector-tile layer paint (useVectorTileLayers),
// the legend swatches (UnifiedMapLegend), and the click popups — so they
// silently drifted. Everything now derives from the tables below:
//
//   • PROPERTY_TYPES  — full building/property classification (code, label,
//     color, keyword matchers) for UGRC address points (`PtType`).
//   • ROAD_CLASSES    — UGRC road centerline classes (`CARTOCODE`).
//
// Helpers also *generate* the Mapbox GL `match` expressions used for the
// layer fills, so the rendered map and the legend can never disagree.
//
// Theme constraint (Spillman / Motorola pure-black): ZERO blue hues — the
// palette below is built from green/amber/red/violet/teal families only.
// ============================================================

export interface PropertyType {
  /** Short stable code shown as a chip in popups (RES, COM, …). */
  code: string;
  /** Human label for the legend + popup. */
  label: string;
  /** Swatch / dot color (no blue per theme). */
  color: string;
  /**
   * Lowercased substrings that classify a raw UGRC value to this type.
   * Order matters within a type, but BETWEEN types the first table entry
   * whose keyword matches wins — so put specific types before generic ones.
   */
  match: string[];
}

// Ordered most-specific → most-generic. classifyPtType walks this in order
// and returns the first type with a matching keyword, so e.g. "Church School"
// resolves to Religious before Education only if Religious is listed first;
// keep the ordering intentional.
export const PROPERTY_TYPES: PropertyType[] = [
  { code: 'GOV', label: 'Government',     color: '#a855f7', match: ['government', 'govt', 'civic', 'municipal', 'federal', 'court', 'city hall', 'fire', 'police', 'public safety', 'jail', 'prison'] },
  { code: 'EDU', label: 'Education',      color: '#8b5cf6', match: ['education', 'school', 'university', 'college', 'campus', 'academy', 'k-12', 'daycare', 'preschool'] },
  { code: 'REL', label: 'Religious',      color: '#c084fc', match: ['religi', 'church', 'worship', 'temple', 'chapel', 'synagog', 'mosque', 'ward', 'stake', 'lds'] },
  { code: 'MED', label: 'Medical',        color: '#ec4899', match: ['health', 'medical', 'hospital', 'clinic', 'care center', 'nursing', 'assisted living', 'urgent', 'dental'] },
  { code: 'REC', label: 'Recreation',     color: '#34d399', match: ['recreation', 'park', 'golf', 'sport', 'trail', 'pool', 'stadium', 'arena', 'campground', 'marina'] },
  { code: 'UTL', label: 'Utility',        color: '#eab308', match: ['utility', 'power', 'water', 'sewer', 'electric', 'gas', 'substation', 'wastewater', 'treatment plant', 'pump', 'tower', 'antenna'] },
  { code: 'TRN', label: 'Transportation', color: '#fb923c', match: ['transport', 'airport', 'transit', 'rail', 'station', 'parking', 'depot', 'hangar', 'terminal'] },
  { code: 'IND', label: 'Industrial',     color: '#ef4444', match: ['industr', 'warehouse', 'manufact', 'factory', 'distribution', 'storage', 'mining', 'refinery', 'plant'] },
  { code: 'AGR', label: 'Agricultural',   color: '#84cc16', match: ['agricult', 'agri', 'farm', 'ranch', 'dairy', 'orchard', 'barn', 'feedlot', 'livestock'] },
  { code: 'COM', label: 'Commercial',     color: '#f59e0b', match: ['commercial', 'business', 'retail', 'office', 'store', 'shop', 'restaurant', 'hotel', 'motel', 'bank', 'mall', 'gas station'] },
  { code: 'MIX', label: 'Mixed Use',      color: '#14b8a6', match: ['mixed'] },
  { code: 'RES', label: 'Residential',    color: '#22c55e', match: ['residen', 'single family', 'sfr', 'duplex', 'tri-plex', 'fourplex', 'apartment', 'multi', 'condo', 'townhome', 'townhouse', 'mobile', 'manufactured home', 'dwelling', 'home', 'house', 'cabin'] },
  { code: 'VAC', label: 'Vacant',         color: '#9ca3af', match: ['vacant', 'undeveloped', 'unimproved', 'empty', 'open space'] },
];

// Fallback / catch-all (never matched by keyword; returned when nothing fits).
export const PROPERTY_TYPE_OTHER: PropertyType = { code: 'OTH', label: 'Other', color: '#e8b84b', match: [] };

const _byCode = new Map<string, PropertyType>([...PROPERTY_TYPES, PROPERTY_TYPE_OTHER].map((t) => [t.code, t]));

/** Resolve a raw UGRC PtType (or any property descriptor) to a canonical type. */
export function classifyPtType(raw: unknown): PropertyType {
  if (raw == null) return PROPERTY_TYPE_OTHER;
  const s = String(raw).toLowerCase().trim();
  if (!s) return PROPERTY_TYPE_OTHER;
  for (const t of PROPERTY_TYPES) {
    for (const kw of t.match) if (s.includes(kw)) return t;
  }
  return PROPERTY_TYPE_OTHER;
}

export function propertyTypeByCode(code: string): PropertyType {
  return _byCode.get(code) || PROPERTY_TYPE_OTHER;
}

/**
 * Build a Mapbox GL `match` expression that colors a feature by its `PtType`.
 * Generated from PROPERTY_TYPES so the rendered fill always matches the legend.
 * UGRC PtType is free-ish text, so we upcase + match on the EXACT canonical
 * spellings plus their primary synonyms (full keyword matching is done in JS
 * for popups; the GL expression covers the common exact domain values).
 */
export function ptTypeColorExpression(fallback: string = PROPERTY_TYPE_OTHER.color): any {
  // Map a curated set of exact UGRC domain spellings to each type's color.
  // (GL `match` needs literal labels — it can't run substring logic — so we
  // enumerate the realistic source spellings here.)
  const EXACT: [string, string][] = [
    ['RESIDENTIAL', 'RES'], ['SINGLE FAMILY', 'RES'], ['MULTI FAMILY', 'RES'], ['MULTI-FAMILY', 'RES'], ['APARTMENT', 'RES'], ['CONDO', 'RES'], ['TOWNHOME', 'RES'], ['MOBILE HOME', 'RES'], ['DWELLING', 'RES'],
    ['COMMERCIAL', 'COM'], ['BUSINESS', 'COM'], ['RETAIL', 'COM'], ['OFFICE', 'COM'], ['HOTEL', 'COM'], ['MOTEL', 'COM'],
    ['INDUSTRIAL', 'IND'], ['WAREHOUSE', 'IND'], ['MANUFACTURING', 'IND'], ['STORAGE', 'IND'],
    ['AGRICULTURAL', 'AGR'], ['AGRICULTURE', 'AGR'], ['FARM', 'AGR'], ['RANCH', 'AGR'],
    ['MIXED USE', 'MIX'], ['MIXED', 'MIX'],
    ['GOVERNMENT', 'GOV'], ['CIVIC', 'GOV'], ['MUNICIPAL', 'GOV'], ['PUBLIC', 'GOV'],
    ['EDUCATION', 'EDU'], ['SCHOOL', 'EDU'], ['UNIVERSITY', 'EDU'], ['COLLEGE', 'EDU'],
    ['RELIGIOUS', 'REL'], ['CHURCH', 'REL'], ['WORSHIP', 'REL'],
    ['HEALTH', 'MED'], ['MEDICAL', 'MED'], ['HOSPITAL', 'MED'], ['CLINIC', 'MED'],
    ['RECREATION', 'REC'], ['PARK', 'REC'], ['GOLF', 'REC'],
    ['UTILITY', 'UTL'], ['POWER', 'UTL'], ['WATER', 'UTL'],
    ['TRANSPORTATION', 'TRN'], ['AIRPORT', 'TRN'], ['TRANSIT', 'TRN'], ['PARKING', 'TRN'],
    ['VACANT', 'VAC'], ['UNDEVELOPED', 'VAC'],
  ];
  const expr: any[] = ['match', ['upcase', ['to-string', ['get', 'PtType']]]];
  for (const [label, code] of EXACT) {
    expr.push(label, propertyTypeByCode(code).color);
  }
  expr.push(fallback);
  return expr;
}

// ────────────────────────────────────────────────────────────
// Roads (UGRC CARTOCODE road centerline classes)
// ────────────────────────────────────────────────────────────

export interface RoadClass {
  code: string;        // CARTOCODE value as string
  label: string;
  color: string;       // no blue per theme
  /** Render tier: higher = thicker/wins label collisions. */
  tier: number;
  /** Show this class in the compact legend? */
  legend?: boolean;
}

export const ROAD_CLASSES: RoadClass[] = [
  { code: '1',  label: 'Interstate',    color: '#ef4444', tier: 5, legend: true },
  { code: '2',  label: 'US Highway',    color: '#f59e0b', tier: 4, legend: true },
  { code: '3',  label: 'State Highway', color: '#e8b84b', tier: 3, legend: true },
  { code: '4',  label: 'Ramp',          color: '#caa53a', tier: 3 },
  { code: '5',  label: 'Major Road',    color: '#c3ccd6', tier: 2, legend: true },
  { code: '6',  label: 'Arterial',      color: '#b8901a', tier: 2 },
  { code: '7',  label: 'Collector',     color: '#a07d17', tier: 1 },
  { code: '8',  label: 'Local',         color: '#8a6f1e', tier: 0, legend: true },
  { code: '9',  label: 'Local',         color: '#8a6f1e', tier: 0 },
  { code: '10', label: 'Service',       color: '#6b5a1c', tier: 0 },
  { code: '11', label: 'Local Street',  color: '#8a6f1e', tier: 0 },
  { code: '12', label: 'Driveway',      color: '#5a4d1a', tier: 0 },
];

const _roadByCode = new Map(ROAD_CLASSES.map((r) => [r.code, r]));

export function classifyCartocode(raw: unknown): RoadClass {
  const r = _roadByCode.get(String(raw));
  return r || { code: String(raw ?? ''), label: raw != null ? `Code ${raw}` : 'Road', color: '#8a6f1e', tier: 0 };
}

/** Distinct legend rows for roads (deduped by label, in tier order). */
export function roadLegendRows(): { label: string; color: string }[] {
  const seen = new Set<string>();
  const rows: { label: string; color: string }[] = [];
  for (const r of ROAD_CLASSES) {
    if (!r.legend || seen.has(r.label)) continue;
    seen.add(r.label);
    rows.push({ label: r.label, color: r.color });
  }
  return rows;
}

/** GL `match` expression: CARTOCODE → road color (generated from ROAD_CLASSES). */
export function roadColorExpression(fallback: string = '#8a6f1e'): any {
  const expr: any[] = ['match', ['to-string', ['get', 'CARTOCODE']]];
  for (const r of ROAD_CLASSES) expr.push(r.code, r.color);
  expr.push(fallback);
  return expr;
}

/** GL `match` expression: CARTOCODE → label sort key (lower = wins collisions). */
export function roadSortKeyExpression(): any {
  const expr: any[] = ['match', ['to-string', ['get', 'CARTOCODE']]];
  // Invert tier (higher tier → lower sort key so it wins).
  for (const r of ROAD_CLASSES) expr.push(r.code, 5 - r.tier);
  expr.push(9);
  return expr;
}

/** Legend rows for property/building types (full taxonomy + Other). */
export function propertyLegendRows(): { code: string; label: string; color: string }[] {
  return [...PROPERTY_TYPES, PROPERTY_TYPE_OTHER].map((t) => ({ code: t.code, label: t.label, color: t.color }));
}
