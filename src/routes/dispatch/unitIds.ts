// ============================================================
// assigned_unit_ids canonicalization
//
// calls_for_service.assigned_unit_ids has historically been written in two
// shapes — `["1"]` (text elements) and `[1]` (integer elements) — depending on
// whether the client sent unit_id as a string or a number. That mix breaks SQL
// matching: in SQLite `1 = '1'` is FALSE, so a typed `json_each(...) WHERE
// value = ?` silently drops the other shape (and a LIKE substring match
// over-matches: unit 1 hits 10/11/21…). Reads were hardened with
// `CAST(value AS TEXT)`, but the real fix is to stop writing the mixed shape.
//
// Canonical storage form: a deduped JSON array of INTEGERS, e.g. "[1,2]".
// (The client already normalizes to strings on parse, so it tolerates either
// stored shape — integers are chosen because unit ids ARE integers and it's
// what the majority of server write paths already produced.)
// ============================================================

/** Parse an assigned_unit_ids value (JSON array — possibly mixed ["1"]/[1] — or
 *  a comma/space-separated string) into a deduped array of integer unit ids. */
export function parseUnitIds(raw: unknown): number[] {
  if (raw == null) return [];
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try { arr = JSON.parse(s); } catch { arr = s.split(/[,\s]+/); }
  }
  if (!Array.isArray(arr)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const x of arr) {
    const n = Math.trunc(Number(x));
    if (Number.isFinite(n) && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

/** Canonical storage form for assigned_unit_ids: a JSON array of integers. */
export function canonicalUnitIdsJson(raw: unknown): string {
  return JSON.stringify(parseUnitIds(raw));
}
