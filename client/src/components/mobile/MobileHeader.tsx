// ============================================================
// RMPG Flex — Mobile Header Bar
// Compact 48px header: Hamburger | Logo | Title | PANIC | Avatar
// Optimized for iPhone 17 Pro (393px width)
// ============================================================

import React from 'react';
import { Menu } from 'lucide-react';
import RmpgLogo from '../RmpgLogo';
import PanicButton from '../PanicButton';

interface MobileHeaderProps {
  pageTitle: string;
  onMenuOpen: () => void;
  user: {
    first_name: string;
    last_name: string;
    role: string;
    badge_number?: string;
    profile_image?: string;
  } | null;
  onProfileTap: () => void;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onNavBack?: () => void;
  onNavForward?: () => void;
}

export default function MobileHeader({
  pageTitle,
  onMenuOpen,
  user,
  onProfileTap,
  gpsLatitude,
  gpsLongitude,
}: MobileHeaderProps) {
  const initials = user
    ? `${(user.first_name || 'U')[0]}${(user.last_name || '')[0] || ''}`.toUpperCase()
    : 'U';

  return (
    <div
      className="flex items-center justify-between relative safe-px"
      style={{
        height: 48,
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'var(--surface-raised)',
        borderBottom: '1px solid var(--border-default)',
        flexShrink: 0,
      }}
    >
      {/* Gold accent at very top */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: 'linear-gradient(90deg, transparent, var(--brand-gold), transparent)',
          zIndex: 1,
        }}
      />

      {/* Left — Hamburger + Logo + Title */}
      <div className="flex items-center gap-1 min-w-0">
        {/* Hamburger */}
        <button type="button"
          onClick={onMenuOpen}
          className="flex items-center justify-center"
          style={{ width: 44, height: 44, color: '#aaaaaa' }}
          aria-label="Open navigation"
        >
          <Menu style={{ width: 20, height: 20 }} />
        </button>

        {/* Logo — compact on mobile */}
        <RmpgLogo height={26} iconOnly />

        {/* Page title */}
        <div className="w-px h-4 mx-0.5" style={{ background: 'var(--border-default)' }} />
        <span
          className="text-[12px] font-mono font-bold tracking-wider truncate"
          style={{ color: 'var(--brand-gold)', maxWidth: 'calc(100vw - 220px)' }}
        >
          {pageTitle.toUpperCase()}
        </span>
      </div>

      {/* Right — PANIC + Profile */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* PANIC Button */}
        <PanicButton latitude={gpsLatitude} longitude={gpsLongitude} />

        {/* Profile Avatar */}
        <button type="button"
          onClick={onProfileTap}
          className="flex items-center justify-center"
          style={{ width: 44, height: 44 }}
        >
          {user?.profile_image ? (
            <img
              src={user.profile_image}
              alt={user.first_name}
              className="w-8 h-8 object-cover"
              style={{ border: '2px solid var(--border-strong)' }}
            />
          ) : (
            <div
              className="w-8 h-8 flex items-center justify-center text-[10px] font-bold"
              style={{
                background: 'linear-gradient(135deg, #333333, #888888)',
                color: '#fff',
                border: '2px solid var(--border-strong)',
              }}
            >
              {initials}
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
