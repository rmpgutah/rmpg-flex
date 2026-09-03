// client/src/utils/skipTracerPalette.ts
// Categorical identity colors for SkipTracerV2Page entity-type graphs.
//
// EXCLUDED from hex audit (see hexClassifier.ts `skipTracerPalette`): these are
// one-per-entity-type identity colors — similar to connectionsGraphStyle.ts —
// where visual distinction between types is the semantic content, not theme
// chrome. Each color must remain visually distinguishable from every other.
// Retheming them onto a navy/silver ramp would collapse those distinctions.

/** Input type badge colors — used to tint the query type indicator. */
export const INPUT_BADGE_COLORS: Record<string, string> = {
  Name: '#aaaaaa',
  Phone: '#f59e0b',
  Email: '#f472b6',
  Address: '#34d399',
  Vehicle: '#60a5fa',
};

/** Source category colors — one stable color per data-source category. */
export const CATEGORY_COLORS: Record<string, string> = {
  people: '#888888',
  court: '#22c55e',
  property: '#f59e0b',
  business: '#8b5cf6',
  osint: '#a855f7',
  registry: '#ef4444',
};

/** Engine selector badge colors — MicroBilt / RapidAPI / All Sources */
export const ENGINE_COLORS = {
  microbilt: '#22c55e',
  rapidapi: '#f59e0b',
  all: '#8b5cf6',
} as const;

/** Dossier summary bar section colors — one per data type. */
export const SECTION_COLORS = {
  addresses: '#f59e0b',
  phones: '#888888',
  court: '#22c55e',
  sources: '#a855f7',
} as const;

/** Stats panel accent colors */
export const STATS_COLORS = {
  today: '#888888',
  week: '#22c55e',
  allTime: '#a855f7',
  cost: '#f59e0b',
  bar: '#888888',
} as const;

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? 'var(--text-muted)';
}

export function sourceColor(source: string): string {
  const lower = source.toLowerCase();
  if (lower.includes('court') || lower.includes('criminal') || lower.includes('arrest')) return CATEGORY_COLORS.court;
  if (lower.includes('property') || lower.includes('assessor')) return CATEGORY_COLORS.property;
  if (lower.includes('osint') || lower.includes('social') || lower.includes('username')) return CATEGORY_COLORS.osint;
  if (lower.includes('ofac') || lower.includes('registry') || lower.includes('sex') || lower.includes('fbi') || lower.includes('nsopw')) return CATEGORY_COLORS.registry;
  if (lower.includes('business') || lower.includes('corporate') || lower.includes('dopl') || lower.includes('fcc')) return CATEGORY_COLORS.business;
  return CATEGORY_COLORS.people;
}
