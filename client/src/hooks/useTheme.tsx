import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Keep storage key + valid values in sync with the boot script in client/index.html.
const STORAGE_KEY = 'rmpg-theme';

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize from the attribute already set by the boot script in index.html
  const [theme, setThemeState] = useState<Theme>(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'light' ? 'light' : readStoredTheme();
  });

  // Sync DOM attribute + localStorage whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage blocked — attribute is still applied */
    }
  }, [theme]);

  // Cmd/Ctrl + Shift + L keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l')) return;
      // Don't steal the keystroke while the user is typing. CAD/dispatch users
      // are keyboard-heavy — accidental theme flips mid-input would be jarring.
      //
      // Uses isContentEditable (walks the contenteditable inheritance chain) to
      // cover (a) <div contenteditable> with an empty attribute value, and
      // (b) nested descendants inside a contenteditable region — both of which
      // a direct target.matches('[contenteditable="true"]') check misses.
      const target = e.target as HTMLElement | null;
      if (target && (
        target.isContentEditable ||
        (typeof target.matches === 'function' && target.matches('input, textarea'))
      )) return;
      e.preventDefault();
      setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value: ThemeContextValue = {
    theme,
    setTheme: setThemeState,
    toggle: () => setThemeState(prev => (prev === 'dark' ? 'light' : 'dark')),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
