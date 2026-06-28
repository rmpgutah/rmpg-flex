// ============================================================
// RMPG Flex — Display timezone preference
// ============================================================
// Storage is always UTC and reads always go through parseTimestamp, so the
// underlying instant is correct regardless of this setting. This ONLY controls
// the zone times are *displayed* in:
//   'mountain' (default) — pin every displayed time to America/Denver
//                          (DST-aware), regardless of the device's clock. The
//                          right choice for the Utah operation; an out-of-state
//                          admin or a misconfigured device still sees Utah time.
//   'device'             — use the viewer's own device/browser timezone. Simpler
//                          when everyone is already on Mountain Time anyway.
//
// Consumed by the global shim (enforceMountainTime.ts) and the dateUtils
// formatters. The value is cached in-memory so hot formatting paths don't hit
// localStorage on every call.

export type TimeZoneMode = 'mountain' | 'device';

export const TZ_MODE_STORAGE_KEY = 'rmpg_tz_mode';
export const MOUNTAIN_TIME_ZONE = 'America/Denver';

// MANDATORY MOUNTAIN TIME. RMPG is a Utah operation and every displayed
// date/time MUST render in Mountain Time, always — it is NOT user-configurable
// and does NOT follow the device clock. (A 'device' mode was briefly added and
// then removed per requirement: "MT MUST BE MT".) These functions are kept so
// existing imports keep working, but the mode is hard-locked to 'mountain'.
export function getTimeZoneMode(): TimeZoneMode {
  return 'mountain';
}

// No-op: the display zone is fixed to Mountain Time and cannot be changed.
export function setTimeZoneMode(_mode: TimeZoneMode): void {
  /* intentionally does nothing — Mountain Time is mandatory */
}

/** The IANA zone to format display times in — always America/Denver (DST-aware). */
export function displayTimeZone(): string | undefined {
  return MOUNTAIN_TIME_ZONE;
}
