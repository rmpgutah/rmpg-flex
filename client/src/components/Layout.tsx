import React, { useEffect, useCallback, useState, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  Phone,
  QrCode,
  ScrollText,
  Search,
  Car,
  AlertTriangle,
  FileWarning,
  User,
  Lock,
  ChevronDown,
  Shield,
  Menu,
  X,
} from 'lucide-react';
import { Navigation2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { apiFetch } from '../hooks/useApi';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { usePresence } from '../hooks/usePresence';
import RmpgLogo from './RmpgLogo';
import StatusBar from './StatusBar';
import MenuBar from './MenuBar';
import ErrorBoundary from './ErrorBoundary';
import NotificationCenter from './NotificationCenter';
import PanicButton from './PanicButton';
import UserProfileModal from './UserProfileModal';
import UpdateBanner from './UpdateBanner';
import MobileHeader from './mobile/MobileHeader';
import MobileDrawer from './mobile/MobileDrawer';
import { useIsMobile } from '../hooks/useIsMobile';
// LocationGate removed — GPS tracking runs silently per employment agreement

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/dispatch': 'Dispatch',
  '/map': 'Map',
  '/incidents': 'Incidents',
  '/records': 'Records',
  '/personnel': 'Personnel',
  '/communications': 'Communications',
  '/patrol': 'Patrol',
  '/fleet': 'Fleet',
  '/warrants': 'Warrants',
  '/citations': 'Citations',
  '/reports': 'Reports',
  '/audit': 'Audit Log',
  '/admin': 'Admin',
};

// Nav items — items with `children` render a dropdown menu in the toolbar
interface NavChild { path: string; icon: React.ElementType; label: string; adminOnly?: boolean }
interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  group: string;
  adminOnly?: boolean;
  children?: NavChild[];
}

const TOOLBAR_NAV: NavItem[] = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', group: 'ops' },
  { path: '/dispatch', icon: Radio, label: 'Dispatch', group: 'ops' },
  { path: '/map', icon: Map, label: 'Map', group: 'ops' },
  { path: '/records', icon: Database, label: 'Records', group: 'records', children: [
    { path: '/incidents', icon: FileText, label: 'Incidents' },
    { path: '/records', icon: Database, label: 'Records' },
    { path: '/warrants', icon: AlertTriangle, label: 'Warrants' },
    { path: '/citations', icon: FileWarning, label: 'Citations' },
  ]},
  { path: '/personnel', icon: Users, label: 'Personnel', group: 'records', children: [
    { path: '/personnel', icon: Users, label: 'Personnel' },
    { path: '/fleet', icon: Car, label: 'Fleet' },
  ]},
  { path: '/communications', icon: MessageSquare, label: 'Comms', group: 'comms', children: [
    { path: '/communications', icon: MessageSquare, label: 'Comms' },
    { path: '/patrol', icon: QrCode, label: 'Patrol' },
  ]},
  { path: '/reports', icon: BarChart3, label: 'Reports', group: 'analysis' },
  { path: '/audit', icon: ScrollText, label: 'Audit', group: 'system', adminOnly: true },
  { path: '/admin', icon: Settings, label: 'Admin', group: 'system', adminOnly: true },
];

