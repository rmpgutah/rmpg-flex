import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface SidebarNavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  group: string;
  shortcut?: string;
  adminOnly?: boolean;
  newWindow?: boolean;
  children?: {
    path: string;
    icon: React.ElementType;
    label: string;
    adminOnly?: boolean;
    newWindow?: boolean;
  }[];
  externalUrl?: string;
}

interface SidebarProps {
  items: SidebarNavItem[];
  isAdmin: boolean;
  isClientViewer: boolean;
  isContractManager: boolean;
  activeCallCount: number;
  emailUnreadCount: number;
  activeBOLOs: number;
}

const GROUP_LABELS: Record<string, string> = {
  ops: 'OPERATIONS',
  records: 'RECORDS & ENFORCEMENT',
  comms: 'COMMUNICATIONS',
  analysis: 'ANALYTICS & TOOLS',
  system: 'SYSTEM',
};

const STORAGE_KEY = 'rmpg_sidebar_collapsed';

export default function Sidebar({
  items,
  isAdmin,
  isClientViewer,
  isContractManager,
  activeCallCount,
  emailUnreadCount,
  activeBOLOs,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [expandedChildren, setExpandedChildren] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // localStorage unavailable
    }
  }, [collapsed]);

  const toggleCollapse = useCallback(() => setCollapsed(prev => !prev), []);

  const toggleChildren = useCallback((path: string) => {
    setExpandedChildren(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleItemClick = useCallback(
    (item: { path: string; newWindow?: boolean; externalUrl?: string }, hasChildren: boolean, parentPath?: string) => {
      if (hasChildren) {
        toggleChildren(item.path);
        return;
      }

      if (item.externalUrl) {
        const token = localStorage.getItem('rmpg_token') || '';
        window.open(`${item.externalUrl}${item.externalUrl.includes('?') ? '&' : '?'}token=${token}`, '_blank');
        return;
      }

      if (item.newWindow) {
        window.open(item.path, '_blank');
        return;
      }

      navigate(item.path);
    },
    [navigate, toggleChildren]
  );

  const isActive = useCallback(
    (path: string): boolean => {
      if (path === '/') return location.pathname === '/';
      return location.pathname === path || location.pathname.startsWith(path + '/');
    },
    [location.pathname]
  );

  // Filter items based on role
  const visibleItems = items.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  // Group items preserving insertion order
  const groupedItems: { group: string; items: SidebarNavItem[] }[] = [];
  const seenGroups = new Set<string>();
  for (const item of visibleItems) {
    if (!seenGroups.has(item.group)) {
      seenGroups.add(item.group);
      groupedItems.push({ group: item.group, items: [] });
    }
    groupedItems.find(g => g.group === item.group)!.items.push(item);
  }

  const getBadge = (item: SidebarNavItem): { count: number; pulse: boolean } | null => {
    if (item.path === '/communications' && emailUnreadCount > 0) {
      return { count: emailUnreadCount, pulse: false };
    }
    if (item.path === '/' && activeCallCount > 0) {
      return { count: activeCallCount, pulse: false };
    }
    if (item.path === '/bolos' && activeBOLOs > 0) {
      return { count: activeBOLOs, pulse: true };
    }
    return null;
  };

  const sidebarWidth = collapsed ? 52 : 220;

  return (
    <div
      className="flex flex-col flex-shrink-0 select-none"
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        transition: 'width 200ms ease, min-width 200ms ease',
        background: 'var(--surface-base)',
        borderRight: '1px solid var(--border-default)',
        overflow: 'hidden',
      }}
    >
      {/* Scrollable nav area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1" style={{ scrollbarWidth: 'thin' }}>
        {groupedItems.map((group, gi) => (
          <div key={group.group}>
            {gi > 0 && (
              <div
                className="mx-2 my-1"
                style={{ borderTop: '1px solid rgba(28,45,68,0.5)' }}
              />
            )}

            {!collapsed && (
              <div
                className="font-bold uppercase tracking-wider px-3 py-2"
                style={{ fontSize: 10, color: '#5a6e80' }}
              >
                {GROUP_LABELS[group.group] || group.group.toUpperCase()}
              </div>
            )}

            {group.items.map(item => {
              const active = isActive(item.path);
              const hasChildren = !!(item.children && item.children.length > 0);
              const childrenOpen = expandedChildren.has(item.path);
              const badge = getBadge(item);
              const Icon = item.icon;

              const visibleChildren = hasChildren
                ? item.children!.filter(c => !c.adminOnly || isAdmin)
                : [];

              return (
                <div key={item.path}>
                  <button
                    onClick={() => handleItemClick(item, hasChildren)}
                    title={collapsed ? `${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}` : undefined}
                    className="w-full flex items-center gap-2 relative"
                    style={{
                      height: 32,
                      paddingLeft: collapsed ? 0 : 12,
                      paddingRight: collapsed ? 0 : 8,
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      background: active ? 'rgba(26,90,158,0.15)' : 'transparent',
                      cursor: 'pointer',
                      border: 'none',
                      outline: 'none',
                      transition: 'background 120ms ease',
                    }}
                    onMouseEnter={e => {
                      if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = active ? 'rgba(26,90,158,0.15)' : 'transparent';
                    }}
                  >
                    {active && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 4,
                          bottom: 4,
                          width: 3,
                          borderRadius: '0 2px 2px 0',
                          background: '#3b8ad4',
                        }}
                      />
                    )}

                    <Icon
                      size={16}
                      style={{
                        color: active ? '#3b8ad4' : '#5a6e80',
                        flexShrink: 0,
                        transition: 'color 120ms ease',
                      }}
                    />

                    {!collapsed && (
                      <>
                        <span
                          className="truncate"
                          style={{
                            fontSize: 11,
                            color: active ? '#c9ddf0' : '#8a9bb0',
                            flex: 1,
                            textAlign: 'left',
                            transition: 'color 120ms ease',
                          }}
                        >
                          {item.label}
                        </span>

                        {item.shortcut && (
                          <span
                            style={{
                              fontSize: 9,
                              color: '#4a5568',
                              flexShrink: 0,
                              fontFamily: 'monospace',
                            }}
                          >
                            {item.shortcut}
                          </span>
                        )}

                        {hasChildren && (
                          <ChevronRight
                            size={12}
                            style={{
                              color: '#4a5568',
                              flexShrink: 0,
                              transition: 'transform 200ms ease',
                              transform: childrenOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                            }}
                          />
                        )}
                      </>
                    )}

                    {badge && (
                      <span
                        style={{
                          position: collapsed ? 'absolute' : 'relative',
                          top: collapsed ? 2 : undefined,
                          right: collapsed ? 4 : undefined,
                          minWidth: 16,
                          height: 16,
                          borderRadius: 8,
                          background: '#dc2626',
                          color: '#fff',
                          fontSize: 9,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 4px',
                          lineHeight: 1,
                          flexShrink: 0,
                          animation: badge.pulse ? 'pulse 2s infinite' : undefined,
                        }}
                      >
                        {badge.count}
                      </span>
                    )}
                  </button>

                  {hasChildren && childrenOpen && !collapsed && (
                    <div>
                      {visibleChildren.map(child => {
                        const childActive = isActive(child.path);
                        const ChildIcon = child.icon;

                        return (
                          <button
                            key={child.path}
                            onClick={() => handleItemClick(child, false)}
                            className="w-full flex items-center gap-2 relative"
                            style={{
                              height: 28,
                              paddingLeft: 24,
                              paddingRight: 8,
                              background: childActive ? 'rgba(26,90,158,0.12)' : 'transparent',
                              cursor: 'pointer',
                              border: 'none',
                              outline: 'none',
                              transition: 'background 120ms ease',
                            }}
                            onMouseEnter={e => {
                              if (!childActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = childActive ? 'rgba(26,90,158,0.12)' : 'transparent';
                            }}
                          >
                            {childActive && (
                              <div
                                style={{
                                  position: 'absolute',
                                  left: 0,
                                  top: 4,
                                  bottom: 4,
                                  width: 3,
                                  borderRadius: '0 2px 2px 0',
                                  background: '#3b8ad4',
                                }}
                              />
                            )}
                            <ChildIcon
                              size={14}
                              style={{
                                color: childActive ? '#3b8ad4' : '#5a6e80',
                                flexShrink: 0,
                              }}
                            />
                            <span
                              className="truncate"
                              style={{
                                fontSize: 10,
                                color: childActive ? '#c9ddf0' : '#7a8b9e',
                                textAlign: 'left',
                              }}
                            >
                              {child.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Collapse/Expand toggle */}
      <button
        onClick={toggleCollapse}
        className="flex items-center justify-center flex-shrink-0"
        style={{
          height: 32,
          background: 'var(--surface-raised)',
          borderTop: '1px solid var(--border-default)',
          borderLeft: 'none',
          borderRight: 'none',
          borderBottom: 'none',
          cursor: 'pointer',
          color: '#5a6e80',
          transition: 'color 120ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#8a9bb0'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#5a6e80'; }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </div>
  );
}
