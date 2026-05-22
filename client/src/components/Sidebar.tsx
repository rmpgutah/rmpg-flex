import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Radio, Map, Monitor, Terminal, Database, FileText,
  ClipboardList, Search, CreditCard, Package, Briefcase, AlertTriangle,
  FileWarning, ShieldBan, Construction, Gavel, UserX, Users, Car, Video,
  MessageSquare, QrCode, BarChart3, Calendar, TrendingUp, ClipboardCheck,
  Settings, ScrollText, Network, ChevronLeft, ChevronRight, Camera, Mail, Download,
} from 'lucide-react';

// ─── Sidebar Navigation Structure ──────────────────────────────
interface SidebarItem {
  path: string;
  icon: React.ElementType;
  label: string;
  adminOnly?: boolean;
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
      { path: '/map', icon: Map, label: 'Tactical Map' },
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
      { path: '/field-interviews', icon: ClipboardList, label: 'Field Interviews' },
      { path: '/criminal-history', icon: Search, label: 'Criminal History' },
      { path: '/dl-search', icon: CreditCard, label: 'DL Search' },
      { path: '/evidence', icon: Package, label: 'Evidence' },
      { path: '/cases', icon: Briefcase, label: 'Cases' },
    ],
  },
  {
    id: 'enforce',
    label: 'Enforcement',
    items: [
      { path: '/warrants', icon: AlertTriangle, label: 'Warrants' },
      { path: '/citations', icon: FileWarning, label: 'Citations' },
      { path: '/trespass-orders', icon: ShieldBan, label: 'Trespass Orders' },
      { path: '/code-enforcement', icon: Construction, label: 'Code Enforcement' },
      { path: '/court', icon: Gavel, label: 'Court Tracker' },
      { path: '/offender-registry', icon: UserX, label: 'Offender Registry' },
    ],
  },
  {
    id: 'personnel',
    label: 'Personnel & Fleet',
    items: [
      { path: '/personnel', icon: Users, label: 'Personnel' },
      { path: '/fleet', icon: Car, label: 'Fleet' },
      { path: '/body-cameras', icon: Video, label: 'Body Cameras' },
      { path: '/dash-cameras', icon: Camera, label: 'Dash Cameras' },
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
    id: 'analysis',
    label: 'Analysis & Reports',
    items: [
      { path: '/reports', icon: BarChart3, label: 'Reports' },
      { path: '/shift-plans', icon: Calendar, label: 'Shift Plans' },
      { path: '/crime-analysis', icon: TrendingUp, label: 'Crime Analysis' },
      { path: '/statute-analytics', icon: BarChart3, label: 'Statute Analytics' },
      { path: '/reports/custom', icon: Database, label: 'Report Builder' },
      { path: '/forensics', icon: Network, label: 'Connections', adminOnly: true },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { path: '/audit', icon: ScrollText, label: 'Audit Log', adminOnly: true },
      { path: '/downloads', icon: Download, label: 'Downloads' },
      { path: '/admin', icon: Settings, label: 'Admin', adminOnly: true },
    ],
  },
];

// Paths blocked for contract_manager role
const CONTRACT_MANAGER_BLOCKED = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar',
]);

interface SidebarProps {
  isAdmin: boolean;
  isContractManager: boolean;
}

export default function Sidebar({ isAdmin, isContractManager }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

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

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const isVisible = (item: SidebarItem) => {
    if (item.adminOnly && !isAdmin) return false;
    if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(item.path)) return false;
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
        background: 'linear-gradient(180deg, #121212 0%, #0c0c0c 100%)',
        borderRight: '1px solid #2b2b2b',
      }}
    >
      {/* Scrollable nav sections */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2" style={{ scrollbarWidth: 'none' }}>
        {filteredSections.map((section) => (
          <div key={section.id} className="mb-1">
            {/* Section label — visible only when expanded */}
            {!collapsed && (
              <div
                className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                style={{ color: '#666666' }}
              >
                {section.label}
              </div>
            )}

            {/* Collapsed: thin separator between groups */}
            {collapsed && section.id !== 'ops' && (
              <div className="mx-3 my-1" style={{ borderTop: '1px solid #2b2b2b' }} />
            )}

            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);

              return (
                <button type="button"
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  onMouseEnter={() => collapsed ? setHoveredSection(item.path) : undefined}
                  onMouseLeave={() => setHoveredSection(null)}
                  className={`relative w-full flex items-center gap-3 transition-all duration-100 ${!active ? 'hover:bg-[#181818]' : ''}`}
                  style={{
                    height: 34,
                    padding: collapsed ? '0 0 0 18px' : '0 12px 0 16px',
                    background: active ? 'rgba(136, 136, 136, 0.15)' : 'transparent',
                    color: active ? '#ffffff' : '#888888',
                    borderLeft: active ? '3px solid #888888' : '3px solid transparent',
                  }}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      color: active ? '#aaaaaa' : '#666666',
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
                        background: '#141414',
                        border: '1px solid #2a2a2a',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        top: '50%',
                        transform: 'translateY(-50%)',
                      }}
                    >
                      <span className="text-[10px] font-medium text-white">{item.label}</span>
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
          borderTop: '1px solid #2b2b2b',
          background: '#050505',
          color: '#666666',
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
