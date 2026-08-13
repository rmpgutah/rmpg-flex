import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Minus, Square, Pin, PinOff, Maximize2, Minimize2 } from 'lucide-react';
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import { getWindowConfigByPath } from '../../utils/windowManager';
import { isSnapEnabled } from '../../utils/snapPreference';
import { TASKBAR_HEIGHT_PX } from './DesktopTaskbar';
import { getTaskbarSize } from '../../utils/taskbarPreferences';
import { playDesktopSound } from '../../utils/desktopSounds';
import SnapLayouts from './SnapLayouts';

const TITLE_BAR_HEIGHT = 30;
const TITLE_SYNC_POLL_MS = 500;
const SNAP_EDGE_THRESHOLD = 24;
const MIN_SNAP_HALF_WIDTH = 360;
const MIN_W = 320;
const MIN_H = 200;
const DRAG_TOP_MAXIMIZE_THRESHOLD = 4;
const AERO_SHAKE_REVERSAL_COUNT = 4;
const AERO_SHAKE_WINDOW_MS = 600;
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
// Any pinned (always-on-top) window renders at win.zIndex + ALWAYS_ON_TOP_ZINDEX_OFFSET
// (see effectiveZIndex below). Window zIndex values are small incrementing integers from
// a focus counter (never anywhere near 1000), so overlays that must always render above
// every window — pinned or not — need a zIndex comfortably clear of the pinned band's
// ceiling. Exported so other overlay components (e.g. DesktopWindowSwitcher) can share
// the same invariant instead of hardcoding a number that could silently drift out of sync.
export const ALWAYS_ON_TOP_ZINDEX_OFFSET = 10000;
const SNAP_PREVIEW_ZINDEX = ALWAYS_ON_TOP_ZINDEX_OFFSET + 1000;

interface FloatingWindowProps {
  win: DesktopWindowState;
}

