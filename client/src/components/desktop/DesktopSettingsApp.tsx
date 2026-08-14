import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Sliders, LayoutGrid, AppWindow, FolderKanban, PanelBottom, Monitor, Shield, X } from 'lucide-react';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';
import { DESKTOP_WALLPAPERS, DEFAULT_WALLPAPER_ID, CUSTOM_WALLPAPER_ID, setCustomWallpaperDataUrl, clearCustomWallpaper, CUSTOM_WALLPAPER_MAX_BYTES, isSlideshowEnabled, setSlideshowEnabled, getSlideshowIntervalMin, setSlideshowIntervalMin } from '../../data/desktopWallpapers';
import { DESKTOP_ACCENTS, DEFAULT_ACCENT_ID } from '../../data/desktopAccents';
import { SETTINGS_SEARCH_INDEX } from '../../data/settingsSearchIndex';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
import { isSnapEnabled, setSnapEnabled } from '../../utils/snapPreference';
import { isMultiMonitorSupported, isMultiMonitorEnabled, requestMultiMonitorAccess } from '../../utils/multiMonitor';
import {
  isTaskbarAutoHideEnabled, setTaskbarAutoHide,
  getTaskbarPosition, setTaskbarPosition, type TaskbarPosition,
  getTaskbarSize, setTaskbarSize, type TaskbarSize,
} from '../../utils/taskbarPreferences';
import { exportSettings, importSettings } from '../../utils/settingsExportImport';
import { getClockFormat, setClockFormat, type ClockFormat } from '../../utils/clockPreference';
import { isDesktopSoundEnabled, setDesktopSoundEnabled } from '../../utils/desktopSoundPreference';
import { getDefaultWindowOpacity, setDefaultWindowOpacity } from '../../utils/windowOpacityPreference';
import {
  isDynamicWallpaperEnabled, setDynamicWallpaperEnabled,
  getDynamicWallpaperDayId, setDynamicWallpaperDayId,
  getDynamicWallpaperNightId, setDynamicWallpaperNightId,
} from '../../utils/dynamicWallpaperPreferences';
import DesktopKioskSettings from './DesktopKioskSettings';
import FlexOSSettings from './FlexOSSettings';

const ALL_WIDGETS: { id: string; label: string }[] = [
  { id: 'clock', label: 'Clock & Shift' },
  { id: 'ops-summary', label: 'Live Ops Summary' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'quick-access', label: 'Quick Access' },
  { id: 'shift-timer', label: 'Shift Timer' },
  { id: 'pinned-call-ticker', label: 'Pinned Call Ticker' },
  { id: 'mini-map', label: 'Mini Map' },
  { id: 'weather', label: 'Weather / Conditions' },
  { id: 'radio-channel', label: 'Radio Channel' },
  { id: 'roll-call', label: 'Roll Call' },
  { id: 'incident-timer', label: 'Incident Timer' },
  { id: 'gps-trail', label: 'GPS Trail' },
  { id: 'shift-handoff', label: 'Shift Handoff Checklist' },
  { id: 'panic', label: 'Panic / Duress' },
  { id: 'warrant-count', label: 'Warrant Count' },
  { id: 'body-cam', label: 'Body Camera' },
  { id: 'message-count', label: 'Message Count' },
];

const ICON_SIZES: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];
const ICON_SIZE_LABELS: Record<'small' | 'medium' | 'large', string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const SORT_MODES: Array<'manual' | 'alpha' | 'usage'> = ['manual', 'alpha', 'usage'];
const SORT_LABELS: Record<'manual' | 'alpha' | 'usage', string> = { manual: 'Manual', alpha: 'Alphabetical', usage: 'Most Used' };

