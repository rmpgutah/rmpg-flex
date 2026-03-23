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
  Mic,
  MicOff,
  Video,
  ClipboardCheck,
} from 'lucide-react';
import { setVoiceAlertsEnabled, getVoiceAlertsEnabled, demoAllVoiceAlerts } from '../utils/voiceAlerts';
import { apiFetch } from '../hooks/useApi';

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
  const [voiceAlertsEnabled, setVoiceAlertsEnabledState] = useState(() => getVoiceAlertsEnabled());
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem('rmpg-notifications') !== 'false';
  });
  const [compactMode, setCompactMode] = useState(() => {
    return localStorage.getItem('rmpg-compact') === 'true';
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [show10Codes, setShow10Codes] = useState(false);
  const [showLawBooks, setShowLawBooks] = useState(false);

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

  const toggleVoiceAlerts = useCallback(() => {
    const next = !voiceAlertsEnabled;
    setVoiceAlertsEnabledState(next);
    setVoiceAlertsEnabled(next);
  }, [voiceAlertsEnabled]);

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
          { type: 'action', label: 'Warrant', icon: Gavel, action: () => window.open('/warrants', '_blank', 'noopener,noreferrer') },
          { type: 'action', label: 'Trespass Order', icon: ShieldAlert, action: () => navigate('/trespass-orders') },
          { type: 'action', label: 'Service Job', icon: Briefcase, action: () => navigate('/serve') },
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
          { type: 'action', label: 'Warrants', icon: Gavel, action: () => window.open('/warrants', '_blank', 'noopener,noreferrer') },
          { type: 'action', label: 'Citations', icon: FileWarning, action: () => navigate('/citations') },
          { type: 'action', label: 'Evidence & Property', icon: Package, action: () => navigate('/evidence') },
          { type: 'separator' },
          { type: 'action', label: 'Case Management', icon: Briefcase, action: () => navigate('/cases') },
          { type: 'action', label: 'Criminal History', icon: FileSearch, action: () => navigate('/criminal-history') },
          { type: 'action', label: 'Offender Registry', icon: UserCheck, action: () => navigate('/offender-registry') },
          { type: 'action', label: 'Sex Offender Registry', icon: ShieldAlert, action: () => navigate('/sex-offender-registry') },
          { type: 'separator' },
          { type: 'action', label: 'Personnel', icon: Users, action: () => navigate('/personnel') },
          { type: 'action', label: 'Fleet', icon: Car, action: () => navigate('/fleet') },
          { type: 'action', label: 'Body Cameras', icon: Video, action: () => navigate('/body-cameras') },
          { type: 'action', label: 'Dash Cameras', icon: Video, action: () => navigate('/dash-cameras') },
          { type: 'action', label: 'Shift Plans', icon: CalendarDays, action: () => navigate('/shift-plans') },
          { type: 'separator' },
          { type: 'action', label: 'Communications', icon: MessageSquare, action: () => navigate('/communications') },
          { type: 'action', label: 'Radio', icon: Radio, action: () => navigate('/radio') },
          { type: 'action', label: 'Patrol', icon: QrCode, action: () => navigate('/patrol') },
          { type: 'separator' },
          { type: 'action', label: 'Reports', icon: BarChart3, action: () => navigate('/reports') },
          { type: 'action', label: 'Daily Activity', icon: Clipboard, action: () => navigate('/dar') },
          { type: 'action', label: 'Crime Analysis', icon: Microscope, action: () => navigate('/crime-analysis') },
          { type: 'action', label: 'Forensic Lab', icon: Microscope, action: () => navigate('/forensic-lab') },
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
          { type: 'toggle', label: 'Voice Alerts', icon: voiceAlertsEnabled ? Mic : MicOff, checked: voiceAlertsEnabled, action: toggleVoiceAlerts },
          { type: 'action', label: 'Test Voice Alerts', icon: Sparkles, action: () => demoAllVoiceAlerts() },
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
          { type: 'action', label: 'Arrest Records', icon: Shield, action: () => navigate('/arrest-records') },
          { type: 'separator' },
          { type: 'action', label: 'Arrest Records', icon: Scale, action: () => navigate('/arrest-records') },
          { type: 'action', label: 'Criminal History', icon: FileSearch, action: () => navigate('/criminal-history') },
          { type: 'action', label: 'Warrant Check', icon: Gavel, action: () => window.open('/warrants', '_blank', 'noopener,noreferrer') },
          { type: 'action', label: 'Offender Registry', icon: UserCheck, action: () => navigate('/offender-registry') },
          { type: 'action', label: 'Sex Offender Registry', icon: ShieldAlert, action: () => navigate('/sex-offender-registry') },
          { type: 'separator' },
          { type: 'action', label: 'Web Research', icon: Globe, action: () => navigate('/web-research') },
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
          { type: 'action', label: 'Process Server', icon: Briefcase, action: () => navigate('/serve') },
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
          { type: 'action', label: 'Forensic Lab', icon: Microscope, action: () => navigate('/forensic-lab') },
          { type: 'action', label: 'Statute Analytics', icon: Scale, action: () => navigate('/statute-analytics') },
          { type: 'action', label: 'Custom Report Builder', icon: PenTool, action: () => navigate('/reports/custom') },
          { type: 'separator' },
          { type: 'action', label: 'Reports Dashboard', icon: BarChart3, action: () => navigate('/reports') },
        ],
      },
      { type: 'separator' },
      { type: 'action', label: 'Overwatch', icon: Briefcase, action: () => navigate('/crm') },
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
          { type: 'action', label: 'Training Management', icon: GraduationCap, action: () => navigate('/training') },
          { type: 'action', label: 'HR Console', icon: ClipboardCheck, action: () => navigate('/hr') },
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
          { type: 'separator' },
          { type: 'action', label: 'Law Books', icon: Scale, action: () => { setShowLawBooks(true); } },
        ],
      },
      {
        type: 'submenu',
        label: 'Training & Docs',
        icon: GraduationCap,
        items: [
          { type: 'action', label: 'Policies & Training Docs', icon: BookOpen, action: () => navigate('/training-docs') },
          { type: 'action', label: 'Training Dashboard', icon: GraduationCap, action: () => navigate('/training') },
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
        <button type="button"
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
      <button type="button"
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
      <nav className="flex items-center gap-0" ref={menuBarRef} role="menubar" aria-label="Main application menu">
        {menus.map((menu) => (
          <div key={menu.label} className="relative" role="none">
            <button type="button"
              className={`menu-bar-btn ${openMenu === menu.label ? 'menu-bar-btn-active' : ''}`}
              onClick={() => handleMenuClick(menu.label)}
              onMouseEnter={() => handleMenuHover(menu.label)}
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={openMenu === menu.label}
              aria-label={`${menu.label} menu`}
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div className="menu-dropdown menu-dropdown-root" role="menu" aria-label={`${menu.label} submenu`}>
                {menu.items.map((item, i) => renderMenuItem(item, i))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* ── 10-Codes Reference Modal ── */}
      {show10Codes && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setShow10Codes(false)} role="dialog" aria-modal="true" aria-label="10-Codes Quick Reference">
          <div
            className="panel-beveled w-[700px] max-h-[80vh] overflow-hidden flex flex-col"
            style={{ background: '#141e2b' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-rmpg-600" style={{ background: '#0d1520' }}>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-400" />
                10-Codes Quick Reference
              </h2>
              <button type="button" onClick={() => setShow10Codes(false)} className="text-rmpg-400 hover:text-white text-xs">ESC</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
            <div className="p-2 border-t border-rmpg-700 text-center" style={{ background: '#0d1520' }}>
              <span className="text-[9px] text-rmpg-500">Press <kbd className="px-1 py-0.5 bg-rmpg-800 border border-rmpg-600 text-rmpg-300 rounded-sm text-[8px]">ESC</kbd> to close</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Law Books Reference Modal ── */}
      {showLawBooks && <LawBooksModal onClose={() => setShowLawBooks(false)} />}
    </>
  );
}

// ============================================================
// Law Books Modal — Criminal & Vehicle Code Reference
// ============================================================

const LAW_STATE_CODES = ['ALL', 'UT', 'CO', 'WY', 'ID', 'NV', 'AZ', 'NM'] as const;
const LAW_STATE_LABELS: Record<string, string> = {
  ALL: 'All States', UT: 'Utah', CO: 'Colorado', WY: 'Wyoming',
  ID: 'Idaho', NV: 'Nevada', AZ: 'Arizona', NM: 'New Mexico',
};

const OFFENSE_COLORS: Record<string, string> = {
  capital_felony: 'bg-red-900/60 text-red-300 border-red-700/50',
  first_degree_felony: 'bg-red-900/50 text-red-300 border-red-700/50',
  second_degree_felony: 'bg-red-900/40 text-red-400 border-red-700/40',
  third_degree_felony: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  class_a_misdemeanor: 'bg-amber-900/40 text-amber-300 border-amber-700/40',
  class_b_misdemeanor: 'bg-amber-900/30 text-amber-400 border-amber-700/30',
  class_c_misdemeanor: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30',
  infraction: 'bg-blue-900/30 text-blue-400 border-blue-700/30',
  enhancement: 'bg-purple-900/30 text-purple-400 border-purple-700/30',
};

interface LawStatute {
  id: number;
  state: string;
  citation: string;
  short_title: string;
  description?: string;
  definition?: string | null;
  offense_level: string | null;
  category: string;
  subcategory: string;
  citation_fine?: number | null;
}

function LawBooksModal({ onClose }: { onClose: () => void }) {
  const [activeState, setActiveState] = useState('ALL');
  const [activeCategory, setActiveCategory] = useState<'all' | 'criminal' | 'vehicle'>('all');
  const [search, setSearch] = useState('');
  const [statutes, setStatutes] = useState<LawStatute[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ESC key handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Fetch statutes when filters change
  const fetchStatutes = useCallback(async (q: string, st: string, cat: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (st !== 'ALL') params.set('state', st);
      if (cat !== 'all') params.set('category', cat);
      if (q.length >= 2) params.set('q', q);
      const res = await apiFetch<{ data: LawStatute[]; total: number }>(`/statutes?${params}`);
      setStatutes(res.data || []);
      setTotal(res.total || 0);
    } catch { setStatutes([]); setTotal(0); }
    finally { setLoading(false); }
  }, []);

  // Initial load
  useEffect(() => { fetchStatutes('', activeState, activeCategory); }, []);

  // Debounced search + immediate filter changes
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchStatutes(search, activeState, activeCategory);
    }, search.length > 0 ? 300 : 0);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, activeState, activeCategory, fetchStatutes]);

  const formatOffense = (level: string | null) =>
    level ? level.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="panel-beveled w-[800px] max-h-[85vh] overflow-hidden flex flex-col"
        style={{ background: '#141e2b' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-rmpg-600" style={{ background: '#0d1520' }}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Scale className="w-4 h-4 text-brand-400" />
            Law Reference — Criminal & Vehicle Code
          </h2>
          <div className="flex items-center gap-2 text-[10px] text-rmpg-500">
            <span>{total} statutes</span>
            <button type="button" onClick={onClose} className="text-rmpg-400 hover:text-white text-xs">ESC</button>
          </div>
        </div>

        {/* State Tabs */}
        <div className="flex border-b border-rmpg-700 overflow-x-auto" style={{ background: '#0d1520' }}>
          {LAW_STATE_CODES.map(st => (
            <button type="button"
              key={st}
              onClick={() => setActiveState(st)}
              className={`flex-shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                activeState === st
                  ? 'text-brand-300 border-b-2 border-brand-500 bg-brand-900/20'
                  : 'text-rmpg-500 hover:text-rmpg-200 hover:bg-rmpg-700/30'
              }`}
            >
              {st === 'ALL' ? 'All States' : `${st} — ${LAW_STATE_LABELS[st]}`}
            </button>
          ))}
        </div>

        {/* Category + Search Row */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-rmpg-700 bg-surface-base">
          <div className="flex gap-0.5">
            {(['all', 'criminal', 'vehicle'] as const).map(cat => (
              <button type="button"
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  activeCategory === cat
                    ? 'bg-brand-900/30 text-brand-300 border border-brand-700/50'
                    : 'text-rmpg-500 hover:text-rmpg-200 border border-transparent'
                }`}
              >
                {cat === 'all' ? 'All' : cat === 'criminal' ? 'Criminal' : 'Vehicle'}
              </button>
            ))}
          </div>
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by citation or keyword..."
              className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-rmpg-400">Loading statutes...</div>
          ) : statutes.length === 0 ? (
            <div className="p-8 text-center text-xs text-rmpg-500">
              {search.length >= 2 ? 'No statutes match your search' : 'No statutes found for this filter'}
            </div>
          ) : (
            statutes.map(s => (
              <div key={s.id} className="border-b border-rmpg-700/30">
                <button type="button"
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  className="w-full text-left px-3 py-2 hover:bg-rmpg-700/20 transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1 py-0 text-[8px] font-bold uppercase bg-rmpg-700/60 text-rmpg-300 border border-rmpg-600 leading-tight">
                      {s.state}
                    </span>
                    <span className="text-xs font-mono text-brand-400 font-bold">{s.citation}</span>
                    {s.offense_level && (
                      <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border ${
                        OFFENSE_COLORS[s.offense_level] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
                      }`}>
                        {formatOffense(s.offense_level)}
                      </span>
                    )}
                    {s.citation_fine != null && s.citation_fine > 0 && (
                      <span className="text-[9px] font-mono font-bold text-green-400 bg-green-900/30 border border-green-700/40 px-1 py-0">
                        ${s.citation_fine}
                      </span>
                    )}
                    {s.definition && (
                      <BookOpen className={`w-3 h-3 ml-auto flex-shrink-0 ${expandedId === s.id ? 'text-brand-400' : 'text-rmpg-600'}`} />
                    )}
                  </div>
                  <p className="text-xs text-rmpg-200 mt-0.5">{s.short_title}</p>
                  {s.subcategory && (
                    <span className="text-[10px] text-rmpg-500">{s.subcategory}</span>
                  )}
                </button>
                {expandedId === s.id && s.definition && (
                  <div className="px-3 pb-2">
                    <div className="bg-rmpg-800/60 border border-rmpg-600/50 p-2.5 text-[11px] text-rmpg-300 leading-relaxed whitespace-pre-line">
                      <div className="flex items-center gap-1 mb-1.5 text-brand-400 font-bold text-[9px] uppercase tracking-wider">
                        <BookOpen className="w-3 h-3" />
                        Law Reference — Elements & Definition
                      </div>
                      {s.definition}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-rmpg-700 flex items-center justify-between" style={{ background: '#0d1520' }}>
          <span className="text-[9px] text-rmpg-500">
            {activeState !== 'ALL' && `${LAW_STATE_LABELS[activeState]} — `}
            {statutes.length} of {total} statutes shown
          </span>
          <span className="text-[9px] text-rmpg-500">Press <kbd className="px-1 py-0.5 bg-rmpg-800 border border-rmpg-600 text-rmpg-300 rounded-sm text-[8px]">ESC</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
