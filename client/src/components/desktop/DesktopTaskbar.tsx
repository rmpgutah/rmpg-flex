import React, { useState, useMemo } from 'react';
import { Grid3X3, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDesktopWindows } from './DesktopWindowManager';
import { useClock } from '../../hooks/useClock';
import type { NavFunction } from '../../data/navCatalog';
import { apiFetch } from '../../hooks/useApi';

export interface DesktopTaskbarProps {
  icons: NavFunction[];
  catalog: NavFunction[];
}

export default function DesktopTaskbar({ icons, catalog }: DesktopTaskbarProps) {
  const { windows, focusWindow } = useDesktopWindows();
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

  const searchResults = useMemo(() => {
    if (!query.trim()) return icons;
    const q = query.toLowerCase();
    return catalog.filter(fn =>
      fn.label.toLowerCase().includes(q) || fn.description.toLowerCase().includes(q) || fn.path.toLowerCase().includes(q));
  }, [query, icons, catalog]);

  return (
    <div
      className="flex items-center justify-between px-2 gap-2"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 48, background: 'var(--surface-overlay)', borderTop: '1px solid var(--border-default)', zIndex: 1000 }}
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
            {searchResults.slice(0, 20).map(fn => (
              <button
                key={fn.path}
                type="button"
                onClick={() => { navigate(fn.path); setLauncherOpen(false); setQuery(''); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-surface-hover"
                style={{ color: 'var(--text-primary)' }}
              >
                <fn.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--rmpg-400)' }} />
                {fn.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {windows.map(w => (
          <button
            key={w.id}
            type="button"
            onClick={() => focusWindow(w.id)}
            className="px-3 py-1 text-[11px] truncate"
            style={{ maxWidth: 160, background: w.minimized ? 'transparent' : 'rgba(var(--rmpg-500-rgb),0.15)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
          >
            {w.title}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <Bell className="w-4 h-4" style={{ color: 'var(--rmpg-400)' }} />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 flex items-center justify-center font-bold bg-red-600 text-white"
              style={{ minWidth: 12, height: 12, padding: '0 2px', fontSize: 7, borderRadius: 6 }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-primary)' }}>{time}</span>
      </div>
    </div>
  );
}
