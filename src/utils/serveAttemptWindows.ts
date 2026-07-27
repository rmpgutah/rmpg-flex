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
  const note = input.locationNote;
  if (note?.hours_start) {
    const end = note.cutoff_time || note.hours_end || '17:00';
    return [
      { window: `${note.hours_start}-${end}`, focus: `per site notation: attempt within noted hours`, authority: 'site note' },
    ];
  }

  // 3/4. Address-class defaults. UNKNOWN falls to residential — the
  // wider set — per operator decision D-2.
  return input.addressClass === 'business'
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
