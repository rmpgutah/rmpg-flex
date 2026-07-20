const LABEL_OVERRIDES_KEY = 'rmpg_desktop_icon_label_overrides';
const AUTO_ARRANGE_KEY = 'rmpg_desktop_auto_arrange';
const ICONS_HIDDEN_KEY = 'rmpg_desktop_icons_hidden';

function readLabelOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LABEL_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLabelOverrides(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(LABEL_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch { /* silent — sessionless devices just always see the default */ }
}

export function getIconLabelOverride(path: string): string | null {
  return readLabelOverrides()[path] ?? null;
}

export function setIconLabelOverride(path: string, label: string): void {
  const overrides = readLabelOverrides();
  overrides[path] = label;
  writeLabelOverrides(overrides);
}

export function clearIconLabelOverride(path: string): void {
  const overrides = readLabelOverrides();
  if (!(path in overrides)) return;
  delete overrides[path];
  writeLabelOverrides(overrides);
}

export function isAutoArrangeEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_ARRANGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoArrangeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_ARRANGE_KEY, enabled ? '1' : '0');
  } catch { /* silent */ }
}

export function areIconsHidden(): boolean {
  try {
    return localStorage.getItem(ICONS_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setIconsHidden(hidden: boolean): void {
  try {
    localStorage.setItem(ICONS_HIDDEN_KEY, hidden ? '1' : '0');
  } catch { /* silent */ }
}
