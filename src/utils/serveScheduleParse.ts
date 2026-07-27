// ============================================================
// RMPG Flex — Serve Intake client-schedule parsing
// ============================================================
// The extraction prompt asks the model to emit client_attempt_schedule
// in a canonical 24-hour form ('06:00-09:00;09:00-18:00'). Real client
// instructions read like "Diligence is 1 between 6AM-9AM, 1 between
// 9AM-6PM and 1 between 6PM-9PM" — the model does that conversion, this
// module only validates and structures the result.
//
// FAIL CLOSED. A band this module cannot parse is DROPPED, and a wholly
// unparseable string yields []. The caller then falls back to
// address-class defaults and says so in the report. Inventing an attempt
// window from a misread instruction is worse than admitting we could not
// read it — the officer would attempt outside the client's authorized
// hours and the service could be challenged.
// ============================================================

export interface TimeBand {
  start: string;   // 'HH:MM', 24-hour
  end: string;     // 'HH:MM', 24-hour, strictly after start
}

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function toMinutes(hhmm: string): number | null {
  const m = CLOCK.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function pad(hhmm: string): string {
  const [h, mm] = hhmm.trim().split(':');
  return `${h.padStart(2, '0')}:${mm}`;
}

export function parseClientBands(raw: string): TimeBand[] {
  if (!raw) return [];
  const out: TimeBand[] = [];
  for (const chunk of raw.split(';')) {
    // Accept ASCII hyphen, en-dash, and em-dash as the range separator —
    // the model and the source documents both use all three.
    const parts = chunk.split(/[-–—]/);
    if (parts.length !== 2) continue;
    const startMin = toMinutes(parts[0]);
    const endMin = toMinutes(parts[1]);
    if (startMin === null || endMin === null) continue;
    if (endMin <= startMin) continue;          // zero-length or inverted → drop
    out.push({ start: pad(parts[0]), end: pad(parts[1]) });
  }
  return out;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

// A negation word anywhere in free text means the client is describing an
// EXCLUSION ("no monday", "not sunday", "except friday"), not an inclusion.
// We do not attempt to compute the complement — see the fail-closed note
// below.
const NEGATION_RE = /\b(no|not|except|excluding|never)\b/;

// Returns null — NOT a default set — when the value carries no day
// information, so the caller can distinguish "client said nothing" from
// "client said every day".
export function parseAllowedDays(raw: string): number[] | null {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'all' || s === '7 days a week' || s === 'any') return [...ALL_DAYS];
  // Canonical enum token from the extractor — safe to honor exactly, unlike
  // negation appearing in free text (handled below).
  if (s === 'no_sunday' || s === 'no sunday') return ALL_DAYS.filter((d) => d !== 0);
  if (s === 'weekdays' || s === 'weekday') return [...WEEKDAYS];

  // Word-boundary match only — a day name embedded inside an unrelated word
  // (e.g. "monday" inside "commondays") must not fabricate a restriction.
  const named = ALL_DAYS.filter((d) => {
    const name = Object.keys(DAY_NAMES).find((k) => DAY_NAMES[k] === d)!;
    return new RegExp(`\\b${name}\\b`).test(s);
  });
  if (named.length === 0) return null;

  // FAIL CLOSED on negation: "no monday" contains the word "monday" but
  // means the OPPOSITE of "service allowed on Monday". We cannot safely
  // guess the complement from free text, so treat it the same as "client
  // said nothing I can act on" rather than silently inverting intent.
  if (NEGATION_RE.test(s)) return null;

  return named;
}
