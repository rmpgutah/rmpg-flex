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
        height: 56,
        paddingLeft: 8,
        paddingRight: 8,
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
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Hamburger */}
        <button type="button"
          onClick={onMenuOpen}
          className="flex items-center justify-center"
          style={{ width: 48, height: 48, color: '#aaaaaa' }}
          aria-label="Open navigation"
        >
          <Menu style={{ width: 22, height: 22 }} />
        </button>

        {/* Back / Forward */}
        <button type="button"
          onClick={onNavBack}
          disabled={!canGoBack}
          className="flex items-center justify-center"
          style={{ width: 40, height: 48, color: canGoBack ? '#aaaaaa' : '#3a3a3a', transition: 'color 0.15s' }}
          aria-label="Go back"
        >
          <ChevronLeft style={{ width: 18, height: 18 }} />
        </button>
        <button type="button"
          onClick={onNavForward}
          disabled={!canGoForward}
          className="flex items-center justify-center"
          style={{ width: 40, height: 48, color: canGoForward ? '#aaaaaa' : '#3a3a3a', transition: 'color 0.15s' }}
          aria-label="Go forward"
        >
          <ChevronRight style={{ width: 18, height: 18 }} />
        </button>

        {/* Logo — slightly smaller on mobile */}
        <RmpgLogo height={30} iconOnly />

        {/* Page title */}
        <div className="w-px h-5 mx-1" style={{ background: 'var(--border-default)' }} />
        <span
          className="text-[13px] font-mono font-bold tracking-wider truncate"
          style={{ color: 'var(--brand-gold)' }}
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
          className="flex items-center justify-center"
          style={{ width: 48, height: 48 }}
        >
          {user?.profile_image ? (
            <img
              src={user.profile_image}
              alt={user.first_name}
              className="w-9 h-9 object-cover"
              style={{ border: '2px solid var(--border-strong)' }}
            />
          ) : (
            <div
              className="w-9 h-9 flex items-center justify-center text-[11px] font-bold"
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
