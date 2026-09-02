import React, { useRef, useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { NavFunction } from '../../data/navCatalog';
import type { DesktopGroup } from '../../utils/normalizeDesktopLayout';
import { getWindowConfig, activateNavFunction } from '../../utils/windowManager';
import { useDesktopWindows } from './DesktopWindowManager';
import ContextMenu from '../ContextMenu';
import PromptDialog from '../PromptDialog';
import { getIconLabelOverride, setIconLabelOverride, clearIconLabelOverride, isAutoArrangeEnabled } from '../../utils/desktopIconPreferences';
import { useToast } from '../ToastProvider';
import { isAppPinned, pinApp, unpinApp } from '../../utils/taskbarPreferences';
import { useAuth } from '../../context/AuthContext';

export interface DesktopIconGridProps {
  icons: NavFunction[];
  positions: Record<string, { x: number; y: number }>;
  onReposition: (path: string, x: number, y: number) => void;
  onUnpin: (path: string) => void;
  groups: DesktopGroup[];
  onCreateGroup: (memberPaths: string[], label: string) => void;
  onUngroup: (groupId: string) => void;
  iconSize: 'small' | 'medium' | 'large';
  viewMode: 'grid' | 'list';
  /** Notification badge counts keyed by icon path. */
  badges?: Record<string, number>;
}

const ICON_SIZE_PX: Record<'small' | 'medium' | 'large', number> = { small: 40, medium: 64, large: 88 };
const SNAP_CELL = 96;

// Windows accent blue — matches Windows 10/11 default highlight
const WIN_BLUE = '0,120,212';

function snapToCell(v: number): number {
  return Math.round(v / SNAP_CELL) * SNAP_CELL;
}

interface LassoRect { x1: number; y1: number; x2: number; y2: number }
interface GhostState { x: number; y: number; label: string; iconSize: number }

function lassoToNorm(l: LassoRect) {
  return {
    x: Math.min(l.x1, l.x2),
    y: Math.min(l.y1, l.y2),
    w: Math.abs(l.x2 - l.x1),
    h: Math.abs(l.y2 - l.y1),
  };
}

function iconHitsBounds(
  pos: { x: number; y: number },
  iconSize: number,
  lasso: { x: number; y: number; w: number; h: number },
): boolean {
  const iconW = iconSize + 24;
  const iconH = iconSize + 36;
  return (
    pos.x < lasso.x + lasso.w &&
    pos.x + iconW > lasso.x &&
    pos.y < lasso.y + lasso.h &&
    pos.y + iconH > lasso.y
  );
}

// Arrow-key navigation: find the icon most in the requested direction
function findNeighbor(
  icons: NavFunction[],
  positions: Record<string, { x: number; y: number }>,
  currentPath: string,
  dir: 'left' | 'right' | 'up' | 'down',
  iconSize: number,
): string | null {
  const cur = positions[currentPath];
  if (!cur) return null;
  const SLOT = iconSize + 32;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const fn of icons) {
    if (fn.path === currentPath) continue;
    const pos = positions[fn.path];
    if (!pos) continue;
    const dx = pos.x - cur.x;
    const dy = pos.y - cur.y;
    let inDir = false;
    let dist = 0;
    if (dir === 'right' && dx > 0 && Math.abs(dy) < SLOT) { inDir = true; dist = dx + Math.abs(dy) * 2; }
    if (dir === 'left' && dx < 0 && Math.abs(dy) < SLOT) { inDir = true; dist = -dx + Math.abs(dy) * 2; }
    if (dir === 'down' && dy > 0 && Math.abs(dx) < SLOT) { inDir = true; dist = dy + Math.abs(dx) * 2; }
    if (dir === 'up' && dy < 0 && Math.abs(dx) < SLOT) { inDir = true; dist = -dy + Math.abs(dx) * 2; }
    if (inDir && dist < bestDist) { bestDist = dist; best = fn.path; }
  }
  return best;
}

