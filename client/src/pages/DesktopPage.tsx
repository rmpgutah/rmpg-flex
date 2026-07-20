// client/src/pages/DesktopPage.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED, type NavFunction } from '../data/navCatalog';
import { loadFavorites, saveFavorites, loadRecent } from '../utils/navFavorites';
import { useUserPreferences, type UserPreferences } from '../context/UserPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { DEFAULT_WALLPAPER_ID } from '../data/desktopWallpapers';
import { DEFAULT_ACCENT_ID, getAccent } from '../data/desktopAccents';
import { normalizeDesktopLayout, serializeDesktopLayout, type DesktopGroup } from '../utils/normalizeDesktopLayout';
import { normalizeDesktopWidgets, serializeDesktopWidgets } from '../utils/normalizeDesktopWidgets';
import { sortIconPositions, snapToGrid } from '../utils/desktopLayoutOps';
import DesktopWallpaper from '../components/desktop/DesktopWallpaper';
import { DesktopWindowManagerProvider, useDesktopWindows } from '../components/desktop/DesktopWindowManager';
import FloatingWindow from '../components/desktop/FloatingWindow';
import DesktopWindowSwitcher from '../components/desktop/DesktopWindowSwitcher';
import DesktopIconGrid from '../components/desktop/DesktopIconGrid';
import DesktopTaskbar, { TASKBAR_HEIGHT_PX } from '../components/desktop/DesktopTaskbar';
import { getTaskbarSize } from '../utils/taskbarPreferences';
import DesktopWidgetPanel from '../components/desktop/DesktopWidgetPanel';
import DesktopSettingsApp from '../components/desktop/DesktopSettingsApp';
import DesktopStickyNote from '../components/desktop/DesktopStickyNote';
import { useDesktopNotes, type DesktopNote } from '../hooks/useDesktopNotes';
import ContextMenu from '../components/ContextMenu';

const GRID_COLS = 6;
const CELL_W = 96;
const CELL_H = 96;

function autoLayoutIcons(paths: string[]): { path: string; x: number; y: number }[] {
  return paths.map((path, i) => ({ path, x: (i % GRID_COLS) * CELL_W + 20, y: Math.floor(i / GRID_COLS) * CELL_H + 20 }));
}

function parseDesktopNotes(raw: string | null | undefined): DesktopNote[] {
  try {
    return raw ? (JSON.parse(raw) as DesktopNote[]) : [];
  } catch {
    return [];
  }
}

function WindowLayer() {
  const { windows } = useDesktopWindows();
  return <>{windows.map(w => <FloatingWindow key={w.id} win={w} />)}</>;
}

