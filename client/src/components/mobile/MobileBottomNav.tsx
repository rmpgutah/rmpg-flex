// ============================================================
// Mobile Bottom Navigation Bar
// 5 primary tabs: Dashboard, Map, Dispatch, Radio, More
// Designed for one-handed use with 48dp+ touch targets
// Optimized for iPhone 17 Pro (393×852, 34px bottom safe area)
// ============================================================

import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Map, Radio, Bell, Menu, LayoutList } from 'lucide-react';

const NAV_ITEMS = [
  { id: 'home',     path: '/',          icon: LayoutDashboard, label: 'Home' },
  { id: 'calls',    path: '/dispatch',  icon: LayoutList,      label: 'Dispatch' },
  { id: 'map',      path: '/map',       icon: Map,             label: 'Map' },
  { id: 'alerts',   path: '/notifications', icon: Bell,        label: 'Alerts' },
] as const;

interface MobileBottomNavProps {
  onMoreTap: () => void;
  unreadAlerts?: number;
}

export default function MobileBottomNav({ onMoreTap, unreadAlerts = 0 }: MobileBottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => location.pathname === path;

  // Check if current page is one of the primary pages
  const isPrimaryPage = NAV_ITEMS.some(item => location.pathname === item.path);

  return (
    <nav
      style={{
        background: 'var(--surface-raised)',
        borderTop: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'stretch',
        zIndex: 50,
        flexShrink: 0,
        /* 56px for the nav itself + safe area for home indicator */
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        WebkitTransform: 'translateZ(0)',
      }}
    >
      {NAV_ITEMS.map(item => {
        const active = isActive(item.path);
        const Icon = item.icon;
        return (
          <button type="button"
            key={item.id}
            onClick={() => navigate(item.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              background: active ? 'rgba(212, 160, 23, 0.1)' : 'transparent',
              border: 'none',
              borderTop: active ? '2px solid var(--brand-gold)' : '2px solid transparent',
              cursor: 'pointer',
              position: 'relative',
              padding: '6px 0',
              minWidth: 0,
              minHeight: 48,
            }}
          >
            <Icon
              size={22}
              style={{
                color: active ? 'var(--brand-gold)' : '#666666',
                transition: 'color 0.15s',
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: active ? 'var(--brand-gold)' : '#666666',
                transition: 'color 0.15s',
              }}
            >
              {item.label}
            </span>
            {/* Alert badge */}
            {item.id === 'alerts' && unreadAlerts > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  right: '50%',
                  marginRight: -16,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  borderRadius: 10,
                  minWidth: 16,
                  height: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                {unreadAlerts > 99 ? '99+' : unreadAlerts}
              </span>
            )}
          </button>
        );
      })}

      {/* More button */}
      <button type="button"
        onClick={onMoreTap}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          background: !isPrimaryPage ? 'rgba(212, 160, 23, 0.1)' : 'transparent',
          border: 'none',
          borderTop: !isPrimaryPage ? '2px solid var(--brand-gold)' : '2px solid transparent',
          cursor: 'pointer',
          padding: '6px 0',
          minWidth: 0,
          minHeight: 48,
        }}
      >
        <Menu
          size={22}
          style={{
            color: !isPrimaryPage ? 'var(--brand-gold)' : '#666666',
            transition: 'color 0.15s',
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: !isPrimaryPage ? 'var(--brand-gold)' : '#666666',
            transition: 'color 0.15s',
          }}
        >
          More
        </span>
      </button>
    </nav>
  );
}
