const STORAGE_KEY = 'rmpg_desktop_clock_format';

export type ClockFormat = '12h' | '24h';

export function getClockFormat(): ClockFormat {
  try {
    return localStorage.getItem(STORAGE_KEY) === '12h' ? '12h' : '24h';
  } catch {
    return '24h';
  }
}

export function setClockFormat(format: ClockFormat): void {
  try {
    localStorage.setItem(STORAGE_KEY, format);
  } catch { /* silent — sessionless devices just always see the default */ }
}
