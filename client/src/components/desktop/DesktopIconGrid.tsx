import React, { useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavFunction } from '../../data/navCatalog';
import type { DesktopGroup } from '../../utils/normalizeDesktopLayout';
import { getWindowConfig, activateNavFunction } from '../../utils/windowManager';
import { useDesktopWindows } from './DesktopWindowManager';
import ContextMenu from '../ContextMenu';
import { getIconLabelOverride, setIconLabelOverride, clearIconLabelOverride } from '../../utils/desktopIconPreferences';
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
}

const ICON_SIZE_PX: Record<'small' | 'medium' | 'large', number> = { small: 40, medium: 64, large: 88 };

export default function DesktopIconGrid({
  icons, positions, onReposition, onUnpin, groups = [], onCreateGroup, onUngroup, iconSize, viewMode,
}: DesktopIconGridProps) {
  const ICON_SIZE = ICON_SIZE_PX[iconSize];
  const navigate = useNavigate();
  const { openWindow } = useDesktopWindows();
  const { addToast } = useToast();
  const { user } = useAuth();
  const dragRef = useRef<{ path: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [, forceRerender] = useState(0);

  const handleActivate = useCallback((fn: NavFunction) => {
    activateNavFunction(fn, {
      openWindow,
      navigate,
      onElectronOnlyUnavailable: () => addToast('Company Browser is available in the RMPG Flex desktop app', 'error'),
      currentUserRole: user?.role,
    });
  }, [navigate, openWindow, addToast, user?.role]);

  const handleIconClick = useCallback((fn: NavFunction, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(fn.path)) next.delete(fn.path); else next.add(fn.path);
        return next;
      });
      return;
    }
    setSelected(new Set());
    handleActivate(fn);
  }, [handleActivate]);

  const onIconPointerDown = useCallback((fn: NavFunction, e: React.PointerEvent) => {
    const pos = positions[fn.path] ?? { x: 20, y: 20 };
    dragRef.current = { path: fn.path, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      onReposition(dragRef.current.path, Math.max(0, dragRef.current.originX + dx), Math.max(0, dragRef.current.originY + dy));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [positions, onReposition]);

  const handleGroupAs = useCallback(() => {
    const label = window.prompt('Group name:', 'New Group');
    if (label && label.trim()) {
      onCreateGroup([...selected], label.trim());
      setSelected(new Set());
    }
  }, [selected, onCreateGroup]);

  const commitRename = useCallback((path: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) setIconLabelOverride(path, trimmed);
    else clearIconLabelOverride(path);
    setRenamingPath(null);
  }, []);

  return (
    <div style={viewMode === 'grid' ? { position: 'absolute', inset: 0 } : { position: 'relative' }}>
      {viewMode === 'grid' && groups.map(group => (
        <ContextMenu
          key={group.id}
          items={[{ label: 'Ungroup', onClick: () => onUngroup(group.id) }]}
        >
          <div
            data-testid={`desktop-group-${group.id}`}
            style={{
              position: 'absolute', left: group.x, top: group.y, width: group.w, height: group.h,
              border: '1px dashed var(--border-default)', background: 'rgba(var(--rmpg-500-rgb),0.04)',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{ position: 'absolute', top: -18, left: 2, fontSize: 10, color: 'var(--text-muted)', pointerEvents: 'auto' }}
            >
              {group.label}
            </span>
          </div>
        </ContextMenu>
      ))}
      {icons.map((fn) => {
        const pos = positions[fn.path] ?? { x: 20, y: 20 };
        const Icon = fn.icon;
        const eligible = !!getWindowConfig(fn);
        const isSelected = selected.has(fn.path);
        const multiSelected = selected.size > 1 && isSelected;
        return (
          <ContextMenu
            key={fn.path}
            items={[
              { label: 'Open', onClick: () => handleActivate(fn) },
              ...(eligible ? [{ label: 'Open in new browser tab', onClick: () => window.open(fn.path, '_blank', 'noopener,noreferrer') }] : []),
              { label: 'Rename', onClick: () => setRenamingPath(fn.path) },
              ...(multiSelected ? [{ label: 'Group as...', onClick: handleGroupAs }] : []),
              {
                label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
                onClick: () => {
                  if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path);
                  forceRerender(n => n + 1);
                },
              },
              { label: 'Unpin', onClick: () => onUnpin(fn.path) },
            ]}
          >
            <button
              type="button"
              onClick={(e) => handleIconClick(fn, e)}
              onPointerDown={viewMode === 'grid' ? (e) => onIconPointerDown(fn, e) : undefined}
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
              style={
                viewMode === 'grid'
                  ? { position: 'absolute', left: pos.x, top: pos.y, width: ICON_SIZE + 24, outline: isSelected ? '1px solid var(--brand-400)' : 'none' }
                  : { width: '100%', outline: isSelected ? '1px solid var(--brand-400)' : 'none' }
              }
              className={viewMode === 'grid' ? 'flex flex-col items-center gap-1 p-1 text-center' : 'flex items-center gap-2 px-2 py-1 text-left'}
            >
              <div
                className="flex items-center justify-center"
                style={{ width: ICON_SIZE, height: ICON_SIZE, background: 'rgba(var(--rmpg-500-rgb),0.1)', border: '1px solid var(--border-subtle)' }}
              >
                <Icon className="w-6 h-6" style={{ color: 'var(--text-secondary)' }} />
              </div>
              {renamingPath === fn.path ? (
                <input
                  autoFocus
                  defaultValue={getIconLabelOverride(fn.path) ?? fn.label}
                  aria-label={`Rename ${fn.label}`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => commitRename(fn.path, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.currentTarget.blur(); }
                    if (e.key === 'Escape') { setRenamingPath(null); }
                  }}
                  className="text-[10px] leading-tight w-full text-center bg-surface-sunken border border-rmpg-700 text-rmpg-100 focus:outline-none"
                />
              ) : (
                <span className="text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>{getIconLabelOverride(fn.path) ?? fn.label}</span>
              )}
            </button>
          </ContextMenu>
        );
      })}
    </div>
  );
}
