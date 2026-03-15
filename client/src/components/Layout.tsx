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
  Video,
  ClipboardList,
  ShieldBan,
  Monitor,
  User,
  Lock,
  ChevronDown,
  Shield,
  Menu,
  X,
  Calendar,
  Briefcase,
  Package,
  TrendingUp,
  Landmark,
  Construction,
  Truck,
  ClipboardCheck,
  UserX,
  Gavel,
  Terminal,
  CreditCard,
  Microscope,
  Mail,
  GraduationCap,
  ShieldAlert,
} from 'lucide-react';
import { Navigation2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { apiFetch, OfflineUnauthorizedError } from '../hooks/useApi';
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
import OfflineStatusBar from './OfflineStatusBar';
import PinEntryModal from './PinEntryModal';
import ForcePasswordChangeModal from './ForcePasswordChangeModal';
import Force2FASetupModal from './Force2FASetupModal';
import MobileHeader from './mobile/MobileHeader';
import MobileDrawer from './mobile/MobileDrawer';
import { useIsMobile } from '../hooks/useIsMobile';
import { toDisplayLabel } from '../utils/formatters';
import LocationGate from './LocationGate';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/dispatch': 'Dispatch',
  '/map': 'Map',
  '/incidents': 'Incidents',
  '/records': 'Records',
  '/personnel': 'Personnel',
  '/communications': 'Communications',
  '/radio': 'Radio',
  '/patrol': 'Patrol',
  '/fleet': 'Fleet',
  '/warrants': 'Warrants',
  '/citations': 'Citations',
  '/field-interviews': 'Field Interviews',
  '/trespass-orders': 'Trespass Orders',
  '/mdt': 'MDT',
  '/ncic': 'NCIC Terminal',
  '/dl-search': 'DL Search',
  '/shift-plans': 'Shift Plans',
  '/statute-analytics': 'Statute Analytics',
  '/reports/custom': 'Report Builder',
  '/criminal-history': 'Criminal History',
  '/evidence': 'Evidence / Property',
  '/cases': 'Case Management',
  '/crime-analysis': 'Crime Analysis',
  '/code-enforcement': 'Code Enforcement',
  '/court': 'Court Tracker',
  '/dar': 'Daily Activity Reports',
  '/offender-registry': 'Offender Registry',
  '/sex-offender-registry': 'Sex Offender Registry',
  '/training': 'Training',
  '/reports': 'Reports',
  '/forensics': 'Forensic Lab',
  '/dash-cameras': 'Dash Cameras',
  '/email': 'Email',
  '/crm': 'Overwatch',
  '/audit': 'Audit Log',
  '/admin': 'Admin',
};

// Nav items — items with `children` render a dropdown menu in the toolbar
interface NavChild { path: string; icon: React.ElementType; label: string; adminOnly?: boolean; newWindow?: boolean }
interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  group: string;
  adminOnly?: boolean;
  children?: NavChild[];
  externalUrl?: string; // Opens external URL with SSO token
}

