// useDashboardPanels — collapsible panel state management for DashboardPage
import { useCallback, useEffect, useState } from 'react';
import type { PanelId } from './dashboardViews';

const STORAGE_KEY = 'rmpg_dashboard_collapsed';

function loadCollapsed(): Set<PanelId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as PanelId[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveCollapsed(set: Set<PanelId>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function useDashboardPanels() {
  const [collapsed, setCollapsed] = useState<Set<PanelId>>(loadCollapsed);
  const [density, setDensity] = useState<'compact' | 'normal' | 'expanded'>(() => {
    try { return (localStorage.getItem('rmpg_dashboard_density') as any) || 'normal'; } catch { return 'normal'; }
  });
  const [fullscreenPanel, setFullscreenPanel] = useState<PanelId | null>(null);

  const isCollapsed = useCallback((panel: PanelId) => collapsed.has(panel), [collapsed]);
  const isVisible = useCallback((panel: PanelId) => {
    if (fullscreenPanel) return panel === fullscreenPanel;
    return !collapsed.has(panel);
  }, [collapsed, fullscreenPanel]);

  const togglePanel = useCallback((panel: PanelId) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(panel)) next.delete(panel);
      else next.add(panel);
      saveCollapsed(next);
      return next;
    });
  }, []);

  const setPanelCollapsed = useCallback((panel: PanelId, val: boolean) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (val) next.add(panel);
      else next.delete(panel);
      saveCollapsed(next);
      return next;
    });
  }, []);

  const setDensityMode = useCallback((mode: 'compact' | 'normal' | 'expanded') => {
    setDensity(mode);
    try { localStorage.setItem('rmpg_dashboard_density', mode); } catch { /* ignore */ }
  }, []);

  const gridClass = density === 'compact'
    ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-1'
    : density === 'expanded'
      ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-2';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreenPanel) {
        setFullscreenPanel(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreenPanel]);

  return {
    collapsed, isCollapsed, isVisible, togglePanel, setPanelCollapsed,
    density, setDensity: setDensityMode, gridClass,
    fullscreenPanel, setFullscreenPanel,
  };
}
