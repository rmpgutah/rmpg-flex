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
import { hasBeenSeeded, markSeeded, getDefaultPinsForRole } from '../utils/defaultModulePins';
import DesktopWallpaper from '../components/desktop/DesktopWallpaper';
import { isDynamicWallpaperEnabled, getDynamicWallpaperDayId, getDynamicWallpaperNightId } from '../utils/dynamicWallpaperPreferences';
import DesktopRecycleBin from '../components/desktop/DesktopRecycleBin';
import { addDeletedIcon, restoreDeletedIcon } from '../utils/recycleBinPreferences';
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
import DesktopEvidenceScratchPad from '../components/desktop/apps/DesktopEvidenceScratchPad';
import DesktopSystemPreferences from '../components/desktop/apps/DesktopSystemPreferences';
import DesktopCommandPalette from '../components/desktop/DesktopCommandPalette';
import DesktopCallTicker from '../components/desktop/DesktopCallTicker';
import DesktopCalculator from '../components/desktop/apps/DesktopCalculator';
import DesktopTimer from '../components/desktop/apps/DesktopTimer';
import DesktopUnitConverter from '../components/desktop/apps/DesktopUnitConverter';
import DesktopEventViewer from '../components/desktop/apps/DesktopEventViewer';
import DesktopFileManager from '../components/desktop/apps/DesktopFileManager';
import DesktopColorPicker from '../components/desktop/apps/DesktopColorPicker';
import DesktopRunDialog from '../components/desktop/DesktopRunDialog';
import DesktopWidgetLibrary from '../components/desktop/DesktopWidgetLibrary';
import { applyHighContrast, isHighContrastEnabled } from '../utils/highContrastPreference';
import DesktopPerfMon from '../components/desktop/apps/DesktopPerfMon';
import DesktopNetworkDiag from '../components/desktop/apps/DesktopNetworkDiag';
import DesktopPrivacyScreen from '../components/desktop/DesktopPrivacyScreen';
import DesktopKioskHUD from '../components/desktop/DesktopKioskHUD';
import { getStartupWindows } from '../utils/startupPreferences';
import { setTextScale, getTextScale, setKeyboardNavEnabled, isKeyboardNavEnabled, setReducedMotion, isReducedMotion, applyCursorStyle } from '../utils/accessibilityPreferences';

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

// Opens startup windows once per session on initial desktop load.
// Reads startup preferences so officers can configure which windows open on boot.
// Falls back to Dispatch Console if the list is empty.
// Must be inside DesktopWindowManagerProvider to access useDesktopWindows.
function CadAutoOpen() {
  const { openWindow } = useDesktopWindows();
  useEffect(() => {
    if (sessionStorage.getItem(CAD_AUTO_OPEN_KEY)) return;
    sessionStorage.setItem(CAD_AUTO_OPEN_KEY, '1');
    // Small delay lets the desktop finish its first render before opening
    const t = setTimeout(() => {
      const windows = getStartupWindows().filter(w => w.enabled);
      if (windows.length === 0) {
        openWindow('/dispatch', 'Dispatch Console', { width: 1200, height: 900 });
      } else {
        for (const w of windows) {
          openWindow(w.path, w.title, { width: w.width, height: w.height });
        }
      }
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Bridges keyboard shortcuts into the window manager + virtual desktop contexts.
// Must be inside both DesktopWindowManagerProvider and VirtualDesktopProvider.
function DesktopShortcutsInner({ onLock, onSettings, onOpenShortcutRef, onOpenCommandPalette, onOpenCalculator }: { onLock: () => void; onSettings: () => void; onOpenShortcutRef?: () => void; onOpenCommandPalette?: () => void; onOpenCalculator?: () => void }) {
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
      onOpenCommandPalette={onOpenCommandPalette}
      onOpenCalculator={onOpenCalculator}
    />
  );
}

// Exposes openWindow from inside DesktopWindowManagerProvider via a ref.
function OpenWindowBridge({ mountRef }: { mountRef: React.MutableRefObject<((path: string, title: string, size?: { width: number; height: number }) => boolean) | null> }) {
  const { openWindow } = useDesktopWindows();
  mountRef.current = openWindow;
  return null;
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

// Wires Ctrl+Shift+T → reopenLastClosed (must be inside DesktopWindowManagerProvider)
function ReopenLastClosedBridge() {
  const { reopenLastClosed } = useDesktopWindows();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        reopenLastClosed();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [reopenLastClosed]);
  return null;
}

function CfsFocusBridge() {
  const { windows, focusedId } = useDesktopWindows();
  useEffect(() => {
    if (!focusedId) return;
    const win = windows.find(w => w.id === focusedId);
    if (!win?.path) return;
    const match = win.path.match(/[?&]call=([^&]+)/);
    if (!match) return;
    window.dispatchEvent(new CustomEvent('flexos-cfs-focused', {
      detail: { callId: match[1], callNumber: match[1] },
    }));
  }, [focusedId, windows]);
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
// Draggable calculator floater — rendered inside DesktopWindowManagerProvider so
// it can be stacked above windows via z-index without needing a full FloatingWindow.
function CalculatorFloater({ onClose }: { onClose: () => void }) {
  const [pos, setPos] = React.useState({ x: Math.max(0, window.innerWidth / 2 - 140), y: Math.max(0, window.innerHeight / 2 - 200) });
  const dragRef = React.useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  function onMouseDown(e: React.MouseEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.origX + ev.clientX - dragRef.current.startX, y: dragRef.current.origY + ev.clientY - dragRef.current.startY });
    }
    function onUp() { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div style={{ position: 'fixed', left: pos.x, top: pos.y, width: 280, height: 400, zIndex: 12500, background: 'var(--surface-raised)', border: '1px solid var(--border-default)', boxShadow: '0 8px 32px rgba(0 0 0 / 0.6)', display: 'flex', flexDirection: 'column', borderRadius: 2 }}>
      <div onMouseDown={onMouseDown} style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-subtle)', cursor: 'move', userSelect: 'none', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', flex: 1, letterSpacing: '0.04em' }}>Calculator</span>
        <button type="button" onClick={onClose} aria-label="Close calculator" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DesktopCalculator />
      </div>
    </div>
  );
}