const TOOLBAR_NAV: NavItem[] = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', group: 'ops' },
  { path: '/dispatch', icon: Radio, label: 'Dispatch', group: 'ops' },
  { path: '/map', icon: Map, label: 'Map', group: 'ops' },
  { path: '/mdt', icon: Monitor, label: 'MDT', group: 'ops' },
  { path: '/ncic', icon: Terminal, label: 'NCIC', group: 'ops' },
  { path: '/records', icon: Database, label: 'Records', group: 'records', children: [
    { path: '/incidents', icon: FileText, label: 'Incidents' },
    { path: '/records', icon: Database, label: 'Records' },
    { path: '/field-interviews', icon: ClipboardList, label: 'Field Interviews' },
    { path: '/criminal-history', icon: Search, label: 'Criminal History' },
    { path: '/dl-search', icon: CreditCard, label: 'DL Search' },
    { path: '/skip-tracer', icon: Search, label: 'Skip Tracer' },
    { path: '/evidence', icon: Package, label: 'Evidence / Property' },
    { path: '/forensics', icon: Microscope, label: 'Forensic Lab' },
    { path: '/cases', icon: Briefcase, label: 'Case Management' },
  ]},
  { path: '/warrants', icon: AlertTriangle, label: 'Enforcement', group: 'records', children: [
    { path: '/warrants', icon: AlertTriangle, label: 'Warrants', newWindow: true },
    { path: '/citations', icon: FileWarning, label: 'Citations', newWindow: true },
    { path: '/trespass-orders', icon: ShieldBan, label: 'Trespass Orders', newWindow: true },
    { path: '/code-enforcement', icon: Construction, label: 'Code Enforcement', newWindow: true },
    { path: '/court', icon: Gavel, label: 'Court Tracker', newWindow: true },
    { path: '/offender-registry', icon: UserX, label: 'Offender Registry', newWindow: true },
    { path: '/sex-offender-registry', icon: ShieldAlert, label: 'Sex Offender Registry', newWindow: true },
  ]},
  { path: '/personnel', icon: Users, label: 'Personnel', group: 'records', children: [
    { path: '/personnel', icon: Users, label: 'Personnel' },
    { path: '/fleet', icon: Car, label: 'Fleet' },
    { path: '/body-cameras', icon: Video, label: 'Body Cameras' },
    { path: '/dash-cameras', icon: Car, label: 'Dash Cameras' },
    { path: '/training', icon: GraduationCap, label: 'Training' },
  ]},
  { path: '/communications', icon: MessageSquare, label: 'Comms', group: 'comms', children: [
    { path: '/communications', icon: MessageSquare, label: 'Comms' },
    { path: '/radio', icon: Radio, label: 'Radio' },
    { path: '/email', icon: Mail, label: 'Email' },
    { path: '/patrol', icon: QrCode, label: 'Patrol' },
  ]},
  { path: '/reports', icon: BarChart3, label: 'Reports', group: 'analysis', children: [
    { path: '/reports', icon: BarChart3, label: 'Reports' },
    { path: '/shift-plans', icon: Calendar, label: 'Shift Plans' },
    { path: '/statute-analytics', icon: BarChart3, label: 'Statute Analytics' },
    { path: '/reports/custom', icon: Database, label: 'Report Builder' },
    { path: '/crime-analysis', icon: TrendingUp, label: 'Crime Analysis' },
    { path: '/dar', icon: ClipboardCheck, label: 'Daily Activity' },
  ]},
  { path: '/audit', icon: ScrollText, label: 'Audit', group: 'system', adminOnly: true },
  { path: '/admin', icon: Settings, label: 'Admin', group: 'system', adminOnly: true },
  { path: '/crm', icon: Briefcase, label: 'Overwatch', group: 'analysis' },
];

// Paths that client_viewer role is NOT allowed to see
const CLIENT_VIEWER_BLOCKED_PATHS = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/radio', '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar',
]);

