/**
 * Charge normalization + severity classifier.
 *
 * Pure, dependency-free, no I/O. The first module of the multi-source
 * warrant-scraping framework: raw charge text from disparate county/state
 * sources is funneled through here so that severity + display form are
 * uniform regardless of origin.
 */

export interface NormalizedCharge {
  /** The original input, coerced to a string ('' for null/undefined/blank). */
  raw: string;
  /** Human-readable display form (Title Case, or DUI-tokenized). */
  normalized: string;
  severity: 'felony' | 'misdemeanor' | 'infraction' | 'unknown';
}

// Felony keywords win over infraction keywords when both are present.
// NOTE: matching is intentionally substring-based (so "weapon" matches
// "weapons") and intentionally biased toward felony — over-classifying a
// charge as more severe is the safer officer-safety direction. Do NOT add
// short/ambiguous tokens here (e.g. a bare 3-letter word) without switching
// to word-boundary matching, or they will misfire on unrelated charge text.
const FELONY_KEYWORDS = [
  'felony',
  'aggravated',
  'robbery',
  'burglary',
  'homicide',
  'murder',
  'rape',
  'kidnap',
  'weapon',
  'firearm',
  'trafficking',
  'distribution',
];

const INFRACTION_KEYWORDS = [
  'tail light',
  'speeding',
  'equipment',
  'registration',
  'seatbelt',
  'parking',
  'infraction',
  'expired',
];

const DUI_SYNONYMS = [
  'driving under the influence',
  'dui',
  'under the influence',
];

/** Title Case: capitalize first letter of each whitespace-delimited word, lowercase the rest. */
function toTitleCase(text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || token.length === 0) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join('');
}

/**
 * If `raw` is a JSON-array string, parse it and join the items with '; '.
 * Falls back to the raw string if it isn't valid JSON or isn't an array.
 */
function coalesceChargeText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (item == null ? '' : String(item).trim()))
        .filter((item) => item.length > 0)
        .join('; ');
    }
  } catch {
    // not valid JSON — fall through to raw
  }
  return trimmed;
}

function classifySeverity(text: string): NormalizedCharge['severity'] {
  const lower = text.toLowerCase();
  if (lower.trim().length === 0) return 'unknown';
  // Felony checked first so it wins ties against infraction keywords.
  if (FELONY_KEYWORDS.some((kw) => lower.includes(kw))) return 'felony';
  if (INFRACTION_KEYWORDS.some((kw) => lower.includes(kw))) return 'infraction';
  return 'misdemeanor';
}

export function normalizeCharge(raw: string | null | undefined): NormalizedCharge {
  if (raw == null || raw.trim().length === 0) {
    return { raw: '', normalized: '', severity: 'unknown' };
  }

  const text = coalesceChargeText(raw);
  const severity = classifySeverity(text);

  const lower = text.toLowerCase();
  const isDui = DUI_SYNONYMS.some((syn) => lower.includes(syn));

  const normalized = isDui ? `DUI — ${toTitleCase(text)}` : toTitleCase(text);

  return { raw, normalized, severity };
}
