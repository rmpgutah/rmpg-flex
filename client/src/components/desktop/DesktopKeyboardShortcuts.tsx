// ============================================================
// RMPG Flex — Desktop Keyboard Shortcuts
// Windows-style global hotkeys for the FlexOS desktop
// ============================================================

import { useEffect } from 'react';
import { useDesktopWindows } from './DesktopWindowManager';
import { TASKBAR_HEIGHT_PX } from './DesktopTaskbar';
import { getTaskbarSize } from '../../utils/taskbarPreferences';

interface DesktopKeyboardShortcutsProps {
  onLock: () => void;
  onToggleLauncher: () => void;
  onPrevVirtualDesktop: () => void;
  onNextVirtualDesktop: () => void;
  onOpenShortcutRef?: () => void;
}

export default function DesktopKeyboardShortcuts({
  onLock,
  onToggleLauncher,
  onPrevVirtualDesktop,
  onNextVirtualDesktop,
  onOpenShortcutRef,
}: DesktopKeyboardShortcutsProps) {
  const { minimizeAll, restoreAll, focusedId, windows, toggleMaximize, minimizeWindow, closeWindow, moveResize, cascade, tileHorizontal, tileVertical } = useDesktopWindows();
  const taskbarH = TASKBAR_HEIGHT_PX[getTaskbarSize()];

  useEffect(() => {
    // Track ids that were minimized by Win+D so Win+D again restores exactly those
    let showDesktopIds: string[] = [];

    const handle = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.key === 'Meta';
      const ctrl = e.ctrlKey;
      const alt = e.altKey;
      const shift = e.shiftKey;
      const key = e.key;

      // Win+D — Show Desktop (minimize all) / restore
      if (meta && key === 'd') {
        e.preventDefault();
        if (showDesktopIds.length > 0) {
          restoreAll(showDesktopIds);
          showDesktopIds = [];
        } else {
          showDesktopIds = minimizeAll();
        }
        return;
      }

      // Win+L — Lock screen
      if (meta && key === 'l') {
        e.preventDefault();
        onLock();
        return;
      }

      // Win+S — Open launcher/search
      if (meta && key === 's') {
        e.preventDefault();
        onToggleLauncher();
        return;
      }

      // Win+Ctrl+Left — Previous virtual desktop
      if (meta && ctrl && key === 'ArrowLeft') {
        e.preventDefault();
        onPrevVirtualDesktop();
        return;
      }

      // Win+Ctrl+Right — Next virtual desktop
      if (meta && ctrl && key === 'ArrowRight') {
        e.preventDefault();
        onNextVirtualDesktop();
        return;
      }

      // Remaining shortcuts require a focused window
      if (!focusedId) return;
      const focused = windows.find(w => w.id === focusedId);
      if (!focused || focused.minimized) return;

      // Win+Up — Maximize focused window
      if (meta && key === 'ArrowUp' && !ctrl && !alt && !shift) {
        e.preventDefault();
        if (!focused.maximized) toggleMaximize(focusedId);
        return;
      }

      // Win+Down — Minimize focused window (if maximized, restore first)
      if (meta && key === 'ArrowDown' && !ctrl && !alt && !shift) {
        e.preventDefault();
        if (focused.maximized) {
          toggleMaximize(focusedId);
        } else {
          minimizeWindow(focusedId);
        }
        return;
      }

      // Win+Left — Snap focused window to left half
      if (meta && key === 'ArrowLeft' && !ctrl && !alt && !shift) {
        e.preventDefault();
        const dh = window.innerHeight - taskbarH;
        moveResize(focusedId, { x: 0, y: 0, width: Math.floor(window.innerWidth / 2), height: dh }, { persist: false });
        return;
      }

      // Win+Right — Snap focused window to right half
      if (meta && key === 'ArrowRight' && !ctrl && !alt && !shift) {
        e.preventDefault();
        const halfW = Math.floor(window.innerWidth / 2);
        const dh = window.innerHeight - taskbarH;
        moveResize(focusedId, { x: halfW, y: 0, width: halfW, height: dh }, { persist: false });
        return;
      }

      // Ctrl+W — Close focused window
      if (ctrl && key === 'w' && !meta && !alt) {
        e.preventDefault();
        closeWindow(focusedId);
        return;
      }

      // Alt+F4 — Close focused window
      if (alt && key === 'F4') {
        e.preventDefault();
        closeWindow(focusedId);
        return;
      }

      // Ctrl+Alt+C — Cascade windows
      if (ctrl && alt && key === 'c' && !meta) {
        e.preventDefault();
        cascade(window.innerWidth, window.innerHeight - taskbarH);
        return;
      }

      // Ctrl+Alt+H — Tile horizontally
      if (ctrl && alt && key === 'h' && !meta) {
        e.preventDefault();
        tileHorizontal(window.innerWidth, window.innerHeight - taskbarH);
        return;
      }

      // Ctrl+Alt+V — Tile vertically
      if (ctrl && alt && key === 'v' && !meta) {
        e.preventDefault();
        tileVertical(window.innerWidth, window.innerHeight - taskbarH);
        return;
      }

      // Win+/ — Open keyboard shortcut reference
      if (meta && key === '/') {
        e.preventDefault();
        onOpenShortcutRef?.();
        return;
      }

      // Win+Z — Open Snap Layouts for focused window
      if (meta && key === 'z' && !ctrl && !alt && !shift) {
        e.preventDefault();
        if (focusedId) {
          window.dispatchEvent(new CustomEvent('flexos-open-snap-layouts', { detail: { winId: focusedId } }));
        }
        return;
      }
    };

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [focusedId, windows, minimizeAll, restoreAll, toggleMaximize, minimizeWindow, closeWindow, moveResize, cascade, tileHorizontal, tileVertical, onLock, onToggleLauncher, onPrevVirtualDesktop, onNextVirtualDesktop, onOpenShortcutRef, taskbarH]);

  return null;
}
