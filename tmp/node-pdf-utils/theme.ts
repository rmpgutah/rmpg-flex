export type ThemePreference = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'rmpg_theme_preference';

const THEME_CHROME_COLORS: Record<ThemePreference, string> = {
  dark: '#000000',
  light: '#f0f2f5',
};

const THEME_BODY_BACKGROUNDS: Record<ThemePreference, string> = {
  dark: '#0a0a0a',
  light: '#f0f2f5',
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

  const appleStatusBar = getMetaTag('apple-mobile-web-app-status-bar-style');
  appleStatusBar.setAttribute('content', theme === 'dark' ? 'black-translucent' : 'default');
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
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark });

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
  html.style.colorScheme = theme;
  html.style.backgroundColor = THEME_CHROME_COLORS[theme];

  if (body) {
    body.style.colorScheme = theme;
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
