// ============================================================
// FBI Wanted adapter — api.fbi.gov fugitive bulletins
// ============================================================
// The FBI publishes its Wanted list through a free, official, no-auth public
// API. A name match is a LEAD only — the bulletin names a wanted person but
// cannot prove the dossier subject IS that person. is_danger bulletins
// surface the `fugitive` risk flag for officer-safety display.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { IntelSeed, RawDataPoint, SourceResult, CapturedCrossRef, RiskFlag } from '../types';
import { makeSourceResult } from './shared';
import { lookupFbiWanted, type FbiWantedRecord } from '../../fbiWantedLookup';

const SRC = 'FBI_Wanted';

function splitName(full?: string): { first: string; last: string } {
  const parts = (full || '').trim().split(/\s+/);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function recordToDataPoints(r: FbiWantedRecord): RawDataPoint[] {
  const pts: RawDataPoint[] = [];
  if (r.title) pts.push({ category: 'legal', field: 'fugitive_name', value: r.title, source: SRC });
  if (r.warning) pts.push({ category: 'legal', field: 'warning', value: r.warning, source: SRC });
  if (r.caution) pts.push({ category: 'online', field: 'caution', value: r.caution, source: SRC });
  if (r.subjects) pts.push({ category: 'legal', field: 'subjects', value: r.subjects, source: SRC });
  if (r.sex) pts.push({ category: 'legal', field: 'sex', value: r.sex, source: SRC });
  if (r.race) pts.push({ category: 'legal', field: 'race', value: r.race, source: SRC });
  if (r.dob) pts.push({ category: 'legal', field: 'dob', value: r.dob, source: SRC });
  if (r.aliases) pts.push({ category: 'legal', field: 'aliases', value: r.aliases, source: SRC });
  if (r.reward) pts.push({ category: 'online', field: 'reward', value: r.reward, source: SRC });
  if (r.url) pts.push({ category: 'online', field: 'bulletin_url', value: r.url, source: SRC });
  return pts;
}

function recordToCrossRef(r: FbiWantedRecord, seed: IntelSeed): CapturedCrossRef {
  const flags: RiskFlag[] = ['fugitive'];
  if (r.is_danger) flags.push('fugitive');
  // A wanted-name match is a strong lead but still unverified.
  const confidence = r.is_danger ? 0.46 : 0.38;
  const matchedFields: { field: string; value: string }[] = [{ field: 'name', value: seed.name || '' }];
  if (r.dob) matchedFields.push({ field: 'dob', value: r.dob });
  return {
    source: 'FBI_WANTED',
    externalRef: r.url || r.title,
    externalUrl: r.url || undefined,
    label: r.title,
    matchedFields,
    confidence,
    isCriminal: true,
    riskFlags: flags,
  };
}

export async function queryFbiWantedAdapter(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  if (!seed.name || seed.name.trim().length < 2) {
    return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  }
  const { first, last } = splitName(seed.name);
  if (last.length < 2) {
    return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  }

  try {
    const result = await lookupFbiWanted(db, last, first);
    if (result.error) {
      return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, result.error);
    }
    const dataPoints: RawDataPoint[] = [];
    const crossRefs: CapturedCrossRef[] = [];
    for (const r of result.records) {
      dataPoints.push(...recordToDataPoints(r));
      crossRefs.push(recordToCrossRef(r, seed));
    }
    return makeSourceResult(SRC, 2, 'success', dataPoints, [], Date.now() - t0, undefined, crossRefs);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
