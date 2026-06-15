import type { ThemePreference } from './theme';

export interface ThemeSchedule {
  /** Local hour [0-23] at which NIGHT (dark) begins. */
  nightStartHour: number;
  /** Local hour [0-23] at which DAY (light) begins. */
  dayStartHour: number;
}

export interface ThemeOverride {
  theme: ThemePreference;
  /** True while the manual choice should win over the schedule. */
  active: boolean;
}

export const DEFAULT_SCHEDULE: ThemeSchedule = { nightStartHour: 18, dayStartHour: 6 };

/**
 * Resolve the scheduled theme for a given local hour. Night runs
 * [nightStartHour .. 24) ∪ [0 .. dayStartHour); day runs
 * [dayStartHour .. nightStartHour). Handles the midnight wrap because the two
 * night ranges are unioned explicitly.
 */
export function resolveScheduledTheme(localHour: number, schedule: ThemeSchedule): ThemePreference {
  const { nightStartHour, dayStartHour } = schedule;
  const isDay = localHour >= dayStartHour && localHour < nightStartHour;
  return isDay ? 'light' : 'dark';
}

/** Effective theme = active override if present, else the schedule. */
export function resolveEffectiveTheme(
  localHour: number,
  schedule: ThemeSchedule,
  override: ThemeOverride | null,
): ThemePreference {
  if (override && override.active) return override.theme;
  return resolveScheduledTheme(localHour, schedule);
}
