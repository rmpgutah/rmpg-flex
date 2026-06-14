const AMBIGUITY: Record<string, string> = { O: '0', I: '1', S: '5', B: '8', Z: '2' };

/** Canonical comparison form: uppercase, alphanumerics only, ambiguous glyphs folded. */
export function normalizePlate(raw: string): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/[OISBZ]/g, (c) => AMBIGUITY[c] ?? c);
}

/** One jurisdiction's plate grammar. Seeded with UT + neighbors + CA; extend freely. */
export interface PlateFormat { code: string; label: string; regex: RegExp; }

export const PLATE_FORMATS: PlateFormat[] = [
  { code: 'UT', label: 'Utah',     regex: /^[A-Z]\d{2}[A-Z]{2}$|^\d{3}[A-Z]{3}$/ },
  { code: 'CA', label: 'California', regex: /^\d[A-Z]{3}\d{3}$/ },
  { code: 'AZ', label: 'Arizona',  regex: /^[A-Z]{3}\d{4}$/ },
  { code: 'NV', label: 'Nevada',   regex: /^\d{3}[A-Z]\d{2}$|^[A-Z]{3}\d{3}$/ },
  { code: 'ID', label: 'Idaho',    regex: /^[A-Z]\d{6}$|^\d[A-Z]\d{5}$/ },
  { code: 'WY', label: 'Wyoming',  regex: /^\d{1,2}-?\d{3,5}$/ },
];

export interface FormatResult { score: number; jurisdiction: string | null; }

/** Best jurisdiction match for a RAW (un-normalized) plate. */
export function formatScore(rawPlate: string): FormatResult {
  const plate = (rawPlate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    .replace(/[OISBZ]/g, (ch) => AMBIGUITY[ch] ?? ch);
  if (plate.length < 2) return { score: 0.1, jurisdiction: null };
  for (const f of PLATE_FORMATS) {
    if (f.regex.test(plate)) return { score: 0.95, jurisdiction: f.code };
  }
  return { score: /^[A-Z0-9]{5,8}$/.test(plate) ? 0.5 : 0.2, jurisdiction: null };
}

export interface ConsensusResult {
  canonical: string;
  ratio: number;
  readCount: number;
  variants: { plate: string; count: number }[];
}

/** Cluster reads by normalized form; winner = largest cluster, displayed as its
 *  most common ORIGINAL spelling. ratio = winningClusterSize / total. */
export function consensus(reads: string[]): ConsensusResult {
  const valid = (reads ?? []).filter((r) => r && r.trim());
  if (valid.length === 0) return { canonical: '', ratio: 0, readCount: 0, variants: [] };

  const clusters = new Map<string, string[]>();
  for (const r of valid) {
    const key = normalizePlate(r);
    (clusters.get(key) ?? clusters.set(key, []).get(key)!).push(r.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }
  let bestKey = ''; let bestArr: string[] = [];
  for (const [k, arr] of clusters) if (arr.length > bestArr.length) { bestKey = k; bestArr = arr; }

  const spell = new Map<string, number>();
  for (const s of bestArr) spell.set(s, (spell.get(s) ?? 0) + 1);
  const canonical = [...spell.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const variants = [...clusters.entries()]
    .filter(([k]) => k !== bestKey)
    .map(([, arr]) => ({ plate: arr[0], count: arr.length }));

  return { canonical, ratio: bestArr.length / valid.length, readCount: valid.length, variants };
}

export interface TrustInput {
  reads: string[];
  modelPct?: number;
}
export interface TrustResult {
  canonical: string;
  trustScore: number;
  basis: string;
  consensusRatio: number;
  readCount: number;
  variants: { plate: string; count: number }[];
  jurisdiction: string | null;
}

/** Derived trust. Consensus dominates; format validity is a strong factor; the
 *  model's self-reported % is at most a small tiebreaker. A single read is hard-
 *  capped below the assert gate (no corroboration). */
export function trustScore(input: TrustInput): TrustResult {
  if ((input.reads ?? []).filter((r) => r && r.trim()).length === 0) {
    return { canonical: '', trustScore: 0, basis: 'no reads', consensusRatio: 0,
             readCount: 0, variants: [], jurisdiction: null };
  }
  const c = consensus(input.reads);
  const fmt = formatScore(c.canonical);
  const parts: string[] = [];

  const consensusComponent = c.readCount <= 1 ? 0.45 : 0.45 + 0.30 * c.ratio;
  if (c.readCount <= 1) parts.push('single read — unverified');
  else parts.push(`${Math.round(c.ratio * c.readCount)}/${c.readCount} agree`);

  const formatComponent = 0.20 * fmt.score;
  if (fmt.jurisdiction) parts.push(`${fmt.jurisdiction} format valid`);
  else parts.push('no known format');

  const rawPct = input.modelPct ?? 0;
  const m = rawPct > 1 ? rawPct / 100 : rawPct;        // accept either 0..1 or 0..100
  const tiebreaker = 0.05 * Math.max(0, Math.min(1, m));

  let score = consensusComponent + formatComponent + tiebreaker;
  if (c.readCount <= 1) score = Math.min(score, 0.84);

  return {
    canonical: c.canonical,
    trustScore: Math.max(0, Math.min(1, Number(score.toFixed(3)))),
    basis: parts.join(' · '),
    consensusRatio: c.ratio,
    readCount: c.readCount,
    variants: c.variants,
    jurisdiction: fmt.jurisdiction,
  };
}
