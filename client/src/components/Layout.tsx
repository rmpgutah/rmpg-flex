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
import RmpgLogo from './RmpgLogo';
import StatusBar from './StatusBar';
import MenuBar from './MenuBar';
// Sidebar removed — navigation moved to top icon toolbar
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
import DispatchAlertBanner, { type AlertBannerItem } from './DispatchAlertBanner';
import { useDispatchVoiceAlerts } from '../hooks/useDispatchVoiceAlerts';

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
  '/hr': 'HR Console',
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
    { path: '/hr', icon: ClipboardCheck, label: 'HR Console' },
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

  // ── Dispatch voice alerts + visual banner state ──
  const [dispatchAlerts, setDispatchAlerts] = useState<AlertBannerItem[]>([]);
  const addDispatchAlert = useCallback((alert: AlertBannerItem) => {
    setDispatchAlerts(prev => [...prev, alert]);
  }, []);
  const dismissDispatchAlert = useCallback((id: string) => {
    setDispatchAlerts(prev => prev.filter(a => a.id !== id));
  }, []);
  const dismissAllDispatchAlerts = useCallback(() => setDispatchAlerts([]), []);
  useDispatchVoiceAlerts({ onAlert: addDispatchAlert });

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
      setSetupError(err?.message || 'Failed to save. Try again.');
    } finally {
      setSetupSaving(false);
    }
  };

  // ── Feature 21: Password expiry warning ──
  const [showPasswordExpiryWarning, setShowPasswordExpiryWarning] = useState(false);
  const [passwordExpiryDays, setPasswordExpiryDays] = useState(0);

  useEffect(() => {
    if (!user?.last_password_change && !user?.passwordChangedAt) return;
    const changedAt = user.passwordChangedAt || user.last_password_change;
    if (!changedAt) return;
    const EXPIRY_DAYS = 90; // 90-day password policy
    const changed = new Date(changedAt).getTime();
    const expiresAt = changed + EXPIRY_DAYS * 86400000;
    const daysLeft = Math.ceil((expiresAt - Date.now()) / 86400000);
    if (daysLeft <= 7 && daysLeft > 0) {
      setShowPasswordExpiryWarning(true);
      setPasswordExpiryDays(daysLeft);
    } else {
      setShowPasswordExpiryWarning(false);
    }
  }, [user?.last_password_change, user?.passwordChangedAt]);

  // ── Feature 22: Session timeout warning — DISABLED ──
  // Access tokens auto-refresh via AuthContext, so JWT expiry warnings
  // are misleading. Real session timeouts (1hr idle / 12hr max) are
  // handled by AuthContext and show messages on the login page.
  const showSessionWarning = false;

  // ── Feature 24: Auto-logout on idle ──
  const lastActivityRef = useRef(Date.now());
  const [showIdleDialog, setShowIdleDialog] = useState(false);
  const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes of no activity
  const IDLE_WARNING_MS = 55 * 60 * 1000; // Warn at 55 minutes

  useEffect(() => {
    const resetActivity = () => { lastActivityRef.current = Date.now(); setShowIdleDialog(false); };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, resetActivity));

    const checkIdle = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= IDLE_TIMEOUT_MS) {
        logout();
      } else if (idle >= IDLE_WARNING_MS) {
        setShowIdleDialog(true);
      }
    }, 30000); // check every 30s

    return () => {
      events.forEach(ev => window.removeEventListener(ev, resetActivity));
      clearInterval(checkIdle);
    };
  }, [logout]);

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

  // ── Keyboard Shortcut Help Modal ────────────────────────
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // ── Command Palette (Ctrl+K / Cmd+K) ─────────────────────
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const paletteInputRef = useRef<HTMLInputElement>(null);

  // ── Unsaved Changes Warning ─────────────────────────────
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Global keyboard shortcuts: ? for help, Ctrl/Cmd+K for palette, beforeunload for unsaved
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // ? key — show shortcut help
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
        return;
      }
    };

    // Ctrl/Cmd+K — command palette (needs to work even when in inputs)
    const paletteHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        setPaletteQuery('');
        return;
      }
      if (e.key === 'Escape' && showCommandPalette) {
        setShowCommandPalette(false);
      }
      if (e.key === 'Escape' && showShortcutHelp) {
        setShowShortcutHelp(false);
      }
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', paletteHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', paletteHandler);
    };
  }, [showCommandPalette, showShortcutHelp]);

  // Beforeunload warning for unsaved changes
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // Expose unsaved changes setter globally via window for form pages
  useEffect(() => {
    (window as any).__rmpgSetUnsavedChanges = setHasUnsavedChanges;
    return () => { delete (window as any).__rmpgSetUnsavedChanges; };
  }, []);

  // Clear unsaved changes on navigation
  useEffect(() => {
    setHasUnsavedChanges(false);
  }, [location.pathname]);

  // Command palette search results
  const paletteResults = paletteQuery.trim().length > 0
    ? TOOLBAR_NAV.flatMap(item => {
        const items: { path: string; label: string; icon: React.ElementType }[] = [];
        if (item.label.toLowerCase().includes(paletteQuery.toLowerCase())) {
          items.push({ path: item.path, label: item.label, icon: item.icon });
        }
        if (item.children) {
          item.children.forEach(child => {
            if (child.label.toLowerCase().includes(paletteQuery.toLowerCase())) {
              items.push({ path: child.path, label: child.label, icon: child.icon });
            }
          });
        }
        return items;
      }).slice(0, 10)
    : [];

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
    <div className="flex flex-col text-white overflow-hidden" style={{ background: '#141e2b', height: '100dvh' }}>
      {/* Auto-Update Banner (Electron only) */}
      {isElectron && <UpdateBanner />}

      {/* Offline Status Bar (shows when offline or syncing — Electron and browser) */}
      <OfflineStatusBar />

      {/* Dispatch severity alert banners (panic, BOLO, pursuit, etc.) */}
      <DispatchAlertBanner alerts={dispatchAlerts} onDismiss={dismissDispatchAlert} onDismissAll={dismissAllDispatchAlerts} />

      {/* GPS tracking runs silently — no blocking gate */}

      {/* ============================================================ */}
      {/* MANDATORY NAME SETUP — blocks UI until first/last name set   */}
      {/* ============================================================ */}
      {nameSetupOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', zIndex: 99999, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 18: Name setup modal with shield icon and improved shadow */}
          <div
            className="w-full max-w-sm mx-4 p-6 space-y-4"
            style={{
              background: '#141e2b',
              border: '1px solid #1e3048',
              borderTop: '3px solid #1a5a9e',
              boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            <div className="text-center space-y-1">
              <Shield className="w-8 h-8 text-brand-400 mx-auto mb-2" />
              <div className="text-lg font-bold text-white">Operator Identification Required</div>
              <div className="text-xs text-rmpg-400">
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

            <button type="button"
              onClick={handleNameSetupSave}
              disabled={setupSaving || !setupFirstName.trim() || !setupLastName.trim()}
              className="btn-primary w-full justify-center transition-colors duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
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
          className="flex items-center justify-between relative"
          style={{
            height: '52px',
            paddingLeft: isMacElectron ? '78px' : '12px',
            paddingRight: '12px',
            background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)',
            borderBottom: '1px solid #1e3048',
            flexShrink: 0,
            WebkitAppRegion: isElectron ? 'drag' : undefined,
          } as React.CSSProperties}
        >
          {/* 1: Blue accent line with subtle glow at top of brand bar */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #0e3359, #1a5a9e, #0e3359)', zIndex: 1, boxShadow: '0 1px 4px rgba(26,90,158,0.25)' }} />

          {/* Left — Logo + FLEX branding */}
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/'); }} onClick={() => navigate('/')} className="cursor-pointer flex items-center gap-2 transition-opacity duration-150 hover:opacity-90 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none rounded-sm" title="Rocky Mountain Protective Group — Dashboard" aria-label="Go to Dashboard">
              <RmpgLogo height={44} />
              {/* 2: Tighter line-height on app name for compact branding */}
              <div className="flex flex-col" style={{ lineHeight: 1.1 }}>
                <span className="text-[14px] font-bold tracking-wider text-white leading-none">RMPG</span>
                <span className="text-[10px] font-bold tracking-[0.2em] leading-none" style={{ color: '#3b8ad4' }}>FLEX</span>
              </div>
            </div>
            {/* Page title */}
            <div className="flex items-center gap-1.5">
              <div className="w-px h-6" style={{ background: '#2a3e58' }} />
              {/* 3: Page title with subtle letter-spacing and smoother color */}
              <span className="text-[11px] font-mono font-bold tracking-wider text-rmpg-300" style={{ letterSpacing: '0.08em' }}>
                {pageTitle.toUpperCase()}
              </span>
              {/* Pop-out button — opens current page in a new window */}
              {POPOUT_PAGES[location.pathname] && (
                <button type="button"
                  onClick={() => openPageWindow(location.pathname)}
                  className="toolbar-btn ml-1 transition-colors duration-150 hover:text-brand-400 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none active:scale-[0.97]"
                  title="Open in new window"
                  aria-label="Open current page in new window"
                  style={{ padding: '2px 4px' }}
                >
                  <ExternalLink className="w-3 h-3" style={{ color: '#5a6e80' }} />
                </button>
              )}
            </div>
          </div>

          {/* Right — Status indicators + PANIC + Profile */}
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* Status indicators — compact inline */}
            <div className="hidden lg:flex items-center gap-1.5">
              {/* 4: Active Calls indicator with count highlight on non-zero */}
              <button type="button"
                onClick={() => navigate('/dispatch')}
                className="flex items-center gap-1 px-2 py-0.5 panel-inset cursor-pointer transition-all duration-150 bg-surface-sunken hover:bg-rmpg-800 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
                aria-label={`Active calls: ${activeCallCount}. Click to open dispatch.`}
              >
                <Phone style={{ width: 9, height: 9 }} className={activeCallCount > 0 ? 'text-red-500' : 'text-rmpg-500'} />
                <span className="text-[9px] font-mono font-bold text-rmpg-400">CALLS:</span>
                <span className={`text-[9px] font-mono font-bold tabular-nums ${activeCallCount > 0 ? 'text-red-400' : 'text-white'}`}>{activeCallCount}</span>
              </button>

              {/* 5: BOLO Indicator with improved glow effect */}
              {activeBOLOs > 0 && (
                <button type="button"
                  onClick={() => navigate('/communications')}
                  className="flex items-center gap-1 px-2 py-0.5 cursor-pointer transition-all duration-150 hover:brightness-125 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
                  style={{ background: 'rgba(220, 38, 38, 0.25)', border: '1px solid #991b1b', boxShadow: '0 0 8px rgba(220, 38, 38, 0.2)' }}
                  aria-label={`${activeBOLOs} active BOLOs. Click to open communications.`}
                >
                  <span className="led-dot led-red animate-led-blink" />
                  <span className="text-[9px] font-mono font-bold tabular-nums" style={{ color: '#ef7a7a' }}>
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

              {/* 6: WS + Users with tabular-nums for stable count display */}
              <div className="flex items-center gap-1 px-1.5 py-0.5 panel-inset bg-surface-sunken" title={`${isConnected ? 'Connected' : 'Disconnected'} - ${presence.count} users online`}>
                <span className={`led-dot ${isConnected ? 'led-green' : 'led-red animate-led-blink'}`} />
                <Users style={{ width: 9, height: 9 }} className="text-rmpg-500" />
                <span className="text-[9px] font-mono font-bold text-rmpg-300 tabular-nums">{presence.count}</span>
              </div>

              {/* Notifications */}
              <NotificationCenter />

              {/* Search */}
              <button type="button"
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
                className="toolbar-btn transition-colors duration-150 hover:text-brand-400 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
                title="Search (Ctrl+K)"
                aria-label="Global search"
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
              <button type="button"
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className={`flex items-center gap-2 px-2 py-1 transition-all duration-150 border focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none active:scale-[0.97] ${
                  profileDropdownOpen
                    ? 'bg-rmpg-700 border-rmpg-600'
                    : 'bg-transparent border-transparent hover:bg-rmpg-800 hover:border-rmpg-700'
                }`}
                aria-haspopup="true"
                aria-expanded={profileDropdownOpen}
                aria-label="User profile menu"
              >
                {/* Avatar icon only */}
                {/* 7: Avatar with smooth ring transition on hover */}
                {user?.profile_image ? (
                  <img
                    src={user.profile_image}
                    alt={user.first_name}
                    className="w-8 h-8 object-cover transition-shadow duration-150"
                    style={{ border: '2px solid #3a5070', borderRadius: '50%', boxShadow: profileDropdownOpen ? '0 0 0 2px rgba(59,138,212,0.4)' : 'none' }}
                  />
                ) : (
                  <div
                    className="w-8 h-8 flex items-center justify-center text-[11px] font-bold transition-shadow duration-150"
                    style={{
                      background: 'linear-gradient(135deg, #124070, #1a5a9e)',
                      color: '#fff',
                      border: '2px solid #3b8ad4',
                      borderRadius: '50%',
                      boxShadow: profileDropdownOpen ? '0 0 0 2px rgba(59,138,212,0.4)' : 'none',
                    }}
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

              {/* 8: Profile Dropdown with enhanced shadow depth */}
              {profileDropdownOpen && (
                <div
                  className="menu-dropdown absolute right-0 top-full mt-0.5 animate-dropdown-appear"
                  role="menu"
                  aria-label="User profile options"
                  style={{ minWidth: 220, zIndex: 9995, boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)' }}
                >
                  {/* User info header */}
                  <div className="px-3 py-2.5 border-b border-rmpg-700" style={{ background: 'rgba(13, 21, 32, 0.5)' }}>
                    <div className="text-xs font-bold text-white">
                      {user?.first_name} {user?.last_name}
                    </div>
                    <div className="text-[9px] font-mono text-rmpg-500 mt-0.5">
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
                  <button type="button" role="menuitem" onClick={() => openProfileModal('profile')} className="menu-item w-full transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none">
                    <span className="menu-item-icon"><User style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Edit Profile</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => openProfileModal('password')} className="menu-item w-full transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none">
                    <span className="menu-item-icon"><Lock style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Change Password</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => openProfileModal('sessions')} className="menu-item w-full transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none">
                    <span className="menu-item-icon"><Shield style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Active Sessions</span>
                  </button>
                  {isAdmin && (
                    <button type="button" role="menuitem" onClick={() => { setProfileDropdownOpen(false); navigate('/admin'); }} className="menu-item w-full transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none">
                      <span className="menu-item-icon"><Settings style={{ width: 12, height: 12 }} /></span>
                      <span className="menu-item-label">System Settings</span>
                    </button>
                  )}

                  <div className="menu-separator" />

                  {/* 9: Sign Out button with red hover bg for destructive emphasis */}
                  <button type="button" role="menuitem" onClick={() => { setProfileDropdownOpen(false); logout(); }} className="menu-item w-full transition-colors duration-150 hover:bg-red-900/20 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none">
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
          background: 'linear-gradient(180deg, #1e3048 0%, #1a2636 100%)',
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

        {/* 19: Operator info with distinct badge highlight */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400">
          <span>
            OPR: <span className="text-rmpg-300">{user?.badge_number ? `#${user.badge_number}` : '---'}</span> {user?.last_name?.toUpperCase() || '---'}, {user?.first_name || '---'} <span className="text-rmpg-500">|</span> <span className="text-brand-400">{toDisplayLabel(user?.role || '---').toUpperCase()}</span>
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* TOOLBAR ROW 2 — Icon Navigation Toolbar (Spillman Flex style) */}
      {/* Square buttons: icon above label, F-key badge, dropdown for children */}
      {/* ============================================================ */}
      <div
        className="hidden md:flex items-center gap-0 px-1 select-none"
        role="toolbar"
        aria-label="Module navigation"
        style={{
          height: 46,
          background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)',
          borderBottom: '1px solid #1e3048',
          flexShrink: 0,
        }}
        data-nav-dropdown
      >
        {/* Back / Forward navigation buttons */}
        <button
          type="button"
          onClick={handleNavBack}
          disabled={!canGoBack}
          className="toolbar-btn transition-colors duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
          title="Back (Alt+←)"
          aria-label="Navigate back"
          style={{ height: 36, width: 30, padding: '2px 4px', opacity: canGoBack ? 1 : 0.3 }}
        >
          <ChevronLeft style={{ width: 14, height: 14 }} />
        </button>
        <button
          type="button"
          onClick={handleNavForward}
          disabled={!canGoForward}
          className="toolbar-btn transition-colors duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
          title="Forward (Alt+→)"
          aria-label="Navigate forward"
          style={{ height: 36, width: 30, padding: '2px 4px', opacity: canGoForward ? 1 : 0.3 }}
        >
          <ChevronRight style={{ width: 14, height: 14 }} />
        </button>
        <div
          className="self-stretch mx-0.5"
          style={{ width: 1, background: '#1e3048', margin: '6px 2px' }}
        />

        {(() => {
          let lastGroup = '';
          return TOOLBAR_NAV.filter(item => {
            if (item.adminOnly && !isAdmin) return false;
            if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(item.path)) return false;
            return true;
          }).map((item) => {
            const Icon = item.icon;
            const isActive = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
            const hasChildren = item.children && item.children.length > 0;
            const isDropdownOpen = openDropdown === item.path;
            const showSep = lastGroup !== '' && item.group !== lastGroup;
            lastGroup = item.group;

            // External link (e.g. CRM) — opens in new tab with SSO token
            if (item.externalUrl) {
              return (
                <React.Fragment key={item.path}>
                  {showSep && <div className="toolbar-separator" style={{ height: 36 }} />}
                  <button type="button"
                    onClick={() => {
                      setOpenDropdown(null);
                      const token = localStorage.getItem('rmpg_token');
                      const url = token
                        ? `${item.externalUrl}?token=${encodeURIComponent(token)}`
                        : item.externalUrl!;
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    onMouseEnter={() => { if (openDropdown) setOpenDropdown(null); }}
                    className="toolbar-btn transition-colors duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
                    title={`Open ${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
                    aria-label={`Open ${item.label} in new window`}
                    style={{ height: 44, padding: '2px 6px' }}
                  >
                    <Icon style={{ width: 16, height: 16, color: '#5a6e80', marginBottom: 1 }} />
                    <span className="font-medium leading-none" style={{ fontSize: 9, letterSpacing: '0.02em' }}>{item.label}</span>
                  </button>
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={item.path}>
                {showSep && (
                  <div
                    className="self-stretch mx-0.5"
                    style={{ width: 1, background: '#1e3048', margin: '6px 2px' }}
                  />
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasChildren) {
                        setOpenDropdown(isDropdownOpen ? null : item.path);
                      } else {
                        setOpenDropdown(null);
                        if (item.newWindow) {
                          window.open(item.path, '_blank', 'noopener,noreferrer');
                        } else {
                          navigate(item.path);
                        }
                      }
                    }}
                    className="flex flex-col items-center justify-center transition-all duration-150 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none active:scale-[0.97]"
                    style={{
                      width: 52,
                      height: 42,
                      padding: '2px 4px',
                      background: isActive
                        ? 'linear-gradient(180deg, rgba(26,90,158,0.35) 0%, rgba(26,90,158,0.15) 100%)'
                        : isDropdownOpen
                          ? 'rgba(255,255,255,0.05)'
                          : 'transparent',
                      borderBottom: isActive ? '2px solid #3b8ad4' : '2px solid transparent',
                      color: isActive ? '#ffffff' : '#8a9aaa',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive && !isDropdownOpen) {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive && !isDropdownOpen) {
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                      }
                    }}
                    title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
                    aria-label={`${item.label}${hasChildren ? ' menu' : ''}`}
                    aria-haspopup={hasChildren ? 'true' : undefined}
                    aria-expanded={hasChildren ? isDropdownOpen : undefined}
                  >
                    <Icon
                      style={{
                        width: 16,
                        height: 16,
                        color: isActive ? '#3b8ad4' : '#5a6e80',
                        marginBottom: 1,
                      }}
                    />
                    {/* Email unread badge on Comms toolbar button */}
                    {item.path === '/communications' && emailUnreadCount > 0 && (
                      <span
                        className="absolute flex items-center justify-center font-bold animate-pulse"
                        style={{
                          top: 1, left: 30,
                          minWidth: 14, height: 14, padding: '0 3px',
                          fontSize: 8, lineHeight: 1,
                          background: '#dc2626', color: '#fff',
                          borderRadius: 7, border: '1px solid #141e2b',
                          boxShadow: '0 0 6px rgba(220, 38, 38, 0.5)',
                        }}
                      >
                        {emailUnreadCount > 99 ? '99+' : emailUnreadCount}
                      </span>
                    )}
                    <span
                      className="font-medium leading-none"
                      style={{ fontSize: 9, letterSpacing: '0.02em' }}
                    >
                      {item.label}
                    </span>
                    {item.shortcut && (
                      <span
                        className="absolute font-mono"
                        style={{
                          fontSize: 7,
                          top: 2,
                          right: 3,
                          color: isActive ? '#3b8ad4' : '#3a4e60',
                        }}
                      >
                        {item.shortcut}
                      </span>
                    )}
                    {hasChildren && (
                      <ChevronDown
                        style={{
                          width: 8,
                          height: 8,
                          position: 'absolute',
                          bottom: 2,
                          right: 2,
                          color: '#3a4e60',
                          transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.15s',
                        }}
                      />
                    )}
                  </button>

                  {/* Dropdown menu for items with children */}
                  {/* 10: Toolbar dropdown with stronger shadow + left-edge align fix */}
                  {hasChildren && isDropdownOpen && (
                    <div
                      className="absolute top-full left-0 z-50 py-1 animate-dropdown-appear"
                      role="menu"
                      aria-label={`${item.label} submenu`}
                      style={{
                        minWidth: 210,
                        background: '#1a2636',
                        border: '1px solid #2a3e58',
                        borderTop: '2px solid #1a5a9e',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.3)',
                      }}
                    >
                      {item.children!.filter(child => {
                        if (child.adminOnly && !isAdmin) return false;
                        if (isContractManager && CONTRACT_MANAGER_BLOCKED_PATHS.has(child.path)) return false;
                        return true;
                      }).map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = child.path === '/' ? location.pathname === '/' : location.pathname.startsWith(child.path);
                        return (
                          <button
                            key={child.path}
                            type="button"
                            onClick={() => {
                              setOpenDropdown(null);
                              if (child.newWindow || item.newWindow) {
                                window.open(child.path, '_blank', 'noopener,noreferrer');
                              } else {
                                navigate(child.path);
                              }
                            }}
                            className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
                            role="menuitem"
                            style={{
                              color: childActive ? '#ffffff' : '#b0bcc8',
                              background: childActive ? 'rgba(26,90,158,0.15)' : 'transparent',
                            }}
                            onMouseEnter={(e) => {
                              if (!childActive) {
                                (e.currentTarget as HTMLElement).style.background = 'linear-gradient(180deg, rgba(26,90,158,0.2) 0%, rgba(26,90,158,0.1) 100%)';
                                (e.currentTarget as HTMLElement).style.color = '#ffffff';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!childActive) {
                                (e.currentTarget as HTMLElement).style.background = 'transparent';
                                (e.currentTarget as HTMLElement).style.color = '#b0bcc8';
                              }
                            }}
                          >
                            {/* 11: Slightly larger child icon + semibold label for active items */}
                            <ChildIcon style={{ width: 14, height: 14, color: childActive ? '#3b8ad4' : '#5a6e80', flexShrink: 0 }} />
                            <span className={`text-[11px] ${childActive ? 'font-semibold' : 'font-medium'}`}>{child.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          });
        })()}
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

      {/* ============================================================ */}
      {/* MAIN CONTENT AREA — Full width (no sidebar)                  */}
      {/* ============================================================ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Page Content (recessed panel) */}
        {/* 12: Main content area with subtle inset shadow for depth */}
        <main className="flex-1 overflow-auto min-h-0 panel-inset animate-page-enter scrollbar-dark" key={location.pathname} style={{ background: '#1a2636', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)' }}>
          {/* Feature 21: Password expiry warning banner */}
          {showPasswordExpiryWarning && (
            <div className="bg-amber-900/40 border-b border-amber-700/50 px-4 py-1.5 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-amber-200">
                Your password expires in <strong>{passwordExpiryDays} day{passwordExpiryDays !== 1 ? 's' : ''}</strong>.
                Please change it in your profile settings.
              </span>
              <button type="button" onClick={() => { setProfileModalOpen(true); setProfileModalTab('password'); setShowPasswordExpiryWarning(false); }} className="ml-auto text-[10px] text-amber-400 hover:text-amber-200 font-bold transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-amber-400 focus-visible:outline-none">
                Change Password
              </button>
              <button type="button" onClick={() => setShowPasswordExpiryWarning(false)} className="text-amber-500 hover:text-amber-300 transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-amber-400 focus-visible:outline-none" aria-label="Dismiss password expiry warning"><X className="w-3 h-3" /></button>
            </div>
          )}

          {/* Feature 22: Session timeout warning — removed (tokens auto-refresh) */}

          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

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

      {/* Feature 24: Auto-logout idle warning dialog */}
      {showIdleDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Idle timeout warning">
          {/* 13: Idle dialog with stronger visual hierarchy */}
          <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-6 w-[350px] text-center animate-dropdown-appear" style={{ borderTop: '3px solid #d4a017', boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <h3 className="text-white font-bold text-base mb-2">Are you still there?</h3>
            <p className="text-sm text-rmpg-300 mb-4">You will be logged out in 5 minutes due to inactivity.</p>
            <button type="button"
              onClick={() => { lastActivityRef.current = Date.now(); setShowIdleDialog(false); }}
              className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-500 rounded-sm transition-colors duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
              autoFocus
            >
              I'm still here
            </button>
          </div>
        </div>
      )}

      {/* Keyboard Shortcut Help Modal */}
      {showShortcutHelp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setShowShortcutHelp(false)}>
          {/* 14: Keyboard shortcuts modal with blue top accent */}
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm w-full max-w-md mx-4 shadow-2xl animate-dropdown-appear" style={{ borderTop: '2px solid #1a5a9e' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e3048] bg-[#0d1520]">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span className="text-brand-400">?</span> Keyboard Shortcuts</h3>
              <button type="button" onClick={() => setShowShortcutHelp(false)} className="text-rmpg-500 hover:text-white transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#1a5a9e] focus-visible:outline-none" aria-label="Close keyboard shortcuts"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto scrollbar-dark">
              <div className="space-y-1.5">
                <div className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider mb-2">Module Navigation</div>
                {TOOLBAR_NAV.filter(i => i.shortcut).map(item => (
                  <div key={item.shortcut} className="flex items-center justify-between py-1">
                    <span className="text-xs text-rmpg-200">{item.label}</span>
                    <kbd className="px-2 py-0.5 text-[10px] font-mono bg-[#0d1520] border border-[#2a3e58] text-brand-400 rounded-sm">{item.shortcut}</kbd>
                  </div>
                ))}
              </div>
              <div className="border-t border-[#1e3048] pt-3 space-y-1.5">
                <div className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider mb-2">Global</div>
                {[
                  { label: 'Command Palette', keys: navigator.platform.includes('Mac') ? 'Cmd+K' : 'Ctrl+K' },
                  { label: 'Keyboard Shortcuts', keys: '?' },
                  { label: 'Global Search', keys: navigator.platform.includes('Mac') ? 'Cmd+K' : 'Ctrl+K' },
                  { label: 'Navigate Back', keys: 'Alt+Left' },
                  { label: 'Navigate Forward', keys: 'Alt+Right' },
                  { label: 'Close Modal', keys: 'Escape' },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between py-1">
                    <span className="text-xs text-rmpg-200">{s.label}</span>
                    <kbd className="px-2 py-0.5 text-[10px] font-mono bg-[#0d1520] border border-[#2a3e58] text-brand-400 rounded-sm">{s.keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette */}
      {showCommandPalette && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Command palette" onClick={() => setShowCommandPalette(false)}>
          {/* 15: Command palette with top accent and deeper shadow */}
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm w-full max-w-lg mx-4 animate-dropdown-appear" style={{ borderTop: '2px solid #1a5a9e', boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1e3048]">
              <Search className="w-4 h-4 text-brand-400 flex-shrink-0" />
              <input
                ref={paletteInputRef}
                autoFocus
                value={paletteQuery}
                onChange={e => setPaletteQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && paletteResults.length > 0) {
                    navigate(paletteResults[0].path);
                    setShowCommandPalette(false);
                  }
                  if (e.key === 'Escape') setShowCommandPalette(false);
                }}
                placeholder="Search pages, modules..."
                className="flex-1 bg-transparent text-sm text-white placeholder-rmpg-500 focus:outline-none"
              />
              <kbd className="px-1.5 py-0.5 text-[9px] font-mono bg-[#0d1520] border border-[#2a3e58] text-rmpg-500 rounded-sm">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto scrollbar-dark">
              {paletteQuery.trim() === '' ? (
                <div className="p-4 text-center text-rmpg-500 text-xs">Type to search pages and modules<span className="text-rmpg-600 ml-1">-- start typing</span></div>
              ) : paletteResults.length === 0 ? (
                <div className="p-4 text-center text-rmpg-500 text-xs">No results found</div>
              ) : (
                paletteResults.map((result, idx) => {
                  const Icon = result.icon;
                  return (
                    <button type="button"
                      key={`${result.path}-${idx}`}
                      onClick={() => { navigate(result.path); setShowCommandPalette(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-brand-500/10 transition-colors duration-150 border-b border-[#1e3048]/50 last:border-0 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#1a5a9e] focus-visible:outline-none"
                    >
                      {/* 17: Command palette results with matched text style */}
                      <Icon className="w-4 h-4 text-brand-400 flex-shrink-0" />
                      <span className="text-sm text-white font-medium">{result.label}</span>
                      <span className="text-[10px] text-rmpg-500 ml-auto font-mono">{result.path}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
