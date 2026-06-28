// ============================================================
// Utah statutes — most-issued dictionary (PR 1 stop-gap)
// ============================================================
// Drives the autocomplete suggestion list in CitationAuthor's
// statute picker. Replaced in PR 5 with a full le.utah.gov-sourced
// `utah_statutes` D1 table (~3,500 rows).
//
// Each row carries the citation_class, default_fine, and whether
// court appearance is mandatory — enough to auto-populate the
// citation when the officer picks a statute.
//
// Fines reflect the Utah Uniform Fine Schedule (FY 2026) as
// published by the Utah Judicial Council, plus the standard
// $90 surcharge where applicable. Officers can override per
// citation.

export type UtahOffenseClass =
  | 'infraction'
  | 'class-c-misdemeanor'
  | 'class-b-misdemeanor'
  | 'class-a-misdemeanor'
  | 'third-degree-felony'
  | 'second-degree-felony'
  | 'first-degree-felony';

export interface UtahStatuteEntry {
  /** Full citation string as it appears on the form, e.g. '41-6a-601'. */
  code: string;
  /** Short description for the picker dropdown. */
  description: string;
  /** Offense class — drives the form's Class column. */
  offense_class: UtahOffenseClass;
  /** Default fine in dollars (Uniform Fine Schedule + surcharge). */
  default_fine: number;
  /** Whether the defendant MUST appear in court (vs pay-to-resolve). */
  mandatory_appearance: boolean;
  /** Search keywords — typed by officer to find this statute. */
  keywords: string[];
}

