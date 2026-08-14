import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDesktopWindows } from './DesktopWindowManager';
import { getWindowIconByPath } from '../../utils/windowManager';
import { ALWAYS_ON_TOP_ZINDEX_OFFSET } from './FloatingWindow';

// Must render above every window, including pinned ones (win.zIndex + ALWAYS_ON_TOP_ZINDEX_OFFSET)
// and above the snap preview overlay — both live in the same "above 10000" tier, so this
// picks a value unambiguously higher than either.
const WINDOW_SWITCHER_ZINDEX = ALWAYS_ON_TOP_ZINDEX_OFFSET + 1001;

export default function DesktopWindowSwitcher() {
  const { windows, focusWindow } = useDesktopWindows();
  const [cycling, setCycling] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [altOpen, setAltOpen] = useState(false);

  const mruWindows = useMemo(
    () => [...windows].sort((a, b) => b.zIndex - a.zIndex),
    [windows],
  );

  const advance = useCallback((direction: 1 | -1) => {
    if (mruWindows.length === 0) return;
    setCycling(true);
    setHighlightIndex(prev => (prev + direction + mruWindows.length) % mruWindows.length);
  }, [mruWindows.length]);

  const confirm = useCallback(() => {
    if (mruWindows[highlightIndex]) focusWindow(mruWindows[highlightIndex].id);
    setCycling(false);
    setHighlightIndex(0);
    setAltOpen(false);
  }, [mruWindows, highlightIndex, focusWindow]);

  const dismiss = useCallback(() => {
    setCycling(false);
    setHighlightIndex(0);
    setAltOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+` — existing binding
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        advance(e.shiftKey ? -1 : 1);
        return;
      }
      // Alt+Tab / Alt+Shift+Tab
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        setAltOpen(true);
        advance(e.shiftKey ? -1 : 1);
        return;
      }
      // Tab / Shift+Tab while switcher is open
      if (cycling && e.key === 'Tab' && !e.ctrlKey) {
        e.preventDefault();
        advance(e.shiftKey ? -1 : 1);
        return;
      }
      if (!cycling) return;
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' && cycling && !altOpen) { confirm(); }
      if (e.key === 'Alt' && altOpen) { confirm(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [advance, cycling, altOpen, confirm, dismiss]);

  if (!cycling || mruWindows.length === 0) return null;

  return (
    <div
      data-testid="window-switcher-overlay"
      style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        display: 'flex', gap: 8, padding: 12, background: 'var(--surface-raised)',
        border: '1px solid var(--border-strong)', boxShadow: '0 8px 24px rgba(0 0 0 / 0.5)', zIndex: WINDOW_SWITCHER_ZINDEX,
      }}
    >
      {mruWindows.map((w, i) => {
        const Icon = getWindowIconByPath(w.path);
        return (
          <div
            key={w.id}
            aria-current={i === highlightIndex ? 'true' : undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 8, width: 88,
              background: i === highlightIndex ? 'rgba(var(--rmpg-500-rgb),0.25)' : 'transparent',
              border: i === highlightIndex ? '1px solid var(--brand-400)' : '1px solid transparent',
            }}
          >
            <div className="flex items-center justify-center" style={{ width: 32, height: 32, background: 'rgba(var(--rmpg-500-rgb),0.1)' }}>
              {Icon && <Icon className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />}
            </div>
            <span className="text-[10px] truncate" style={{ color: 'var(--text-primary)', maxWidth: 80 }}>{w.title}</span>
          </div>
        );
      })}
    </div>
  );
}
