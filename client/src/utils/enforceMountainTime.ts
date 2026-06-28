// ============================================================
// RMPG Flex — Display timezone enforcement
// ============================================================
// RMPG operates in Utah, so by DEFAULT every human-facing date/time renders
// in Mountain Time (America/Denver), DST-aware, regardless of the viewer's
// device timezone — a dispatcher on a laptop set to Eastern, an out-of-state
// admin, or a kiosk with a wrong clock all see Utah wall-clock. Users can opt
// into 'device' mode (use the device's own clock) via Profile → Display
// Settings; see timeZoneMode.ts. Storage stays UTC (the canonical, unambiguous
// instant); this module only governs DISPLAY.
//
// Why patch globally instead of fixing call sites:
//   ~370 toLocale* calls across ~170 files format times for display, and
//   new ones land constantly. Auditing them all (and policing every future
//   one) can't *guarantee* the requirement. Defaulting the formatting
//   timeZone to America/Denver at the prototype level makes MT the floor
//   for the whole app — impossible to bypass by forgetting an option.
//
// Scope of the patch:
//   - Date.prototype.toLocaleString / toLocaleDateString / toLocaleTimeString
//     gain a default timeZone of America/Denver when the caller did not pass
//     one. Callers that pass an explicit timeZone are respected untouched.
//   - We deliberately DO NOT patch Intl.DateTimeFormat: there are no unpinned
//     `new Intl.DateTimeFormat(...)` display call sites, and patching it would
//     make `Intl.DateTimeFormat().resolvedOptions().timeZone` always report
//     Denver — which would corrupt the genuine device-timezone fingerprint
//     AuthContext collects at login.
//   - We do NOT touch Date getters (getHours/getDate/getMonth/...). Those
//     drive date *math*, not display, and must keep native semantics. The
//     few display formatters that use them are fixed explicitly in dateUtils.
//
// This must run before any rendering — import it FIRST in main.tsx (and in
// the test setup, so tests behave identically to production).

import { displayTimeZone, MOUNTAIN_TIME_ZONE } from './timeZoneMode';

export { MOUNTAIN_TIME_ZONE };

type LocalesArg = string | string[] | undefined;

function withDisplayZone(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions | undefined {
  // Respect an explicit timeZone (e.g. PDF records pinned to America/Denver, or
  // anything intentionally formatting another zone).
  if (options && options.timeZone) return options;
  const tz = displayTimeZone();
  // Device mode (tz === undefined): inject nothing — native device behavior.
  if (!tz) return options;
  return { ...(options ?? {}), timeZone: tz };
}

// Guard against double-patching (HMR, repeated imports).
const FLAG = '__rmpgMountainTimePatched__';
if (!(globalThis as Record<string, unknown>)[FLAG]) {
  (globalThis as Record<string, unknown>)[FLAG] = true;

  const origToLocaleString = Date.prototype.toLocaleString;
  const origToLocaleDateString = Date.prototype.toLocaleDateString;
  const origToLocaleTimeString = Date.prototype.toLocaleTimeString;

  // Preserve the caller's `locales` argument verbatim (incl. undefined) so
  // locale behavior is unchanged — only the timeZone default is injected.
  Date.prototype.toLocaleString = function (locales?: LocalesArg, options?: Intl.DateTimeFormatOptions): string {
    return origToLocaleString.call(this, locales as never, withDisplayZone(options));
  };
  Date.prototype.toLocaleDateString = function (locales?: LocalesArg, options?: Intl.DateTimeFormatOptions): string {
    return origToLocaleDateString.call(this, locales as never, withDisplayZone(options));
  };
  Date.prototype.toLocaleTimeString = function (locales?: LocalesArg, options?: Intl.DateTimeFormatOptions): string {
    return origToLocaleTimeString.call(this, locales as never, withDisplayZone(options));
  };
}
