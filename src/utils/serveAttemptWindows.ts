// ============================================================
// RMPG Flex — attempt-window precedence (spec §3.2)
// ============================================================
// One auditable function decides WHICH time bands to attempt in.
// Precedence, descending:
//   1. client_attempt_schedule — the client dictated hours; attempting
//      outside them can be challenged in court
//   2. location-note constraints — a recorded site notation
//   3. address_class defaults
//   4. generic doctrine (residential defaults)
//
// Every emitted window carries an `authority` string so the officer's
// briefing can print WHY that window was chosen rather than presenting
// a bare time range as if it were arbitrary.
//
// D-2 ENFORCEMENT POINT (fix round 2). Address class alone is NOT
// sufficient to select business timing — it must ALSO be CONFIRMED.
// `resolveAddressClass` deliberately still returns an unconfirmed
// `'business'` (from packet language or the model's own field) because
// the class drives WHO may accept service in the briefing's SERVICE
// AUTHORITY section, which is a separate concern from timing. Timing,
// however, is gated here: `addressClassConfirmed !== true` falls to the
// RESIDENTIAL defaults, which are strictly wider. Being wrong that way
// costs one unnecessary attempt window; being wrong the other way puts a
// server outside a house at 10:00 on a Tuesday and the service fails.
//
// The flag is optional and defaults to FALSE on purpose: a caller that
// forgets it degrades to the safe (residential) direction rather than
// the unsafe one.
// ============================================================

import type { TimeBand } from './serveScheduleParse';
import type { AddressClass } from './serveAddressClass';

export type WindowAuthority =
  | 'client-specified'
  | 'site note'
  | 'residential default'
  | 'business default';

export interface WindowSpec {
  window: string;              // 'HH:MM-HH:MM'
  focus: string;               // why this band
  authority: WindowAuthority;
}

export interface WindowInput {
  addressClass: AddressClass;
  /** D-2: business timing requires a CONFIRMED business location.
   *  Absent/false → residential defaults regardless of `addressClass`. */
  addressClassConfirmed?: boolean;
  clientBands: TimeBand[];
  locationNote?: {
    hours_start?: string | null;
    hours_end?: string | null;
    cutoff_time?: string | null;
  } | null;
}

// Residential hit rates peak pre-work and post-work; midday catches
// shift workers and the retired.
const RESIDENTIAL_DEFAULTS: WindowSpec[] = [
  { window: '07:00-09:00', focus: 'early morning — catch before work departure', authority: 'residential default' },
  { window: '11:00-13:00', focus: 'midday — vary the pattern', authority: 'residential default' },
  { window: '17:00-20:30', focus: 'evening — highest residential hit rate', authority: 'residential default' },
];

const BUSINESS_DEFAULTS: WindowSpec[] = [
  { window: '09:30-11:30', focus: 'mid-morning — after the opening rush', authority: 'business default' },
  { window: '13:30-15:30', focus: 'early afternoon — before end-of-day cutoff', authority: 'business default' },
];

// Exported so the briefing prints the SAME hours it planned. Previously the
// briefing's "standard windows" prose hardcoded 09:00–11:00 / 13:00–16:00
// while the planner used 09:30-11:30 / 13:30-15:30, so one report stated two
// different sets of business hours (R2).
export const DEFAULT_RESIDENTIAL_WINDOWS: readonly WindowSpec[] = RESIDENTIAL_DEFAULTS;
export const DEFAULT_BUSINESS_WINDOWS: readonly WindowSpec[] = BUSINESS_DEFAULTS;

// D-2: business timing requires confirmation. See the module header.
export function usesBusinessTiming(
  addressClass: AddressClass,
  addressClassConfirmed: boolean | undefined,
): boolean {
  return addressClass === 'business' && addressClassConfirmed === true;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hhmm: string | null | undefined): number | null {
  const m = HHMM.exec((hhmm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function selectWindows(input: WindowInput): WindowSpec[] {
  // 1. Client-dictated bands.
  if (input.clientBands.length) {
    return input.clientBands.map((b) => ({
      window: `${b.start}-${b.end}`,
      focus: 'client-specified attempt band — do not attempt outside these hours',
      authority: 'client-specified' as const,
    }));
  }

  // 2. Location-note hours.
  // R8: a note carrying only `hours_start` used to synthesize
  // `${hours_start}-17:00`, which for a start after 17:00 produced an
  // INVERTED window ('18:00-17:00'). That string reached both the officer's
  // briefing and appendAttemptSlot, which wrote window_start='18:00',
  // window_end='17:00' onto the schedule row. Only emit a site-note window
  // when both ends parse AND start < end; otherwise fall through to the
  // address-class defaults, which are always well-formed.
  const note = input.locationNote;
  if (note?.hours_start) {
    const end = note.cutoff_time || note.hours_end || '17:00';
    const startMin = minutesOf(note.hours_start);
    const endMin = minutesOf(end);
    if (startMin !== null && endMin !== null && startMin < endMin) {
      return [
        { window: `${note.hours_start}-${end}`, focus: `per site notation: attempt within noted hours`, authority: 'site note' },
      ];
    }
  }

  // 3/4. Address-class defaults. UNKNOWN — and any UNCONFIRMED class —
  // falls to residential, the wider set, per operator decision D-2.
  return usesBusinessTiming(input.addressClass, input.addressClassConfirmed)
    ? BUSINESS_DEFAULTS.map((w) => ({ ...w }))
    : RESIDENTIAL_DEFAULTS.map((w) => ({ ...w }));
}

// A client schedule that demands N distinct days cannot be satisfied in
// fewer than N days. The briefing flags this explicitly rather than
// silently producing a plan that violates the client's own instruction.
export function scheduleFitsDeadline(bandCount: number, daysRemaining: number | null): boolean {
  if (daysRemaining === null) return true;
  if (daysRemaining < 0) return false;
  return daysRemaining >= bandCount;
}
