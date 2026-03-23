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
        background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)',
        borderBottom: '1px solid #1e3048',
        flexShrink: 0,
      }}
    >
      {/* Blue accent at very top */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: 'linear-gradient(90deg, #0e3359, #1a5a9e, #0e3359)',
          zIndex: 1,
        }}
      />

      {/* Left — Hamburger + Logo + Title */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Hamburger */}
        <button type="button"
          onClick={onMenuOpen}
          className="flex items-center justify-center w-10 h-10"
          style={{ color: '#b0bcc8' }}
          aria-label="Open navigation"
        >
          <Menu style={{ width: 22, height: 22 }} />
        </button>

        {/* Back / Forward */}
        <button type="button"
          onClick={onNavBack}
          disabled={!canGoBack}
          className="flex items-center justify-center w-8 h-8"
          style={{ color: canGoBack ? '#b0bcc8' : '#3a4a5a', transition: 'color 0.15s' }}
          aria-label="Go back"
        >
          <ChevronLeft style={{ width: 18, height: 18 }} />
        </button>
        <button type="button"
          onClick={onNavForward}
          disabled={!canGoForward}
          className="flex items-center justify-center w-8 h-8"
          style={{ color: canGoForward ? '#b0bcc8' : '#3a4a5a', transition: 'color 0.15s' }}
          aria-label="Go forward"
        >
          <ChevronRight style={{ width: 18, height: 18 }} />
        </button>

        {/* Logo */}
        <RmpgLogo height={32} iconOnly />

        {/* Page title */}
        <div className="w-px h-5 mx-1" style={{ background: '#2a3e58' }} />
        <span
          className="text-[11px] font-mono font-bold tracking-wider text-rmpg-400 truncate"
        >
          {pageTitle.toUpperCase()}
        </span>
      </div>

      {/* Right — PANIC + Profile */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* PANIC Button */}
        <PanicButton latitude={gpsLatitude} longitude={gpsLongitude} />

        {/* Profile Avatar */}
        <button type="button"
          onClick={onProfileTap}
          className="flex items-center justify-center w-9 h-9"
        >
          {user?.profile_image ? (
            <img
              src={user.profile_image}
              alt={user.first_name}
              className="w-8 h-8 object-cover"
              style={{ border: '2px solid #3a5070' }}
            />
          ) : (
            <div
              className="w-8 h-8 flex items-center justify-center text-[10px] font-bold"
              style={{
                background: 'linear-gradient(135deg, #124070, #1a5a9e)',
                color: '#fff',
                border: '2px solid #3b8ad4',
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
