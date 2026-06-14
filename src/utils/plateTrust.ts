const AMBIGUITY: Record<string, string> = { O: '0', I: '1', S: '5', B: '8', Z: '2' };

/** Canonical comparison form: uppercase, alphanumerics only, ambiguous glyphs folded. */
export function normalizePlate(raw: string): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/[OISBZ]/g, (c) => AMBIGUITY[c] ?? c);
}