export default function DesktopIconGrid({
  icons, positions, onReposition, onUnpin, groups = [], onCreateGroup, onUngroup, iconSize, viewMode, badges = {},
}: DesktopIconGridProps) {
  const ICON_SIZE = ICON_SIZE_PX[iconSize];
  const navigate = useNavigate();
  const { openWindow } = useDesktopWindows();
  const { addToast } = useToast();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const dragRef = useRef<{
    path: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [lasso, setLasso] = useState<LassoRect | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [groupPromptOpen, setGroupPromptOpen] = useState(false);
  const [, forceRerender] = useState(0);
  const lassoRef = useRef<LassoRect | null>(null);

  const handleActivate = useCallback((fn: NavFunction) => {
    activateNavFunction(fn, {
      openWindow,
      navigate,
      onElectronOnlyUnavailable: () => addToast('Company Browser is available in the RMPG Flex desktop app', 'error'),
      currentUserRole: user?.role,
    });
  }, [navigate, openWindow, addToast, user?.role]);

  // Single-click: select; double-click: open (Windows 11 desktop behavior)
  const handleIconClick = useCallback((fn: NavFunction, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(fn.path)) next.delete(fn.path); else next.add(fn.path);
        return next;
      });
      return;
    }
    setSelected(new Set([fn.path]));
  }, []);

  const handleIconDblClick = useCallback((fn: NavFunction, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    handleActivate(fn);
  }, [handleActivate]);

  const onIconPointerDown = useCallback((fn: NavFunction, e: React.PointerEvent) => {
    if (renamingPath === fn.path) return;
    e.stopPropagation();
    const pos = positions[fn.path] ?? { x: 20, y: 20 };
    dragRef.current = {
      path: fn.path,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      moved: false,
    };
    const label = getIconLabelOverride(fn.path) ?? fn.label;

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
      if (!dragRef.current.moved) return;
      let nx = Math.max(0, dragRef.current.originX + dx);
      let ny = Math.max(0, dragRef.current.originY + dy);
      if (isAutoArrangeEnabled()) {
        nx = snapToCell(nx);
        ny = snapToCell(ny);
      }
      onReposition(dragRef.current.path, nx, ny);
      setGhost({ x: ev.clientX - ICON_SIZE / 2, y: ev.clientY - ICON_SIZE / 2, label, iconSize: ICON_SIZE });
    };

    const onUp = () => {
      dragRef.current = null;
      setGhost(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [positions, onReposition, renamingPath, ICON_SIZE]);

  // Rubber-band lasso selection — only on grid mode background
  const onContainerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (viewMode !== 'grid') return;
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const x1 = e.clientX - rect.left;
    const y1 = e.clientY - rect.top;
    const start = { x1, y1, x2: x1, y2: y1 };
    setLasso(start);
    lassoRef.current = start;
    setSelected(new Set());

    const onMove = (ev: PointerEvent) => {
      const x2 = ev.clientX - rect.left;
      const y2 = ev.clientY - rect.top;
      const updated = { ...lassoRef.current!, x2, y2 };
      lassoRef.current = updated;
      setLasso({ ...updated });
    };
    const onUp = () => {
      const l = lassoRef.current;
      if (l) {
        const norm = lassoToNorm(l);
        if (norm.w > 4 || norm.h > 4) {
          const hit = new Set<string>();
          for (const fn of icons) {
            const pos = positions[fn.path] ?? { x: 20, y: 20 };
            if (iconHitsBounds(pos, ICON_SIZE, norm)) hit.add(fn.path);
          }
          setSelected(hit);
        }
      }
      setLasso(null);
      lassoRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [viewMode, icons, positions, ICON_SIZE]);

  // Clear selection on click outside
  const onContainerClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setSelected(new Set());
  }, []);

  const handleGroupAs = useCallback(() => {
    setGroupPromptOpen(true);
  }, []);

  const commitRename = useCallback((path: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) setIconLabelOverride(path, trimmed);
    else clearIconLabelOverride(path);
    setRenamingPath(null);
  }, []);

  // Keyboard nav within the icon grid
  const handleIconKeyDown = useCallback((fn: NavFunction, e: React.KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      setRenamingPath(fn.path);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleActivate(fn);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      onUnpin(fn.path);
      return;
    }
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const dir = e.key.replace('Arrow', '').toLowerCase() as 'right' | 'left' | 'down' | 'up';
      const neighbor = findNeighbor(icons, positions, fn.path, dir, ICON_SIZE);
      if (neighbor) {
        const btn = buttonRefs.current[neighbor];
        btn?.focus();
        setSelected(new Set([neighbor]));
      }
    }
  }, [handleActivate, onUnpin, icons, positions, ICON_SIZE]);

  // Dismiss lasso on unmount
  useEffect(() => () => { setLasso(null); lassoRef.current = null; }, []);

  const groupPrompt = (
    <PromptDialog
      isOpen={groupPromptOpen}
      onClose={() => setGroupPromptOpen(false)}
      onSubmit={(label) => {
        onCreateGroup([...selected], label);
        setSelected(new Set());
        setGroupPromptOpen(false);
      }}
      title="Group icons"
      message="Enter a name for this icon group."
      label="Group name"
      defaultValue="New Group"
      confirmLabel="Create"
    />
  );

  if (viewMode === 'list') {
    return (
      <>
      <div style={{ position: 'relative' }}>
        {icons.map((fn) => {
          const Icon = fn.icon;
          const isSelected = selected.has(fn.path);
          const label = getIconLabelOverride(fn.path) ?? fn.label;
          const badge = badges[fn.path] ?? 0;
          return (
            <ContextMenu
              key={fn.path}
              items={listContextItems(fn, selected, isSelected, handleActivate, setRenamingPath, handleGroupAs, onUnpin, forceRerender)}
            >
              <button
                ref={el => { buttonRefs.current[fn.path] = el; }}
                type="button"
                onClick={(e) => handleIconClick(fn, e)}
                onDoubleClick={(e) => handleIconDblClick(fn, e)}
                onKeyDown={(e) => handleIconKeyDown(fn, e)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  borderRadius: 2,
                  border: 'none',
                  background: isSelected ? `rgba(${WIN_BLUE},0.25)` : 'transparent',
                  cursor: 'default',
                  outline: 'none',
                  transition: 'background 0.1s',
                  position: 'relative',
                }}
                onMouseEnter={() => setHoveredPath(fn.path)}
                onMouseLeave={() => setHoveredPath(null)}
              >
                <div style={{
                  width: 20, height: 20, flexShrink: 0, position: 'relative',
                  background: isSelected ? `rgba(${WIN_BLUE},0.15)` : hoveredPath === fn.path ? 'rgba(255,255,255,0.08)' : 'transparent',
                  borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon style={{ width: 14, height: 14, color: isSelected ? `rgb(${WIN_BLUE})` : 'var(--text-secondary)', filter: 'drop-shadow(0 1px 2px rgba(0 0 0 / 0.7))' }} />
                  {badge > 0 && (
                    <span style={{
                      position: 'absolute', top: -4, right: -4,
                      background: 'var(--sev-critical)', color: '#fff',
                      fontSize: 8, fontWeight: 700, lineHeight: 1,
                      padding: '1px 3px', borderRadius: 6, minWidth: 12, textAlign: 'center',
                    }}>
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </div>
                {renamingPath === fn.path ? (
                  <input
                    autoFocus defaultValue={label} aria-label={`Rename ${fn.label}`}
                    onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
                    onBlur={e => commitRename(fn.path, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingPath(null); }}
                    style={{ flex: 1, fontSize: 11, background: 'var(--surface-sunken)', border: '1px solid var(--rmpg-700)', color: 'var(--text-primary)', outline: 'none', padding: '1px 4px', borderRadius: 2 }}
                  />
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'left' }}>
                    {label}
                  </span>
                )}
              </button>
            </ContextMenu>
          );
        })}
      </div>
      {groupPrompt}
      </>
    );
  }

  // Grid view
  const lassoNorm = lasso ? lassoToNorm(lasso) : null;

  return (
    <>
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={onContainerPointerDown}
      onClick={onContainerClick}
    >
      {/* Group overlays */}
      {groups.map(group => (
        <ContextMenu
          key={group.id}
          items={[{ label: 'Ungroup', onClick: () => onUngroup(group.id) }]}
        >
          <div
            data-testid={`desktop-group-${group.id}`}
            style={{
              position: 'absolute', left: group.x, top: group.y, width: group.w, height: group.h,
              border: '1px dashed rgba(255,255,255,0.25)',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 4,
              pointerEvents: 'none',
            }}
          >
            <span style={{
              position: 'absolute', top: -18, left: 4, fontSize: 10, fontWeight: 600,
              color: '#fff', textShadow: '0 1px 3px rgba(0 0 0 / 0.9)',
              pointerEvents: 'auto',
            }}>
              {group.label}
            </span>
          </div>
        </ContextMenu>
      ))}

      {/* Icons */}
      {icons.map((fn) => {
        const pos = positions[fn.path] ?? { x: 20, y: 20 };
        const Icon = fn.icon;
        const eligible = !!getWindowConfig(fn);
        const isSelected = selected.has(fn.path);
        const isHovered = hoveredPath === fn.path;
        const multiSelected = selected.size > 1 && isSelected;
        const label = getIconLabelOverride(fn.path) ?? fn.label;
        const badge = badges[fn.path] ?? 0;

        // Windows 11-style tile state colors
        const tileBg = isSelected
          ? `rgba(${WIN_BLUE},0.28)`
          : isHovered
            ? 'rgba(255,255,255,0.12)'
            : 'transparent';
        const tileBorder = isSelected
          ? `1px solid rgba(${WIN_BLUE},0.8)`
          : isHovered
            ? '1px solid rgba(255,255,255,0.18)'
            : '1px solid transparent';
        const labelBg = isSelected ? `rgba(${WIN_BLUE},0.75)` : 'transparent';

        return (
          <ContextMenu
            key={fn.path}
            items={gridContextItems(fn, selected, isSelected, multiSelected, eligible, handleActivate, setRenamingPath, handleGroupAs, onUnpin, forceRerender)}
          >
            <button
              ref={el => { buttonRefs.current[fn.path] = el; }}
              type="button"
              onClick={(e) => handleIconClick(fn, e)}
              onDoubleClick={(e) => handleIconDblClick(fn, e)}
              onPointerDown={(e) => onIconPointerDown(fn, e)}
              onKeyDown={(e) => handleIconKeyDown(fn, e)}
              onMouseEnter={() => setHoveredPath(fn.path)}
              onMouseLeave={() => setHoveredPath(null)}
              onDragOver={fn.path === '/records' ? (e) => e.preventDefault() : undefined}
              onDrop={fn.path === '/records' ? (e) => {
                e.preventDefault();
                try {
                  const payload = JSON.parse(e.dataTransfer.getData('application/json'));
                  if (payload?.type === 'person' && payload.id) {
                    const config = getWindowConfig(fn);
                    openWindow(`/records?personId=${encodeURIComponent(payload.id)}`, 'Records', config ? { width: config.width, height: config.height } : undefined);
                  }
                } catch { /* ignore malformed drag payloads */ }
              } : undefined}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                width: ICON_SIZE + 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: 4,
                background: 'none',
                border: 'none',
                cursor: 'default',
                outline: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              {/* Icon tile — Windows-style: transparent, with hover/selected states */}
              <div
                style={{
                  width: ICON_SIZE,
                  height: ICON_SIZE,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: tileBg,
                  border: tileBorder,
                  borderRadius: 2,
                  transition: 'background 0.1s, border-color 0.1s',
                }}
              >
                <Icon
                  style={{
                    width: Math.round(ICON_SIZE * 0.6),
                    height: Math.round(ICON_SIZE * 0.6),
                    color: isSelected ? '#fff' : 'var(--text-secondary)',
                    filter: 'drop-shadow(0 2px 4px rgba(0 0 0 / 0.8))',
                    transition: 'color 0.1s',
                  }}
                />
                {/* Badge overlay */}
                {badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    background: 'var(--sev-critical)', color: '#fff',
                    fontSize: 9, fontWeight: 700, lineHeight: 1,
                    padding: '2px 4px', borderRadius: 8, minWidth: 14, textAlign: 'center',
                    boxShadow: '0 1px 3px rgba(0 0 0 / 0.6)',
                    pointerEvents: 'none',
                  }}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>

              {/* Label */}
              {renamingPath === fn.path ? (
                <input
                  autoFocus
                  defaultValue={label}
                  aria-label={`Rename ${fn.label}`}
                  onClick={e => e.stopPropagation()}
                  onPointerDown={e => e.stopPropagation()}
                  onBlur={e => commitRename(fn.path, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingPath(null); }}
                  style={{
                    fontSize: 10, lineHeight: '1.3',
                    width: ICON_SIZE + 16,
                    textAlign: 'center',
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--rmpg-700)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    padding: '1px 4px',
                    borderRadius: 2,
                  }}
                />
              ) : (
                <span style={{
                  fontSize: 10,
                  lineHeight: '1.3',
                  color: '#fff',
                  textShadow: '0 1px 3px rgba(0 0 0 / 0.95), 0 0 6px rgba(0 0 0 / 0.6)',
                  background: labelBg,
                  borderRadius: 2,
                  padding: isSelected ? '0 3px' : 0,
                  maxWidth: ICON_SIZE + 16,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
                  textOverflow: 'ellipsis',
                  textAlign: 'center',
                  wordBreak: 'break-word',
                  transition: 'background 0.1s',
                }}>
                  {label}
                </span>
              )}
            </button>
          </ContextMenu>
        );
      })}

      {/* Rubber-band lasso selection rectangle */}
      {lassoNorm && lassoNorm.w > 2 && lassoNorm.h > 2 && (
        <div
          style={{
            position: 'absolute',
            left: lassoNorm.x,
            top: lassoNorm.y,
            width: lassoNorm.w,
            height: lassoNorm.h,
            border: `1px solid rgba(${WIN_BLUE},0.9)`,
            background: `rgba(${WIN_BLUE},0.12)`,
            pointerEvents: 'none',
            borderRadius: 1,
          }}
        />
      )}

      {/* Drag ghost — follows cursor during icon drag */}
      {ghost && (
        <div
          style={{
            position: 'fixed',
            left: ghost.x,
            top: ghost.y,
            width: ghost.iconSize,
            pointerEvents: 'none',
            opacity: 0.7,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            filter: 'drop-shadow(0 4px 8px rgba(0 0 0 / 0.5))',
          }}
        >
          <div style={{
            width: ghost.iconSize, height: ghost.iconSize,
            background: `rgba(${WIN_BLUE},0.3)`,
            border: `1px solid rgba(${WIN_BLUE},0.6)`,
            borderRadius: 2,
          }} />
          <span style={{
            fontSize: 10, color: '#fff',
            textShadow: '0 1px 3px rgba(0 0 0 / 0.95)',
            maxWidth: ghost.iconSize + 16,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}>
            {ghost.label}
          </span>
        </div>
      )}
    </div>
    {groupPrompt}
    </>
  );
}

