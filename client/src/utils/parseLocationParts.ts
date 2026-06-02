// ============================================================
// RMPG Flex — Location Sub-Address Parser
// ============================================================
// Geocoders (Mapbox / Nominatim) resolve a street address to a single point,
// but they DROP the sub-address a dispatcher often types: a suite, unit,
// apartment, building, or floor. CAD location detail (Building / Floor /
// Room-Suite) lives in its own set of fields on a call, so we extract those
// tokens from the RAW address text the dispatcher entered — not from the
// geocoder result, which has already normalized them away.
//
// "If added" is the contract: a field stays empty unless the text contains a
// recognizable designator. We never guess.
//
// ── DESIGN DECISION (RMPG dispatch convention) ───────────────────────────────
// The keyword sets below are the one place to tune how YOUR dispatchers write
// sub-addresses. Two choices worth knowing about:
//   • A bare "#302" is treated as a SUITE / UNIT (the common case for the
//     commercial properties RMPG patrols). If your sites use "#" to mean a
//     building number, move the "#" alternative from SUITE_RE into BUILDING_RE.
//   • Floor accepts both "Floor 3" and the trailing-ordinal form "3rd Floor".
// ─────────────────────────────────────────────────────────────────────────────

export interface LocationParts {
  /** Building / tower / block designator, e.g. "A", "2" (from "Tower 2"). */
  building: string;
  /** Floor / level, e.g. "3", "3rd". */
  floor: string;
  /** Suite / unit / apartment / room number, e.g. "200", "4B". */
  suite: string;
}

const EMPTY: LocationParts = { building: '', floor: '', suite: '' };

// Building: "Bldg A", "Building 2", "Tower 3", "Block C". The leading \b keeps
// "rebuilding"/"unblock" from matching; the captured token is letters/digits
// and may contain an internal dash ("A-1").
const BUILDING_RE = /\b(?:bldg|building|tower|twr|block|blk)\s*\.?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]*)/i;

// Floor: try the trailing-ordinal form ("3rd Floor", "2nd Fl") FIRST so it
// yields the ordinal ("3rd"); fall back to the keyword-first form ("Floor 3",
// "Level 2"). Capped at 3 digits so a ZIP can't masquerade as a floor.
const FLOOR_ORDINAL_RE = /\b(\d{1,3}(?:st|nd|rd|th))\s+(?:floor|fl|flr|level|lvl)\b/i;
const FLOOR_KEYWORD_RE = /\b(?:floor|fl|flr|level|lvl)\s*\.?\s*#?\s*(\d{1,3}(?:st|nd|rd|th)?)\b/i;

// Suite / Unit / Apt / Room / "#": "Ste 200", "Suite 200", "Unit 4B", "Apt 5",
// "Room 12", "#302". The bare-"#" branch is last so the keyword forms win when
// both could match.
const SUITE_RE = /(?:\b(?:ste|suite|unit|apt|apartment|rm|room)\b\s*\.?\s*#?\s*|#\s*)([A-Za-z0-9][A-Za-z0-9-]*)/i;

/**
 * Extract { building, floor, suite } from a freehand address string. Every
 * field defaults to '' (absent), so callers can safely fill-if-empty without
 * clobbering anything the dispatcher typed by hand.
 */
export function parseLocationParts(address: string): LocationParts {
  const text = (address || '').trim();
  if (!text) return { ...EMPTY };

  const building = text.match(BUILDING_RE)?.[1]?.trim() || '';
  const floor =
    text.match(FLOOR_ORDINAL_RE)?.[1]?.trim() ||
    text.match(FLOOR_KEYWORD_RE)?.[1]?.trim() ||
    '';
  const suite = text.match(SUITE_RE)?.[1]?.trim() || '';

  return { building, floor, suite };
}
