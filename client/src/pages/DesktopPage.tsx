// client/src/pages/DesktopPage.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED, type NavFunction } from '../data/navCatalog';
import { loadFavorites, saveFavorites, loadRecent } from '../utils/navFavorites';
import { useUserPreferences, type UserPreferences } from '../context/UserPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { DEFAULT_WALLPAPER_ID } from '../data/desktopWallpapers';
import { DEFAULT_ACCENT_ID, getAccent } from '../data/desktopAccents';
import { normalizeDesktopLayout, serializeDesktopLayout, type DesktopGroup } from '../utils/normalizeDesktopLayout';
import { isFeatureEnabled, useFeatureFlags } from '../utils/featureFlags';
import { normalizeDesktopWidgets, serializeDesktopWidgets } from '../utils/normalizeDesktopWidgets';
import { sortIconPositions, snapToGrid, nextAutoArrangeSlot } from '../utils/desktopLayoutOps';
import { isAutoArrangeEnabled, setAutoArrangeEnabled, areIconsHidden, setIconsHidden } from '../utils/desktopIconPreferences';
import DesktopWallpaper from '../components/desktop/DesktopWallpaper';
import { DesktopWindowManagerProvider, useDesktopWindows } from '../components/desktop/DesktopWindowManager';
import { DesktopSystemProvider } from '../context/DesktopSystemContext';
import DesktopNightLightOverlay from '../components/desktop/DesktopNightLightOverlay';
import DesktopP1AlertOverlay from '../components/desktop/DesktopP1AlertOverlay';
import DesktopWelfareCountdown from '../components/desktop/DesktopWelfareCountdown';
import DesktopActiveCallBar from '../components/desktop/DesktopActiveCallBar';
import DesktopUpdateBanner from '../components/desktop/DesktopUpdateBanner';
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
import DesktopLockScreen from '../components/desktop/DesktopLockScreen';
import DesktopNotificationCenter from '../components/desktop/DesktopNotificationCenter';
import DesktopScreenSaver, { useIdleScreenSaver } from '../components/desktop/DesktopScreenSaver';
import { VirtualDesktopProvider } from '../components/desktop/DesktopVirtualDesktops';
import FlexOSBootSplash from '../components/desktop/FlexOSBootSplash';
import FlexOSPowerMenu from '../components/desktop/FlexOSPowerMenu';
import FlexOSSystemDashboard from '../components/desktop/FlexOSSystemDashboard';
import FlexOSStatusBar, { STATUS_BAR_HEIGHT } from '../components/desktop/FlexOSStatusBar';
import DesktopKeyboardShortcuts from '../components/desktop/DesktopKeyboardShortcuts';
import { useVirtualDesktop } from '../components/desktop/DesktopVirtualDesktops';
import DesktopShortcutReference from '../components/desktop/DesktopShortcutReference';
import DesktopTaskManager from '../components/desktop/apps/DesktopTaskManager';
import DesktopClipboard from '../components/desktop/apps/DesktopClipboard';
import DesktopSnippingTool from '../components/desktop/apps/DesktopSnippingTool';
import DesktopCalendar from '../components/desktop/apps/DesktopCalendar';
import DesktopNotepad from '../components/desktop/apps/DesktopNotepad';
import DesktopSystemPreferences from '../components/desktop/apps/DesktopSystemPreferences';

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

const CAD_AUTO_OPEN_KEY = 'rmpg_cad_auto_opened';