export const UTAH_STATUTES_COMMON: ReadonlyArray<UtahStatuteEntry> = [
  // ── Title 41 — Motor Vehicles (most common citation category) ──
  // Speeding (41-6a-601)
  { code: '41-6a-601', description: 'Speed — exceeding posted limit (1–10 over)', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['speed', 'speeding', 'speeding 1-10', 'limit'] },
  { code: '41-6a-601', description: 'Speed — exceeding posted limit (11–20 over)', offense_class: 'infraction', default_fine: 120, mandatory_appearance: false, keywords: ['speed', 'speeding', 'speeding 11-20'] },
  { code: '41-6a-601', description: 'Speed — exceeding posted limit (21+ over)', offense_class: 'class-c-misdemeanor', default_fine: 270, mandatory_appearance: true, keywords: ['speed', 'speeding', 'reckless', 'speeding 21+'] },
  { code: '41-6a-601(2)', description: 'Speed — school zone violation', offense_class: 'class-c-misdemeanor', default_fine: 320, mandatory_appearance: false, keywords: ['speed', 'school zone', 'school'] },
  { code: '41-6a-601(3)', description: 'Speed — construction zone violation', offense_class: 'class-c-misdemeanor', default_fine: 320, mandatory_appearance: false, keywords: ['speed', 'construction', 'work zone'] },

  // Stop signs & signals
  { code: '41-6a-902', description: 'Failure to stop at stop sign', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['stop sign', 'stop', 'sign'] },
  { code: '41-6a-305', description: 'Failure to obey traffic control device (red light)', offense_class: 'infraction', default_fine: 120, mandatory_appearance: false, keywords: ['red light', 'signal', 'traffic light'] },
  { code: '41-6a-1002', description: 'Failure to yield right of way', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['yield', 'right of way'] },
  { code: '41-6a-704', description: 'Improper lane change / not maintaining lane', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['lane change', 'lane', 'weaving'] },
  { code: '41-6a-711', description: 'Following too closely / tailgating', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['follow', 'tailgating', 'tailgate', 'following'] },
  { code: '41-6a-714', description: 'Improper passing', offense_class: 'infraction', default_fine: 120, mandatory_appearance: false, keywords: ['pass', 'passing', 'overtake'] },

  // DUI & impairment
  { code: '41-6a-502', description: 'Driving under the influence — first offense', offense_class: 'class-b-misdemeanor', default_fine: 1455, mandatory_appearance: true, keywords: ['dui', 'drunk', 'impaired', 'alcohol'] },
  { code: '41-6a-502', description: 'Driving under the influence — second offense', offense_class: 'class-a-misdemeanor', default_fine: 2105, mandatory_appearance: true, keywords: ['dui', 'second', 'repeat'] },
  { code: '41-6a-517', description: 'Impaired driving (alcohol-related lesser)', offense_class: 'class-b-misdemeanor', default_fine: 1330, mandatory_appearance: true, keywords: ['impaired', 'impairment'] },
  { code: '41-6a-528', description: 'Reckless driving', offense_class: 'class-b-misdemeanor', default_fine: 590, mandatory_appearance: true, keywords: ['reckless', 'careless'] },
  { code: '41-6a-1716', description: 'Wireless device use while operating (texting)', offense_class: 'class-c-misdemeanor', default_fine: 145, mandatory_appearance: false, keywords: ['phone', 'text', 'texting', 'wireless', 'cell'] },

  // Equipment & licensing
  { code: '41-1a-401', description: 'Expired vehicle registration', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['registration', 'expired', 'plates'] },
  { code: '41-1a-1303', description: 'Failure to display registration / plates', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['plates', 'no plates', 'display'] },
  { code: '41-12a-301', description: 'Failure to have proof of insurance', offense_class: 'class-b-misdemeanor', default_fine: 405, mandatory_appearance: false, keywords: ['insurance', 'no insurance', 'uninsured'] },
  { code: '53-3-202', description: 'Driving without valid driver license', offense_class: 'class-c-misdemeanor', default_fine: 220, mandatory_appearance: false, keywords: ['license', 'no license', 'unlicensed'] },
  { code: '53-3-227', description: 'Driving on suspended/revoked license', offense_class: 'class-b-misdemeanor', default_fine: 690, mandatory_appearance: true, keywords: ['suspended', 'revoked', 'license'] },
  { code: '53-3-217', description: 'Failure to display driver license on demand', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['license', 'display'] },

  // Equipment violations
  { code: '41-6a-1601', description: 'Defective vehicle equipment (general)', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['equipment', 'defective'] },
  { code: '41-6a-1604', description: 'Defective headlamps', offense_class: 'infraction', default_fine: 60, mandatory_appearance: false, keywords: ['lights', 'headlight', 'headlamp'] },
  { code: '41-6a-1607', description: 'Defective tail lamps / brake lights', offense_class: 'infraction', default_fine: 60, mandatory_appearance: false, keywords: ['lights', 'taillight', 'brake'] },
  { code: '41-6a-1611', description: 'Window tint violation', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['tint', 'window'] },
  { code: '41-6a-1722', description: 'Sound system / loud exhaust', offense_class: 'infraction', default_fine: 90, mandatory_appearance: false, keywords: ['exhaust', 'muffler', 'loud'] },

  // Restraint laws
  { code: '41-6a-1803', description: 'Seat belt violation', offense_class: 'infraction', default_fine: 45, mandatory_appearance: false, keywords: ['seatbelt', 'seat belt', 'belt'] },
  { code: '41-6a-1803.5', description: 'Child restraint violation', offense_class: 'infraction', default_fine: 45, mandatory_appearance: false, keywords: ['child', 'car seat', 'restraint'] },

  // Parking (RMPG-specific, common on HOA contracts)
  { code: '41-6a-1402', description: 'Parking in fire lane', offense_class: 'infraction', default_fine: 50, mandatory_appearance: false, keywords: ['parking', 'fire lane', 'fire'] },
  { code: '41-6a-1402', description: 'Parking in handicap zone without permit', offense_class: 'infraction', default_fine: 300, mandatory_appearance: false, keywords: ['parking', 'handicap', 'ada', 'accessible'] },
  { code: '41-6a-1402', description: 'Parking in no-parking zone', offense_class: 'infraction', default_fine: 35, mandatory_appearance: false, keywords: ['parking', 'no parking'] },
  { code: '41-6a-1402', description: 'Blocking driveway / access', offense_class: 'infraction', default_fine: 50, mandatory_appearance: false, keywords: ['parking', 'driveway', 'block'] },
  { code: '41-6a-1402', description: 'Parking across two stalls', offense_class: 'infraction', default_fine: 50, mandatory_appearance: false, keywords: ['parking', 'stalls', 'multi'] },
  { code: '41-6a-1402', description: 'Parking on grass / common area', offense_class: 'infraction', default_fine: 50, mandatory_appearance: false, keywords: ['parking', 'grass', 'lawn'] },

  // Criminal Code (Title 76) — common on RMPG civil/criminal citations
  { code: '76-9-102', description: 'Disorderly conduct', offense_class: 'class-c-misdemeanor', default_fine: 145, mandatory_appearance: false, keywords: ['disorderly', 'disturbance'] },
  { code: '76-9-103', description: 'Disturbing the peace', offense_class: 'class-c-misdemeanor', default_fine: 145, mandatory_appearance: false, keywords: ['peace', 'disturb', 'noise'] },
  { code: '76-9-501', description: 'Public intoxication', offense_class: 'class-c-misdemeanor', default_fine: 145, mandatory_appearance: false, keywords: ['intoxicated', 'drunk', 'public'] },
  { code: '76-6-202', description: 'Criminal trespass (private property)', offense_class: 'class-b-misdemeanor', default_fine: 590, mandatory_appearance: true, keywords: ['trespass', 'trespassing'] },
  { code: '76-6-206', description: 'Criminal mischief / vandalism', offense_class: 'class-b-misdemeanor', default_fine: 590, mandatory_appearance: true, keywords: ['mischief', 'vandalism', 'damage'] },
  { code: '76-6-404', description: 'Theft (under $500)', offense_class: 'class-b-misdemeanor', default_fine: 590, mandatory_appearance: true, keywords: ['theft', 'steal', 'shoplifting'] },
  { code: '76-5-102', description: 'Assault (simple)', offense_class: 'class-b-misdemeanor', default_fine: 690, mandatory_appearance: true, keywords: ['assault', 'fight'] },
  { code: '76-5-106', description: 'Threat of violence', offense_class: 'class-b-misdemeanor', default_fine: 590, mandatory_appearance: true, keywords: ['threat', 'threaten'] },
  { code: '76-10-505', description: 'Possession of dangerous weapon in restricted area', offense_class: 'class-a-misdemeanor', default_fine: 920, mandatory_appearance: true, keywords: ['weapon', 'gun', 'firearm'] },
  { code: '58-37-8', description: 'Possession of controlled substance', offense_class: 'class-b-misdemeanor', default_fine: 690, mandatory_appearance: true, keywords: ['drugs', 'narcotic', 'controlled', 'substance'] },
  { code: '76-10-1305', description: 'Loitering / prowling', offense_class: 'class-c-misdemeanor', default_fine: 145, mandatory_appearance: false, keywords: ['loitering', 'prowling'] },

  // Civil / HOA enforcement (common in RMPG private contract zones)
  { code: 'HOA-1', description: 'HOA covenant violation — pet at large', offense_class: 'infraction', default_fine: 50, mandatory_appearance: false, keywords: ['hoa', 'pet', 'dog', 'leash'] },
  { code: 'HOA-2', description: 'HOA covenant violation — unauthorized trash / debris', offense_class: 'infraction', default_fine: 50, mandatory_appearance: false, keywords: ['hoa', 'trash', 'debris', 'garbage'] },
  { code: 'HOA-3', description: 'HOA covenant violation — unauthorized vehicle (RV/boat/commercial)', offense_class: 'infraction', default_fine: 75, mandatory_appearance: false, keywords: ['hoa', 'rv', 'boat', 'commercial', 'unauthorized'] },
  { code: 'HOA-4', description: 'HOA covenant violation — noise / quiet hours', offense_class: 'infraction', default_fine: 50, mandatory_appearance: false, keywords: ['hoa', 'noise', 'quiet'] },
  { code: 'HOA-5', description: 'HOA covenant violation — landscaping / unsightly condition', offense_class: 'infraction', default_fine: 50, mandatory_appearance: false, keywords: ['hoa', 'landscape', 'lawn', 'unsightly'] },
];

