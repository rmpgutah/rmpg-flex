/**
 * UserPreferencesContext — fetches and applies user preferences.
 *
 * - font_scale → sets CSS custom property `--user-font-scale` on <html>
 * - compact_mode → adds/removes `compact-mode` class on <html>
 * - Exposes preferences to any component via useUserPreferences()
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { apiFetch } from '../hooks/useApi';

interface UserPreferences {
  font_scale: number;
  compact_mode: number;
  show_map_labels: number;
  default_map_style: string;
  dispatch_sort: string;
  dispatch_show_cleared: number;
  [key: string]: any;
}

const DEFAULTS: UserPreferences = {
  font_scale: 1.0,
  compact_mode: 0,
  show_map_labels: 1,
  default_map_style: 'dark',
  dispatch_sort: 'priority',
  dispatch_show_cleared: 0,
};

interface UserPreferencesContextValue {
  prefs: UserPreferences;
  reload: () => void;
  isLoading: boolean;
  error: string | null;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue>({
  prefs: DEFAULTS,
  reload: () => {},
  isLoading: false,
  error: null,
});

export function useUserPreferences() {
  return useContext(UserPreferencesContext);
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<UserPreferences>('/user/preferences');
      if (data) setPrefs(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch preferences';
      console.warn('[UserPreferences] Failed to fetch preferences:', msg);
      setError(msg);
      // Keep using defaults on error — don't break the UI
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  // Apply font_scale as CSS custom property
  useEffect(() => {
    const scale = prefs.font_scale ?? 1.0;
    document.documentElement.style.setProperty('--user-font-scale', String(scale));
    document.documentElement.style.fontSize = `${scale * 100}%`;
  }, [prefs.font_scale]);

  // Apply compact_mode class
  useEffect(() => {
    if (prefs.compact_mode) {
      document.documentElement.classList.add('compact-mode');
    } else {
      document.documentElement.classList.remove('compact-mode');
    }
  }, [prefs.compact_mode]);

  // Apply theme_preference class (dark/light)
  useEffect(() => {
    const theme = (prefs as any).theme_preference || 'dark';
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    document.documentElement.classList.add(`theme-${theme}`);
  }, [(prefs as any).theme_preference]);

  return (
    <UserPreferencesContext.Provider value={{ prefs, reload: fetchPrefs, isLoading, error }}>
      {children}
    </UserPreferencesContext.Provider>
  );
}
