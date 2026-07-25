import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import { onAuthEvent } from '../utils/tokenRefresh';

export interface FeatureFlags {
  draw: boolean;
  annotations: boolean;
  gps_replay: boolean;
  nav_overlay: boolean;
  buildings_3d: boolean;
  buffer_rings: boolean;
  ruler: boolean;
  minimap: boolean;
  dev_diagnostics: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  draw: true,
  annotations: true,
  gps_replay: true,
  nav_overlay: true,
  buildings_3d: true,
  buffer_rings: true,
  ruler: true,
  minimap: true,
  dev_diagnostics: false,
};

export const FeatureFlagsContext = createContext<FeatureFlags>(DEFAULT_FLAGS);

/**
 * This provider mounts ABOVE AuthProvider (see App.tsx), so it cannot use
 * useAuth(). It reads the token straight from localStorage instead — the same
 * approach ErrorBoundary takes for the same reason.
 */
function hasToken(): boolean {
  try { return !!localStorage.getItem('rmpg_token'); } catch { return false; }
}

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);

  // `/admin/dev/feature-flags` requires auth. Polling it while logged out
  // (parked login screen) produced a 401 every 30s plus one per window focus,
  // each landing in error_log as noise.
  const load = () => {
    if (!hasToken()) return;
    apiFetch<Partial<FeatureFlags>>('/admin/dev/feature-flags')
      .then(data => setFlags({ ...DEFAULT_FLAGS, ...data }))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    window.addEventListener('focus', load);
    // Token rotation re-loads; logout drops back to defaults so one operator's
    // flags never leak into the next session on a shared Toughbook.
    const offAuth = onAuthEvent(e => {
      if (e.type === 'logout') setFlags(DEFAULT_FLAGS);
      else load();
    });
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', load);
      offAuth();
    };
  }, []);

  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export const useFeatureFlags = () => useContext(FeatureFlagsContext);
