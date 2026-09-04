import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, Radio, Map, Monitor, Terminal, Database, FileText,
  ClipboardList, Search, CreditCard, Package, Briefcase, AlertTriangle,
  FileWarning, ShieldBan, Construction, Gavel, UserX, Users, Car, Video, Scale,
  MessageSquare, QrCode, BarChart3, Calendar, TrendingUp, ClipboardCheck,
  Settings, ScrollText, Network, ChevronLeft, ChevronRight, Camera, Mail,
  Upload, Building2, ShieldAlert, Megaphone, GraduationCap, CheckCircle,
  DollarSign, Shield, Share2, Swords, Brain, Heart, Bell, Pill, Award, UserPlus,
  Globe, ScanSearch, Film, CalendarDays, Route, Fingerprint, FileSearch,
  Store, PawPrint, Warehouse, UserCog, MessageCircleQuestion, FlaskConical, Handshake,
  Phone, PhoneCall,
} from 'lucide-react';
import { isFeatureEnabled, useFeatureFlags } from '../utils/featureFlags';

// ─── Sidebar Navigation Structure ──────────────────────────────
interface SidebarItem {
  path: string;
  icon: React.ElementType;
  label: string;
  adminOnly?: boolean;
  /** When true, only highlight this item on an exact path match (no startsWith).
   *  Use when another sidebar entry is a more-specific sub-path of this one. */
  exact?: boolean;
}

interface SidebarSection {
  id: string;
  label: string;
  items: SidebarItem[];
}