export default function Layout() {
  const { user, logout, refreshUser } = useAuth();
  const { isConnected, subscribe } = useWebSocket();
  const location = useLocation();
  const navigate = useNavigate();

  const gps = useGpsTracking();
  const presence = usePresence();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const pageTitle = PAGE_TITLES[location.pathname] || 'Dashboard';

  // Live header stats
  const [activeCallCount, setActiveCallCount] = useState(0);
  const [activeBOLOs, setActiveBOLOs] = useState(0);

  // Toolbar nav dropdowns
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown on route change
  useEffect(() => { setOpenDropdown(null); }, [location.pathname]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-nav-dropdown]')) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdown]);

  // Mobile menu & responsive detection
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  // Profile dropdown & modal
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalTab, setProfileModalTab] = useState<'profile' | 'password' | 'sessions'>('profile');
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  const fetchHeaderStats = useCallback(async () => {
    try {
      const stats = await apiFetch<any>('/dispatch/stats');
      setActiveCallCount(stats.activeCalls || 0);
    } catch { /* silent */ }
    try {
      const bolos = await apiFetch<any>('/comms/bolos/active');
      setActiveBOLOs(Array.isArray(bolos) ? bolos.length : 0);
    } catch { /* silent */ }
  }, []);

  // Fetch on mount and every 30 seconds
  useEffect(() => {
    fetchHeaderStats();
    const interval = setInterval(fetchHeaderStats, 30000);
    return () => clearInterval(interval);
  }, [fetchHeaderStats]);

  // Update on WebSocket dispatch events
  useEffect(() => {
    const unsub1 = subscribe('call_update', () => fetchHeaderStats());
    const unsub2 = subscribe('bolo_alert', () => fetchHeaderStats());
    return () => { unsub1(); unsub2(); };
  }, [subscribe, fetchHeaderStats]);

  // Refresh header user data when personnel/admin changes occur (e.g. admin edits user profile)
  useEffect(() => {
    const unsub = subscribe('data_changed', (payload: any) => {
      if (payload?.module === 'personnel' || payload?.module === 'admin' || payload?.module === 'auth') {
        refreshUser();
      }
    });
    return () => unsub();
  }, [subscribe, refreshUser]);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    if (profileDropdownOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [profileDropdownOpen]);

  const openProfileModal = (tab: 'profile' | 'password' | 'sessions') => {
    setProfileDropdownOpen(false);
    setProfileModalTab(tab);
    setProfileModalOpen(true);
  };

  const initials = user
    ? `${(user.first_name || 'U')[0]}${(user.last_name || '')[0] || ''}`.toUpperCase()
    : 'U';

  // Detect Electron (macOS needs extra left padding for traffic lights)
  const isElectron = !!(window as any).electron;
  const isMacElectron = isElectron && (window as any).electron?.platform === 'darwin';

  return (
    <div className="flex flex-col h-screen text-white overflow-hidden" style={{ background: '#1a1a1a' }}>
      {/* Auto-Update Banner (Electron only) */}
      {isElectron && <UpdateBanner />}

      {/* GPS tracking runs silently — no blocking gate */}

      {/* ============================================================ */}
      {/* MOBILE: Compact 48px header + polished slide-in drawer       */}
      {/* ============================================================ */}
      {isMobile && (
        <>
          <MobileHeader
            pageTitle={pageTitle}
            onMenuOpen={() => setMobileMenuOpen(true)}
            user={user}
            onProfileTap={() => openProfileModal('profile')}
            gpsLatitude={gps.latitude}
            gpsLongitude={gps.longitude}
          />
          <MobileDrawer
            isOpen={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            user={user}
            isAdmin={isAdmin}
            isConnected={isConnected}
            gpsTracking={gps.isTracking}
            gpsAccuracy={gps.accuracy}
            onlineCount={presence.count}
            onLogout={logout}
          />
        </>
      )}

      {/* ============================================================ */}
      {/* DESKTOP: Brand Bar — Logo Left | PANIC Center-Right | Profile */}
      {/* ============================================================ */}
      {!isMobile && (
        <div
          className="flex items-center justify-between relative"
          style={{
            height: '52px',
            paddingLeft: isMacElectron ? '78px' : '12px',
            paddingRight: '12px',
            background: 'linear-gradient(180deg, #252525 0%, #1a1a1a 100%)',
            borderBottom: '1px solid #303030',
            flexShrink: 0,
            WebkitAppRegion: isElectron ? 'drag' : undefined,
          } as React.CSSProperties}
        >
          {/* Crimson accent at very top */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #6e0a0a, #bc1010, #6e0a0a)', zIndex: 1 }} />

          {/* Left — Logo */}
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div onClick={() => navigate('/')} className="cursor-pointer" title="Rocky Mountain Protective Group — Dashboard">
              <RmpgLogo height={44} />
            </div>
            {/* Page title */}
            <div className="flex items-center gap-1.5">
              <div className="w-px h-6" style={{ background: '#383838' }} />
              <span className="text-[11px] font-mono font-bold tracking-wider text-rmpg-500">
                {pageTitle.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Right — PANIC + Profile */}
          <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* PANIC Button */}
            <PanicButton latitude={gps.latitude} longitude={gps.longitude} />

            {/* Vertical separator */}
            <div className="w-px h-7" style={{ background: '#383838' }} />

            {/* Profile Menu */}
            <div className="relative" ref={profileDropdownRef}>
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className={`flex items-center gap-2 px-2 py-1 transition-all duration-100 border ${
                  profileDropdownOpen
                    ? 'bg-rmpg-700 border-rmpg-600'
                    : 'bg-transparent border-transparent hover:bg-rmpg-800 hover:border-rmpg-700'
                }`}
              >
                {/* Avatar */}
                {user?.profile_image ? (
                  <img
                    src={user.profile_image}
                    alt={user.first_name}
                    className="w-7 h-7 object-cover"
                    style={{ border: '2px solid #484848', borderRadius: 2 }}
                  />
                ) : (
                  <div
                    className="w-7 h-7 flex items-center justify-center text-[10px] font-bold"
                    style={{
                      background: 'linear-gradient(135deg, #8a0c0c, #bc1010)',
                      color: '#fff',
                      border: '2px solid #d93030',
                      borderRadius: 2,
                    }}
                  >
                    {initials}
                  </div>
                )}

                {/* Name + Badge */}
                <div className="text-left">
                  <div className="text-[11px] font-bold text-white leading-tight">
                    {user?.last_name?.toUpperCase() || '---'}
                  </div>
                  <div className="text-[9px] font-mono leading-tight text-rmpg-500">
                    {user?.badge_number || user?.role?.toUpperCase() || '---'}
                  </div>
                </div>

                <ChevronDown
                  style={{
                    width: 10,
                    height: 10,
                    color: '#707070',
                    transform: profileDropdownOpen ? 'rotate(180deg)' : undefined,
                    transition: 'transform 0.15s',
                  }}
                />
              </button>

              {/* Profile Dropdown */}
              {profileDropdownOpen && (
                <div
                  className="menu-dropdown absolute right-0 top-full mt-0.5"
                  style={{ minWidth: 200, zIndex: 9995 }}
                >
                  {/* User info header */}
                  <div className="px-3 py-2 border-b border-rmpg-700">
                    <div className="text-xs font-bold text-white">
                      {user?.first_name} {user?.last_name}
                    </div>
                    <div className="text-[9px] font-mono text-rmpg-500">
                      {user?.email}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {user?.badge_number && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 bg-surface-overlay text-rmpg-400 border border-rmpg-800">
                          {user.badge_number}
                        </span>
                      )}
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 bg-brand-900/20 text-brand-300 border border-brand-800/40">
                        {user?.role}
                      </span>
                    </div>
                  </div>

                  {/* Menu items */}
                  <button onClick={() => openProfileModal('profile')} className="menu-item w-full">
                    <span className="menu-item-icon"><User style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Edit Profile</span>
                  </button>
                  <button onClick={() => openProfileModal('password')} className="menu-item w-full">
                    <span className="menu-item-icon"><Lock style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Change Password</span>
                  </button>
                  <button onClick={() => openProfileModal('sessions')} className="menu-item w-full">
                    <span className="menu-item-icon"><Shield style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Active Sessions</span>
                  </button>
                  {isAdmin && (
                    <button onClick={() => { setProfileDropdownOpen(false); navigate('/admin'); }} className="menu-item w-full">
                      <span className="menu-item-icon"><Settings style={{ width: 12, height: 12 }} /></span>
                      <span className="menu-item-label">System Settings</span>
                    </button>
                  )}

                  <div className="menu-separator" />

                  <button onClick={() => { setProfileDropdownOpen(false); logout(); }} className="menu-item w-full">
                    <span className="menu-item-icon"><LogOut style={{ width: 12, height: 12, color: '#d93030' }} /></span>
                    <span className="menu-item-label" style={{ color: '#d93030' }}>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TOOLBAR ROW 1 — Menu Bar (Spillman Flex style) HIDDEN ON MOBILE */}
      {/* ============================================================ */}
      <div
        className="hidden md:flex items-center justify-between px-2"
        style={{
          height: '22px',
          background: 'linear-gradient(180deg, #303030 0%, #252525 100%)',
          borderBottom: '1px solid #202020',
          flexShrink: 0,
        }}
      >
        {/* Menu Bar — File | View | Tools | Help */}
        <MenuBar
          isAdmin={isAdmin}
          isConnected={isConnected}
          onLogout={logout}
          onSearch={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
          onShowShortcuts={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
          onRefreshData={fetchHeaderStats}
        />

        {/* Right side — Operator info */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400">
          <span>
            OPR: {user?.badge_number || '---'} {user?.last_name?.toUpperCase() || '---'} | {user?.role?.toUpperCase() || '---'}
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* TOOLBAR ROW 2 — Action Bar (Spillman Flex style) HIDDEN ON MOBILE */}
      {/* ============================================================ */}
      <div
        className="hidden md:flex items-center justify-between px-2"
        style={{
          height: '28px',
          background: 'linear-gradient(180deg, #2a2a2a 0%, #1e1e1e 100%)',
          borderBottom: '1px solid #303030',
          flexShrink: 0,
        }}
      >
        {/* Left — Nav toolbar buttons (with dropdown groups) */}
        <div className="flex items-center gap-0">
          {TOOLBAR_NAV.filter(item => !item.adminOnly || isAdmin).map((item, idx, filtered) => {
            const Icon = item.icon;
            const prevGroup = idx > 0 ? filtered[idx - 1].group : item.group;
            const showSep = idx > 0 && item.group !== prevGroup;
            const hasChildren = item.children && item.children.length > 0;

            // Active state: for dropdown parents, active if any child matches
            const isActive = hasChildren
              ? item.children!.some(c => location.pathname.startsWith(c.path))
              : item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);

            if (hasChildren) {
              const isOpen = openDropdown === item.label;
              return (
                <React.Fragment key={item.label}>
                  {showSep && <div className="toolbar-separator" />}
                  <div className="relative" data-nav-dropdown>
                    <button
                      onClick={() => setOpenDropdown(isOpen ? null : item.label)}
                      onMouseEnter={() => {
                        if (openDropdown && openDropdown !== item.label) {
                          if (dropdownTimeoutRef.current) clearTimeout(dropdownTimeoutRef.current);
                          setOpenDropdown(item.label);
                        }
                      }}
                      className={isActive ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'}
                      title={item.label}
                    >
                      <Icon style={{ width: 12, height: 12 }} />
                      <span className="hidden lg:inline">{item.label}</span>
                      <ChevronDown style={{ width: 8, height: 8, opacity: 0.5, marginLeft: -2 }} />
                    </button>
                    {isOpen && (
                      <div
                        className="absolute top-full left-0 z-50 min-w-[160px] py-1"
                        style={{
                          background: '#1e1e1e',
                          border: '1px solid #383838',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                          marginTop: 1,
                        }}
                      >
                        {item.children!.filter(c => !c.adminOnly || isAdmin).map((child) => {
                          const ChildIcon = child.icon;
                          const childActive = location.pathname.startsWith(child.path);
                          return (
                            <button
                              key={child.path}
                              onClick={() => { navigate(child.path); setOpenDropdown(null); }}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[10px] transition-colors ${
                                childActive
                                  ? 'bg-brand-900/30 text-white'
                                  : 'text-rmpg-300 hover:bg-rmpg-700/40 hover:text-white'
                              }`}
                            >
                              <ChildIcon style={{ width: 11, height: 11 }} className={childActive ? 'text-brand-400' : 'text-rmpg-500'} />
                              <span>{child.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={item.path}>
                {showSep && <div className="toolbar-separator" />}
                <button
                  onClick={() => { navigate(item.path); setOpenDropdown(null); }}
                  onMouseEnter={() => { if (openDropdown) setOpenDropdown(null); }}
                  className={isActive ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'}
                  title={item.label}
                >
                  <Icon style={{ width: 12, height: 12 }} />
                  <span className="hidden lg:inline">{item.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Middle — Status indicators */}
        <div className="flex items-center gap-2">
          {/* Active Calls */}
          <button
            onClick={() => navigate('/dispatch')}
            className="flex items-center gap-1.5 px-2 py-0.5 panel-inset cursor-pointer transition-colors bg-surface-sunken hover:bg-rmpg-800"
          >
            <Phone style={{ width: 10, height: 10 }} className="text-red-500" />
            <span className="text-[10px] font-mono font-bold text-rmpg-400">CALLS:</span>
            <span className="text-[10px] font-mono font-bold text-white">{activeCallCount}</span>
          </button>

          {/* BOLO Indicator */}
          {activeBOLOs > 0 && (
            <button
              onClick={() => navigate('/communications')}
              className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer"
              style={{ background: 'rgba(188, 16, 16, 0.25)', border: '1px solid #a00e0e' }}
            >
              <span className="led-dot led-red animate-led-blink" />
              <span className="text-[10px] font-mono font-bold" style={{ color: '#ef7a7a' }}>
                BOLO: {activeBOLOs}
              </span>
            </button>
          )}

          {/* Notification Center */}
          <NotificationCenter />

          {/* GPS Status Indicator (Mandatory — always on) */}
          <div
            className="flex items-center gap-1 px-2 py-0.5 panel-inset transition-colors"
            style={{ background: gps.isTracking ? 'rgba(34, 197, 94, 0.1)' : gps.permissionDenied ? 'rgba(188, 16, 16, 0.15)' : '#141414' }}
            title={
              gps.isTracking
                ? `GPS ON (Mandatory) — ${gps.unitCallSign || 'no unit'} — ${gps.accuracy ? Math.round(gps.accuracy) + 'm accuracy' : 'acquiring...'}`
                : gps.permissionDenied
                  ? 'GPS DENIED — Location sharing is mandatory'
                  : 'GPS — Acquiring location...'
            }
          >
            <Navigation2
              style={{
                width: 10,
                height: 10,
                color: gps.isTracking ? '#22c55e' : gps.permissionDenied ? '#d93030' : '#707070',
                transform: gps.heading != null ? `rotate(${gps.heading}deg)` : undefined,
                transition: 'transform 0.3s ease, color 0.2s',
              }}
            />
            <span className="text-[9px] font-mono font-bold" style={{ color: gps.isTracking ? '#22c55e' : gps.permissionDenied ? '#d93030' : '#707070' }}>
              GPS
            </span>
            {gps.isTracking && (
              <span className="led-dot led-green animate-led-blink" />
            )}
            {gps.permissionDenied && (
              <span className="led-dot led-red animate-led-blink" />
            )}
          </div>

          {/* WebSocket Status LED */}
          <div className="flex items-center gap-1 px-2 py-0.5 panel-inset bg-surface-sunken">
            <span className={`led-dot ${isConnected ? 'led-green' : 'led-red animate-led-blink'}`} />
            <span className={`text-[9px] font-mono font-bold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
              {isConnected ? 'WS' : 'OFF'}
            </span>
          </div>

          {/* Online Users Count */}
          <div className="flex items-center gap-1 px-2 py-0.5 panel-inset bg-surface-sunken" title={presence.users.map(u => u.username).join(', ') || 'No users online'}>
            <Users style={{ width: 10, height: 10 }} className="text-rmpg-500" />
            <span className="text-[9px] font-mono font-bold text-rmpg-300">
              {presence.count}
            </span>
          </div>

          {/* Global Search */}
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            className="toolbar-btn"
            title="Search (Ctrl+K)"
          >
            <Search style={{ width: 10, height: 10 }} />
            <span className="text-[9px] font-mono text-rmpg-500">Ctrl+K</span>
          </button>
        </div>

        {/* Right — Page title in brackets */}
        <div className="text-[10px] font-mono font-bold tracking-wider md:hidden" style={{ color: '#707070' }}>
          [{pageTitle.toUpperCase()}]
        </div>
      </div>

      {/* Page Content (recessed panel — charcoal bg matching borders) */}
      <main className="flex-1 overflow-auto panel-inset" style={{ background: '#1e1e1e' }}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Status Bar Footer — Desktop only (mobile status is in the drawer) */}
      {!isMobile && (
        <StatusBar
          isConnected={isConnected}
          user={user}
          activeCallCount={activeCallCount}
          activeBOLOs={activeBOLOs}
          gpsTracking={gps.isTracking}
          gpsUnitCallSign={gps.unitCallSign}
          gpsAccuracy={gps.accuracy}
          gpsLastSent={gps.lastSentAt}
        />
      )}

      {/* Profile Modal */}
      <UserProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        initialTab={profileModalTab}
      />
    </div>
  );
}
