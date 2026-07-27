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
