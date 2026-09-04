import React, { useState, useMemo, useEffect, useCallback, useRef, useReducer } from 'react';
import { Grid3X3, Bell, Clock as ClockIcon, Radio, FileWarning, Monitor, Lock, Search, Plus, SquareSigma, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useDesktopWindows } from './DesktopWindowManager';
import { activateNavFunction } from '../../utils/windowManager';
import { useClock } from '../../hooks/useClock';
import { useAuth } from '../../context/AuthContext';
import type { NavFunction } from '../../data/navCatalog';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import { toastClockLinkWarnings, type ClockLinkFlags } from '../../utils/corporateOpsClient';
import ContextMenu from '../ContextMenu';
import { isAppPinned, pinApp, unpinApp, getPinnedApps, getTaskbarPosition, getTaskbarSize, isTaskbarAutoHideEnabled, type TaskbarSize } from '../../utils/taskbarPreferences';
import { getQuickLaunchPins, setQuickLaunchPins } from '../../utils/quickLaunchPreferences';
import DesktopSystemTray from './DesktopSystemTray';
import DesktopWelfareCountdown from './DesktopWelfareCountdown';
import DesktopQuickSettings from './DesktopQuickSettings';
import CalendarFlyout from './CalendarFlyout';
import { SlidersHorizontal } from 'lucide-react';
import { WorkspacePills } from './DesktopVirtualDesktops';
import FlexOSAppDrawer from './FlexOSAppDrawer';
import DesktopJumpList from './DesktopJumpList';
import { TASKBAR_PINNED_ACTIONS } from '../../data/taskbarPinnedActions';
import ClockInOutMileageModal from '../time/ClockInOutMileageModal';

export const TASKBAR_HEIGHT_PX: Record<TaskbarSize, number> = { small: 48, large: 56 };

function QuickSettingsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(v => !v)} title="Quick settings"
        style={{ background: open ? 'var(--surface-hover)' : 'none', border: 'none', cursor: 'pointer', borderRadius: 2, padding: '3px 5px', display: 'flex', alignItems: 'center' }}>
        <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: 'var(--text-primary)' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, zIndex: 99980 }}>
          <DesktopQuickSettings onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

export interface DesktopTaskbarProps {
  onOpenCommandPalette?: () => void;
  onNewCall?: () => void;
  icons: NavFunction[];
  catalog: NavFunction[];
  onLock?: () => void;
  onToggleNotifCenter?: () => void;
  onPowerMenu?: () => void;
}

