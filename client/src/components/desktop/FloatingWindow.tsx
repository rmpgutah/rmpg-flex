import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Minus, Square, Pin, PinOff } from 'lucide-react';
import { useDesktopWindows, type DesktopWindowState } from './DesktopWindowManager';
import { getWindowConfigByPath } from '../../utils/windowManager';
import { isSnapEnabled } from '../../utils/snapPreference';
import { TASKBAR_HEIGHT_PX } from './DesktopTaskbar';
import { getTaskbarSize } from '../../utils/taskbarPreferences';
import { playDesktopSound } from '../../utils/desktopSounds';
import SnapLayouts, { type SnapZone } from './SnapLayouts';

const TITLE_BAR_HEIGHT = 30;
const TAB_STRIP_HEIGHT = 24;
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

interface SnapAssistProps {
  occupiedZone: SnapZone;
  otherWindows: { id: string; title: string; path: string }[];
  taskbarH: number;
  onPick: (windowId: string, zone: SnapZone) => void;
  onDismiss: () => void;
}

function SnapAssist({ occupiedZone, otherWindows, taskbarH, onPick, onDismiss }: SnapAssistProps) {
  const dW = window.innerWidth;
  const dH = window.innerHeight - taskbarH;
  const remainX = occupiedZone.x + occupiedZone.width < dW ? occupiedZone.x + occupiedZone.width : 0;
  const remainW = dW - occupiedZone.width;

  return (
    <div
      data-testid="snap-assist-panel"
      style={{
        position: 'fixed',
        left: remainX,
        top: 0,
        width: remainW,
        height: dH,
        background: 'rgba(var(--rmpg-900-rgb, 10 22 38), 0.7)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        zIndex: 10002,
        backdropFilter: 'blur(2px)',
      }}
      onClick={onDismiss}
    >
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.06em' }}>SNAP ASSIST</div>
      {otherWindows.map(w => (
        <button
          key={w.id}
          type="button"
          aria-label={`Snap ${w.title} into remaining zone`}
          onClick={e => {
            e.stopPropagation();
            onPick(w.id, { id: 'assist', label: 'Remaining', x: remainX, y: 0, width: remainW, height: dH });
          }}
          style={{
            width: 160,
            padding: '8px 12px',
            background: 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.8)',
            border: '1px solid var(--border-strong)',
            borderRadius: 2,
            cursor: 'pointer',
            fontSize: 10,
            color: 'var(--text-primary)',
            textAlign: 'left',
            transition: 'background 120ms',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.6)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.8)'; }}
        >
          {w.title}
        </button>
      ))}
    </div>
  );
}

interface SystemMenuProps {
  win: DesktopWindowState;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onAlwaysOnTop: () => void;
  onOpacity: (v: number) => void;
  onDismiss: () => void;
}

function SystemMenu({ win, onClose, onMinimize, onMaximize, onAlwaysOnTop, onOpacity, onDismiss }: SystemMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onDismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', handler);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', handler); window.removeEventListener('keydown', onKey); };
  }, [onDismiss]);

  const item = (label: string, onClick: () => void, disabled = false) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      aria-label={label}
      disabled={disabled}
      onClick={() => { onClick(); onDismiss(); }}
      style={{
        display: 'block', width: '100%', padding: '5px 16px', textAlign: 'left',
        fontSize: 10, color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.25)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
    >
      {label}
    </button>
  );

  const divider = () => <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />;

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="system-menu"
      style={{
        position: 'fixed', zIndex: win.zIndex + 1,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        minWidth: 180, padding: '4px 0',
      }}
    >
      {item('Restore', onMaximize, !win.maximized && !win.minimized)}
      {item('Minimize', onMinimize, win.minimized)}
      {item(`${win.maximized ? 'Restore Down' : 'Maximize'}`, onMaximize)}
      {divider()}
      {item(`Always on Top${win.alwaysOnTop ? ' ✓' : ''}`, onAlwaysOnTop)}
      {divider()}
      <div style={{ padding: '6px 16px' }}>
        <div style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.06em', marginBottom: 4 }}>OPACITY</div>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={win.opacity ?? 1}
          aria-label="Opacity"
          onChange={e => onOpacity(Number(e.target.value))}
          style={{ width: '100%', height: 4, accentColor: 'var(--brand-400)' }}
        />
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>
          {Math.round((win.opacity ?? 1) * 100)}%
        </div>
      </div>
      {divider()}
      {item('Close  Alt+F4', onClose)}
    </div>
  );
}