// Does the actual desktop rendering/state work. Only mounted once the real
// user preferences have loaded (see DesktopPage below) — its one-shot state
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

  const [layout, setLayout] = useState(() => {
    const normalized = normalizeDesktopLayout(prefs.desktop_layout_json);
    if (normalized.icons.length === 0 && favorites.size > 0) {
      return { ...normalized, icons: autoLayoutIcons([...favorites]) };
    }
    return normalized;
  });
  const positions = useMemo(
    () => Object.fromEntries(layout.icons.map(p => [p.path, { x: p.x, y: p.y }])),
    [layout.icons],
  );

  const [wallpaperId, setWallpaperId] = useState<string>(prefs.desktop_wallpaper || DEFAULT_WALLPAPER_ID);
  const [accentId, setAccentId] = useState<string>(prefs.desktop_accent || DEFAULT_ACCENT_ID);
  const [widgets, setWidgets] = useState(() => normalizeDesktopWidgets(prefs.desktop_widgets_json));
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);
  // `useDesktopNotes` takes a plain initial array (not a lazy initializer), so
  // the parse happens eagerly here — cheap for a small JSON blob, and this
  // component only mounts once real prefs have resolved (see the comment
  // above), so it never re-runs against stale/default data mid-session.
  const { notes, addNote, updateNote, deleteNote, clearNotes } = useDesktopNotes(parseDesktopNotes(prefs.desktop_notes_json));

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiFetch('/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          desktop_layout_json: serializeDesktopLayout(layout),
          desktop_wallpaper: wallpaperId,
          desktop_widgets_json: serializeDesktopWidgets(widgets),
          desktop_accent: accentId,
          desktop_notes_json: JSON.stringify(notes),
        }),
      }).then(() => reload()).catch(() => { /* non-blocking — retried on next change */ });
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, wallpaperId, widgets, accentId, notes]);

  const handleReposition = useCallback((path: string, x: number, y: number) => {
    setLayout(prev => ({ ...prev, icons: prev.icons.map(p => p.path === path ? { ...p, x, y } : p) }));
  }, []);

  const handleUnpin = useCallback((path: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      next.delete(path);
      saveFavorites(next);
      return next;
    });
    setLayout(prev => ({ ...prev, icons: prev.icons.filter(p => p.path !== path) }));
  }, []);

  const handleCreateGroup = useCallback((memberPaths: string[], label: string) => {
    setLayout(prev => {
      const members = prev.icons.filter(p => memberPaths.includes(p.path));
      if (members.length === 0) return prev;
      const minX = Math.min(...members.map(m => m.x)) - 12;
      const minY = Math.min(...members.map(m => m.y)) - 30;
      const maxX = Math.max(...members.map(m => m.x)) + 88;
      const maxY = Math.max(...members.map(m => m.y)) + 100;
      const group: DesktopGroup = { id: `group_${Date.now()}`, label, x: minX, y: minY, w: maxX - minX, h: maxY - minY, memberPaths };
      return { ...prev, groups: [...prev.groups, group] };
    });
  }, []);

  const handleUngroup = useCallback((groupId: string) => {
    setLayout(prev => ({ ...prev, groups: prev.groups.filter(g => g.id !== groupId) }));
  }, []);

  const handleIconSizeChange = useCallback((iconSize: 'small' | 'medium' | 'large') => {
    setLayout(prev => ({ ...prev, iconSize }));
  }, []);

  const handleViewModeChange = useCallback((viewMode: 'grid' | 'list') => {
    setLayout(prev => ({ ...prev, viewMode }));
  }, []);

  const handleSortModeChange = useCallback((sortMode: 'manual' | 'alpha' | 'usage') => {
    setLayout(prev => {
      if (sortMode === 'manual') return { ...prev, sortMode };
      const sorted = sortIconPositions(pinnedIcons, sortMode, loadRecent());
      return { ...prev, sortMode, icons: prev.icons.map(p => ({ ...p, ...(sorted[p.path] ?? {}) })) };
    });
  }, [pinnedIcons]);

  const handleSnapToGrid = useCallback(() => {
    setLayout(prev => {
      const snapped = snapToGrid(Object.fromEntries(prev.icons.map(p => [p.path, { x: p.x, y: p.y }])));
      return { ...prev, icons: prev.icons.map(p => ({ ...p, ...snapped[p.path] })) };
    });
  }, []);

  const handleToggleWidget = useCallback((id: string, enabled: boolean) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, on: enabled } : w));
  }, []);

  const handleMoveWidget = useCallback((id: string, x: number, y: number) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, x, y } : w));
  }, []);

  const handleAdjustWidget = useCallback((id: string, patch: { opacity?: number; blur?: number }) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  }, []);

  const handleResetToDefault = useCallback(() => {
    setLayout({ ...normalizeDesktopLayout(null), icons: autoLayoutIcons([...favorites]) });
    setWallpaperId(DEFAULT_WALLPAPER_ID);
    setAccentId(DEFAULT_ACCENT_ID);
    setWidgets(normalizeDesktopWidgets(null));
    clearNotes();
  }, [favorites, clearNotes]);

  const accentStyle = useMemo(() => {
    const accent = getAccent(accentId);
    return { '--desktop-shell-accent': accent.accent, '--desktop-shell-accent-shadow': accent.shadow } as React.CSSProperties;
  }, [accentId]);

  return (
    <div style={accentStyle}>
      <DesktopWindowManagerProvider>
        <ContextMenu
          items={[
            { label: 'Settings', onClick: () => setWidgetSettingsOpen(true) },
            { label: 'New sticky note', onClick: () => addNote(60, 60) },
          ]}
        >
          <div style={{ position: 'relative', width: '100%', height: `calc(100vh - ${TASKBAR_HEIGHT_PX[getTaskbarSize()]}px)`, overflow: 'hidden' }}>
            <DesktopWallpaper wallpaperId={wallpaperId}>
              {pinnedIcons.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  No modules pinned yet — star modules from Module Directory, or right-click here to get started.
                </div>
              ) : (
                <DesktopIconGrid
                  icons={pinnedIcons} positions={positions} onReposition={handleReposition} onUnpin={handleUnpin}
                  groups={layout.groups} onCreateGroup={handleCreateGroup} onUngroup={handleUngroup}
                  iconSize={layout.iconSize} viewMode={layout.viewMode}
                />
              )}
              {notes.map(note => (
                <DesktopStickyNote key={note.id} note={note} onChange={(patch) => updateNote(note.id, patch)} onDelete={() => deleteNote(note.id)} />
              ))}
              <DesktopWidgetPanel widgets={widgets} catalog={allFunctions} onMoveWidget={handleMoveWidget} onAdjustWidget={handleAdjustWidget} />
              <WindowLayer />
              <DesktopWindowSwitcher />
            </DesktopWallpaper>
          </div>
        </ContextMenu>
        <DesktopTaskbar icons={pinnedIcons} catalog={allFunctions} />
        {widgetSettingsOpen && (
          <DesktopSettingsApp
            widgets={widgets} onToggleWidget={handleToggleWidget}
            iconSize={layout.iconSize} onIconSizeChange={handleIconSizeChange}
            viewMode={layout.viewMode} onViewModeChange={handleViewModeChange}
            sortMode={layout.sortMode} onSortModeChange={handleSortModeChange} onSnapToGrid={handleSnapToGrid}
            wallpaperId={wallpaperId} onWallpaperChange={setWallpaperId}
            accentId={accentId} onAccentChange={setAccentId}
            onResetToDefault={handleResetToDefault}
            onClose={() => setWidgetSettingsOpen(false)}
          />
        )}
      </DesktopWindowManagerProvider>
    </div>
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
