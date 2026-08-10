import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Grid3X3, Bell, Clock as ClockIcon, Radio, FileWarning, Monitor, Lock } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useDesktopWindows } from './DesktopWindowManager';
import { activateNavFunction } from '../../utils/windowManager';
import { useClock } from '../../hooks/useClock';
import { useAuth } from '../../context/AuthContext';
import type { NavFunction } from '../../data/navCatalog';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import ContextMenu from '../ContextMenu';
import { isAppPinned, pinApp, unpinApp, getPinnedApps, getTaskbarPosition, getTaskbarSize, isTaskbarAutoHideEnabled, type TaskbarSize } from '../../utils/taskbarPreferences';

export const TASKBAR_HEIGHT_PX: Record<TaskbarSize, number> = { small: 48, large: 56 };

export interface DesktopTaskbarProps {
  icons: NavFunction[];
  catalog: NavFunction[];
  onLock?: () => void;
  onToggleNotifCenter?: () => void;
}

export default function DesktopTaskbar({ icons, catalog, onLock, onToggleNotifCenter }: DesktopTaskbarProps) {
  const { windows, focusWindow, openWindow, minimizeAll, restoreAll, closeWindow } = useDesktopWindows();
  const [autoMinimizedIds, setAutoMinimizedIds] = useState<string[]>([]);
  const [, forceRerender] = useState(0);

  const handleShowDesktop = useCallback(() => {
    if (autoMinimizedIds.length > 0) {
      restoreAll(autoMinimizedIds);
      setAutoMinimizedIds([]);
    } else {
      setAutoMinimizedIds(minimizeAll());
    }
  }, [autoMinimizedIds, minimizeAll, restoreAll]);

  const { time } = useClock();
  const navigate = useNavigate();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [query, setQuery] = useState('');
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

  const handleClockToggle = useCallback(async () => {
    if (!user?.id || clockBusy || clockToggleInFlightRef.current) return;
    clockToggleInFlightRef.current = true;
    setClockBusy(true);
    const wasOnDuty = onDuty;
    try {
      await apiFetch(wasOnDuty ? '/personnel/time/clock-out' : '/personnel/time/clock-in', {
        method: 'POST',
        body: JSON.stringify({ officer_id: user.id }),
      });
      setOnDuty(v => !v);
    } catch (err: any) {
      // apiFetch has no toast interceptor of its own — on failure it only plays
      // a best-effort audio chime (nackForApiFailure in actionChimes.ts), so
      // without this the operator gets zero visible feedback on a real failure
      // (e.g. the 409 "Already clocked in" from src/routes/personnel.ts, or a
      // network error). Surface it the same way PersonnelPage.tsx's
      // handleClockIn/handleClockOut do.
      addToast(err?.message || (wasOnDuty ? 'Failed to clock out' : 'Failed to clock in'), 'error');
    } finally {
      clockToggleInFlightRef.current = false;
      setClockBusy(false);
      setLauncherOpen(false);
    }
  }, [onDuty, clockBusy, user, addToast]);

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
    setQuery('');
  }, [navigate, openWindow, addToast, user?.role]);

  const quickActions = useMemo(() => ([
    { key: 'clock', label: onDuty ? 'Clock Out' : 'Clock In', icon: ClockIcon, onClick: handleClockToggle },
    { key: 'new-call', label: 'New Call', icon: Radio, onClick: () => { navigate('/dispatch?newCall=1'); setLauncherOpen(false); } },
    { key: 'new-incident', label: 'New Incident', icon: FileWarning, onClick: () => { navigate('/incidents?newIncident=1'); setLauncherOpen(false); } },
  ]), [onDuty, handleClockToggle, navigate]);

  const searchResults = useMemo(() => {
    if (!query.trim()) return icons;
    const q = query.toLowerCase();
    return catalog.filter(fn =>
      fn.label.toLowerCase().includes(q) || fn.description.toLowerCase().includes(q) || fn.path.toLowerCase().includes(q));
  }, [query, icons, catalog]);

  const pinnedNotRunning = useMemo(() => {
    const runningPaths = new Set(windows.map(w => w.path));
    return getPinnedApps()
      .filter(path => !runningPaths.has(path))
      .map(path => catalog.find(fn => fn.path === path))
      .filter((fn): fn is NavFunction => !!fn);
  }, [windows, catalog]);

  const cycleIndexRef = useRef<Record<string, number>>({});

  const [position] = useState(() => getTaskbarPosition());
  const [size] = useState(() => getTaskbarSize());
  const [autoHideEnabled] = useState(() => isTaskbarAutoHideEnabled());
  const [hidden, setHidden] = useState(autoHideEnabled);
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
        transition: 'transform 150ms ease',
      }}
      onMouseLeave={autoHideEnabled ? () => setHidden(true) : undefined}
    >
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Open app launcher" onClick={() => setLauncherOpen(v => !v)} className="p-2 hover:bg-surface-hover">
          <Grid3X3 className="w-4 h-4" style={{ color: 'var(--brand-400)' }} />
        </button>
        {launcherOpen && (
          <div style={{ position: 'fixed', left: 8, bottom: 52, width: 320, maxHeight: 400, overflowY: 'auto', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', zIndex: 1001 }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules…"
              className="w-full px-2 py-1.5 text-[11px] bg-surface-sunken border-b border-rmpg-700 text-rmpg-100 focus:outline-none"
            />
            {!query.trim() && (
              <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {quickActions.map(action => (
                  <button
                    key={action.key}
                    type="button"
                    onClick={action.onClick}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-surface-hover"
                    style={{ color: 'var(--accent-silver-400)' }}
                  >
                    <action.icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {action.label}
                  </button>
                ))}
              </div>
            )}
            {searchResults.slice(0, 20).map(fn => (
              <ContextMenu
                key={fn.path}
                items={[{
                  label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
                  onClick: () => { if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path); forceRerender(n => n + 1); },
                }]}
              >
                <button
                  type="button"
                  onClick={() => handleSelectResult(fn)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-surface-hover"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <fn.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                  {fn.label}
                </button>
              </ContextMenu>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {pinnedNotRunning.map(fn => (
          <button
            key={fn.path}
            type="button"
            onClick={() => activateNavFunction(fn, { navigate, openWindow, currentUserRole: user?.role })}
            className="px-3 py-1 text-[11px] truncate"
            style={{ maxWidth: 160, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
          >
            {fn.label}
          </button>
        ))}
        {windowGroups.map(({ path, group }) => {
          if (group.length === 1) {
            const w = group[0];
            return (
              <ContextMenu
                key={w.id}
                items={[
                  { label: isAppPinned(w.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar', onClick: () => { if (isAppPinned(w.path)) unpinApp(w.path); else pinApp(w.path); forceRerender(n => n + 1); } },
                  { label: 'Close', onClick: () => closeWindow(w.id) },
                ]}
              >
                <button
                  type="button"
                  onClick={() => focusWindow(w.id)}
                  className="px-3 py-1 text-[11px] truncate"
                  style={{ maxWidth: 160, background: w.minimized ? 'transparent' : 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                >
                  {w.title}
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
                { label: isAppPinned(path) ? 'Unpin from Taskbar' : 'Pin to Taskbar', onClick: () => { if (isAppPinned(path)) unpinApp(path); else pinApp(path); forceRerender(n => n + 1); } },
                { label: 'Close', onClick: () => closeWindow(group[Math.min(cycleIndexRef.current[path] ?? 0, group.length - 1)].id) },
                { label: 'Close all', onClick: () => group.forEach(w => closeWindow(w.id)) },
              ]}
            >
              <button
                type="button"
                aria-label={`${group[0].title} (${group.length})`}
                onClick={handleGroupClick}
                className="relative px-3 py-1 text-[11px] truncate"
                style={{ maxWidth: 160, background: 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
              >
                {group[0].title}
                <span
                  className="absolute -top-1 -right-1 flex items-center justify-center font-bold bg-red-600 text-white"
                  style={{ minWidth: 12, height: 12, padding: '0 2px', fontSize: 7, borderRadius: 6 }}
                >
                  {group.length}
                </span>
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
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-primary)' }}>{time}</span>
      </div>
    </div>
    {autoHideEnabled && (
      <div
        data-testid="taskbar-hover-strip"
        onMouseEnter={() => setHidden(false)}
        style={{ position: 'fixed', left: 0, right: 0, height: 4, zIndex: 999, ...(position === 'top' ? { top: 0 } : { bottom: 0 }) }}
      />
    )}
    </>
  );
}
