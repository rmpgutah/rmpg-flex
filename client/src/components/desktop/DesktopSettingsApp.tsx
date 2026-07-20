import React, { useState, useRef, useCallback } from 'react';
import { Sliders, LayoutGrid, AppWindow, FolderKanban, X } from 'lucide-react';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { DESKTOP_WALLPAPERS } from '../../data/desktopWallpapers';
import { DESKTOP_ACCENTS } from '../../data/desktopAccents';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';

const ALL_WIDGETS: { id: string; label: string }[] = [
  { id: 'clock', label: 'Clock & Shift' },
  { id: 'ops-summary', label: 'Live Ops Summary' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'quick-access', label: 'Quick Access' },
  { id: 'shift-timer', label: 'Shift Timer' },
  { id: 'pinned-call-ticker', label: 'Pinned Call Ticker' },
  { id: 'mini-map', label: 'Mini Map' },
];

const ICON_SIZES: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];
const ICON_SIZE_LABELS: Record<'small' | 'medium' | 'large', string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const SORT_MODES: Array<'manual' | 'alpha' | 'usage'> = ['manual', 'alpha', 'usage'];
const SORT_LABELS: Record<'manual' | 'alpha' | 'usage', string> = { manual: 'Manual', alpha: 'Alphabetical', usage: 'Most Used' };

const CATEGORIES = [
  { id: 'personalization', label: 'Personalization', icon: Sliders },
  { id: 'desktop-icons', label: 'Desktop & Icons', icon: LayoutGrid },
  { id: 'window-management', label: 'Window Management', icon: AppWindow },
  { id: 'layout-templates', label: 'Layout & Templates', icon: FolderKanban },
] as const;

type CategoryId = typeof CATEGORIES[number]['id'];

export interface DesktopSettingsAppProps {
  widgets: DesktopWidgetState[];
  onToggleWidget: (id: string, enabled: boolean) => void;
  iconSize: 'small' | 'medium' | 'large';
  onIconSizeChange: (size: 'small' | 'medium' | 'large') => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  sortMode: 'manual' | 'alpha' | 'usage';
  onSortModeChange: (mode: 'manual' | 'alpha' | 'usage') => void;
  onSnapToGrid: () => void;
  wallpaperId: string;
  onWallpaperChange: (id: string) => void;
  accentId: string;
  onAccentChange: (id: string) => void;
  onResetToDefault: () => void;
  onClose: () => void;
}

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

function sectionLabelStyle(): React.CSSProperties {
  return { color: 'var(--rmpg-400)' };
}

