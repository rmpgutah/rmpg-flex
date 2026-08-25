// ============================================================
// CourtListener adapter — Free Law Project (juriscraper + courtlistener)
// ============================================================
// freelawproject/juriscraper is the scraper engine that gathers US court
// opinions, oral arguments, and PACER data; freelawproject/courtlistener is
// the Django platform that publishes that data through a sanctioned public
// REST API (https://www.courtlistener.com/api/rest/v4/). Workers cannot run
// the Python scraper, so this adapter consumes the API — the surface the
// scrapers feed — and folds federal/state court records into the dossier as
// `legal` data points + structured cross-references.
//
// Identity caveat: court records match on NAME only. A docket naming the
// subject is a LEAD to verify (DOB/identifier), never a confirmed fact, so
// name-only matches cap confidence below 0.5.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { IntelSeed, RawDataPoint, SourceResult, CapturedCrossRef, RiskFlag } from '../types';
import { makeSourceResult } from './shared';
import { lookupCourtRecords, type CourtRecord } from '../../courtRecordsLookup';

const SRC = 'CourtListener';

/**
 * Split a full name into (last, first). The last token is the surname;
 * everything before it is the given name(s). Mirrors lookupCourtRecords'
 * expected argument order.
 */
function splitName(full?: string): { first: string; last: string } {
  const parts = (full || '').trim().split(/\s+/);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function recordToDataPoints(r: CourtRecord): RawDataPoint[] {
  const pts: RawDataPoint[] = [];
  if (r.case_name) pts.push({ category: 'legal', field: 'case_name', value: r.case_name, source: SRC });
  if (r.docket_number) pts.push({ category: 'legal', field: 'docket_number', value: r.docket_number, source: SRC });
  if (r.court) pts.push({ category: 'legal', field: 'court', value: r.court, source: SRC });
  if (r.date_filed) pts.push({ category: 'legal', field: 'date_filed', value: r.date_filed, source: SRC });
  if (r.url) pts.push({ category: 'online', field: 'case_url', value: r.url, source: SRC });
  return pts;
}

function recordToCrossRef(r: CourtRecord, seed: IntelSeed): CapturedCrossRef {
  const flags: RiskFlag[] = r.is_criminal ? ['court_criminal'] : [];
  // Name-only match is a lead, not a confirmation.
  const confidence = r.is_criminal ? 0.42 : 0.34;
  const matchedFields: { field: string; value: string }[] = [{ field: 'name', value: seed.name || '' }];
  return {
    source: 'COURTLISTENER',
    externalRef: r.docket_number || r.url || r.case_name,
    externalUrl: r.url || undefined,
    label: r.case_name,
    matchedFields,
    confidence,
    isCriminal: r.is_criminal,
    riskFlags: flags,
  };
}

export async function queryCourtListener(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  if (!seed.name || seed.name.trim().length < 2) {
    return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  }
  const { first, last } = splitName(seed.name);
  if (last.length < 2) {
    return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  }

  try {
    const result = await lookupCourtRecords(db, last, first);
    if (result.error) {
      return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, result.error);
    }
    const records = result.records;
    const dataPoints: RawDataPoint[] = [];
    const crossRefs: CapturedCrossRef[] = [];
    for (const r of records) {
      dataPoints.push(...recordToDataPoints(r));
      crossRefs.push(recordToCrossRef(r, seed));
    }
    return makeSourceResult(SRC, 2, 'success', dataPoints, [], Date.now() - t0, undefined, crossRefs);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