function DesktopPageInner({ prefs, reload }: { prefs: UserPreferences; reload: () => void }) {
  const arrangeRef = useRef<ArrangeHandles | null>(null);
  const openWindowRef = useRef<((path: string, title: string, size?: { width: number; height: number }) => boolean) | null>(null);
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

  // Auto-pin role-appropriate defaults on first boot so the desktop is never empty.
  useEffect(() => {
    if (!user?.role || hasBeenSeeded()) return;
    const defaults = getDefaultPinsForRole(user.role);
    setFavorites(prev => {
      const next = new Set(prev);
      defaults.forEach(path => next.add(path));
      saveFavorites(next);
      return next;
    });
    markSeeded();
  }, [user?.role]);

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
  const [scratchPadOpen, setScratchPadOpen] = useState(false);
  const [sysPrefOpen, setSysPrefOpen] = useState(false);
  const [shortcutRefOpen, setShortcutRefOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [converterOpen, setConverterOpen] = useState(false);
  const [eventViewerOpen, setEventViewerOpen] = useState(false);
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [callTickerEnabled, setCallTickerEnabled] = useState(() => localStorage.getItem('rmpg_call_ticker') !== '0');
  const [widgetLibraryOpen, setWidgetLibraryOpen] = useState(false);
  const [perfmonOpen, setPerfmonOpen] = useState(false);
  const [netdiagOpen, setNetdiagOpen] = useState(false);
  const [privacyScreenActive, setPrivacyScreenActive] = useState(
    () => localStorage.getItem('rmpg_privacy_screen') === '1'
  );
  const [kioskHudOpen, setKioskHudOpen] = useState(false);
  const isLocked = lockActive || manuallyLocked;

  useEffect(() => {
    const handler = () => setKioskHudOpen(true);
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.altKey && e.key.toLowerCase() === 'f') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h')) {
        e.preventDefault();
        setKioskHudOpen(prev => !prev);
      }
    };
    window.addEventListener('flexos:open-kiosk-hud', handler);
    window.addEventListener('keydown', keyHandler);
    return () => {
      window.removeEventListener('flexos:open-kiosk-hud', handler);
      window.removeEventListener('keydown', keyHandler);
    };
  }, []);

  // Apply high contrast and accessibility preferences on mount
  useEffect(() => {
    applyHighContrast(isHighContrastEnabled());
    setTextScale(getTextScale());
    setKeyboardNavEnabled(isKeyboardNavEnabled());
    setReducedMotion(isReducedMotion());
    applyCursorStyle();
  }, []);

  // Log session events (login and unlock)
  const hasLoggedLogin = useRef(false);
  useEffect(() => {
    if (!user || hasLoggedLogin.current) return;
    hasLoggedLogin.current = true;
    apiFetch('/errors', {
      method: 'POST',
      body: JSON.stringify({ severity: 'info', category: 'session', message: 'Session started', source: 'desktop' }),
    }).catch(() => { /* non-blocking */ });
  }, [user]);

  const prevLockedRef = useRef(isLocked);
  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    prevLockedRef.current = isLocked;
    if (wasLocked && !isLocked && user) {
      apiFetch('/errors', {
        method: 'POST',
        body: JSON.stringify({ severity: 'info', category: 'session', message: 'Session unlocked', source: 'desktop' }),
      }).catch(() => { /* non-blocking */ });
    }
  }, [isLocked, user]);
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
      apiFetch('/user/preferences', {
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
    // Find the label for the icon before removing it so we can record it in the recycle bin.
    const fn = allFunctions.find(f => f.path === path);
    if (fn) addDeletedIcon({ path: fn.path, label: fn.label });
    setFavorites(prev => {
      const next = new Set(prev);
      next.delete(path);
      saveFavorites(next);
      return next;
    });
    setLayout(prev => ({ ...prev, icons: prev.icons.filter(p => p.path !== path) }));
  }, [allFunctions]);

  const handleRecycleBinRestore = useCallback((path: string) => {
    restoreDeletedIcon(path);
    const fn = allFunctions.find(f => f.path === path);
    if (!fn) return;
    setFavorites(prev => {
      const next = new Set(prev);
      next.add(path);
      saveFavorites(next);
      return next;
    });
  }, [allFunctions]);

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
      // Meta+P — Privacy screen toggle
      if (e.metaKey && !e.shiftKey && !e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        setPrivacyScreenActive(v => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Bridge custom events from Run dialog and other event-dispatching surfaces
  useEffect(() => {
    function onOpenApp(e: Event) {
      const appKey = (e as CustomEvent<string>).detail;
      if (appKey === 'calc') setCalculatorOpen(true);
      if (appKey === 'notepad') setNotepadOpen(true);
      if (appKey === 'task-manager') setTaskManagerOpen(true);
      if (appKey === 'timer') setTimerOpen(true);
      if (appKey === 'converter') setConverterOpen(true);
      if (appKey === 'event-viewer') setEventViewerOpen(true);
      if (appKey === 'file-manager') setFileManagerOpen(true);
      if (appKey === 'color-picker') setColorPickerOpen(true);
      if (appKey === 'perfmon') setPerfmonOpen(true);
      if (appKey === 'netdiag') setNetdiagOpen(true);
    }
    function onOpenRun() { setRunDialogOpen(true); }
    window.addEventListener('flexos:open-app', onOpenApp);
    window.addEventListener('open-run-dialog', onOpenRun);
    return () => {
      window.removeEventListener('flexos:open-app', onOpenApp);
      window.removeEventListener('open-run-dialog', onOpenRun);
    };
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
            { label: 'Add Widget…', onClick: () => setWidgetLibraryOpen(true) },
            { label: 'FlexOS Settings…', onClick: () => setWidgetSettingsOpen(true) },
            { label: 'System Preferences…', onClick: () => setSysPrefOpen(true) },
            { label: 'Task Manager…', onClick: () => setTaskManagerOpen(true) },
            { label: 'Clipboard History…', onClick: () => setClipboardOpen(true) },
            { label: 'Notepad…', onClick: () => setNotepadOpen(true) },
            { label: 'Evidence Scratch Pad…', onClick: () => setScratchPadOpen(true) },
            { label: 'Schedule Calendar…', onClick: () => setCalendarOpen(true) },
            { label: 'Snipping Tool…', onClick: () => setSnippingOpen(true) },
            { label: 'System Info…', onClick: () => setSysDashboardOpen(true) },
            { label: '', onClick: () => {}, divider: true },
            { label: 'Command Palette…', onClick: () => setCommandPaletteOpen(true) },
            { label: 'Calculator…', onClick: () => setCalculatorOpen(true) },
            { label: callTickerEnabled ? 'Hide Call Ticker' : 'Show Call Ticker', onClick: () => setCallTickerEnabled(v => { localStorage.setItem('rmpg_call_ticker', v ? '0' : '1'); return !v; }) },
            { label: '', onClick: () => {}, divider: true },
            { label: 'Lock Screen', onClick: () => setManuallyLocked(true) },
          ]}
        >
          <div data-testid="desktop-surface" style={{ position: 'relative', width: '100%', height: `calc(100vh - ${TASKBAR_HEIGHT_PX[getTaskbarSize()] + STATUS_BAR_HEIGHT}px)`, overflow: 'hidden' }}>
            <DesktopWallpaper
              wallpaperId={wallpaperId}
              dynamicWallpaper={isDynamicWallpaperEnabled() ? { dayWallpaperId: getDynamicWallpaperDayId() || wallpaperId, nightWallpaperId: getDynamicWallpaperNightId() || wallpaperId } : undefined}
            >
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
              <DesktopShortcutsInner onLock={() => setManuallyLocked(true)} onSettings={() => setWidgetSettingsOpen(true)} onOpenShortcutRef={() => setShortcutRefOpen(true)} onOpenCommandPalette={() => setCommandPaletteOpen(true)} onOpenCalculator={() => setCalculatorOpen(true)} />
              <WindowArrangeSync mountRef={arrangeRef} />
              <OpenWindowBridge mountRef={openWindowRef} />
              <CfsFocusBridge />
              <ReopenLastClosedBridge />
              <WindowLayer />
              <DesktopWindowSwitcher />
              {/* Recycle Bin — always-visible in bottom-right of desktop area */}
              <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10 }}>
                <DesktopRecycleBin onRestore={handleRecycleBinRestore} />
              </div>
            </DesktopWallpaper>
          </div>
        </ContextMenu>
        {callTickerEnabled && <DesktopCallTicker onOpenCall={(id) => openWindowRef.current?.(`/dispatch?call=${id}`, 'Dispatch')} />}
        <DesktopTaskbar
          icons={pinnedIcons}
          catalog={allFunctions}
          onLock={() => setManuallyLocked(true)}
          onToggleNotifCenter={() => setNotifCenterOpen(v => !v)}
          onPowerMenu={() => setPowerMenuOpen(true)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onNewCall={() => setCommandPaletteOpen(true)}
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
        {timerOpen && <DesktopTimer onClose={() => setTimerOpen(false)} />}
        {converterOpen && <DesktopUnitConverter onClose={() => setConverterOpen(false)} />}
        {eventViewerOpen && <DesktopEventViewer onClose={() => setEventViewerOpen(false)} />}
        {fileManagerOpen && <DesktopFileManager onClose={() => setFileManagerOpen(false)} />}
        {colorPickerOpen && <DesktopColorPicker onClose={() => setColorPickerOpen(false)} />}
        {perfmonOpen && <DesktopPerfMon onClose={() => setPerfmonOpen(false)} />}
        {netdiagOpen && <DesktopNetworkDiag onClose={() => setNetdiagOpen(false)} />}
        {notepadOpen && <DesktopNotepad onClose={() => setNotepadOpen(false)} />}
        {calculatorOpen && (
          <CalculatorFloater onClose={() => setCalculatorOpen(false)} />
        )}
        {scratchPadOpen && <DesktopEvidenceScratchPad onClose={() => setScratchPadOpen(false)} />}
        <DesktopKioskHUD isOpen={kioskHudOpen} onClose={() => setKioskHudOpen(false)} onOpenWindow={(path, title, size) => openWindowRef.current?.(path, title, size)} />
      </DesktopWindowManagerProvider>
      </VirtualDesktopProvider>
      <DesktopNightLightOverlay />
      <DesktopP1AlertOverlay />
      {privacyScreenActive && <DesktopPrivacyScreen onClose={() => setPrivacyScreenActive(false)} />}
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
      {commandPaletteOpen && (
        <DesktopCommandPalette
          allFunctions={allFunctions}
          onNavigate={(path) => {
            const fn = allFunctions.find(f => f.path === path);
            openWindowRef.current?.(path, fn?.label ?? 'Module');
            setCommandPaletteOpen(false);
          }}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      <DesktopRunDialog open={runDialogOpen} onClose={() => setRunDialogOpen(false)} />
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
      {widgetLibraryOpen && (
        <DesktopWidgetLibrary
          widgets={widgets}
          onAdd={id => { handleToggleWidget(id, true); }}
          onRemove={id => { handleToggleWidget(id, false); }}
          onClose={() => setWidgetLibraryOpen(false)}
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
