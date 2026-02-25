// ============================================================
// RMPG Flex — Mobile Navigation Drawer
// Polished slide-in drawer with swipe gestures, grouped nav,
// status indicators, and retro CAD aesthetic
// ============================================================

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Radio,
  Map,
  FileText,
  Database,
  Users,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
  QrCode,
  ScrollText,
  Car,
  AlertTriangle,
  FileWarning,
  Navigation2,
  Wifi,
  WifiOff,
  X,
  Shield,
  ChevronRight,
} from 'lucide-react';
import RmpgLogo from '../RmpgLogo';

// ─── Types ───────────────────────────────────────────────────

interface NavChild {
  path: string;
  icon: React.ElementType;
  label: string;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavChild[];
}

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    first_name: string;
    last_name: string;
    role: string;
    badge_number?: string;
    profile_image?: string;
    email?: string;
  } | null;
  isAdmin: boolean;
  isConnected: boolean;
  gpsTracking?: boolean;
  gpsAccuracy?: number | null;
  onlineCount?: number;
  onLogout: () => void;
}

// ─── Navigation Structure ────────────────────────────────────
// Grouped for the drawer — flat list, no nested dropdowns

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/dispatch', icon: Radio, label: 'Dispatch' },
      { path: '/map', icon: Map, label: 'Map' },
    ],
  },
  {
    label: 'Records',
    items: [
      { path: '/incidents', icon: FileText, label: 'Incidents' },
      { path: '/records', icon: Database, label: 'Records' },
      { path: '/warrants', icon: AlertTriangle, label: 'Warrants' },
      { path: '/citations', icon: FileWarning, label: 'Citations' },
    ],
  },
  {
    label: 'Personnel',
    items: [
      { path: '/personnel', icon: Users, label: 'Personnel' },
      { path: '/fleet', icon: Car, label: 'Fleet' },
    ],
  },
  {
    label: 'Communications',
    items: [
      { path: '/communications', icon: MessageSquare, label: 'Comms' },
      { path: '/patrol', icon: QrCode, label: 'Patrol' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { path: '/reports', icon: BarChart3, label: 'Reports' },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/audit', icon: ScrollText, label: 'Audit Log', adminOnly: true },
      { path: '/admin', icon: Settings, label: 'Admin', adminOnly: true },
    ],
  },
];

// ─── Component ───────────────────────────────────────────────

