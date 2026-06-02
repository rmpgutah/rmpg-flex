// ============================================================
// RMPG Flex — Location Sub-Address Parser (Worker side)
// ============================================================
// MIRROR of client/src/utils/parseLocationParts.ts. The Worker and the React
// app share no build (see CLAUDE.md gotcha #2), so the pure logic is duplicated
// here for the server-side Serve Intake commit. Keep the two in sync.
//
// Geocoders normalize away sub-address tokens (Ste/Unit/Floor), so we extract
// Building / Floor / Suite from the raw address string the intake produced.
// "If present" is the contract: a field stays empty unless a recognizable
// designator is found.

export interface LocationParts {
  building: string;
  floor: string;
  suite: string;
}

const EMPTY: LocationParts = { building: '', floor: '', suite: '' };

const BUILDING_RE = /\b(?:bldg|building|tower|twr|block|blk)\s*\.?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]*)/i;
const FLOOR_ORDINAL_RE = /\b(\d{1,3}(?:st|nd|rd|th))\s+(?:floor|fl|flr|level|lvl)\b/i;
const FLOOR_KEYWORD_RE = /\b(?:floor|fl|flr|level|lvl)\s*\.?\s*#?\s*(\d{1,3}(?:st|nd|rd|th)?)\b/i;
const SUITE_RE = /(?:\b(?:ste|suite|unit|apt|apartment|rm|room)\b\s*\.?\s*#?\s*|#\s*)([A-Za-z0-9][A-Za-z0-9-]*)/i;

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
