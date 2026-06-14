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
