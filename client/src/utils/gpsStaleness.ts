// Shared GPS-fix staleness classifier. Single source of truth for the
// 2min/5min amber/gray thresholds previously duplicated between
// mapMarkers.ts's getMapUnitGpsStaleness and UnitStatusBoard.tsx's
// getGpsStaleStatus (each had its own copy of the same two numbers,
// risking silent drift between the Map and Dispatch board views).
import { parseTimestamp } from './dateUtils';

export type GpsStaleness = 'ok' | 'stale' | 'lost';

export function getGpsStaleness(unit: { gps_updated_at?: string | null; status?: string | null }): GpsStaleness {
  if (!unit.gps_updated_at || unit.status === 'off_duty') return 'ok';
  const elapsed = Date.now() - parseTimestamp(unit.gps_updated_at).getTime();
  if (elapsed > 5 * 60 * 1000) return 'lost';
  if (elapsed > 2 * 60 * 1000) return 'stale';
  return 'ok';
}
