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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(windows)); } catch { /* silent */ }
    }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [windows]);

  const openWindow = useCallback((path: string, title: string, size?: { width: number; height: number }) => {
    let opened = true;
    setWindows(prev => {
      const existing = prev.find(w => w.path === path);
      if (existing) {
        nextZIndex += 1;
        return prev.map(w => w.id === existing.id ? { ...w, minimized: false, zIndex: nextZIndex } : w);
      }
      if (prev.length >= MAX_OPEN_WINDOWS) {
        opened = false;
        return prev;
      }
      nextZIndex += 1;
      const offset = prev.length * 24;
      const win: DesktopWindowState = {
        id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        path, title,
        x: 80 + offset, y: 60 + offset,
        width: size?.width ?? 900, height: size?.height ?? 640,
        zIndex: nextZIndex, minimized: false, maximized: false,
      };
      return [...prev, win];
    });
    return opened;
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    nextZIndex += 1;
    const z = nextZIndex;
    setWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: z, minimized: false } : w));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: !w.minimized } : w));
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w));
  }, []);

  const moveResize = useCallback((id: string, patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>>) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  }, []);

  return (
    <DesktopWindowManagerContext.Provider
      value={{ windows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize }}
    >
      {children}
    </DesktopWindowManagerContext.Provider>
  );
}