export default function FloatingWindow({ win }: FloatingWindowProps) {
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, toggleAlwaysOnTop, setWindowOpacity, minimizeOthers } = useDesktopWindows();
  const taskbarHeight = TASKBAR_HEIGHT_PX[getTaskbarSize()];
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number; originX: number; originY: number; dir: ResizeDir } | null>(null);
  // Tracks x-direction reversals for Aero Shake detection
  const shakeRef = useRef<{ timestamps: number[]; lastSign: number }>({ timestamps: [], lastSign: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [snapLayoutsOpen, setSnapLayoutsOpen] = useState(false);
  const maximizeBtnRef = useRef<HTMLButtonElement>(null);
  const snapHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // System menu: position of the right-click context menu on the title bar
  const [sysMenu, setSysMenu] = useState<{ x: number; y: number } | null>(null);
  const [shaking, setShaking] = useState(false);
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

  // F11 full-screen for this window (only when focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        const mgr = (window as unknown as { __rmpgFocusedId?: string }).__rmpgFocusedId;
        if (mgr === win.id || !mgr) {
          e.preventDefault();
          setIsFullscreen(fs => !fs);
        }
      }
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [win.id, isFullscreen]);

  // Win+Z opens snap layouts on the focused window via custom event
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ winId: string }>).detail?.winId === win.id) {
        setSnapLayoutsOpen(true);
      }
    };
    window.addEventListener('flexos-open-snap-layouts', handler);
    return () => window.removeEventListener('flexos-open-snap-layouts', handler);
  }, [win.id]);

  // Dismiss system menu on outside click
  useEffect(() => {
    if (!sysMenu) return;
    const dismiss = () => setSysMenu(null);
    window.addEventListener('pointerdown', dismiss, { capture: true });
    return () => window.removeEventListener('pointerdown', dismiss, { capture: true });
  }, [sysMenu]);

  const onTitleBarDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    toggleMaximize(win.id);
  }, [win.id, toggleMaximize]);

  const onTitleBarPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    // Un-maximize on drag start so the window can be repositioned
    if (win.maximized) { toggleMaximize(win.id); return; }
    focusWindow(win.id);
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: win.x, originY: win.y };
    liveDragPos.current = { x: win.x, y: win.y };
    shakeRef.current = { timestamps: [], lastSign: 0 };
    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;

      // Aero Shake: track x-direction reversals
      const sign = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      if (sign !== 0 && sign !== shakeRef.current.lastSign) {
        const now = Date.now();
        shakeRef.current.lastSign = sign;
        shakeRef.current.timestamps.push(now);
        shakeRef.current.timestamps = shakeRef.current.timestamps.filter(t => now - t < AERO_SHAKE_WINDOW_MS);
        if (shakeRef.current.timestamps.length >= AERO_SHAKE_REVERSAL_COUNT) {
          minimizeOthers(win.id);
          shakeRef.current.timestamps = [];
          setShaking(true);
          setTimeout(() => setShaking(false), 500);
        }
      }

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
            // Intermediate drag state, not yet final — the position isn't "real" until
            // pointerup on the normal drag path below persists it. Don't let this
            // mid-drag un-snap restore clobber the remembered position.
            moveResize(win.id, { x: nextX, y: nextY, width: restore.width, height: restore.height }, { persist: false });
            liveDragPos.current = { x: nextX, y: nextY };
            return;
          }
        }
      }

      moveResize(win.id, { x: nextX, y: nextY });
      liveDragPos.current = { x: nextX, y: nextY };
    };
    const onUp = (ev: PointerEvent) => {
      // Drag to top edge → maximize
      if (ev.clientY <= DRAG_TOP_MAXIMIZE_THRESHOLD && !snapEdgeRef.current) {
        toggleMaximize(win.id);
        dragState.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        return;
      }
      if (snapEdgeRef.current) {
        const desktopHeight = window.innerHeight - taskbarHeight;
        const halfWidth = window.innerWidth / 2;
        if (halfWidth >= MIN_SNAP_HALF_WIDTH) {
          // Corner snap: if released near the top-left or top-right, snap to quarter screen
          const snapToCorner = ev.clientY <= SNAP_EDGE_THRESHOLD * 3;
          if (snapToCorner) {
            preSnapBounds.current = { x: liveDragPos.current.x, y: liveDragPos.current.y, width: win.width, height: win.height };
            snappedSide.current = snapEdgeRef.current;
            moveResize(win.id, {
              x: snapEdgeRef.current === 'left' ? 0 : halfWidth,
              y: 0,
              width: halfWidth,
              height: Math.floor(desktopHeight / 2),
            }, { persist: false });
          } else {
            preSnapBounds.current = { x: liveDragPos.current.x, y: liveDragPos.current.y, width: win.width, height: win.height };
            snappedSide.current = snapEdgeRef.current;
            // The snapped half-screen bounds are a transient drag-interaction outcome, not
            // the user's chosen size — don't let it overwrite the remembered position for
            // this path (see preSnapBounds, which is what un-snapping restores).
            moveResize(win.id, {
              x: snapEdgeRef.current === 'left' ? 0 : halfWidth,
              y: 0,
              width: halfWidth,
              height: desktopHeight,
            }, { persist: false });
          }
          playDesktopSound();
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
  }, [win.id, win.x, win.y, win.width, win.height, focusWindow, moveResize, snapPreview, taskbarHeight, minimizeOthers, toggleMaximize]);

  const onResizeHandlePointerDown = useCallback((e: React.PointerEvent, dir: ResizeDir) => {
    e.stopPropagation();
    focusWindow(win.id);
    resizeState.current = { startX: e.clientX, startY: e.clientY, originW: win.width, originH: win.height, originX: win.x, originY: win.y, dir };
    const onMove = (ev: PointerEvent) => {
      if (!resizeState.current) return;
      const dx = ev.clientX - resizeState.current.startX;
      const dy = ev.clientY - resizeState.current.startY;
      const { originW, originH, originX, originY, dir: d } = resizeState.current;
      const patch: Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>> = {};
      if (d.includes('e')) patch.width = Math.max(MIN_W, originW + dx);
      if (d.includes('s')) patch.height = Math.max(MIN_H, originH + dy);
      if (d.includes('w')) {
        const newW = Math.max(MIN_W, originW - dx);
        patch.width = newW;
        patch.x = originX + (originW - newW);
      }
      if (d.includes('n')) {
        const newH = Math.max(MIN_H, originH - dy);
        patch.height = newH;
        patch.y = originY + (originH - newH);
      }
      moveResize(win.id, patch);
    };
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [win.id, win.width, win.height, win.x, win.y, focusWindow, moveResize]);

  // Pinned windows always render above unpinned ones, regardless of normal
  // focus-based zIndex — a flat offset large enough to clear any realistic
  // focus-order zIndex value keeps focus order working correctly *within*
  // each of the two bands (pinned vs. unpinned) while pinned always wins
  // across them.
  const effectiveZIndex = win.zIndex + (win.alwaysOnTop ? ALWAYS_ON_TOP_ZINDEX_OFFSET : 0);
  const style: React.CSSProperties = isFullscreen
    ? { position: 'fixed', inset: 0, zIndex: effectiveZIndex + 50000, opacity: 1 }
    : win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: taskbarHeight, zIndex: effectiveZIndex, opacity: win.opacity ?? 1 }
    : {
        position: 'fixed', left: win.x, top: win.y,
        width: win.width, height: win.minimized ? TITLE_BAR_HEIGHT : win.height,
        zIndex: effectiveZIndex, opacity: win.opacity ?? 1,
      };

  return (
    <>
    {snapPreview && (
      <div
        data-testid={`snap-preview-${snapPreview}`}
        style={{
          position: 'fixed', top: 0, left: snapPreview === 'left' ? 0 : '50%',
          width: '50%', height: `calc(100vh - ${taskbarHeight}px)`,
          background: 'rgba(var(--rmpg-500-rgb),0.15)', border: '2px solid var(--brand-400)',
          zIndex: SNAP_PREVIEW_ZINDEX, pointerEvents: 'none',
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
      {/* Title bar */}
      <div
        onPointerDown={onTitleBarPointerDown}
        onDoubleClick={onTitleBarDoubleClick}
        onContextMenu={e => { e.preventDefault(); setSysMenu({ x: e.clientX, y: e.clientY }); }}
        className="flex items-center justify-between px-2 select-none cursor-move"
        style={{ height: isFullscreen ? 0 : TITLE_BAR_HEIGHT, overflow: 'hidden', background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)', boxShadow: shaking ? '0 0 0 2px var(--accent-silver-400, #8fa0b3), 0 0 14px 4px rgba(143,160,179,0.45)' : undefined, transition: 'box-shadow 0.3s ease' }}
      >
        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{win.title}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={win.alwaysOnTop ? `Unpin ${win.title}` : `Pin ${win.title} on top`}
            onClick={() => toggleAlwaysOnTop(win.id)}
            className="p-1 hover:bg-surface-hover"
          >
            {win.alwaysOnTop ? <Pin className="w-3 h-3" style={{ color: 'var(--brand-400)' }} /> : <PinOff className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />}
          </button>
          <button type="button" aria-label={`Minimize ${win.title}`} onClick={() => minimizeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <Minus className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
          </button>
          {/* Maximize button — hover for 400ms to open Snap Layouts */}
          <div style={{ position: 'relative' }}>
            <button
              ref={maximizeBtnRef}
              type="button"
              aria-label={`Maximize ${win.title}`}
              onClick={() => { setSnapLayoutsOpen(false); toggleMaximize(win.id); }}
              onMouseEnter={() => {
                snapHoverTimer.current = setTimeout(() => setSnapLayoutsOpen(true), 400);
              }}
              onMouseLeave={() => {
                if (snapHoverTimer.current) clearTimeout(snapHoverTimer.current);
              }}
              className="p-1 hover:bg-surface-hover"
            >
              <Square className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
            </button>
            {snapLayoutsOpen && (
              <SnapLayouts
                windowId={win.id}
                taskbarH={taskbarHeight}
                onSnap={zone => moveResize(win.id, { x: zone.x, y: zone.y, width: zone.width, height: zone.height }, { persist: false })}
                onDismiss={() => setSnapLayoutsOpen(false)}
              />
            )}
          </div>
          {/* F11 full-screen toggle */}
          <button
            type="button"
            aria-label={isFullscreen ? `Exit full-screen for ${win.title}` : `Full-screen ${win.title}`}
            onClick={() => setIsFullscreen(fs => !fs)}
            className="p-1 hover:bg-surface-hover"
          >
            {isFullscreen
              ? <Minimize2 className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
              : <Maximize2 className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />}
          </button>
          <button type="button" aria-label={`Close ${win.title}`} onClick={() => closeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--text-secondary))' }} />
          </button>
        </div>
      </div>

      {/* System menu (right-click on title bar) */}
      {sysMenu && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: sysMenu.x, top: sysMenu.y,
            background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: effectiveZIndex + 100,
            minWidth: 180, padding: '4px 0',
          }}
        >
          {[
            { label: win.minimized || win.maximized ? 'Restore' : 'Restore', disabled: !win.minimized && !win.maximized, onClick: () => { if (win.maximized) toggleMaximize(win.id); else if (win.minimized) focusWindow(win.id); } },
            { label: 'Minimize', disabled: win.minimized, onClick: () => minimizeWindow(win.id) },
            { label: win.maximized ? 'Restore' : 'Maximize', disabled: false, onClick: () => toggleMaximize(win.id) },
            null, // separator
            { label: win.alwaysOnTop ? '✓ Always on Top' : '  Always on Top', disabled: false, onClick: () => toggleAlwaysOnTop(win.id) },
            null, // separator
            { label: 'Close', disabled: false, onClick: () => closeWindow(win.id), danger: true },
          ].map((item, i) =>
            item === null ? (
              <div key={i} style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
            ) : (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onClick={() => { setSysMenu(null); item.onClick(); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 16px', fontSize: 11, background: 'none', border: 'none',
                  cursor: item.disabled ? 'default' : 'pointer',
                  color: item.disabled ? 'var(--text-muted)' : item.danger ? 'var(--sev-critical, #ef4444)' : 'var(--text-primary)',
                }}
                onMouseEnter={e => { if (!item.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-500-rgb),0.2)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                {item.label}
              </button>
            )
          )}
          {/* Opacity slider */}
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
          <div style={{ padding: '6px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Opacity: {Math.round((win.opacity ?? 1) * 100)}%</div>
            <input
              type="range" min={20} max={100} value={Math.round((win.opacity ?? 1) * 100)}
              onChange={e => setWindowOpacity(win.id, parseInt(e.target.value, 10) / 100)}
              style={{ width: '100%', accentColor: 'var(--brand-400)' }}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {!win.minimized && (
        <>
          <iframe
            ref={iframeRef}
            title={win.title}
            src={win.path.includes('?') ? `${win.path}&standalone=1` : `${win.path}?standalone=1`}
            allow="microphone; camera; fullscreen"
            style={{ width: '100%', height: isFullscreen ? '100%' : `calc(100% - ${TITLE_BAR_HEIGHT}px)`, border: 'none' }}
          />
          {!win.maximized && (
            <>
              {/* N edge */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'n')} style={{ position: 'absolute', top: 0, left: 8, right: 8, height: 5, cursor: 'n-resize', zIndex: 1 }} />
              {/* S edge */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 's')} style={{ position: 'absolute', bottom: 0, left: 8, right: 8, height: 5, cursor: 's-resize', zIndex: 1 }} />
              {/* W edge */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'w')} style={{ position: 'absolute', top: 8, bottom: 8, left: 0, width: 5, cursor: 'w-resize', zIndex: 1 }} />
              {/* E edge */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'e')} style={{ position: 'absolute', top: 8, bottom: 8, right: 0, width: 5, cursor: 'e-resize', zIndex: 1 }} />
              {/* NW corner */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'nw')} style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, cursor: 'nw-resize', zIndex: 2 }} />
              {/* NE corner */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'ne')} style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, cursor: 'ne-resize', zIndex: 2 }} />
              {/* SW corner */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'sw')} style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, cursor: 'sw-resize', zIndex: 2 }} />
              {/* SE corner */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'se')} style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, cursor: 'se-resize', zIndex: 2 }} />
            </>
          )}
        </>
      )}
    </div>
    </>
  );
}