const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    id: 'ops',
    label: 'Operations',
    items: [
      { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/dispatch', icon: Radio, label: 'Dispatch' },
      { path: '/dialer-connect', icon: PhoneCall, label: 'Dialer Connect' },
      { path: '/map', icon: Map, label: 'Tactical Map' },
      { path: '/route-builder', icon: Route, label: 'Route Builder' },
      { path: '/mdt', icon: Monitor, label: 'MDT' },
      { path: '/ncic', icon: Terminal, label: 'NCIC' },
      { path: '/patrol', icon: QrCode, label: 'Patrol' },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    items: [
      { path: '/incidents', icon: FileText, label: 'Incidents' },
      { path: '/records', icon: Database, label: 'Records' },
      { path: '/arrest-records', icon: Fingerprint, label: 'Arrest Records' },
      { path: '/field-interviews', icon: ClipboardList, label: 'Field Interviews' },
      { path: '/criminal-history', icon: Search, label: 'Criminal History' },
      { path: '/dl-search', icon: CreditCard, label: 'DL Search' },
      { path: '/evidence', icon: Package, label: 'Evidence' },
      { path: '/cases', icon: Briefcase, label: 'Cases' },
      { path: '/crash-reports', icon: FileSearch, label: 'Crash Reports' },
      { path: '/impound', icon: Warehouse, label: 'Impound Lot' },
    ],
  },
  {
    id: 'enforce',
    label: 'Enforcement',
    items: [
      { path: '/warrants', icon: AlertTriangle, label: 'Warrant Search' },
      { path: '/national-warrant-search', icon: Globe, label: 'National Warrants' },
      { path: '/citations', icon: FileWarning, label: 'Citations' },
      { path: '/law-book', icon: Scale, label: 'Law Book' },
      { path: '/trespass-orders', icon: ShieldBan, label: 'Trespass Orders' },
      { path: '/code-enforcement', icon: Construction, label: 'Code Enforcement' },
      { path: '/court', icon: Gavel, label: 'Court Tracker' },
      { path: '/nsopw', icon: UserX, label: 'Sex Offender Registry' },
    ],
  },
  {
    id: 'serve',
    label: 'Process Service',
    items: [
      { path: '/serve-intake/scheduler', icon: CalendarDays, label: 'Scheduler' },
      { path: '/serve-intake', icon: Upload, label: 'Serve Intake', exact: true },
      { path: '/serve', icon: Briefcase, label: 'Process Server' },
    ],
  },
  {
    id: 'personnel',
    label: 'Personnel & Fleet',
    items: [
      { path: '/personnel', icon: Users, label: 'Personnel' },
      { path: '/hr', icon: UserCog, label: 'Human Resources' },
      { path: '/fleet', icon: Car, label: 'Fleet' },
      { path: '/body-cameras', icon: Video, label: 'Body Cameras' },
      { path: '/dash-cameras', icon: Camera, label: 'Dash Cameras' },
      { path: '/flexcam', icon: Film, label: 'Trip Footage' },
    ],
  },
  {
    id: 'comms',
    label: 'Communications',
    items: [
      { path: '/communications', icon: MessageSquare, label: 'Communications' },
      { path: '/email', icon: Mail, label: 'Email' },
      { path: '/dar', icon: ClipboardCheck, label: 'Daily Activity' },
    ],
  },
  {
    id: 'investigate',
    label: 'Investigations',
    items: [
      { path: '/skip-tracer', icon: Search, label: 'Skip Tracer' },
      { path: '/microbilt', icon: Search, label: 'Skip Tracer V2' },
      { path: '/forensic-lab', icon: FlaskConical, label: 'Forensic Lab' },
      { path: '/web-research', icon: Globe, label: 'Web Research' },
      { path: '/crm', icon: Handshake, label: 'CRM' },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis & Reports',
    items: [
      { path: '/reports', icon: BarChart3, label: 'Reports', exact: true },
      { path: '/shift-plans', icon: Calendar, label: 'Shift Plans' },
      { path: '/crime-analysis', icon: TrendingUp, label: 'Crime Analysis' },
      { path: '/analytics', icon: ScanSearch, label: 'Plate Analytics' },
      { path: '/statute-analytics', icon: BarChart3, label: 'Statute Analytics' },
      { path: '/reports/custom', icon: Database, label: 'Report Builder' },
      { path: '/connections', icon: Network, label: 'Connections', adminOnly: true },
    ],
  },
  {
    id: 'intel',
    label: 'Intelligence',
    items: [
      { path: '/intel/reports', icon: FileText, label: 'Intel Products' },
      { path: '/intel/sources', icon: Network, label: 'Source Registry' },
      { path: '/intel/workbench', icon: Share2, label: 'Intel Workbench' },
      { path: '/person-intel', icon: ScanSearch, label: 'Person Intel' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { path: '/audit', icon: ScrollText, label: 'Audit Log', adminOnly: true },
      { path: '/admin', icon: Settings, label: 'Admin', adminOnly: true },
      { path: '/security-dashboard', icon: ShieldAlert, label: 'Security', adminOnly: true },
    ],
  },
  {
    id: 'support',
    label: 'Support Services',
    items: [
      { path: '/jail', icon: Building2, label: 'Jail Management' },
      { path: '/affairs', icon: ShieldAlert, label: 'Internal Affairs' },
      { path: '/assets', icon: Package, label: 'Asset Management' },
      { path: '/community', icon: Users, label: 'Community' },
      { path: '/tasks', icon: ClipboardList, label: 'Tasks' },
      { path: '/alerts', icon: Megaphone, label: 'Notifications' },
      { path: '/training-mgmt', icon: GraduationCap, label: 'Training' },
      { path: '/qa', icon: CheckCircle, label: 'QA' },
      { path: '/billing', icon: DollarSign, label: 'Billing' },
      { path: '/risk', icon: Shield, label: 'Risk Mgmt' },
      { path: '/interagency', icon: Share2, label: 'Interagency' },
      { path: '/gang-intel', icon: ShieldAlert, label: 'Gang Intel' },
      { path: '/special-ops', icon: Swords, label: 'Special Ops' },
      { path: '/crisis-response', icon: Brain, label: 'Crisis Response' },
      { path: '/victim-services', icon: Heart, label: 'Victim Services' },
      { path: '/alarms', icon: Bell, label: 'Alarm Mgmt' },
      { path: '/narcotics', icon: Pill, label: 'Narcotics' },
      { path: '/accreditation', icon: Award, label: 'Accreditation' },
      { path: '/recruitment', icon: UserPlus, label: 'Recruitment' },
    ],
  },
];

// Paths blocked for contract_manager role
const CONTRACT_MANAGER_BLOCKED = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar', '/analytics',
]);

