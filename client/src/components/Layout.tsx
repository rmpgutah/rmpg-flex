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
  Calendar,
  Briefcase,
  Package,
  TrendingUp,
  Construction,
  ClipboardCheck,
  UserX,
  Gavel,
  Terminal,
  ExternalLink,
  CreditCard,
  Network,
  Camera,
  ChevronLeft,
  ChevronRight,
  Mail,
  GraduationCap,
  Microscope,
} from 'lucide-react';
import { Navigation2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { apiFetch, OfflineUnauthorizedError } from '../hooks/useApi';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { usePresence } from '../hooks/usePresence';
import { useDispatchVoiceAlerts } from '../hooks/useDispatchVoiceAlerts';
import RmpgLogo from './RmpgLogo';
import StatusBar from './StatusBar';
import MenuBar from './MenuBar';
import ModuleTileBar from './ModuleTileBar';
import Sidebar from './Sidebar';
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
import MobileBottomNav from './mobile/MobileBottomNav';
import MobileContextBar from './mobile/MobileContextBar';
import { useIsMobile } from '../hooks/useIsMobile';
import { toDisplayLabel } from '../utils/formatters';
import { openPageWindow, POPOUT_PAGES } from '../utils/windowManager';
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
  '/email': 'Email',
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
  '/reports': 'Reports',
  '/forensics': 'Connection Analysis',
  '/forensic-lab': 'Forensic Lab',
  '/audit': 'Audit Log',
  '/crm': 'Overwatch',
  '/training': 'Training Management',
  '/training-docs': 'Training Documents',
  '/serve': 'Process Server',
  '/admin': 'Admin',
};

// Nav items — items with `children` render a dropdown menu in the toolbar
interface NavChild { path: string; icon: React.ElementType; label: string; adminOnly?: boolean; newWindow?: boolean }
interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  group: string;
  shortcut?: string;
  adminOnly?: boolean;
  newWindow?: boolean;
  children?: NavChild[];
  externalUrl?: string; // Opens external URL with SSO token
}

const TOOLBAR_NAV: NavItem[] = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', group: 'ops', shortcut: 'F1' },
  { path: '/dispatch', icon: Radio, label: 'Dispatch', group: 'ops', shortcut: 'F2' },
  { path: '/map', icon: Map, label: 'Map', group: 'ops', shortcut: 'F3' },
  { path: '/mdt', icon: Monitor, label: 'MDT', group: 'ops', shortcut: 'F4' },
  { path: '/ncic', icon: Terminal, label: 'NCIC', group: 'ops', shortcut: 'F5' },
  { path: '/records', icon: Database, label: 'Records', group: 'records', shortcut: 'F6', children: [
    { path: '/incidents', icon: FileText, label: 'Incidents' },
    { path: '/records', icon: Database, label: 'Records' },
    { path: '/field-interviews', icon: ClipboardList, label: 'Field Interviews' },
    { path: '/criminal-history', icon: Search, label: 'Criminal History' },
    { path: '/dl-search', icon: CreditCard, label: 'DL Search' },
    { path: '/skip-tracer', icon: Search, label: 'Skip Tracer' },
    { path: '/skiptracer-v2', icon: Search, label: 'Skip Tracer V2' },
    { path: '/evidence', icon: Package, label: 'Evidence / Property' },
    { path: '/forensic-lab', icon: Microscope, label: 'Forensic Lab' },
    { path: '/forensics', icon: Network, label: 'Connections' },
    { path: '/cases', icon: Briefcase, label: 'Case Management' },
  ]},
  { path: '/warrants', icon: AlertTriangle, label: 'Enforce', group: 'records', shortcut: 'F7', children: [
    { path: '/warrants', icon: AlertTriangle, label: 'Warrants' },
    { path: '/citations', icon: FileWarning, label: 'Citations' },
    { path: '/trespass-orders', icon: ShieldBan, label: 'Trespass Orders' },
    { path: '/code-enforcement', icon: Construction, label: 'Code Enforcement' },
    { path: '/court', icon: Gavel, label: 'Court Tracker' },
    { path: '/offender-registry', icon: UserX, label: 'Offender Registry' },
    { path: '/serve', icon: Briefcase, label: 'Process Server' },
  ]},
  { path: '/personnel', icon: Users, label: 'Personnel', group: 'records', shortcut: 'F8', children: [
    { path: '/personnel', icon: Users, label: 'Personnel' },
    { path: '/fleet', icon: Car, label: 'Fleet' },
    { path: '/body-cameras', icon: Video, label: 'Body Cameras' },
    { path: '/dash-cameras', icon: Camera, label: 'Dash Cameras' },
  ]},
  { path: '/communications', icon: MessageSquare, label: 'Comms', group: 'comms', shortcut: 'F9', children: [
    { path: '/communications', icon: MessageSquare, label: 'Comms' },
    { path: '/radio', icon: Radio, label: 'Radio' },
    { path: '/email', icon: Mail, label: 'Email' },
    { path: '/patrol', icon: QrCode, label: 'Patrol' },
  ]},
  { path: '/reports', icon: BarChart3, label: 'Reports', group: 'analysis', shortcut: 'F10', children: [
    { path: '/reports', icon: BarChart3, label: 'Reports' },
    { path: '/shift-plans', icon: Calendar, label: 'Shift Plans' },
    { path: '/statute-analytics', icon: BarChart3, label: 'Statute Analytics' },
    { path: '/reports/custom', icon: Database, label: 'Report Builder' },
    { path: '/crime-analysis', icon: TrendingUp, label: 'Crime Analysis' },
    { path: '/dar', icon: ClipboardCheck, label: 'Daily Activity' },
  ]},
  { path: '/crm', icon: Briefcase, label: 'Overwatch', group: 'analysis' },
  { path: '/training', icon: GraduationCap, label: 'Training', group: 'analysis' },
  { path: '/forensics', icon: Network, label: 'Connections', group: 'analysis', adminOnly: true },
  { path: '/audit', icon: ScrollText, label: 'Audit', group: 'system', shortcut: 'F11', adminOnly: true },
  { path: '/admin', icon: Settings, label: 'Admin', group: 'system', shortcut: 'F12', adminOnly: true },
];