/**
 * Filter statutes by case-insensitive keyword match — used by the
 * picker's autocomplete. Empty/short query returns the first 12 by
 * default ordering so the dropdown isn't blank on focus.
 */
export function searchUtahStatutes(query: string): UtahStatuteEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return UTAH_STATUTES_COMMON.slice(0, 12);
  return UTAH_STATUTES_COMMON.filter((s) =>
    s.code.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.keywords.some((k) => k.includes(q)),
  ).slice(0, 12);
}

/**
 * Lookup by exact code match. Returns the first matching entry — some
 * codes (e.g., 41-6a-601 speeding) have multiple ranges, in which case
 * the caller should also use description to disambiguate.
 */
export function findStatuteByCode(code: string | null | undefined): UtahStatuteEntry | undefined {
  if (!code) return undefined;
  return UTAH_STATUTES_COMMON.find((s) => s.code === code.trim());
}

/**
 * Human-readable label for the offense class column on the citation.
 * 'infraction' → 'Infraction', 'class-c-misdemeanor' → 'Class C Misd.', etc.
 */
export function offenseClassLabel(cls: UtahOffenseClass): string {
  switch (cls) {
    case 'infraction':           return 'Infraction';
    case 'class-c-misdemeanor':  return 'Class C Misd.';
    case 'class-b-misdemeanor':  return 'Class B Misd.';
    case 'class-a-misdemeanor':  return 'Class A Misd.';
    case 'third-degree-felony':  return '3rd Deg Fel';
    case 'second-degree-felony': return '2nd Deg Fel';
    case 'first-degree-felony':  return '1st Deg Fel';
  }
}
