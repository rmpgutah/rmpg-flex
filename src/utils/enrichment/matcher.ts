import { normalizeDob } from '../normalizeDob';
import type { EnrichmentSeed, EnrichedRecord, HardLockResult } from './types';

const TOLERANCE_MS = 366 * 24 * 60 * 60 * 1000;

export function hardLock(
  seed: EnrichmentSeed,
  record: EnrichedRecord,
  knownCityStates: string[] = [],
): HardLockResult {
  const anchors: string[] = [];

  // Condition 1 — DOB window (required)
  const seedDob = normalizeDob(seed.dob ?? null);
  const recDob  = normalizeDob(record.dob ?? null);
  if (!seedDob || !recDob) return { confirmed: false, anchors };

  const diffMs = Math.abs(Date.parse(seedDob) - Date.parse(recDob));
  if (diffMs > TOLERANCE_MS) return { confirmed: false, anchors };
  anchors.push('dob_match');

  // Condition 2 — secondary anchors
  if (seed.ssn_last4 && record.ssn_last4 && seed.ssn_last4 === record.ssn_last4) {
    anchors.push('ssn_last4');
  }
  if (seed.dl_number && record.dl_number &&
      seed.dl_number.toUpperCase() === record.dl_number.toUpperCase()) {
    anchors.push('dl_number');
  }

  // Address anchor: build candidate city|state set from seed + knownCityStates
  const candidateCityStates = new Set<string>(knownCityStates);
  if (seed.city && seed.state) {
    candidateCityStates.add(`${seed.city.toLowerCase()}|${seed.state.toLowerCase()}`);
  }
  for (const addr of record.addresses) {
    const c = (addr.city  ?? '').toLowerCase();
    const s = (addr.state ?? '').toLowerCase();
    if (c && s && candidateCityStates.has(`${c}|${s}`)) {
      anchors.push('address_anchor');
      break;
    }
  }

  const hasAnchor = anchors.some(a => a !== 'dob_match');
  return { confirmed: hasAnchor, anchors };
}
