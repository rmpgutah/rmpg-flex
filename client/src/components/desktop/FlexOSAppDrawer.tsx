/**
 * FlexOS App Drawer — full system launcher
 *
 * Shown when the user clicks the Grid button in the taskbar.
 * Features: category tabs, module grid, inline search, pinned row.
 * Positioned above/below taskbar depending on taskbar position preference.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, Star, Shield, type LucideIcon } from 'lucide-react';
import type { NavFunction } from '../../data/navCatalog';
import { NAV_CATEGORIES } from '../../data/navCatalog';
import { loadFavorites } from '../../utils/navFavorites';
import { getTaskbarPosition, getTaskbarSize, isAppPinned, pinApp, unpinApp } from '../../utils/taskbarPreferences';
import { TASKBAR_HEIGHT_PX } from './DesktopTaskbar';
import ContextMenu from '../ContextMenu';

export interface FlexOSQuickAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

export interface FlexOSAppDrawerProps {
  catalog: NavFunction[];
  onNavigate: (path: string) => void;
  onClose: () => void;
  quickActions?: FlexOSQuickAction[];
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside]);
}

const DRAWER_WIDTH = 480;
const DRAWER_HEIGHT = 520;

const CATEGORY_ORDER = ['Dispatch', 'Records', 'Intel & Warrants', 'Fleet', 'Administration', 'Miscellaneous'];

function normalizeCategory(cat: string): string {
  if (/dispatch/i.test(cat)) return 'Dispatch';
  if (/record|case|person|warrant/i.test(cat)) return 'Records';
  if (/intel|warrant/i.test(cat)) return 'Intel & Warrants';
  if (/fleet|vehicle/i.test(cat)) return 'Fleet';
  if (/admin|setting|user|role|kiosk/i.test(cat)) return 'Administration';
  return 'Miscellaneous';
}

export default function FlexOSAppDrawer({ catalog, onNavigate, onClose, quickActions }: FlexOSAppDrawerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, onClose);

  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState('All');
  const favorites = useMemo(() => loadFavorites(), []);
  const taskbarPos = getTaskbarPosition();
  const taskbarH = TASKBAR_HEIGHT_PX[getTaskbarSize()];

  // Group catalog into categories using the nav catalog's own label
  const groups = useMemo(() => {
    const map = new Map<string, NavFunction[]>();
    map.set('All', catalog);
    map.set('Pinned', catalog.filter(fn => favorites.has(fn.path)));

    for (const navCat of NAV_CATEGORIES) {
      const fns = navCat.functions.filter(fn => catalog.some(c => c.path === fn.path));
      if (fns.length === 0) continue;
      const groupName = normalizeCategory(navCat.label);
      if (!map.has(groupName)) map.set(groupName, []);
      map.get(groupName)!.push(...fns);
    }
    return map;
  }, [catalog, favorites]);

  const groupTabs = useMemo(() => {
    const tabs = ['All', 'Pinned'];
    for (const k of CATEGORY_ORDER) { if (groups.has(k) && groups.get(k)!.length > 0) tabs.push(k); }
    return tabs;
  }, [groups]);

  const displayItems = useMemo(() => {
    const base = groups.get(activeGroup) ?? [];
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter(fn => fn.label.toLowerCase().includes(q) || fn.path.toLowerCase().includes(q));
  }, [groups, activeGroup, query]);

  // ESC closes drawer
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const positionStyle: React.CSSProperties = taskbarPos === 'top'
    ? { top: taskbarH + 4, left: 8 }
    : { bottom: taskbarH + 4, left: 8 };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        ...positionStyle,
        width: DRAWER_WIDTH,
        height: DRAWER_HEIGHT,
        background: 'var(--surface-raised, #1a3352)',
        border: '1px solid var(--border-default, rgba(195,204,214,0.12))',
        zIndex: 1010,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-subtle, rgba(195,204,214,0.08))',
        background: 'var(--surface-base, #22405f)',
      }}>
        <Shield style={{ width: 14, height: 14, color: 'var(--accent-silver-400, #c3ccd6)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary, #f0f4f9)', letterSpacing: '0.04em' }}>
          FlexOS
        </span>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-sunken, #0f2035)', padding: '4px 8px', marginLeft: 8 }}>
          <Search style={{ width: 11, height: 11, color: 'var(--text-muted, #8da0b3)', flexShrink: 0 }} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search modules…"
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: 11,
              color: 'var(--text-primary, #f0f4f9)',
            }}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <X style={{ width: 10, height: 10, color: 'var(--text-muted, #8da0b3)' }} />
            </button>
          )}
        </div>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <X style={{ width: 12, height: 12, color: 'var(--text-muted, #8da0b3)' }} />
        </button>
      </div>

      {/* Category tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        overflowX: 'auto',
        borderBottom: '1px solid var(--border-subtle, rgba(195,204,214,0.08))',
        padding: '0 8px',
        scrollbarWidth: 'none',
      }}>
        {groupTabs.map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => { setActiveGroup(tab); setQuery(''); }}
            style={{
              padding: '6px 10px',
              fontSize: 9,
              fontWeight: activeGroup === tab ? 700 : 400,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: activeGroup === tab ? 'var(--text-primary, #f0f4f9)' : 'var(--text-muted, #8da0b3)',
              background: 'none',
              border: 'none',
              borderBottom: activeGroup === tab ? '2px solid var(--accent-silver-400, #c3ccd6)' : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {tab === 'Pinned' && <Star style={{ width: 9, height: 9 }} />}
            {tab}
          </button>
        ))}
      </div>

      {/* Quick actions — only when not searching */}
      {quickActions && quickActions.length > 0 && !query.trim() && (
        <div style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-subtle, rgba(195,204,214,0.08))',
          flexWrap: 'wrap',
        }}>
          {quickActions.map(qa => (
            <button
              key={qa.key}
              type="button"
              onClick={() => { qa.onClick(); onClose(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 500,
                background: 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.15)',
                border: '1px solid rgba(195,204,214,0.1)',
                color: 'var(--text-secondary, #adbccc)',
                cursor: 'pointer',
                letterSpacing: '0.02em',
              }}
            >
              <qa.icon style={{ width: 11, height: 11, flexShrink: 0 }} />
              {qa.label}
            </button>
          ))}
        </div>
      )}

      {/* App grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {displayItems.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 11, color: 'var(--text-muted, #8da0b3)' }}>
            {query ? `No results for "${query}"` : 'No modules in this category'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
            {displayItems.map(fn => (
              <AppTile key={fn.path} fn={fn} onNavigate={onNavigate} onClose={onClose} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 12px',
        borderTop: '1px solid var(--border-subtle, rgba(195,204,214,0.08))',
        fontSize: 9,
        color: 'var(--text-muted, #8da0b3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        <span>Rocky Mountain Protective Group — FlexOS</span>
        <span>{displayItems.length} module{displayItems.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

function AppTile({ fn, onNavigate, onClose }: { fn: NavFunction; onNavigate: (p: string) => void; onClose: () => void }) {
  const Icon = fn.icon;
  const [, rerender] = useState(0);
  return (
    <ContextMenu items={[{
      label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
      onClick: () => { if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path); rerender(n => n + 1); },
    }]}>
    <button
      type="button"
      onClick={() => { onNavigate(fn.path); onClose(); }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '10px 4px 8px',
        background: 'transparent',
        border: '1px solid transparent',
        cursor: 'pointer',
        transition: 'background 120ms, border-color 120ms',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.15)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(195,204,214,0.1)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
      }}
      title={fn.label}
    >
      {Icon && <Icon style={{ width: 20, height: 20, color: 'var(--accent-silver-300, #d4dde6)', flexShrink: 0 }} />}
      <span style={{
        fontSize: 9,
        color: 'var(--text-secondary, #adbccc)',
        textAlign: 'center',
        lineHeight: 1.2,
        maxWidth: '100%',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      }}>
        {fn.label}
      </span>
    </button>
    </ContextMenu>
  );
}
