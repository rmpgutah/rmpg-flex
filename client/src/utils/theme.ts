export type ThemePreference = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'rmpg_theme_preference';

// "Light Mode" here is a saturated-blue variant of the dark theme — NOT a
// true white-background light mode. See client/src/index.css for the full
// palette under html.theme-light. These chrome/body colors match the
// --surface-base values exactly.
const THEME_CHROME_COLORS: Record<ThemePreference, string> = {
  dark: '#000000',
  light: '#081828',
};

const THEME_BODY_BACKGROUNDS: Record<ThemePreference, string> = {
  dark: '#0a0a0a',
  light: '#081828',
};

// Both themes render as dark-on-dark (white text on a dark surface, just with
// a different hue: pure black vs saturated blue). Platform chrome — browser
// scrollbars, form-control defaults, native status-bar icons — should always
// use dark-mode settings so icons remain light-on-dark and stay readable.
// Do NOT derive these from the ThemePreference value.
const PLATFORM_COLOR_SCHEME = 'dark' as const;
const APPLE_STATUS_BAR_STYLE = 'black-translucent' as const;

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
  return value === 'light' ? 'light' : 'dark';
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
  const themeColor = getMetaTag('theme-color');
  themeColor.setAttribute('content', THEME_CHROME_COLORS[theme]);

  // Both themes are dark-on-dark — status bar always uses light icons.
  const appleStatusBar = getMetaTag('apple-mobile-web-app-status-bar-style');
  appleStatusBar.setAttribute('content', APPLE_STATUS_BAR_STYLE);
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
    // Both themes are dark-on-dark — status bar icons/text are always light.
    // Style.Light = light icons (for dark backgrounds).
    await StatusBar.setStyle({ style: Style.Light });

    if (cap.getPlatform?.() === 'android') {
      await StatusBar.setBackgroundColor({ color: THEME_CHROME_COLORS[theme] });
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

  html.classList.remove('theme-dark', 'theme-light');
  html.classList.add(`theme-${theme}`);
  // Pin color-scheme to dark in both modes — saturated-blue "Light Mode" is
  // still a dark surface, so native form controls and scrollbars should use
  // dark-mode defaults to stay readable.
  html.style.colorScheme = PLATFORM_COLOR_SCHEME;
  html.style.backgroundColor = THEME_CHROME_COLORS[theme];

  if (body) {
    body.style.colorScheme = PLATFORM_COLOR_SCHEME;
    body.style.backgroundColor = THEME_BODY_BACKGROUNDS[theme];
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

export function bootstrapThemePreference(): ThemePreference {
  return applyThemePreference(getStoredThemePreference());
}