interface FloatingWindowProps {
  win: DesktopWindowState;
}

export default function FloatingWindow({ win }: FloatingWindowProps) {
  const { closeWindow, focusWindow, minimizeWindow, toggleMaximize, moveResize, updateWindowTitle, toggleAlwaysOnTop, setWindowOpacity, minimizeOthers, setFullscreen, mergeWindowTab, tearOffTab, setActiveTab, windows } = useDesktopWindows();
  const taskbarHeight = TASKBAR_HEIGHT_PX[getTaskbarSize()];
  const windowsRef = useRef(windows);
  useEffect(() => { windowsRef.current = windows; }, [windows]);
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number; originX: number; originY: number; dir: ResizeDir } | null>(null);
  // Tracks x-direction reversals for Aero Shake detection
  const shakeRef = useRef<{ timestamps: number[]; lastSign: number }>({ timestamps: [], lastSign: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [snapPreview, setSnapPreview] = useState<'left' | 'right' | null>(null);
  // Tracks which edge the cursor is near during the drag — used in onUp to
  // determine if a snap should be applied. We need a ref here because the state
  // update from setSnapPreview is not visible in the onUp closure.
  const snapEdgeRef = useRef<'left' | 'right' | null>(null);
  const [snapLayoutsOpen, setSnapLayoutsOpen] = useState(false);
  const [snapAssist, setSnapAssist] = useState<{ zone: SnapZone } | null>(null);
  const snapHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [systemMenu, setSystemMenu] = useState<{ x: number; y: number } | null>(null);
  const [shakeRingActive, setShakeRingActive] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  // Ref copy of mergeTargetId for use inside raw DOM event closures (avoids stale closure)
  const mergeTargetIdRef = useRef<string | null>(null);

  const onMaxBtnMouseEnter = useCallback(() => {
    snapHoverTimer.current = setTimeout(() => setSnapLayoutsOpen(true), 400);
  }, []);

  const onMaxBtnMouseLeave = useCallback(() => {
    if (snapHoverTimer.current) {
      clearTimeout(snapHoverTimer.current);
      snapHoverTimer.current = null;
    }
    // Do NOT close here — SnapLayouts' own outside-click listener handles dismiss
    // once the overlay is visible. Closing unconditionally here prevents the user
    // from moving the cursor from the maximize button into the SnapLayouts grid.
  }, []);

  const handleSnapZone = useCallback((zone: SnapZone) => {
    moveResize(win.id, { x: zone.x, y: zone.y, width: zone.width, height: zone.height }, { persist: false });
    setSnapLayoutsOpen(false);
    playDesktopSound();
    setSnapAssist({ zone });
  }, [win.id, moveResize]);
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const nonMinimized = windows.filter(w => !w.minimized);
      if (nonMinimized.length === 0) return;
      const maxZ = Math.max(...nonMinimized.map(w => w.zIndex));
      if (win.zIndex !== maxZ) return;
      if (e.key === 'F11') {
        e.preventDefault();
        setFullscreen(win.id, !win.fullscreen);
      }
      if (e.key === 'Escape' && win.fullscreen) {
        e.preventDefault();
        setFullscreen(win.id, false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [win.id, win.fullscreen, win.zIndex, windows, setFullscreen]);

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
          setShakeRingActive(true);
          setTimeout(() => setShakeRingActive(false), 350);
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

      // Drag-to-merge detection: check if this window's title bar Y is within 40px of another
      const nearWindow = windowsRef.current.find(w =>
        w.id !== win.id && !w.minimized &&
        Math.abs(nextY - w.y) < 40 &&
        nextX + win.width > w.x &&
        nextX < w.x + w.width
      );
      mergeTargetIdRef.current = nearWindow?.id ?? null;
      setMergeTargetId(nearWindow?.id ?? null);
    };
    const onUp = (ev: PointerEvent) => {
      // Merge: if dragged near another window, merge into a tab group
      if (mergeTargetIdRef.current) {
        mergeWindowTab(win.id, mergeTargetIdRef.current);
        mergeTargetIdRef.current = null;
        setMergeTargetId(null);
        dragState.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        return;
      }
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
          const snappedX = snapEdgeRef.current === 'left' ? 0 : halfWidth;
          if (snapToCorner) {
            const snappedH = Math.floor(desktopHeight / 2);
            preSnapBounds.current = { x: liveDragPos.current.x, y: liveDragPos.current.y, width: win.width, height: win.height };
            snappedSide.current = snapEdgeRef.current;
            moveResize(win.id, {
              x: snappedX,
              y: 0,
              width: halfWidth,
              height: snappedH,
            }, { persist: false });
            setSnapAssist({ zone: { id: 'edge-snap', label: 'Edge snap', x: snappedX, y: 0, width: halfWidth, height: snappedH } });
          } else {
            preSnapBounds.current = { x: liveDragPos.current.x, y: liveDragPos.current.y, width: win.width, height: win.height };
            snappedSide.current = snapEdgeRef.current;
            // The snapped half-screen bounds are a transient drag-interaction outcome, not
            // the user's chosen size — don't let it overwrite the remembered position for
            // this path (see preSnapBounds, which is what un-snapping restores).
            moveResize(win.id, {
              x: snappedX,
              y: 0,
              width: halfWidth,
              height: desktopHeight,
            }, { persist: false });
            setSnapAssist({ zone: { id: 'edge-snap', label: 'Edge snap', x: snappedX, y: 0, width: halfWidth, height: desktopHeight } });
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
  }, [win.id, win.x, win.y, win.width, win.height, focusWindow, moveResize, snapPreview, taskbarHeight, minimizeOthers, toggleMaximize, mergeWindowTab]);

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

  // Tab group: compute grouped windows and leader status.
  // These are pure derivations from props/context — no hooks, safe after all hook calls.
  const groupedWindows = win.groupId
    ? windows.filter(w => w.groupId === win.groupId).sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
    : [];
  const isGroupLeader = groupedWindows.length > 0 && groupedWindows[0].id === win.id;
  const isGroupMember = win.groupId !== null && !isGroupLeader;

  // Non-leader group members render nothing — the leader renders everything for the group.
  // This early return is placed after ALL hooks so hook call order is unconditional.
  if (isGroupMember) return null;

  // Pinned windows always render above unpinned ones, regardless of normal
  // focus-based zIndex — a flat offset large enough to clear any realistic
  // focus-order zIndex value keeps focus order working correctly *within*
  // each of the two bands (pinned vs. unpinned) while pinned always wins
  // across them.
  const effectiveZIndex = win.zIndex + (win.alwaysOnTop ? ALWAYS_ON_TOP_ZINDEX_OFFSET : 0);
  const style: React.CSSProperties = win.fullscreen
    ? { position: 'fixed', inset: 0, zIndex: ALWAYS_ON_TOP_ZINDEX_OFFSET + 500, opacity: 1 }
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
      {win.fullscreen && (
        <div
          data-testid="fullscreen-hint"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 24,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 9, color: 'var(--text-muted)',
            opacity: 0, transition: 'opacity 300ms',
            zIndex: 1,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = '0'; }}
        >
          Press F11 or Esc to exit full screen
        </div>
      )}
      {!win.fullscreen && (
      <div
        data-testid="title-bar"
        onPointerDown={onTitleBarPointerDown}
        onDoubleClick={onTitleBarDoubleClick}
        onContextMenu={(e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          setSystemMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`flex items-center justify-between px-2 select-none cursor-move${shakeRingActive ? ' shake-ring-active' : ''}`}
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
            {win.alwaysOnTop ? <Pin className="w-3 h-3" style={{ color: 'var(--brand-400)' }} /> : <PinOff className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />}
          </button>
          <button type="button" aria-label={`Minimize ${win.title}`} onClick={() => minimizeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <Minus className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
          </button>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label={`Maximize ${win.title}`}
              onClick={() => toggleMaximize(win.id)}
              onMouseEnter={onMaxBtnMouseEnter}
              onMouseLeave={onMaxBtnMouseLeave}
              className="p-1 hover:bg-surface-hover"
            >
              <Square className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
            </button>
            {snapLayoutsOpen && (
              <SnapLayouts
                windowId={win.id}
                taskbarH={taskbarHeight}
                onSnap={handleSnapZone}
                onDismiss={() => setSnapLayoutsOpen(false)}
              />
            )}
          </div>
          <button type="button" aria-label={`Close ${win.title}`} onClick={() => closeWindow(win.id)} className="p-1 hover:bg-surface-hover">
            <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--text-secondary))' }} />
          </button>
        </div>
      </div>
      )}

      {!win.minimized && (
        <>
          {groupedWindows.length > 1 && (
            <div
              data-testid="tab-strip"
              style={{
                display: 'flex', alignItems: 'center', height: TAB_STRIP_HEIGHT,
                background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)',
                overflowX: 'auto',
              }}
            >
              {groupedWindows.map(gw => (
                <div
                  key={gw.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px',
                    height: '100%', fontSize: 9, cursor: 'pointer', userSelect: 'none',
                    background: gw.activeInGroup ? 'rgba(var(--rmpg-500-rgb,62 116 168),0.2)' : 'transparent',
                    borderRight: '1px solid var(--border-subtle)',
                    color: gw.activeInGroup ? 'var(--text-primary)' : 'var(--text-secondary)',
                    flexShrink: 0,
                  }}
                  onClick={() => setActiveTab(win.groupId!, gw.id)}
                >
                  <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {gw.title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Tear off ${gw.title}`}
                    onClick={e => { e.stopPropagation(); tearOffTab(gw.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <iframe
            ref={iframeRef}
            title={win.title}
            src={(() => {
              const activePath = groupedWindows.length > 1
                ? (groupedWindows.find(gw => gw.activeInGroup)?.path ?? win.path)
                : win.path;
              return activePath.includes('?') ? `${activePath}&standalone=1` : `${activePath}?standalone=1`;
            })()}
            allow="microphone; camera; fullscreen"
            style={{
              width: '100%',
              height: win.fullscreen ? '100%' : groupedWindows.length > 1
                ? `calc(100% - ${TITLE_BAR_HEIGHT + TAB_STRIP_HEIGHT}px)`
                : `calc(100% - ${TITLE_BAR_HEIGHT}px)`,
              border: 'none',
            }}
          />
          {!win.maximized && (
            <>
              {/* N edge */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'n')} style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 8, cursor: 'n-resize', zIndex: 1 }} />
              {/* S edge */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 's')} style={{ position: 'absolute', bottom: 0, left: 14, right: 14, height: 8, cursor: 's-resize', zIndex: 1 }} />
              {/* W edge */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'w')} style={{ position: 'absolute', top: 14, bottom: 14, left: 0, width: 8, cursor: 'w-resize', zIndex: 1 }} />
              {/* E edge */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'e')} style={{ position: 'absolute', top: 14, bottom: 14, right: 0, width: 8, cursor: 'e-resize', zIndex: 1 }} />
              {/* NW corner */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'nw')} style={{ position: 'absolute', top: 0, left: 0, width: 14, height: 14, cursor: 'nw-resize', zIndex: 2 }} />
              {/* NE corner */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'ne')} style={{ position: 'absolute', top: 0, right: 0, width: 14, height: 14, cursor: 'ne-resize', zIndex: 2 }} />
              {/* SW corner */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'sw')} style={{ position: 'absolute', bottom: 0, left: 0, width: 14, height: 14, cursor: 'sw-resize', zIndex: 2 }} />
              {/* SE corner */}
              <div onPointerDown={e => onResizeHandlePointerDown(e, 'se')} style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, cursor: 'se-resize', zIndex: 2 }} />
            </>
          )}
        </>
      )}
    </div>
    {snapAssist && (
      <SnapAssist
        occupiedZone={snapAssist.zone}
        otherWindows={windows.filter(w => w.id !== win.id && !w.minimized).map(w => ({ id: w.id, title: w.title, path: w.path }))}
        taskbarH={taskbarHeight}
        onPick={(targetId, remainZone) => {
          moveResize(targetId, { x: remainZone.x, y: remainZone.y, width: remainZone.width, height: remainZone.height }, { persist: false });
          focusWindow(targetId);
          setSnapAssist(null);
          playDesktopSound();
        }}
        onDismiss={() => setSnapAssist(null)}
      />
    )}
    {systemMenu && (
      <div style={{ position: 'fixed', left: systemMenu.x, top: systemMenu.y, zIndex: effectiveZIndex + 1 }}>
        <SystemMenu
          win={win}
          onClose={() => closeWindow(win.id)}
          onMinimize={() => minimizeWindow(win.id)}
          onMaximize={() => toggleMaximize(win.id)}
          onAlwaysOnTop={() => toggleAlwaysOnTop(win.id)}
          onOpacity={v => setWindowOpacity(win.id, v)}
          onDismiss={() => setSystemMenu(null)}
        />
      </div>
    )}
    </>
  );
}
