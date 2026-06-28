// ============================================================
// normalizeDob — coerce assorted DOB strings into ISO YYYY-MM-DD
// ============================================================
// The persons table has accumulated mixed DOB formats over the VPS →
// Workers migration: mostly ISO (`1961-07-25`), but some US slash
// format (`12/06/1949`) and some empty strings. Storing one canonical
// format makes age math, sorting, and display reliable across every
// consumer (warrant matcher, PDF reports, dashboard).
//
// This helper is the single source of truth for that coercion. Wire it
// into every persons write path as those migrate into /src/, and use it
// in one-off cleanup scripts.
//
// Returns ISO `YYYY-MM-DD` on success, or null when the input is empty
// or unparseable (caller stores null rather than a guessed-wrong date —
// a null DOB is honest; a wrong DOB silently corrupts age matching).

/**
 * Already-ISO fast path: `YYYY-MM-DD` (optionally with a time suffix we
 * strip). Returns the date portion if the calendar values are valid.
 */
function tryIso(raw: string): string | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = parseInt(mo, 10);
  const day = parseInt(d, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

export function normalizeDob(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === '') return null;

  // 1. Already ISO → validate + return.
  const iso = tryIso(s);
  if (iso) return iso;

  // 2. US MM/DD/YYYY numeric format (operator convention 2026-05-29).
  //    Accepts `/`, `-`, `.` separators. Requires a 4-digit year —
  //    2-digit years are rejected as too ambiguous to risk on a DOB.
  //    Auto-correction: if the first field is > 12 it can't be a month,
  //    so it must be the day (a foreign DD/MM entry); swap it. Only the
  //    genuinely ambiguous case (both ≤ 12) follows the US MM/DD order.
  const parts = s.split(/[/.\-]/).map((p) => p.trim());
  if (parts.length === 3 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{4}$/.test(parts[2])) {
    let mm = parseInt(parts[0], 10);
    let dd = parseInt(parts[1], 10);
    const yyyy = parts[2];
    if (mm > 12 && dd <= 12) [mm, dd] = [dd, mm]; // unambiguous foreign order
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    return null;
  }

  // 3. Bare age in the dob field (e.g. "64") — operator decision: preserve
  //    the AGE rather than drop the record from age-matching. We can't know
  //    the real birthday, so anchor to Jan 1 of the inferred birth year.
  //    ageFromDob() + the matcher's ±1 tolerance only use the year, so the
  //    computed age round-trips correctly. The month/day are SYNTHETIC —
  //    never present "January 1" to a user as a real birthday for these.
  if (/^\d{1,3}$/.test(s)) {
    const age = parseInt(s, 10);
    if (age >= 0 && age <= 120) {
      const birthYear = new Date().getFullYear() - age;
      return `${birthYear}-01-01`;
    }
  }

  // 4. Anything else (2-digit years, free text, garbage) → null. A null
  //    DOB is honest; a guessed-wrong DOB silently corrupts age matching.
  return null;
}
