import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getSavedPosition, saveWindowPosition } from '../../utils/desktopWindowPositions';
import { getDefaultWindowOpacity } from '../../utils/windowOpacityPreference';
import { playDesktopSound } from '../../utils/desktopSounds';

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

interface ClosedWindowRecord {
  path: string;
  title: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface DesktopWindowManagerContextValue {
  windows: DesktopWindowState[];
  /** Returns true if the window was opened/focused, false if the cap was hit and the call was a no-op. */
  openWindow: (path: string, title: string, size?: { width: number; height: number }) => boolean;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveResize: (id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>, options?: { persist?: boolean }) => void;
  /** Updates a window's display title only — never its path/iframe src. See FloatingWindow.tsx's title-sync effect for why those must stay decoupled. */
  updateWindowTitle: (id: string, title: string) => void;
  /** Minimizes every currently non-minimized window and returns the ids it touched, so a caller can later restore exactly those and leave anything the user had already minimized alone. */
  minimizeAll: () => string[];
  restoreAll: (ids: string[]) => void;
  toggleAlwaysOnTop: (id: string) => void;
  setWindowOpacity: (id: string, opacity: number) => void;
  /** Minimizes all windows except the given id (Aero Shake). */
  minimizeOthers: (exceptId: string) => void;
  /** Cascades all visible (non-minimized) windows in a stair-step pattern. */
  cascade: (desktopW?: number, desktopH?: number) => void;
  /** Tiles all visible windows horizontally (side by side). */
  tileHorizontal: (desktopW?: number, desktopH?: number) => void;
  /** Tiles all visible windows vertically (stacked). */
  tileVertical: (desktopW?: number, desktopH?: number) => void;
  /** ID of the topmost (highest zIndex) non-minimized window, or null. */
  focusedId: string | null;
  /** Recently closed windows (max 5), newest first. */
  closedHistory: ClosedWindowRecord[];
  /** Reopen the most recently closed window at its original position. */
  reopenLastClosed: () => void;
}

const SESSION_KEY = 'rmpg_desktop_windows';
const MAX_OPEN_WINDOWS = 10;
const MAX_CLOSED_HISTORY = 5;
const MIN_WINDOW_OPACITY = 0.3;
const MAX_WINDOW_OPACITY = 1;

function clampOpacity(value: number): number {
  return Math.max(MIN_WINDOW_OPACITY, Math.min(MAX_WINDOW_OPACITY, Math.round(value * 10) / 10));
}

const DesktopWindowManagerContext = createContext<DesktopWindowManagerContextValue | null>(null);

export function useDesktopWindows(): DesktopWindowManagerContextValue {
  const ctx = useContext(DesktopWindowManagerContext);
  if (!ctx) throw new Error('useDesktopWindows must be used within DesktopWindowManagerProvider');
  return ctx;
}

export function useOptionalDesktopWindows(): DesktopWindowManagerContextValue | null {
  return useContext(DesktopWindowManagerContext);
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
  const [closedHistory, setClosedHistory] = useState<ClosedWindowRecord[]>([]);
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
    const saved = getSavedPosition(path);
    const win: DesktopWindowState = {
      id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path, title,
      x: saved?.x ?? (80 + offset), y: saved?.y ?? (60 + offset),
      width: saved?.width ?? size?.width ?? 1050, height: saved?.height ?? size?.height ?? 800,
      zIndex: nextZIndex, minimized: false, maximized: false,
      alwaysOnTop: false, opacity: getDefaultWindowOpacity(),
    };
    commit([...prev, win]);
    playDesktopSound();
    return true;
  }, [commit]);

  const closeWindow = useCallback((id: string) => {
    const closing = windowsRef.current.find(w => w.id === id);
    if (closing) {
      saveWindowPosition(closing.path, { x: closing.x, y: closing.y, width: closing.width, height: closing.height });
      const record: ClosedWindowRecord = { path: closing.path, title: closing.title, width: closing.width, height: closing.height, x: closing.x, y: closing.y };
      setClosedHistory(prev => [record, ...prev].slice(0, MAX_CLOSED_HISTORY));
    }
    commit(windowsRef.current.filter(w => w.id !== id));
    playDesktopSound();
  }, [commit]);

  const reopenLastClosed = useCallback(() => {
    setClosedHistory(prev => {
      if (prev.length === 0) return prev;
      const [top, ...rest] = prev;
      // openWindow focuses the window if it's already open; otherwise creates it
      const prev2 = windowsRef.current;
      const existing = prev2.find(w => w.path === top.path);
      if (existing) {
        nextZIndex += 1;
        commit(prev2.map(w => w.id === existing.id ? { ...w, minimized: false, zIndex: nextZIndex } : w));
      } else if (prev2.length < MAX_OPEN_WINDOWS) {
        nextZIndex += 1;
        const win: DesktopWindowState = {
          id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          path: top.path, title: top.title,
          x: top.x, y: top.y, width: top.width, height: top.height,
          zIndex: nextZIndex, minimized: false, maximized: false,
          alwaysOnTop: false, opacity: getDefaultWindowOpacity(),
        };
        commit([...prev2, win]);
        playDesktopSound();
      }
      return rest;
    });
  }, [commit]);

  const focusWindow = useCallback((id: string) => {
    nextZIndex += 1;
    const z = nextZIndex;
    commit(windowsRef.current.map(w => w.id === id ? { ...w, zIndex: z, minimized: false } : w));
  }, [commit]);

  const minimizeWindow = useCallback((id: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, minimized: !w.minimized } : w));
    playDesktopSound();
  }, [commit]);

  const toggleMaximize = useCallback((id: string) => {
    commit(windowsRef.current.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w));
  }, [commit]);

  const moveResize = useCallback((id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>, options?: { persist?: boolean }) => {
    const next = windowsRef.current.map(w => w.id === id ? { ...w, ...patch } : w);
    commit(next);
    const updated = next.find(w => w.id === id);
    const persist = options?.persist ?? true;
    if (updated && persist) {
      saveWindowPosition(updated.path, { x: updated.x, y: updated.y, width: updated.width, height: updated.height });
    }
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

  const setWindowOpacity = useCallback((id: string, opacity: number) => {
    const clamped = clampOpacity(opacity);
    commit(windowsRef.current.map(w => w.id === id ? { ...w, opacity: clamped } : w));
  }, [commit]);

  const minimizeOthers = useCallback((exceptId: string) => {
    commit(windowsRef.current.map(w => w.id === exceptId ? w : { ...w, minimized: true }));
  }, [commit]);

  const cascade = useCallback((desktopW = window.innerWidth, desktopH = window.innerHeight) => {
    const visible = windowsRef.current.filter(w => !w.minimized);
    if (visible.length === 0) return;
    const cascadeW = Math.min(900, desktopW - 120);
    const cascadeH = Math.min(600, desktopH - 120);
    const offset = 28;
    const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex);
    commit(windowsRef.current.map(w => {
      const idx = sorted.findIndex(v => v.id === w.id);
      if (idx < 0) return w;
      return { ...w, maximized: false, x: 40 + idx * offset, y: 40 + idx * offset, width: cascadeW, height: cascadeH };
    }));
  }, [commit]);

  const tileHorizontal = useCallback((desktopW = window.innerWidth, desktopH = window.innerHeight) => {
    const visible = windowsRef.current.filter(w => !w.minimized);
    if (visible.length === 0) return;
    const colW = Math.floor(desktopW / visible.length);
    const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex);
    commit(windowsRef.current.map(w => {
      const idx = sorted.findIndex(v => v.id === w.id);
      if (idx < 0) return w;
      return { ...w, maximized: false, x: idx * colW, y: 0, width: colW, height: desktopH };
    }));
  }, [commit]);

  const tileVertical = useCallback((desktopW = window.innerWidth, desktopH = window.innerHeight) => {
    const visible = windowsRef.current.filter(w => !w.minimized);
    if (visible.length === 0) return;
    const rowH = Math.floor(desktopH / visible.length);
    const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex);
    commit(windowsRef.current.map(w => {
      const idx = sorted.findIndex(v => v.id === w.id);
      if (idx < 0) return w;
      return { ...w, maximized: false, x: 0, y: idx * rowH, width: desktopW, height: rowH };
    }));
  }, [commit]);

  const focusedId = windows.reduce<{ id: string | null; z: number }>(
    (best, w) => (!w.minimized && w.zIndex > best.z) ? { id: w.id, z: w.zIndex } : best,
    { id: null, z: -1 }
  ).id;

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, minimizeAll, restoreAll, toggleAlwaysOnTop, setWindowOpacity, minimizeOthers, cascade, tileHorizontal, tileVertical, focusedId, closedHistory, reopenLastClosed }}
    >
      {children}
    </DesktopWindowManagerContext.Provider>
  );
}
