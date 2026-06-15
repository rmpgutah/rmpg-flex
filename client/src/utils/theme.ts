import { DEFAULT_SCHEDULE, resolveEffectiveTheme, type ThemeOverride } from './themeSchedule';

export type ThemePreference = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'rmpg_theme_preference';
export const LEGACY_FLAG_KEY = 'rmpg_theme_legacy';
export const THEME_OVERRIDE_KEY = 'rmpg_theme_override';

/** When set, restore the pre-refactor pure-black palette (prod kill-switch). */
export function isLegacyBlackForced(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(LEGACY_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

// Night (dark) = steel-blue-charcoal base. Day (light) = Spillman chrome silver.
const THEME_CHROME_COLORS: Record<ThemePreference, string> = {
  dark: '#0d1722',   // night — steel-blue-charcoal base
  light: '#d6d3c8',  // day — Spillman chrome silver
};

const THEME_BODY_BACKGROUNDS: Record<ThemePreference, string> = {
  dark: '#0d1722',
  light: '#ece9dd',
};

function getMetaTag(name: string): HTMLMetaElement {
  let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = name;
    document.head.appendChild(tag);
  }
  return tag;
}

export function normalizeThemePreference(value: string | null | undefined): ThemePreference {
  if (value === 'light' || value === 'day') return 'light';
  return 'dark';
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';
  try {
    return normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

export function getThemeChromeColor(theme: ThemePreference): string {
  return THEME_CHROME_COLORS[theme];
}

function updateThemeMeta(theme: ThemePreference) {
  const legacy = isLegacyBlackForced();
  const themeColor = getMetaTag('theme-color');
  themeColor.setAttribute('content', legacy ? '#000000' : THEME_CHROME_COLORS[theme]);

  const appleStatusBar = getMetaTag('apple-mobile-web-app-status-bar-style');
  appleStatusBar.setAttribute('content', theme === 'light' && !legacy ? 'default' : 'black-translucent');
}

async function syncNativeStatusBar(theme: ThemePreference) {
  if (typeof window === 'undefined') return;

  const cap = (window as Window & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }).Capacitor;

  if (!cap?.isNativePlatform?.()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // Day (light) surface needs dark icons; night/legacy surfaces need light icons.
    // Capacitor Style.Dark = dark icons (for light backgrounds); Style.Light = light icons.
    const legacy = isLegacyBlackForced();
    const lightSurface = theme === 'light' && !legacy;
    await StatusBar.setStyle({ style: lightSurface ? Style.Dark : Style.Light });

    if (cap.getPlatform?.() === 'android') {
      await StatusBar.setBackgroundColor({ color: legacy ? '#000000' : THEME_CHROME_COLORS[theme] });
    }
  } catch (error) {
    console.warn('[theme] Failed to sync native status bar', error);
  }
}

export function applyThemePreference(
  value: string | null | undefined,
  options?: { persist?: boolean; syncNative?: boolean },
): ThemePreference {
  if (typeof document === 'undefined') return normalizeThemePreference(value);

  const theme = normalizeThemePreference(value);
  const html = document.documentElement;
  const body = document.body;

  const legacy = isLegacyBlackForced();
  html.classList.remove('theme-dark', 'theme-light', 'theme-legacy-black');
  html.classList.add(`theme-${theme}`);
  if (legacy) html.classList.add('theme-legacy-black');

  // Day (light) is a genuinely light surface → native controls/status bar use
  // light mode (dark icons). Night stays dark. Legacy black stays dark.
  const effectiveScheme: 'dark' | 'light' = theme === 'light' && !legacy ? 'light' : 'dark';
  html.style.colorScheme = effectiveScheme;
  html.style.backgroundColor = legacy ? '#000000' : THEME_CHROME_COLORS[theme];

  if (body) {
    body.style.colorScheme = effectiveScheme;
    body.style.backgroundColor = legacy ? '#0a0a0a' : THEME_BODY_BACKGROUNDS[theme];
  }

  updateThemeMeta(theme);

  if (options?.persist !== false) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures in private browsing / restricted contexts.
    }
  }

  if (options?.syncNative !== false) {
    void syncNativeStatusBar(theme);
  }

  return theme;
}

/** Read the manual theme override ({theme,active}); null if absent/invalid. */
export function readThemeOverride(): ThemeOverride | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(THEME_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && (parsed.theme === 'dark' || parsed.theme === 'light')) {
      return { theme: parsed.theme, active: !!parsed.active };
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist (or clear, when null) the manual theme override. */
export function writeThemeOverride(override: ThemeOverride | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (override === null) localStorage.removeItem(THEME_OVERRIDE_KEY);
    else localStorage.setItem(THEME_OVERRIDE_KEY, JSON.stringify(override));
  } catch {
    // ignore storage failures
  }
}

/** Effective theme right now: legacy → active override → time schedule. Mirrors the index.html boot script. */
export function resolveCurrentTheme(): ThemePreference {
  if (isLegacyBlackForced()) return 'dark';
  const hour = new Date().getHours();
  return resolveEffectiveTheme(hour, DEFAULT_SCHEDULE, readThemeOverride());
}

export function bootstrapThemePreference(): ThemePreference {
  return applyThemePreference(resolveCurrentTheme(), { persist: false });
}