// Context menu items for grid mode
function gridContextItems(
  fn: NavFunction,
  selected: Set<string>,
  isSelected: boolean,
  multiSelected: boolean,
  eligible: boolean,
  handleActivate: (fn: NavFunction) => void,
  setRenamingPath: (p: string | null) => void,
  handleGroupAs: () => void,
  onUnpin: (p: string) => void,
  forceRerender: React.Dispatch<React.SetStateAction<number>>,
) {
  return [
    { label: 'Open', onClick: () => handleActivate(fn) },
    ...(eligible ? [{ label: 'Open in new browser tab', onClick: () => window.open(fn.path, '_blank', 'noopener,noreferrer') }] : []),
    { label: 'Rename', onClick: () => setRenamingPath(fn.path) },
    ...(multiSelected ? [{ label: 'Group as...', onClick: handleGroupAs }] : []),
    {
      label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
      onClick: () => { if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path); forceRerender(n => n + 1); },
    },
    { label: 'Unpin', onClick: () => onUnpin(fn.path) },
  ];
}

// Context menu items for list mode (same set, slimmed down)
function listContextItems(
  fn: NavFunction,
  selected: Set<string>,
  isSelected: boolean,
  handleActivate: (fn: NavFunction) => void,
  setRenamingPath: (p: string | null) => void,
  handleGroupAs: () => void,
  onUnpin: (p: string) => void,
  forceRerender: React.Dispatch<React.SetStateAction<number>>,
) {
  const multiSelected = selected.size > 1 && isSelected;
  return [
    { label: 'Open', onClick: () => handleActivate(fn) },
    { label: 'Rename', onClick: () => setRenamingPath(fn.path) },
    ...(multiSelected ? [{ label: 'Group as...', onClick: handleGroupAs }] : []),
    {
      label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
      onClick: () => { if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path); forceRerender(n => n + 1); },
    },
    { label: 'Unpin', onClick: () => onUnpin(fn.path) },
  ];
}