export default function MobileDrawer({
  isOpen,
  onClose,
  user,
  isAdmin,
  isConnected,
  gpsTracking,
  gpsAccuracy,
  onlineCount = 0,
  onLogout,
}: MobileDrawerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const drawerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchCurrentX = useRef(0);
  const isDragging = useRef(false);

  // Close on route change
  useEffect(() => {
    if (isOpen) onClose();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  // ─── Swipe-to-close ────────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchCurrentX.current = e.touches[0].clientX;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    touchCurrentX.current = e.touches[0].clientX;
    const delta = touchCurrentX.current - touchStartX.current;
    // Only allow swiping left (to close)
    if (delta < 0 && drawerRef.current) {
      drawerRef.current.style.transform = `translateX(${delta}px)`;
      drawerRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const delta = touchCurrentX.current - touchStartX.current;
    if (drawerRef.current) {
      drawerRef.current.style.transition = '';
      drawerRef.current.style.transform = '';
    }
    // If swiped left more than 80px, close
    if (delta < -80) {
      onClose();
    }
  }, [onClose]);

  // Nav item click
  const handleNav = useCallback((path: string) => {
    navigate(path);
    // onClose happens via the location.pathname effect
  }, [navigate]);

  const initials = user
    ? `${(user.first_name || 'U')[0]}${(user.last_name || '')[0] || ''}`.toUpperCase()
    : 'U';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 mobile-drawer-backdrop"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        className="absolute top-0 left-0 bottom-0 mobile-drawer"
        style={{ width: 'min(85vw, 320px)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Crimson accent */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: 'linear-gradient(90deg, #bc1010, #6e0a0a)' }}
        />

        {/* ── User Header ── */}
        <div
          className="flex items-center gap-3 px-4 py-4"
          style={{
            background: 'linear-gradient(180deg, #1e1e1e 0%, #1a1a1a 100%)',
            borderBottom: '1px solid #303030',
          }}
        >
          {/* Avatar */}
          {user?.profile_image ? (
            <img
              src={user.profile_image}
              alt={user.first_name}
              className="w-11 h-11 object-cover flex-shrink-0"
              style={{ border: '2px solid #484848' }}
            />
          ) : (
            <div
              className="w-11 h-11 flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #8a0c0c, #bc1010)',
                color: '#fff',
                border: '2px solid #d93030',
              }}
            >
              {initials}
            </div>
          )}

          {/* Name & Info */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">
              {user?.first_name} {user?.last_name}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {user?.badge_number && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-surface-overlay text-rmpg-300 border border-rmpg-700">
                  {user.badge_number}
                </span>
              )}
              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 bg-brand-900/20 text-brand-300 border border-brand-800/40">
                {user?.role}
              </span>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 text-rmpg-400"
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* ── Navigation Groups ── */}
        <div className="flex-1 overflow-y-auto py-2" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.adminOnly || isAdmin,
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label} className="mb-1">
                {/* Group label */}
                <div
                  className="px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em] font-mono"
                  style={{ color: '#585858' }}
                >
                  {group.label}
                </div>

                {/* Group items */}
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.path === '/'
                      ? location.pathname === '/'
                      : location.pathname.startsWith(item.path);

                  return (
                    <button
                      key={item.path}
                      onClick={() => handleNav(item.path)}
                      className="w-full flex items-center gap-3 px-4 text-left transition-colors"
                      style={{
                        minHeight: 48,
                        background: isActive
                          ? 'rgba(188, 16, 16, 0.15)'
                          : 'transparent',
                        color: isActive ? '#fff' : '#c8c8c8',
                        borderLeft: isActive
                          ? '3px solid #bc1010'
                          : '3px solid transparent',
                      }}
                    >
                      <Icon
                        style={{ width: 20, height: 20, flexShrink: 0 }}
                        className={isActive ? 'text-brand-400' : 'text-rmpg-500'}
                      />
                      <span className="text-sm font-medium">{item.label}</span>
                      {isActive && (
                        <ChevronRight
                          style={{ width: 14, height: 14, marginLeft: 'auto' }}
                          className="text-brand-500"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── Status Footer ── */}
        <div
          className="border-t border-rmpg-700 px-4 py-3"
          style={{ background: '#141414' }}
        >
          {/* Status indicators row */}
          <div className="flex items-center gap-3 mb-3">
            {/* GPS */}
            <div className="flex items-center gap-1.5">
              <Navigation2
                style={{
                  width: 14,
                  height: 14,
                  color: gpsTracking ? '#22c55e' : '#505050',
                }}
              />
              <span
                className="text-[10px] font-mono font-bold"
                style={{ color: gpsTracking ? '#22c55e' : '#505050' }}
              >
                GPS {gpsTracking ? 'ON' : 'OFF'}
              </span>
              {gpsTracking && gpsAccuracy != null && (
                <span className="text-[9px] font-mono text-rmpg-400">
                  ±{Math.round(gpsAccuracy)}m
                </span>
              )}
            </div>

            {/* Divider */}
            <div className="w-px h-4" style={{ background: '#303030' }} />

            {/* WebSocket */}
            <div className="flex items-center gap-1.5">
              <span
                className={`led-dot ${isConnected ? 'led-green' : 'led-red animate-led-blink'}`}
              />
              <span
                className="text-[10px] font-mono font-bold"
                style={{ color: isConnected ? '#22c55e' : '#ef4444' }}
              >
                {isConnected ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>

            {/* Divider */}
            <div className="w-px h-4" style={{ background: '#303030' }} />

            {/* Users online */}
            <div className="flex items-center gap-1.5">
              <Users
                style={{ width: 12, height: 12 }}
                className="text-rmpg-500"
              />
              <span className="text-[10px] font-mono font-bold text-rmpg-300">
                {onlineCount}
              </span>
            </div>
          </div>

          {/* Sign Out */}
          <button
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="w-full flex items-center justify-center gap-2 py-3 transition-colors"
            style={{
              background: 'rgba(188, 16, 16, 0.1)',
              border: '1px solid rgba(188, 16, 16, 0.3)',
              color: '#d93030',
            }}
          >
            <LogOut style={{ width: 16, height: 16 }} />
            <span className="text-sm font-bold uppercase tracking-wide">
              Sign Out
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
