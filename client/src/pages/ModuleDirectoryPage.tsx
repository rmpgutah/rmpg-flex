import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Radio, Map, FileText, Database, Users, MessageSquare,
  BarChart3, Settings, AlertTriangle, Monitor, Terminal, Search, Car,
  Video, Camera, ClipboardList, ShieldBan, Gavel, UserX, Briefcase,
  Calendar, TrendingUp, ClipboardCheck, GraduationCap, Network,
  Building2, ShieldAlert, Package, DollarSign, Megaphone, CheckCircle,
  Shield, Share2, CreditCard, Microscope, Mail, QrCode, FileWarning,
  Construction, User, Lock, ScrollText, UserCheck, Fingerprint, Globe,
  HelpCircle, BookOpen, ClipboardPen, ListChecks, Sparkles,
  Navigation, Star, Clock, ExternalLink, RefreshCw, Grid3X3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { POPOUT_PAGES, openPageWindow } from '../utils/windowManager';

interface NavFunction {
  path: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  description: string;
  adminOnly?: boolean;
  badgeKey?: string;
}

interface NavCategory {
  id: string;
  label: string;
  icon: React.ElementType;
  functions: NavFunction[];
}

const FAVORITES_KEY = 'rmpg_nav_favorites';
const RECENT_KEY = 'rmpg_nav_recent';

const CLIENT_VIEWER_BLOCKED = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/radio', '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar',
]);

const CONTRACT_MANAGER_BLOCKED = new Set([
  '/admin', '/personnel',
]);

