import React, { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { lazyRetry } from '../utils/importWithRetry';
import { parseTimestamp } from '../utils/dateUtils';
import { Outlet, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  LayoutGrid,
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
  PhoneCall,
  QrCode,
  ScrollText,
  Search,
  Car,
  ClipboardPen,
  Mic,
  AlertTriangle,
  FileWarning,
  Scale,
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
  Building2,
  ShieldAlert,
  Megaphone,
  CheckCircle,
  DollarSign,
  Share2,
  // Spillman module-bar: distinct per-module glyphs (no more duplicate Shields)
  Siren,
  LifeBuoy,
  Fingerprint,
  ScanSearch,
  FileSignature,
  Webcam,
  PieChart,
  LayoutTemplate,
  Boxes,
  HeartHandshake,
  ListTodo,
  AlertOctagon,
  UsersRound,
  Pill,
  Crosshair,
  HeartPulse,
  HandHeart,
  BellRing,
  Award,
  UserPlus,
  Navigation2,
  Sun,
  Moon,
  MapPin,
  BookOpen,
  UserCheck,
  Globe,
  HelpCircle,
  Route,
  List,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PttController from './PttController';
import { initSettingsSync } from '../utils/settingsSync';
import { loadSystemSettings } from '../utils/systemSettings';
import { loadFeatureFlags, isFeatureEnabled, useFeatureFlags } from '../utils/featureFlags';
import { useWebSocket } from '../context/WebSocketContext';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { usePresence } from '../hooks/usePresence';
import RmpgLogo from './RmpgLogo';
import StatusBar from './StatusBar';
import MenuBar from './MenuBar';
// Sidebar removed — navigation moved to top icon toolbar
import ErrorBoundary from './ErrorBoundary';
import NotificationCenter from './NotificationCenter';
import SyncStatusChip from './SyncStatusChip';
import AnnouncementBanner from './AnnouncementBanner';
import PanicButton from './PanicButton';
// Lazy: 66.6 KB (plus SignaturePad's 21.9 KB, which it statically imports) and
// it renders behind a boolean. Layout wraps every authenticated route, so a
// static import here landed both in the entry chunk on every cold load.
const UserProfileModal = lazyRetry(() => import('./UserProfileModal'));
const DialerPanel = lazyRetry(() => import('./DialerPanel'));
import DispatcherTranscript from './DispatcherTranscript';
import UpdateBanner from './UpdateBanner';
import CommandPalette from './CommandPalette';
import ForcePasswordChangeModal from './ForcePasswordChangeModal';
import Force2FASetupModal from './Force2FASetupModal';
import MobileHeader from './mobile/MobileHeader';
import MobileDrawer from './mobile/MobileDrawer';
import MobileBottomNav from './mobile/MobileBottomNav';
import MobileContextBar from './mobile/MobileContextBar';
import { useIsMobile } from '../hooks/useIsMobile';
import { toDisplayLabel } from '../utils/formatters';
import { openPageWindow, isWindowablePath } from '../utils/windowManager';
import LocationGate from './LocationGate';
import DispatchAlertBanner, { type AlertBannerItem } from './DispatchAlertBanner';
import { useDispatchVoiceAlerts } from '../hooks/useDispatchVoiceAlerts';
import { useDeviceClass } from '../hooks/useDeviceClass';
import { applyThemePreference, writeThemeOverride } from '../utils/theme';
import { playUiNavigate } from '../utils/uiClickSounds';
import { useToastSafe } from './ToastProvider';
import { onNetworkChange, getNetworkStatus } from '../utils/networkStatus';

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
  '/national-warrants': 'National Warrant Search',
  '/citations': 'Citations',
  '/law-book': 'Law Book',
  '/field-interviews': 'Field Interviews',
  '/trespass-orders': 'Trespass Orders',
  '/mdt': 'MDT',
  '/mobile': 'Mobile',
  '/ncic': 'NCIC Terminal',
  '/dl-search': 'DL Search',
  '/shift-plans': 'Shift Plans',
  '/scheduler': 'Scheduler',
  '/shift-briefings': 'Shift Briefings',
  '/statute-analytics': 'Statute Analytics',
  '/reports/custom': 'Report Builder',
  '/criminal-history': 'Criminal History',
  '/evidence': 'Evidence / Property',
  '/cases': 'Case Management',
  '/crime-analysis': 'Crime Analysis',
  '/code-enforcement': 'Code Enforcement',
  '/court': 'Court Tracker',
  '/dar': 'Daily Activity Reports',
  // NSOPW is the canonical SOR surface; old paths redirect (see App.tsx).
  '/nsopw': 'Sex Offender Registry',
  '/reports': 'Reports',
  '/forensic-lab': 'Forensic Lab',
  '/audit': 'Audit Log',
  '/crm': 'Overwatch',
  '/training': 'Training Management',
  '/training-docs': 'Training Documents',
  '/serve': 'Process Server',
  '/hr': 'HR Console',
  '/admin': 'Admin',
  '/use-of-force': 'Use of Force',
  '/security-dashboard': 'Security Dashboard',
  '/help': 'Help & About',
  '/notifications': 'Notifications',
  '/colorado-doc': 'Colorado DOC Search',
  '/dashcams': 'Dashcam System',
  '/command-center': 'Command Center',
  '/geo-data-viewer': 'Geo Data Viewer',
  '/invoices': 'Invoices',
  '/iped': 'IPED Forensics',
  '/national-warrant-search': 'National Warrant Search',
  '/downloads': 'Downloads',
  '/geography': 'Dispatch Geography',
  '/dialer-connect': 'Dialer Connect',
  '/connections': 'Connections',
  '/intel': 'Intel Search',
  '/intel/plate-log': 'Plate Log',
  '/intel/quick-capture': 'Quick Capture',
  '/intel/jail': 'Jail Records',
  '/intel/record': 'Interaction Recorder',
  '/skip-tracer': 'Skip Tracer',
  '/arrest-records': 'Arrest Records',
  '/serve-intake': 'Service Intake',
  '/web-research': 'Web Research',
  '/settings': 'Settings',
  '/route-builder': 'Navigation & Route Planning',
  '/jail': 'Jail Management',
  '/affairs': 'Internal Affairs',
  '/assets': 'Asset Management',
  '/community': 'Community Relations',
  '/tasks': 'Task Management',
  '/alerts': 'Alert Center',
  '/training-mgmt': 'Training Admin',
  '/qa': 'Quality Assurance',
  '/billing': 'Billing',
  '/court-records': 'Court Records',
  '/documents': 'Documents',
  '/dashcam-ai': 'Dashcam AI Console',
  '/risk': 'Risk Management',
  '/interagency': 'Interagency',
  '/body-cameras': 'Body Cameras',
  '/dash-cameras': 'Dash Cameras',
  '/microbilt': 'MicroBilt',
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
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', group: 'ops', shortcut: 'F1', children: [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/command-center', icon: Crosshair, label: 'Command Center' },
    { path: '/security-dashboard', icon: Shield, label: 'Security Dashboard' },
    { path: '/help', icon: HelpCircle, label: 'Help & About' },
  ]},
  { path: '/dispatch', icon: Radio, label: 'Dispatch', group: 'ops', shortcut: 'F2', children: [
    { path: '/dispatch', icon: Radio, label: 'Dispatch Board' },
    { path: '/mdt', icon: Monitor, label: 'MDT Terminal' },
    { path: '/geography', icon: MapPin, label: 'Geography / Zones' },
    { path: '/scheduler', icon: Calendar, label: 'Scheduler' },
    { path: '/shift-plans', icon: Calendar, label: 'Shift Plans' },
    { path: '/dar', icon: ClipboardCheck, label: 'Daily Activity' },
    { path: '/arrest-records', icon: Siren, label: 'Arrest Records' },
    { path: '/dialer-connect', icon: PhoneCall, label: 'Dialer Connect' },
  ]},
  { path: '/map', icon: Map, label: 'Map', group: 'ops', shortcut: 'F3', children: [
    { path: '/map', icon: Map, label: 'Live Map' },
    { path: '/navigation', icon: Route, label: 'Navigation & Route Planning' },
    { path: '/route-builder', icon: Route, label: 'CFS Route Builder' },
    { path: '/geo-data-viewer', icon: MapPin, label: 'Geo Data Viewer' },
    { path: '/command-center', icon: Crosshair, label: 'Command Center' },
  ]},
  { path: '/mdt', icon: Monitor, label: 'MDT', group: 'ops', shortcut: 'F4' },
  { path: '/ncic', icon: Terminal, label: 'NCIC', group: 'ops', shortcut: 'F5', children: [
    { path: '/ncic', icon: Terminal, label: 'NCIC Terminal' },
    { path: '/dl-search', icon: CreditCard, label: 'DL Search' },
    { path: '/criminal-history', icon: Search, label: 'Criminal History' },
    { path: '/national-warrant-search', icon: Globe, label: 'National Warrant Search' },
    { path: '/colorado-doc', icon: UserCheck, label: 'Colorado DOC Search' },
    { path: '/nsopw', icon: UserCheck, label: 'Sex Offender Registry' },
  ]},
  { path: '/records', icon: Database, label: 'Records', group: 'records', shortcut: 'F6', children: [
    { path: '/incidents', icon: FileText, label: 'Incidents' },
    { path: '/records', icon: Database, label: 'Records' },
    { path: '/field-interviews', icon: ClipboardList, label: 'Field Interviews' },
    { path: '/criminal-history', icon: Fingerprint, label: 'Criminal History' },
    { path: '/dl-search', icon: CreditCard, label: 'DL Search' },
    { path: '/microbilt', icon: ScanSearch, label: 'MicroBilt' },
    { path: '/evidence', icon: Package, label: 'Evidence / Property' },
    { path: '/forensic-lab', icon: Microscope, label: 'Forensic Lab' },
    { path: '/connections', icon: Network, label: 'Connections' },
    { path: '/intel', icon: ScanSearch, label: 'Intel Search' },
    { path: '/intel/plate-log', icon: Car, label: 'Plate Log' },
    { path: '/intel/quick-capture', icon: ClipboardPen, label: 'Quick Capture' },
    { path: '/intel/jail', icon: Building2, label: 'Jail Records' },
    { path: '/intel/record', icon: Mic, label: 'Recorder' },
    { path: '/cases', icon: Briefcase, label: 'Case Management' },
    { path: '/arrest-records', icon: Siren, label: 'Arrest Records' },
    { path: '/web-research', icon: Globe, label: 'Web Research' },
    { path: '/documents', icon: FileText, label: 'Documents' },
  ]},
  { path: '/warrants', icon: Siren, label: 'Enforce', group: 'records', shortcut: 'F7', children: [
    { path: '/warrants', icon: AlertTriangle, label: 'Warrants' },
    { path: '/citations', icon: FileWarning, label: 'Citations' },
    { path: '/law-book', icon: Scale, label: 'Law Book' },
    { path: '/trespass-orders', icon: ShieldBan, label: 'Trespass Orders' },
    { path: '/code-enforcement', icon: Construction, label: 'Code Enforcement' },
    { path: '/court', icon: Gavel, label: 'Court Tracker' },
    { path: '/court-records', icon: Gavel, label: 'Court Records' },
    { path: '/nsopw', icon: UserCheck, label: 'Sex Offender Registry' },
    { path: '/serve', icon: FileSignature, label: 'Process Server' },
    { path: '/serve-intake', icon: FileText, label: 'Serve Intake' },
    { path: '/use-of-force', icon: Shield, label: 'Use of Force' },
    { path: '/national-warrant-search', icon: Globe, label: 'National Warrant Search' },
    { path: '/arrest-records', icon: Siren, label: 'Arrest Records' },
  ]},
  { path: '/personnel', icon: Users, label: 'Personnel', group: 'records', shortcut: 'F8', children: [
    { path: '/personnel', icon: Users, label: 'Personnel' },
    { path: '/hr', icon: ClipboardCheck, label: 'HR Console' },
    { path: '/fleet', icon: Car, label: 'Fleet' },
    { path: '/body-cameras', icon: Video, label: 'Body Cameras' },
    { path: '/dash-cameras', icon: Camera, label: 'Dash Cameras' },
    { path: '/dashcams', icon: Webcam, label: 'Dashcam System' },
    { path: '/dashcam-ai', icon: Camera, label: 'Dashcam AI Console' },
    { path: '/training', icon: GraduationCap, label: 'Training' },
    { path: '/training-docs', icon: BookOpen, label: 'Training Docs' },
  ]},
  { path: '/communications', icon: MessageSquare, label: 'Comms', group: 'comms', shortcut: 'F9', children: [
    { path: '/communications', icon: MessageSquare, label: 'Comms' },
    { path: '/dialer-connect', icon: Phone, label: 'Dial Connect' },
    { path: '/radio', icon: Radio, label: 'Radio' },
    { path: '/email', icon: Mail, label: 'Email' },
    { path: '/patrol', icon: QrCode, label: 'Patrol' },
    { path: '/notifications', icon: Megaphone, label: 'Alert Center' },
    { path: '/alerts', icon: AlertTriangle, label: 'Notifications' },
  ]},
  { path: '/reports', icon: BarChart3, label: 'Reports', group: 'analysis', shortcut: 'F10', children: [
    { path: '/reports', icon: BarChart3, label: 'Reports' },
    { path: '/scheduler', icon: Calendar, label: 'Scheduler' },
    { path: '/shift-plans', icon: Calendar, label: 'Shift Plans' },
    { path: '/statute-analytics', icon: PieChart, label: 'Statute Analytics' },
    { path: '/reports/custom', icon: LayoutTemplate, label: 'Report Builder' },
    { path: '/crime-analysis', icon: TrendingUp, label: 'Crime Analysis' },
    { path: '/dar', icon: ClipboardCheck, label: 'Daily Activity' },
    { path: '/forensic-lab', icon: Microscope, label: 'Forensic Lab' },
    { path: '/connections', icon: Network, label: 'Connections' },
    { path: '/intel', icon: ScanSearch, label: 'Intel Search' },
    { path: '/invoices', icon: DollarSign, label: 'Invoices' },
  ]},
  { path: '/crm', icon: Briefcase, label: 'Overwatch', group: 'analysis', children: [
    { path: '/crm', icon: Briefcase, label: 'Overwatch' },
    { path: '/community', icon: Users, label: 'Community' },
  ]},
  { path: '/training', icon: GraduationCap, label: 'Training', group: 'analysis', children: [
    { path: '/training', icon: GraduationCap, label: 'Training' },
    { path: '/training-docs', icon: BookOpen, label: 'Training Docs' },
    { path: '/training-mgmt', icon: ClipboardCheck, label: 'Training Admin' },
  ]},
  { path: '/connections', icon: Network, label: 'Connections', group: 'analysis', adminOnly: true, children: [
    { path: '/connections', icon: Network, label: 'Connection Analysis' },
    { path: '/intel', icon: ScanSearch, label: 'Intel Search' },
    { path: '/forensic-lab', icon: Microscope, label: 'Forensic Lab' },
    { path: '/iped', icon: Microscope, label: 'IPED Forensics' },
  ]},
  { path: '/jail', icon: Building2, label: 'Jail/IA', group: 'support', children: [
    { path: '/jail', icon: Building2, label: 'Jail Management' },
    { path: '/affairs', icon: ShieldAlert, label: 'Internal Affairs' },
    { path: '/assets', icon: Boxes, label: 'Asset Management' },
  ]},
  { path: '/billing', icon: LifeBuoy, label: 'Services', group: 'support', children: [
    { path: '/billing', icon: DollarSign, label: 'Billing' },
    { path: '/community', icon: HeartHandshake, label: 'Community' },
    { path: '/tasks', icon: ListTodo, label: 'Task Management' },
    { path: '/alerts', icon: Megaphone, label: 'Notifications' },
    { path: '/qa', icon: CheckCircle, label: 'QA' },
    { path: '/risk', icon: AlertOctagon, label: 'Risk Management' },
    { path: '/interagency', icon: Share2, label: 'Interagency' },
    { path: '/gang-intel', icon: UsersRound, label: 'Gang Intel' },
    { path: '/narcotics', icon: Pill, label: 'Narcotics' },
    { path: '/special-ops', icon: Crosshair, label: 'Special Ops' },
    { path: '/crisis-response', icon: HeartPulse, label: 'Crisis Response' },
    { path: '/victim-services', icon: HandHeart, label: 'Victim Services' },
    { path: '/alarms', icon: BellRing, label: 'Alarm Management' },
    { path: '/accreditation', icon: Award, label: 'Accreditation' },
    { path: '/recruitment', icon: UserPlus, label: 'Recruitment' },
    { path: '/invoices', icon: DollarSign, label: 'Invoices' },
    { path: '/command-center', icon: Crosshair, label: 'Command Center' },
  ]},
  { path: '/audit', icon: ScrollText, label: 'Audit', group: 'system', shortcut: 'F11', adminOnly: true },
  { path: '/admin', icon: Settings, label: 'Admin', group: 'system', shortcut: 'F12', adminOnly: true },
  { path: '/navigation', icon: Navigation2, label: 'Nav Index', group: 'system' },
  { path: '/desktop', icon: LayoutGrid, label: 'Desktop', group: 'system' },
];

