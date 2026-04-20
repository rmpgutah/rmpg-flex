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
  Briefcase,
  Package,
  TrendingUp,
  Construction,
  Gavel,
  ClipboardCheck,
  UserX,
  Wifi,
  WifiOff,
  X,
  Shield,
  ChevronRight,
  Terminal,
  Monitor,
  Search,
  ClipboardList,
  Calendar,
  ShieldBan,
  UserCog,
  Video,
  Camera,
  IdCard,
  Crosshair,
  UserSearch,
  ShieldAlert,
  Microscope,
  BookOpen,
  Scale,
  Contact,
  Siren,
} from 'lucide-react';
import RmpgLogo from '../RmpgLogo';
import { toDisplayLabel } from '../../utils/formatters';

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
      { path: '/mdt', icon: Monitor, label: 'MDT' },
      { path: '/ncic', icon: Terminal, label: 'NCIC' },
      { path: '/body-cameras', icon: Video, label: 'Body Cameras' },
      { path: '/dash-cameras', icon: Camera, label: 'Dash Cameras' },
    ],
  },
  {
    label: 'Records',
    items: [
      { path: '/incidents', icon: FileText, label: 'Incidents' },
      { path: '/records', icon: Database, label: 'Records' },
      { path: '/field-interviews', icon: ClipboardList, label: 'Field Interviews' },
      { path: '/criminal-history', icon: Search, label: 'Criminal History' },
      { path: '/arrest-records', icon: Siren, label: 'Arrest Records' },
      { path: '/evidence', icon: Package, label: 'Evidence / Property' },
      { path: '/cases', icon: Briefcase, label: 'Cases' },
      { path: '/dl-search', icon: IdCard, label: 'DL Search' },
      { path: '/microbilt', icon: Crosshair, label: 'MicroBilt' },
    ],
  },
  {
    label: 'Enforcement',
    items: [
      { path: '/serve', icon: Briefcase, label: 'Process Server' },
      { path: '/warrants', icon: AlertTriangle, label: 'Warrants' },
      { path: '/citations', icon: FileWarning, label: 'Citations' },
      { path: '/trespass-orders', icon: ShieldBan, label: 'Trespass Orders' },
      { path: '/code-enforcement', icon: Construction, label: 'Code Enforcement' },
      { path: '/court', icon: Gavel, label: 'Court Tracker' },
      { path: '/offender-registry', icon: UserX, label: 'Offender Registry' },
      { path: '/sex-offender-registry', icon: ShieldAlert, label: 'Sex Offender Registry' },
    ],
  },
  {
    label: 'Personnel',
    items: [
      { path: '/personnel', icon: Users, label: 'Personnel' },
      { path: '/hr', icon: UserCog, label: 'HR Console' },
      { path: '/fleet', icon: Car, label: 'Fleet' },
    ],
  },
  {
    label: 'Communications',
    items: [
      { path: '/email', icon: MessageSquare, label: 'Email' },
      { path: '/communications', icon: MessageSquare, label: 'Comms' },
      { path: '/radio', icon: Radio, label: 'Radio' },
      { path: '/patrol', icon: QrCode, label: 'Patrol' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { path: '/reports', icon: BarChart3, label: 'Reports' },
      { path: '/shift-plans', icon: Calendar, label: 'Shift Plans' },
      { path: '/crime-analysis', icon: TrendingUp, label: 'Crime Analysis' },
      { path: '/dar', icon: ClipboardCheck, label: 'Daily Activity' },
      { path: '/forensic-lab', icon: Microscope, label: 'Forensic Lab' },
      { path: '/forensics', icon: Search, label: 'Forensics' },
      { path: '/training', icon: ClipboardCheck, label: 'Training' },
      { path: '/training-docs', icon: BookOpen, label: 'Training Docs' },
      { path: '/statute-analytics', icon: Scale, label: 'Statute Analytics' },
      { path: '/crm', icon: Contact, label: 'CRM' },
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

// Paths blocked for client_viewer role
const CLIENT_VIEWER_BLOCKED_PATHS = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/radio', '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar', '/hr',
  '/body-cameras', '/dash-cameras', '/dl-search', '/skip-tracer',
  '/arrest-records', '/forensic-lab', '/forensics', '/training-docs',
]);

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

  // Android hardware back button — close drawer on back press
  useEffect(() => {
    if (!isOpen) return;
    const handlePopState = () => { onClose(); };
    window.history.pushState({ mobileDrawer: true }, '');
    window.addEventListener('popstate', handlePopState);
    return () => { window.removeEventListener('popstate', handlePopState); };
  }, [isOpen, onClose]);

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
        className="absolute inset-0 mobile-drawer-backdrop open"
        onClick={onClose}
        style={{ touchAction: 'manipulation' }}
      />

      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        className="absolute top-0 left-0 bottom-0 mobile-drawer open safe-px safe-pt safe-pb"
        style={{ width: 'min(85vw, 340px)', willChange: 'transform' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Gold accent */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: 'linear-gradient(90deg, var(--brand-gold), transparent)' }}
        />

        {/* ── User Header ── */}
        <div
          className="flex items-center gap-3 px-4 py-5"
          style={{
            background: 'var(--surface-raised)',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          {/* Avatar */}
          {user?.profile_image ? (
            <img
              src={user.profile_image}
              alt={user.first_name}
              className="w-12 h-12 object-cover flex-shrink-0"
              style={{ border: '2px solid var(--border-strong)' }}
            />
          ) : (
            <div
              className="w-12 h-12 flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #333333, #888888)',
                color: '#fff',
                border: '2px solid var(--border-strong)',
              }}
            >
              {initials}
            </div>
          )}

          {/* Name & Info */}
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-white truncate">
              {user?.first_name} {user?.last_name}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {user?.badge_number && (
                <span className="text-xs font-mono px-2 py-0.5 bg-surface-overlay text-rmpg-300 border border-rmpg-700">
                  {user.badge_number}
                </span>
              )}
              <span className="text-xs font-mono uppercase px-2 py-0.5" style={{ background: 'rgba(212, 160, 23, 0.1)', color: 'var(--brand-gold)', border: '1px solid rgba(212, 160, 23, 0.25)' }}>
                {toDisplayLabel(user?.role || '')}
              </span>
            </div>
          </div>

          {/* Close button */}
          <button type="button"
            onClick={onClose}
            className="flex items-center justify-center text-rmpg-400"
            style={{ width: 48, height: 48 }}
            aria-label="Close navigation drawer"
          >
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {/* ── Navigation Groups ── */}
        <div className="flex-1 overflow-y-auto py-3" style={{ maxHeight: 'calc(100dvh - 220px)' }}>
          {NAV_GROUPS.map((group) => {
            const isClientViewer = user?.role === 'client_viewer';
            const visibleItems = group.items.filter((item) => {
              if (item.adminOnly && !isAdmin) return false;
              if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(item.path)) return false;
              return true;
            });
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label} className="mb-2">
                {/* Group label */}
                <div
                  className="px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] font-mono"
                  style={{ color: 'var(--brand-gold)', opacity: 0.7 }}
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
                    <button type="button"
                      key={item.path}
                      onClick={() => handleNav(item.path)}
                      className="w-full flex items-center gap-3 px-4 text-left transition-colors"
                      style={{
                        minHeight: 52,
                        background: isActive
                          ? 'rgba(212, 160, 23, 0.1)'
                          : 'transparent',
                        color: isActive ? '#fff' : '#bbbbbb',
                        borderLeft: isActive
                          ? '3px solid var(--brand-gold)'
                          : '3px solid transparent',
                      }}
                    >
                      <Icon
                        style={{ width: 22, height: 22, flexShrink: 0 }}
                        className={isActive ? 'text-brand-gold-500' : 'text-rmpg-400'}
                      />
                      <span className="text-[15px] font-medium">{item.label}</span>
                      {isActive && (
                        <ChevronRight
                          style={{ width: 16, height: 16, marginLeft: 'auto', color: 'var(--brand-gold)' }}
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
          className="border-t px-4 py-4"
          style={{ borderColor: 'var(--border-default)', background: '#050505' }}
        >
          {/* Status indicators row */}
          <div className="flex items-center gap-4 mb-4">
            {/* GPS */}
            <div className="flex items-center gap-1.5">
              <Navigation2
                style={{
                  width: 16,
                  height: 16,
                  color: gpsTracking ? '#22c55e' : '#505050',
                }}
              />
              <span
                className="text-xs font-mono font-bold"
                style={{ color: gpsTracking ? '#22c55e' : '#505050' }}
              >
                GPS {gpsTracking ? 'ON' : 'OFF'}
              </span>
              {gpsTracking && gpsAccuracy != null && (
                <span className="text-xs font-mono text-rmpg-400">
                  ±{Math.round(gpsAccuracy)}m
                </span>
              )}
            </div>

            {/* Divider */}
            <div className="w-px h-4" style={{ background: 'var(--border-default)' }} />

            {/* WebSocket */}
            <div className="flex items-center gap-1.5">
              <span
                className={`led-dot ${isConnected ? 'led-green' : 'led-red animate-led-blink'}`}
              />
              <span
                className="text-xs font-mono font-bold"
                style={{ color: isConnected ? '#22c55e' : '#ef4444' }}
              >
                {isConnected ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>

            {/* Divider */}
            <div className="w-px h-4" style={{ background: 'var(--border-default)' }} />

            {/* Users online */}
            <div className="flex items-center gap-1.5">
              <Users
                style={{ width: 14, height: 14 }}
                className="text-rmpg-500"
              />
              <span className="text-xs font-mono font-bold text-rmpg-300">
                {onlineCount}
              </span>
            </div>
          </div>

          {/* Sign Out */}
          <button type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="w-full flex items-center justify-center gap-2 transition-colors"
            style={{
              minHeight: 48,
              background: 'rgba(220, 38, 38, 0.1)',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              color: '#ef4444',
            }}
          >
            <LogOut style={{ width: 18, height: 18 }} />
            <span className="text-sm font-bold uppercase tracking-wide">
              Sign Out
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
