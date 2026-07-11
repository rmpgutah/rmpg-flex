import type { SorEnrichmentAdapter, ParsedEnrichment } from '../types';

function extractLabel(html: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*:\\s*(?:<[^>]*>\\s*)?([^<\\n]+)`, 'i');
    const match = html.match(re);
    if (match?.[1]) {
      const value = match[1].trim();
      // Empty string means the label matched but no real value followed (e.g. nested
      // tags like `Offense: <b><i>Robbery</i></b>` where the regex only skips one tag
      // and lands on whitespace between the two opens). Treat that as not-found rather
      // than returning a misleading empty-but-present value.
      if (value) return value;
    }
  }
  return null;
}

function extractTier(html: string): number | null {
  const raw = extractLabel(html, 'Tier');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const coloradoAdapter: SorEnrichmentAdapter = {
  state: 'CO',
  parseDetailPage(html: string): ParsedEnrichment {
    return {
      offense: extractLabel(html, 'Offense Description', 'Offense'),
      risk_level: extractLabel(html, 'Risk Level'),
      tier: extractTier(html),
      registration_status: extractLabel(html, 'Registration Status'),
    };
  },
};
