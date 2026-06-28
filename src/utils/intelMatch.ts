// ============================================================
// RMPG Flex — Intel Search pure matching helpers
// ============================================================
// Identifier sniffing, normalization, and name similarity used by the
// intel indexer and /api/intel/search. No D1 / Hono imports — these are
// pure functions so a future Miniflare/vitest Worker suite can cover
// them standalone.
// ============================================================

export type IdentifierKind = 'plate' | 'phone' | 'dob' | 'record_number' | 'vin';

export interface SniffedIdentifier { kind: IdentifierKind; value: string }

// Live text columns store literal "None"/"N/A"/"0" instead of NULL
// (see project sentinel-strings rule) — never truthiness-check raw values.
export function isRealValue(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim();
  return s !== '' && !['none', 'n/a', 'na', 'null', '0', 'unknown'].includes(s.toLowerCase());
}

export function normalizePhone(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

export function normalizeAddress(v: string): string {
  return v.toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\b(street|str)\b/g, 'st').replace(/\bavenue\b/g, 'ave')
    .replace(/\bdrive\b/g, 'dr').replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g, 'rd').replace(/\blane\b/g, 'ln')
    .replace(/\b(apartment|apt|unit|suite|ste)\b\s*\S*/g, '')
    .replace(/\s+/g, ' ').trim();
}

export function normalizeName(v: string): string {
  return v.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Token-overlap name similarity in [0,1]; order-insensitive, tolerant of
// middle names: "john a smith" vs "smith john" → 1.0 on shared tokens.
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

// Detect what the user typed so exact identifier hits rank first.
export function sniffIdentifiers(q: string): SniffedIdentifier[] {
  const out: SniffedIdentifier[] = [];
  const t = q.trim();
  const digits = t.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) out.push({ kind: 'phone', value: normalizePhone(t) });
  if (/^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    out.push({ kind: 'dob', value: m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : t });
  }
  if (/^[A-Z0-9]{17}$/i.test(t)) out.push({ kind: 'vin', value: t.toUpperCase() });
  else if (/^[A-Z0-9]{2,8}$/i.test(t) && /\d/.test(t)) out.push({ kind: 'plate', value: t.toUpperCase() });
  if (/^(CFS|CASE|INC|W|CIT|FI|TO)[-#]?\d+/i.test(t) || /^\d{2,4}-\d{3,}$/.test(t)) {
    out.push({ kind: 'record_number', value: t.toUpperCase() });
  }
  return out;
}

// Escape a user query for FTS5 MATCH: quote each token, add prefix-* to
// the last token for type-ahead. Returns null when nothing searchable.
export function toFtsQuery(q: string): string | null {
  const tokens = q.trim().replace(/['"^*()]/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}
