// client/src/components/desktop/DesktopWidgetSettingsPopover.tsx
import React from 'react';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { DESKTOP_WALLPAPERS } from '../../data/desktopWallpapers';
import { DESKTOP_ACCENTS } from '../../data/desktopAccents';

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

export interface DesktopWidgetSettingsPopoverProps {
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

function sectionLabelStyle(): React.CSSProperties {
  return { color: 'var(--rmpg-400)' };
}

export default function DesktopWidgetSettingsPopover({
  widgets, onToggleWidget, iconSize, onIconSizeChange, viewMode, onViewModeChange, sortMode, onSortModeChange, onSnapToGrid,
  wallpaperId, onWallpaperChange, accentId, onAccentChange, onResetToDefault, onClose,
}: DesktopWidgetSettingsPopoverProps) {
  const enabledIds = new Set(widgets.filter(w => w.on).map(w => w.id));

  return (
    <div
      style={{ position: 'fixed', right: 16, top: 16, width: 260, maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', zIndex: 2000 }}
      className="p-2"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase" style={sectionLabelStyle()}>Desktop Settings</span>
        <button type="button" onClick={onClose} className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Close</button>
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Widgets</div>
      {ALL_WIDGETS.map(w => (
        <label key={w.id} className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={enabledIds.has(w.id)} onChange={(e) => onToggleWidget(w.id, e.target.checked)} />
          {w.label}
        </label>
      ))}

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Icon Size</div>
      <div className="flex gap-1">
        {ICON_SIZES.map(size => (
          <button
            key={size}
            type="button"
            onClick={() => onIconSizeChange(size)}
            className="text-[10px] px-2 py-0.5"
            style={{ border: '1px solid var(--border-default)', background: iconSize === size ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
          >
            {ICON_SIZE_LABELS[size]}
          </button>
        ))}
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>View</div>
      <div className="flex gap-1">
        {(['grid', 'list'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => onViewModeChange(mode)}
            className="text-[10px] px-2 py-0.5 capitalize"
            style={{ border: '1px solid var(--border-default)', background: viewMode === mode ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
          >
            {mode === 'grid' ? 'Grid' : 'List'}
          </button>
        ))}
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Sort</div>
      <div className="flex gap-1 flex-wrap">
        {SORT_MODES.map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => onSortModeChange(mode)}
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

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Wallpaper</div>
      <div className="flex gap-1.5 flex-wrap">
        {DESKTOP_WALLPAPERS.map(w => (
          <button
            key={w.id}
            type="button"
            aria-label={`Wallpaper: ${w.label}`}
            onClick={() => onWallpaperChange(w.id)}
            style={{ width: 24, height: 24, background: w.background, border: wallpaperId === w.id ? '2px solid var(--brand-400)' : '1px solid var(--border-default)' }}
          />
        ))}
      </div>

      <div className="text-[10px] font-semibold uppercase mt-2 mb-1" style={sectionLabelStyle()}>Accent Color</div>
      <div className="flex gap-1.5 flex-wrap">
        {DESKTOP_ACCENTS.map(a => (
          <button
            key={a.id}
            type="button"
            aria-label={`Accent: ${a.label}`}
            onClick={() => onAccentChange(a.id)}
            style={{ width: 20, height: 20, borderRadius: '50%', background: a.accent, border: accentId === a.id ? '2px solid var(--text-primary)' : '1px solid var(--border-default)' }}
          />
        ))}
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
  );
}