// Opens the Dispatch Console once per session on initial desktop load.
// Must be inside DesktopWindowManagerProvider to access useDesktopWindows.
function CadAutoOpen() {
  const { openWindow } = useDesktopWindows();
  useEffect(() => {
    if (sessionStorage.getItem(CAD_AUTO_OPEN_KEY)) return;
    sessionStorage.setItem(CAD_AUTO_OPEN_KEY, '1');
    // Small delay lets the desktop finish its first render before opening
    const t = setTimeout(() => {
      openWindow('/dispatch', 'Dispatch Console', { width: 1200, height: 900 });
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Bridges keyboard shortcuts into the window manager + virtual desktop contexts.
// Must be inside both DesktopWindowManagerProvider and VirtualDesktopProvider.
function DesktopShortcutsInner({ onLock, onSettings, onOpenShortcutRef }: { onLock: () => void; onSettings: () => void; onOpenShortcutRef?: () => void }) {
  const vd = useVirtualDesktop();
  const active = vd?.active ?? 0;
  const setActive = vd?.setActive;
  return (
    <DesktopKeyboardShortcuts
      onLock={onLock}
      onToggleLauncher={onSettings}
      onPrevVirtualDesktop={() => setActive?.(active - 1)}
      onNextVirtualDesktop={() => setActive?.(active + 1)}
      onOpenShortcutRef={onOpenShortcutRef}
    />
  );
}

type ArrangeHandles = { cascade: () => void; tileH: () => void; tileV: () => void };

function WindowArrangeSync({ mountRef }: { mountRef: React.MutableRefObject<ArrangeHandles | null> }) {
  const { cascade, tileHorizontal, tileVertical } = useDesktopWindows();
  mountRef.current = {
    cascade: () => cascade(window.innerWidth, window.innerHeight - TASKBAR_HEIGHT_PX[getTaskbarSize()]),
    tileH: () => tileHorizontal(window.innerWidth, window.innerHeight - TASKBAR_HEIGHT_PX[getTaskbarSize()]),
    tileV: () => tileVertical(window.innerWidth, window.innerHeight - TASKBAR_HEIGHT_PX[getTaskbarSize()]),
  };
  return null;
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
  const arrangeRef = useRef<ArrangeHandles | null>(null);
  const { user, signOut } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isClientViewer = user?.role === 'client_viewer';
  const isContractManager = user?.role === 'contract_manager';
  const flagsTick = useFeatureFlags();

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
      if (!isFeatureEnabled(fn.path)) return false;
      return true;
    });
  }, [isAdmin, isClientViewer, isContractManager, flagsTick]);

  const [, forceRerender] = useState(0);
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
  const [notifCenterOpen, setNotifCenterOpen] = useState(false);

  const _storedLock = localStorage.getItem('rmpg_desktop_autolock_secs');
  const _parsedLock = _storedLock !== null ? parseInt(_storedLock, 10) : null;
  // 0 = "Never" (FlexOSSettings). `0 || fallback` treats null and 0 identically,
  // silently overriding "Never" with the default — must check === null separately.
  const autoLockSecs = _parsedLock === 0
    ? Number.MAX_SAFE_INTEGER
    : (_parsedLock || (localStorage.getItem('rmpg_kiosk_shell_enabled') === '1' ? 300 : 900));
  const { ssActive, lockActive, dismissSS, dismissLock } = useIdleScreenSaver(autoLockSecs);
  const [manuallyLocked, setManuallyLocked] = useState(false);
  const [powerMenuOpen, setPowerMenuOpen] = useState(false);
  const [sysDashboardOpen, setSysDashboardOpen] = useState(false);
  const [taskManagerOpen, setTaskManagerOpen] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [snippingOpen, setSnippingOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [sysPrefOpen, setSysPrefOpen] = useState(false);
  const [shortcutRefOpen, setShortcutRefOpen] = useState(false);
  const isLocked = lockActive || manuallyLocked;
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

  // Reconciles `layout.icons` against `pinnedIcons` whenever a favorite lacks
  // a saved position — e.g. a favorite added elsewhere (Module Directory)
  // whose position never made it into `desktop_layout_json`. Without this,
  // DesktopIconGrid falls back to a hardcoded {x:20,y:20} for any unpositioned
  // icon, stacking it directly on top of whatever else already sits there.
  // Only ADDS positions for missing paths — never touches an icon that
  // already has one, so auto-arrange never retroactively moves a placed icon.
  useEffect(() => {
    const positioned = new Set(layout.icons.map(p => p.path));
    const missing = pinnedIcons.filter(fn => !positioned.has(fn.path));
    if (missing.length === 0) return;
    setLayout(prev => {
      const existingPositions = Object.fromEntries(prev.icons.map(p => [p.path, { x: p.x, y: p.y }]));
      const additions = missing.map(fn => {
        const slot = isAutoArrangeEnabled()
          ? nextAutoArrangeSlot(existingPositions)
          : { x: 20 + prev.icons.length * 24, y: 20 + prev.icons.length * 24 };
        existingPositions[fn.path] = slot;
        return { path: fn.path, x: slot.x, y: slot.y };
      });
      return { ...prev, icons: [...prev.icons, ...additions] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedIcons]);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setWidgetSettingsOpen(true);
      }
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        setManuallyLocked(true);
      }
      // Ctrl+Alt+Delete — FlexOS power menu
      if (e.ctrlKey && e.altKey && e.key === 'Delete') {
        e.preventDefault();
        setPowerMenuOpen(v => !v);
      }
      // Ctrl+I — System info dashboard
      if (e.ctrlKey && !e.altKey && e.key === 'i') {
        e.preventDefault();
        setSysDashboardOpen(v => !v);
      }
      // Ctrl+Shift+Esc — Task Manager
      if (e.ctrlKey && e.shiftKey && e.key === 'Escape') {
        e.preventDefault();
        setTaskManagerOpen(v => !v);
      }
      // Meta+V — Clipboard history (Win/Cmd+V intercepted before browser paste)
      if (e.metaKey && !e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        setClipboardOpen(v => !v);
      }
      // Meta+Shift+S — Snipping tool
      if (e.metaKey && e.shiftKey && e.key === 's') {
        e.preventDefault();
        setSnippingOpen(v => !v);
      }
      // Meta+N — Notepad
      if (e.metaKey && !e.shiftKey && !e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        setNotepadOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const accentStyle = useMemo(() => {
    const accent = getAccent(accentId);
    return { '--desktop-shell-accent': accent.accent, '--desktop-shell-accent-shadow': accent.shadow } as React.CSSProperties;
  }, [accentId]);

  const taskbarH = TASKBAR_HEIGHT_PX[getTaskbarSize()];

  return (
    <div style={accentStyle}>
      <DesktopSystemProvider>
      <VirtualDesktopProvider>
      <DesktopWindowManagerProvider>
        <ContextMenu
          items={[
            { label: 'New Sticky Note', onClick: () => addNote(60, 60) },
            { label: '', onClick: () => {}, divider: true },
            { label: 'View: Grid', onClick: () => handleViewModeChange('grid') },
            { label: 'View: List', onClick: () => handleViewModeChange('list') },
            { label: 'Sort: Alphabetical', onClick: () => handleSortModeChange('alpha') },
            { label: 'Sort: Most Used', onClick: () => handleSortModeChange('usage') },
            { label: 'Sort: Manual', onClick: () => handleSortModeChange('manual') },
            { label: `Icon Size: Small${layout.iconSize === 'small' ? ' ✓' : ''}`, onClick: () => handleIconSizeChange('small') },
            { label: `Icon Size: Medium${layout.iconSize === 'medium' ? ' ✓' : ''}`, onClick: () => handleIconSizeChange('medium') },
            { label: `Icon Size: Large${layout.iconSize === 'large' ? ' ✓' : ''}`, onClick: () => handleIconSizeChange('large') },
            { label: isAutoArrangeEnabled() ? 'Auto-arrange: On ✓' : 'Auto-arrange: Off', onClick: () => { setAutoArrangeEnabled(!isAutoArrangeEnabled()); forceRerender(n => n + 1); } },
            { label: areIconsHidden() ? 'Show Desktop Icons' : 'Hide Desktop Icons', onClick: () => { setIconsHidden(!areIconsHidden()); forceRerender(n => n + 1); } },
            { label: '', onClick: () => {}, divider: true },
            { label: 'Cascade Windows', onClick: () => arrangeRef.current?.cascade() },
            { label: 'Tile Horizontally', onClick: () => arrangeRef.current?.tileH() },
            { label: 'Tile Vertically', onClick: () => arrangeRef.current?.tileV() },
            { label: '', onClick: () => {}, divider: true },
            { label: 'FlexOS Settings…', onClick: () => setWidgetSettingsOpen(true) },
            { label: 'System Preferences…', onClick: () => setSysPrefOpen(true) },
            { label: 'Task Manager…', onClick: () => setTaskManagerOpen(true) },
            { label: 'Clipboard History…', onClick: () => setClipboardOpen(true) },
            { label: 'Notepad…', onClick: () => setNotepadOpen(true) },
            { label: 'Schedule Calendar…', onClick: () => setCalendarOpen(true) },
            { label: 'Snipping Tool…', onClick: () => setSnippingOpen(true) },
            { label: 'System Info…', onClick: () => setSysDashboardOpen(true) },
            { label: 'Lock Screen', onClick: () => setManuallyLocked(true) },
          ]}
        >
          <div data-testid="desktop-surface" style={{ position: 'relative', width: '100%', height: `calc(100vh - ${TASKBAR_HEIGHT_PX[getTaskbarSize()] + STATUS_BAR_HEIGHT}px)`, overflow: 'hidden' }}>
            <DesktopWallpaper wallpaperId={wallpaperId}>
              {!areIconsHidden() && (
                pinnedIcons.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    No modules pinned yet — star modules from Module Directory, or right-click here to get started.
                  </div>
                ) : (
                  <DesktopIconGrid
                    icons={pinnedIcons} positions={positions} onReposition={handleReposition} onUnpin={handleUnpin}
                    groups={layout.groups} onCreateGroup={handleCreateGroup} onUngroup={handleUngroup}
                    iconSize={layout.iconSize} viewMode={layout.viewMode}
                  />
                )
              )}
              {notes.map(note => (
                <DesktopStickyNote key={note.id} note={note} onChange={(patch) => updateNote(note.id, patch)} onDelete={() => deleteNote(note.id)} />
              ))}
              <DesktopWidgetPanel widgets={widgets} catalog={allFunctions} onMoveWidget={handleMoveWidget} onAdjustWidget={handleAdjustWidget} />
              <CadAutoOpen />
              <DesktopShortcutsInner onLock={() => setManuallyLocked(true)} onSettings={() => setWidgetSettingsOpen(true)} onOpenShortcutRef={() => setShortcutRefOpen(true)} />
              <WindowArrangeSync mountRef={arrangeRef} />
              <WindowLayer />
              <DesktopWindowSwitcher />
            </DesktopWallpaper>
          </div>
        </ContextMenu>
        <DesktopTaskbar
          icons={pinnedIcons}
          catalog={allFunctions}
          onLock={() => setManuallyLocked(true)}
          onToggleNotifCenter={() => setNotifCenterOpen(v => !v)}
          onPowerMenu={() => setPowerMenuOpen(true)}
        />
        <FlexOSStatusBar />
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
            isAdmin={isAdmin}
          />
        )}
        {taskManagerOpen && <DesktopTaskManager onClose={() => setTaskManagerOpen(false)} />}
        {notepadOpen && <DesktopNotepad onClose={() => setNotepadOpen(false)} />}
      </DesktopWindowManagerProvider>
      </VirtualDesktopProvider>
      <DesktopNightLightOverlay />
      <DesktopP1AlertOverlay />
      <DesktopActiveCallBar taskbarHeightPx={taskbarH} />
      <DesktopUpdateBanner taskbarHeightPx={taskbarH} hasActiveCall={false} />
      </DesktopSystemProvider>
      <DesktopScreenSaver isActive={ssActive && !isLocked} onDismiss={dismissSS} />
      <DesktopLockScreen isLocked={isLocked} onUnlock={() => { dismissLock(); setManuallyLocked(false); }} />
      {notifCenterOpen && <DesktopNotificationCenter onClose={() => setNotifCenterOpen(false)} />}
      {powerMenuOpen && (
        <FlexOSPowerMenu
          onClose={() => setPowerMenuOpen(false)}
          onLock={() => setManuallyLocked(true)}
          onSignOut={() => signOut().catch(() => {})}
        />
      )}
      {sysDashboardOpen && <FlexOSSystemDashboard onClose={() => setSysDashboardOpen(false)} />}
      {clipboardOpen && <DesktopClipboard onClose={() => setClipboardOpen(false)} />}
      {snippingOpen && <DesktopSnippingTool onClose={() => setSnippingOpen(false)} />}
      {calendarOpen && <DesktopCalendar onClose={() => setCalendarOpen(false)} />}
      {sysPrefOpen && (
        <DesktopSystemPreferences
          widgets={widgets} onToggleWidget={handleToggleWidget}
          iconSize={layout.iconSize} onIconSizeChange={handleIconSizeChange}
          viewMode={layout.viewMode} onViewModeChange={handleViewModeChange}
          sortMode={layout.sortMode} onSortModeChange={handleSortModeChange} onSnapToGrid={handleSnapToGrid}
          wallpaperId={wallpaperId} onWallpaperChange={setWallpaperId}
          accentId={accentId} onAccentChange={setAccentId}
          onResetToDefault={handleResetToDefault}
          onClose={() => setSysPrefOpen(false)}
          isAdmin={isAdmin}
        />
      )}
      {shortcutRefOpen && <DesktopShortcutReference onClose={() => setShortcutRefOpen(false)} />}
    </div>
  );
}

// Top-level route component. Gates DesktopPageInner's mount on the real
// preferences fetch resolving — see the comment on DesktopPageInner above for
// why: its one-shot state initializers must never see the still-default
// `prefs` UserPreferencesProvider starts with.
export default function DesktopPage() {
  const { prefs, reload, isLoading } = useUserPreferences();
  const [splashDone, setSplashDone] = useState(false);

  // Show the FlexOS boot splash while preferences are loading, then fade out.
  // The inner shell mounts once preferences arrive so its one-shot initializers
  // read real data — keeping both concerns cleanly separated (see DesktopPageInner comment).
  if (!splashDone) {
    return (
      <>
        {!isLoading && <DesktopPageInner prefs={prefs} reload={reload} />}
        <FlexOSBootSplash ready={!isLoading} onFaded={() => setSplashDone(true)} />
      </>
    );
  }

  return <DesktopPageInner prefs={prefs} reload={reload} />;
}
