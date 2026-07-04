import type { SorEnrichmentAdapter, ParsedEnrichment } from '../types';

function extractLabel(html: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*:\\s*(?:<[^>]*>\\s*)?([^<\\n]+)`, 'i');
    const match = html.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractTier(html: string): number | null {
  const raw = extractLabel(html, 'Tier Level', 'Tier');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const nevadaAdapter: SorEnrichmentAdapter = {
  state: 'NV',
  parseDetailPage(html: string): ParsedEnrichment {
    return {
      offense: extractLabel(html, 'Conviction', 'Offense'),
      risk_level: extractLabel(html, 'Risk Level'),
      tier: extractTier(html),
      registration_status: extractLabel(html, 'Registration Status'),
    };
  },
};
