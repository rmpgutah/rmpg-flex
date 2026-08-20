// client/src/utils/highContrastPreference.ts

const HC_KEY = 'rmpg_high_contrast';
const HC_CLASS = 'theme-high-contrast';

export function isHighContrastEnabled(): boolean {
  try {
    return localStorage.getItem(HC_KEY) === '1';
  } catch {
    return false;
  }
}

export function setHighContrastEnabled(on: boolean): void {
  try {
    localStorage.setItem(HC_KEY, on ? '1' : '0');
  } catch { /* silent */ }
  applyHighContrast(on);
}

export function applyHighContrast(on: boolean): void {
  if (on) {
    document.documentElement.classList.add(HC_CLASS);
  } else {
    document.documentElement.classList.remove(HC_CLASS);
  }
}
