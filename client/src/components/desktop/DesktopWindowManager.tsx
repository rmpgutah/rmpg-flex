import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

export interface DesktopWindowState {
  id: string;
  path: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  alwaysOnTop: boolean;
  opacity: number;
}

interface DesktopWindowManagerContextValue {
  windows: DesktopWindowState[];
  /** Returns true if the window was opened/focused, false if the cap was hit and the call was a no-op. */
  openWindow: (path: string, title: string, size?: { width: number; height: number }) => boolean;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => void;
  /** Updates a window's display title only — never its path/iframe src. See FloatingWindow.tsx's title-sync effect for why those must stay decoupled. */
  updateWindowTitle: (id: string, title: string) => void;
  /** Minimizes every currently non-minimized window and returns the ids it touched, so a caller can later restore exactly those and leave anything the user had already minimized alone. */
  minimizeAll: () => string[];
  restoreAll: (ids: string[]) => void;
  toggleAlwaysOnTop: (id: string) => void;
}

const SESSION_KEY = 'rmpg_desktop_windows';
const MAX_OPEN_WINDOWS = 10;

const DesktopWindowManagerContext = createContext<DesktopWindowManagerContextValue | null>(null);

export function useDesktopWindows(): DesktopWindowManagerContextValue {
  const ctx = useContext(DesktopWindowManagerContext);
  if (!ctx) throw new Error('useDesktopWindows must be used within DesktopWindowManagerProvider');
  return ctx;
}

function loadSession(): DesktopWindowState[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

let nextZIndex = 100;

export function DesktopWindowManagerProvider({ children }: { children: React.ReactNode }) {
  const [windows, setWindows] = useState<DesktopWindowState[]>(loadSession);
  // Synchronous source of truth for openWindow's cap check and boolean return value.
  // React's setWindows(prev => ...) updater is NOT guaranteed to run synchronously when
  // multiple mutator calls happen inside the same event-handler batch (React 18 only
  // eagerly evaluates the first update in a queue per render cycle) — so a value
  // captured via closure from inside that updater cannot be trusted as a same-tick
  // return value. windowsRef is read and written by plain assignment instead, so every
  // mutator sees the true up-to-the-instant state regardless of React's batching.
  const windowsRef = useRef<DesktopWindowState[]>(windows);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(windows)); } catch { /* silent */ }
    }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [windows]);

  const commit = useCallback((next: DesktopWindowState[]) => {
    windowsRef.current = next;
    setWindows(next);
  }, []);

  const openWindow = useCallback((path: string, title: string, size?: { width: number; height: number }) => {
    const prev = windowsRef.current;
    const existing = prev.find(w => w.path === path);
    if (existing) {
      nextZIndex += 1;
      commit(prev.map(w => w.id === existing.id ? { ...w, minimized: false, zIndex: nextZIndex } : w));
      return true;
    }
    if (prev.length >= MAX_OPEN_WINDOWS) return false;
    nextZIndex += 1;
    const offset = prev.length * 24;
    const win: DesktopWindowState = {
      id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path, title,
      x: 80 + offset, y: 60 + offset,
      width: size?.width ?? 1050, height: size?.height ?? 800,
      zIndex: nextZIndex, minimized: false, maximized: false,
      alwaysOnTop: false, opacity: 1,
    };
    commit([...prev, win]);
    return true;
  }, [commit]);

  const closeWindow = useCallback((id: string) => {
    commit(windowsRef.current.filter(w => w.id !== id));
  }, [commit]);

  const focusWindow = useCallback((id: string) => {
    nextZIndex += 1;
    const z = nextZIndex;
    commit(windowsRef.current.map(w => w.id === id ? { ...w, zIndex: z, minimized: false } : w));
  }, [commit]);

  const minimizeWindow = useCallback((id: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, minimized: !w.minimized } : w));
  }, [commit]);

  const toggleMaximize = useCallback((id: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w));
  }, [commit]);

  const moveResize = useCallback((id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, ...patch } : w));
  }, [commit]);

  const updateWindowTitle = useCallback((id: string, title: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, title } : w));
  }, [commit]);

  const minimizeAll = useCallback(() => {
    const prev = windowsRef.current;
    const toMinimize = prev.filter(w => !w.minimized).map(w => w.id);
    if (toMinimize.length === 0) return [];
    commit(prev.map(w => toMinimize.includes(w.id) ? { ...w, minimized: true } : w));
    return toMinimize;
  }, [commit]);

  const restoreAll = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    commit(windowsRef.current.map(w => ids.includes(w.id) ? { ...w, minimized: false } : w));
  }, [commit]);

  const toggleAlwaysOnTop = useCallback((id: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, alwaysOnTop: !w.alwaysOnTop } : w));
  }, [commit]);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, minimizeAll, restoreAll, toggleAlwaysOnTop }}
    >
      {children}
    </DesktopWindowManagerContext.Provider>
  );
}
