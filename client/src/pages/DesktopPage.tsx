// client/src/pages/DesktopPage.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED, type NavFunction } from '../data/navCatalog';
import { loadFavorites, saveFavorites } from '../utils/navFavorites';
import { useUserPreferences, type UserPreferences } from '../context/UserPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { DEFAULT_WALLPAPER_ID, DESKTOP_WALLPAPERS } from '../data/desktopWallpapers';
import DesktopWallpaper from '../components/desktop/DesktopWallpaper';
import { DesktopWindowManagerProvider, useDesktopWindows } from '../components/desktop/DesktopWindowManager';
import FloatingWindow from '../components/desktop/FloatingWindow';
import DesktopIconGrid from '../components/desktop/DesktopIconGrid';
import DesktopTaskbar from '../components/desktop/DesktopTaskbar';
import DesktopWidgetPanel from '../components/desktop/DesktopWidgetPanel';
import DesktopWidgetSettingsPopover from '../components/desktop/DesktopWidgetSettingsPopover';
import ContextMenu from '../components/ContextMenu';

const DEFAULT_WIDGETS = ['clock', 'ops-summary', 'notifications', 'quick-access'];
const GRID_COLS = 6;
const CELL_W = 96;
const CELL_H = 96;

function autoLayout(paths: string[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  paths.forEach((path, i) => {
    positions[path] = { x: (i % GRID_COLS) * CELL_W + 20, y: Math.floor(i / GRID_COLS) * CELL_H + 20 };
  });
  return positions;
}

function WindowLayer() {
  const { windows } = useDesktopWindows();
  return <>{windows.map(w => <FloatingWindow key={w.id} win={w} />)}</>;
}

// Does the actual desktop rendering/state work. Only mounted once the real
// user preferences have loaded (see DesktopPage below) — its one-shot useState
// initializers below read `prefs` synchronously on first render, so `prefs`
// must already be the REAL server-loaded value by the time this mounts, never
// the still-default value UserPreferencesProvider starts with while its own
// fetch is in flight. Otherwise the debounced save effect a few lines down
// would silently PUT default-derived state back to the server on the user's
// very next interaction, clobbering their real saved cross-device layout.
function DesktopPageInner({ prefs, reload }: { prefs: UserPreferences; reload: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isClientViewer = user?.role === 'client_viewer';
  const isContractManager = user?.role === 'contract_manager';

  // Role-filtered full catalog — mirrors ModuleDirectoryPage's visibleCategories
  // filter exactly (adminOnly + CLIENT_VIEWER_BLOCKED + CONTRACT_MANAGER_BLOCKED).
  // Both the icon grid (via `pinnedIcons`, a subset) and the taskbar launcher
  // search (via the `catalog` prop) must derive from this, never from raw
  // NAV_CATEGORIES, or a blocked role could search up a hidden module.
  const allFunctions = useMemo(() => {
    return NAV_CATEGORIES.flatMap(cat => cat.functions).filter(fn => {
      if (fn.adminOnly && !isAdmin) return false;
      if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(fn.path)) return false;
      if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(fn.path)) return false;
      return true;
    });
  }, [isAdmin, isClientViewer, isContractManager]);

  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const pinnedIcons: NavFunction[] = useMemo(
    () => allFunctions.filter(fn => favorites.has(fn.path)),
    [allFunctions, favorites],
  );

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      if (prefs.desktop_layout_json) {
        const parsed = JSON.parse(prefs.desktop_layout_json) as { path: string; x: number; y: number }[];
        return Object.fromEntries(parsed.map(p => [p.path, { x: p.x, y: p.y }]));
      }
    } catch { /* fall through to auto-layout */ }
    return autoLayout([...favorites]);
  });

  const [wallpaperId, setWallpaperId] = useState<string>(prefs.desktop_wallpaper || DEFAULT_WALLPAPER_ID);
  const [enabledWidgets, setEnabledWidgets] = useState<string[]>(() => {
    try {
      return prefs.desktop_widgets_json ? JSON.parse(prefs.desktop_widgets_json) : DEFAULT_WIDGETS;
    } catch { return DEFAULT_WIDGETS; }
  });
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const layout = Object.entries(positions).map(([path, pos]) => ({ path, ...pos }));
      apiFetch('/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          desktop_layout_json: JSON.stringify(layout),
          desktop_wallpaper: wallpaperId,
          desktop_widgets_json: JSON.stringify(enabledWidgets),
        }),
      }).then(() => reload()).catch(() => { /* non-blocking — retried on next change */ });
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, wallpaperId, enabledWidgets]);

  const handleReposition = useCallback((path: string, x: number, y: number) => {
    setPositions(prev => ({ ...prev, [path]: { x, y } }));
  }, []);

  const handleUnpin = useCallback((path: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      next.delete(path);
      saveFavorites(next);
      return next;
    });
    setPositions(prev => {
      const { [path]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleToggleWidget = useCallback((id: string, enabled: boolean) => {
    setEnabledWidgets(prev => enabled ? [...prev.filter(w => w !== id), id] : prev.filter(w => w !== id));
  }, []);

  const handleCycleWallpaper = useCallback(() => {
    setWallpaperId(prev => {
      const idx = DESKTOP_WALLPAPERS.findIndex(w => w.id === prev);
      return DESKTOP_WALLPAPERS[(idx + 1) % DESKTOP_WALLPAPERS.length].id;
    });
  }, []);

  return (
    <DesktopWindowManagerProvider>
      <ContextMenu
        items={[
          { label: 'Change wallpaper', onClick: handleCycleWallpaper },
          { label: 'Widget settings', onClick: () => setWidgetSettingsOpen(true) },
        ]}
      >
        <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
          <DesktopWallpaper wallpaperId={wallpaperId}>
            {pinnedIcons.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--text-muted)' }}>
                No modules pinned yet — star modules from Module Directory, or right-click here to get started.
              </div>
            ) : (
              <DesktopIconGrid icons={pinnedIcons} positions={positions} onReposition={handleReposition} onUnpin={handleUnpin} />
            )}
            <DesktopWidgetPanel enabledWidgets={enabledWidgets} catalog={allFunctions} />
            <WindowLayer />
          </DesktopWallpaper>
        </div>
      </ContextMenu>
      <DesktopTaskbar icons={pinnedIcons} catalog={allFunctions} />
      {widgetSettingsOpen && (
        <DesktopWidgetSettingsPopover
          enabledWidgets={enabledWidgets}
          onToggle={handleToggleWidget}
          onClose={() => setWidgetSettingsOpen(false)}
        />
      )}
    </DesktopWindowManagerProvider>
  );
}

// Top-level route component. Gates DesktopPageInner's mount on the real
// preferences fetch resolving — see the comment on DesktopPageInner above for
// why: its one-shot state initializers must never see the still-default
// `prefs` UserPreferencesProvider starts with.
export default function DesktopPage() {
  const { prefs, reload, isLoading } = useUserPreferences();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading" />
      </div>
    );
  }

  return <DesktopPageInner prefs={prefs} reload={reload} />;
}
