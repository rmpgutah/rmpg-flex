// Utah State Warrants source adapter.
//
// ADDITIVE WRAPPER — this is behavior-preserving by construction. It does NOT
// re-implement the upstream fetch or the namesake age-match guard; it calls
// the EXISTING `fetchWarrantsForPerson` from the live poller (which already
// applies isLikelyMatch() internally to reject namesakes) and maps each
// returned FetchedWarrant to the source-agnostic RawWarrantHit shape.
//
// The orchestrator (a later task) decides HOW to invoke Utah. Today this
// adapter only fetches — it performs NO persistence. The live cron scan
// continues to run through `runUtahWarrantScan`, byte-identically. See the
// "Persistence" note in this file's PR / task report.

import type { WarrantSourceAdapter, RawWarrantHit, PersonRow, SourceMeta } from '../types';
import { fetchWarrantsForPerson, type FetchedWarrant } from '../../utahWarrantPoller';

const meta: SourceMeta = {
  key: 'utah-warrant-watch',
  display_name: 'Utah State Warrants',
  state: 'UT',
  county: null,
  source_url: 'https://warrants.utah.gov',
  kind: 'api',
  priority: 1,
};

/** Map one upstream FetchedWarrant to a source-agnostic RawWarrantHit. */
function toRawHit(w: FetchedWarrant): RawWarrantHit {
  return {
    source_key: meta.key, // single source of truth — never drift from meta
    warrant_id: w.utah_warrant_id,
    first_name: w.first_name,
    middle_name: w.middle_name,
    last_name: w.last_name,
    age: w.age,
    city: w.city,
    state: 'UT',
    // Raw JSON-array string of charges — the normalizer handles it downstream.
    charge_description: w.charges,
    court_name: w.court_name,
    case_number: w.case_id,
    issue_date: w.issue_date,
  };
}

export const utahApiAdapter: WarrantSourceAdapter = {
  meta,
  // `env` is accepted to satisfy the adapter contract but unused — the Utah
  // fetch uses module-level constants (API_BASE/USER_AGENT) + global fetch and
  // needs no DB binding. (PersonRow here is identical in shape to the poller's
  // own PersonRow.)
  async fetchForPerson(person: PersonRow, _env): Promise<RawWarrantHit[]> {
    const fetched = await fetchWarrantsForPerson(person);
    return fetched.map(toRawHit);
  },
};
