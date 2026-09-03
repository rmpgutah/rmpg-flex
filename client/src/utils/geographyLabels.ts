// ============================================================
// RMPG Flex — Canonical geography tier labels, colors, and label formatting
// ============================================================
// Single source of truth for how the Area/Sector/Zone/Beat hierarchy is
// labeled, colored, and formatted for display across the app. Sector and
// Zone were previously reimplemented independently as "Section"/"City" in
// the map-overlay layer, and the beat name/descriptor concatenation was
// duplicated in two places (one of which rendered every beat twice — see
// docs/superpowers/specs/2026-07-07-geography-naming-and-beat-descriptor-fix-design.md).
// Import from here instead of reimplementing.
// ============================================================

export const TIER_LABELS = {
  area: 'Area',
  sector: 'Sector',
  zone: 'Zone',
  beat: 'Beat',
} as const;

export type GeographyTier = keyof typeof TIER_LABELS;

const SECTOR_COLORS: Record<string, string> = {
  SL1: '#22c55e', SL2: '#c3ccd6', SL3: '#a855f7', SL4: '#f59e0b', SL5: '#ef4444', SL6: '#fbbf24',
  DV1: '#ec4899', DV2: '#14b8a6', DV3: '#f97316',
  WB1: '#8b5cf6', WB2: '#10b981',
  UC1: '#facc15', UC2: '#eab308', UC3: '#f43f5e',
};
const SECTOR_COLOR_FALLBACKS = ['#fb923c', '#d946ef', '#84cc16', '#facc15', '#e11d48', '#14b8a6', '#f59e0b', '#8b5cf6'];

export function getSectorColor(sectorId: string): string {
  if (!sectorId) return SECTOR_COLOR_FALLBACKS[0];
  if (SECTOR_COLORS[sectorId]) return SECTOR_COLORS[sectorId];
  let hash = 0;
  for (let i = 0; i < sectorId.length; i++) hash = ((hash << 5) - hash + sectorId.charCodeAt(i)) | 0;
  return SECTOR_COLOR_FALLBACKS[Math.abs(hash) % SECTOR_COLOR_FALLBACKS.length];
}

const ZONE_COLORS = [
  '#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6',
  '#2dd4bf', '#fb923c', '#a78bfa', '#34d399', '#22d3ee', '#fb7185',
  '#a3e635', '#818cf8', '#e879f9', '#38bdf8', '#fde047', '#fdba74',
  '#5eead4', '#f9a8d4', '#bef264', '#93c5fd', '#fcd34d', '#7dd3fc',
];

export function getZoneColor(zoneCode: string): string {
  let hash = 0;
  for (let i = 0; i < zoneCode.length; i++) hash = ((hash << 5) - hash + zoneCode.charCodeAt(i)) | 0;
  return ZONE_COLORS[Math.abs(hash) % ZONE_COLORS.length];
}

// 32-color palette for per-beat distinct coloring. Colors are visually
// well-separated and chosen to read against the navy tactical basemap.
const BEAT_COLOR_PALETTE = [
  '#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6',
  '#2dd4bf', '#fb923c', '#a78bfa', '#34d399', '#22d3ee', '#fb7185',
  '#a3e635', '#818cf8', '#e879f9', '#38bdf8', '#fde047', '#fdba74',
  '#5eead4', '#f9a8d4', '#bef264', '#93c5fd', '#fcd34d', '#7dd3fc',
  '#86efac', '#bfdbfe', '#fca5a5', '#d8b4fe', '#99f6e4', '#fed7aa',
  '#d9f99d', '#e0f2fe',
];

export function getBeatColor(beatCode: string): string {
  if (!beatCode) return BEAT_COLOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < beatCode.length; i++) hash = ((hash << 5) - hash + beatCode.charCodeAt(i)) | 0;
  return BEAT_COLOR_PALETTE[Math.abs(hash) % BEAT_COLOR_PALETTE.length];
}

/**
 * Beat display label: name, plus " — descriptor" only when the descriptor
 * carries information the name doesn't already have. migrations/0012 seeded
 * beat_descriptor as an exact copy of beat_name for all 719 beats, so this
 * guard is required — without it every beat renders as "X — X".
 */
export function formatBeatLabel(beatName: string, beatDescriptor?: string | null): string {
  if (beatDescriptor && beatDescriptor !== beatName) return `${beatName} — ${beatDescriptor}`;
  return beatName;
}
