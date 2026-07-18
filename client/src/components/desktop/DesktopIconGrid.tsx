import React, { useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavFunction } from '../../data/navCatalog';
import { POPOUT_PAGES } from '../../utils/windowManager';
import { useDesktopWindows } from './DesktopWindowManager';
import ContextMenu from '../ContextMenu';

export interface DesktopIconGridProps {
  icons: NavFunction[];
  positions: Record<string, { x: number; y: number }>;
  onReposition: (path: string, x: number, y: number) => void;
  onUnpin: (path: string) => void;
}

const ICON_SIZE = 64;

export default function DesktopIconGrid({ icons, positions, onReposition, onUnpin }: DesktopIconGridProps) {
  const navigate = useNavigate();
  const { openWindow } = useDesktopWindows();
  const dragRef = useRef<{ path: string; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const handleActivate = useCallback((fn: NavFunction) => {
    if (POPOUT_PAGES[fn.path]) {
      openWindow(fn.path, fn.label);
    } else {
      navigate(fn.path);
    }
  }, [navigate, openWindow]);

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

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {icons.map((fn) => {
        const pos = positions[fn.path] ?? { x: 20, y: 20 };
        const Icon = fn.icon;
        const eligible = !!POPOUT_PAGES[fn.path];
        return (
          <ContextMenu
            key={fn.path}
            items={[
              { label: 'Open', onClick: () => handleActivate(fn) },
              ...(eligible ? [{ label: 'Open in new browser tab', onClick: () => window.open(fn.path, '_blank', 'noopener,noreferrer') }] : []),
              { label: 'Unpin', onClick: () => onUnpin(fn.path) },
            ]}
          >
            <button
              type="button"
              onClick={() => handleActivate(fn)}
              onPointerDown={(e) => onIconPointerDown(fn, e)}
              style={{ position: 'absolute', left: pos.x, top: pos.y, width: ICON_SIZE + 24 }}
              className="flex flex-col items-center gap-1 p-1 text-center"
            >
              <div
                className="flex items-center justify-center"
                style={{ width: ICON_SIZE, height: ICON_SIZE, background: 'rgba(var(--rmpg-500-rgb),0.1)', border: '1px solid var(--border-subtle)' }}
              >
                <Icon className="w-6 h-6" style={{ color: 'var(--rmpg-300)' }} />
              </div>
              <span className="text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>{fn.label}</span>
            </button>
          </ContextMenu>
        );
      })}
    </div>
  );
}
