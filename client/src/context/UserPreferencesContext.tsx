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

const UserPreferencesContext = createContext<{
  prefs: UserPreferences;
  reload: () => void;
}>({
  prefs: DEFAULTS,
  reload: () => {},
});

export function useUserPreferences() {
  return useContext(UserPreferencesContext);
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);

  const fetchPrefs = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch<UserPreferences>('/user/preferences');
      if (data) setPrefs(data);
    } catch {
      // Use defaults on error
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

  return (
    <UserPreferencesContext.Provider value={{ prefs, reload: fetchPrefs }}>
      {children}
    </UserPreferencesContext.Provider>
  );
}