interface SidebarProps {
  isAdmin: boolean;
  isContractManager: boolean;
}

export default function Sidebar({ isAdmin, isContractManager }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  useFeatureFlags();

  // Persist collapsed state
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', String(collapsed)); } catch {}
  }, [collapsed]);

  // Track which section is hovered (for collapsed tooltip flyouts)
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);

  const isActive = (path: string, exact?: boolean) =>
    path === '/' || exact
      ? location.pathname === path
      : location.pathname === path || location.pathname.startsWith(path + '/');

  const isVisible = (item: SidebarItem) => {
    if (item.adminOnly && !isAdmin) return false;
    if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(item.path)) return false;
    if (!isFeatureEnabled(item.path)) return false;
    return true;
  };

  const filteredSections = SIDEBAR_SECTIONS.map(section => ({
    ...section,
    items: section.items.filter(isVisible),
  })).filter(section => section.items.length > 0);

  return (
    <nav
      className="flex flex-col h-full flex-shrink-0 transition-[width] duration-200 ease-out select-none"
      style={{
        width: collapsed ? 56 : 220,
        background: 'linear-gradient(180deg, var(--surface-overlay) 0%, var(--surface-deep) 100%)',
        borderRight: '1px solid var(--border-default)',
      }}
    >
      {/* Scrollable nav sections */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2" style={{ scrollbarWidth: 'none' }}>
        {filteredSections.map((section) => (
          <div key={section.id} className="mb-1">
            {/* Section label — visible only when expanded */}
            {!collapsed && (
              <div
                                className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-fg-muted"
              >
                {section.label}
              </div>
            )}

            {/* Collapsed: thin separator between groups */}
            {collapsed && section.id !== 'ops' && (
              <div className="mx-3 my-1" style={{ borderTop: '1px solid var(--border-default)' }} />
            )}

            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path, item.exact);

              return (
                <button type="button"
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  onMouseEnter={() => collapsed ? setHoveredSection(item.path) : undefined}
                  onMouseLeave={() => setHoveredSection(null)}
                  className={`relative w-full flex items-center gap-3 transition-all duration-100 ${!active ? 'hover:bg-surface-raised' : ''}`}
                  style={{
                    height: 34,
                    padding: collapsed ? '0 0 0 18px' : '0 12px 0 16px',
                    background: active ? 'rgba(136, 136, 136, 0.15)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderLeft: active ? '3px solid var(--border-default)' : '3px solid transparent',
                  }}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      color: active ? 'var(--text-secondary)' : 'var(--text-muted)',
                      transition: 'color 0.1s',
                    }}
                  />
                  {!collapsed && (
                    <span
                      className="text-[11px] font-medium truncate"
                      style={{ lineHeight: '16px' }}
                    >
                      {item.label}
                    </span>
                  )}

                  {/* Collapsed tooltip */}
                  {collapsed && hoveredSection === item.path && (
                    <div
                      className="absolute left-full ml-2 px-2.5 py-1.5 whitespace-nowrap z-50"
                      style={{
                        background: 'var(--surface-base)',
                        border: '1px solid var(--border-default)',
                        boxShadow: '0 4px 12px rgba(0 0 0 / 0.5)',
                        top: '50%',
                        transform: 'translateY(-50%)',
                      }}
                    >
                      <span className="text-[10px] font-medium text-rmpg-100">{item.label}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Collapse toggle at bottom */}
      <button type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center gap-2 py-2 transition-colors"
        style={{
          height: 36,
          borderTop: '1px solid var(--border-default)',
          background: 'var(--surface-overlay)',
          color: 'var(--text-muted)',
        }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRight style={{ width: 14, height: 14 }} />
        ) : (
          <>
            <ChevronLeft style={{ width: 14, height: 14 }} />
            <span className="text-[9px] font-mono uppercase tracking-wider">Collapse</span>
          </>
        )}
      </button>
    </nav>
  );
}
