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
const DEFAULT_MODE: TimeZoneMode = 'mountain';

let cachedMode: TimeZoneMode | null = null;

function readMode(): TimeZoneMode {
  try {
    return localStorage.getItem(TZ_MODE_STORAGE_KEY) === 'device' ? 'device' : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function getTimeZoneMode(): TimeZoneMode {
  if (cachedMode === null) cachedMode = readMode();
  return cachedMode;
}

export function setTimeZoneMode(mode: TimeZoneMode): void {
  cachedMode = mode === 'device' ? 'device' : 'mountain';
  try { localStorage.setItem(TZ_MODE_STORAGE_KEY, cachedMode); } catch { /* storage full / unavailable */ }
}

/**
 * The IANA zone to format display times in, or `undefined` to mean "use the
 * device's local zone". Passing `undefined` as a toLocale / Intl `timeZone`
 * option is valid and yields native device-local behavior.
 */
export function displayTimeZone(): string | undefined {
  return getTimeZoneMode() === 'device' ? undefined : MOUNTAIN_TIME_ZONE;
}

// Keep the cache fresh if the preference changes in another tab.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === TZ_MODE_STORAGE_KEY) cachedMode = readMode();
  });
}
