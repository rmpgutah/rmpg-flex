import { DEFAULT_SCHEDULE, resolveEffectiveTheme, type ThemeOverride } from './themeSchedule';

export type ThemePreference = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'rmpg_theme_preference';
export const LEGACY_FLAG_KEY = 'rmpg_theme_legacy';
export const BLUE_SILVER_FLAG_KEY = 'rmpg_theme_blue_silver';
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

/** Blue & Silver is the app-wide DEFAULT theme as of the 2026-07-04 re-theme
 *  (replacing the gold-accent day/night scheme). Same tier as the legacy
 *  kill-switch — an independent forced theme, not part of the day/night
 *  schedule. Legacy takes precedence if both are somehow set. Set
 *  BLUE_SILVER_FLAG_KEY to '0' to opt back out to the retired gold scheme. */
export function isBlueSilverForced(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return !isLegacyBlackForced() && localStorage.getItem(BLUE_SILVER_FLAG_KEY) !== '0';
  } catch {
    return true;
  }
}

// Night (dark) = steel-blue-charcoal base. Day (light) = Spillman chrome silver.
const THEME_CHROME_COLORS: Record<ThemePreference, string> = {
  dark: 'var(--surface-base)',   // night — steel-blue-charcoal base
  light: '#d6d3c8',  // day — Spillman chrome silver
};

const THEME_BODY_BACKGROUNDS: Record<ThemePreference, string> = {
  dark: 'var(--surface-base)',
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

// Blue & Silver forced-override chrome — matches --surface-base / body bg in
// the html.theme-blue-silver block (theme-palettes.css). It's a dark theme
// like legacy-black, so it always wins over THEME_CHROME_COLORS[theme].
// Must track --surface-base in the html.theme-blue-silver block of
// theme-palettes.css. Was #0c1a2b, which the 2026-07-07 navy repair pass
// orphaned when surface-base moved to #22405f — the page root and browser
// theme-color then painted markedly darker than the surfaces above them,
// reading as a dark band behind content.
const BLUE_SILVER_CHROME = '#22405f';

function updateThemeMeta(theme: ThemePreference) {
  const legacy = isLegacyBlackForced();
  const blueSilver = !legacy && isBlueSilverForced();
  const themeColor = getMetaTag('theme-color');
  themeColor.setAttribute('content', legacy ? '#000000' : blueSilver ? BLUE_SILVER_CHROME : THEME_CHROME_COLORS[theme]);

  const appleStatusBar = getMetaTag('apple-mobile-web-app-status-bar-style');
  appleStatusBar.setAttribute('content', theme === 'light' && !legacy && !blueSilver ? 'default' : 'black-translucent');
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
    // Day (light) surface needs dark icons; night/legacy/blue-silver surfaces
    // need light icons. Capacitor Style.Dark = dark icons (for light
    // backgrounds); Style.Light = light icons.
    const legacy = isLegacyBlackForced();
    const blueSilver = !legacy && isBlueSilverForced();
    const lightSurface = theme === 'light' && !legacy && !blueSilver;
    await StatusBar.setStyle({ style: lightSurface ? Style.Dark : Style.Light });

    if (cap.getPlatform?.() === 'android') {
      await StatusBar.setBackgroundColor({ color: legacy ? '#000000' : blueSilver ? BLUE_SILVER_CHROME : THEME_CHROME_COLORS[theme] });
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
  const blueSilver = !legacy && isBlueSilverForced();
  html.classList.remove('theme-dark', 'theme-light', 'theme-legacy-black', 'theme-blue-silver', 'dark');
  // Exactly ONE palette class is stamped. Previously `theme-${theme}` was added
  // unconditionally, so Blue & Silver shipped as "theme-dark dark
  // theme-blue-silver" and only won because its block appears later in
  // theme-palettes.css. That made the entire app's appearance depend on CSS
  // source order — a bundler reordering, or any equal-specificity theme-dark
  // rule declared after it, would silently revert every surface to night.
  if (legacy) html.classList.add('theme-legacy-black');
  else if (blueSilver) html.classList.add('theme-blue-silver');
  else html.classList.add(`theme-${theme}`);
  if (theme === 'dark' || legacy || blueSilver) html.classList.add('dark');

  // Day (light) is a genuinely light surface → native controls/status bar use
  // light mode (dark icons). Night, legacy black, and blue-silver stay dark.
  const effectiveScheme: 'dark' | 'light' = theme === 'light' && !legacy && !blueSilver ? 'light' : 'dark';
  html.style.colorScheme = effectiveScheme;
  html.style.backgroundColor = legacy ? '#000000' : blueSilver ? BLUE_SILVER_CHROME : THEME_CHROME_COLORS[theme];

  if (body) {
    body.style.colorScheme = effectiveScheme;
    body.style.backgroundColor = legacy ? '#0a0a0a' : blueSilver ? BLUE_SILVER_CHROME : THEME_BODY_BACKGROUNDS[theme];
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
  if (isLegacyBlackForced() || isBlueSilverForced()) return 'dark';
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hour12: false }).format(new Date()),
    10,
  );
  return resolveEffectiveTheme(hour, DEFAULT_SCHEDULE, readThemeOverride());
}

export function bootstrapThemePreference(): ThemePreference {
  return applyThemePreference(resolveCurrentTheme(), { persist: false });
}