const CATEGORIES = [
  { id: 'personalization', label: 'Personalization', icon: Sliders },
  { id: 'desktop-icons', label: 'Desktop & Icons', icon: LayoutGrid },
  { id: 'window-management', label: 'Window Management', icon: AppWindow },
  { id: 'taskbar', label: 'Taskbar', icon: PanelBottom },
  { id: 'layout-templates', label: 'Layout & Templates', icon: FolderKanban },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'session-log', label: 'Session Log', icon: ClipboardList },
  { id: 'kiosk-mode', label: 'Kiosk Mode', icon: Monitor },
  { id: 'flexos', label: 'FlexOS', icon: Shield },
] as const;

export type CategoryId = typeof CATEGORIES[number]['id'];

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
  isAdmin: boolean;
}

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

function sectionLabelStyle(): React.CSSProperties {
  return { color: 'var(--text-secondary)' };
}

export default function DesktopSettingsApp({
  widgets, onToggleWidget, iconSize, onIconSizeChange, viewMode, onViewModeChange, sortMode, onSortModeChange, onSnapToGrid,
  wallpaperId, onWallpaperChange, accentId, onAccentChange, onResetToDefault, onClose, isAdmin,
}: DesktopSettingsAppProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('personalization');
  const [searchQuery, setSearchQuery] = useState('');
  const [snapEnabled, setSnapEnabledState] = useState(() => isSnapEnabled());
  const [multiMonitorEnabled, setMultiMonitorEnabledState] = useState(() => isMultiMonitorEnabled());
  const multiMonitorSupported = isMultiMonitorSupported();
  const [autoHide, setAutoHideState] = useState(() => isTaskbarAutoHideEnabled());
  const [taskbarPosition, setTaskbarPositionState] = useState<TaskbarPosition>(() => getTaskbarPosition());
  const [taskbarSize, setTaskbarSizeState] = useState<TaskbarSize>(() => getTaskbarSize());
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customWallpaperError, setCustomWallpaperError] = useState<string | null>(null);
  const [slideshow, setSlideshowState] = useState(() => isSlideshowEnabled());
  const [slideshowInterval, setSlideshowIntervalState] = useState(() => getSlideshowIntervalMin());
  const [clockFormat, setClockFormatState] = useState<ClockFormat>(() => getClockFormat());
  const [soundEnabled, setSoundEnabledState] = useState(() => isDesktopSoundEnabled());
  const [windowOpacity, setWindowOpacityState] = useState(() => getDefaultWindowOpacity());
  const [autoLockMinutes, setAutoLockMinutesState] = useState<number | null>(() => getAutoLockMinutes());
  const [highContrast, setHighContrastState] = useState(() => isHighContrastEnabled());
  const [sessionLogs, setSessionLogs] = useState<SessionLogEntry[]>([]);
  const [sessionLogsLoading, setSessionLogsLoading] = useState(false);
  const [sessionLogFilter, setSessionLogFilter] = useState('');
  const themeImportRef = useRef<HTMLInputElement>(null);
  const [themeImportMsg, setThemeImportMsg] = useState<string | null>(null);
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

  // Load session logs when that tab is active
  useEffect(() => {
    if (activeCategory !== 'session-log') return;
    setSessionLogsLoading(true);
    apiFetch<unknown>('/errors?category=session&limit=200')
      .then(res => {
        const rows = ((res as { results?: SessionLogEntry[] })?.results
          ?? (res as { data?: SessionLogEntry[] })?.data
          ?? (Array.isArray(res) ? (res as SessionLogEntry[]) : []));
        setSessionLogs(rows);
      })
      .catch(() => setSessionLogs([]))
      .finally(() => setSessionLogsLoading(false));
  }, [activeCategory]);

  const handleExport = useCallback(() => {
    const blob = new Blob([exportSettings()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rmpg-desktop-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleThemeExport = useCallback(() => {
    const theme = {
      flexos_theme_version: 1,
      wallpaper_id: wallpaperId,
      accent_id: accentId,
      taskbar_size: getTaskbarSize(),
      night_light_enabled: localStorage.getItem('rmpg_night_light_enabled') ?? null,
      auto_hide_taskbar: isTaskbarAutoHideEnabled(),
    };
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flexos-theme-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [wallpaperId, accentId]);

  const handleThemeImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const obj = JSON.parse(text) as Record<string, unknown>;
      if (obj.flexos_theme_version !== 1) {
        setThemeImportMsg('Invalid theme file (unsupported version).');
        return;
      }
      const changes: string[] = [];
      if (obj.wallpaper_id && typeof obj.wallpaper_id === 'string') changes.push(`Wallpaper: ${obj.wallpaper_id}`);
      if (obj.accent_id && typeof obj.accent_id === 'string') changes.push(`Accent: ${obj.accent_id}`);
      if (obj.taskbar_size) changes.push(`Taskbar size: ${obj.taskbar_size}`);
      if (!window.confirm(`This theme will change: ${changes.join(', ')}. Apply?`)) return;
      if (obj.wallpaper_id && typeof obj.wallpaper_id === 'string') onWallpaperChange(obj.wallpaper_id);
      if (obj.accent_id && typeof obj.accent_id === 'string') onAccentChange(obj.accent_id);
      if (typeof obj.auto_hide_taskbar === 'boolean') { setTaskbarAutoHide(obj.auto_hide_taskbar); setAutoHideState(obj.auto_hide_taskbar); }
      if (obj.taskbar_size === 'small' || obj.taskbar_size === 'large') { setTaskbarSize(obj.taskbar_size); setTaskbarSizeState(obj.taskbar_size); }
      if (typeof obj.night_light_enabled === 'string') localStorage.setItem('rmpg_night_light_enabled', obj.night_light_enabled);
      setThemeImportMsg('Theme applied.');
    } catch {
      setThemeImportMsg('Could not read theme file.');
    }
  }, [onWallpaperChange, onAccentChange]);

  function exportSessionLogCsv() {
    const rows = [['timestamp', 'event type', 'source', 'message'].join(',')];
    for (const e of sessionLogs) {
      rows.push([e.created_at, e.severity, e.source ?? '', `"${(e.message ?? '').replace(/"/g, '""')}"`].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'session-log.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCustomWallpaperUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > CUSTOM_WALLPAPER_MAX_BYTES) {
      setCustomWallpaperError('Image too large (max 4 MB). Please compress it first.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setCustomWallpaperDataUrl(dataUrl);
      onWallpaperChange(CUSTOM_WALLPAPER_ID);
      setCustomWallpaperError(null);
    };
    reader.readAsDataURL(file);
    // reset input so same file can be picked again
    e.target.value = '';
  }

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = importSettings(text);
    setImportMessage(result.ok ? 'Settings imported.' : (result.error ?? 'Import failed.'));
    e.target.value = '';
  }, []);

  const enabledIds = new Set(widgets.filter(w => w.on).map(w => w.id));

  // Kiosk Mode is admin/manager-and-Windows-only per the design spec.
  // window.electron.platform is a synchronous property set at preload time
  // (unlike getKioskShellState, which is an async IPC round-trip), so it's
  // safe to read directly in this filter alongside the existing synchronous
  // isAdmin check without introducing async state just for this gate.
  const isWindows = window.electron?.platform === 'win32';
  const visibleCategories = useMemo(
    () => CATEGORIES.filter(c => c.id !== 'kiosk-mode' || (isAdmin && isWindows)),
    [isAdmin, isWindows],
  );

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const matchedIds = new Set(
      SETTINGS_SEARCH_INDEX.filter(entry => entry.keywords.some(k => k.toLowerCase().includes(q))).map(e => e.categoryId),
    );
    return visibleCategories.filter(cat => matchedIds.has(cat.id));
  }, [searchQuery, visibleCategories]);

  return (
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: size.width, height: size.height,
        background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
        boxShadow: '0 8px 24px rgba(0 0 0 / 0.4)', zIndex: 2000, display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        onPointerDown={onTitleBarPointerDown}
        className="flex items-center justify-between px-2 select-none cursor-move"
        style={{ height: 30, background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>Settings</span>
        <button type="button" aria-label="Close Settings" onClick={onClose} className="p-1 hover:bg-surface-hover">
          <X className="w-3 h-3" style={{ color: 'var(--sev-critical, var(--text-secondary))' }} />
        </button>
      </div>

      <div className="flex items-center gap-2 px-2 py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button type="button" onClick={handleExport} className="text-[10px] px-2 py-0.5" style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
          Export Settings
        </button>
        <label className="text-[10px] px-2 py-0.5 cursor-pointer" style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
          Import Settings
          <input type="file" accept="application/json" aria-label="Import Settings" onChange={handleImportFile} className="hidden" />
        </label>
        {importMessage && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{importMessage}</span>}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div style={{ width: 160, borderRight: '1px solid var(--border-subtle)', flexShrink: 0, overflowY: 'auto' }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="w-full px-2 py-1.5 text-[11px] bg-surface-sunken border-b border-rmpg-700 text-rmpg-100 focus:outline-none"
          />
          {(searchMatches ?? visibleCategories).map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => { setActiveCategory(cat.id); setSearchQuery(''); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px]"
              style={{ background: activeCategory === cat.id ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
            >
              <cat.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
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

              {/* Custom wallpaper upload */}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button
                  className="px-3 py-1.5 text-[11px] bg-surface-raised border border-border-subtle rounded-sm hover:bg-surface-hover text-text-primary transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload Image
                </button>
                {wallpaperId === CUSTOM_WALLPAPER_ID && (
                  <button
                    className="px-3 py-1.5 text-[11px] bg-surface-raised border border-border-subtle rounded-sm hover:bg-surface-hover text-text-secondary transition-colors"
                    onClick={() => { clearCustomWallpaper(); onWallpaperChange('blue-silver-default'); }}
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleCustomWallpaperUpload}
                />
              </div>
              {customWallpaperError && (
                <p className="text-[11px] text-red-400 mt-1">{customWallpaperError}</p>
              )}

              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={slideshow}
                    onChange={e => { setSlideshowEnabled(e.target.checked); setSlideshowState(e.target.checked); }}
                    className="accent-rmpg-400"
                  />
                  <span className="text-[11px] text-text-primary">Wallpaper slideshow</span>
                </label>
                {slideshow && (
                  <select
                    className="bg-surface-sunken border border-border-subtle rounded-sm px-2 py-1 text-[11px] text-text-primary"
                    value={slideshowInterval}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setSlideshowIntervalMin(v);
                      setSlideshowIntervalState(v);
                    }}
                  >
                    <option value={1}>1 min</option>
                    <option value={5}>5 min</option>
                    <option value={10}>10 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>1 hour</option>
                  </select>
                )}
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

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Clock Format</div>
              <div className="flex gap-1">
                {(['12h', '24h'] as const).map(fmt => (
                  <button
                    key={fmt} type="button"
                    onClick={() => { setClockFormat(fmt); setClockFormatState(fmt); }}
                    className="text-[10px] px-2 py-0.5"
                    style={{ border: '1px solid var(--border-default)', background: clockFormat === fmt ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {fmt === '12h' ? '12-hour' : '24-hour'}
                  </button>
                ))}
              </div>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Desktop Sounds</div>
              <label className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  aria-label="Desktop sounds"
                  checked={soundEnabled}
                  onChange={(e) => { setDesktopSoundEnabled(e.target.checked); setSoundEnabledState(e.target.checked); }}
                />
                Play a sound when opening, closing, minimizing, or snapping a window
              </label>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Window Transparency</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { const next = getDefaultWindowOpacity() - 0.1; setDefaultWindowOpacity(next); setWindowOpacityState(getDefaultWindowOpacity()); }}
                  className="text-[10px] px-2 py-0.5"
                  style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                >
                  Decrease
                </button>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{Math.round(windowOpacity * 100)}%</span>
                <button
                  type="button"
                  onClick={() => { const next = getDefaultWindowOpacity() + 0.1; setDefaultWindowOpacity(next); setWindowOpacityState(getDefaultWindowOpacity()); }}
                  className="text-[10px] px-2 py-0.5"
                  style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                >
                  Increase
                </button>
              </div>

              <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Reset wallpaper, accent color, clock format, desktop sounds, and window transparency to default?')) {
                      onWallpaperChange(DEFAULT_WALLPAPER_ID);
                      onAccentChange(DEFAULT_ACCENT_ID);
                      setClockFormat('24h'); setClockFormatState('24h');
                      setDesktopSoundEnabled(true); setSoundEnabledState(true);
                      setDefaultWindowOpacity(1); setWindowOpacityState(1);
                    }
                  }}
                  className="text-[10px] px-2 py-1 w-full"
                  style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
                >
                  Reset this category to default
                </button>
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
            <div>
              <div className="text-[10px] font-semibold uppercase mb-1" style={sectionLabelStyle()}>Window Cycling</div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Hold Ctrl and press ` to cycle through open windows; Ctrl+Shift+` cycles in reverse.
              </p>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Snap to Edge</div>
              <label className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  checked={snapEnabled}
                  onChange={(e) => { setSnapEnabled(e.target.checked); setSnapEnabledState(e.target.checked); }}
                />
                Drag a window to a screen edge to snap it to half the desktop
              </label>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Multi-Monitor</div>
              {multiMonitorSupported ? (
                <button
                  type="button"
                  onClick={async () => {
                    const granted = await requestMultiMonitorAccess();
                    setMultiMonitorEnabledState(granted || isMultiMonitorEnabled());
                  }}
                  className="text-[10px] px-2 py-1"
                  style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                >
                  {multiMonitorEnabled ? 'Secondary-monitor pop-outs enabled' : 'Enable secondary-monitor pop-outs'}
                </button>
              ) : (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Not supported in this browser.</p>
              )}

              <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => { if (window.confirm('Reset window management settings (snap to edge) to default?')) { setSnapEnabled(true); setSnapEnabledState(true); } }}
                  className="text-[10px] px-2 py-1 w-full"
                  style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
                >
                  Reset this category to default
                </button>
              </div>
            </div>
          )}

          {activeCategory === 'taskbar' && (
            <div>
              <div className="text-[10px] font-semibold uppercase mb-1" style={sectionLabelStyle()}>Auto-Hide</div>
              <label className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  aria-label="Auto-hide taskbar"
                  checked={autoHide}
                  onChange={(e) => { setTaskbarAutoHide(e.target.checked); setAutoHideState(e.target.checked); }}
                />
                Hide the taskbar until you move the mouse to the screen edge
              </label>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Position</div>
              <div className="flex gap-1">
                {(['bottom', 'top'] as const).map(position => (
                  <button
                    key={position} type="button"
                    onClick={() => { setTaskbarPosition(position); setTaskbarPositionState(position); }}
                    className="text-[10px] px-2 py-0.5 capitalize"
                    style={{ border: '1px solid var(--border-default)', background: taskbarPosition === position ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {position === 'bottom' ? 'Bottom' : 'Top'}
                  </button>
                ))}
              </div>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Size</div>
              <div className="flex gap-1">
                {(['small', 'large'] as const).map(size => (
                  <button
                    key={size} type="button"
                    onClick={() => { setTaskbarSize(size); setTaskbarSizeState(size); }}
                    className="text-[10px] px-2 py-0.5 capitalize"
                    style={{ border: '1px solid var(--border-default)', background: taskbarSize === size ? 'rgba(var(--rmpg-500-rgb),0.15)' : 'transparent', color: 'var(--text-primary)' }}
                  >
                    {size === 'small' ? 'Small' : 'Large'}
                  </button>
                ))}
              </div>

              <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm('Reset taskbar position, size, and auto-hide to default? (Pinned apps are kept.)')) return;
                    setTaskbarPosition('bottom'); setTaskbarPositionState('bottom');
                    setTaskbarSize('small'); setTaskbarSizeState('small');
                    setTaskbarAutoHide(false); setAutoHideState(false);
                  }}
                  className="text-[10px] px-2 py-1 w-full"
                  style={{ border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)' }}
                >
                  Reset this category to default
                </button>
              </div>
            </div>
          )}

          {activeCategory === 'layout-templates' && (
            <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Layout &amp; Templates</div>
              <div style={{ color: 'var(--text-muted)' }}>
                Saved widget layouts and per-role templates will be configured here.
                Use the widget context menu on the desktop to rearrange and save your current layout.
              </div>
            </div>
          )}

          {activeCategory === 'security' && (
            <div>
              <div className="text-[10px] font-semibold uppercase mb-1" style={sectionLabelStyle()}>Auto-lock After Inactivity</div>
              <select
                aria-label="Auto-lock timer"
                className="bg-surface-sunken border border-border-subtle px-2 py-1 text-[11px] text-text-primary"
                value={autoLockMinutes === null ? 'never' : String(autoLockMinutes)}
                onChange={e => {
                  const v = e.target.value === 'never' ? null : parseInt(e.target.value, 10);
                  setAutoLockMinutes(v);
                  setAutoLockMinutesState(v);
                }}
              >
                <option value="never">Never</option>
                <option value="1">1 minute</option>
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
              </select>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                Screen locks after this period of inactivity.
              </p>

              <div className="text-[10px] font-semibold uppercase mt-3 mb-1" style={sectionLabelStyle()}>Accessibility</div>
              <label className="flex items-center gap-2 text-[11px] py-1" style={{ color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  aria-label="High contrast mode"
                  checked={highContrast}
                  onChange={e => {
                    setHighContrastEnabled(e.target.checked);
                    setHighContrastState(e.target.checked);
                  }}
                />
                High Contrast Mode (black background, yellow text)
              </label>
            </div>
          )}

          {activeCategory === 'session-log' && isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={sessionLogFilter}
                  onChange={e => setSessionLogFilter(e.target.value)}
                  placeholder="Filter by message or type…"
                  aria-label="Filter session log"
                  className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-surface-sunken border border-border-subtle text-text-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={exportSessionLogCsv}
                  className="flex items-center gap-1 text-[10px] px-2 py-1"
                  style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)', flexShrink: 0 }}
                >
                  <Download style={{ width: 10, height: 10 }} /> Export CSV
                </button>
              </div>
              {sessionLogsLoading ? (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : (
                <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border-subtle)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-overlay)' }}>
                        <th style={{ padding: '3px 6px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-subtle)' }}>Timestamp</th>
                        <th style={{ padding: '3px 6px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>Type</th>
                        <th style={{ padding: '3px 6px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionLogs
                        .filter(e => {
                          if (!sessionLogFilter) return true;
                          const q = sessionLogFilter.toLowerCase();
                          return (e.message ?? '').toLowerCase().includes(q) || (e.severity ?? '').toLowerCase().includes(q);
                        })
                        .map(e => (
                          <tr key={e.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '2px 6px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{e.created_at}</td>
                            <td style={{ padding: '2px 6px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{e.severity}</td>
                            <td style={{ padding: '2px 6px', color: 'var(--text-primary)' }}>{e.message}</td>
                          </tr>
                        ))
                      }
                      {sessionLogs.length === 0 && (
                        <tr><td colSpan={3} style={{ padding: '8px 6px', color: 'var(--text-muted)', textAlign: 'center' }}>No session events recorded.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeCategory === 'kiosk-mode' && isAdmin && (
            <DesktopKioskSettings onClose={onClose} />
          )}

          {activeCategory === 'flexos' && (
            <FlexOSSettings />
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