export default function DesktopTaskbar({ icons, catalog, onLock, onToggleNotifCenter, onPowerMenu, onOpenCommandPalette, onNewCall }: DesktopTaskbarProps) {
  const { windows, focusWindow, openWindow, minimizeAll, restoreAll, closeWindow } = useDesktopWindows();
  const [autoMinimizedIds, setAutoMinimizedIds] = useState<string[]>([]);
  const [, forceRerender] = useReducer((x: number) => x + 1, 0);

  const handleShowDesktop = useCallback(() => {
    if (autoMinimizedIds.length > 0) {
      restoreAll(autoMinimizedIds);
      setAutoMinimizedIds([]);
    } else {
      setAutoMinimizedIds(minimizeAll());
    }
  }, [autoMinimizedIds, minimizeAll, restoreAll]);

  const { time, date } = useClock();
  const [calOpen, setCalOpen] = useState(false);
  const clockRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  React.useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await apiFetch<{ count: number }>('/notifications/unread-count');
        if (!cancelled) setUnreadCount(res?.count ?? 0);
      } catch { /* silent */ }
    }
    poll();
    const interval = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const { user } = useAuth();
  const { addToast } = useToast();
  const [onDuty, setOnDuty] = useState<boolean | null>(null);
  const [clockBusy, setClockBusy] = useState(false);
  // Synchronous re-entrancy guard: `clockBusy` state drives the UI (disabling/
  // labeling) but its update doesn't commit until the next render, so two
  // click events dispatched before that render (e.g. a rapid double-click)
  // can both observe a stale `clockBusy === false` closure. A ref mutates
  // immediately, so the second invocation is rejected regardless of React's
  // batching/timing.
  const clockToggleInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ active: boolean }>('/personnel/time/mine/active')
      .then(res => { if (!cancelled) setOnDuty(res.active); })
      .catch(() => { if (!cancelled) setOnDuty(false); });
    return () => { cancelled = true; };
  }, [launcherOpen]);

  const [mileageModalOpen, setMileageModalOpen] = useState(false);

  const handleClockToggle = useCallback(async () => {
    if (!user?.id || clockBusy || clockToggleInFlightRef.current) return;
    setMileageModalOpen(true);
    setLauncherOpen(false);
  }, [clockBusy, user?.id]);

  const handleMileageModalSuccess = useCallback((punch: any) => {
    const wasOnDuty = onDuty;
    setOnDuty(v => !v);
    if (!wasOnDuty) toastClockLinkWarnings(addToast, punch as ClockLinkFlags);
    addToast(wasOnDuty ? 'Clocked out successfully' : 'Clocked in successfully', 'success');
  }, [onDuty, addToast]);

  const handleSelectResult = useCallback((fn: NavFunction) => {
    let capHit = false;
    activateNavFunction(fn, {
      navigate,
      openWindow: (path, title, size) => {
        if (!openWindow(path, title, size)) capHit = true;
      },
      onElectronOnlyUnavailable: () => addToast('Company Browser is available in the RMPG Flex desktop app', 'error'),
      currentUserRole: user?.role,
    });
    if (capHit) addToast('Close a window to open another', 'error');
    setLauncherOpen(false);
  }, [navigate, openWindow, addToast, user?.role]);


  const runningPaths = useMemo(() => new Set(windows.map(w => w.path)), [windows]);

  const pinnedNotRunning = useMemo(() => {
    return getPinnedApps()
      .filter(path => !runningPaths.has(path))
      .map(path => catalog.find(fn => fn.path === path))
      .filter((fn): fn is NavFunction => !!fn);
  }, [windows, catalog]);

  const cycleIndexRef = useRef<Record<string, number>>({});

  const [jumpList, setJumpList] = useState<{ appKey: string; appLabel: string; x: number; y: number; isRunning: boolean; closeWindowId?: string } | null>(null);

  const [quickLaunchPins, setQuickLaunchPinsState] = useState<string[]>(() => getQuickLaunchPins());
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  const [quickPickerInput, setQuickPickerInput] = useState('');

  const handleAddQuickLaunch = useCallback((path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setQuickLaunchPinsState(prev => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed].slice(0, 8);
      setQuickLaunchPins(next);
      return next;
    });
    setQuickPickerInput('');
    setQuickPickerOpen(false);
  }, []);

  const handleRemoveQuickLaunch = useCallback((path: string) => {
    setQuickLaunchPinsState(prev => {
      const next = prev.filter(p => p !== path);
      setQuickLaunchPins(next);
      return next;
    });
  }, []);

  const [position] = useState(() => getTaskbarPosition());
  const [size] = useState(() => getTaskbarSize());
  const [autoHideEnabled] = useState(() => isTaskbarAutoHideEnabled());
  const [hidden, setHidden] = useState(autoHideEnabled);
  const showDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleShow = useCallback(() => {
    if (showDelayRef.current) clearTimeout(showDelayRef.current);
    showDelayRef.current = setTimeout(() => setHidden(false), 300);
  }, []);

  const cancelShow = useCallback(() => {
    if (showDelayRef.current) { clearTimeout(showDelayRef.current); showDelayRef.current = null; }
  }, []);
  const barHeight = TASKBAR_HEIGHT_PX[size];

  const windowGroups = useMemo(() => {
    const byPath = new Map<string, typeof windows>();
    for (const w of windows) {
      const list = byPath.get(w.path) ?? [];
      list.push(w);
      byPath.set(w.path, list);
    }
    return [...byPath.entries()].map(([path, group]) => ({ path, group }));
  }, [windows]);

  return (
    <>
    <div
      className="flex items-center justify-between px-2 gap-2"
      style={{
        position: 'fixed', left: 0, right: 0,
        ...(position === 'top' ? { top: 0 } : { bottom: 0 }),
        height: barHeight,
        background: 'var(--surface-overlay)',
        borderTop: position === 'bottom' ? '1px solid var(--desktop-shell-accent, var(--border-default))' : undefined,
        borderBottom: position === 'top' ? '1px solid var(--desktop-shell-accent, var(--border-default))' : undefined,
        zIndex: 1000,
        transform: autoHideEnabled && hidden ? `translateY(${position === 'top' ? '-100%' : '100%'})` : 'translateY(0px)',
        transition: 'transform 180ms ease',
      }}
      onMouseLeave={autoHideEnabled ? () => { cancelShow(); setHidden(true); } : undefined}
      onMouseEnter={autoHideEnabled ? cancelShow : undefined}
    >
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Open app launcher" onClick={() => setLauncherOpen(v => !v)} className="p-2 hover:bg-surface-hover">
          <Grid3X3 className="w-4 h-4" style={{ color: 'var(--brand-400)' }} />
        </button>
        {launcherOpen && (
          <FlexOSAppDrawer
            catalog={catalog}
            onNavigate={path => handleSelectResult(catalog.find(fn => fn.path === path) ?? catalog[0])}
            onClose={() => setLauncherOpen(false)}
            quickActions={[
              { key: 'clock', label: onDuty ? 'Clock Out' : 'Clock In', icon: ClockIcon, onClick: handleClockToggle },
              { key: 'new-call', label: 'New Call', icon: Radio, onClick: () => navigate('/dispatch?newCall=1') },
              { key: 'new-incident', label: 'New Incident', icon: FileWarning, onClick: () => navigate('/incidents?newIncident=1') },
              { key: 'calc', label: 'Calculator', icon: SquareSigma, onClick: () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'calc' })) },
            ]}
          />
        )}
      </div>

      <WorkspacePills />
      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {pinnedNotRunning.map(fn => (
          <button
            key={fn.path}
            type="button"
            onClick={() => activateNavFunction(fn, { navigate, openWindow, currentUserRole: user?.role })}
            onContextMenu={(e) => {
              e.preventDefault();
              setJumpList({ appKey: fn.path, appLabel: fn.label, x: e.clientX, y: e.clientY - 260, isRunning: false });
            }}
            className="px-3 py-1 text-[11px] truncate"
            style={{ maxWidth: 160, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
          >
            {fn.label}
          </button>
        ))}
        {windowGroups.map(({ path, group }) => {
          if (group.length === 1) {
            const w = group[0];
            const titleBadgeMatch = w.title.match(/\((\d+)\)$/);
            const titleBadgeCount = titleBadgeMatch ? parseInt(titleBadgeMatch[1], 10) : null;
            return (
              <ContextMenu
                key={w.id}
                items={[
                  { label: isAppPinned(w.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar', onClick: () => { if (isAppPinned(w.path)) unpinApp(w.path); else pinApp(w.path); forceRerender(); } },
                  { label: 'Close', onClick: () => closeWindow(w.id) },
                ]}
              >
                <button
                  type="button"
                  onClick={() => focusWindow(w.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setJumpList({ appKey: w.path, appLabel: w.title, x: e.clientX, y: e.clientY - 260, isRunning: true, closeWindowId: w.id });
                  }}
                  className="relative px-3 text-[11px] truncate"
                  style={{ maxWidth: 160, paddingTop: 2, paddingBottom: isAppPinned(w.path) ? 6 : 4, background: w.minimized ? 'transparent' : 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                >
                  {w.title}
                  {titleBadgeCount !== null && titleBadgeCount > 0 && (
                    <span
                      className="absolute -top-1 -right-1 flex items-center justify-center font-bold text-white"
                      style={{ minWidth: 16, height: 16, padding: '0 3px', fontSize: 8, borderRadius: '50%', background: 'var(--sev-critical)' }}
                    >
                      {titleBadgeCount > 99 ? '99+' : titleBadgeCount}
                    </span>
                  )}
                  {isAppPinned(w.path) && (
                    <span style={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: 'var(--desktop-shell-accent, var(--rmpg-400))', display: 'block' }} />
                  )}
                </button>
              </ContextMenu>
            );
          }
          const handleGroupClick = () => {
            const current = cycleIndexRef.current[path] ?? 0;
            const next = (current + 1) % group.length;
            cycleIndexRef.current[path] = next;
            focusWindow(group[next].id);
          };
          return (
            <ContextMenu
              key={path}
              items={[
                { label: isAppPinned(path) ? 'Unpin from Taskbar' : 'Pin to Taskbar', onClick: () => { if (isAppPinned(path)) unpinApp(path); else pinApp(path); forceRerender(); } },
                { label: 'Close', onClick: () => closeWindow(group[Math.min(cycleIndexRef.current[path] ?? 0, group.length - 1)].id) },
                { label: 'Close all', onClick: () => group.forEach(w => closeWindow(w.id)) },
              ]}
            >
              <button
                type="button"
                aria-label={`${group[0].title} (${group.length})`}
                onClick={handleGroupClick}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const idx = cycleIndexRef.current[path] ?? 0;
                  setJumpList({ appKey: path, appLabel: group[0].title, x: e.clientX, y: e.clientY - 260, isRunning: true, closeWindowId: group[Math.min(idx, group.length - 1)].id });
                }}
                className="relative px-3 text-[11px] truncate"
                style={{ maxWidth: 160, paddingTop: 2, paddingBottom: isAppPinned(path) ? 6 : 4, background: 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
              >
                {group[0].title}
                <span
                  className="absolute -top-1 -right-1 flex items-center justify-center font-bold bg-red-600 text-white"
                  style={{ minWidth: 12, height: 12, padding: '0 2px', fontSize: 7, borderRadius: 6 }}
                >
                  {group.length}
                </span>
                {isAppPinned(path) && (
                  <span style={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2 }}>
                    {Array.from({ length: Math.min(group.length, 3) }, (_, i) => (
                      <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--desktop-shell-accent, var(--rmpg-400))', display: 'block' }} />
                    ))}
                  </span>
                )}
              </button>
            </ContextMenu>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={autoMinimizedIds.length > 0 ? 'Show windows' : 'Show desktop'}
          onClick={handleShowDesktop}
          className="p-1.5 hover:bg-surface-hover"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <Monitor className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        </button>
        {onOpenCommandPalette && (
          <button
            type="button"
            aria-label="Command palette (Ctrl+P)"
            onClick={onOpenCommandPalette}
            className="p-1.5 hover:bg-surface-hover"
            style={{ border: '1px solid var(--border-subtle)' }}
            title="Command palette (Ctrl+P)"
          >
            <Search className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
        {onNewCall && (
          <button
            type="button"
            aria-label="New call"
            onClick={onNewCall}
            className="p-1.5 hover:bg-surface-hover"
            style={{ border: '1px solid var(--border-subtle)' }}
            title="New call"
          >
            <Plus className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok)' }} />
          </button>
        )}
        {onLock && (
          <button
            type="button"
            aria-label="Lock screen"
            onClick={onLock}
            className="p-1.5 hover:bg-surface-hover"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <Lock className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
        <button
          type="button"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          onClick={onToggleNotifCenter}
          className="relative p-1.5 hover:bg-surface-hover"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <Bell className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 flex items-center justify-center font-bold bg-red-600 text-white"
              style={{ minWidth: 12, height: 12, padding: '0 2px', fontSize: 7, borderRadius: 6 }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        {/* Quick Launch strip */}
        {quickLaunchPins.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 6 }}>
            {quickLaunchPins.map(path => {
              const fn = catalog.find(f => f.path === path);
              if (!fn) return null;
              const Icon = fn.icon;
              return (
                <button
                  key={path}
                  type="button"
                  aria-label={fn.label}
                  title={fn.label}
                  onClick={() => activateNavFunction(fn, { navigate, openWindow, currentUserRole: user?.role })}
                  onContextMenu={(e) => { e.preventDefault(); handleRemoveQuickLaunch(path); }}
                  style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 2, flexShrink: 0 }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                </button>
              );
            })}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="Add quick launch"
            title="Add quick launch pin (right-click pin to remove)"
            onClick={() => setQuickPickerOpen(v => !v)}
            style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px dashed var(--border-subtle)', cursor: 'pointer', borderRadius: 2, color: 'var(--text-muted)', fontSize: 14, flexShrink: 0 }}
          >
            +
          </button>
          {quickPickerOpen && (
            <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 8, zIndex: 20000, width: 200 }}>
              <div style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 6 }}>QUICK LAUNCH — ADD PIN</div>
              <input
                autoFocus
                type="text"
                value={quickPickerInput}
                onChange={e => setQuickPickerInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddQuickLaunch(quickPickerInput); if (e.key === 'Escape') setQuickPickerOpen(false); }}
                placeholder="Route path, e.g. /dispatch"
                style={{ width: '100%', fontSize: 10, padding: '4px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => handleAddQuickLaunch(quickPickerInput)}
                style={{ marginTop: 6, width: '100%', fontSize: 9, padding: '3px 0', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-primary)' }}
              >
                Add
              </button>
            </div>
          )}
        </div>
        <DesktopWelfareCountdown />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('flexos:open-kiosk-hud'))}
          title="500+ Features System Control HUD (Win+F / Alt+F)"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            background: 'rgba(212,160,23,0.12)',
            border: '1px solid rgba(212,160,23,0.4)',
            borderRadius: 2,
            color: 'var(--brand-gold)',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          <ShieldCheck style={{ width: 13, height: 13 }} />
          <span style={{ letterSpacing: '0.04em' }}>500+ HUD</span>
        </button>
        <QuickSettingsButton />
        <DesktopSystemTray />
        <div style={{ position: 'relative' }}>
          <button
            ref={clockRef}
            type="button"
            onClick={() => setCalOpen(v => !v)}
            onContextMenu={onPowerMenu ? (e) => { e.preventDefault(); onPowerMenu(); } : undefined}
            title={onPowerMenu ? 'Click for calendar · Right-click for power options' : 'Click for calendar'}
            style={{
              background: calOpen ? 'rgba(255,255,255,0.07)' : 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 1,
            }}
          >
            <span className="font-mono select-none" style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1 }}>{time}</span>
            <span className="select-none" style={{ fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1 }}>{date.replace(/,\s*\d{4}$/, '')}</span>
          </button>
          {calOpen && (
            <CalendarFlyout anchorRef={clockRef} onClose={() => setCalOpen(false)} />
          )}
        </div>
      </div>
    </div>
    {autoHideEnabled && (
      <div
        data-testid="taskbar-hover-strip"
        onMouseEnter={scheduleShow}
        onMouseLeave={cancelShow}
        style={{ position: 'fixed', left: 0, right: 0, height: 4, zIndex: 999, ...(position === 'top' ? { top: 0 } : { bottom: 0 }) }}
      />
    )}
    {jumpList && (
      <DesktopJumpList
        appKey={jumpList.appKey}
        appLabel={jumpList.appLabel}
        x={jumpList.x}
        y={jumpList.y}
        pinnedActions={TASKBAR_PINNED_ACTIONS[jumpList.appKey] ?? []}
        isPinned={isAppPinned(jumpList.appKey)}
        isRunning={jumpList.isRunning}
        onPin={() => { pinApp(jumpList.appKey); setJumpList(null); forceRerender(); }}
        onUnpin={() => { unpinApp(jumpList.appKey); setJumpList(null); forceRerender(); }}
        onCloseWindow={jumpList.closeWindowId ? () => { closeWindow(jumpList.closeWindowId!); setJumpList(null); } : undefined}
        onDismiss={() => setJumpList(null)}
      />
    )}
    {user?.id && (
      <ClockInOutMileageModal
        isOpen={mileageModalOpen}
        onClose={() => setMileageModalOpen(false)}
        isClockingOut={!!onDuty}
        officerId={user.id}
        onSuccess={handleMileageModalSuccess}
      />
    )}
    </>
  );
}
