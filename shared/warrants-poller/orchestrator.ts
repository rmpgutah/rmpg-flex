// Runs all list-poll sources, isolates failures, audits each result,
// and fires alerts when a new warrant matches a known person.

import type { AlertSink, DataStore, PollResult, WarrantRecord } from './types';
import type { BaseWarrantSource } from './sources/base';
import { toCanonicalName, normalizeDob } from './normalize';

export async function runPoll(opts: {
  sources: BaseWarrantSource[];
  store: DataStore;
  alerts?: AlertSink;
}): Promise<PollResult[]> {
  const pollable = opts.sources.filter((s) => s.mode === 'list-poll');
  const settled = await Promise.allSettled(pollable.map((s) => runOne(s, opts.store, opts.alerts)));

  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      source: pollable[i].id,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ok: false,
      warrantsFound: 0,
      warrantsInserted: 0,
      warrantsUpdated: 0,
      personMatches: 0,
      error: String(r.reason?.message ?? r.reason),
    };
  });
}

async function runOne(
  source: BaseWarrantSource,
  store: DataStore,
  alerts: AlertSink | undefined,
): Promise<PollResult> {
  const startedAt = new Date().toISOString();
  const result: PollResult = {
    source: source.id,
    startedAt,
    finishedAt: startedAt,
    ok: false,
    warrantsFound: 0,
    warrantsInserted: 0,
    warrantsUpdated: 0,
    personMatches: 0,
  };

  try {
    const warrants = await source.pollAll();
    result.warrantsFound = warrants.length;

    for (const w of warrants) {
      const rec = normalize(w);
      const existing = await store.findExistingWarrant(rec.source, rec.sourceWarrantId);
      const { inserted, warrantId } = await store.upsertWarrant(rec);
      if (inserted) result.warrantsInserted++;
      else result.warrantsUpdated++;

      // MNI cross-link + alert ONLY on new warrants for known persons.
      if (inserted && !existing) {
        const person = await store.findPersonByNameDOB(rec.subjectName, rec.dob);
        if (person) {
          await store.linkWarrantToPerson(warrantId, person.id);
          result.personMatches++;
          if (alerts) {
            // Alert failures are logged but never fail the poll cycle.
            await alerts.newWarrantForKnownPerson(rec, person).catch(() => {});
          }
        }
      }
    }
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    result.finishedAt = new Date().toISOString();
    await store.recordAudit(result).catch(() => {});
  }
  return result;
}

function normalize(w: WarrantRecord): WarrantRecord {
  return {
    ...w,
    subjectName: toCanonicalName(w.subjectName),
    dob: normalizeDob(w.dob),
    fetchedAt: w.fetchedAt || new Date().toISOString(),
  };
}
