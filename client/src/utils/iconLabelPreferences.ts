// client/src/utils/iconLabelPreferences.ts
// Convenience wrappers for per-icon label customization.
// Underlying storage uses `rmpg_desktop_icon_label_overrides` (JSON object).

import { getIconLabelOverride, setIconLabelOverride } from './desktopIconPreferences';

/**
 * Returns the display label for an icon. Returns the stored custom label
 * if the user has renamed it; otherwise returns `defaultLabel`.
 */
export function getIconLabel(path: string, defaultLabel: string): string {
  return getIconLabelOverride(path) ?? defaultLabel;
}

/**
 * Saves a custom label for the given icon path.
 * Truncates to 20 characters per the UI contract.
 */
export function setIconLabel(path: string, label: string): void {
  setIconLabelOverride(path, label.slice(0, 20));
}