export default function DesktopSettingsApp({
  widgets, onToggleWidget, iconSize, onIconSizeChange, viewMode, onViewModeChange, sortMode, onSortModeChange, onSnapToGrid,
  wallpaperId, onWallpaperChange, accentId, onAccentChange, onResetToDefault, onClose,
}: DesktopSettingsAppProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('personalization');
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, (window.innerWidth - DEFAULT_WIDTH) / 2),
    y: Math.max(0, (window.innerHeight - DEFAULT_HEIGHT) / 2),
  }));
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const { onPointerDown: onTitleBarPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));

  const resizeState = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);
  const onResizeHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    resizeState.current = { startX: e.clientX, startY: e.clientY, originW: size.width, originH: size.height };
    const onMove = (ev: PointerEvent) => {
      if (!resizeState.current) return;
      const dx = ev.clientX - resizeState.current.startX;
      const dy = ev.clientY - resizeState.current.startY;
      setSize({
        width: Math.max(MIN_WIDTH, resizeState.current.originW + dx),
        height: Math.max(MIN_HEIGHT, resizeState.current.originH + dy),
      });
    };
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [size.width, size.height]);

  const enabledIds = new Set(widgets.filter(w => w.on).map(w => w.id));

  return (
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: size.width, height: size.height,
        background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        onPointerDown={onTitleBarPointerDown}
        className="flex items-center justify-between px-2 select-none cursor-move"
        style={{ height: 30, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>Settings</span>
        <button type="button" aria-label="Close Settings" onClick={onClose} className="p-1 hover:bg-surface-hover">
          <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--rmpg-400))' }} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div style={{ width: 160, borderRight: '1px solid var(--border-subtle)', flexShrink: 0, overflowY: 'auto' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px]"
              style={{ background: activeCategory === cat.id ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
            >
              <cat.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--rmpg-400)' }} />
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {activeCategory === 'personalization' && (
            <div>
              <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Wallpaper</div>
              <div className="flex gap-1.5 flex-wrap">
                {DESKTOP_WALLPAPERS.map(w => (
                  <button
                    key={w.id} type="button" aria-label={`Wallpaper: ${w.label}`} onClick={() => onWallpaperChange(w.id)}
                    style={{ width: 24, height: 24, background: w.background, border: wallpaperId === w.id ? '2px solid var(--brand-400)' : '1px solid var(--border-default)' }}
                  />
                ))}
              </div>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Accent Color</div>
              <div className="flex gap-1.5 flex-wrap">
                {DESKTOP_ACCENTS.map(a => (
                  <button
                    key={a.id} type="button" aria-label={`Accent: ${a.label}`} onClick={() => onAccentChange(a.id)}
                    style={{ width: 20, height: 20, borderRadius: '50%', background: a.accent, border: accentId === a.id ? '2px solid var(--text-primary)' : '1px solid var(--border-default)' }}
                  />
                ))}
              </div>
            </div>
          )}

          {activeCategory === 'desktop-icons' && (
            <div>
              <div className="text-[10px] font-semibold uppercase mb-1" style={sectionLabelStyle()}>Widgets</div>
              {ALL_WIDGETS.map(w => (
                <label key={w.id} className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={enabledIds.has(w.id)} onChange={(e) => onToggleWidget(w.id, e.target.checked)} />
                  {w.label}
                </label>
              ))}

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Icon Size</div>
              <div className="flex gap-1">
                {ICON_SIZES.map(s => (
                  <button
                    key={s} type="button" onClick={() => onIconSizeChange(s)}
                    className="text-[10px] px-2 py-0.5"
                    style={{ border: '1px solid var(--border-default)', background: iconSize === s ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {ICON_SIZE_LABELS[s]}
                  </button>
                ))}
              </div>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>View</div>
              <div className="flex gap-1">
                {(['grid', 'list'] as const).map(mode => (
                  <button
                    key={mode} type="button" onClick={() => onViewModeChange(mode)}
                    className="text-[10px] px-2 py-0.5 capitalize"
                    style={{ border: '1px solid var(--border-default)', background: viewMode === mode ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {mode === 'grid' ? 'Grid' : 'List'}
                  </button>
                ))}
              </div>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Sort</div>
              <div className="flex gap-1 flex-wrap">
                {SORT_MODES.map(mode => (
                  <button
                    key={mode} type="button" onClick={() => onSortModeChange(mode)}
                    className="text-[10px] px-2 py-0.5"
                    style={{ border: '1px solid var(--border-default)', background: sortMode === mode ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {SORT_LABELS[mode]}
                  </button>
                ))}
                <button type="button" onClick={onSnapToGrid} className="text-[10px] px-2 py-0.5" style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                  Snap to Grid
                </button>
              </div>

              <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => { if (window.confirm('Reset your desktop layout, widgets, wallpaper, accent, and sticky notes back to default? This cannot be undone.')) onResetToDefault(); }}
                  className="text-[10px] px-2 py-1 w-full"
                  style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
                >
                  Reset to Default
                </button>
              </div>
            </div>
          )}

          {activeCategory === 'window-management' && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Window cycling and multi-monitor placement are coming in a future phase.
            </div>
          )}

          {activeCategory === 'layout-templates' && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Layout export/import and per-role templates are coming in a future phase.
            </div>
          )}
        </div>
      </div>

      <div
        onPointerDown={onResizeHandlePointerDown}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize' }}
      />
    </div>
  );
}
