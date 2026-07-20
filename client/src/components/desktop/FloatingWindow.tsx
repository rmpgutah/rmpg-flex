import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Minus, Square, Pin, PinOff } from 'lucide-react';
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import { getWindowConfigByPath } from '../../utils/windowManager';
import { isSnapEnabled } from '../../utils/snapPreference';

const TITLE_BAR_HEIGHT = 30;
const TITLE_SYNC_POLL_MS = 500;
const SNAP_EDGE_THRESHOLD = 24;
const TASKBAR_HEIGHT = 48;
const MIN_SNAP_HALF_WIDTH = 360;

interface FloatingWindowProps {
  win: DesktopWindowState;
}

export default function FloatingWindow({ win }: FloatingWindowProps) {
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, toggleAlwaysOnTop } = useDesktopWindows();
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [snapPreview, setSnapPreview] = useState<'left' | 'right' | null>(null);
  // Tracks which edge the cursor is near during the drag — used in onUp to
  // determine if a snap should be applied. We need a ref here because the state
  // update from setSnapPreview is not visible in the onUp closure.
  const snapEdgeRef = useRef<'left' | 'right' | null>(null);
  // Captured the instant a snap is applied — lets a subsequent drag "pull the
  // window away" from the edge to restore its pre-snap bounds, matching the
  // real OS un-snap feel. Not persisted: a transient drag-interaction detail.
  const preSnapBounds = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const snappedSide = useRef<'left' | 'right' | null>(null);
  // Tracks the window's live position during a title-bar drag (title-bar
  // drags never change width/height, only x/y) — needed because win.x/win.y
  // in this closure are stale (captured at pointerdown), but preSnapBounds
  // must reflect wherever the window actually is at the moment of release.
  const liveDragPos = useRef({ x: win.x, y: win.y });
  // These track the iframe's OWN internal navigation, independent of win.path (which
  // stays fixed at the URL the window was opened with — see the effect below for why
  // the two must never be conflated). Seeded once from the initial render, then only
  // ever mutated by this effect.
  const lastPathRef = useRef(win.path);
  const lastTitleRef = useRef(win.title);

  // Same-origin iframes let the parent read contentWindow.location directly. The app's
  // own in-page nav bar can navigate the iframe to an entirely different route via
  // client-side routing, with no signal reaching this component otherwise — so we poll
  // for it and resync just the display title. We deliberately never write the observed
  // pathname back into win.path: that value also drives the iframe's `src` below, and
  // setting `src` to a new value is a real navigation command in the browser even when
  // it already matches the current location — that would fight the very navigation
  // we're reacting to.
  useEffect(() => {
    if (win.minimized) return;
    const interval = setInterval(() => {
      let pathname: string | null = null;
      try {
        pathname = iframeRef.current?.contentWindow?.location?.pathname ?? null;
      } catch {
        pathname = null;
      }
      if (!pathname || pathname === lastPathRef.current) return;
      lastPathRef.current = pathname;
      const config = getWindowConfigByPath(pathname);
      if (config && config.title !== lastTitleRef.current) {
        lastTitleRef.current = config.title;
        updateWindowTitle(win.id, config.title);
      }
    }, TITLE_SYNC_POLL_MS);
    return () => clearInterval(interval);
  }, [win.id, win.minimized, updateWindowTitle]);

  const onTitleBarPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    focusWindow(win.id);
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: win.x, originY: win.y };
    liveDragPos.current = { x: win.x, y: win.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      let nextX = Math.max(0, dragState.current.originX + dx);
      const nextY = Math.max(0, dragState.current.originY + dy);

      if (isSnapEnabled()) {
        if (ev.clientX <= SNAP_EDGE_THRESHOLD) {
          snapEdgeRef.current = 'left';
          setSnapPreview('left');
        } else if (ev.clientX >= window.innerWidth - SNAP_EDGE_THRESHOLD) {
          snapEdgeRef.current = 'right';
          setSnapPreview('right');
        } else {
          snapEdgeRef.current = null;
          setSnapPreview(null);
        }

        // Un-snap: dragging a currently-snapped window away from the edge
        // restores its pre-snap size before continuing the drag normally.
        if (snappedSide.current && Math.abs(dx) > SNAP_EDGE_THRESHOLD) {
          const restore = preSnapBounds.current;
          snappedSide.current = null;
          preSnapBounds.current = null;
          if (restore) {
            nextX = restore.x;
            moveResize(win.id, { x: nextX, y: nextY, width: restore.width, height: restore.height });
            liveDragPos.current = { x: nextX, y: nextY };
            return;
          }
        }
      }

      moveResize(win.id, { x: nextX, y: nextY });
      liveDragPos.current = { x: nextX, y: nextY };
    };
    const onUp = () => {
      if (snapEdgeRef.current) {
        const desktopHeight = window.innerHeight - TASKBAR_HEIGHT;
        const halfWidth = window.innerWidth / 2;
        if (halfWidth >= MIN_SNAP_HALF_WIDTH) {
          preSnapBounds.current = { x: liveDragPos.current.x, y: liveDragPos.current.y, width: win.width, height: win.height };
          snappedSide.current = snapEdgeRef.current;
          moveResize(win.id, {
            x: snapEdgeRef.current === 'left' ? 0 : halfWidth,
            y: 0,
            width: halfWidth,
            height: desktopHeight,
          });
        }
        setSnapPreview(null);
        snapEdgeRef.current = null;
      }
      dragState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [win.id, win.x, win.y, win.width, win.height, focusWindow, moveResize, snapPreview]);

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

  // Pinned windows always render above unpinned ones, regardless of normal
  // focus-based zIndex — a flat offset large enough to clear any realistic
  // focus-order zIndex value keeps focus order working correctly *within*
  // each of the two bands (pinned vs. unpinned) while pinned always wins
  // across them.
  const effectiveZIndex = win.zIndex + (win.alwaysOnTop ? 10000 : 0);
  const style: React.CSSProperties = win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: 48, zIndex: effectiveZIndex }
    : {
        position: 'fixed', left: win.x, top: win.y,
        width: win.width, height: win.minimized ? TITLE_BAR_HEIGHT : win.height,
        zIndex: effectiveZIndex,
      };

  return (
    <>
    {snapPreview && (
      <div
        data-testid={`snap-preview-${snapPreview}`}
        style={{
          position: 'fixed', top: 0, left: snapPreview === 'left' ? 0 : '50%',
          width: '50%', height: `calc(100vh - ${TASKBAR_HEIGHT}px)`,
          background: 'rgba(var(--rmpg-500-rgb),0.15)', border: '2px solid var(--brand-400)',
          zIndex: 4999, pointerEvents: 'none',
        }}
      />
    )}
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
          <button
            type="button"
            aria-label={win.alwaysOnTop ? `Unpin ${win.title}` : `Pin ${win.title} on top`}
            onClick={() => toggleAlwaysOnTop(win.id)}
            className="p-1 hover:bg-surface-hover"
          >
            {win.alwaysOnTop ? <Pin className="w-3 h-3" style={{ color: 'var(--brand-400)' }} /> : <PinOff className="w-3 h-3" style={{ color: 'var(--rmpg-400)' }} />}
          </button>
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
          <iframe
            ref={iframeRef}
            title={win.title}
            src={win.path}
            allow="microphone; camera; fullscreen"
            style={{ width: '100%', height: `calc(100% - ${TITLE_BAR_HEIGHT}px)`, border: 'none' }}
          />
          {!win.maximized && (
            <div
              onPointerDown={onResizeHandlePointerDown}
              style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize' }}
            />
          )}
        </>
      )}
    </div>
    </>
  );
}
