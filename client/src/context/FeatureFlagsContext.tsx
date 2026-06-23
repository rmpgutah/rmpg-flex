import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

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

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);

  const load = () => {
    apiFetch<Partial<FeatureFlags>>('/admin/feature-flags')
      .then(data => setFlags({ ...DEFAULT_FLAGS, ...data }))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, []);

  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export const useFeatureFlags = () => useContext(FeatureFlagsContext);
