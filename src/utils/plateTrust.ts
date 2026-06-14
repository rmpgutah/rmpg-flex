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
  const plate = (rawPlate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
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
