// Classify where a vehicle_sighting came from, derived from its notes string.
// The server writes recognizable prefixes:
//   • ClearPath dashcam reads  → "ClearPath dashcam <device> …"
//   • field ALPR camera scans  → "ALPR: …" / "ALPR capture …"
//   • manual plate entry       → anything else (or empty)
// Pure + unit-tested so the plate log can badge/filter by source without a
// schema change.

export type SightingSourceKey = 'dashcam' | 'camera' | 'manual';

export interface SightingSource {
  key: SightingSourceKey;
  label: string;
  /** Tailwind classes for a small badge. */
  badgeClass: string;
  /** Map-pin color (hex). */
  color: string;
}

const SOURCES: Record<SightingSourceKey, SightingSource> = {
  dashcam: { key: 'dashcam', label: 'DASHCAM', badgeClass: 'bg-purple-950/50 text-purple-300 border-purple-700', color: '#a855f7' },
  camera:  { key: 'camera',  label: 'CAMERA',  badgeClass: 'bg-blue-950/40 text-blue-300 border-blue-700',     color: '#3b82f6' },
  manual:  { key: 'manual',  label: 'MANUAL',  badgeClass: 'bg-neutral-800 text-neutral-300 border-neutral-600', color: '#9ca3af' },
};

/** Classify a sighting's source from its notes (case-insensitive). */
export function sightingSourceKey(notes: string | null | undefined): SightingSourceKey {
  const n = (notes || '').trim().toLowerCase();
  if (n.startsWith('clearpath dashcam')) return 'dashcam';
  // Server emits "ALPR: …" or "ALPR capture …"; PlateLogPage passes bare 'ALPR'
  // for the legend chip. Match those exact forms so free-text manual notes
  // (e.g. "ALPR camera was offline, entered manually") don't false-positive.
  if (n === 'alpr' || n.startsWith('alpr:') || n.startsWith('alpr capture')) return 'camera';
  return 'manual';
}

export function sightingSource(notes: string | null | undefined): SightingSource {
  return SOURCES[sightingSourceKey(notes)];
}

export const ALL_SOURCES: SightingSource[] = [SOURCES.camera, SOURCES.dashcam, SOURCES.manual];