// Paths that client_viewer role is NOT allowed to see
const CLIENT_VIEWER_BLOCKED_PATHS = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/radio', '/patrol', '/shift-plans', '/scheduler', '/shift-briefings', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar', '/dialer-connect',
]);

// Paths that contract_manager role is NOT allowed to see
const CONTRACT_MANAGER_BLOCKED_PATHS = new Set([
  '/admin', '/personnel', '/users',
]);

export default function Layout() {
  const flagsTick = useFeatureFlags();
  const { user, logout, signOut, refreshUser } = useAuth();
  // `logout` is still exported for forced flows (password change). The
  // user-facing Sign Out button uses `signOut`, which gates on shift state.
  void logout;
  const handleSignOutClick = useCallback(async () => {
    setProfileDropdownOpen(false);
    const result = await signOut();
    if (!result.ok) {
      toast?.addToast(result.message, 'error', 8000);
    }
  }, [signOut]);
  const { isConnected, subscribe } = useWebSocket();
  const location = useLocation();
  const navigate = useNavigate();

  // NOTE (2026-08-01): an `isFullBleedPage` flag used to be computed here,
  // listing /map, /route-builder and /geography, with a comment claiming those
  // pages needed `overflow-hidden` on <main> "so child height: 100% resolves
  // correctly for Mapbox GL / map containers." It was never applied anywhere —
  // dead since PR-2170 — and the premise was wrong: <main> already has a definite
  // height (flex-1 + min-h-0 inside a 100dvh column), so `h-full` children
  // resolve fine, measured live at 933px. The real reason map containers
  // collapsed was a CSS specificity collision — mapbox-gl.css's
  // `.mapboxgl-map { position: relative }` loads after Tailwind's `.absolute`
  // and wins on source order, so `absolute inset-0` containers computed
  // `relative` and shrank to ~12px. That is fixed by specificity in
  // index.css ("MAPBOX CONTAINER POSITION COLLISION"). Removed rather than
  // wired up, so nobody re-derives the wrong diagnosis from it. <main> keeps
  // `overflow-auto` — the per-path scroll restore below depends on it.

  // Stamps device-fz55 on <html> when running on a Toughbook FZ-55.
  // The CSS in fz55.css scopes all layout fixes under that class.
  useDeviceClass();

  const gps = useGpsTracking();
  const toast = useToastSafe();
  useEffect(() => {
    if (!gps.addToastRef) return;
    gps.addToastRef.current = toast
      ? (toast.addToast as (msg: string, type: string, duration?: number) => void)
      : null;
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // Cap history at 50 entries to prevent unbounded growth over long sessions
    if (navHistoryRef.current.length > 50) {
      navHistoryRef.current = navHistoryRef.current.slice(-50);
    }
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
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to save. Try again.');
    } finally {
      setSetupSaving(false);
    }
  };

  // ── Feature 21: Password expiry warning ──
  const [showPasswordExpiryWarning, setShowPasswordExpiryWarning] = useState(false);
  const [isOffline, setIsOffline] = useState(!getNetworkStatus());
  const [passwordExpiryDays, setPasswordExpiryDays] = useState(0);

  useEffect(() => {
    return onNetworkChange((online) => setIsOffline(!online));
  }, []);

  useEffect(() => {
    if (!user?.last_password_change && !user?.passwordChangedAt) return;
    const changedAt = user.passwordChangedAt || user.last_password_change;
    if (!changedAt) return;
    const EXPIRY_DAYS = 90; // 90-day password policy
    const changed = parseTimestamp(changedAt).getTime();
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

  // ── Feature 24: Auto-logout on idle — REMOVED per operator request ──
  // The idle backstop that signed a workstation out after 12h of zero
  // user presence + zero network traffic has been removed. Sessions now
  // persist until the user explicitly signs out (access tokens still
  // auto-refresh via AuthContext, so the session simply stays alive).

  // Live header stats
  const [activeCallCount, setActiveCallCount] = useState(0);
  const [callsByPriority, setCallsByPriority] = useState<{priority: string; count: number}[]>([]);

  // Phase 5: warrant scraper health — polls /api/warrants/scrapers/health every 30s.
  // The badge is visible ONLY when any source is degraded/failed/broken — alert
  // fatigue is real, so when everything's healthy the badge disappears entirely.
  const [scraperHealth, setScraperHealth] = useState<{
    healthy: number; degraded: number; failed: number; circuit_broken: number;
  } | null>(null);
  const [activeBOLOs, setActiveBOLOs] = useState(0);
  const [emailUnreadCount, setEmailUnreadCount] = useState(0);

  // Mobile context bar — officer's current radio channel + assigned call
  const [mobileRadioChannel, setMobileRadioChannel] = useState<string | null>(null);
  const [mobileActiveCallNumber, setMobileActiveCallNumber] = useState<string | null>(null);

  // Toolbar nav dropdowns
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  // Position of the open toolbar dropdown (viewport coords, so position:fixed
  // escapes the toolbar's overflow-x-auto containing block). Recomputed on
  // scroll/resize so the panel follows the triggering button.
  const toolbarBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [dropdownRect, setDropdownRect] = useState<{ left: number; top: number; width: number } | null>(null);
  // Close dropdown on route change + Spillman MDT page-flip chirp
  useEffect(() => { setOpenDropdown(null); playUiNavigate(); }, [location.pathname]);

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

  // Keep the open dropdown glued to its triggering button as the user scrolls
  // the toolbar (overflow-x-auto) or resizes the window. Without this, the
  // fixed-position panel would stay parked at the original viewport coords
  // while the button slides out from under it.
  useEffect(() => {
    if (!openDropdown) { setDropdownRect(null); return; }
    const update = () => {
      const btn = toolbarBtnRefs.current[openDropdown];
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setDropdownRect({ left: r.left, top: r.bottom, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    // capture:true so we hear the toolbar's own scroll (overflow-x-auto),
    // not just window scroll.
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
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
        if (!isFeatureEnabled(item.path)) return false;
        return true;
      });

      const idx = fNum - 1;
      if (idx >= visibleNav.length) return;

      const item = visibleNav[idx];
      e.preventDefault();

      // External links open in new tab (no token in URL — auth must not travel in query strings)
      if (item.externalUrl) {
        window.open(item.externalUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      navigate(item.path);
      setOpenDropdown(null);
    };

    window.addEventListener('keydown', handleFKey);
    return () => window.removeEventListener('keydown', handleFKey);
  }, [navigate, isAdmin, isClientViewer, flagsTick]);

  // ── Keyboard Shortcut Help Modal ────────────────────────
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // ── Command Palette (Ctrl+K / Cmd+K) ─────────────────────
  // State lives here so the global Cmd+K handler can toggle it; the palette
  // UI + search/nav logic is the self-contained <CommandPalette> component.
  const [showCommandPalette, setShowCommandPalette] = useState(false);

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

  // Settings sync — pull this user's saved prefs (+ org defaults) once on
  // login, then debounce-push local changes so they follow the user across
  // devices. Lives here so it runs for the whole authenticated session.
  useEffect(() => {
    if (!user) return;
    // Pull org-wide system settings (Console Settings) and apply Display
    // settings to the document root. Branding/localization/report values
    // are read at their own call sites via getSystemSetting.
    loadSystemSettings();
    loadFeatureFlags();
    return initSettingsSync();
    // Keyed on the user ID, NOT the user object. GET /api/settings is a pure
    // function of the actor id (src/routes/settings.ts: org is `WHERE id = 1`,
    // system is the whole table, and only the user blob is `WHERE user_id = ?`
    // — the handler never reads actor.role), so nothing in this payload can
    // change without the id changing.
    //
    // Depending on the object re-ran this effect on every cold boot: AuthContext
    // seeds `user` from localStorage for an instant paint, then its background
    // /auth/me validation calls setUser() with a FRESH OBJECT for the same
    // person. Each run tears down and re-inits settingsSync (its `started`
    // guard is released by the cleanup), so the pair of /api/settings reads
    // below fired twice — 4 requests per boot against the 600 req/300 s budget
    // in src/middleware/rateLimit.ts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Clear unsaved changes on navigation
  useEffect(() => {
    setHasUnsavedChanges(false);
  }, [location.pathname]);

  // Command palette search results
  // Flattened, role-filtered navigation targets (parents + children) for the
  // command palette. Mirrors the toolbar's role gating so the palette never
  // surfaces a page the user can't open. De-duped by path.
  const paletteNavTargets = useMemo(() => {
    const seen = new Set<string>();
    const targets: { path: string; label: string; icon: React.ElementType }[] = [];
    const allow = (path: string, adminOnly?: boolean) => {
      if (adminOnly && !isAdmin) return false;
      if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(path)) return false;
      if (!isFeatureEnabled(path)) return false;
      return true;
    };
    for (const item of TOOLBAR_NAV) {
      if (allow(item.path, item.adminOnly) && !seen.has(item.path)) {
        seen.add(item.path);
        targets.push({ path: item.path, label: item.label, icon: item.icon });
      }
      item.children?.forEach((child) => {
        if (allow(child.path, child.adminOnly) && !seen.has(child.path)) {
          seen.add(child.path);
          targets.push({ path: child.path, label: child.label, icon: child.icon });
        }
      });
    }
    return targets;
  }, [isAdmin, isClientViewer, flagsTick]);

  // Mobile menu & responsive detection
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile(1024); // iPad portrait + small landscape get the touch shell (lg breakpoint)

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
  // Latch: once the profile modal has ever been opened, keep it mounted forever
  // after (never unmount on close). UserProfileModal is React.lazy — a lazy
  // component fetches its chunk the moment it is COMMITTED to the tree, not
  // when isOpen becomes true. If we mounted it unconditionally (as before),
  // Layout mounting on every authenticated page load would fetch the
  // UserProfileModal + SignaturePad chunk on every boot, defeating the whole
  // point of deferring it. Gating on a bare `profileModalOpen` instead would
  // unmount the modal the instant it closes, killing any close/exit
  // transition and resetting its internal state mid-animation. This latch
  // fetches the chunk once, on first open, and never unmounts after — do not
  // "simplify" this back to a plain boolean check.
  const [profileModalEverOpened, setProfileModalEverOpened] = useState(false);
  useEffect(() => {
    if (profileModalOpen) setProfileModalEverOpened(true);
  }, [profileModalOpen]);
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  // Lightweight poll: dispatch stats + BOLOs — runs on every dispatch/bolo event.
  const fetchDispatchStats = useCallback(async () => {
    try {
      const stats = await apiFetch<any>('/dispatch/stats');
      setActiveCallCount(stats.activeCalls || 0);
      if (Array.isArray(stats.callsByPriority)) setCallsByPriority(stats.callsByPriority);
    } catch { /* silent */ }
    try {
      const bolos = await apiFetch<any>('/comms/bolos/active');
      setActiveBOLOs(Array.isArray(bolos) ? bolos.length : 0);
    } catch { /* silent */ }
  }, []);

  // Heavier poll: scraper health + email — only on the 30 s timer, not per-event.
  // Scraper health is a slow-changing indicator; polling it on every dispatch_update
  // produced ×11 concurrent calls during a busy shift (F-006).
  const fetchHeaderStats = useCallback(async () => {
    await fetchDispatchStats();
    try {
      const email = await apiFetch<{ count: number }>('/email/unread-count');
      setEmailUnreadCount(email.count || 0);
    } catch { /* silent — email may not be configured */ }
    try {
      const health = await apiFetch<{ healthy: number; degraded: number; failed: number; circuit_broken: number }>('/warrants/scrapers/health');
      setScraperHealth(health);
    } catch { /* silent — scraper may not be enabled */ }
  }, [fetchDispatchStats]);

  // Full stats on mount and every 30 seconds
  useEffect(() => {
    fetchHeaderStats();
    const interval = setInterval(fetchHeaderStats, 30000);
    return () => clearInterval(interval);
  }, [fetchHeaderStats]);

  // Lightweight dispatch/bolo event handler — no scraper health call
  useEffect(() => {
    const unsub1 = subscribe('dispatch_update', () => fetchDispatchStats());
    const unsub2 = subscribe('bolo_alert', () => fetchDispatchStats());
    const unsub3 = subscribe('email:new_messages', () => {
      apiFetch<{ count: number }>('/email/unread-count')
        .then(r => { setEmailUnreadCount(r.count || 0); })
        .catch((err) => { console.warn('[Layout] fetch email unread count failed:', err); });
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [subscribe, fetchDispatchStats]);

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

    // Active call: track the call number assigned to THIS unit. The live Worker
    // broadcasts call lifecycle events under 'dispatch_update' (the old
    // 'units:status' / 'calls:updated' channels are never emitted, so the mobile
    // active-call bar never updated). The call payload is the raw call row, whose
    // assigned units live in the comma-joined `unit_call_signs` field.
    const unsubMobileActive = subscribe('dispatch_update', (msg: any) => {
      const data = msg.data || msg;
      const action = data.action;
      if (!gps.unitCallSign) return;
      if ((action === 'call_status_changed' || action === 'call_updated' || action === 'call_created') && data.call) {
        const assigned = String(data.call.unit_call_signs || '')
          .split(',').map((s: string) => s.trim()).filter(Boolean);
        if (assigned.includes(gps.unitCallSign)) {
          const done = ['cleared', 'closed', 'cancelled', 'archived'].includes(data.call.status);
          setMobileActiveCallNumber(done ? null : (data.call.call_number || null));
        }
      }
    });

    return () => {
      unsubRadioState();
      unsubRadioLeave();
      unsubMobileActive();
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

  // Standalone mode: page is running inside a FloatingWindow iframe.
  // Render only the page content — no nav bar, no top bar, no banners.
  const isStandalone = new URLSearchParams(window.location.search).get('standalone') === '1';
  if (isStandalone) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--surface-base)', overflow: 'hidden' }}>
        <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col text-rmpg-100 overflow-hidden" style={{ background: 'var(--surface-base)', height: '100dvh' }}>
      {/* Auto-Update Banner (Electron only) */}
      {isElectron && <UpdateBanner />}

      {/* Dispatch severity alert banners (panic, BOLO, pursuit, etc.) */}
      <DispatchAlertBanner alerts={dispatchAlerts} onDismiss={dismissDispatchAlert} onDismissAll={dismissAllDispatchAlerts} />

      {/* GPS tracking runs silently — no blocking gate */}

      {/* ============================================================ */}
      {/* MANDATORY NAME SETUP — blocks UI until first/last name set   */}
      {/* ============================================================ */}
      {nameSetupOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: 'rgba(var(--surface-overlay-rgb) / 0.92)', zIndex: 99999, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 18: Name setup modal with shield icon and improved shadow */}
          <div
            className="w-full max-w-sm mx-4 p-6 space-y-4"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-default)',
              borderTop: '3px solid var(--accent-silver-500)',
              boxShadow: '0 16px 48px rgba(var(--surface-overlay-rgb) / 0.8)',
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            <div className="text-center space-y-1">
              <Shield className="w-8 h-8 text-brand-400 mx-auto mb-2" />
              <div className="text-lg font-bold text-rmpg-100">Operator Identification Required</div>
              <div className="text-xs text-rmpg-400">
                Enter your name to continue. This will appear in the OPR system and all reports.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-layout-0" className="field-label">First Name <span className="text-red-500">*</span></label>
                <input id="ff-layout-0"
                  type="text"
                  value={setupFirstName}
                  onChange={e => setSetupFirstName(e.target.value)}
                  className="input-dark"
                  placeholder="First"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="ff-layout-1" className="field-label">Last Name <span className="text-red-500">*</span></label>
                <input id="ff-layout-1"
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
              className="btn-primary w-full justify-center transition-colors duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none"
            >
              {setupSaving ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {/* Fix 30: Skip to main content link for keyboard/screen reader users */}
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

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
            background: 'linear-gradient(180deg, var(--desktop-shell-start) 0%, var(--desktop-shell-end) 100%)',
            borderBottom: '1px solid var(--desktop-shell-border)',
            flexShrink: 0,
            WebkitAppRegion: isElectron ? 'drag' : undefined,
          } as React.CSSProperties}
        >
          {/* 1: Blue accent line with subtle glow at top of brand bar */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{
              background: 'linear-gradient(90deg, transparent, var(--desktop-shell-accent), transparent)',
              zIndex: 1,
              boxShadow: '0 1px 4px var(--desktop-shell-accent-shadow)',
            }}
          />

          {/* Left — Logo + FLEX branding */}
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/'); }} onClick={() => navigate('/')} className="cursor-pointer flex items-center gap-2 transition-opacity duration-150 hover:opacity-90 focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none rounded-sm" title="Rocky Mountain Protective Group — Dashboard" aria-label="Go to Dashboard">
              <RmpgLogo height={44} />
            </div>
            {/* Page title */}
            <div className="flex items-center gap-1.5">
              <div className="w-px h-6" style={{ background: 'var(--desktop-shell-border)' }} />
              {/* 3: Page title with subtle letter-spacing and smoother color */}
              <span className="text-[11px] font-mono font-bold tracking-wider text-rmpg-300" style={{ letterSpacing: '0.08em' }}>
                {pageTitle.toUpperCase()}
              </span>
              {/* Pop-out button — opens current page in a new window */}
              {isWindowablePath(location.pathname) && (
                <button type="button"
                  onClick={() => openPageWindow(location.pathname)}
                  className="toolbar-btn ml-1 transition-colors duration-150 hover:text-brand-400 focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none active:scale-[0.97]"
                  title="Open in new window"
                  aria-label="Open current page in new window"
                  style={{ padding: '2px 4px' }}
                >
                  <ExternalLink className="w-3 h-3" style={{ color: 'var(--desktop-shell-icon)' }} />
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
                className="flex items-center gap-1 px-2 py-0.5 panel-inset cursor-pointer transition-all duration-150 bg-surface-sunken hover:bg-rmpg-800 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none"
                aria-label={`Active calls: ${activeCallCount}. Click to open dispatch.`}
              >
                <Phone style={{ width: 9, height: 9 }} className={activeCallCount > 0 ? 'text-red-500' : 'text-fg-muted'} />
                <span className="text-[9px] font-mono font-bold text-rmpg-400">CALLS:</span>
                <span className={`text-[9px] font-mono font-bold tabular-nums ${activeCallCount > 0 ? 'text-red-400' : 'text-rmpg-100'}`}>{activeCallCount}</span>
              </button>

              {/* 5: BOLO Indicator with improved glow effect */}
              {activeBOLOs > 0 && (
                <button type="button"
                  onClick={() => navigate('/communications')}
                  className="flex items-center gap-1 px-2 py-0.5 cursor-pointer transition-all duration-150 hover:brightness-125 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none"
                  style={{ background: 'rgba(var(--sev-critical-rgb) / 0.25)', border: '1px solid rgba(var(--sev-critical-rgb) / 0.5)', boxShadow: '0 0 8px rgba(var(--sev-critical-rgb) / 0.2)' }}
                  aria-label={`${activeBOLOs} active BOLOs. Click to open communications.`}
                >
                  <span className="led-dot led-red animate-led-blink" />
                  <span className="text-[9px] font-mono font-bold tabular-nums" style={{ color: 'var(--sev-critical-soft)' }}>
                    BOLO: {activeBOLOs}
                  </span>
                </button>
              )}

              {/* GPS */}
              <div
                className="flex items-center gap-1 px-1.5 py-0.5 panel-inset"
                style={{ background: gps.isTracking ? 'rgba(34, 197, 94, 0.1)' : 'var(--surface-overlay)' }}
                title={gps.isTracking ? `GPS ON — ${gps.unitCallSign || (gps.hasTakeHome ? 'Take-Home Vehicle' : 'no unit')}` : 'GPS acquiring...'}
              >
                <Navigation2 style={{ width: 9, height: 9, color: gps.isTracking ? 'var(--sev-ok)' : 'var(--text-muted)', transform: gps.heading != null ? `rotate(${gps.heading}deg)` : undefined }} />
                {gps.isTracking && <span className="led-dot led-green animate-led-blink" />}
              </div>

              {/* 6: WS + Users with tabular-nums for stable count display */}
              <div className="flex items-center gap-1 px-1.5 py-0.5 panel-inset bg-surface-sunken" title={`${isConnected ? 'Connected' : 'Disconnected'} - ${presence.count} users online`}>
                <span className={`led-dot ${isConnected ? 'led-green' : 'led-red animate-led-blink'}`} />
                <Users style={{ width: 9, height: 9 }} className="text-fg-muted" />
                <span className="text-[9px] font-mono font-bold text-rmpg-300 tabular-nums">{presence.count}</span>
              </div>

              {/* 7: Warrant scraper health — invisible when all healthy (alert fatigue) */}
              {scraperHealth && (scraperHealth.degraded + scraperHealth.failed + scraperHealth.circuit_broken) > 0 && (
                <button
                  type="button"
                  onClick={() => navigate('/warrants?tab=scrapers')}
                  className="flex items-center gap-1 px-1.5 py-0.5 panel-inset bg-surface-sunken hover:bg-surface-raised transition-colors"
                  title={`Warrant scrapers: ${scraperHealth.healthy} healthy, ${scraperHealth.degraded} degraded, ${scraperHealth.failed} failed, ${scraperHealth.circuit_broken} broken`}
                >
                  {scraperHealth.healthy > 0 && (
                    <span className="text-[9px] font-mono font-bold text-green-400 tabular-nums">●{scraperHealth.healthy}</span>
                  )}
                  {scraperHealth.degraded > 0 && (
                    <span className="text-[9px] font-mono font-bold text-amber-400 tabular-nums">◐{scraperHealth.degraded}</span>
                  )}
                  {scraperHealth.failed > 0 && (
                    <span className="text-[9px] font-mono font-bold text-red-400 tabular-nums">○{scraperHealth.failed}</span>
                  )}
                  {scraperHealth.circuit_broken > 0 && (
                    <span className="text-[9px] font-mono font-bold text-red-600 tabular-nums">✕{scraperHealth.circuit_broken}</span>
                  )}
                </button>
              )}

              {/* FZ-55 server mode indicator */}
              <SyncStatusChip />

              {/* Notifications */}
              <NotificationCenter />

              {/* Theme Toggle */}
              <button type="button"
                onClick={() => {
                  const html = document.documentElement;
                  const isLight = html.classList.contains('theme-light');
                  const next = isLight ? 'dark' : 'light';
                  writeThemeOverride({ theme: next, active: true });
                  applyThemePreference(next, { persist: false });
                  // Persist via API (best-effort mirror)
                  apiFetch('/user/preferences', { method: 'PUT', body: JSON.stringify({ theme_preference: next }) }).catch(() => {});
                }}
                className="toolbar-btn transition-colors duration-150 hover:text-brand-400 active:scale-[0.97]"
                title="Toggle Light/Dark Theme"
                aria-label="Toggle theme"
                style={{ padding: '2px 6px' }}
              >
                {document.documentElement.classList.contains('theme-light')
                  ? <Moon style={{ width: 10, height: 10 }} />
                  : <Sun style={{ width: 10, height: 10 }} />
                }
              </button>

              {/* Search */}
              <button type="button"
                onClick={() => setShowCommandPalette(true)}
                className="toolbar-btn transition-colors duration-150 hover:text-brand-400 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none"
                title="Search (Ctrl+K)"
                aria-label="Global search"
                style={{ padding: '2px 6px' }}
              >
                <Search style={{ width: 10, height: 10 }} />
              </button>
            </div>

            {/* Separator */}
            <div className="hidden lg:block w-px h-7" style={{ background: 'var(--border-default)' }} />

            {/* PANIC Button */}
            <PanicButton latitude={gps.latitude} longitude={gps.longitude} />

            {/* Vertical separator */}
            <div className="w-px h-7" style={{ background: 'var(--border-default)' }} />

            {/* Profile Menu */}
            <div className="relative" ref={profileDropdownRef}>
              <button type="button"
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className={`flex items-center gap-2 px-2 py-1 transition-all duration-150 border focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none active:scale-[0.97] ${
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
                    src={authedImageUrl(user.profile_image)}
                    alt={user.first_name}
                    className="w-8 h-8 object-cover transition-shadow duration-150"
                    style={{ border: '2px solid var(--border-strong)', borderRadius: '50%', boxShadow: profileDropdownOpen ? '0 0 0 2px rgba(212,160,23,0.4)' : 'none' }}
                  />
                ) : (
                  <div
                    className="w-8 h-8 flex items-center justify-center text-[11px] font-bold transition-shadow duration-150"
                    style={{
                      background: 'linear-gradient(135deg, var(--surface-raised), var(--accent-silver-600))',
                      color: 'var(--text-primary)',
                      border: '2px solid var(--rmpg-400)',
                      borderRadius: '50%',
                      boxShadow: profileDropdownOpen ? '0 0 0 2px rgba(212,160,23,0.4)' : 'none',
                    }}
                  >
                    {initials}
                  </div>
                )}

                <ChevronDown
                  style={{
                    width: 10,
                    height: 10,
                    color: 'var(--text-muted)',
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
                  style={{ minWidth: 220, zIndex: 9995, boxShadow: '0 8px 32px rgba(var(--surface-overlay-rgb) / 0.7), 0 2px 8px rgba(var(--surface-overlay-rgb) / 0.45)' }}
                >
                  {/* User info header */}
                  <div className="px-3 py-2.5 border-b border-rmpg-700" style={{ background: 'var(--surface-sunken)' }}>
                    <div className="text-xs font-bold text-rmpg-100">
                      {user?.first_name} {user?.last_name}
                    </div>
                    <div className="text-[9px] font-mono text-fg-muted mt-0.5">
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
                  <button type="button" role="menuitem" onClick={() => openProfileModal('profile')} className="menu-item w-full transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none">
                    <span className="menu-item-icon"><User style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Edit Profile</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => openProfileModal('password')} className="menu-item w-full transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none">
                    <span className="menu-item-icon"><Lock style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Change Password</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => openProfileModal('sessions')} className="menu-item w-full transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none">
                    <span className="menu-item-icon"><Shield style={{ width: 12, height: 12 }} /></span>
                    <span className="menu-item-label">Active Sessions</span>
                  </button>
                  {isAdmin && (
<button type="button" role="menuitem" onClick={() => { setProfileDropdownOpen(false); navigate('/admin?tab=settings'); }} className="menu-item w-full transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none">
                        <Settings style={{ width: 11, height: 11 }} />
                        <span className="menu-item-label">System Settings</span>
                      </button>
                  )}

                  <div className="menu-separator" />

                  {/* 9: Sign Out button with red hover bg for destructive emphasis */}
                  <button type="button" role="menuitem" onClick={handleSignOutClick} className="menu-item w-full transition-colors duration-150 hover:bg-red-900/20 focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none">
                    <span className="menu-item-icon"><LogOut style={{ width: 12, height: 12, color: 'var(--sev-critical)' }} /></span>
                    <span className="menu-item-label" style={{ color: 'var(--sev-critical)' }}>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contract Manager Banner */}
      {isContractManager && (
        <div
          className="flex items-center justify-center gap-2 px-4"
          style={{
            height: '22px',
            background: 'linear-gradient(90deg, var(--surface-overlay), var(--surface-raised), var(--surface-overlay))',
            borderBottom: '1px solid var(--border-default)',
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
          className="hidden lg:flex items-center justify-between px-2"
          style={{
            height: '22px',
            background: 'linear-gradient(180deg, var(--desktop-shell-raised-start) 0%, var(--desktop-shell-start) 100%)',
            borderBottom: '1px solid var(--desktop-shell-border)',
            flexShrink: 0,
          }}
        >
        {/* Menu Bar — File | View | Tools | Help */}
        <MenuBar
          isAdmin={isAdmin}
          isConnected={isConnected}
          onlineCount={presence.count}
          onLogout={logout}
          onSearch={() => setShowCommandPalette(true)}
          onShowShortcuts={() => setShowShortcutHelp(true)}
          onRefreshData={fetchHeaderStats}
        />

        {/* 19: Operator info with distinct badge highlight */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400 flex-shrink-0 whitespace-nowrap ml-4">
          <span>
            OPR: <span className="text-rmpg-300">{user?.badge_number ? `#${user.badge_number}` : '---'}</span> {user?.last_name?.toUpperCase() || '---'}, {user?.first_name || '---'} <span className="text-fg-muted">|</span> <span className="text-brand-400">{(toDisplayLabel(user?.role) || '---').toUpperCase()}</span>
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* TOOLBAR ROW 2 — Icon Navigation Toolbar (Spillman Flex style) */}
      {/* Square buttons: icon above label, F-key badge, dropdown for children */}
      {/* ============================================================ */}
      <div
        className="hidden lg:flex items-center gap-0 px-1 select-none overflow-x-auto overflow-y-hidden scrollbar-dark tab-scroll"
        role="toolbar"
        aria-label="Module navigation"
        style={{
          height: 46,
          background: 'linear-gradient(180deg, var(--desktop-shell-start) 0%, var(--desktop-shell-end) 100%)',
          borderBottom: '1px solid var(--desktop-shell-border)',
          flexShrink: 0,
        }}
        data-nav-dropdown
      >
        {/* Back / Forward navigation buttons */}
        <button
          type="button"
          onClick={handleNavBack}
          disabled={!canGoBack}
          className="toolbar-btn transition-colors duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-border-strong focus-visible:outline-none"
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
          className="toolbar-btn transition-colors duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-border-strong focus-visible:outline-none"
          title="Forward (Alt+→)"
          aria-label="Navigate forward"
          style={{ height: 36, width: 30, padding: '2px 4px', opacity: canGoForward ? 1 : 0.3 }}
        >
          <ChevronRight style={{ width: 14, height: 14 }} />
        </button>
        <div
          className="self-stretch mx-0.5"
          style={{ width: 1, background: 'var(--border-subtle)', margin: '6px 2px' }}
        />

        {(() => {
          let lastGroup = '';
          return TOOLBAR_NAV.filter(item => {
            if (item.adminOnly && !isAdmin) return false;
            if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(item.path)) return false;
            if (!isFeatureEnabled(item.path)) return false;
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
                    className="toolbar-nav-btn"
                    title={`Open ${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
                    aria-label={`Open ${item.label} in new window`}
                    style={{ height: 44, padding: '2px 6px' }}
                  >
                    <Icon style={{ width: 16, height: 16, color: 'currentColor', marginBottom: 1 }} />
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
                    style={{ width: 1, background: 'var(--border-subtle)', margin: '6px 2px' }}
                  />
                )}
                <div className="relative">
                  <button
                    ref={el => { toolbarBtnRefs.current[item.path] = el; }}
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
                    className={`toolbar-nav-btn flex-col items-center justify-center ${isActive || isDropdownOpen ? 'active' : ''}`}
                    style={{
                      minWidth: 52,
                      height: 42,
                      padding: '2px 7px',
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
                        // Inherit the button's currentColor so active (steel-blue) + hover
                        // states drive the glyph automatically — see .toolbar-nav-btn CSS.
                        color: 'currentColor',
                        marginBottom: 1,
                      }}
                    />
                    {/* Email unread badge on Comms toolbar button. Clicking this
                        button navigates straight to /communications (the internal
                        Comms Inbox), NOT /email — so without a label this count
                        looks like it belongs to Comms Inbox and reads as a bug
                        ("99+" badge, but the inbox says "No messages yet"). The
                        title clarifies it's actually /email's unread count (Email
                        is a Comms-dropdown child). */}
                    {item.path === '/communications' && emailUnreadCount > 0 && (
                      <span
                        className="absolute flex items-center justify-center font-bold animate-pulse"
                        title={`${emailUnreadCount} unread email${emailUnreadCount === 1 ? '' : 's'}`}
                        style={{
                          top: 1, left: 30,
                          minWidth: 14, height: 14, padding: '0 3px',
                          fontSize: 8, lineHeight: 1,
                          background: 'var(--sev-critical)', color: 'var(--text-primary)',
                          borderRadius: 2, border: '1px solid var(--border-subtle)',
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
                          color: isActive ? 'var(--brand-blue)' : 'var(--text-muted)',
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
                          color: isActive ? 'var(--brand-blue)' : 'var(--text-muted)',
                          transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.15s',
                        }}
                      />
                    )}
                  </button>

                  {/* Dropdown menu for items with children */}
                  {/* 10: Toolbar dropdown — position:fixed with viewport coords
                      captured from the button ref. The toolbar's overflow-x-auto
                      makes it a containing block (per CSS spec, non-visible X
                      overflow implicitly sets Y to auto too), which would clip
                      an absolutely-positioned panel. Fixed positioning escapes
                      that and lets the panel paint below the toolbar. */}
                  {hasChildren && isDropdownOpen && dropdownRect && (
                    <div
                      className="menu-dropdown fixed z-50 animate-dropdown-appear"
                      data-nav-dropdown
                      role="menu"
                      aria-label={`${item.label} submenu`}
                      style={{
                        left: dropdownRect.left,
                        top: dropdownRect.top,
                        minWidth: Math.max(210, dropdownRect.width),
                        borderTop: '2px solid var(--accent-silver-500)',
                      }}
                    >
                      {item.children!.filter(child => {
                        if (child.adminOnly && !isAdmin) return false;
                        if (isContractManager && CONTRACT_MANAGER_BLOCKED_PATHS.has(child.path)) return false;
                        if (isClientViewer && CLIENT_VIEWER_BLOCKED_PATHS.has(child.path)) return false;
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
                            className={`menu-item w-full ${childActive ? 'active' : ''}`}
                            role="menuitem"
                            style={{
                              color: childActive ? 'var(--text-primary)' : undefined,
                              background: childActive ? 'rgba(42,42,42,0.60)' : undefined,
                            }}
                          >
                            {/* 11: Slightly larger child icon + semibold label for active items */}
                            <ChildIcon style={{ width: 14, height: 14, color: childActive ? 'var(--text-secondary)' : 'var(--text-muted)', flexShrink: 0 }} />
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
        <main
          id="main-content"
          className="spm-page flex-1 overflow-auto min-h-0 panel-inset animate-page-enter scrollbar-dark content-scroll-y"
          key={location.pathname}
          style={{ background: 'var(--surface-sunken)', boxShadow: 'inset 0 1px 3px rgba(var(--surface-overlay-rgb) / 0.35)' }}
          // Persist scroll per-path so SW-update reloads (and any other full
          // page reload) put the operator back where they were instead of
          // snapping to the top — the 2026-06-11 "can't scroll" reload loop
          // made every page feel scroll-locked because each reload reset it.
          onScroll={(e) => {
            const el = e.currentTarget;
            try { sessionStorage.setItem(`rmpg_scroll:${location.pathname}`, String(el.scrollTop)); } catch { /* full */ }
          }}
          ref={(el) => {
            if (!el) return;
            try {
              const saved = sessionStorage.getItem(`rmpg_scroll:${location.pathname}`);
              if (saved && el.scrollTop === 0) {
                const target = parseInt(saved, 10);
                // Restore after the page's first content paint — content
                // loads async, so retry briefly until it's tall enough.
                let attempts = 0;
                const tryRestore = () => {
                  if (el.scrollHeight - el.clientHeight >= target) { el.scrollTop = target; return; }
                  if (++attempts < 20) setTimeout(tryRestore, 250);
                };
                tryRestore();
              }
            } catch { /* private mode */ }
          }}
        >
          {/* Officer-facing admin broadcasts (Admin → Announcements) */}
          <AnnouncementBanner />

          {/* Offline indicator — shown when the device loses network.
              Pages still render with stale SW-cached data; this tells
              officers the data may not be current. */}
          {isOffline && (
            <div className="bg-rmpg-900/80 border-b border-rmpg-700/60 px-4 py-1 flex items-center gap-2" role="status" aria-live="polite">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <span className="text-[11px] text-rmpg-200 font-medium tracking-wide">
                OFFLINE — displaying cached data
              </span>
            </div>
          )}

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

      {/* Global Push-To-Talk — works on every page; every transmission is
          relayed to the channel and recorded to Radio → Recordings. */}
      <PttController />

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
          callsByPriority={callsByPriority}
          activeBOLOs={activeBOLOs}
          gpsTracking={gps.isTracking}
          gpsUnitCallSign={gps.unitCallSign}
          gpsAccuracy={gps.accuracy}
          gpsLastSent={gps.lastSentAt}
        />
      )}

      {/* Dispatcher Transcript Drawer — toggles with 'T' key */}
      <DispatcherTranscript />

      {/* Profile Modal — mount latched on first open (see profileModalEverOpened above) */}
      {profileModalEverOpened && (
        <React.Suspense fallback={null}>
          <UserProfileModal
            isOpen={profileModalOpen}
            onClose={() => setProfileModalOpen(false)}
            initialTab={profileModalTab}
          />
        </React.Suspense>
      )}

      {/* Force Password Change Modal — blocks UI until password changed */}
      <ForcePasswordChangeModal />

      {/* Force 2FA Setup Modal — blocks UI until 2FA is enabled */}
      <Force2FASetupModal />

      {/* Keyboard Shortcut Help Modal */}
      {showShortcutHelp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setShowShortcutHelp(false)}>
          {/* 14: Keyboard shortcuts modal with blue top accent */}
          <div className="bg-surface-base border border-border-default rounded-sm w-full max-w-md mx-4 shadow-md animate-dropdown-appear" style={{ borderTop: '2px solid var(--accent-silver-500)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default bg-surface-overlay">
              <h3 className="text-sm font-semibold text-rmpg-100 flex items-center gap-2"><span className="text-brand-400">?</span> Keyboard Shortcuts</h3>
              <button type="button" onClick={() => setShowShortcutHelp(false)} className="text-fg-muted hover:text-rmpg-100 transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-rmpg-500 focus-visible:outline-none" aria-label="Close keyboard shortcuts"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto scrollbar-dark">
              <div className="space-y-1.5">
                <div className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider mb-2">Module Navigation</div>
                {TOOLBAR_NAV.filter(i => i.shortcut).map(item => (
                  <div key={item.shortcut} className="flex items-center justify-between py-1">
                    <span className="text-xs text-rmpg-200">{item.label}</span>
                    <kbd className="px-2 py-0.5 text-[10px] font-mono bg-surface-overlay border border-border-default text-brand-400 rounded-sm">{item.shortcut}</kbd>
                  </div>
                ))}
              </div>
              <div className="border-t border-border-default pt-3 space-y-1.5">
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
                    <kbd className="px-2 py-0.5 text-[10px] font-mono bg-surface-overlay border border-border-default text-brand-400 rounded-sm">{s.keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette (Cmd/Ctrl+K) — nav + live record search + NCIC quick-run */}
      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        navTargets={paletteNavTargets}
      />

      {/* Dialer — always-on /dialer iframe (authenticated Twilio Client).
          Dispatch → Dialer Connect docks it into the CAD page. Close (X) parks
          the iframe off-screen so Twilio stays registered. Pop-out unloads
          the iframe and opens a named Dial Connect window. */}
      <React.Suspense fallback={null}>
        <DialerPanel />
      </React.Suspense>

    </div>
  );
}