// Paths that client_viewer role is NOT allowed to see
const CLIENT_VIEWER_BLOCKED_PATHS = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/radio', '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar',
]);

// Paths that contract_manager role is NOT allowed to see
const CONTRACT_MANAGER_BLOCKED_PATHS = new Set([
  '/admin', '/personnel', '/users',
]);

export default function Layout() {
  const { user, logout, refreshUser } = useAuth();
  const { isConnected, subscribe } = useWebSocket();
  const location = useLocation();
  const navigate = useNavigate();

  const gps = useGpsTracking();
  const presence = usePresence();
  useDispatchVoiceAlerts(); // App-wide voice alerts for all dispatch events
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isClientViewer = user?.role === 'client_viewer';
  const isContractManager = user?.role === 'contract_manager';
  const pageTitle = PAGE_TITLES[location.pathname] || 'Dashboard';

  // ── Back / Forward navigation history tracking ──
  // Uses state for canGoBack/canGoForward so buttons re-render properly.
  // History array + index stored in refs to avoid infinite loops.
  const navHistoryRef = useRef<string[]>([location.pathname]);
  const navIndexRef = useRef(0);
  const navSkipTrack = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    if (navSkipTrack.current) {
      navSkipTrack.current = false;
      // Still update button states after a back/forward navigation
      setCanGoBack(navIndexRef.current > 0);
      setCanGoForward(navIndexRef.current < navHistoryRef.current.length - 1);
      return;
    }
    const idx = navIndexRef.current;
    // Trim any forward entries when navigating to a new page
    if (idx < navHistoryRef.current.length - 1) {
      navHistoryRef.current = navHistoryRef.current.slice(0, idx + 1);
    }
    navHistoryRef.current.push(location.pathname);
    navIndexRef.current = navHistoryRef.current.length - 1;
    setCanGoBack(navIndexRef.current > 0);
    setCanGoForward(false); // New navigation always clears forward
  }, [location.pathname]);

  const handleNavBack = useCallback(() => {
    if (navIndexRef.current > 0) {
      navIndexRef.current -= 1;
      navSkipTrack.current = true;
      navigate(navHistoryRef.current[navIndexRef.current]);
    }
  }, [navigate]);

  const handleNavForward = useCallback(() => {
    if (navIndexRef.current < navHistoryRef.current.length - 1) {
      navIndexRef.current += 1;
      navSkipTrack.current = true;
      navigate(navHistoryRef.current[navIndexRef.current]);
    }
  }, [navigate]);

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
  const nameSetupDone = useRef(
    () => {
      try { return localStorage.getItem('rmpg_name_setup_done') === '1'; } catch { return false; }
    }
  );

  useEffect(() => {
    if (!user || nameSetupDone.current()) return;
    // Only prompt if user genuinely has no name set (first login)
    if (!user.first_name?.trim() || !user.last_name?.trim()) {
      setNameSetupOpen(true);
      setSetupFirstName(user.first_name || '');
      setSetupLastName(user.last_name || '');
    } else {
      // User has a name — mark as done so we never prompt again
      try { localStorage.setItem('rmpg_name_setup_done', '1'); } catch {}
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
      // Mark as done persistently — never prompt again after first save
      try { localStorage.setItem('rmpg_name_setup_done', '1'); } catch {}
      setNameSetupOpen(false);
      // Fire-and-forget — don't await so the modal closes immediately
      refreshUser();
    } catch (err: any) {
      setSetupError(err?.message || 'Failed to save. Try again.');
    } finally {
      setSetupSaving(false);
    }
  };

  // Live header stats
  const [activeCallCount, setActiveCallCount] = useState(0);
  const [activeBOLOs, setActiveBOLOs] = useState(0);
  const [emailUnreadCount, setEmailUnreadCount] = useState(0);

  // Mobile context bar — officer's current radio channel + assigned call
  const [mobileRadioChannel, setMobileRadioChannel] = useState<string | null>(null);
  const [mobileActiveCallNumber, setMobileActiveCallNumber] = useState<string | null>(null);

  // Toolbar nav dropdowns
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
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
        window.open(url, '_blank', 'noopener,noreferrer');
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

  // Alt+Arrow back/forward navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Alt+← = Back, Alt+→ = Forward
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavBack();
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavForward();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNavBack, handleNavForward]);

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
    } catch { /* silent — email may not be configured */ }
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
        .catch((err) => { console.warn('[Layout] fetch email unread count failed:', err); });
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [subscribe, fetchHeaderStats]);

  // Refresh header user data when personnel/admin changes occur (e.g. admin edits user profile)
  useEffect(() => {
    const unsub = subscribe('data_changed', (message: any) => {
      const payload = message?.data;
      if (payload?.module === 'personnel' || payload?.module === 'admin' || payload?.module === 'auth') {
        refreshUser();
      }
    });
    return () => unsub();
  }, [subscribe, refreshUser]);

  // Track officer's radio channel and active call for MobileContextBar
  useEffect(() => {
    // Radio channel: listen for channel state (sent when joining a channel)
    const unsubRadioState = subscribe('radio_channel_state', (msg: any) => {
      const data = msg.data || msg;
      setMobileRadioChannel(data.radioChannel || null);
    });
    // Clear radio channel when disconnected
    const unsubRadioLeave = subscribe('radio_channel_leave', (msg: any) => {
      const data = msg.data || msg;
      // Only clear if it's our own leave (userId matches)
      if (data.userId === Number(user?.id)) {
        setMobileRadioChannel(null);
      }
    });

    // Active call: listen for unit status changes to track assigned call
    const unsubUnitStatus = subscribe('units:status', (msg: any) => {
      const data = msg.data || msg;
      // Check if this status update is for our unit
      if (data.call_sign === gps.unitCallSign) {
        setMobileActiveCallNumber(data.active_call_number || null);
      }
    });
    // Also listen for call updates
    const unsubCallUpdate = subscribe('calls:updated', (msg: any) => {
      const data = msg.data || msg;
      // If a call has our unit assigned, track it
      if (data.assigned_unit === gps.unitCallSign && data.status !== 'closed') {
        setMobileActiveCallNumber(data.call_number || null);
      }
    });

    return () => {
      unsubRadioState();
      unsubRadioLeave();
      unsubUnitStatus();
      unsubCallUpdate();
    };
  }, [subscribe, user?.id, gps.unitCallSign]);

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
    <div className="flex flex-col h-screen text-white overflow-hidden" style={{ background: 'var(--surface-base)' }}>
      {/* Auto-Update Banner (Electron only) */}
      {isElectron && <UpdateBanner />}

      {/* Offline Status Bar (shows when offline or syncing — Electron and browser) */}
      <OfflineStatusBar />

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      {/* MOBILE: Compact header + context bar + drawer + bottom nav   */}
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
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onNavBack={handleNavBack}
            onNavForward={handleNavForward}
          />
          <MobileContextBar
            unitCallSign={gps.unitCallSign}
            radioChannel={mobileRadioChannel}
            activeCallNumber={mobileActiveCallNumber}
            isConnected={isConnected}
            gpsTracking={gps.isTracking}
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
          className="flex items-center relative scan-line"
          style={{
            height: '52px',
            paddingLeft: isMacElectron ? '78px' : '12px',
            paddingRight: '12px',
            background: 'linear-gradient(180deg, #162640 0%, #0f1a28 100%)',
            borderBottom: '1px solid #1e3048',
            flexShrink: 0,
            WebkitAppRegion: isElectron ? 'drag' : undefined,
          } as React.CSSProperties}
        >
          {/* Blue accent at very top */}
          <div className="absolute top-0 left-0 right-0 h-px card-accent" style={{ zIndex: 1 }} />

          {/* Left — Logo + FLEX branding + Page title */}
          <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div onClick={() => navigate('/')} className="cursor-pointer flex items-center gap-2" title="Rocky Mountain Protective Group — Dashboard">
              <RmpgLogo height={44} />
              <div className="flex flex-col">
                <span className="text-[14px] font-bold tracking-wider text-white leading-none">RMPG</span>
                <span className="text-[10px] font-bold tracking-[0.2em] leading-none" style={{ color: '#3b8ad4' }}>FLEX</span>
              </div>
            </div>
            <div className="w-px h-6" style={{ background: '#2a3e58' }} />
            <span className="text-[11px] font-mono font-bold tracking-wider text-rmpg-400">
              {pageTitle.toUpperCase()}
            </span>
            {POPOUT_PAGES[location.pathname] && (
              <button
                onClick={() => openPageWindow(location.pathname)}
                className="toolbar-btn"
                title="Open in new window"
                style={{ padding: '2px 4px' }}
              >
                <ExternalLink className="w-3 h-3" style={{ color: '#5a6e80' }} />
              </button>
            )}
          </div>

          {/* Right — Status indicators + PANIC + Profile */}
          <div className="flex items-center gap-2 ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* Status indicators — compact inline */}
            <div className="hidden lg:flex items-center gap-1.5">
              {/* Active Calls */}
              <button
                onClick={() => navigate('/dispatch')}
                className="flex items-center gap-1 px-2 py-0.5 panel-inset cursor-pointer transition-colors bg-surface-sunken hover:bg-rmpg-800"
              >
                <Phone style={{ width: 9, height: 9 }} className="text-red-500" />
                <span className="text-[10px] font-mono font-bold text-rmpg-400">CALLS:</span>
                <span className="text-[10px] font-mono font-bold text-white">{activeCallCount}</span>
              </button>

              {/* BOLO Indicator */}
              {activeBOLOs > 0 && (
                <button
                  onClick={() => navigate('/communications')}
                  className="flex items-center gap-1 px-2 py-0.5 cursor-pointer"
                  style={{ background: 'rgba(220, 38, 38, 0.25)', border: '1px solid #991b1b' }}
                >
                  <span className="led-dot led-red animate-led-blink" />
                  <span className="text-[10px] font-mono font-bold" style={{ color: '#ef7a7a' }}>
                    BOLO: {activeBOLOs}
                  </span>
                </button>
              )}

              {/* GPS */}
              <div
                className="flex items-center gap-1 px-1.5 py-0.5 panel-inset"
                style={{ background: gps.isTracking ? 'rgba(34, 197, 94, 0.1)' : '#0d1520' }}
                title={gps.isTracking ? `GPS ON — ${gps.unitCallSign || 'no unit'}` : 'GPS acquiring...'}
              >
                <Navigation2 style={{ width: 9, height: 9, color: gps.isTracking ? '#22c55e' : '#5a6e80', transform: gps.heading != null ? `rotate(${gps.heading}deg)` : undefined }} />
                {gps.isTracking && <span className="led-dot led-green animate-led-blink" />}
              </div>

              {/* WS + Users */}
              <div className="flex items-center gap-1 px-1.5 py-0.5 panel-inset bg-surface-sunken">
                <span className={`led-dot ${isConnected ? 'led-green' : 'led-red animate-led-blink'}`} />
                <Users style={{ width: 9, height: 9 }} className="text-rmpg-500" />
                <span className="text-[10px] font-mono font-bold text-rmpg-300">{presence.count}</span>
              </div>

              {/* Notifications */}
              <NotificationCenter />

              {/* Search */}
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
                className="toolbar-btn"
                title="Search (Ctrl+K)"
                style={{ padding: '2px 6px' }}
              >
                <Search style={{ width: 10, height: 10 }} />
              </button>
            </div>

            {/* Separator */}
            <div className="hidden lg:block w-px h-7" style={{ background: '#2a3e58' }} />

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
                {/* Avatar icon only */}
                {user?.profile_image ? (
                  <img
                    src={user.profile_image}
                    alt={user.first_name}
                    className="w-8 h-8 object-cover"
                    style={{ border: '2px solid #3a5070', borderRadius: '50%' }}
                  />
                ) : (
                  <div
                    className="w-8 h-8 flex items-center justify-center text-[11px] font-bold"
                    style={{
                      background: 'linear-gradient(135deg, #124070, #1a5a9e)',
                      color: '#fff',
                      border: '2px solid #3b8ad4',
                      borderRadius: '50%',
                      transition: 'box-shadow 0.3s ease',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(59, 138, 212, 0.5)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                  >
                    {initials}
                  </div>
                )}

                <ChevronDown
                  style={{
                    width: 10,
                    height: 10,
                    color: '#5a6e80',
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
                    <div className="text-[10px] font-mono text-rmpg-500">
                      {user?.email}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {user?.badge_number && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-surface-overlay text-rmpg-400 border border-rmpg-800">
                          {user.badge_number}
                        </span>
                      )}
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 bg-brand-900/20 text-brand-300 border border-brand-800/40">
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
                    <span className="menu-item-icon"><LogOut style={{ width: 12, height: 12, color: '#ef4444' }} /></span>
                    <span className="menu-item-label" style={{ color: '#ef4444' }}>Sign Out</span>
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
          <span className="text-[10px] font-bold uppercase tracking-widest text-green-500">
            Contract Manager View — ICU Investigations
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 bg-amber-900/30 text-amber-400 border border-amber-800/40">
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
          background: 'linear-gradient(180deg, #162640 0%, #0f1a28 100%)',
          borderBottom: '1px solid #141e2b',
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
            OPR: {user?.badge_number ? <span style={{ color: '#4a9aee', textShadow: '0 0 6px rgba(26, 90, 158, 0.3)' }}>#{user.badge_number}</span> : '---'} {user?.last_name?.toUpperCase() || '---'}, {user?.first_name || '---'} | {toDisplayLabel(user?.role || '---').toUpperCase()}
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* MODULE TILE BAR — Spillman Flex module launcher ribbon        */}
      {/* ============================================================ */}
      {!isMobile && (
        <ModuleTileBar
          items={TOOLBAR_NAV}
          isAdmin={isAdmin}
          isClientViewer={isClientViewer}
          isContractManager={isContractManager}
          activeCallCount={activeCallCount}
          emailUnreadCount={emailUnreadCount}
          activeBOLOs={activeBOLOs}
        />
      )}

      {/* Mandatory Location Gate — blocks app if GPS permission denied */}
      <LocationGate
        permissionDenied={gps.permissionDenied}
        permissionPending={gps.permissionPending}
        error={gps.error}
        onRetry={gps.startTracking}
        connectionType={gps.connectionType}
        positionSource={gps.positionSource}
      />

      {/* ============================================================ */}
      {/* MAIN CONTENT AREA — Full width (no sidebar)                  */}
      {/* ============================================================ */}
      <main className="flex-1 overflow-auto min-h-0 panel-inset app-grid-bg animate-page-enter relative z-0" key={location.pathname}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <MobileBottomNav
          onMoreTap={() => setMobileMenuOpen(true)}
        />
      )}

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
