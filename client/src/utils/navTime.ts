// ============================================================
// RMPG Flex — Navigation Clock & Arrival Formatters
// Pure helpers fed the clock mode from prefs ('12h' | '24h').
// No React, no DOM, no localStorage. America/Denver is the app
// timezone but these format the supplied Date's local components,
// so callers pass an already-zoned Date (or accept system local).
// ============================================================

export type ClockMode = '12h' | '24h';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function safeDate(d: Date): Date {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date(NaN);
}

/**
 * Format a clock time.
 *   formatClock(d,'24h')             -> '14:05'
 *   formatClock(d,'12h')             -> '2:05 PM'
 *   formatClock(d,'24h',true)        -> '14:05:09'
 *   formatClock(d,'12h',true)        -> '2:05:09 PM'
 * Invalid dates render as '--:--'.
 */
export function formatClock(date: Date, mode: ClockMode, withSeconds = false): string {
  const d = safeDate(date);
  if (Number.isNaN(d.getTime())) return '--:--';

  const h24 = d.getHours();
  const min = pad2(d.getMinutes());
  const sec = pad2(d.getSeconds());

  if (mode === '24h') {
    const base = `${pad2(h24)}:${min}`;
    return withSeconds ? `${base}:${sec}` : base;
  }

  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const base = `${h12}:${min}`;
  return withSeconds ? `${base}:${sec} ${period}` : `${base} ${period}`;
}

/**
 * Arrival-time formatter — same as formatClock without seconds, but
 * an explicit helper so call sites read clearly ("ETA arrival 2:47 PM").
 */
export function formatArrival(date: Date, mode: ClockMode): string {
  return formatClock(date, mode, false);
}