const NAV_CATEGORIES: NavCategory[] = [
  {
    id: 'ops',
    label: 'Operations',
    icon: Radio,
    functions: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'F1', description: 'Central operations overview with live statistics, active calls, and unit status' },
      { path: '/dispatch', label: 'Dispatch Console', icon: Radio, shortcut: 'F2', badgeKey: 'activeCalls', description: 'Full CAD dispatch console for call management, unit assignments, and real-time ops' },
      { path: '/map', label: 'Tactical Map', icon: Map, shortcut: 'F3', description: 'Real-time tactical map with live GPS, call markers, beat overlays, and offline tiles' },
      { path: '/mdt', label: 'Mobile Data Terminal', icon: Monitor, shortcut: 'F4', description: 'In-vehicle mobile data terminal for field officers' },
      { path: '/ncic', label: 'NCIC Terminal', icon: Terminal, shortcut: 'F5', description: 'NCIC-style query terminal for warrants, persons, vehicles, and firearms' },
      { path: '/geography', label: 'Dispatch Geography', icon: Map, description: 'Sector, zone, and beat boundary management for dispatch geography' },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    icon: Database,
    functions: [
      { path: '/incidents', label: 'Incidents', icon: FileText, description: 'Incident report management with UCR/NIBRS classification and multi-officer tracking' },
      { path: '/records', label: 'Records (RMS)', icon: Database, description: 'Master records for persons, vehicles, addresses, and property with compound search' },
      { path: '/field-interviews', label: 'Field Interviews', icon: ClipboardList, description: 'Field interview cards (FI/contact cards) with person and vehicle associations' },
      { path: '/criminal-history', label: 'Criminal History', icon: Search, description: 'Criminal history records and background check results' },
      { path: '/dl-search', label: 'DL Search', icon: CreditCard, description: 'Driver\'s license lookup and verification across multiple states' },
      { path: '/microbilt', label: 'MicroBilt', icon: Search, description: 'MicroBilt skip tracing and background data services' },
      { path: '/evidence', label: 'Evidence / Property', icon: Package, description: 'Evidence and property management with chain-of-custody tracking' },
      { path: '/forensic-lab', label: 'Forensic Lab', icon: Microscope, description: 'Forensic analysis tracking, exhibit management, and lab workflow' },
      { path: '/connections', label: 'Connections Analysis', icon: Network, description: 'Link analysis and connection mapping between persons, vehicles, and incidents' },
      { path: '/cases', label: 'Case Management', icon: Briefcase, badgeKey: 'openCases', description: 'Full case management with evidence, suspect/witness tracking, and cross-referencing' },
      { path: '/arrest-records', label: 'Arrest Records', icon: UserX, description: 'Arrest record management and processing' },
      { path: '/court-records', label: 'Court Records', icon: Gavel, description: 'Court records and case disposition tracking' },
      { path: '/documents', label: 'Documents', icon: FileText, description: 'Document management and filing system' },
      { path: '/document-intake', label: 'Document Intake', icon: ClipboardPen, description: 'Document scanning and intake processing' },
    ],
  },
  {
    id: 'enforce',
    label: 'Enforcement',
    icon: AlertTriangle,
    functions: [
      { path: '/warrants', label: 'Warrants', icon: AlertTriangle, badgeKey: 'activeWarrants', description: 'Active warrant tracking with person associations, status management, and national search' },
      { path: '/national-warrant-search', label: 'National Warrant Search', icon: Globe, description: 'Federated warrant search across multiple state and national databases' },
      { path: '/citations', label: 'Citations', icon: FileWarning, description: 'Traffic and non-traffic citation management with violation tracking' },
      { path: '/trespass-orders', label: 'Trespass Orders', icon: ShieldBan, description: 'Trespass order management and enforcement tracking' },
      { path: '/code-enforcement', label: 'Code Enforcement', icon: Construction, description: 'Municipal and property code enforcement case management' },
      { path: '/court', label: 'Court Tracker', icon: Gavel, description: 'Court date and event tracking for officers and cases' },
      { path: '/offender-registry', label: 'Offender Registry', icon: UserX, description: 'Registered offender tracking and compliance management' },
      { path: '/sex-offender-registry', label: 'Sex Offender Registry', icon: Fingerprint, description: 'Sex offender registration and verification' },
      { path: '/serve', label: 'Process Server', icon: Briefcase, badgeKey: 'pendingServe', description: 'Serve queue with GPS tracking, route optimization, and attempt logging' },
      { path: '/serve-intake', label: 'Service Intake', icon: ClipboardPen, description: 'Process service intake and document receipt' },
    ],
  },
  {
    id: 'personnel',
    label: 'Personnel',
    icon: Users,
    functions: [
      { path: '/personnel', label: 'Personnel', icon: Users, description: 'Officer and staff profiles, certifications, assignments, and contact info' },
      { path: '/hr', label: 'HR Console', icon: ClipboardCheck, description: 'HR management with leave, payroll, performance reviews, and disciplinary records' },
      { path: '/fleet', label: 'Fleet Management', icon: Car, description: 'Vehicle fleet management with maintenance, fuel logs, and inspections' },
      { path: '/body-cameras', label: 'Body Cameras', icon: Video, description: 'Body-worn camera management, video review, and evidence tagging' },
      { path: '/dash-cameras', label: 'Dash Cameras', icon: Camera, description: 'Dashboard camera management and video evidence system' },
      { path: '/dashcams', label: 'Dashcam System', icon: Camera, description: 'Dashcam system configuration, live view, and playback' },
      { path: '/dashcam-ai', label: 'Dashcam AI', icon: Sparkles, description: 'AI-powered dashcam analytics: plate recognition, behavior detection' },
      { path: '/training', label: 'Training', icon: GraduationCap, description: 'Training dashboard and documentation for policies, SOPs, and manuals' },
      { path: '/training-docs', label: 'Training Documents', icon: BookOpen, description: 'Training document library and reference materials' },
      { path: '/training-mgmt', label: 'Training Admin', icon: ListChecks, description: 'Training administration, course scheduling, and compliance tracking' },
    ],
  },
  {
    id: 'comms',
    label: 'Communications',
    icon: MessageSquare,
    functions: [
      { path: '/communications', label: 'Communications', icon: MessageSquare, badgeKey: 'activeBOLOs', description: 'Secure messaging between dispatchers and units with channel-based comms' },
      { path: '/radio', label: 'Radio Console', icon: Radio, description: 'Integrated radio console with channel management and PTT controls' },
      { path: '/email', label: 'Email', icon: Mail, badgeKey: 'unreadEmail', description: 'Integrated email client for agency communications' },
      { path: '/patrol', label: 'Patrol Operations', icon: QrCode, description: 'Patrol operations and QR-based reporting' },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis & Reports',
    icon: BarChart3,
    functions: [
      { path: '/reports', label: 'Reports', icon: BarChart3, description: 'Comprehensive reporting with charts, analytics, and PDF export' },
      { path: '/shift-plans', label: 'Shift Plans', icon: Calendar, description: 'Shift scheduling and patrol plan management' },
      { path: '/statute-analytics', label: 'Statute Analytics', icon: TrendingUp, description: 'Statute usage analytics and enforcement trend analysis' },
      { path: '/reports/custom', label: 'Report Builder', icon: Database, description: 'Custom report builder with drag-and-drop field selection' },
      { path: '/crime-analysis', label: 'Crime Analysis', icon: TrendingUp, description: 'Crime pattern analysis, hot spot mapping, and trend reporting' },
      { path: '/dar', label: 'Daily Activity Reports', icon: ClipboardCheck, description: 'Daily activity report generation and officer log review' },
    ],
  },
  {
    id: 'investigations',
    label: 'Investigations',
    icon: Search,
    functions: [
      { path: '/skip-tracer', label: 'Skip Tracer', icon: Search, description: 'Multi-source skip tracing across 22+ public and proprietary databases' },
      { path: '/web-research', label: 'Web Research', icon: Globe, description: 'Open-source intelligence (OSINT) web research tools' },
      { path: '/colorado-doc', label: 'Colorado DOC Search', icon: User, description: 'Colorado Department of Corrections inmate search' },
      { path: '/iped', label: 'IPED Forensics', icon: Microscope, description: 'IPED digital forensics and device analysis' },
      { path: '/recon-connect', label: 'Recon Connect', icon: Network, description: 'Recon intelligence platform integration' },
      { path: '/connections', label: 'Connections', icon: Network, description: 'Entity connection mapping and relationship analysis' },
    ],
  },
  {
    id: 'jail',
    label: 'Jail / Internal Affairs',
    icon: Building2,
    functions: [
      { path: '/jail', label: 'Jail Management', icon: Building2, description: 'Jail management, inmate tracking, and facility operations' },
      { path: '/affairs', label: 'Internal Affairs', icon: ShieldAlert, description: 'Internal affairs case management and investigation tracking' },
      { path: '/assets', label: 'Asset Management', icon: Package, description: 'Asset inventory, tracking, and depreciation management' },
    ],
  },
  {
    id: 'services',
    label: 'Agency Services',
    icon: Shield,
    functions: [
      { path: '/billing', label: 'Billing', icon: DollarSign, description: 'Client billing, invoicing, and payment tracking' },
      { path: '/community', label: 'Community Relations', icon: Users, description: 'Community outreach programs and event management' },
      { path: '/tasks', label: 'Task Management', icon: ClipboardList, description: 'Task assignments, tracking, and workflow management' },
      { path: '/alerts', label: 'Alert Center', icon: Megaphone, description: 'Agency-wide alert broadcasting and notification management' },
      { path: '/qa', label: 'Quality Assurance', icon: CheckCircle, description: 'QA reviews, compliance checks, and performance metrics' },
      { path: '/risk', label: 'Risk Management', icon: Shield, description: 'Risk assessment, incident review, and liability tracking' },
      { path: '/interagency', label: 'Interagency', icon: Share2, description: 'Interagency cooperation, task force management, and data sharing' },
      { path: '/gang-intel', label: 'Gang Intelligence', icon: Shield, description: 'Gang intelligence tracking, associations, and activity monitoring' },
      { path: '/narcotics', label: 'Narcotics', icon: Shield, description: 'Narcotics investigation case management' },
      { path: '/special-ops', label: 'Special Operations', icon: Shield, description: 'Special operations planning and tactical team management' },
      { path: '/crisis-response', label: 'Crisis Response', icon: Shield, description: 'Crisis response team coordination and incident management' },
      { path: '/victim-services', label: 'Victim Services', icon: Shield, description: 'Victim advocacy, resource referral, and case tracking' },
      { path: '/alarms', label: 'Alarm Management', icon: Shield, description: 'Alarm permit management and alarm response tracking' },
      { path: '/accreditation', label: 'Accreditation', icon: CheckCircle, description: 'CALEA and state accreditation document management' },
      { path: '/recruitment', label: 'Recruitment', icon: UserCheck, description: 'Applicant tracking, hiring pipeline, and recruitment events' },
    ],
  },
  {
    id: 'overwatch',
    label: 'Overwatch / CRM',
    icon: Briefcase,
    functions: [
      { path: '/crm', label: 'Overwatch CRM', icon: Briefcase, description: 'Client relationship management for contracts and service agreements' },
      { path: '/invoices', label: 'Invoices', icon: DollarSign, description: 'Invoice generation, processing, and payment tracking' },
      { path: '/command-center', label: 'Command Center', icon: Monitor, description: 'Centralized command center for multi-incident coordination' },
      { path: '/security-dashboard', label: 'Security Dashboard', icon: Shield, description: 'Security operations dashboard with threat monitoring' },
      { path: '/use-of-force', label: 'Use of Force', icon: AlertTriangle, description: 'Use of force report submission and review tracking' },
    ],
  },
  {
    id: 'support',
    label: 'Support & Tools',
    icon: HelpCircle,
    functions: [
      { path: '/settings', label: 'Settings', icon: Settings, description: 'User preferences, notification config, and account settings' },
      { path: '/notifications', label: 'Notifications', icon: Megaphone, description: 'Notification history and preference management' },
      { path: '/help', label: 'Help & About', icon: HelpCircle, description: 'System documentation, keyboard shortcuts, FAQ, and version info' },
      { path: '/navigation', label: 'Navigation / Drive', icon: Navigation, description: 'In-vehicle GPS turn-by-turn navigation and drive instruments' },
      { path: '/geo-data-viewer', label: 'Geo Data Viewer', icon: Map, description: 'Geospatial data viewer and layer management' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Lock,
    functions: [
      { path: '/audit', label: 'Audit Log', icon: ScrollText, shortcut: 'F11', adminOnly: true, description: 'System audit trail with user activity, data changes, and access logs' },
      { path: '/admin', label: 'Administration', icon: Settings, shortcut: 'F12', adminOnly: true, description: 'System administration, user management, roles, and configuration' },
    ],
  },
];

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveFavorites(favorites: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

function loadRecent(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function pushRecent(path: string) {
  try {
    const recent = loadRecent().filter(p => p !== path);
    recent.unshift(path);
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 10)));
  } catch { /* silent */ }
}

export default function ModuleDirectoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isClientViewer = user?.role === 'client_viewer';
  const isContractManager = user?.role === 'contract_manager';

  const [activeCategory, setActiveCategory] = useState(NAV_CATEGORIES[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [badges, setBadges] = useState<Record<string, number>>({});

  const showFavorites = favorites.size > 0 && !searchQuery.trim();

  const visibleCategories = useMemo(() => {
    return NAV_CATEGORIES.map(cat => ({
      ...cat,
      functions: cat.functions.filter(fn => {
        if (fn.adminOnly && !isAdmin) return false;
        if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(fn.path)) return false;
        if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(fn.path)) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return fn.label.toLowerCase().includes(q) ||
            fn.description.toLowerCase().includes(q) ||
            fn.path.toLowerCase().includes(q);
        }
        return true;
      }),
    })).filter(cat => cat.functions.length > 0);
  }, [isAdmin, isClientViewer, isContractManager, searchQuery]);

  const allFunctions = useMemo(
    () => visibleCategories.flatMap(cat => cat.functions),
    [visibleCategories],
  );

  const favoriteFunctions = useMemo(() => {
    if (favorites.size === 0) return [];
    return allFunctions.filter(fn => favorites.has(fn.path));
  }, [favorites, allFunctions]);

  const recentFunctions = useMemo(() => {
    if (recent.length === 0) return [];
    const seen = new Set<string>();
    const result: NavFunction[] = [];
    for (const path of recent) {
      const fn = allFunctions.find(f => f.path === path);
      if (fn && !seen.has(path)) {
        seen.add(path);
        result.push(fn);
      }
      if (result.length >= 5) break;
    }
    return result;
  }, [recent, allFunctions]);

  const toggleFavorite = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveFavorites(next);
      return next;
    });
  }, []);

  const handleNavigate = useCallback((path: string, newWindow = false) => {
    pushRecent(path);
    if (newWindow) {
      window.open(path, '_blank', 'noopener,noreferrer');
    } else {
      navigate(path);
    }
  }, [navigate]);

  const handlePopOut = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    pushRecent(path);
    openPageWindow(path);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    ) return;

    const match = e.key.match(/^F(\d+)$/);
    if (!match) return;

    const fNum = parseInt(match[1], 10);
    const shortcutItems = allFunctions.filter(fn => fn.shortcut);
    const idx = fNum - 1;
    if (idx >= shortcutItems.length) return;

    e.preventDefault();
    handleNavigate(shortcutItems[idx].path);
  }, [allFunctions, handleNavigate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const track = (path: string) => {
      try {
        const url = new URL(path, window.location.origin);
        if (url.pathname !== '/navigation') pushRecent(url.pathname);
      } catch { /* silent */ }
    };
    const handler = () => track(window.location.pathname);
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      handler();
    };
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      handler();
    };
    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  useEffect(() => {
    async function fetchBadges() {
      const results: Record<string, number> = {};
      try {
        const stats = await apiFetch<any>('/dispatch/aggregates');
        if (stats?.calls?.active) results.activeCalls = stats.calls.active;
      } catch { /* silent */ }
      try {
        const bolos = await apiFetch<any>('/comms/bolos/active');
        if (Array.isArray(bolos)) results.activeBOLOs = bolos.length;
      } catch { /* silent */ }
      try {
        const email = await apiFetch<{ count: number }>('/email/unread-count');
        if (email?.count) results.unreadEmail = email.count;
      } catch { /* silent */ }
      try {
        const warrants = await apiFetch<any>('/dispatch/stats');
        if (warrants?.active_warrants) results.activeWarrants = warrants.active_warrants;
      } catch { /* silent */ }
      try {
        const dashboard = await apiFetch<any>('/stats/dashboard');
        if (dashboard?.open_cases) results.openCases = dashboard.open_cases;
        if (dashboard?.pending_serve) results.pendingServe = dashboard.pending_serve;
      } catch { /* silent */ }
      setBadges(results);
    }
    fetchBadges();
    const interval = setInterval(fetchBadges, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Navigation */}
      <nav
        className="flex-shrink-0 overflow-y-auto py-3"
        style={{
          width: 200,
          background: '#080808',
          borderRight: '1px solid #222222',
          scrollbarWidth: 'none',
        }}
      >
        <div className="px-3 pb-3 mb-2" style={{ borderBottom: '1px solid #1a1a1a' }}>
          <div className="flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Modules</span>
          </div>
          <div className="text-[9px] text-rmpg-500 mt-1 font-mono">{allFunctions.length} Functions</div>
        </div>

        {showFavorites && (
          <button
            type="button"
            onClick={() => setActiveCategory('_favorites')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${activeCategory !== '_favorites' ? 'hover:bg-surface-raised' : ''}`}
            style={{
              background: activeCategory === '_favorites' ? 'rgba(212,160,23,0.12)' : 'transparent',
              color: activeCategory === '_favorites' ? '#d4a017' : '#888888',
              borderLeft: activeCategory === '_favorites' ? '3px solid #d4a017' : '3px solid transparent',
            }}
          >
            <Star style={{ width: 14, height: 14, flexShrink: 0, color: activeCategory === '_favorites' ? '#d4a017' : '#666666' }} />
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-medium block truncate">Favorites</span>
              <span className="text-[8px] text-rmpg-600 font-mono">{favorites.size} saved</span>
            </div>
          </button>
        )}

        {recentFunctions.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveCategory('_recent')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${activeCategory !== '_recent' ? 'hover:bg-surface-raised' : ''}`}
            style={{
              background: activeCategory === '_recent' ? 'rgba(136,136,136,0.12)' : 'transparent',
              color: activeCategory === '_recent' ? '#ffffff' : '#888888',
              borderLeft: activeCategory === '_recent' ? '3px solid #888888' : '3px solid transparent',
            }}
          >
            <Clock style={{ width: 14, height: 14, flexShrink: 0, color: activeCategory === '_recent' ? '#aaaaaa' : '#666666' }} />
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-medium block truncate">Recent</span>
              <span className="text-[8px] text-rmpg-600 font-mono">{recentFunctions.length} modules</span>
            </div>
          </button>
        )}

        {showFavorites && <div className="mx-3 my-1 h-px" style={{ background: '#1a1a1a' }} />}

        {visibleCategories.map((cat) => {
          const Icon = cat.icon;
          const active = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${!active ? 'hover:bg-surface-raised' : ''}`}
              style={{
                background: active ? 'rgba(136,136,136,0.12)' : 'transparent',
                color: active ? '#ffffff' : '#888888',
                borderLeft: active ? '3px solid #888888' : '3px solid transparent',
              }}
            >
              <Icon style={{ width: 14, height: 14, flexShrink: 0, color: active ? '#aaaaaa' : '#666666' }} />
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-medium block truncate">{cat.label}</span>
                <span className="text-[8px] text-rmpg-600 font-mono">{cat.functions.length} functions</span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto" style={{ background: '#0a0a0a' }}>
        <div className="p-4 max-w-5xl mx-auto space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1" style={{ maxWidth: 400 }}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  if (e.target.value && visibleCategories.length > 0) {
                    setActiveCategory(visibleCategories[0].id);
                  }
                }}
                placeholder="Search functions by name, path, or description..."
                className="w-full pl-9 pr-3 py-2 text-[11px] bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:outline-none focus:border-rmpg-500 transition-colors"
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setActiveCategory(NAV_CATEGORIES[0].id); }}
              className="flex items-center gap-1 px-2 py-2 text-[10px] text-rmpg-500 hover:text-rmpg-300 transition-colors"
              title="Reset"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {showFavorites && (activeCategory === '_favorites' || searchQuery.trim()) && (
            <div>
              <PanelTitleBar title={`Favorites (${favoriteFunctions.length})`} icon={Star} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {favoriteFunctions.map((fn) => renderFunctionCard(fn))}
              </div>
            </div>
          )}

          {recentFunctions.length > 0 && (activeCategory === '_recent' || searchQuery.trim()) && !showFavorites && (
            <div>
              <PanelTitleBar title={`Recent (${recentFunctions.length})`} icon={Clock} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {recentFunctions.map((fn) => renderFunctionCard(fn))}
              </div>
            </div>
          )}

          {visibleCategories.map((cat) => (
            <div key={cat.id}>
              <PanelTitleBar
                title={`${cat.label} (${cat.functions.length})`}
                icon={cat.icon}
              />
              {cat.id === activeCategory || searchQuery.trim() ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {cat.functions.map((fn) => renderFunctionCard(fn))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {cat.functions.slice(0, 3).map((fn) => {
                    const Icon = fn.icon;
                    return (
                      <button
                        key={fn.path}
                        type="button"
                        onClick={() => setActiveCategory(cat.id)}
                        className="flex items-center gap-3 p-3 text-left transition-colors hover:bg-surface-raised"
                        style={{
                          background: 'var(--surface-sunken)',
                          border: '1px solid var(--border-default)',
                        }}
                      >
                        <Icon className="w-3.5 h-3.5 text-rmpg-500 flex-shrink-0" />
                        <span className="text-[10px] text-rmpg-400 truncate">{fn.label}</span>
                      </button>
                    );
                  })}
                  {cat.functions.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className="flex items-center justify-center p-3 text-[9px] text-rmpg-500 hover:text-rmpg-300 transition-colors font-mono"
                      style={{ border: '1px dashed var(--border-default)' }}
                    >
                      +{cat.functions.length - 3} more
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  function PanelTitleBar({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 mb-2 select-none"
        style={{
          background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
          borderBottom: '1px solid #222222',
        }}
      >
        {Icon && <Icon className="w-3.5 h-3.5 text-rmpg-400" aria-hidden="true" />}
        <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-300">{title}</span>
      </div>
    );
  }

  function renderFunctionCard(fn: NavFunction) {
    const Icon = fn.icon;
    const isFavorite = favorites.has(fn.path);
    const canPopOut = POPOUT_PAGES[fn.path] !== undefined;
    const badgeValue = fn.badgeKey ? badges[fn.badgeKey] : undefined;

    return (
      <div
        key={fn.path}
        className="group relative transition-all duration-150 hover:bg-surface-raised active:scale-[0.98]"
        style={{
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border-default)',
        }}
      >
        <button
          type="button"
          onClick={() => handleNavigate(fn.path)}
          onAuxClick={(e) => { if (e.button === 1) handleNavigate(fn.path, true); }}
          className="w-full flex items-start gap-3 p-3 text-left"
        >
          <div
            className="flex-shrink-0 flex items-center justify-center transition-colors group-hover:bg-brand-900/20"
            style={{
              width: 32,
              height: 32,
              background: 'rgba(136,136,136,0.08)',
              border: '1px solid #1a1a1a',
              position: 'relative',
            }}
          >
            <Icon className="w-4 h-4 text-rmpg-300 group-hover:text-brand-400 transition-colors" />
            {badgeValue !== undefined && badgeValue > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 flex items-center justify-center font-bold"
                style={{
                  minWidth: 14, height: 14, padding: '0 3px',
                  fontSize: 8, lineHeight: 1,
                  background: '#dc2626', color: '#fff',
                  borderRadius: 7, border: '1px solid #141414',
                  boxShadow: '0 0 6px rgba(220, 38, 38, 0.5)',
                }}
              >
                {badgeValue > 99 ? '99+' : badgeValue}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-white group-hover:text-brand-400 transition-colors truncate">
                {fn.label}
              </span>
              {fn.shortcut && (
                <span
                  className="text-[8px] font-mono px-1 py-0.5 flex-shrink-0"
                  style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', color: '#666' }}
                >
                  {fn.shortcut}
                </span>
              )}
            </div>
            <span
              className="text-[8px] font-mono text-rmpg-600 block mt-0.5 truncate"
              title={fn.path}
            >
              {fn.path}
            </span>
            <p className="text-[9px] text-rmpg-400 leading-relaxed mt-1 line-clamp-2">
              {fn.description}
            </p>
          </div>
        </button>

        <div
          className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {canPopOut && (
            <button
              type="button"
              onClick={(e) => handlePopOut(fn.path, e)}
              className="p-1 text-rmpg-500 hover:text-rmpg-300 transition-colors"
              title={`Open ${fn.label} in new window`}
              aria-label={`Pop out ${fn.label}`}
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => toggleFavorite(fn.path, e)}
            className="p-1 transition-colors"
            style={{ color: isFavorite ? '#d4a017' : '#444' }}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={isFavorite ? `Remove ${fn.label} from favorites` : `Add ${fn.label} to favorites`}
          >
            <Star className="w-3 h-3" fill={isFavorite ? '#d4a017' : 'none'} />
          </button>
        </div>
      </div>
    );
  }
}
