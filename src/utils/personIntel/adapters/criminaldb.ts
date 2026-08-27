// ============================================================
// Criminal-DB cross-reference adapter
// (Premasajjanar/Criminal_database_management_system model)
// ============================================================
// The reference repo models a criminal database as: criminals/suspects tied
// to FIRs (case numbers), charges, custody status, evidence refs, and case
// tracking. RMPG Flex already owns authoritative versions of those tables
// (persons, warrants, arrests, cases, field_interviews), so this adapter
// performs the CRIMINAL cross-reference against them rather than re-creating
// a parallel store. Each hit becomes a structured cross-ref the officer
// verifies against the subject's identifiers (DOB/address).
//
// Identity caveat: an exact first+last match is the linkage key. Ambiguity
// (>1 person) yields cross-refs tagged low-confidence — the officer must
// verify before acting, same caveat the DO enforces for linked_person_id.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { IntelSeed, RawDataPoint, SourceResult, CapturedCrossRef, RiskFlag } from '../types';
import { makeSourceResult } from './shared';

const SRC = 'CriminalDB';

interface PersonMatch {
  id: number;
  first_name?: string;
  last_name?: string;
  dob?: string;
}

async function findPersons(db: D1Database, seed: IntelSeed): Promise<PersonMatch[]> {
  if (!seed.name) return [];
  const parts = seed.name.trim().split(/\s+/);
  if (parts.length < 2) return [];
  const first = parts[0];
  const last = parts[parts.length - 1];
  try {
    const { results } = await db.prepare(
      `SELECT id, first_name, last_name, dob FROM persons
       WHERE UPPER(first_name)=UPPER(?) AND UPPER(last_name)=UPPER(?) LIMIT 10`,
    ).bind(first, last).all<PersonMatch>();
    return results ?? [];
  } catch {
    return [];
  }
}

async function warrantsFor(db: D1Database, personId: number): Promise<any[]> {
  try {
    const { results } = await db.prepare(
      `SELECT id, warrant_number, charge, status, issuing_court, issue_date
       FROM warrants WHERE subject_person_id=? LIMIT 20`,
    ).bind(personId).all<any>();
    return results ?? [];
  } catch {
    return [];
  }
}

async function arrestsFor(db: D1Database, personId: number): Promise<any[]> {
  // arrests column names vary across the dirty schema; read defensively.
  try {
    const { results } = await db.prepare(
      `SELECT id, arrest_number, charges, status, arrest_date, location
       FROM arrests WHERE person_id=? LIMIT 20`,
    ).bind(personId).all<any>();
    return results ?? [];
  } catch {
    return [];
  }
}

async function casesFor(db: D1Database, personId: number): Promise<any[]> {
  try {
    const { results } = await db.prepare(
      `SELECT id, case_number, case_name, charges, status, court_date
       FROM cases WHERE subject_person_id=? LIMIT 20`,
    ).bind(personId).all<any>();
    return results ?? [];
  } catch {
    return [];
  }
}

function labelFor(prefix: string, r: any): string {
  const num = r.warrant_number || r.arrest_number || r.case_number || `#${r.id}`;
  const charge = r.charge || r.charges || r.case_name || '';
  return charge ? `${prefix} ${num} — ${String(charge).slice(0, 80)}` : `${prefix} ${num}`;
}

export async function queryCriminalDb(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  try {
    const persons = await findPersons(db, seed);
    if (!persons.length) {
      return makeSourceResult(SRC, 2, 'success', [], [], Date.now() - t0);
    }
    // Ambiguity >1 → lower base confidence (officer must disambiguate).
    const ambiguous = persons.length > 1;

    const dataPoints: RawDataPoint[] = [];
    const crossRefs: CapturedCrossRef[] = [];
    const flags: RiskFlag[] = [];

    for (const p of persons) {
      if (p.dob) dataPoints.push({ category: 'legal', field: 'dob', value: p.dob, source: SRC });
      dataPoints.push({ category: 'legal', field: 'person_id', value: String(p.id), source: SRC });

      const matchedFields: { field: string; value: string }[] = [{ field: 'name', value: seed.name || '' }];
      if (p.dob) matchedFields.push({ field: 'dob', value: p.dob });

      const warrants = await warrantsFor(db, p.id);
      const arrests = await arrestsFor(db, p.id);
      const cases = await casesFor(db, p.id);

      for (const w of warrants) {
        if (w.status === 'active') flags.push('warrant');
        dataPoints.push({ category: 'legal', field: 'warrant', value: labelFor('Warrant', w), source: SRC });
        crossRefs.push({
          source: 'INTERNAL',
          externalRef: w.warrant_number ? String(w.warrant_number) : `warrant:${w.id}`,
          externalUrl: undefined,
          label: labelFor('Warrant', w),
          matchedFields,
          confidence: ambiguous ? 0.4 : 0.55,
          isCriminal: true,
          riskFlags: w.status === 'active' ? ['warrant'] : [],
        });
      }
      for (const a of arrests) {
        flags.push('arrest_mention');
        dataPoints.push({ category: 'legal', field: 'arrest', value: labelFor('Arrest', a), source: SRC });
        crossRefs.push({
          source: 'CRIMINAL_DB',
          externalRef: a.arrest_number ? String(a.arrest_number) : `arrest:${a.id}`,
          label: labelFor('Arrest', a),
          matchedFields,
          confidence: ambiguous ? 0.38 : 0.5,
          isCriminal: true,
          riskFlags: ['arrest_mention'],
        });
      }
      for (const cs of cases) {
        dataPoints.push({ category: 'legal', field: 'case', value: labelFor('Case', cs), source: SRC });
        crossRefs.push({
          source: 'CRIMINAL_DB',
          externalRef: cs.case_number ? String(cs.case_number) : `case:${cs.id}`,
          label: labelFor('Case', cs),
          matchedFields,
          confidence: ambiguous ? 0.36 : 0.48,
          isCriminal: true,
          riskFlags: [],
        });
      }
    }

    return makeSourceResult(SRC, 2, 'success', dataPoints, [], Date.now() - t0, undefined, crossRefs);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}

/** Exposed so phaseLegal can fold the deduped flags into the dossier risk set. */
export function criminalRiskFlagsFrom(result: SourceResult): RiskFlag[] {
  return (result.crossRefs ?? []).flatMap(r => r.riskFlags);
}
