// ============================================================
// RMPG Flex — Mobile Header Bar
// Compact 48px header: Hamburger | Logo | Title | PANIC | Avatar
// Spillman Flex blue theme
// ============================================================

import React from 'react';
import { Menu, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
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
  canGoBack,
  canGoForward,
  onNavBack,
  onNavForward,
}: MobileHeaderProps) {
  const initials = user
    ? `${(user.first_name || 'U')[0]}${(user.last_name || '')[0] || ''}`.toUpperCase()
    : 'U';

  return (
    <div
      className="flex items-center justify-between relative"
      style={{
        height: 48,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)',
        borderBottom: '1px solid #1e3048',
        flexShrink: 0,
        WebkitBackdropFilter: 'blur(8px)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Blue accent at very top */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: 'linear-gradient(90deg, #1a1a1a, #888888, #1a1a1a)',
          zIndex: 1,
        }}
      />

      {/* Left — Hamburger + Logo + Title */}
      <div className="flex items-center gap-1 min-w-0">
        {/* Hamburger */}
        <button type="button"
          onClick={onMenuOpen}
          className="flex items-center justify-center w-11 h-11"
          style={{ color: '#aaaaaa' }}
          aria-label="Open navigation"
        >
          <Menu style={{ width: 20, height: 20 }} />
        </button>

        {/* Back / Forward — tighter on mobile */}
        <button type="button"
          onClick={onNavBack}
          disabled={!canGoBack}
          className="flex items-center justify-center w-9 h-11"
          style={{ color: canGoBack ? '#aaaaaa' : '#3a3a3a', transition: 'color 0.15s' }}
          aria-label="Go back"
        >
          <ChevronLeft style={{ width: 16, height: 16 }} />
        </button>
        <button type="button"
          onClick={onNavForward}
          disabled={!canGoForward}
          className="flex items-center justify-center w-9 h-11"
          style={{ color: canGoForward ? '#aaaaaa' : '#3a3a3a', transition: 'color 0.15s' }}
          aria-label="Go forward"
        >
          <ChevronRight style={{ width: 16, height: 16 }} />
        </button>

        {/* Logo — slightly smaller on mobile */}
        <RmpgLogo height={28} iconOnly />

        {/* Page title */}
        <div className="w-px h-4 mx-0.5" style={{ background: '#2e2e2e' }} />
        <span
          className="text-[10px] sm:text-[11px] font-mono font-bold tracking-wider text-rmpg-400 truncate"
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
          className="flex items-center justify-center w-11 h-11"
        >
          {user?.profile_image ? (
            <img
              src={user.profile_image}
              alt={user.first_name}
              className="w-7 h-7 sm:w-8 sm:h-8 object-cover"
              style={{ border: '2px solid #3a5070' }}
            />
          ) : (
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-[10px] font-bold"
              style={{
                background: 'linear-gradient(135deg, #333333, #888888)',
                color: '#fff',
                border: '2px solid #aaaaaa',
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