export default function Layout() {
  const { user, logout, refreshUser } = useAuth();
  const { isConnected, subscribe } = useWebSocket();
  const location = useLocation();
  const navigate = useNavigate();

  const gps = useGpsTracking();
  const presence = usePresence();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isClientViewer = user?.role === 'client_viewer';
  const pageTitle = PAGE_TITLES[location.pathname] || 'Dashboard';

  // ── Offline PIN Modal (global catch for OfflineUnauthorizedError) ──
  const [offlinePinModalOpen, setOfflinePinModalOpen] = useState(false);

  useEffect(() => {
    // Listen for unhandled OfflineUnauthorizedError rejections
    const handler = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof OfflineUnauthorizedError) {
        event.preventDefault(); // suppress console error
        setOfflinePinModalOpen(true);
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  // ── Mandatory Name Setup ──────────────────────────────────
  // If user has no first_name or last_name, force a one-time setup prompt.
  // The prompt cannot be dismissed until both fields are filled.
  // A ref prevents race conditions where React re-renders re-open the modal.
  const [nameSetupOpen, setNameSetupOpen] = useState(false);
  const [setupFirstName, setSetupFirstName] = useState('');
  const [setupLastName, setSetupLastName] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState('');
  const nameSetupDone = useRef(false);

  useEffect(() => {
    if (!user || nameSetupDone.current) return;
    if (!user.first_name?.trim() || !user.last_name?.trim()) {
      setNameSetupOpen(true);
      setSetupFirstName(user.first_name || '');
      setSetupLastName(user.last_name || '');
    } else {
      setNameSetupOpen(false);
    }
  }, [user]);

  const handleNameSetupSave = async () => {
    const fn = setupFirstName.trim();
    const ln = setupLastName.trim();
    if (!fn || !ln) {
      setSetupError('Both first and last name are required.');
      return;
    }
    setSetupSaving(true);
    setSetupError('');
    try {
      await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ first_name: fn, last_name: ln }),
      });
      // Mark as done BEFORE refreshUser to prevent the useEffect from re-opening
      nameSetupDone.current = true;
      setNameSetupOpen(false);
      // Fire-and-forget — don't await so the modal closes immediately
      refreshUser();
    } catch (err: any) {
      setSetupError(err.message || 'Failed to save. Try again.');
    } finally {
      setSetupSaving(false);
    }
  };

  // Live header stats
  const [activeCallCount, setActiveCallCount] = useState(0);
  const [activeBOLOs, setActiveBOLOs] = useState(0);
  const [emailUnreadCount, setEmailUnreadCount] = useState(0);

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

  // ── F-key page switching ────────────────────────────────────
  // F1–F12 map to the first 12 top-level nav items (left-to-right).
  // Only fires when user is NOT focused in an input field.
  useEffect(() => {
    const handleFKey = (e: KeyboardEvent) => {
      // Skip if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;

      const match = e.key.match(/^F(\d+)$/);
      if (!match) return;

      const fNum = parseInt(match[1], 10);
      if (fNum < 1 || fNum > 12) return;

      // Build visible nav items (same filter as toolbar rendering)
      const visibleNav = TOOLBAR_NAV.filter(item => {
        if (item.adminOnly && !isAdmin) return false;
        if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(item.path)) return false;
        return true;
      });

      const idx = fNum - 1;
      if (idx >= visibleNav.length) return;

      const item = visibleNav[idx];
      e.preventDefault();

      // External links open in new tab
      if (item.externalUrl) {
        const token = localStorage.getItem('rmpg_token');
        const url = token
          ? `${item.externalUrl}?token=${encodeURIComponent(token)}`
          : item.externalUrl;
        window.open(url, '_blank', 'noopener');
        return;
      }

      navigate(item.path);
      setOpenDropdown(null);
    };

    window.addEventListener('keydown', handleFKey);
    return () => window.removeEventListener('keydown', handleFKey);
  }, [navigate, isAdmin, isClientViewer]);

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
    try {
      const email = await apiFetch<{ count: number }>('/email/unread-count');
      setEmailUnreadCount(email.count || 0);
    } catch { /* silent -- email may not be configured */ }
  }, []);

  // Fetch on mount and every 30 seconds
  useEffect(() => {
    fetchHeaderStats();
    const interval = setInterval(fetchHeaderStats, 30000);
    return () => clearInterval(interval);
  }, [fetchHeaderStats]);

  // Update on WebSocket dispatch events
  useEffect(() => {
    const unsub1 = subscribe('dispatch_update', () => fetchHeaderStats());
    const unsub2 = subscribe('bolo_alert', () => fetchHeaderStats());
    const unsub3 = subscribe('email:new_messages', () => {
      apiFetch<{ count: number }>('/email/unread-count')
        .then(r => setEmailUnreadCount(r.count || 0))
        .catch(() => {});
    });
    return () => { unsub1(); unsub2(); unsub3(); };
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
    <div className="flex flex-col h-screen text-white overflow-hidden" style={{ background: '#141e2b' }}>
      {/* Auto-Update Banner (Electron only) */}
      {isElectron && <UpdateBanner />}

      {/* Offline Status Bar (Electron only — shows when offline or syncing) */}
      {isElectron && <OfflineStatusBar />}

      {/* GPS tracking runs silently — no blocking gate */}

      {/* ============================================================ */}
      {/* MANDATORY NAME SETUP — blocks UI until first/last name set   */}
      {/* ============================================================ */}
      {nameSetupOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', zIndex: 99999, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div
            className="w-full max-w-sm mx-4 p-6 space-y-4"
            style={{
              background: '#141e2b',
              border: '1px solid #1e3048',
              borderTop: '3px solid #1a5a9e',
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            <div className="text-center space-y-1">
              <div className="text-lg font-bold text-white">Operator Identification Required</div>
              <div className="text-xs text-gray-400">
                Enter your name to continue. This will appear in the OPR system and all reports.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">First Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={setupFirstName}
                  onChange={e => setSetupFirstName(e.target.value)}
                  className="input-dark"
                  placeholder="First"
                  autoFocus
                />
              </div>
              <div>
                <label className="field-label">Last Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={setupLastName}
                  onChange={e => setSetupLastName(e.target.value)}
                  className="input-dark"
                  placeholder="Last"
                />
              </div>
            </div>

            {setupError && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 px-3 py-2">
                {setupError}
              </div>
            )}

            <button
              onClick={handleNameSetupSave}
              disabled={setupSaving || !setupFirstName.trim() || !setupLastName.trim()}
              className="btn-primary w-full justify-center"
            >
              {setupSaving ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </div>
      )}

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
            background: 'linear-gradient(180deg, #162236 0%, #141e2b 100%)',
            borderBottom: '1px solid #1e3048',
            flexShrink: 0,
            WebkitAppRegion: isElectron ? 'drag' : undefined,
          } as React.CSSProperties}
        >
          {/* Blue accent at very top */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #0f3460, #1a5a9e, #0f3460)', zIndex: 1 }} />

          {/* Left — Logo */}
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div onClick={() => navigate('/')} className="cursor-pointer" title="Rocky Mountain Protective Group — Dashboard">
              <RmpgLogo height={44} />
            </div>
            {/* Page title */}
            <div className="flex items-center gap-1.5">
              <div className="w-px h-6" style={{ background: '#2a3e58' }} />
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
            <div className="w-px h-7" style={{ background: '#2a3e58' }} />

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
                    style={{ border: '2px solid #3a5070', borderRadius: 2 }}
                  />
                ) : (
                  <div
                    className="w-7 h-7 flex items-center justify-center text-[10px] font-bold"
                    style={{
                      background: 'linear-gradient(135deg, #14427a, #1a5a9e)',
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
                    {user?.first_name && user?.last_name
                      ? `${user.last_name.toUpperCase()}, ${user.first_name}`
                      : user?.last_name?.toUpperCase() || user?.first_name?.toUpperCase() || '---'}
                  </div>
                  <div className="text-[9px] font-mono leading-tight text-rmpg-500">
                    {user?.badge_number ? `#${user.badge_number}` : toDisplayLabel(user?.role || '---').toUpperCase()}
                  </div>
                </div>

                <ChevronDown
                  style={{
                    width: 10,
                    height: 10,
                    color: '#4a6280',
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
                        {toDisplayLabel(user?.role || '')}
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

      {/* Contract Manager Banner */}
      {isClientViewer && (
        <div
          className="flex items-center justify-center gap-2 px-4"
          style={{
            height: '22px',
            background: 'linear-gradient(90deg, #141e2b, #1e2a1e, #141e2b)',
            borderBottom: '1px solid #2a3a2a',
            flexShrink: 0,
          }}
        >
          <span className="text-[9px] font-bold uppercase tracking-widest text-green-500">
            Contract Manager View — ICU Investigations
          </span>
          <span className="text-[8px] font-mono px-1.5 py-0.5 bg-amber-900/30 text-amber-400 border border-amber-800/40">
            DEMO DATA
          </span>
        </div>
      )}

      {/* ============================================================ */}
      {/* TOOLBAR ROW 1 — Menu Bar (Spillman Flex style) HIDDEN ON MOBILE */}
      {/* ============================================================ */}
      <div
        className="hidden md:flex items-center justify-between px-2"
        style={{
          height: '22px',
          background: 'linear-gradient(180deg, #1e3048 0%, #162236 100%)',
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

        {/* Right side — Operator info (persists name + badge from user profile) */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400">
          <span>
            OPR: {user?.badge_number ? `#${user.badge_number}` : '---'} {user?.last_name?.toUpperCase() || '---'}, {user?.first_name || '---'} | {toDisplayLabel(user?.role || '---').toUpperCase()}
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* TOOLBAR ROW 2 — Action Bar (Spillman Flex style) HIDDEN ON MOBILE */}
      {/* ============================================================ */}
      <div
        className="hidden md:flex items-center justify-between px-2"
        style={{
          height: '52px',
          background: 'linear-gradient(180deg, #2a3e58 0%, #1a2636 100%)',
          borderBottom: '1px solid #1e3048',
          flexShrink: 0,
          overflow: 'visible',
        }}
      >
        {/* Left — Nav toolbar buttons with icons + labels + F-key badges */}
        <div className="flex items-center gap-0 flex-shrink-0">
          {TOOLBAR_NAV.filter(item => {
            if (item.adminOnly && !isAdmin) return false;
            if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(item.path)) return false;
            return true;
          }).map((item, idx, filtered) => {
            const Icon = item.icon;
            const prevGroup = idx > 0 ? filtered[idx - 1].group : item.group;
            const showSep = idx > 0 && item.group !== prevGroup;
            const hasChildren = item.children && item.children.length > 0;
            const fKey = idx < 12 ? `F${idx + 1}` : null;

            // Active state: for dropdown parents, active if any child matches
            const isActive = hasChildren
              ? item.children!.some(c => location.pathname.startsWith(c.path))
              : item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);

            // Shared button content: icon on top, label below, F-key badge
            const btnContent = (showChevron?: boolean) => (
              <div className="flex flex-col items-center gap-0.5 relative py-0.5 px-1">
                <Icon style={{ width: 16, height: 16 }} className={isActive ? 'text-brand-400' : ''} />
                {/* Email unread badge on Comms toolbar button */}
                {item.path === '/communications' && emailUnreadCount > 0 && (
                  <span
                    className="absolute flex items-center justify-center font-bold"
                    style={{
                      top: 1, left: 30,
                      minWidth: 14, height: 14, padding: '0 3px',
                      fontSize: 8, lineHeight: 1,
                      background: '#dc2626', color: '#fff',
                      borderRadius: 7, border: '1px solid #141e2b',
                    }}
                  >
                    {emailUnreadCount > 99 ? '99+' : emailUnreadCount}
                  </span>
                )}
                <div className="flex items-center gap-0.5">
                  <span className="text-[9px] leading-none whitespace-nowrap">{item.label}</span>
                  {showChevron && <ChevronDown style={{ width: 7, height: 7, opacity: 0.5 }} />}
                </div>
                {fKey && (
                  <span
                    className="absolute -top-0.5 -right-1 text-[7px] font-mono font-bold leading-none px-0.5 rounded-sm"
                    style={{ color: '#666', background: 'rgba(255,255,255,0.06)' }}
                  >{fKey}</span>
                )}
              </div>
            );

            if (hasChildren) {
              const isOpen = openDropdown === item.label;
              return (
                <React.Fragment key={item.label}>
                  {showSep && <div className="toolbar-separator" style={{ height: 36 }} />}
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
                      title={`${item.label}${fKey ? ` (${fKey})` : ''}`}
                      style={{ height: 44, padding: '2px 6px' }}
                    >
                      {btnContent(true)}
                    </button>
                    {isOpen && (
                      <div
                        className="absolute top-full left-0 z-50 min-w-[160px] py-1"
                        style={{
                          background: '#1a2636',
                          border: '1px solid #2a3e58',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                          marginTop: 1,
                        }}
                      >
                        {item.children!.filter(c => {
                          if (c.adminOnly && !isAdmin) return false;
                          if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(c.path)) return false;
                          return true;
                        }).map((child) => {
                          const ChildIcon = child.icon;
                          const childActive = location.pathname.startsWith(child.path);
                          return (
                            <button
                              key={child.path}
                              onClick={() => { if (child.newWindow) { window.open(child.path, '_blank', 'noopener'); } else { navigate(child.path); } setOpenDropdown(null); }}
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

            // External link (e.g. CRM) — opens in new tab with SSO token
            if (item.externalUrl) {
              return (
                <React.Fragment key={item.path}>
                  {showSep && <div className="toolbar-separator" style={{ height: 36 }} />}
                  <button
                    onClick={() => {
                      setOpenDropdown(null);
                      const token = localStorage.getItem('rmpg_token');
                      const url = token
                        ? `${item.externalUrl}?token=${encodeURIComponent(token)}`
                        : item.externalUrl!;
                      window.open(url, '_blank', 'noopener');
                    }}
                    onMouseEnter={() => { if (openDropdown) setOpenDropdown(null); }}
                    className="toolbar-btn"
                    title={`Open ${item.label}${fKey ? ` (${fKey})` : ''}`}
                    style={{ height: 44, padding: '2px 6px' }}
                  >
                    {btnContent()}
                  </button>
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={item.path}>
                {showSep && <div className="toolbar-separator" style={{ height: 36 }} />}
                <button
                  onClick={() => { navigate(item.path); setOpenDropdown(null); }}
                  onMouseEnter={() => { if (openDropdown) setOpenDropdown(null); }}
                  className={isActive ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'}
                  title={`${item.label}${fKey ? ` (${fKey})` : ''}`}
                  style={{ height: 44, padding: '2px 6px' }}
                >
                  {btnContent()}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Middle — Status indicators (scrollable on narrow screens) */}
        <div className="flex items-center gap-1 lg:gap-2 flex-1 min-w-0 overflow-x-auto mx-2" style={{ scrollbarWidth: 'none' }}>
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
            style={{ background: gps.isTracking ? 'rgba(34, 197, 94, 0.1)' : gps.permissionDenied ? 'rgba(188, 16, 16, 0.15)' : '#0d1520' }}
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
                color: gps.isTracking ? '#22c55e' : gps.permissionDenied ? '#d93030' : '#4a6280',
                transform: gps.heading != null ? `rotate(${gps.heading}deg)` : undefined,
                transition: 'transform 0.3s ease, color 0.2s',
              }}
            />
            <span className="text-[9px] font-mono font-bold" style={{ color: gps.isTracking ? '#22c55e' : gps.permissionDenied ? '#d93030' : '#4a6280' }}>
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
        <div className="text-[10px] font-mono font-bold tracking-wider md:hidden" style={{ color: '#4a6280' }}>
          [{pageTitle.toUpperCase()}]
        </div>
      </div>

      {/* Mandatory Location Gate — blocks app if GPS permission denied */}
      <LocationGate
        permissionDenied={gps.permissionDenied}
        permissionPending={gps.permissionPending}
        error={gps.error}
        onRetry={gps.startTracking}
        connectionType={gps.connectionType}
        positionSource={gps.positionSource}
      />

      {/* Page Content (recessed panel — charcoal bg matching borders) */}
      <main className="flex-1 overflow-auto min-h-0 panel-inset" style={{ background: '#1a2636' }}>
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

      {/* Offline PIN Entry Modal — triggered globally when an offline write needs authorization */}
      <PinEntryModal
        isOpen={offlinePinModalOpen}
        onClose={() => setOfflinePinModalOpen(false)}
      />

      {/* Force Password Change Modal — blocks UI until password changed */}
      <ForcePasswordChangeModal />

      {/* Force 2FA Setup Modal — blocks UI until 2FA is enabled */}
      <Force2FASetupModal />
    </div>
  );
}
