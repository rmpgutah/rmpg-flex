// src/utils/serveIntakePreclean.ts
// ============================================================
// RMPG Flex — Serve Intake text pre-clean
// ============================================================
// Deterministic text hardening applied BEFORE any model sees a
// document. Every function here is pure and unit-tested offline —
// the model is the expensive, non-deterministic part, so anything
// that can be fixed without it is fixed here.
//
// Hazards addressed (observed in live ICU packets, 2026-07-26):
//   • Cyrillic/Greek homoglyphs from the docket's PDF font encoding
//     ("Palo Alto, СA 94304" — U+0421, not U+0043)
//   • Diagonal watermark stamps ("RUSH") whose glyphs land in the
//     text layer as isolated letters INSIDE table cells, corrupting
//     the Case / Court / Plaintiff / Defendant fields
// ============================================================

// Confusable → ASCII. Only characters that are visually identical to a
// Latin letter in common document fonts. Deliberately narrow: a wide
// map would corrupt genuine non-Latin names.
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic uppercase
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'У': 'Y', 'Х': 'X',
  // Cyrillic lowercase
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'у': 'y', 'х': 'x',
  // Greek uppercase
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H',
  'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O',
  'Ρ': 'P', 'Τ': 'T', 'Χ': 'X',
};

export function normalizeHomoglyphs(s: string): string {
  if (!s) return '';
  return s.replace(/[Ͱ-ӿ]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
}

// Stamps we expect to see rendered as scattered glyphs. Matching is done
// on the MULTISET of isolated letters, so the order the PDF emits them in
// (which follows the diagonal, not reading order) does not matter.
const WATERMARK_STAMPS = ['RUSH', 'COPY', 'FILED', 'DRAFT', 'VOID', 'SAMPLE'];

// A line is "isolated glyph" material when, after trimming, it is exactly
// one A-Z letter. Inline single letters ("Apt H") are never touched.
const ISOLATED_LETTER = /^\s*([A-Za-z])\s*$/;

export function scrubWatermarkBleed(s: string): string {
  if (!s) return '';
  const lines = s.split('\n');

  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ISOLATED_LETTER.test(lines[i])) candidates.push(i);
  }
  if (candidates.length < 3) return s;   // too few to reconstruct a stamp

  const letters = candidates.map((i) => lines[i].trim().toUpperCase());

  // A stamp is present when every one of its letters is available among the
  // isolated candidates (counting duplicates). We then drop exactly those.
  for (const stamp of WATERMARK_STAMPS) {
    const pool = new Map<string, number>();
    for (const l of letters) pool.set(l, (pool.get(l) ?? 0) + 1);

    let matches = true;
    for (const ch of stamp) {
      const have = pool.get(ch) ?? 0;
      if (have === 0) { matches = false; break; }
      pool.set(ch, have - 1);
    }
    if (!matches) continue;

    // Drop one candidate line per stamp letter, earliest first.
    const toDrop = new Set<number>();
    for (const ch of stamp) {
      const idx = candidates.find((i) => !toDrop.has(i) && lines[i].trim().toUpperCase() === ch);
      if (idx !== undefined) toDrop.add(idx);
    }
    return lines.filter((_, i) => !toDrop.has(i)).join('\n');
  }

  return s;
}

// Court forms use checkbox glyphs that OCR mangles into mismatched
// bracket pairs ("[X)", "[)"). The extraction prompt keys off "[X]" to
// decide which party box was ticked, so canonicalizing this is a
// correctness fix, not cosmetics.
export function normalizeCheckboxes(s: string): string {
  if (!s) return '';
  return s
    .replace(/\[\s*[xX]\s*[\])}]/g, '[X]')      // [X) [x} [ X ] → [X]
    .replace(/\[\s*[\])}]/g, '[ ]')             // [) [} []      → [ ]
    .replace(/\[\s{2,}\]/g, '[ ]');             // collapse padding
}

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
  'ﬅ': 'st', 'ﬆ': 'st',
};

// Explicit Unicode escapes throughout — copying literal invisible/lookalike
// characters (soft hyphen, non-breaking spaces, curly quotes) into source is
// a silent-corruption hazard: a soft hyphen that degrades to a regular
// hyphen would make this function delete real hyphens from addresses.
const SOFT_HYPHEN = /\u00AD/g;                          // U+00AD SOFT HYPHEN
const NBSP_VARIANTS = /[\u00A0\u2007\u202F]/g;         // U+00A0 NBSP, U+2007 figure space, U+202F narrow NBSP
const SINGLE_QUOTES = /[\u2018\u2019]/g;                 // curly single quotes (U+2018/U+2019) -> ASCII apostrophe
const DOUBLE_QUOTES = /[\u201C\u201D]/g;                 // curly double quotes (U+201C/U+201D) -> ASCII quote

// A line-ending hyphen is a word break only when the next line starts
// lowercase — "de-\ntainer" rejoins, "City-\nCounty" does not.
export function normalizeTypography(s: string): string {
  if (!s) return '';
  let out = s.replace(/[ﬀ-ﬆ]/g, (ch) => LIGATURES[ch] ?? ch);
  out = out.replace(SOFT_HYPHEN, '');                 // soft hyphen
  out = out.replace(NBSP_VARIANTS, ' ');              // non-breaking spaces
  out = out.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"');
  out = out.replace(/-\n([a-z])/g, '$1');             // broken word → rejoin
  out = out.replace(/-\n([A-Z])/g, '-$1');            // compound → keep hyphen
  return out;
}

// The full pre-clean pipeline. Order matters: watermark scrub first (before
// homoglyph mapping changes any glyphs the stamp matcher looks for),
// homoglyphs next (so later passes see ASCII), typography before checkbox
// repair (ligatures can sit inside a bracketed label).
export function precleanText(s: string): string {
  if (!s) return '';
  return normalizeCheckboxes(normalizeTypography(normalizeHomoglyphs(scrubWatermarkBleed(s))));
}
