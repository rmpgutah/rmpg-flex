import React, { useCallback, useRef } from 'react';
import { X, Minus, Square } from 'lucide-react';
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';

const TITLE_BAR_HEIGHT = 30;

interface FloatingWindowProps {
  win: DesktopWindowState;
}

export default function FloatingWindow({ win }: FloatingWindowProps) {
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize } = useDesktopWindows();
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);

  const onTitleBarPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    focusWindow(win.id);
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: win.x, originY: win.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const nextX = Math.max(0, dragState.current.originX + dx);
      const nextY = Math.max(0, dragState.current.originY + dy);
      moveResize(win.id, { x: nextX, y: nextY });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [win.id, win.x, win.y, focusWindow, moveResize]);

  const onResizeHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    focusWindow(win.id);
    resizeState.current = { startX: e.clientX, startY: e.clientY, originW: win.width, originH: win.height };
    const onMove = (ev: PointerEvent) => {
      if (!resizeState.current) return;
      const dx = ev.clientX - resizeState.current.startX;
      const dy = ev.clientY - resizeState.current.startY;
      moveResize(win.id, {
        width: Math.max(360, resizeState.current.originW + dx),
        height: Math.max(240, resizeState.current.originH + dy),
      });
    };
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [win.id, win.width, win.height, focusWindow, moveResize]);

  const style: React.CSSProperties = win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: 48, zIndex: win.zIndex }
    : {
        position: 'fixed', left: win.x, top: win.y,
        width: win.width, height: win.minimized ? TITLE_BAR_HEIGHT : win.height,
        zIndex: win.zIndex,
      };

  return (
    <div
      style={{ ...style, background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
      onPointerDown={(e) => {
        // Guard against the outer div's pointerdown firing before a title-bar button's
        // click (native pointerdown-before-click ordering). Without this, focusWindow's
        // unconditional `minimized: false` would race the Minimize button's own toggle
        // and prevent the button from ever restoring a minimized window.
        if ((e.target as HTMLElement).closest('button')) return;
        focusWindow(win.id);
      }}
    >
      <div
        onPointerDown={onTitleBarPointerDown}
        className="flex items-center justify-between px-2 select-none cursor-move"
        style={{ height: TITLE_BAR_HEIGHT, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{win.title}</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={`Minimize ${win.title}`} onClick={() => minimizeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <Minus className="w-3 h-3" style={{ color: 'var(--rmpg-400)' }} />
          </button>
          <button type="button" aria-label={`Maximize ${win.title}`} onClick={() => toggleMaximize(win.id)} className="p-1 hover:bg-surface-hover">
            <Square className="w-3 h-3" style={{ color: 'var(--rmpg-400)' }} />
          </button>
          <button type="button" aria-label={`Close ${win.title}`} onClick={() => closeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--rmpg-400))' }} />
          </button>
        </div>
      </div>

      {!win.minimized && (
        <>
          <iframe title={win.title} src={win.path} style={{ width: '100%', height: `calc(100% - ${TITLE_BAR_HEIGHT}px)`, border: 'none' }} />
          {!win.maximized && (
            <div
              onPointerDown={onResizeHandlePointerDown}
              style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize' }}
            />
          )}
        </>
      )}
    </div>
  );
}
