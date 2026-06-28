import type { RawWarrantHit } from '../types';
import { cleanName, normalizeDate, normalizeBond, displayName } from '../normalize';

export interface FieldMap {
  name?: string; first?: string; middle?: string; last?: string;
  dob?: string; age?: string; charge?: string; case_no?: string;
  bond?: string; issued?: string; court?: string; city?: string;
  state?: string; sex?: string; race?: string; warrant_type?: string;
}

const get = (row: Record<string, unknown>, key?: string): string | null =>
  key && row[key] != null ? String(row[key]) : null;

/** Stable per-source warrant id from identifying parts. Two independent rolling
 *  hashes → ~64-bit id, low collision even on large single-source feeds that lack
 *  a case number. */
export function deriveWarrantId(parts: (string | null | undefined)[]): string {
  const basis = parts.filter(Boolean).join('|').toUpperCase();
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);   // FNV-1a style
    h2 = (h2 * 31 + c) | 0;
  }
  return `h${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function parseSocrata(rows: Record<string, unknown>[], map: FieldMap, sourceKey: string): RawWarrantHit[] {
  const out: RawWarrantHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const first = get(row, map.first);
    const middle = get(row, map.middle);
    const last = get(row, map.last);
    // full_name: explicit name field if mapped, else "Last, First M" from parts.
    const nameRaw = get(row, map.name);
    const fullName = nameRaw
      ? cleanName(nameRaw)
      : (first || last)
        ? displayName({ first_name: first, middle_name: middle, last_name: last })
        : null;
    const caseNo = get(row, map.case_no);
    const dob = normalizeDate(get(row, map.dob));
    if (!caseNo && !fullName && !dob) continue;  // unidentifiable row — skip, don't collapse to one id
    const warrantId = caseNo || deriveWarrantId([fullName, dob]);
    if (seen.has(warrantId)) continue;
    seen.add(warrantId);
    const ageStr = get(row, map.age);
    out.push({
      source_key: sourceKey,
      warrant_id: warrantId,
      first_name: first ? cleanName(first) : null,
      middle_name: middle ? cleanName(middle) : null,
      last_name: last ? cleanName(last) : null,
      full_name: fullName,
      date_of_birth: dob,
      age: ageStr ? Number(ageStr) : null,
      city: get(row, map.city),
      state: get(row, map.state),
      charge_description: get(row, map.charge),
      court_name: get(row, map.court),
      case_number: caseNo,
      bail_amount: normalizeBond(get(row, map.bond)),
      issue_date: normalizeDate(get(row, map.issued)),
      warrant_type: get(row, map.warrant_type),
    });
  }
  return out;
}
