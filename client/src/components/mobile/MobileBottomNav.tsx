// ============================================================
// Mobile Bottom Navigation Bar
// 4 primary tabs + More drawer trigger
// Designed for one-handed use with 48dp+ touch targets
// ============================================================

import { useLocation, useNavigate } from 'react-router-dom';
import { Map, Radio, Bell, Menu, LayoutList } from 'lucide-react';

const NAV_ITEMS = [
  { id: 'map',      path: '/map',      icon: Map,        label: 'Map' },
  { id: 'calls',    path: '/dispatch',  icon: LayoutList, label: 'Calls' },
  { id: 'radio',    path: '/radio',     icon: Radio,      label: 'Radio' },
  { id: 'alerts',   path: '/notifications', icon: Bell,   label: 'Alerts' },
] as const;

interface MobileBottomNavProps {
  onMoreTap: () => void;
  unreadAlerts?: number;
}

export default function MobileBottomNav({ onMoreTap, unreadAlerts = 0 }: MobileBottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => location.pathname === path;

  // Check if current page is one of the 4 primary pages
  const isPrimaryPage = NAV_ITEMS.some(item => location.pathname === item.path);

  return (
    <nav
      style={{
        height: 56,
        background: 'linear-gradient(180deg, #141414 0%, #0a0a0a 100%)',
        borderTop: '1px solid #222222',
        display: 'flex',
        alignItems: 'stretch',
        zIndex: 50,
        flexShrink: 0,
        // Safe area inset for phones with gesture nav bars
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
              background: active ? 'rgba(136, 136, 136, 0.2)' : 'transparent',
              border: 'none',
              borderTop: active ? '2px solid #888888' : '2px solid transparent',
              cursor: 'pointer',
              position: 'relative',
              padding: 0,
              minWidth: 0,
              // Minimum 48dp touch target
              minHeight: 48,
            }}
          >
            <Icon
              size={22}
              style={{
                color: active ? '#999999' : '#666666',
                transition: 'color 0.15s',
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono, monospace)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: active ? '#999999' : '#666666',
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
                  top: 6,
                  right: '50%',
                  marginRight: -16,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  borderRadius: 8,
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
          background: !isPrimaryPage ? 'rgba(136, 136, 136, 0.2)' : 'transparent',
          border: 'none',
          borderTop: !isPrimaryPage ? '2px solid #888888' : '2px solid transparent',
          cursor: 'pointer',
          padding: 0,
          minWidth: 0,
          minHeight: 48,
        }}
      >
        <Menu
          size={22}
          style={{
            color: !isPrimaryPage ? '#999999' : '#666666',
            transition: 'color 0.15s',
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono, monospace)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: !isPrimaryPage ? '#999999' : '#666666',
            transition: 'color 0.15s',
          }}
        >
          More
        </span>
      </button>
    </nav>
  );
}
