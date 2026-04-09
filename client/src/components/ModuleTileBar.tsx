import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

// ---------- Types (mirrored from Layout.tsx, not exported there) ----------
interface NavChild {
  path: string;
  icon: React.ElementType;
  label: string;
  adminOnly?: boolean;
  newWindow?: boolean;
}

interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  group: string;
  shortcut?: string;
  adminOnly?: boolean;
  newWindow?: boolean;
  children?: NavChild[];
  externalUrl?: string;
}

interface ModuleTileBarProps {
  items: NavItem[];
  isAdmin: boolean;
  isClientViewer: boolean;
  isContractManager: boolean;
  activeCallCount: number;
  emailUnreadCount: number;
  activeBOLOs: number;
}

// ---------- Role-blocked paths ----------
const CLIENT_VIEWER_BLOCKED = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic', '/radio',
  '/patrol', '/shift-plans', '/statute-analytics', '/reports/custom',
  '/crime-analysis', '/dar',
]);

const CONTRACT_MANAGER_BLOCKED = new Set(['/admin', '/personnel', '/users']);

// ---------- Component ----------
export default function ModuleTileBar({
  items,
  isAdmin,
  isClientViewer,
  isContractManager,
  activeCallCount,
  emailUnreadCount,
  activeBOLOs,
}: ModuleTileBarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // --- Helpers ---
  const isActive = useCallback(
    (item: NavItem) => {
      if (location.pathname === item.path) return true;
      if (item.path !== '/' && location.pathname.startsWith(item.path + '/')) return true;
      if (item.children?.some((c) => location.pathname === c.path || location.pathname.startsWith(c.path + '/'))) return true;
      return false;
    },
    [location.pathname],
  );

  const handleNavigate = useCallback(
    (path: string, newWindow?: boolean, externalUrl?: string) => {
      if (externalUrl) {
        // Don't embed JWT token in external URLs — external sites don't need our auth token
        window.open(externalUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      if (newWindow) {
        window.open(window.location.origin + path, '_blank', 'noopener,noreferrer');
        return;
      }
      navigate(path);
    },
    [navigate],
  );

  const shouldShow = useCallback(
    (path: string, adminOnly?: boolean) => {
      if (adminOnly && !isAdmin) return false;
      if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(path)) return false;
      if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(path)) return false;
      return true;
    },
    [isAdmin, isClientViewer, isContractManager],
  );

  // --- Dropdown open / close ---
  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setOpenDropdown(null), 200);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // --- Badge helper ---
  const badgeFor = (item: NavItem): number | null => {
    if (item.path === '/' && activeCallCount > 0) return activeCallCount;
    if (item.path === '/communications') {
      const total = (emailUnreadCount || 0) + (activeBOLOs || 0);
      if (total > 0) return total;
    }
    return null;
  };

  // --- Filter items ---
  const visibleItems = items.filter((it) => shouldShow(it.path, it.adminOnly));

  return (
    <div
      className="flex items-center gap-1 px-3 shrink-0 relative"
      style={{
        height: 58,
        background: 'linear-gradient(180deg, #0f1722 0%, #050505 100%)',
        borderBottom: '1px solid #1c2d44',
        zIndex: 40,
      }}
    >
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        const badge = badgeFor(item);
        const hasChildren = item.children && item.children.length > 0;
        const isOpen = openDropdown === item.path;

        // Filter children by role
        const visibleChildren = item.children?.filter((c) => shouldShow(c.path, c.adminOnly)) ?? [];

        return (
          <div
            key={item.path}
            className="relative"
            ref={isOpen ? dropdownRef : undefined}
            onMouseEnter={() => {
              cancelClose();
              if (hasChildren) setOpenDropdown(item.path);
            }}
            onMouseLeave={scheduleClose}
          >
            {/* Tile */}
            <button
              type="button"
              tabIndex={0}
              aria-haspopup={hasChildren && visibleChildren.length > 0 ? 'true' : undefined}
              aria-expanded={hasChildren && visibleChildren.length > 0 ? isOpen : undefined}
              title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
              onClick={() => {
                if (hasChildren && visibleChildren.length > 0) {
                  setOpenDropdown(isOpen ? null : item.path);
                } else {
                  handleNavigate(item.path, item.newWindow, item.externalUrl);
                  setOpenDropdown(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (hasChildren && visibleChildren.length > 0) {
                    setOpenDropdown(isOpen ? null : item.path);
                  } else {
                    handleNavigate(item.path, item.newWindow, item.externalUrl);
                    setOpenDropdown(null);
                  }
                } else if (e.key === 'Escape' && isOpen) {
                  setOpenDropdown(null);
                }
              }}
              className="flex flex-col items-center justify-center relative select-none"
              style={{
                minWidth: 72,
                height: 50,
                padding: '0 6px',
                borderRadius: 0,
                cursor: 'pointer',
                transition: 'all 120ms ease',
                background: active ? 'rgba(136,136,136,0.15)' : 'transparent',
                color: active ? '#aaaaaa' : '#666666',
                borderBottom: active ? '2px solid #888888' : '2px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(136,136,136,0.08)';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 8px rgba(136,136,136,0.15)';
                  (e.currentTarget as HTMLButtonElement).style.color = '#999999';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                  (e.currentTarget as HTMLButtonElement).style.color = '#666666';
                }
              }}
            >
              <Icon size={18} />
              <span
                className="flex items-center gap-[2px] whitespace-nowrap"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginTop: 3,
                  lineHeight: 1,
                }}
              >
                {item.label}
                {hasChildren && visibleChildren.length > 0 && <ChevronDown size={10} />}
              </span>

              {/* Badge */}
              {badge != null && (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 4,
                    minWidth: 14,
                    height: 14,
                    fontSize: 7,
                    fontWeight: 700,
                    lineHeight: '14px',
                    textAlign: 'center',
                    borderRadius: 7,
                    background: '#dc2626',
                    color: '#fff',
                    padding: '0 3px',
                  }}
                >
                  {badge}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {isOpen && visibleChildren.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  zIndex: 50,
                  minWidth: 180,
                  background: 'var(--surface-raised, #0a0a0a)',
                  border: '1px solid var(--border-default, #1c2d44)',
                  borderTop: '2px solid #888888',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
                  padding: '4px 0',
                }}
              >
                {visibleChildren.map((child) => {
                  const CIcon = child.icon;
                  const childActive = location.pathname === child.path || location.pathname.startsWith(child.path + '/');

                  return (
                    <button
                      key={child.path}
                      type="button"
                      onClick={() => {
                        handleNavigate(child.path, child.newWindow);
                        setOpenDropdown(null);
                      }}
                      className="flex items-center gap-2 w-full text-left"
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        color: childActive ? '#aaaaaa' : '#999999',
                        background: 'transparent',
                        borderLeft: childActive ? '2px solid #888888' : '2px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 120ms ease',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(136,136,136,0.12)';
                        (e.currentTarget as HTMLButtonElement).style.color = '#aaaaaa';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                        (e.currentTarget as HTMLButtonElement).style.color = childActive ? '#aaaaaa' : '#999999';
                      }}
                    >
                      <CIcon size={14} />
                      <span>{child.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
