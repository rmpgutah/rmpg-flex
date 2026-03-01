// ============================================================
// RMPG Flex — Spillman Flex Menu Bar
// File | View | Tools | Help — with dropdown menus & submenus
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { printWithLightMaps } from '../utils/googleMapsLoader';
import {
  Radio,
  FileText,
  Database,
  Users,
  MessageSquare,
  BarChart3,
  Map,
  LayoutDashboard,
  QrCode,
  ScrollText,
  Settings,
  LogOut,
  Search,
  Printer,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  Eye,
  EyeOff,
  Clock,
  Phone,
  AlertTriangle,
  Plus,
  Download,
  Upload,
  Keyboard,
  Info,
  Shield,
  ChevronRight,
  Zap,
  Bell,
  BellOff,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  ClipboardList,
  Activity,
  Wifi,
  WifiOff,
  Globe,
  Hash,
  Car,
  FileWarning,
  Terminal,
  Briefcase,
  Scale,
  Gavel,
  BookOpen,
  FolderOpen,
  Microscope,
  CalendarDays,
  Clipboard,
  MapPin,
  Siren,
  Package,
  UserCheck,
  FileSearch,
  PenTool,
  HeartPulse,
  ShieldAlert,
  GraduationCap,
  Server,
  HardDrive,
  Palette,
  Bug,
  Sparkles,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

interface MenuItemBase {
  label: string;
  icon?: React.ElementType;
  shortcut?: string;
  disabled?: boolean;
  adminOnly?: boolean;
}

interface MenuAction extends MenuItemBase {
  type: 'action';
  action: () => void;
}

interface MenuSeparator {
  type: 'separator';
}

interface MenuToggle extends MenuItemBase {
  type: 'toggle';
  checked: boolean;
  action: () => void;
}

interface MenuSubmenu extends MenuItemBase {
  type: 'submenu';
  items: MenuItem[];
}

type MenuItem = MenuAction | MenuSeparator | MenuToggle | MenuSubmenu;

interface MenuDefinition {
  label: string;
  items: MenuItem[];
}

// ============================================================
// Props
// ============================================================

interface MenuBarProps {
  isAdmin: boolean;
  isConnected: boolean;
  onLogout: () => void;
  onSearch: () => void;
  onShowShortcuts: () => void;
  onRefreshData: () => void;
}

// ============================================================
// Component
// ============================================================

export default function MenuBar({
  isAdmin,
  isConnected,
  onLogout,
  onSearch,
  onShowShortcuts,
  onRefreshData,
}: MenuBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  // UI toggle states (persisted in localStorage)
  const [scanLinesEnabled, setScanLinesEnabled] = useState(() => {
    return localStorage.getItem('rmpg-scanlines') !== 'false';
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('rmpg-sound') !== 'false';
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem('rmpg-notifications') !== 'false';
  });
  const [compactMode, setCompactMode] = useState(() => {
    return localStorage.getItem('rmpg-compact') === 'true';
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [show10Codes, setShow10Codes] = useState(false);

  // Track fullscreen changes
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setActiveSubmenu(null);
      }
    };
    if (openMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openMenu]);

  // Close menus on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openMenu) {
        setOpenMenu(null);
        setActiveSubmenu(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [openMenu]);

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
    setActiveSubmenu(null);
  }, []);

  const handleAction = useCallback((action: () => void) => {
    action();
    closeMenus();
  }, [closeMenus]);

  // Toggle helpers
  const toggleScanLines = useCallback(() => {
    const next = !scanLinesEnabled;
    setScanLinesEnabled(next);
    localStorage.setItem('rmpg-scanlines', String(next));
    document.body.classList.toggle('no-scanlines', !next);
  }, [scanLinesEnabled]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('rmpg-sound', String(next));
  }, [soundEnabled]);

  const toggleNotifications = useCallback(() => {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    localStorage.setItem('rmpg-notifications', String(next));
  }, [notificationsEnabled]);

  const toggleCompactMode = useCallback(() => {
    const next = !compactMode;
    setCompactMode(next);
    localStorage.setItem('rmpg-compact', String(next));
    document.body.classList.toggle('compact-mode', next);
  }, [compactMode]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  const currentPage = location.pathname;

  // ============================================================
  // Menu Definitions
  // ============================================================

  // ── FILE MENU ──────────────────────────────────────────────
  const fileMenu: MenuDefinition = {
    label: 'File',
    items: [
      {
        type: 'submenu',
        label: 'New',
        icon: Plus,
        items: [
          { type: 'action', label: 'Call for Service', icon: Phone, shortcut: 'N', action: () => { navigate('/dispatch'); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' })), 100); } },
          { type: 'action', label: 'Incident Report', icon: FileText, action: () => { navigate('/incidents'); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' })), 100); } },
          { type: 'separator' },
          { type: 'action', label: 'Field Interview', icon: Clipboard, action: () => navigate('/field-interviews') },
          { type: 'action', label: 'Citation', icon: FileWarning, action: () => navigate('/citations') },
          { type: 'action', label: 'Warrant', icon: Gavel, action: () => navigate('/warrants') },
          { type: 'action', label: 'Trespass Order', icon: ShieldAlert, action: () => navigate('/trespass-orders') },
          { type: 'separator' },
          { type: 'action', label: 'BOLO Alert', icon: AlertTriangle, action: () => navigate('/communications') },
          { type: 'action', label: 'Message', icon: MessageSquare, action: () => navigate('/communications') },
        ],
      },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Open Module',
        icon: Globe,
        items: [
          { type: 'action', label: 'Dashboard', icon: LayoutDashboard, action: () => navigate('/') },
          { type: 'action', label: 'Dispatch', icon: Radio, action: () => navigate('/dispatch') },
          { type: 'action', label: 'Map', icon: Map, action: () => navigate('/map') },
          { type: 'action', label: 'MDT Terminal', icon: Terminal, action: () => navigate('/mdt') },
          { type: 'separator' },
          { type: 'action', label: 'Incidents', icon: FileText, action: () => navigate('/incidents') },
          { type: 'action', label: 'Records', icon: Database, action: () => navigate('/records') },
          { type: 'action', label: 'Warrants', icon: Gavel, action: () => navigate('/warrants') },
          { type: 'action', label: 'Citations', icon: FileWarning, action: () => navigate('/citations') },
          { type: 'action', label: 'Evidence & Property', icon: Package, action: () => navigate('/evidence') },
          { type: 'separator' },
          { type: 'action', label: 'Case Management', icon: Briefcase, action: () => navigate('/cases') },
          { type: 'action', label: 'Criminal History', icon: FileSearch, action: () => navigate('/criminal-history') },
          { type: 'action', label: 'Offender Registry', icon: UserCheck, action: () => navigate('/offender-registry') },
          { type: 'separator' },
          { type: 'action', label: 'Personnel', icon: Users, action: () => navigate('/personnel') },
          { type: 'action', label: 'Fleet', icon: Car, action: () => navigate('/fleet') },
          { type: 'action', label: 'Shift Plans', icon: CalendarDays, action: () => navigate('/shift-plans') },
          { type: 'separator' },
          { type: 'action', label: 'Communications', icon: MessageSquare, action: () => navigate('/communications') },
          { type: 'action', label: 'Radio', icon: Radio, action: () => navigate('/radio') },
          { type: 'action', label: 'Patrol', icon: QrCode, action: () => navigate('/patrol') },
          { type: 'separator' },
          { type: 'action', label: 'Reports', icon: BarChart3, action: () => navigate('/reports') },
          { type: 'action', label: 'Daily Activity', icon: Clipboard, action: () => navigate('/dar') },
          { type: 'action', label: 'Crime Analysis', icon: Microscope, action: () => navigate('/crime-analysis') },
          { type: 'separator' },
          { type: 'action', label: 'Audit Trail', icon: ScrollText, action: () => navigate('/audit'), adminOnly: true },
          { type: 'action', label: 'Administration', icon: Settings, action: () => navigate('/admin'), adminOnly: true },
        ],
      },
      { type: 'separator' },
      { type: 'action', label: 'Export Current View...', icon: Download, shortcut: 'Ctrl+E', action: () => printWithLightMaps() },
      { type: 'action', label: 'Print Current View...', icon: Printer, shortcut: 'Ctrl+P', action: () => printWithLightMaps() },
      { type: 'separator' },
      { type: 'action', label: 'Refresh Data', icon: RefreshCw, shortcut: 'F5', action: onRefreshData },
      { type: 'separator' },
      { type: 'action', label: 'Sign Out', icon: LogOut, action: onLogout },
    ],
  };

  // ── VIEW MENU ─────────────────────────────────────────────
  const viewMenu: MenuDefinition = {
    label: 'View',
    items: [
      {
        type: 'submenu',
        label: 'Navigate To',
        icon: Globe,
        items: [
          { type: 'action', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'Alt+1', action: () => navigate('/') },
          { type: 'action', label: 'Dispatch', icon: Radio, shortcut: 'Alt+2', action: () => navigate('/dispatch') },
          { type: 'action', label: 'Map', icon: Map, shortcut: 'Alt+3', action: () => navigate('/map') },
          { type: 'action', label: 'Records', icon: Database, shortcut: 'Alt+4', action: () => navigate('/records') },
          { type: 'action', label: 'Personnel', icon: Users, shortcut: 'Alt+5', action: () => navigate('/personnel') },
          { type: 'action', label: 'Comms', icon: MessageSquare, shortcut: 'Alt+6', action: () => navigate('/communications') },
          { type: 'action', label: 'Reports', icon: BarChart3, shortcut: 'Alt+7', action: () => navigate('/reports') },
          { type: 'action', label: 'MDT', icon: Terminal, shortcut: 'Alt+8', action: () => navigate('/mdt') },
        ],
      },
      { type: 'separator' },
      { type: 'toggle', label: 'Fullscreen Mode', icon: isFullscreen ? Minimize2 : Maximize2, shortcut: 'F11', checked: isFullscreen, action: toggleFullscreen },
      { type: 'toggle', label: 'Compact Mode', icon: Monitor, checked: compactMode, action: toggleCompactMode },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Display Effects',
        icon: Monitor,
        items: [
          { type: 'toggle', label: 'CRT Scan Lines', icon: Activity, checked: scanLinesEnabled, action: toggleScanLines },
        ],
      },
      {
        type: 'submenu',
        label: 'Alerts & Notifications',
        icon: Bell,
        items: [
          { type: 'toggle', label: 'Desktop Notifications', icon: notificationsEnabled ? Bell : BellOff, checked: notificationsEnabled, action: toggleNotifications },
          { type: 'toggle', label: 'Sound Effects', icon: soundEnabled ? Volume2 : VolumeX, checked: soundEnabled, action: toggleSound },
        ],
      },
      { type: 'separator' },
      { type: 'action', label: 'Refresh Data', icon: RefreshCw, shortcut: 'F5', action: onRefreshData },
    ],
  };

  // ── TOOLS MENU ────────────────────────────────────────────
  const toolsMenu: MenuDefinition = {
    label: 'Tools',
    items: [
      { type: 'action', label: 'Global Search', icon: Search, shortcut: 'Ctrl+K', action: onSearch },
      { type: 'action', label: 'NCIC Query Terminal', icon: Terminal, action: () => navigate('/ncic') },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Dispatch & Field',
        icon: Radio,
        items: [
          { type: 'action', label: 'New Call for Service', icon: Phone, shortcut: 'N', action: () => { navigate('/dispatch'); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' })), 100); } },
          { type: 'action', label: 'Active Calls Board', icon: ClipboardList, action: () => navigate('/dispatch') },
          { type: 'action', label: 'MDT Terminal', icon: Terminal, action: () => navigate('/mdt') },
          { type: 'separator' },
          { type: 'action', label: 'Patrol Scanner', icon: QrCode, action: () => navigate('/patrol') },
          { type: 'action', label: 'Shift Planning', icon: CalendarDays, action: () => navigate('/shift-plans') },
          { type: 'action', label: 'Daily Activity Reports', icon: Clipboard, action: () => navigate('/dar') },
        ],
      },
      {
        type: 'submenu',
        label: 'Records & Lookup',
        icon: Database,
        items: [
          { type: 'action', label: 'Person Search', icon: Users, action: () => navigate('/records') },
          { type: 'action', label: 'Vehicle Search', icon: Car, action: () => navigate('/records') },
          { type: 'action', label: 'Incident Lookup', icon: FileText, action: () => navigate('/incidents') },
          { type: 'separator' },
          { type: 'action', label: 'Criminal History', icon: FileSearch, action: () => navigate('/criminal-history') },
          { type: 'action', label: 'Warrant Check', icon: Gavel, action: () => navigate('/warrants') },
          { type: 'action', label: 'Offender Registry', icon: UserCheck, action: () => navigate('/offender-registry') },
        ],
      },
      {
        type: 'submenu',
        label: 'Enforcement',
        icon: Shield,
        items: [
          { type: 'action', label: 'Case Management', icon: Briefcase, action: () => navigate('/cases') },
          { type: 'action', label: 'Evidence & Property', icon: Package, action: () => navigate('/evidence') },
          { type: 'action', label: 'Code Enforcement', icon: Scale, action: () => navigate('/code-enforcement') },
          { type: 'action', label: 'Court Tracker', icon: Gavel, action: () => navigate('/court') },
          { type: 'action', label: 'Trespass Orders', icon: ShieldAlert, action: () => navigate('/trespass-orders') },
        ],
      },
      {
        type: 'submenu',
        label: 'Communications',
        icon: MessageSquare,
        items: [
          { type: 'action', label: 'Send Message', icon: MessageSquare, action: () => navigate('/communications') },
          { type: 'action', label: 'Issue BOLO', icon: AlertTriangle, action: () => navigate('/communications') },
          { type: 'action', label: 'View Active BOLOs', icon: Eye, action: () => navigate('/communications') },
          { type: 'separator' },
          { type: 'action', label: 'Radio Console', icon: Radio, action: () => navigate('/radio') },
        ],
      },
      {
        type: 'submenu',
        label: 'Analysis & Reports',
        icon: BarChart3,
        items: [
          { type: 'action', label: 'Crime Analysis', icon: Microscope, action: () => navigate('/crime-analysis') },
          { type: 'action', label: 'Statute Analytics', icon: Scale, action: () => navigate('/statute-analytics') },
          { type: 'action', label: 'Custom Report Builder', icon: PenTool, action: () => navigate('/reports/custom') },
          { type: 'separator' },
          { type: 'action', label: 'Reports Dashboard', icon: BarChart3, action: () => navigate('/reports') },
        ],
      },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Administration',
        icon: Settings,
        adminOnly: true,
        items: [
          { type: 'action', label: 'User Management', icon: Users, action: () => navigate('/admin') },
          { type: 'action', label: 'System Configuration', icon: Settings, action: () => navigate('/admin') },
          { type: 'action', label: 'Security Policy', icon: ShieldAlert, action: () => navigate('/admin') },
          { type: 'action', label: 'Branding & Reports', icon: Palette, action: () => navigate('/admin') },
          { type: 'separator' },
          { type: 'action', label: 'Audit Trail', icon: ScrollText, action: () => navigate('/audit') },
          { type: 'action', label: 'Training Management', icon: GraduationCap, action: () => navigate('/admin') },
        ],
      },
    ],
  };

  // ── HELP MENU ─────────────────────────────────────────────
  const helpMenu: MenuDefinition = {
    label: 'Help',
    items: [
      { type: 'action', label: 'Keyboard Shortcuts', icon: Keyboard, shortcut: '?', action: onShowShortcuts },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Quick Reference',
        icon: ClipboardList,
        items: [
          { type: 'action', label: '10-Codes Reference', icon: Radio, action: () => { setShow10Codes(true); } },
          { type: 'action', label: 'Priority Levels', icon: Zap, action: () => { navigate('/admin'); } },
          { type: 'action', label: 'Disposition Codes', icon: Hash, action: () => { navigate('/admin'); } },
          { type: 'action', label: 'Incident Types', icon: FileText, action: () => { navigate('/admin'); } },
        ],
      },
      {
        type: 'submenu',
        label: 'Training & Docs',
        icon: GraduationCap,
        items: [
          { type: 'action', label: 'Policies & Training Docs', icon: BookOpen, action: () => navigate('/training-docs') },
          { type: 'action', label: 'Field Operations Guide', icon: Clipboard, action: () => { setShow10Codes(true); } },
        ],
      },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'System Status',
        icon: isConnected ? Wifi : WifiOff,
        items: [
          { type: 'action', label: `WebSocket: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`, icon: isConnected ? Wifi : WifiOff, disabled: true, action: () => {} },
          { type: 'action', label: 'Server: RMPG-FLEX-01', icon: Server, disabled: true, action: () => {} },
          { type: 'action', label: `Page: ${currentPage}`, icon: Globe, disabled: true, action: () => {} },
          { type: 'separator' },
          { type: 'action', label: 'Reconnect', icon: RefreshCw, action: () => window.location.reload() },
          { type: 'action', label: 'System Health', icon: HeartPulse, action: () => navigate('/admin'), adminOnly: true },
        ],
      },
      { type: 'separator' },
      { type: 'action', label: 'Report a Problem', icon: Bug, action: () => navigate('/admin') },
      { type: 'action', label: 'About RMPG Flex', icon: Info, action: () => navigate('/') },
      { type: 'action', label: 'Version 5.3.9', icon: Shield, disabled: true, action: () => {} },
    ],
  };

  const menus = [fileMenu, viewMenu, toolsMenu, helpMenu];

  // ============================================================
  // Rendering
  // ============================================================

  const handleMenuClick = (label: string) => {
    setOpenMenu(prev => prev === label ? null : label);
    setActiveSubmenu(null);
  };

  const handleMenuHover = (label: string) => {
    if (openMenu && openMenu !== label) {
      setOpenMenu(label);
      setActiveSubmenu(null);
    }
  };

  const renderMenuItem = (item: MenuItem, index: number, depth: number = 0): React.ReactNode => {
    if (item.type === 'separator') {
      return <div key={`sep-${index}`} className="menu-separator" />;
    }

    // Check admin-only
    if ('adminOnly' in item && item.adminOnly && !isAdmin) return null;

    const Icon = item.icon;
    const isDisabled = item.disabled;

    if (item.type === 'submenu') {
      const submenuId = `${depth}-${index}-${item.label}`;
      const isSubmenuOpen = activeSubmenu === submenuId;

      return (
        <div
          key={`sub-${index}`}
          className="menu-item-container"
          onMouseEnter={() => setActiveSubmenu(submenuId)}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <div className={`menu-item ${isDisabled ? 'menu-item-disabled' : ''}`}>
            <span className="menu-item-icon">{Icon && <Icon style={{ width: 11, height: 11 }} />}</span>
            <span className="menu-item-label">{item.label}</span>
            <span className="menu-item-arrow"><ChevronRight style={{ width: 10, height: 10 }} /></span>
          </div>
          {isSubmenuOpen && (
            <div className="menu-dropdown menu-submenu">
              {item.items.map((sub, si) => renderMenuItem(sub, si, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    if (item.type === 'toggle') {
      return (
        <button
          key={`toggle-${index}`}
          className={`menu-item ${isDisabled ? 'menu-item-disabled' : ''}`}
          onClick={() => !isDisabled && handleAction(item.action)}
          disabled={isDisabled}
        >
          <span className="menu-item-icon">{Icon && <Icon style={{ width: 11, height: 11 }} />}</span>
          <span className="menu-item-label">{item.label}</span>
          <span className="menu-item-check">{item.checked ? '✓' : ''}</span>
          {item.shortcut && <span className="menu-item-shortcut">{item.shortcut}</span>}
        </button>
      );
    }

    // Regular action
    return (
      <button
        key={`action-${index}`}
        className={`menu-item ${isDisabled ? 'menu-item-disabled' : ''}`}
        onClick={() => !isDisabled && handleAction(item.action)}
        disabled={isDisabled}
      >
        <span className="menu-item-icon">{Icon && <Icon style={{ width: 11, height: 11 }} />}</span>
        <span className="menu-item-label">{item.label}</span>
        {item.shortcut && <span className="menu-item-shortcut">{item.shortcut}</span>}
      </button>
    );
  };

  return (
    <>
      <div className="flex items-center gap-0" ref={menuBarRef}>
        {menus.map((menu) => (
          <div key={menu.label} className="relative">
            <button
              className={`menu-bar-btn ${openMenu === menu.label ? 'menu-bar-btn-active' : ''}`}
              onClick={() => handleMenuClick(menu.label)}
              onMouseEnter={() => handleMenuHover(menu.label)}
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div className="menu-dropdown menu-dropdown-root">
                {menu.items.map((item, i) => renderMenuItem(item, i))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── 10-Codes Reference Modal ── */}
      {show10Codes && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setShow10Codes(false)}>
          <div
            className="panel-beveled w-[700px] max-h-[80vh] overflow-hidden flex flex-col"
            style={{ background: '#1a1a1a' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-rmpg-600" style={{ background: '#141414' }}>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-400" />
                10-Codes Quick Reference
              </h2>
              <button onClick={() => setShow10Codes(false)} className="text-rmpg-400 hover:text-white text-xs">ESC</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-2 gap-6">
                {/* General Codes */}
                <div>
                  <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2 border-b border-rmpg-700 pb-1">General</h3>
                  <div className="space-y-0.5">
                    {[
                      ['10-1', 'Unable to copy / Poor reception'],
                      ['10-2', 'Signal good / Clear reception'],
                      ['10-3', 'Stop transmitting'],
                      ['10-4', 'Acknowledgement / OK'],
                      ['10-5', 'Relay message'],
                      ['10-6', 'Busy / Stand by'],
                      ['10-7', 'Out of service'],
                      ['10-8', 'In service'],
                      ['10-9', 'Repeat last transmission'],
                      ['10-10', 'Negative / Fight in progress'],
                      ['10-11', 'Dog case / Animal complaint'],
                      ['10-12', 'Stand by / Visitors present'],
                      ['10-13', 'Weather & road conditions'],
                      ['10-14', 'Prowler report'],
                      ['10-15', 'Civil disturbance'],
                      ['10-16', 'Domestic problem'],
                      ['10-17', 'Meet complainant'],
                      ['10-18', 'Complete assignment quickly'],
                      ['10-19', 'Return to station'],
                      ['10-20', 'Location / What is your location'],
                    ].map(([code, desc]) => (
                      <div key={code} className="flex items-baseline gap-2 text-xs py-0.5">
                        <span className="text-white font-mono font-bold w-12 flex-shrink-0">{code}</span>
                        <span className="text-rmpg-300">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Status & Emergency */}
                <div>
                  <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2 border-b border-rmpg-700 pb-1">Status & Response</h3>
                  <div className="space-y-0.5">
                    {[
                      ['10-21', 'Call by telephone'],
                      ['10-22', 'Disregard last message'],
                      ['10-23', 'Arrived at scene'],
                      ['10-24', 'Assignment completed'],
                      ['10-25', 'Report in person'],
                      ['10-26', 'Detaining subject'],
                      ['10-27', 'License / ID check'],
                      ['10-28', 'Vehicle registration check'],
                      ['10-29', 'Check for wanted / warrants'],
                      ['10-30', 'Illegal use of radio'],
                      ['10-31', 'Crime in progress'],
                      ['10-32', 'Person with gun'],
                      ['10-33', 'Emergency! All clear freq'],
                      ['10-34', 'Riot'],
                      ['10-35', 'Major crime alert'],
                      ['10-36', 'Correct time'],
                      ['10-37', 'Investigate suspicious vehicle'],
                      ['10-38', 'Stopping suspicious vehicle'],
                      ['10-39', 'Urgent — use lights & siren'],
                      ['10-40', 'Silent run — no lights/siren'],
                    ].map(([code, desc]) => (
                      <div key={code} className="flex items-baseline gap-2 text-xs py-0.5">
                        <span className="text-white font-mono font-bold w-12 flex-shrink-0">{code}</span>
                        <span className="text-rmpg-300">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Operational */}
                <div>
                  <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2 border-b border-rmpg-700 pb-1">Operational</h3>
                  <div className="space-y-0.5">
                    {[
                      ['10-41', 'Beginning tour of duty'],
                      ['10-42', 'Ending tour of duty'],
                      ['10-43', 'Information'],
                      ['10-45', 'Animal carcass on road'],
                      ['10-46', 'Assist motorist'],
                      ['10-47', 'Emergency road repair'],
                      ['10-48', 'Traffic standard repair'],
                      ['10-49', 'Traffic light out'],
                      ['10-50', 'Accident (F = fatal, PI = injury)'],
                      ['10-51', 'Wrecker needed'],
                      ['10-52', 'Ambulance needed'],
                      ['10-53', 'Road blocked'],
                      ['10-54', 'Livestock on highway'],
                      ['10-55', 'Intoxicated driver'],
                      ['10-56', 'Intoxicated pedestrian'],
                      ['10-57', 'Hit and run'],
                      ['10-58', 'Direct traffic'],
                      ['10-59', 'Convoy / escort'],
                      ['10-60', 'Squad in vicinity'],
                    ].map(([code, desc]) => (
                      <div key={code} className="flex items-baseline gap-2 text-xs py-0.5">
                        <span className="text-white font-mono font-bold w-12 flex-shrink-0">{code}</span>
                        <span className="text-rmpg-300">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Special */}
                <div>
                  <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2 border-b border-rmpg-700 pb-1">Special / PSO</h3>
                  <div className="space-y-0.5">
                    {[
                      ['10-61', 'Personnel in area'],
                      ['10-62', 'Reply to message'],
                      ['10-63', 'Prepare to copy'],
                      ['10-64', 'Message for delivery'],
                      ['10-65', 'Net message assignment'],
                      ['10-66', 'Message cancellation'],
                      ['10-67', 'Clear for net message'],
                      ['10-68', 'Dispatch information'],
                      ['10-69', 'Message received'],
                      ['10-70', 'Fire alarm'],
                      ['10-71', 'Advise nature of fire'],
                      ['10-72', 'Report progress of fire'],
                      ['10-73', 'Smoke report'],
                      ['10-76', 'En route'],
                      ['10-77', 'ETA'],
                      ['10-78', 'Need assistance'],
                      ['10-79', 'Notify coroner'],
                      ['10-80', 'Chase in progress'],
                      ['10-97', 'Check signal / Arrived'],
                      ['10-98', 'Prison / Jail break'],
                      ['10-99', 'Wanted / Stolen indicated'],
                    ].map(([code, desc]) => (
                      <div key={code} className="flex items-baseline gap-2 text-xs py-0.5">
                        <span className="text-white font-mono font-bold w-12 flex-shrink-0">{code}</span>
                        <span className="text-rmpg-300">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-2 border-t border-rmpg-700 text-center" style={{ background: '#141414' }}>
              <span className="text-[9px] text-rmpg-500">Press <kbd className="px-1 py-0.5 bg-rmpg-800 border border-rmpg-600 text-rmpg-300 rounded text-[8px]">ESC</kbd> to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
