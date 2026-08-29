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
// D-2 ENFORCEMENT POINT. Address class alone is NOT sufficient to select
// office-hour timing for a GENERIC `'business'` class — it must ALSO be
// CONFIRMED. Specific office classes (corporate / small_business /
// government) may select office hours without that confirmation because
// they are only assigned from stronger location signals (see
// serveAddressClass.ts). Unconfirmed generic `'business'` and `'unknown'`
// fall to the RESIDENTIAL defaults, which are strictly wider.
//
// The flag is optional and defaults to FALSE on purpose: a caller that
// forgets it degrades to the safe (residential) direction for generic
// business rather than the unsafe one.
// ============================================================

import type { TimeBand } from './serveScheduleParse';
import type { AddressClass } from './serveAddressClass';
import { isSpecificOfficeClass } from './serveAddressClass';

export type WindowAuthority =
  | 'client-specified'
  | 'site note'
  | 'residential default'
  | 'business default'
  | 'corporate default'
  | 'small_business default'
  | 'government default';

export interface WindowSpec {
  window: string;              // 'HH:MM-HH:MM'
  focus: string;               // why this band
  authority: WindowAuthority;
}

export interface WindowInput {
  addressClass: AddressClass;
  /** D-2: generic `'business'` timing requires a CONFIRMED business location.
   *  Absent/false → residential defaults for that class. Specific office
   *  classes ignore this gate. */
  addressClassConfirmed?: boolean;
  clientBands: TimeBand[];
  locationNote?: {
    hours_start?: string | null;
    hours_end?: string | null;
    cutoff_time?: string | null;
  } | null;
}

const RESIDENTIAL_DEFAULTS: WindowSpec[] = [
  { window: '07:00-09:00', focus: 'early morning — catch before work departure', authority: 'residential default' },
  { window: '11:00-13:00', focus: 'midday — vary the pattern', authority: 'residential default' },
  { window: '17:00-20:30', focus: 'evening — highest residential hit rate', authority: 'residential default' },
];

const BUSINESS_DEFAULTS: WindowSpec[] = [
  { window: '09:30-11:30', focus: 'mid-morning — after the opening rush', authority: 'business default' },
  { window: '13:30-15:30', focus: 'early afternoon — before end-of-day cutoff', authority: 'business default' },
];

const CORPORATE_DEFAULTS: WindowSpec[] = [
  { window: '09:30-11:30', focus: 'mid-morning — after lobby/reception opening', authority: 'corporate default' },
  { window: '13:30-16:00', focus: 'afternoon — before corporate close / mail cutoff', authority: 'corporate default' },
];

const SMALL_BUSINESS_DEFAULTS: WindowSpec[] = [
  { window: '09:00-11:00', focus: 'morning — after typical shop opening', authority: 'small_business default' },
  { window: '13:00-16:00', focus: 'afternoon — before small-business close', authority: 'small_business default' },
];

const GOVERNMENT_DEFAULTS: WindowSpec[] = [
  { window: '08:30-11:30', focus: 'morning counter hours — after security/opening', authority: 'government default' },
  { window: '13:00-15:30', focus: 'afternoon — before public-counter close', authority: 'government default' },
];

export const DEFAULT_RESIDENTIAL_WINDOWS: readonly WindowSpec[] = RESIDENTIAL_DEFAULTS;
export const DEFAULT_BUSINESS_WINDOWS: readonly WindowSpec[] = BUSINESS_DEFAULTS;
export const DEFAULT_CORPORATE_WINDOWS: readonly WindowSpec[] = CORPORATE_DEFAULTS;
export const DEFAULT_SMALL_BUSINESS_WINDOWS: readonly WindowSpec[] = SMALL_BUSINESS_DEFAULTS;
export const DEFAULT_GOVERNMENT_WINDOWS: readonly WindowSpec[] = GOVERNMENT_DEFAULTS;

export function windowsForAddressClass(klass: AddressClass): readonly WindowSpec[] {
  switch (klass) {
    case 'corporate':
    case 'po_box':
      return CORPORATE_DEFAULTS;
    case 'small_business':
      return SMALL_BUSINESS_DEFAULTS;
    case 'government':
      return GOVERNMENT_DEFAULTS;
    case 'business':
      return BUSINESS_DEFAULTS;
    case 'gated':
    case 'residential':
    case 'unknown':
    default:
      return RESIDENTIAL_DEFAULTS;
  }
}

export function defaultAuthorityForClass(klass: AddressClass): WindowAuthority {
  switch (klass) {
    case 'corporate':
    case 'po_box':
      return 'corporate default';
    case 'small_business':
      return 'small_business default';
    case 'government':
      return 'government default';
    case 'business':
      return 'business default';
    default:
      return 'residential default';
  }
}

/** True when this job should use weekday office-hour bands (not evenings/weekends). */
export function usesBusinessTiming(
  addressClass: AddressClass,
  addressClassConfirmed: boolean | undefined,
): boolean {
  if (isSpecificOfficeClass(addressClass) || addressClass === 'po_box') return true;
  return addressClass === 'business' && addressClassConfirmed === true;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hhmm: string | null | undefined): number | null {
  const m = HHMM.exec((hhmm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function selectWindows(input: WindowInput): WindowSpec[] {
  if (input.clientBands.length) {
    return input.clientBands.map((b) => ({
      window: `${b.start}-${b.end}`,
      focus: 'client-specified attempt band — do not attempt outside these hours',
      authority: 'client-specified' as const,
    }));
  }

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

  if (usesBusinessTiming(input.addressClass, input.addressClassConfirmed)) {
    return windowsForAddressClass(input.addressClass).map((w) => ({ ...w }));
  }
  return RESIDENTIAL_DEFAULTS.map((w) => ({ ...w }));
}

export function scheduleFitsDeadline(bandCount: number, daysRemaining: number | null): boolean {
  if (daysRemaining === null) return true;
  if (daysRemaining < 0) return false;
  return daysRemaining >= bandCount;
}
